// PotLoop settlement simulator: an exact, integer-only mirror of SavingsCircle.sol
// (settle, catchUp, finalize and the collateral / penalty / reserve / fee rules).
//
// It is not a separate economic model: every branch below follows the contract line by line, and
// test/Sim.parity.test.js runs the same scenarios through the real contract and this file and
// requires identical balances, base unit for base unit. If the contract changes, that test fails
// until this file is updated.
//
// Timing is abstracted to "rounds": a scenario says, for each member, from which round they stop
// paying and in which round (if any) they catch up. Within a round, catch-ups happen first, then
// contributions, then settle(). That is one valid ordering of real transactions; the contract's
// grace and cure windows only decide WHEN those calls are allowed, not what they do.

const GOOD = 0;
const PRE = 1; // left before their turn
const POST = 2; // behind after their turn

export const LATE_FEE_BPS = 200n;

export function collateralFor(n, c, k, i) {
  let later = BigInt(n - 1 - i);
  if (later === 0n) later = 1n;
  return (later * BigInt(c) * BigInt(k) + 9999n) / 10000n;
}

/** What a member sends to accept seat i: full collateral, or in from-payout mode the smaller of the
 *  seat's collateral and one contribution (so leaving before your turn costs the same in both modes). */
export function upfrontCollateral(n, c, k, i, fromPayout) {
  const full = collateralFor(n, c, k, i);
  return fromPayout && full > BigInt(c) ? BigInt(c) : full;
}

/**
 * Run a whole circle.
 * @param {object} p
 * @param {number} p.n            members (2..12)
 * @param {bigint} p.c            contribution per round, token base units
 * @param {number} p.k            cover in basis points (0, 2000, 3000, 4000, 5000, 10000)
 * @param {number} [p.feeBps]     service fee on pot money paid out
 * @param {number[]} [p.stopAt]   per member: first round they don't pay (0 = always pays)
 * @param {number[]} [p.catchUpAt] per member: round at whose start they catch up (0 = never)
 * @param {boolean} [p.fromPayout] collateral mode: true = one-share bond upfront, rest held from the pot
 * @returns per-member and group results, all bigint base units, plus `trace`: the full state after
 *          every catch-up, every round's contributions, every settle and the finalize
 */
export function simulate({ n, c, k, feeBps = 0, stopAt = [], catchUpAt = [], fromPayout = false }) {
  c = BigInt(c);
  const fee = BigInt(feeBps);
  const m = Array.from({ length: n }, (_, i) => ({
    status: GOOD,
    paidOut: false,
    collateral: upfrontCollateral(n, c, k, i, fromPayout),
    locked: upfrontCollateral(n, c, k, i, fromPayout),
    heldFromPot: 0n, // collateral held back from pot money (from-payout mode)
    paidIn: 0n,
    collateralUsed: 0n,
    unpaidEntitlement: 0n,
    recordedLoss: 0n,
    refundClaim: 0n,
    refundPaid: 0n,
    missedRounds: 0,
    penalty: 0n,
    sentIn: 0n, // every token the member sent to the contract (collateral + payments + catch-ups)
    potAtTurn: 0n, // gross pot money credited in their own round (before fee)
    lateRepaid: 0n, // gross pot money repaid to them later
    withdrawable: 0n,
  }));
  for (const x of m) x.sentIn = x.locked;
  let treasury = 0n;
  let freeReserve = 0n;
  let roundFund = 0n;
  let currentRound = 1;
  let allRoundsSettled = false;
  const contributed = new Set(); // `${round}:${i}`
  const events = [];
  const trace = [];
  const snap = (step, extra = {}) =>
    trace.push({
      step,
      round: currentRound,
      allRoundsSettled,
      freeReserve,
      roundFund,
      treasury,
      ...extra,
      members: m.map((x) => ({
        status: x.status,
        paidOut: x.paidOut,
        collateral: x.collateral,
        paidIn: x.paidIn,
        collateralUsed: x.collateralUsed,
        unpaidEntitlement: x.unpaidEntitlement,
        recordedLoss: x.recordedLoss,
        refundClaim: x.refundClaim,
        refundPaid: x.refundPaid,
        missedRounds: x.missedRounds,
        penalty: x.penalty,
        withdrawable: x.withdrawable,
      })),
    });

  const credit = (i, amt) => {
    if (i === "treasury") treasury += amt;
    else m[i].withdrawable += amt;
  };
  // Rule (v9.2.1): in from-payout mode, pot money credited to a member who still owes a scheduled
  // payment first raises their collateral toward the collateral of their SEAT (what an upfront
  // member of that seat holds), never above it; the rest is withdrawable. The round the money
  // arrives in does not change the target. "Still owes a payment": some round is unsettled and
  // the member has not already paid the last round.
  const stillOwesAPayment = (i, r) => !allRoundsSettled && !(r === n && contributed.has(`${n}:${i}`));
  const payOut = (i, gross, r) => {
    const f = (gross * fee) / 10000n;
    let net = gross - f;
    if (fromPayout && stillOwesAPayment(i, r)) {
      const target = collateralFor(n, c, k, i);
      const x = m[i];
      const hold = x.collateral < target ? (target - x.collateral < net ? target - x.collateral : net) : 0n;
      x.collateral += hold;
      x.heldFromPot += hold;
      net -= hold;
      if (hold > 0n) events.push({ round: r, type: "held", member: i, amount: hold });
    }
    credit(i, net);
    if (f > 0n) credit("treasury", f);
  };
  const repayEntitlements = () => {
    for (let i = 0; i < n && freeReserve > 0n; i++) {
      const owed = m[i].unpaidEntitlement;
      if (owed === 0n || m[i].status !== GOOD) continue;
      const pay = owed < freeReserve ? owed : freeReserve;
      m[i].unpaidEntitlement = owed - pay;
      freeReserve -= pay;
      m[i].lateRepaid += pay;
      payOut(i, pay, currentRound);
      events.push({ round: currentRound, type: "repaid", member: i, amount: pay });
    }
  };
  const shareEqually = (amount) => {
    const each = amount / BigInt(n);
    const rem = amount - each * BigInt(n);
    for (let i = 0; i < n; i++) credit(i, each + (BigInt(i) < rem ? 1n : 0n));
  };

  const arrearsOf = (i) => {
    const x = m[i];
    if (x.status !== POST) return [0n, 0n];
    const settled = BigInt(allRoundsSettled ? n : currentRound - 1);
    let due = settled * c;
    if (!allRoundsSettled && contributed.has(`${currentRound}:${i}`)) due += c;
    const met = x.paidIn + x.collateralUsed;
    return [x.collateralUsed, due > met ? due - met : 0n];
  };

  const catchUp = (i) => {
    const x = m[i];
    if (x.status !== POST) return;
    const [restore, uncovered] = arrearsOf(i);
    const currentPart = !allRoundsSettled && !contributed.has(`${currentRound}:${i}`) ? c : 0n;
    const lateFee = ((restore + uncovered) * LATE_FEE_BPS) / 10000n;
    const cost = { total: restore + uncovered + currentPart + lateFee, currentPart, lateFee };
    x.status = GOOD;
    x.collateral += restore;
    x.paidIn += restore + uncovered + currentPart;
    x.collateralUsed = 0n;
    freeReserve += uncovered + lateFee;
    if (currentPart > 0n) {
      contributed.add(`${currentRound}:${i}`);
      roundFund += currentPart;
    }
    x.sentIn += restore + uncovered + currentPart + lateFee;
    repayEntitlements();
    events.push({ round: currentRound, type: "catchUp", member: i, amount: restore + uncovered + currentPart + lateFee });
    snap("catchUp", { member: i, cost });
  };

  const contribute = (i) => {
    const x = m[i];
    if (x.status === PRE || contributed.has(`${currentRound}:${i}`)) return;
    contributed.add(`${currentRound}:${i}`);
    x.paidIn += c;
    x.sentIn += c;
    roundFund += c;
  };

  const settle = () => {
    const r = currentRound;
    let fund = roundFund;
    roundFund = 0n;
    for (let i = 0; i < n; i++) {
      const x = m[i];
      if (x.status === PRE || contributed.has(`${r}:${i}`)) continue;
      x.missedRounds += 1;
      if (x.status !== GOOD) continue;
      if (x.paidOut) {
        x.status = POST;
        events.push({ round: r, type: "behind", member: i });
      } else {
        x.status = PRE;
        const col = x.collateral;
        x.collateral = 0n;
        freeReserve += col;
        const claim = x.paidIn + col;
        const penalty = claim < c ? claim : c;
        x.refundClaim = claim - penalty;
        x.penalty = penalty;
        events.push({ round: r, type: "left", member: i, penalty });
      }
    }
    for (let i = 0; i < n; i++) {
      const x = m[i];
      if (x.status === POST && x.collateral > 0n && !contributed.has(`${r}:${i}`)) {
        const take = x.collateral < c ? x.collateral : c;
        x.collateral -= take;
        x.collateralUsed += take;
        fund += take;
        events.push({ round: r, type: "collateral", member: i, amount: take });
      }
    }
    repayEntitlements();
    const ri = r - 1;
    const rec = m[ri];
    if (rec.status === GOOD) {
      const pot = BigInt(n) * c;
      const fromFund = fund < pot ? fund : pot;
      const need = pot - fromFund;
      const fromReserve = need < freeReserve ? need : freeReserve;
      freeReserve -= fromReserve;
      freeReserve += fund - fromFund;
      rec.paidOut = true;
      rec.unpaidEntitlement = need - fromReserve;
      rec.potAtTurn = fromFund + fromReserve;
      payOut(ri, fromFund + fromReserve, r);
      events.push({ round: r, type: "pot", member: ri, paid: fromFund + fromReserve, short: need - fromReserve });
    } else {
      freeReserve += fund;
      events.push({ round: r, type: "potCancelled", member: ri, toReserve: fund });
    }
    repayEntitlements();
    if (r === n) allRoundsSettled = true;
    else currentRound = r + 1;
  };

  const finalize = () => {
    for (let i = 0; i < n; i++) {
      const x = m[i];
      if (x.status === POST && x.collateral > 0n) {
        credit(i, x.collateral);
        x.collateral = 0n;
      }
    }
    for (let i = 0; i < n; i++) {
      const x = m[i];
      const ent = x.unpaidEntitlement;
      if (x.status !== POST || ent === 0n) continue;
      const total = BigInt(n) * c;
      const met = x.paidIn + x.collateralUsed;
      const owes = met >= total ? 0n : total - met;
      const netted = ent < owes ? ent : owes;
      x.unpaidEntitlement = 0n;
      x.refundClaim += ent - netted;
    }
    repayEntitlements();
    for (const x of m) {
      if (x.unpaidEntitlement > 0n) {
        x.recordedLoss = x.unpaidEntitlement;
        x.unpaidEntitlement = 0n;
      }
    }
    for (let i = 0; i < n; i++) {
      const x = m[i];
      if (x.status === GOOD && x.collateral > 0n) {
        credit(i, x.collateral);
        x.collateral = 0n;
      }
    }
    const totalClaims = m.reduce((a, x) => a + x.refundClaim, 0n);
    const pool = freeReserve;
    if (totalClaims > 0n && pool > 0n) {
      let distributed = 0n;
      let last = 0;
      for (let i = 0; i < n; i++) {
        const claim = m[i].refundClaim;
        if (claim === 0n) continue;
        const share = pool >= totalClaims ? claim : (claim * pool) / totalClaims;
        m[i].refundPaid = share;
        distributed += share;
        last = i;
        if (share > 0n) credit(i, share);
      }
      freeReserve = pool - distributed;
      if (freeReserve > 0n && pool < totalClaims) {
        m[last].refundPaid += freeReserve;
        credit(last, freeReserve);
        freeReserve = 0n;
      }
    }
    if (freeReserve > 0n) {
      const left = freeReserve;
      freeReserve = 0n;
      const good = m.filter((x) => x.status === GOOD).length;
      if (good === 0) {
        const totalPen = m.reduce((a, x) => a + x.penalty, 0n);
        if (totalPen === 0n) shareEqually(left);
        else {
          let given = 0n;
          let lastI = 0;
          for (let i = 0; i < n; i++) {
            if (m[i].penalty === 0n) continue;
            const part = (left * m[i].penalty) / totalPen;
            lastI = i;
            given += part;
            if (part > 0n) credit(i, part);
          }
          if (left > given) credit(lastI, left - given);
        }
      } else {
        const each = left / BigInt(good);
        let rem = left - each * BigInt(good);
        for (let i = 0; i < n; i++) {
          if (m[i].status !== GOOD) continue;
          const extra = rem > 0n ? 1n : 0n;
          if (rem > 0n) rem -= 1n;
          credit(i, each + extra);
        }
      }
    }
  };

  // ---- run the schedule ----
  for (let r = 1; r <= n; r++) {
    for (let i = 0; i < n; i++) if (catchUpAt[i] === r) catchUp(i);
    for (let i = 0; i < n; i++) {
      const stopped = stopAt[i] && r >= stopAt[i] && !(catchUpAt[i] && r >= catchUpAt[i]);
      if (!stopped) contribute(i);
    }
    snap("contributed");
    settle();
    snap("settle");
  }
  // cure window: a catch-up scheduled after the last round happens here
  for (let i = 0; i < n; i++) if (catchUpAt[i] > n) catchUp(i);
  finalize();
  snap("finalize");

  const members = m.map((x, i) => ({
    seat: i + 1,
    collateralLocked: x.locked,
    heldFromPot: x.heldFromPot,
    sentIn: x.sentIn,
    received: x.withdrawable,
    net: x.withdrawable - x.sentIn,
    potAtTurn: x.potAtTurn,
    lateRepaid: x.lateRepaid,
    finalLoss: x.recordedLoss,
    collateralUsed: x.collateralUsed,
    penalty: x.penalty,
    missedRounds: x.missedRounds,
    outcome: x.status === PRE ? "left" : x.status === POST ? "walked" : x.missedRounds > 0 ? "caughtUp" : "finished",
  }));
  const totalIn = members.reduce((a, x) => a + x.sentIn, 0n);
  const totalOut = members.reduce((a, x) => a + x.received, 0n) + treasury;
  return { members, treasury, events, trace, conserved: totalIn === totalOut, totalIn, totalOut };
}

/** Everyone pays: the reference ("honest") outcome. */
export function honest(p) {
  return simulate({ ...p, stopAt: [], catchUpAt: [] });
}
