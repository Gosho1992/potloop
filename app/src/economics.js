import { simulate } from "./sim.js";

/**
 * Integer-only mirror of SavingsCircle.collateralFor().
 * These values are derived from the immutable circle configuration; no fiat
 * estimates or assumptions about future reserve balances are used.
 */
export function collateralForSeat(size, contribution, coverageBps, seatIndex) {
  const later = Math.max(size - 1 - seatIndex, 1);
  return (BigInt(later) * contribution * BigInt(coverageBps) + 9999n) / 10000n;
}

export function feeFor(gross, feeBps) {
  return (gross * BigInt(feeBps)) / 10000n;
}

/** Mirror of SavingsCircle.upfrontCollateral(): what accepting a seat locks now. */
export function upfrontForSeat(size, contribution, coverageBps, seatIndex, fromPayout) {
  const full = collateralForSeat(size, contribution, coverageBps, seatIndex);
  return fromPayout && full > contribution ? contribution : full;
}

/**
 * A member's fixed terms before a circle starts, assuming the pot is paid in full.
 * - collateral: the full collateral the seat ends up with after its payout (seatTerms).
 * - upfront: what accepting the seat locks now.
 * - heldFromPot: the part held back from the seat's own pot (from-payout mode), returned at the end.
 * - inHandAtTurn: what the member can withdraw at their turn (payout after fee, minus heldFromPot).
 * - startCapital: everything the member must have to start: upfront collateral + round 1 payment.
 */
export function seatCommitment({ size, contribution, coverageBps, feeBps = 0, seatIndex, fromPayout = false }) {
  const pot = contribution * BigInt(size);
  const remainingAfterPayout = contribution * BigInt(Math.max(size - 1 - seatIndex, 0));
  const collateral = collateralForSeat(size, contribution, coverageBps, seatIndex);
  const upfront = upfrontForSeat(size, contribution, coverageBps, seatIndex, fromPayout);
  const collateralBacked = collateral < remainingAfterPayout ? collateral : remainingAfterPayout;
  const uncoveredAfterPayout = remainingAfterPayout - collateralBacked;
  const payoutFee = feeFor(pot, feeBps);
  const expectedPayout = pot - payoutFee;
  const heldFromPot = collateral - upfront;
  return {
    pot,
    payoutFee,
    expectedPayout,
    totalContributions: pot,
    collateral,
    upfront,
    heldFromPot,
    inHandAtTurn: expectedPayout - heldFromPot,
    startCapital: upfront + contribution,
    remainingAfterPayout,
    collateralBacked,
    uncoveredAfterPayout,
  };
}

/**
 * Everything a member should know about one seat, from one source:
 * - commitment and exposure: from the contract's seatTerms() when the circle provides it
 *   (source "contract"), otherwise from the same formula (source "formula", older circles);
 * - scenarios: computed by the settlement simulator in sim.js, which the test suite checks against
 *   the contract base unit for base unit. Each scenario states what it assumes.
 * All amounts are bigint token base units; nothing uses floating point.
 */
export function seatRisk({ size, contribution, coverageBps, feeBps = 0, seatIndex, contractTerms = null, fromPayout = false }) {
  const n = size;
  const c = contribution;
  const formula = seatCommitment({ size, contribution, coverageBps, feeBps, seatIndex, fromPayout });
  let t = formula;
  if (contractTerms) {
    // contract values win; derived lines are recomputed from them so nothing can disagree
    t = { ...formula, ...contractTerms, collateralBacked: contractTerms.remainingAfterPayout - contractTerms.uncoveredAfterPayout };
    if (contractTerms.upfront !== undefined) {
      t.heldFromPot = t.collateral - contractTerms.upfront;
      t.inHandAtTurn = t.expectedPayout - t.heldFromPot;
      t.startCapital = contractTerms.upfront + c;
    }
  }
  const base = { n, c, k: coverageBps, feeBps, fromPayout };
  const honestRun = simulate(base);
  const me = (run) => run.members[seatIndex];
  const othersNet = (run) => run.members.reduce((a, x, j) => (j === seatIndex ? a : a + x.net), 0n);
  const isLast = seatIndex === n - 1;

  // A. you take the pot and stop paying for good
  let youWalk = null;
  if (!isLast) {
    const stopAt = Array(n).fill(0);
    stopAt[seatIndex] = seatIndex + 2;
    const run = simulate({ ...base, stopAt });
    youWalk = {
      gain: me(run).net - me(honestRun).net,
      othersLose: othersNet(honestRun) - othersNet(run),
      collateralUsed: me(run).collateralUsed,
      assumes: "everyone else pays every round",
    };
  }

  // B. you leave in round 1, before your turn (seat 1's turn IS round 1)
  let youLeave = null;
  if (seatIndex > 0) {
    const stopAt = Array(n).fill(0);
    stopAt[seatIndex] = 1;
    const run = simulate({ ...base, stopAt });
    youLeave = { net: me(run).net, penalty: me(run).penalty, assumes: "everyone else pays every round" };
  }

  // C. others default: what reaches you at your turn, and what you are still owed at the very end
  const gross = c * BigInt(n);
  const shortfall = (stopAt, assumes) => {
    const run = simulate({ ...base, stopAt });
    return {
      atTurn: gross - me(run).potAtTurn,
      finalLoss: me(run).finalLoss,
      netChange: me(run).net - me(honestRun).net,
      assumes,
    };
  };
  let onePrevWalks = null;
  let allPrevWalk = null;
  let earlyLeaver = null;
  if (seatIndex > 0) {
    const s1 = Array(n).fill(0);
    s1[seatIndex - 1] = seatIndex + 1; // the seat just before you stops right after its turn
    onePrevWalks = shortfall(s1, `seat ${seatIndex} stops right after its turn; everyone else pays`);
  }
  if (seatIndex > 1) {
    const sAll = Array(n).fill(0);
    for (let j = 0; j < seatIndex; j++) sAll[j] = j + 2;
    allPrevWalk = shortfall(sAll, `seats 1–${seatIndex} all stop right after their turns; everyone else pays`);
  }
  {
    // a member who has not had a turn leaves in round 1 without paying (the last seat, or the
    // seat after you if you are last)
    const leaver = isLast ? n - 2 : n - 1;
    if (leaver !== seatIndex && leaver > 0) {
      const sL = Array(n).fill(0);
      sL[leaver] = 1;
      earlyLeaver = { ...shortfall(sL, `seat ${leaver + 1} leaves in round 1 without paying; everyone else pays`), seat: leaver + 1 };
    }
  }
  // the most this member could end up worse off than if everyone paid, among the scenarios above
  // in which they themselves keep paying (never a guarantee: more failures at once can cost more)
  const honestCases = [onePrevWalks, allPrevWalk, earlyLeaver].filter(Boolean);
  const worstHonest = honestCases.reduce((w, x) => (x.netChange < w ? x.netChange : w), 0n);
  return {
    source: contractTerms ? "contract" : "formula",
    worstHonestLoss: -worstHonest,
    terms: t,
    honestNet: me(honestRun).net,
    youWalk,
    youLeave,
    onePrevWalks,
    allPrevWalk,
    earlyLeaver,
  };
}

/**
 * The same seat at every cover level the factory allows: what it takes to start, what stays locked,
 * what reaches the member at their turn, what is not backed, and the walk-away gain (simulated).
 * Lets a creator compare cover levels on the figures members will actually see.
 */
export function capitalComparison({ size, contribution, feeBps = 0, seatIndex, fromPayout, covers }) {
  return covers.map((coverageBps) => {
    const r = seatRisk({ size, contribution, coverageBps, feeBps, seatIndex, fromPayout });
    return {
      coverageBps,
      startCapital: r.terms.startCapital,
      upfront: r.terms.upfront,
      lockedAtMost: r.terms.collateral,
      inHandAtTurn: r.terms.inHandAtTurn,
      uncovered: r.terms.uncoveredAfterPayout,
      walkGain: r.youWalk ? r.youWalk.gain : 0n,
      othersLose: r.youWalk ? r.youWalk.othersLose : 0n,
    };
  });
}

export function coverageLabel(coverageBps) {
  if (coverageBps === 10000) return "Full scheduled-payment cover";
  if (coverageBps === 0) return "No collateral cover";
  return `${coverageBps / 100}% scheduled-payment cover`;
}
