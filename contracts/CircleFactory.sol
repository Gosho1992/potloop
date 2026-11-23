// SPDX-License-Identifier: MIT
pragma solidity 0.8.39;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SavingsCircle} from "./SavingsCircle.sol";
import {CircleDeployer} from "./CircleDeployer.sol";

/// @title CircleFactory
/// @notice Creates PotLoop savings circles, keeps a public list of them, indexes members once
///         they accept a seat, and keeps each address's on-chain circle history.
/// @dev No owner. Token, treasury, fee and the minimum schedule and amount are fixed at
///      deployment. Only circles this factory created can write to it.
contract CircleFactory {
    uint256 public constant MAX_PAGE_SIZE = 100;
    IERC20 public immutable token; // QUSDC on QIE mainnet
    address public immutable treasury;
    uint256 public immutable feeBps; // service fee on pot money paid out, max 1%
    uint256 public immutable minRoundLength; // e.g. 1 day for real circles
    uint256 public immutable minGrace;
    uint256 public immutable minContribution; // stops free history farming with dust circles
    /// Lowest collateral cover a circle from this factory may use. Below 100% cover, the member paid
    /// first can gain by walking away (see docs/PAYOFF_MATRIX.md); a public deployment can require
    /// full cover so no member profits from defaulting after their turn.
    uint256 public immutable minCoverageBps;
    /// @notice Created by this factory in its constructor; deploys circles only when this factory calls.
    CircleDeployer public immutable deployer;

    /// @notice Interface version, so an app can tell which createCircle signature this factory has.
    ///         92 = v9.2 (minimum cover + collateral-from-payout option). Older factories lack it.
    uint256 public constant FACTORY_VERSION = 92;

    /// @notice Every creation rule in one read. All values are immutable: no one can change them,
    ///         and they apply only to circles this factory creates. Cover levels a circle may use are
    ///         0, 2000, 3000, 4000, 5000 and 10000 bps (enforced by SavingsCircle); this factory also
    ///         refuses any below minCoverageBps.
    function rules()
        external
        view
        returns (
            address token_,
            address treasury_,
            uint256 feeBps_,
            uint256 minRoundLength_,
            uint256 minGrace_,
            uint256 minContribution_,
            uint256 minCoverageBps_,
            uint256 version_
        )
    {
        return (address(token), treasury, feeBps, minRoundLength, minGrace, minContribution, minCoverageBps, FACTORY_VERSION);
    }

    /// History of an address across finished circles of this factory. Not identity, not a credit check.
    struct History {
        uint64 completed; // finished without missing a payment
        uint64 caughtUp; // missed, then caught up in full
        uint64 leftEarly; // missed before their turn and left the circle
        uint64 walkedAway; // took the pot and stopped paying
        uint128 volume; // sum of pot sizes (N x contribution) of circles finished in good standing
    }

    address[] private _circles;
    mapping(address => bool) public isCircle;
    mapping(address => bool) public recorded;
    mapping(address => string) public nameOf;
    mapping(address => address[]) private _joined; // circles where the member accepted a seat
    mapping(address => History) public history;

    event CircleCreated(address indexed circle, address indexed organizer, string name, uint256 contribution, uint256 coverageBps, uint256 size);
    event Invited(address indexed circle, address indexed member, uint256 slot);
    event Joined(address indexed circle, address indexed member);
    event ResultRecorded(address indexed circle, address indexed member, uint8 outcome);

    error BadConfig();
    error NotACircle();
    error NotFinished();
    error AlreadyRecorded();

    constructor(
        IERC20 token_,
        address treasury_,
        uint256 feeBps_,
        uint256 minRoundLength_,
        uint256 minGrace_,
        uint256 minContribution_,
        uint256 minCoverageBps_
    ) {
        if (address(token_).code.length == 0) revert BadConfig();
        if (feeBps_ > 100 || (feeBps_ > 0 && treasury_ == address(0))) revert BadConfig();
        if (minRoundLength_ < 60 || minGrace_ < 30 || minGrace_ > minRoundLength_ || minContribution_ == 0) revert BadConfig();
        if (minCoverageBps_ > 10000) revert BadConfig();
        token = token_;
        treasury = treasury_;
        feeBps = feeBps_;
        minRoundLength = minRoundLength_;
        minGrace = minGrace_;
        minContribution = minContribution_;
        minCoverageBps = minCoverageBps_;
        deployer = new CircleDeployer(); // records this factory as its only caller
    }

    /// @notice Create a circle. `members` is the payout order. Each member joins by calling
    ///         accept() on the new circle; until then they are only invited.
    function createCircle(
        string calldata name,
        address[] calldata members,
        uint256 contribution,
        uint256 coverageBps,
        uint256 roundLength,
        uint256 grace,
        uint256 joinWindow,
        bool collateralFromPayout
    ) external returns (address circle) {
        _checkName(name);
        if (roundLength < minRoundLength || grace < minGrace || contribution < minContribution) revert BadConfig();
        if (coverageBps < minCoverageBps) revert BadConfig();
        circle = deployer.deploy(
            SavingsCircle.Config({
                members: members,
                token: token,
                contribution: contribution,
                coverageBps: coverageBps,
                roundLength: roundLength,
                grace: grace,
                joinWindow: joinWindow,
                organizer: msg.sender,
                treasury: treasury,
                feeBps: feeBps,
                registry: address(this),
                collateralFromPayout: collateralFromPayout
            })
        );
        isCircle[circle] = true;
        nameOf[circle] = name;
        _circles.push(circle);
        emit CircleCreated(circle, msg.sender, name, contribution, coverageBps, members.length);
        for (uint256 i = 0; i < members.length; i++) {
            emit Invited(circle, members[i], i + 1);
        }
    }

    /// @notice Called by a circle when a member accepts their seat.
    function recordJoin(address member) external {
        if (!isCircle[msg.sender]) revert NotACircle();
        _joined[member].push(msg.sender);
        emit Joined(msg.sender, member);
    }

    /// @notice Write a finished circle's results into everyone's history. Anyone can call it,
    ///         once per circle; nothing about the money depends on it.
    function recordCircle(address circle) external {
        if (!isCircle[circle]) revert NotACircle();
        if (recorded[circle]) revert AlreadyRecorded();
        SavingsCircle c = SavingsCircle(circle);
        if (c.phase() != SavingsCircle.Phase.Completed) revert NotFinished();
        recorded[circle] = true;
        address[] memory ms = c.members();
        uint256 pot = c.size() * c.contribution();
        for (uint256 i = 0; i < ms.length; i++) {
            uint8 outcome = c.outcomeOf(i);
            History storage h = history[ms[i]];
            if (outcome == 0) h.completed += 1;
            else if (outcome == 1) h.caughtUp += 1;
            else if (outcome == 2) h.leftEarly += 1;
            else h.walkedAway += 1;
            if (outcome <= 1) h.volume += uint128(pot);
            emit ResultRecorded(circle, ms[i], outcome);
        }
    }

    function circleCount() external view returns (uint256) {
        return _circles.length;
    }

    /// @notice Newest-first page of all circles.
    function circlesPage(uint256 offset, uint256 limit) external view returns (address[] memory) {
        return _page(_circles, offset, limit);
    }

    function joinedCount(address member) external view returns (uint256) {
        return _joined[member].length;
    }

    /// @notice Newest-first page of circles where `member` accepted a seat.
    function joinedPage(address member, uint256 offset, uint256 limit) external view returns (address[] memory) {
        return _page(_joined[member], offset, limit);
    }

    function _checkName(string calldata name) private pure {
        bytes calldata b = bytes(name);
        if (b.length == 0 || b.length > 64) revert BadConfig();
        for (uint256 j = 0; j < b.length; j++) {
            if (uint8(b[j]) < 0x20 || uint8(b[j]) == 0x7f) revert BadConfig(); // no control characters
        }
    }

    function _page(address[] storage list, uint256 offset, uint256 limit) private view returns (address[] memory page) {
        uint256 total = list.length;
        if (offset >= total) return new address[](0);
        uint256 boundedLimit = limit > MAX_PAGE_SIZE ? MAX_PAGE_SIZE : limit;
        uint256 count = boundedLimit > total - offset ? total - offset : boundedLimit;
        page = new address[](count);
        for (uint256 k = 0; k < count; k++) {
            page[k] = list[total - 1 - offset - k];
        }
    }
}
