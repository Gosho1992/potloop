// v9.2.1 regression: collateral held from pot money always targets the member's SEAT
// (collateralFor(seat)), never the round in which an old entitlement happens to be repaid.
// Every run also passes the rule checks R1–R3 in test/circleRunner.js after every transaction.
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { runOnChain } = require("./circleRunner");
const { deployCircle, acceptAll, playRound, checkLedgers, finishAndWithdraw } = require("./helpers");

const C = 100_000_000n; // 100 tokens (6 decimals)
// state right after round r is settled (the snapshot is labelled with the next round number)
const afterSettle = (trace, r) => trace.filter((s) => s.step === "settle")[r - 1];


describe("v9.2.1 — collateral restoration when old entitlements are repaid", function () {
  // 5 members, 100% cover, 1% fee. Seats 3-5 leave in round 1, so seat 2's pot in round 2 is short
  // and its 1% fee leaves too little to hold its full collateral; the shortfall is repaid in round 3.
  const A = { n: 5, c: C, k: 10000, feeBps: 100, stopAt: [0, 0, 1, 1, 1], catchUpAt: [] };

  it("A + B: a short payout leaves collateral below the seat's amount; the later repayment restores it to exactly that amount", async function () {
    const { trace, ctx } = await runOnChain({ ...A, fromPayout: true }, "A/B");
    const target = await ctx.circle.collateralFor(1); // seat 2: 3 later rounds x 100 = 300
    expect(target).to.equal(3n * C);
    const r2 = afterSettle(trace, 2).members[1];
    expect(r2.paidOut).to.equal(true);
    expect(r2.unpaidEntitlement).to.equal(3n * C); // paid 300 short: 3 members left in round 1
    expect(r2.collateral).to.equal(298n * 1_000_000n); // bond 100 + 198 held: the pot after fee ran out
    const r3 = afterSettle(trace, 3).members[1];
    expect(r3.unpaidEntitlement).to.equal(1n * C); // 200 repaid in round 3
    // restored to the seat's amount. The v9.2 rule targeted (5 - 3) x 100 = 200 here and left 298.
    expect(r3.collateral).to.equal(target);
    const r4 = afterSettle(trace, 4).members[1];
    expect(r4.unpaidEntitlement).to.equal(0n);
    expect(r4.collateral).to.equal(target); // the last 100 repaid is not held: already at target
  });

  it("C: repaid in two parts (a catch-up, then a settle), collateral is topped up step by step to exactly the seat's amount", async function () {
    const p = { n: 6, c: C, k: 10000, feeBps: 100, stopAt: [2, 0, 1, 1, 1, 0], catchUpAt: [3], fromPayout: true };
    const { trace, ctx } = await runOnChain(p, "C");
    const target = await ctx.circle.collateralFor(1); // 400
    const M = 1_000_000n;
    const s2 = afterSettle(trace, 2).members[1];
    expect(s2.collateral).to.equal(397n * M); // bond 100 + 297 held from a short pot
    expect(s2.unpaidEntitlement).to.equal(300n * M);
    const cu = trace.find((s) => s.step === "catchUp" && s.member === 0).members[1];
    expect(cu.unpaidEntitlement).to.equal(298n * M); // first part: 2 repaid
    expect(cu.collateral).to.equal(398_980_000n); // 2 − 1% fee = 1.98, all held
    expect(cu.withdrawable).to.equal(s2.withdrawable);
    const s3 = afterSettle(trace, 3).members[1];
    expect(s3.unpaidEntitlement).to.equal(0n); // second part: 298 repaid
    expect(s3.collateral).to.equal(target); // + 1.02 held: exactly 400, never above
    expect(s3.withdrawable - cu.withdrawable).to.equal(298n * M - 2_980_000n - 1_020_000n); // 298 − 2.98 fee − 1.02 held
    for (const st of trace) for (let i = 0; i < 6; i++) expect(st.members[i].collateral <= (await ctx.circle.collateralFor(i))).to.equal(true);
  });

  it("D: the same scenarios in upfront mode keep their v9.2 behaviour (no holds, full collateral from the start)", async function () {
    for (const p of [A, { n: 6, c: C, k: 10000, feeBps: 100, stopAt: [2, 0, 1, 1, 1, 0], catchUpAt: [3] }]) {
      const { trace, ctx } = await runOnChain({ ...p, fromPayout: false }, "D");
      const target = await ctx.circle.collateralFor(1);
      for (const st of trace.filter((s) => s.step !== "finalize")) expect(st.members[1].collateral).to.equal(target);
    }
    // and no CollateralHeldFromPot event can be emitted in upfront mode
    const ctx = await deployCircle({ n: 4, c: 10, k: 10000, fromPayout: false });
    await acceptAll(ctx);
    await playRound(ctx, [0, 1, 2, 3]);
    expect(await ctx.circle.queryFilter(ctx.circle.filters.CollateralHeldFromPot())).to.have.length(0);
  });

  it("E: the last seat never has collateral held; 0% cover never holds anything, even with short payouts and repayments", async function () {
    const ctx = await deployCircle({ n: 4, c: 10, k: 5000, fromPayout: true });
    await acceptAll(ctx);
    for (let r = 0; r < 4; r++) await playRound(ctx, [0, 1, 2, 3]);
    const held = await ctx.circle.queryFilter(ctx.circle.filters.CollateralHeldFromPot());
    expect(held.map((e) => e.args.member)).to.not.include(ctx.members[3].address);
    expect((await ctx.circle.member(3)).collateral).to.equal(await ctx.circle.upfrontCollateral(3));
    await finishAndWithdraw(ctx);

    const p = { n: 5, c: C, k: 0, feeBps: 100, stopAt: [2, 3], catchUpAt: [4, 0], fromPayout: true };
    const { trace, ctx: z } = await runOnChain(p, "E 0%");
    expect(await z.circle.queryFilter(z.circle.filters.CollateralHeldFromPot())).to.have.length(0);
    for (const st of trace) for (const m of st.members) expect(m.collateral).to.equal(0n);
    expect(trace.some((s) => s.members.some((m) => m.unpaidEntitlement > 0n)), "there were short payouts").to.equal(true);
  });

  it("nothing is held once a member has no scheduled payment left (last round already paid)", async function () {
    // seat 4 of 4 pays round 4 and is paid; a short entitlement repaid in round 4's settle is not held
    const ctx = await deployCircle({ n: 4, c: 100, k: 10000, fromPayout: true });
    await acceptAll(ctx);
    await playRound(ctx, [0, 1, 2, 3]);
    await playRound(ctx, [0, 1, 2, 3]);
    await playRound(ctx, [0, 1, 2, 3]);
    const before = (await ctx.circle.member(3)).collateral;
    await playRound(ctx, [0, 1, 2, 3]);
    expect((await ctx.circle.member(3)).collateral).to.equal(before);
    await checkLedgers(ctx);
  });
});

describe("v9.2.2 — rule R3 covers original payouts", function () {
  it("every original payout and every repayment goes through the R3 accounting check", async function () {
    // 5 members, 1% fee, 50% cover, collateral from the pot: 5 original payouts, no repayments
    const full = await runOnChain({ n: 5, c: C, k: 5000, feeBps: 100, stopAt: [], catchUpAt: [], fromPayout: true }, "R3 full");
    expect(full.checked.payouts).to.equal(5);
    // the short-payout scenario: 2 payouts (3 seats left before theirs) and later repayments
    const short = await runOnChain({ n: 5, c: C, k: 10000, feeBps: 100, stopAt: [0, 0, 1, 1, 1], catchUpAt: [], fromPayout: true }, "R3 short");
    expect(short.checked.payouts).to.equal(2);
    expect(short.checked.repayments > 0).to.equal(true);
  });
});

describe("v9.2.1 — circle deployer", function () {
  async function factory(minCover = 0) {
    const s = await ethers.getSigners();
    const token = await ethers.deployContract("MockUSD");
    const f = await ethers.deployContract("CircleFactory", [await token.getAddress(), s[9].address, 50, 60, 30, 1_000_000, minCover]);
    return { s, f, token };
  }

  it("the factory creates its own deployer, which only the factory can use", async function () {
    const { s, f, token } = await factory(10000);
    const d = await ethers.getContractAt("CircleDeployer", await f.deployer());
    expect(await d.factory()).to.equal(await f.getAddress());
    const cfg = {
      members: [s[1].address, s[2].address],
      token: await token.getAddress(),
      contribution: 1_000_000,
      coverageBps: 0, // below the factory's 100% minimum
      roundLength: 180,
      grace: 60,
      joinWindow: 600,
      organizer: s[0].address,
      treasury: s[9].address,
      feeBps: 0,
      registry: await f.getAddress(),
      collateralFromPayout: true,
    };
    await expect(d.deploy(cfg)).to.be.revertedWithCustomError(d, "NotFactory");
  });

  it("circles created through the factory are registered and point back to it", async function () {
    const { s, f } = await factory();
    await f.createCircle("deployer test", [s[1].address, s[2].address], 1_000_000, 10000, 180, 60, 600, true);
    const [addr] = await f.circlesPage(0, 1);
    expect(await f.isCircle(addr)).to.equal(true);
    const c = await ethers.getContractAt("SavingsCircle", addr);
    expect(await c.registry()).to.equal(await f.getAddress());
    expect(await c.organizer()).to.equal(s[0].address);
    expect(await c.collateralFromPayout()).to.equal(true);
  });

  it("runtime bytecode of every deployable contract stays at least 4 KB under the 24,576-byte limit", async function () {
    const LIMIT = 24576;
    for (const name of ["SavingsCircle", "CircleFactory", "CircleDeployer"]) {
      const a = await artifacts.readArtifact(name);
      const runtime = (a.deployedBytecode.length - 2) / 2;
      expect(runtime, `${name} runtime ${runtime}`).to.be.below(LIMIT - 4096);
    }
    // init code (the factory's includes the deployer's) must stay under EIP-3860's 49,152 bytes
    const fa = await artifacts.readArtifact("CircleFactory");
    expect((fa.bytecode.length - 2) / 2).to.be.below(49152);
  });
});
