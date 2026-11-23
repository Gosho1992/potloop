// SPDX-License-Identifier: MIT
pragma solidity 0.8.39;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice The registry (the CircleFactory) that indexes members once they accept a seat.
interface ICircleRegistry {
    function recordJoin(address member) external;
}

/// @title SavingsCircle
/// @notice A rotating savings circle (stokvel / committee / ROSCA) with collateral priced by
///         payout seat. Mechanism Spec v6.
/// @dev Immutable: no owner, no admin, no pause, no upgrade path. One circle per deployment.
///      settle() and finalize() only move numbers between ledgers; tokens leave the contract
///      only through withdraw() / withdrawTo(). Every state-changing function is nonReentrant.
///
///      Every token held by the contract is in exactly one ledger:
///        locked collateral (per member) + free reserve + withdrawable (per address)
///        + current round fund  ==  token balance (plus any stray tokens until swept)
contract SavingsCircle is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ---------------------------------------------------------------------
    // Types
    // ---------------------------------------------------------------------

    enum Phase {
        Open, // waiting for members to accept their seats
        Active, // rounds running (and the cure window after the last round)
        Completed, // finalized, everything withdrawable
        Cancelled // join window passed without all members
    }

    enum Status {
        Good, // up to date (possibly after catching up)
        PrePayoutDefault, // missed a payment before receiving the pot: has left the circle
        PostPayoutDefault // missed a payment after receiving the pot: behind until they catch up
    }

    struct Member {
        bool accepted;
        bool paidOut;
        Status status;
        uint256 collateral; // locked collateral still available
        uint256 paidIn; // total paid in (contributions, plus collateral refills when catching up)
        uint256 collateralUsed; // collateral spent covering this member's missed contributions
        uint256 unpaidEntitlement; // part of this member's pot still owed to them (gross)
        uint256 recordedLoss; // part of this member's pot that could not be paid (final)
        uint256 refundClaim; // a leaver's claim on leftover reserve (paid last)
        uint256 refundPaid; // what the leaver actually got back
        uint256 missedRounds; // history: rounds this member did not pay (never reset)
    }

    struct Config {
        address[] members; // payout order: members[0] receives the first pot
        IERC20 token; // the stablecoin (QUSDC on QIE mainnet)
        uint256 contribution; // c, in token units (QUSDC has 6 decimals)
        uint256 coverageBps; // k: 0, 2000, 3000, 4000, 5000 or 10000
        uint256 roundLength;
        uint256 grace; // late payments inside the grace window are on time; also the final cure window
        uint256 joinWindow;
        address organizer; // informational only: has no powers
        address treasury; // receives the service fee (ignored when feeBps == 0)
        uint256 feeBps; // fee on pot money actually paid out, max 100 (1%)
        address registry; // optional membership registry (0 = none)
        bool collateralFromPayout; // true: lock at most one share to join, hold the rest back from your own pot
    }

    struct Risk {
        uint256 stillOwed; // remaining contributions owed by members already paid out
        uint256 secured; // part of stillOwed backed by their own collateral
        uint256 freeReserve;
        uint256 unpaidEntitlements; // already owed to members who were paid short
        uint256 claimShortfall; // unpaidEntitlements the reserve cannot cover today
        uint256 netUncovered; // stillOwed - secured - max(0, freeReserve - unpaidEntitlements)
        uint256 coverageBps; // secured / stillOwed, in basis points (10000 = 100%)
    }

    // ---------------------------------------------------------------------
    // Hard limits (the factory can set stricter minimums)
    // ---------------------------------------------------------------------

    uint256 public constant MIN_ROUND = 60;
    uint256 public constant MAX_ROUND = 365 days;
    uint256 public constant MIN_GRACE = 30;
    uint256 public constant MIN_JOIN = 60;
    uint256 public constant MAX_JOIN = 60 days;
    uint256 public constant MAX_CONTRIBUTION = 1e15; // 1 billion units of a 6-decimal token
    uint256 public constant MAX_FEE_BPS = 100;
    uint256 public constant LATE_FEE_BPS = 200; // 2% on what a member catches up, to the group reserve

    // ---------------------------------------------------------------------
    // Immutable configuration
    // ---------------------------------------------------------------------

    IERC20 public immutable token;
    address public immutable organizer;
    uint256 public immutable contribution;
    uint256 public immutable coverageBps;
    uint256 public immutable roundLength;
    uint256 public immutable grace;
    uint256 public immutable joinDeadline;
    uint256 public immutable size;
    address public immutable treasury;
    uint256 public immutable feeBps;
    address public immutable registry;
    /// @notice true: members lock at most one share to join; the rest of their collateral is held
    ///         back from their own payout (from the pot money actually credited to them).
    bool public immutable collateralFromPayout;

    address[] private _members; // slot order: index 0 = seat 1 (paid first)

    // ---------------------------------------------------------------------
    // State
    // ---------------------------------------------------------------------

    Phase public phase;
    uint256 public currentRound; // 1..N while Active
    uint256 public roundStart;
    bool public allRoundsSettled;
    uint256 public finalizeAfter; // end of the cure window after the last round

    uint256 public roundFund;
    uint256 public freeReserve;
    uint256 public totalWithdrawable;
    uint256 public acceptedCount;

    mapping(address => uint256) private _slotPlusOne; // 0 = not a member
    mapping(uint256 => Member) private _m; // by slot index
    mapping(uint256 => mapping(uint256 => bool)) public contributed; // round => slot index => paid
    mapping(address => uint256) public withdrawable;
    mapping(uint256 => uint256) public penaltyPaid; // by slot index: share forfeited by leaving early

    // ---------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------

    event Accepted(address indexed member, uint256 indexed slot, uint256 collateral);
    event Left(address indexed member, uint256 indexed slot, uint256 refunded);
    event Activated(uint256 startTime);
    event Cancelled();
    event Contributed(uint256 indexed round, address indexed member, uint256 amount);
    event Defaulted(uint256 indexed round, address indexed member, bool afterPayout);
    event CollateralToReserve(uint256 indexed round, address indexed member, uint256 amount);
    event CollateralCovered(uint256 indexed round, address indexed member, uint256 amount);
    event PotCredited(uint256 indexed round, address indexed recipient, uint256 fromFund, uint256 fromReserve, uint256 unpaid);
    event PayoutCancelled(uint256 indexed round, address indexed recipient, uint256 toReserve);
    event EntitlementRepaid(address indexed recipient, uint256 amount);
    event RoundSettled(uint256 indexed round, uint256 freeReserveAfter);
    event LossRecorded(address indexed recipient, uint256 amount);
    event RefundCredited(address indexed defaulter, uint256 amount, uint256 claim);
    event Finalized();
    event Withdrawn(address indexed account, address indexed to, uint256 amount);
    event FeeCharged(uint256 indexed round, uint256 amount);
    event PenaltyApplied(uint256 indexed round, address indexed member, uint256 amount);
    event EntitlementNetted(address indexed member, uint256 netted, uint256 toClaim);
    event SurplusSwept(uint256 amount);
    event CaughtUp(address indexed member, uint256 restoredCollateral, uint256 arrearsPaid, uint256 currentRoundPaid, uint256 lateFee);
    event CollateralReturned(address indexed member, uint256 amount);
    event CollateralHeldFromPot(uint256 indexed round, address indexed member, uint256 amount);

    // ---------------------------------------------------------------------
    // Errors
    // ---------------------------------------------------------------------

    error BadConfig();
    error NotMember();
    error WrongPhase();
    error AlreadyAccepted();
    error NotAccepted();
    error JoinWindowOpen();
    error JoinWindowClosed();
    error NotAllAccepted();
    error AlreadyContributed();
    error MemberDefaulted();
    error ContributionWindowClosed();
    error TooEarlyToSettle();
    error RoundsNotDone();
    error CureWindowOpen();
    error NothingToWithdraw();
    error TransferAmountMismatch();
    error NotBehind();
    error BadRecipient();

    // ---------------------------------------------------------------------
    // Construction
    // ---------------------------------------------------------------------

    constructor(Config memory cfg) {
        uint256 n = cfg.members.length;
        if (n < 2 || n > 12) revert BadConfig();
        if (address(cfg.token).code.length == 0) revert BadConfig();
        if (cfg.contribution == 0 || cfg.contribution > MAX_CONTRIBUTION) revert BadConfig();
        if (cfg.roundLength < MIN_ROUND || cfg.roundLength > MAX_ROUND) revert BadConfig();
        if (cfg.grace < MIN_GRACE || cfg.grace > cfg.roundLength) revert BadConfig();
        if (cfg.joinWindow < MIN_JOIN || cfg.joinWindow > MAX_JOIN) revert BadConfig();
        uint256 k = cfg.coverageBps;
        if (k != 0 && k != 2000 && k != 3000 && k != 4000 && k != 5000 && k != 10000) revert BadConfig();
        if (cfg.feeBps > MAX_FEE_BPS) revert BadConfig();
        if (cfg.feeBps > 0 && cfg.treasury == address(0)) revert BadConfig();

        for (uint256 i = 0; i < n; i++) {
            address a = cfg.members[i];
            if (a == address(0) || _slotPlusOne[a] != 0) revert BadConfig();
            _slotPlusOne[a] = i + 1;
            _members.push(a);
        }

        token = cfg.token;
        organizer = cfg.organizer == address(0) ? msg.sender : cfg.organizer;
        contribution = cfg.contribution;
        coverageBps = k;
        roundLength = cfg.roundLength;
        grace = cfg.grace;
        joinDeadline = block.timestamp + cfg.joinWindow;
        size = n;
        treasury = cfg.treasury;
        feeBps = cfg.feeBps;
        registry = cfg.registry;
        collateralFromPayout = cfg.collateralFromPayout;
        phase = Phase.Open;
    }

    // ---------------------------------------------------------------------
    // Joining
    // ---------------------------------------------------------------------

    /// @notice Collateral for a slot index (0-based): max(N - 1 - i, 1) x c x k, rounded up,
    ///         so any cover above 0% always locks something.
    function collateralFor(uint256 slotIndex) public view returns (uint256) {
        uint256 later = size - 1 - slotIndex;
        if (later == 0) later = 1;
        return (later * contribution * coverageBps + 9999) / 10000;
    }

    /// @notice What a member sends to accept a seat. Upfront mode: the full collateralFor(slot).
    ///         From-payout mode: the smaller of collateralFor(slot) and one contribution; the rest
    ///         is held back from the member's own pot when it is paid (see _payOut). One full
    ///         share (not share x cover) keeps leaving before your turn exactly as costly as in
    ///         upfront mode: the penalty min(contribution, paid in + collateral) is the same.
    function upfrontCollateral(uint256 slotIndex) public view returns (uint256) {
        if (slotIndex >= size) revert BadConfig();
        uint256 full = collateralFor(slotIndex);
        if (collateralFromPayout && full > contribution) return contribution;
        return full;
    }

    /// @notice Immutable, member-facing terms for a payout seat. This lets wallets show the
    /// exact commitment from contract state before they approve collateral.
    /// @dev `uncoveredAfterPayout` is scheduled contribution exposure not backed by that
    ///      member's collateral. It excludes reserve, other defaults, token and contract risk.
    function seatTerms(uint256 slotIndex)
        external
        view
        returns (
            uint256 requiredCollateral,
            uint256 totalContributions,
            uint256 expectedPayout,
            uint256 payoutFee,
            uint256 remainingAfterPayout,
            uint256 uncoveredAfterPayout
        )
    {
        if (slotIndex >= size) revert BadConfig();
        requiredCollateral = collateralFor(slotIndex);
        totalContributions = size * contribution;
        payoutFee = (totalContributions * feeBps) / 10000;
        expectedPayout = totalContributions - payoutFee;
        remainingAfterPayout = (size - 1 - slotIndex) * contribution;
        uint256 secured = requiredCollateral < remainingAfterPayout ? requiredCollateral : remainingAfterPayout;
        uncoveredAfterPayout = remainingAfterPayout - secured;
    }

    /// @notice Accept your assigned seat and lock its collateral. Approve the exact amount first.
    function accept() external nonReentrant {
        if (phase != Phase.Open) revert WrongPhase();
        if (block.timestamp > joinDeadline) revert JoinWindowClosed();
        uint256 i = _indexOf(msg.sender);
        Member storage mem = _m[i];
        if (mem.accepted) revert AlreadyAccepted();

        uint256 amount = upfrontCollateral(i);
        mem.accepted = true;
        mem.collateral = amount;
        acceptedCount += 1;
        _pullExact(msg.sender, amount);
        emit Accepted(msg.sender, i + 1, amount);
        if (acceptedCount == size) _activate();
        // last: tell the registry (our own factory) so the member's circle list shows it
        if (registry != address(0)) ICircleRegistry(registry).recordJoin(msg.sender);
    }

    /// @notice Change your mind before the circle starts: your collateral is returned.
    function leave() external nonReentrant {
        if (phase != Phase.Open) revert WrongPhase();
        uint256 i = _indexOf(msg.sender);
        Member storage mem = _m[i];
        if (!mem.accepted) revert NotAccepted();
        uint256 col = mem.collateral;
        mem.accepted = false;
        mem.collateral = 0;
        acceptedCount -= 1;
        _credit(msg.sender, col);
        emit Left(msg.sender, i + 1, col);
    }

    /// @notice Starts round 1. Normally triggered automatically by the last accept().
    function activate() external nonReentrant {
        if (phase != Phase.Open) revert WrongPhase();
        if (acceptedCount != size) revert NotAllAccepted();
        _activate();
    }

    /// @notice If the join window ends before everyone accepts, anyone can cancel.
    function cancel() external nonReentrant {
        if (phase != Phase.Open) revert WrongPhase();
        if (block.timestamp <= joinDeadline) revert JoinWindowOpen();
        if (acceptedCount == size) revert BadConfig();
        phase = Phase.Cancelled;
        for (uint256 i = 0; i < size; i++) {
            uint256 col = _m[i].collateral;
            if (col > 0) {
                _m[i].collateral = 0;
                _credit(_members[i], col);
            }
        }
        if (freeReserve > 0) {
            uint256 left = freeReserve;
            freeReserve = 0;
            _shareEqually(left);
        }
        emit Cancelled();
    }

    // ---------------------------------------------------------------------
    // Rounds
    // ---------------------------------------------------------------------

    function deadline() public view returns (uint256) {
        return roundStart + roundLength;
    }

    /// @notice Pay this round's contribution (approve `contribution` first). Members behind after
    ///         their turn may keep paying; members who left before their turn cannot.
    function contribute() external nonReentrant {
        if (phase != Phase.Active || allRoundsSettled) revert WrongPhase();
        uint256 i = _indexOf(msg.sender);
        Member storage mem = _m[i];
        if (mem.status == Status.PrePayoutDefault) revert MemberDefaulted();
        if (contributed[currentRound][i]) revert AlreadyContributed();
        if (block.timestamp > deadline() + grace) revert ContributionWindowClosed();

        contributed[currentRound][i] = true;
        mem.paidIn += contribution;
        roundFund += contribution;
        _pullExact(msg.sender, contribution);
        emit Contributed(currentRound, msg.sender, contribution);
    }

    /// @notice Settle the current round. Anyone can call it after deadline + grace, or earlier
    ///         once every member still allowed to pay (including members behind) has paid.
    function settle() external nonReentrant {
        if (phase != Phase.Active || allRoundsSettled) revert WrongPhase();
        uint256 r = currentRound;
        if (block.timestamp <= deadline() + grace && !_allEligiblePaid(r)) revert TooEarlyToSettle();

        uint256 n = size;
        uint256 c = contribution;
        uint256 fund = roundFund;
        roundFund = 0;

        // 1. record misses and classify new defaults; a new leaver's collateral moves to the reserve
        for (uint256 i = 0; i < n; i++) {
            Member storage mem = _m[i];
            if (mem.status == Status.PrePayoutDefault || contributed[r][i]) continue;
            mem.missedRounds += 1;
            if (mem.status != Status.Good) continue;
            if (mem.paidOut) {
                mem.status = Status.PostPayoutDefault;
                emit Defaulted(r, _members[i], true);
            } else {
                mem.status = Status.PrePayoutDefault;
                uint256 col = mem.collateral;
                mem.collateral = 0;
                freeReserve += col;
                // leaving early costs up to one contribution, taken from what the leaver has in;
                // it stays in the reserve and ends up with the members who stayed
                uint256 claim = mem.paidIn + col;
                uint256 penalty = claim < c ? claim : c;
                mem.refundClaim = claim - penalty;
                penaltyPaid[i] = penalty;
                emit Defaulted(r, _members[i], false);
                if (col > 0) emit CollateralToReserve(r, _members[i], col);
                if (penalty > 0) emit PenaltyApplied(r, _members[i], penalty);
            }
        }

        // 2. each member behind after their turn has their collateral pay up to c of this round
        for (uint256 i = 0; i < n; i++) {
            Member storage mem = _m[i];
            if (mem.status == Status.PostPayoutDefault && mem.collateral > 0 && !contributed[r][i]) {
                uint256 take = mem.collateral < c ? mem.collateral : c;
                mem.collateral -= take;
                mem.collateralUsed += take;
                fund += take;
                emit CollateralCovered(r, _members[i], take);
            }
        }

        // 3. older unpaid entitlements are repaid before this round's recipient draws on the reserve
        _repayEntitlements();

        // 4. credit the recipient, or cancel a leaver's payout
        uint256 ri = r - 1;
        Member storage rec = _m[ri];
        if (rec.status == Status.Good) {
            uint256 pot = n * c;
            uint256 fromFund = fund < pot ? fund : pot;
            uint256 need = pot - fromFund;
            uint256 fromReserve = need < freeReserve ? need : freeReserve;
            freeReserve -= fromReserve;
            freeReserve += fund - fromFund; // surplus, if any
            rec.paidOut = true;
            rec.unpaidEntitlement = need - fromReserve;
            _payOut(r, ri, fromFund + fromReserve);
            emit PotCredited(r, _members[ri], fromFund, fromReserve, need - fromReserve);
        } else {
            freeReserve += fund;
            emit PayoutCancelled(r, _members[ri], fund);
        }

        // 5. any surplus added this round repays the oldest unpaid entitlements
        _repayEntitlements();

        emit RoundSettled(r, freeReserve);

        if (r == n) {
            allRoundsSettled = true;
            // cure window: members behind can still catch up before anyone can finish the circle
            finalizeAfter = block.timestamp + grace;
        } else {
            currentRound = r + 1;
            // fixed schedule: the next round starts when this one was due (or now, if settled late)
            uint256 due = roundStart + roundLength;
            roundStart = block.timestamp > due ? block.timestamp : due;
        }
    }

    /// @notice What a member behind after their turn must pay to be back in good standing: the
    ///         collateral the circle used for them plus any missed share it could not cover.
    function arrearsOf(uint256 slotIndex) public view returns (uint256 restore, uint256 uncovered) {
        Member storage mem = _m[slotIndex];
        if (mem.status != Status.PostPayoutDefault || phase != Phase.Active) return (0, 0);
        uint256 settled = allRoundsSettled ? size : currentRound - 1;
        uint256 due = settled * contribution;
        if (!allRoundsSettled && contributed[currentRound][slotIndex]) due += contribution;
        uint256 met = mem.paidIn + mem.collateralUsed;
        restore = mem.collateralUsed;
        uncovered = due > met ? due - met : 0;
    }

    /// @notice Total a member must send to catch up now: arrears, any unrecorded current-round
    ///         payment (including an expired but unsettled round), and the 2% late fee on arrears.
    function catchUpCost(uint256 slotIndex) public view returns (uint256 total, uint256 currentPart, uint256 lateFee) {
        (uint256 restore, uint256 uncovered) = arrearsOf(slotIndex);
        if (_m[slotIndex].status != Status.PostPayoutDefault || phase != Phase.Active) return (0, 0, 0);
        // The unsettled current round remains an obligation after its window expires. Include it
        // in catch-up so the member cannot be restored to Good before settlement classifies it.
        if (!allRoundsSettled && !contributed[currentRound][slotIndex]) currentPart = contribution;
        lateFee = ((restore + uncovered) * LATE_FEE_BPS) / 10000;
        total = restore + uncovered + currentPart + lateFee;
    }

    /// @notice Catch up fully after missing payments post-payout: refill the collateral the circle
    ///         used, pay any uncovered share (to the reserve, which repays whoever was paid short),
    ///         pay any unrecorded current round, plus a 2% late fee to the group reserve.
    ///         The member is back in good standing; the misses stay in their history.
    ///         Works until the circle is finished, including the cure window after the last round.
    function catchUp() external nonReentrant {
        if (phase != Phase.Active) revert WrongPhase();
        uint256 i = _indexOf(msg.sender);
        Member storage mem = _m[i];
        if (mem.status != Status.PostPayoutDefault) revert NotBehind();
        (uint256 restore, uint256 uncovered) = arrearsOf(i);
        (uint256 total, uint256 currentPart, uint256 lateFee) = catchUpCost(i);

        mem.status = Status.Good;
        mem.collateral += restore;
        mem.paidIn += restore + uncovered + currentPart;
        mem.collateralUsed = 0;
        freeReserve += uncovered + lateFee;
        if (currentPart > 0) {
            contributed[currentRound][i] = true;
            roundFund += currentPart;
            emit Contributed(currentRound, msg.sender, currentPart);
        }
        _pullExact(msg.sender, total);
        _repayEntitlements();
        emit CaughtUp(msg.sender, restore, uncovered, currentPart, lateFee);
    }

    /// @notice End of the cycle. Anyone can call it after the last round is settled and the cure
    ///         window has passed (or straight away if nobody is behind).
    function finalize() external nonReentrant {
        if (phase != Phase.Active) revert WrongPhase();
        if (!allRoundsSettled) revert RoundsNotDone();
        uint256 n = size;
        if (block.timestamp < finalizeAfter) {
            for (uint256 i = 0; i < n; i++) {
                if (_m[i].status == Status.PostPayoutDefault) revert CureWindowOpen();
            }
        }

        // a member behind whose missed rounds were all covered owes nothing: leftover collateral
        // goes straight back to them (it never pays for anyone else's debt)
        for (uint256 i = 0; i < n; i++) {
            Member storage mem = _m[i];
            if (mem.status == Status.PostPayoutDefault && mem.collateral > 0) {
                uint256 col = mem.collateral;
                mem.collateral = 0;
                _credit(_members[i], col);
                emit CollateralReturned(_members[i], col);
            }
        }

        // what is still owed to a member who is behind is set against what they still owe;
        // anything left over becomes a refund claim, paid last
        for (uint256 i = 0; i < n; i++) {
            Member storage mem = _m[i];
            uint256 ent = mem.unpaidEntitlement;
            if (mem.status != Status.PostPayoutDefault || ent == 0) continue;
            uint256 total = n * contribution;
            uint256 met = mem.paidIn + mem.collateralUsed;
            uint256 owes = met >= total ? 0 : total - met;
            uint256 netted = ent < owes ? ent : owes;
            mem.unpaidEntitlement = 0;
            mem.refundClaim += ent - netted;
            emit EntitlementNetted(_members[i], netted, ent - netted);
        }

        // honest recipients first
        _repayEntitlements();
        for (uint256 i = 0; i < n; i++) {
            Member storage mem = _m[i];
            if (mem.unpaidEntitlement > 0) {
                mem.recordedLoss = mem.unpaidEntitlement;
                mem.unpaidEntitlement = 0;
                emit LossRecorded(_members[i], mem.recordedLoss);
            }
        }

        // members in good standing get their collateral back
        for (uint256 i = 0; i < n; i++) {
            Member storage mem = _m[i];
            if (mem.status == Status.Good && mem.collateral > 0) {
                uint256 col = mem.collateral;
                mem.collateral = 0;
                _credit(_members[i], col);
                emit CollateralReturned(_members[i], col);
            }
        }

        // refund claims last, pro rata
        uint256 totalClaims = 0;
        for (uint256 i = 0; i < n; i++) {
            totalClaims += _m[i].refundClaim;
        }
        uint256 pool = freeReserve;
        if (totalClaims > 0 && pool > 0) {
            uint256 distributed = 0;
            uint256 lastClaimant = 0;
            for (uint256 i = 0; i < n; i++) {
                uint256 claim = _m[i].refundClaim;
                if (claim == 0) continue;
                uint256 share = pool >= totalClaims ? claim : (claim * pool) / totalClaims;
                _m[i].refundPaid = share;
                distributed += share;
                lastClaimant = i;
                if (share > 0) _credit(_members[i], share);
                emit RefundCredited(_members[i], share, claim);
            }
            freeReserve = pool - distributed;
            if (freeReserve > 0 && pool < totalClaims) {
                uint256 dust = freeReserve;
                freeReserve = 0;
                _m[lastClaimant].refundPaid += dust;
                _credit(_members[lastClaimant], dust);
            }
        }

        // what is left (penalties, late fees, swept tokens) goes to members in good standing
        if (freeReserve > 0) {
            uint256 left = freeReserve;
            freeReserve = 0;
            uint256 goodCount = 0;
            for (uint256 i = 0; i < n; i++) {
                if (_m[i].status == Status.Good) goodCount++;
            }
            if (goodCount == 0) {
                // nobody finished in good standing: penalties go back to those who paid them
                uint256 totalPen = 0;
                for (uint256 i = 0; i < n; i++) {
                    totalPen += penaltyPaid[i];
                }
                if (totalPen == 0) {
                    _shareEqually(left);
                } else {
                    uint256 given = 0;
                    uint256 lastI = 0;
                    for (uint256 i = 0; i < n; i++) {
                        if (penaltyPaid[i] == 0) continue;
                        uint256 part = (left * penaltyPaid[i]) / totalPen;
                        lastI = i;
                        given += part;
                        if (part > 0) _credit(_members[i], part);
                    }
                    if (left > given) _credit(_members[lastI], left - given);
                }
            } else {
                uint256 each = left / goodCount;
                uint256 rem = left - each * goodCount;
                for (uint256 i = 0; i < n; i++) {
                    if (_m[i].status != Status.Good) continue;
                    uint256 extra = rem > 0 ? 1 : 0;
                    if (rem > 0) rem--;
                    _credit(_members[i], each + extra);
                }
            }
        }

        phase = Phase.Completed;
        emit Finalized();
    }

    // ---------------------------------------------------------------------
    // Withdrawals (the only way tokens leave the contract)
    // ---------------------------------------------------------------------

    function withdraw() external nonReentrant {
        _withdraw(msg.sender);
    }

    /// @notice Withdraw your balance to another address (for example if your own address is
    ///         blocked by the token).
    function withdrawTo(address to) external nonReentrant {
        if (to == address(0) || to == address(this)) revert BadRecipient();
        _withdraw(to);
    }

    /// @notice Tokens sent straight to the contract are in no ledger. Anyone can account for them:
    ///         before or during the circle they join the group reserve; after it has finished or
    ///         been cancelled they are shared equally by all members.
    function sweepSurplus() external nonReentrant {
        uint256 bal = token.balanceOf(address(this));
        uint256 acc = _accounted();
        if (bal <= acc) revert NothingToWithdraw();
        uint256 extra = bal - acc;
        if (phase == Phase.Open || phase == Phase.Active) {
            freeReserve += extra;
        } else {
            _shareEqually(extra);
        }
        emit SurplusSwept(extra);
    }

    // ---------------------------------------------------------------------
    // Views for the app, the registry and the risk meter
    // ---------------------------------------------------------------------

    function members() external view returns (address[] memory) {
        return _members;
    }

    function slotOf(address account) external view returns (uint256) {
        return _slotPlusOne[account]; // 1-based slot, 0 = not a member
    }

    function member(uint256 slotIndex) external view returns (Member memory) {
        return _m[slotIndex];
    }

    /// @notice 0 = finished without missing, 1 = caught up after missing, 2 = left before their
    ///         turn, 3 = took the pot and stopped paying. Meaningful once Completed.
    function outcomeOf(uint256 slotIndex) external view returns (uint8) {
        Member storage mem = _m[slotIndex];
        if (mem.status == Status.PrePayoutDefault) return 2;
        if (mem.status == Status.PostPayoutDefault) return 3;
        return mem.missedRounds > 0 ? 1 : 0;
    }

    /// @notice What this member still owes the group, and how much of it their collateral secures.
    function memberExposure(uint256 slotIndex)
        public
        view
        returns (uint256 stillOwes, uint256 secured, uint256 uncovered)
    {
        Member storage mem = _m[slotIndex];
        if (!mem.paidOut || phase == Phase.Completed) return (0, 0, 0);
        uint256 total = size * contribution;
        uint256 met = mem.paidIn + mem.collateralUsed;
        stillOwes = met >= total ? 0 : total - met;
        secured = mem.collateral < stillOwes ? mem.collateral : stillOwes;
        uncovered = stillOwes - secured;
    }

    /// @notice The risk meter.
    function risk() external view returns (Risk memory out) {
        for (uint256 i = 0; i < size; i++) {
            (uint256 owes, uint256 sec,) = memberExposure(i);
            out.stillOwed += owes;
            out.secured += sec;
            out.unpaidEntitlements += _m[i].unpaidEntitlement;
        }
        out.freeReserve = freeReserve;
        out.claimShortfall = out.unpaidEntitlements > freeReserve ? out.unpaidEntitlements - freeReserve : 0;
        uint256 spareReserve = freeReserve > out.unpaidEntitlements ? freeReserve - out.unpaidEntitlements : 0;
        uint256 backed = out.secured + spareReserve;
        out.netUncovered = out.stillOwed > backed ? out.stillOwed - backed : 0;
        out.coverageBps = out.stillOwed == 0 ? 10000 : (out.secured * 10000) / out.stillOwed;
    }

    /// @notice Sum of every ledger. Equals token.balanceOf(this) unless someone sent tokens
    ///         directly (then the balance is higher until sweepSurplus() runs).
    function accountedBalance() external view returns (uint256) {
        return _accounted();
    }

    // ---------------------------------------------------------------------
    // Internals
    // ---------------------------------------------------------------------

    function _accounted() private view returns (uint256 total) {
        for (uint256 i = 0; i < size; i++) {
            total += _m[i].collateral;
        }
        total += freeReserve + totalWithdrawable + roundFund;
    }

    function _activate() private {
        phase = Phase.Active;
        currentRound = 1;
        roundStart = block.timestamp;
        emit Activated(block.timestamp);
    }

    function _indexOf(address a) private view returns (uint256) {
        uint256 s = _slotPlusOne[a];
        if (s == 0) revert NotMember();
        return s - 1;
    }

    /// @dev Early settlement waits for every member who may still pay, including members behind.
    function _allEligiblePaid(uint256 r) private view returns (bool) {
        for (uint256 i = 0; i < size; i++) {
            if (_m[i].status != Status.PrePayoutDefault && !contributed[r][i]) return false;
        }
        return true;
    }

    /// @dev Credit pot money to a recipient, minus the service fee. In from-payout mode, the
    ///      recipient's collateral is first raised toward collateralFor(slot): exactly what an
    ///      upfront member of the same seat holds. The target depends only on the seat, never on
    ///      the round the money arrives in, so a short payout and every later repayment of it work
    ///      toward the same amount, and collateral never exceeds it. Nothing is held once the
    ///      member has no scheduled payment left (all rounds settled, or the last round paid).
    function _payOut(uint256 r, uint256 i, uint256 gross) private {
        uint256 fee = (gross * feeBps) / 10000;
        uint256 net = gross - fee;
        if (collateralFromPayout && !allRoundsSettled && !(r == size && contributed[r][i])) {
            Member storage mem = _m[i];
            uint256 target = collateralFor(i);
            if (mem.collateral < target) {
                uint256 hold = target - mem.collateral;
                if (hold > net) hold = net;
                mem.collateral += hold;
                net -= hold;
                if (hold > 0) emit CollateralHeldFromPot(r, _members[i], hold);
            }
        }
        _credit(_members[i], net);
        if (fee > 0) {
            _credit(treasury, fee);
            emit FeeCharged(r, fee);
        }
    }

    function _repayEntitlements() private {
        for (uint256 i = 0; i < size && freeReserve > 0; i++) {
            Member storage mem = _m[i];
            uint256 owed = mem.unpaidEntitlement;
            if (owed == 0 || mem.status != Status.Good) continue;
            uint256 pay = owed < freeReserve ? owed : freeReserve;
            mem.unpaidEntitlement = owed - pay;
            freeReserve -= pay;
            _payOut(currentRound, i, pay);
            emit EntitlementRepaid(_members[i], pay);
        }
    }

    function _shareEqually(uint256 amount) private {
        uint256 n = size;
        uint256 each = amount / n;
        uint256 rem = amount - each * n;
        for (uint256 i = 0; i < n; i++) {
            _credit(_members[i], each + (i < rem ? 1 : 0));
        }
    }

    function _credit(address to, uint256 amount) private {
        withdrawable[to] += amount;
        totalWithdrawable += amount;
    }

    function _withdraw(address to) private {
        uint256 amount = withdrawable[msg.sender];
        if (amount == 0) revert NothingToWithdraw();
        withdrawable[msg.sender] = 0;
        totalWithdrawable -= amount;
        uint256 before = token.balanceOf(to);
        token.safeTransfer(to, amount);
        // the recipient must receive exactly what was credited
        if (token.balanceOf(to) - before != amount) revert TransferAmountMismatch();
        emit Withdrawn(msg.sender, to, amount);
    }

    /// @dev Pull exactly `amount`, rejecting fee-on-transfer or short transfers.
    function _pullExact(address from, uint256 amount) private {
        if (amount == 0) return;
        uint256 before = token.balanceOf(address(this));
        token.safeTransferFrom(from, address(this), amount);
        if (token.balanceOf(address(this)) - before != amount) revert TransferAmountMismatch();
    }
}
