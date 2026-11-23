// The frontend simulator (app/src/sim.js) must agree with SavingsCircle.sol to the base unit,
// not only at the end but after EVERY step: each catch-up (and its quoted cost), each round's
// contributions, each settle() and finalize(). Compared at every step, for every member: status,
// paid-out flag, collateral, paid in, collateral used, unpaid entitlement, recorded loss, refund
// claim, refund paid, missed rounds, penalty, withdrawable balance; and for the circle: current
// round, all-rounds-settled flag, round fund, free reserve, treasury balance.
// Independently of the simulator, test/circleRunner.js also checks the collateral and repayment
// rules (R1–R3) on the contract's state after every transaction of every scenario.
//
// SIM_PATH=<file> runs the same checks against another copy of the simulator (used by
// scripts/mutation-sim.mjs to prove these tests catch deliberate accounting errors).
// PARITY_RUNS=<n> sets the number of random scenarios (default 160).
const path = require("path");
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { U } = require("./helpers");
const { runOnChain } = require("./circleRunner");

const COVERS = [0, 2000, 3000, 4000, 5000, 10000];
const SIM = process.env.SIM_PATH ? path.resolve(process.env.SIM_PATH) : path.join(__dirname, "../app/src/sim.js");
const RUNS = Number(process.env.PARITY_RUNS || 160);
const MAX_CONTRIBUTION = 10n ** 15n;

function compareTraces(simTrace, chainTrace, label) {
  // the simulator snapshots a late catch-up before the round's contributions; the chain after.
  // Catch-up state does not depend on that order (contributions only touch roundFund and the
  // contributed flags), so compare catch-ups as a set per round and everything else in order.
  const strip = (t) => t.filter((s) => s.step !== "catchUp");
  const a = strip(simTrace);
  const b = strip(chainTrace);
  expect(a.length, `${label}: number of steps`).to.equal(b.length);
  for (let s = 0; s < a.length; s++) expect(a[s], `${label}: step ${s} (${a[s].step}, round ${a[s].round})`).to.deep.equal(b[s]);
  const cu = (t) => t.filter((s) => s.step === "catchUp").map((s) => ({ member: s.member, cost: s.cost, round: s.round }));
  const sortKey = (x) => x.round * 100 + x.member;
  expect(cu(simTrace).sort((x, y) => sortKey(x) - sortKey(y)), `${label}: catch-up costs`).to.deep.equal(cu(chainTrace).sort((x, y) => sortKey(x) - sortKey(y)));
}

describe("Simulator parity with the contract (state after every step)", function () {
  let simulate;
  before(async () => {
    ({ simulate } = await import(SIM));
  });

  async function check(p, label) {
    const sim = simulate(p);
    expect(sim.conserved, `${label}: simulator conserves money`).to.equal(true);
    const { trace: chain } = await runOnChain(p, label);
    compareTraces(sim.trace, chain, label);
    // and the catch-up states themselves, member by member (order-independent within a round)
    const simCu = sim.trace.filter((s) => s.step === "catchUp");
    const chainCu = chain.filter((s) => s.step === "catchUp");
    for (const sc of simCu) {
      const cc = chainCu.find((x) => x.member === sc.member && x.round === sc.round);
      expect(cc, `${label}: catch-up of seat ${sc.member + 1} happened on chain`).to.not.equal(undefined);
      expect(sc.members[sc.member], `${label}: seat ${sc.member + 1} after catching up`).to.deep.equal(cc.members[sc.member]);
    }
    return sim;
  }

  const base = { feeBps: 50, stopAt: [], catchUpAt: [], lateCatchUp: [] };
  const named = [
    ["normal completion", { n: 5, k: 5000 }],
    ["one member leaves before their payout", { n: 5, k: 3000, stopAt: [0, 0, 2] }],
    ["one member stops right after their payout", { n: 6, k: 2000, stopAt: [2] }],
    ["several members stop in different rounds", { n: 6, k: 4000, stopAt: [2, 4, 0, 5] }],
    ["several members stop in the same round", { n: 6, k: 5000, stopAt: [3, 3, 3] }],
    ["catch-up before settlement", { n: 5, k: 2000, stopAt: [2], catchUpAt: [4] }],
    ["catch-up after the deadline, before settlement", { n: 5, k: 2000, stopAt: [2], catchUpAt: [4], lateCatchUp: [true] }],
    ["reserve exhausted (0% cover, early seats walk)", { n: 6, k: 0, stopAt: [2, 3] }],
    ["finalize with unpaid entitlements", { n: 5, k: 0, stopAt: [2, 3] }],
    ["catch-up in the final cure window", { n: 5, k: 3000, stopAt: [3], catchUpAt: [6] }],
    ["several members catch up", { n: 6, k: 2000, stopAt: [2, 3], catchUpAt: [4, 5] }],
    ["everyone stops after their payout", { n: 4, k: 2000, stopAt: [2, 3, 4] }],
    ["12 members, 100% cover, seat 1 walks", { n: 12, k: 10000, stopAt: [2] }],
    ["2 members, 0% cover", { n: 2, k: 0, stopAt: [2] }],
    // a payout so short that the hold from the pot is cut short; a later repayment must top the
    // collateral up to the SEAT's amount (v9.2.1 fix), in one repayment or in several
    ["short payout, later repayment tops collateral up", { n: 5, c: 100_000_000n, k: 10000, feeBps: 100, stopAt: [0, 0, 1, 1, 1] }],
    ["short payout, repaid in two parts (catch-up, then settle)", { n: 6, c: 100_000_000n, k: 10000, feeBps: 100, stopAt: [2, 0, 1, 1, 1, 0], catchUpAt: [3] }],
  ];
  for (const fromPayout of [false, true]) {
    const mode = fromPayout ? "collateral from pot" : "upfront collateral";
    for (const [name, sc] of named) {
      it(`${name} (${mode})`, async function () {
        await check({ ...base, c: U(7), ...sc, fromPayout }, `${name} / ${mode}`);
      });
    }
  }

  it("token precision: 1 base unit, odd small amounts and the maximum contribution", async function () {
    this.timeout(0);
    // The contract never reads decimals: everything is base units. These cover rounding at the
    // smallest scale (collateral rounds up from fractions of a unit) and values at the bound.
    // With 6 decimals (QUSDC) the bound is 1e9 tokens; with 18 decimals it would be 0.001 token.
    const cases = [
      { n: 3, c: 1n, k: 2000, stopAt: [2] },
      { n: 12, c: 3n, k: 3000, stopAt: [2, 5], catchUpAt: [0, 8] },
      { n: 6, c: 7n, k: 4000, feeBps: 50, stopAt: [0, 0, 1] },
      { n: 12, c: MAX_CONTRIBUTION, k: 10000, stopAt: [2] },
      { n: 12, c: MAX_CONTRIBUTION - 1n, k: 3000, feeBps: 100, stopAt: [3, 0, 0, 2] },
      { n: 5, c: 1_234_567_891_234n, k: 5000, feeBps: 37, stopAt: [2], catchUpAt: [5], lateCatchUp: [true] },
    ];
    for (const fromPayout of [false, true]) {
      for (const sc of cases) await check({ ...base, feeBps: 0, ...sc, fromPayout }, `precision ${sc.c} / ${fromPayout}`);
    }
  });

  it(`random scenarios (${RUNS}): sizes 2-12, every cover, both collateral modes, fees, defaults, catch-ups`, async function () {
    this.timeout(0);
    let seed = 2026;
    const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    const sizes = [2, 3, 5, 6, 12];
    for (let run = 0; run < RUNS; run++) {
      const n = sizes[run % sizes.length];
      const k = COVERS[Math.floor(rand() * COVERS.length)];
      const unit = rand() < 0.2 ? 1n : 10n ** 6n; // some runs in raw base units
      const c = BigInt(1 + Math.floor(rand() * 200)) * unit;
      const feeBps = rand() < 0.5 ? 0 : [1, 50, 100][Math.floor(rand() * 3)];
      const stopAt = Array.from({ length: n }, () => (rand() < 0.45 ? 1 + Math.floor(rand() * n) : 0));
      const catchUpAt = stopAt.map((s, i) => (s > i + 1 && rand() < 0.4 ? s + 1 + Math.floor(rand() * (n + 1 - s)) : 0));
      const lateCatchUp = catchUpAt.map((x) => x > 0 && rand() < 0.3);
      const fromPayout = run % 2 === 1;
      await check({ n, c, k, feeBps, stopAt, catchUpAt, lateCatchUp, fromPayout }, `run ${run}: n=${n} k=${k} c=${c} fee=${feeBps} mode=${fromPayout} stopAt=${stopAt} catchUpAt=${catchUpAt} late=${lateCatchUp}`);
    }
  });
});
