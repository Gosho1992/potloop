// Runs a scenario on the real contract with the same schedule as app/src/sim.js simulate(), and
// checks the collateral and repayment RULES on the contract's own state after every transaction.
// The rules are stated here independently of the simulator, so a mistake shared by the contract
// and the simulator still fails:
//   R1  A member's collateral never exceeds the collateral of their seat, collateralFor(seat).
//   R2  A member in good standing holds exactly min(collateralFor(seat), what they locked to join +
//       all pot money credited to them, after fee, while they still owed a scheduled payment).
//       Upfront mode: what they locked is collateralFor(seat), so this is collateralFor(seat).
//       From-pot mode: the target is the seat's collateral, whatever round the money arrives in.
//   R3  Every pot credit, the ORIGINAL PAYOUT (PotCredited) as well as every later repayment
//       (EntitlementRepaid), splits exactly into collateral held + fee + withdrawable, with the
//       fee computed here from the gross amount. The fees add up to the FeeCharged events and to
//       the treasury's rise. An original payout marks the member paid and records exactly the
//       event's shortfall as their entitlement (less anything repaid in the same transaction);
//       each repayment lowers the entitlement by exactly its amount; in a catch-up, the reserve
//       changes by exactly (uncovered + late fee − repayments).
const { expect } = require("chai");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const { deployCircle, acceptAll, checkLedgers } = require("./helpers");

async function chainState(ctx, step, extra = {}) {
  const { circle, n } = ctx;
  const members = [];
  for (let i = 0; i < n; i++) {
    const x = await circle.member(i);
    members.push({
      status: Number(x.status),
      paidOut: x.paidOut,
      collateral: x.collateral,
      paidIn: x.paidIn,
      collateralUsed: x.collateralUsed,
      unpaidEntitlement: x.unpaidEntitlement,
      recordedLoss: x.recordedLoss,
      refundClaim: x.refundClaim,
      refundPaid: x.refundPaid,
      missedRounds: Number(x.missedRounds),
      penalty: await circle.penaltyPaid(i),
      withdrawable: await circle.withdrawable(ctx.members[i].address),
    });
  }
  return {
    step,
    round: Number(await circle.currentRound()),
    allRoundsSettled: await circle.allRoundsSettled(),
    freeReserve: await circle.freeReserve(),
    roundFund: await circle.roundFund(),
    treasury: ctx.feeBps > 0 ? await circle.withdrawable(ctx.treasury) : 0n,
    ...extra,
    members,
  };
}

/** Checks R1–R3 for one transaction. `before`/`after` are chainState snapshots around it. */
async function checkRules(ctx, rule, before, after, receipt, label) {
  const { circle, n } = ctx;
  const fee = BigInt(ctx.feeBps);
  const addrIndex = new Map(ctx.members.map((m, i) => [m.address, i]));
  const credits = Array.from({ length: n }, () => ({ gross: 0n, fee: 0n, net: 0n, held: 0n, repaid: 0n, payout: null }));
  let caughtUp = null;
  let feeEvents = 0n;
  for (const l of receipt.logs) {
    let e;
    try {
      e = circle.interface.parseLog(l);
    } catch {
      continue;
    }
    if (!e) continue;
    if (e.name === "PotCredited" || e.name === "EntitlementRepaid") {
      const i = addrIndex.get(e.args.recipient);
      const gross = e.name === "PotCredited" ? e.args.fromFund + e.args.fromReserve : e.args.amount;
      const f = (gross * fee) / 10000n;
      const net = gross - f;
      credits[i].gross += gross;
      credits[i].fee += f;
      credits[i].net += net;
      if (e.name === "EntitlementRepaid") credits[i].repaid += gross;
      else credits[i].payout = { gross, unpaid: e.args.unpaid };
      // was the member still owing a scheduled payment when this money arrived?
      const r = before.round;
      const owed = !before.allRoundsSettled && !(r === n && (await circle.contributed(r, i)));
      if (owed) rule.creditedWhileOwing[i] += net;
    }
    if (e.name === "CollateralHeldFromPot") credits[addrIndex.get(e.args.member)].held += e.args.amount;
    if (e.name === "CaughtUp") caughtUp = e.args;
    if (e.name === "FeeCharged") feeEvents += e.args.amount;
  }
  // R3, transaction-wide: fees computed from every gross credit = FeeCharged events = treasury rise
  const feeTotal = credits.reduce((s, x) => s + x.fee, 0n);
  expect(feeEvents, `${label}: R3 FeeCharged events = fees computed from the credits`).to.equal(feeTotal);
  if (ctx.feeBps > 0) expect(after.treasury - before.treasury, `${label}: R3 treasury rise = fees`).to.equal(feeTotal);
  for (let i = 0; i < n; i++) {
    const a = after.members[i];
    const b = before.members[i];
    const target = await circle.collateralFor(i);
    const upfront = await circle.upfrontCollateral(i);
    // R1
    expect(a.collateral <= target, `${label}: R1 seat ${i + 1} collateral ${a.collateral} > its seat's ${target}`).to.equal(true);
    // R2 (until finalize returns collateral)
    if (after.step !== "finalize" && a.status === 0 && a.paidOut) {
      const want = upfront + rule.creditedWhileOwing[i] < target ? upfront + rule.creditedWhileOwing[i] : target;
      expect(a.collateral, `${label}: R2 seat ${i + 1} collateral (target ${target}, joined with ${upfront}, credited while owing ${rule.creditedWhileOwing[i]})`).to.equal(want);
    }
    // R3, per member: every pot credit, original payout included
    const cr = credits[i];
    if (cr.gross > 0n || cr.payout) {
      // a member who catches up is back in good standing within the same transaction and can be
      // repaid its own old shortfall right away; its collateral also rises by the refill
      const catcher = caughtUp && addrIndex.get(caughtUp.member) === i;
      expect(catcher ? a.status : b.status, `${label}: R3 seat ${i + 1} only members in good standing receive pot money`).to.equal(0);
      expect(cr.held <= cr.net, `${label}: R3 seat ${i + 1} held ${cr.held} <= credited after fee ${cr.net}`).to.equal(true);
      // finalize also returns collateral and shares leftovers, so the split is checked before it
      if (after.step !== "finalize") {
        const refill = catcher ? caughtUp.restoredCollateral : 0n;
        expect(a.collateral - b.collateral, `${label}: R3 seat ${i + 1} collateral rise = refill + held`).to.equal(refill + cr.held);
        expect(a.withdrawable - b.withdrawable, `${label}: R3 seat ${i + 1} withdrawable rise = gross − fee − held`).to.equal(cr.gross - cr.fee - cr.held);
      }
      if (cr.payout) {
        expect(b.paidOut, `${label}: R3 seat ${i + 1} was not paid before its payout`).to.equal(false);
        expect(a.paidOut, `${label}: R3 seat ${i + 1} is marked paid`).to.equal(true);
        expect(a.unpaidEntitlement, `${label}: R3 seat ${i + 1} entitlement = payout shortfall − repaid in the same tx`).to.equal(b.unpaidEntitlement + cr.payout.unpaid - cr.repaid);
        rule.checked.payouts++;
      } else {
        expect(b.unpaidEntitlement - a.unpaidEntitlement, `${label}: R3 seat ${i + 1} entitlement falls by the repayment`).to.equal(cr.repaid);
      }
      if (cr.repaid > 0n) rule.checked.repayments++;
    }
  }
  if (caughtUp) {
    const repaid = credits.reduce((s, x) => s + x.repaid, 0n);
    expect(after.freeReserve - before.freeReserve, `${label}: R3 reserve change in catch-up`).to.equal(caughtUp.arrearsPaid + caughtUp.lateFee - repaid);
  }
}

/**
 * Same schedule as simulate(): per round, catch-ups, then contributions, then settle; catch-ups
 * scheduled after the last round happen in the cure window; then finalize.
 * lateCatchUp[i] = true makes member i catch up only after the round's deadline + grace has
 * passed (an expired but unsettled round), which the contract must still accept.
 * Returns the chain trace (same shape as the simulator's) after checking R1–R3 at every step.
 */
async function runOnChain(p, label = "") {
  const { n, k, feeBps, stopAt, catchUpAt, fromPayout, lateCatchUp = [] } = p;
  const ctx = await deployCircle({ n, cRaw: p.c, k, feeBps, fromPayout });
  ctx.feeBps = feeBps;
  const addr = await ctx.circle.getAddress();
  await acceptAll(ctx);
  const trace = [];
  const rule = { creditedWhileOwing: Array(n).fill(0n), checked: { payouts: 0, repayments: 0 } };
  let last = await chainState(ctx, "start");
  const record = async (step, receipt, extra) => {
    const st = await chainState(ctx, step, extra);
    if (receipt) await checkRules(ctx, rule, last, st, receipt, `${label} ${step} r${st.round}`);
    trace.push(st);
    last = st;
  };
  const doCatchUp = async (i) => {
    const [total, currentPart, lateFee] = await ctx.circle.catchUpCost(i);
    await ctx.token.connect(ctx.members[i]).approve(addr, total);
    const rc = await (await ctx.circle.connect(ctx.members[i]).catchUp()).wait();
    await checkLedgers(ctx);
    await record("catchUp", rc, { member: i, cost: { total, currentPart, lateFee } });
  };
  for (let r = 1; r <= n; r++) {
    for (let i = 0; i < n; i++) {
      if (catchUpAt[i] === r && !lateCatchUp[i] && (await ctx.circle.member(i)).status === 2n) await doCatchUp(i);
    }
    for (let i = 0; i < n; i++) {
      const stopped = stopAt[i] && r >= stopAt[i] && !(catchUpAt[i] && r >= catchUpAt[i]);
      if (stopped || (await ctx.circle.contributed(r, i)) || (await ctx.circle.member(i)).status === 1n) continue;
      if (catchUpAt[i] === r && lateCatchUp[i] && (await ctx.circle.member(i)).status === 2n) continue; // pays via catch-up below
      await ctx.token.connect(ctx.members[i]).approve(addr, ctx.c);
      await ctx.circle.connect(ctx.members[i]).contribute();
    }
    const late = [...Array(n).keys()].filter((i) => catchUpAt[i] === r && lateCatchUp[i]);
    if (late.length) {
      const due = Number(await ctx.circle.deadline()) + ctx.grace + 1;
      if ((await time.latest()) < due) await time.increaseTo(due);
      for (const i of late) if ((await ctx.circle.member(i)).status === 2n) await doCatchUp(i);
    }
    await record("contributed", null);
    let allPaid = true;
    for (let i = 0; i < n; i++) {
      const x = await ctx.circle.member(i);
      if (x.status !== 1n && !(await ctx.circle.contributed(r, i))) allPaid = false;
    }
    if (!allPaid) {
      const due = Number(await ctx.circle.deadline()) + ctx.grace + 1;
      if ((await time.latest()) < due) await time.increaseTo(due);
    }
    const rc = await (await ctx.circle.settle()).wait();
    await checkLedgers(ctx);
    await record("settle", rc);
  }
  for (let i = 0; i < n; i++) {
    if (catchUpAt[i] > n && (await ctx.circle.member(i)).status === 2n) await doCatchUp(i);
  }
  const fa = Number(await ctx.circle.finalizeAfter());
  if ((await time.latest()) < fa) await time.increaseTo(fa);
  const rc = await (await ctx.circle.finalize()).wait();
  await checkLedgers(ctx);
  await record("finalize", rc);
  return { trace, ctx, checked: rule.checked };
}

module.exports = { runOnChain, chainState };
