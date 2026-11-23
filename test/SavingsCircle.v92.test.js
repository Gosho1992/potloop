// v9.2: collateral held back from the pot, factory rules in one read, minimum cover in both modes.
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const { U, ROUND, GRACE, JOIN, deployCircle, acceptAll, playRound, finishAndWithdraw, nets, checkLedgers } = require("./helpers");

describe("v9.2 — collateral held back from the pot", function () {
  it("joining costs at most one share (the smaller of the seat's collateral and one share); upfront mode is unchanged", async function () {
    const pot = await deployCircle({ n: 12, c: 1, k: 10000, fromPayout: true });
    const up = await deployCircle({ n: 12, c: 1, k: 10000, fromPayout: false });
    expect(await pot.circle.collateralFromPayout()).to.equal(true);
    expect(await up.circle.collateralFromPayout()).to.equal(false);
    for (let i = 0; i < 12; i++) {
      expect(await pot.circle.upfrontCollateral(i)).to.equal(U(1), `seat ${i + 1} bond`);
      expect(await up.circle.upfrontCollateral(i)).to.equal(await up.circle.collateralFor(i));
      // seatTerms still reports the full backing a seat ends up with after its payout
      const [required] = await pot.circle.seatTerms(i);
      expect(required).to.equal(await pot.circle.collateralFor(i));
    }
    expect(await up.circle.upfrontCollateral(0)).to.equal(U(11));
    await expect(pot.circle.upfrontCollateral(12)).to.be.revertedWithCustomError(pot.circle, "BadConfig");
  });

  it("at the payout, the pot tops collateral up to the full amount and the rest is paid out", async function () {
    const ctx = await deployCircle({ n: 6, c: 100, k: 10000, feeBps: 50, fromPayout: true });
    await acceptAll(ctx);
    const seat1 = ctx.members[0];
    expect((await ctx.circle.member(0)).collateral).to.equal(U(100));
    const tx = playRound(ctx, [0, 1, 2, 3, 4, 5]);
    await tx;
    // pot 600, fee 3, collateral target for 5 remaining rounds = 500, already 100 -> hold 400
    expect((await ctx.circle.member(0)).collateral).to.equal(U(500));
    expect(await ctx.circle.withdrawable(seat1.address)).to.equal(U(600) - U(3) - U(400));
    await checkLedgers(ctx);
  });

  it("emits CollateralHeldFromPot; seats whose collateral is at most one share lock it all and have nothing held", async function () {
    const ctx = await deployCircle({ n: 4, c: 10, k: 5000, fromPayout: true });
    await acceptAll(ctx);
    const addr = await ctx.circle.getAddress();
    // seat 1: collateral ceil(3 x 10 x 50%) = 15 > one share -> locks 10 to join, 5 held at its payout
    expect(await ctx.circle.upfrontCollateral(0)).to.equal(U(10));
    expect(await ctx.circle.upfrontCollateral(1)).to.equal(U(10)); // collateral 10 = one share: all upfront
    expect(await ctx.circle.upfrontCollateral(2)).to.equal(U(5));
    expect(await ctx.circle.upfrontCollateral(3)).to.equal(U(5));
    for (let i = 0; i < 4; i++) {
      await ctx.token.connect(ctx.members[i]).approve(addr, ctx.c);
      await ctx.circle.connect(ctx.members[i]).contribute();
    }
    await expect(ctx.circle.settle()).to.emit(ctx.circle, "CollateralHeldFromPot").withArgs(1, ctx.members[0].address, U(5));
    expect((await ctx.circle.member(0)).collateral).to.equal(U(15));
    await playRound(ctx, [0, 1, 2, 3]); // seat 2: already at its 10 -> hold 0
    expect((await ctx.circle.member(1)).collateral).to.equal(U(10));
    await playRound(ctx, [0, 1, 2, 3]); // seat 3: at its 5 -> hold 0
    expect((await ctx.circle.member(2)).collateral).to.equal(U(5));
    await playRound(ctx, [0, 1, 2, 3]); // seat 4: last round -> never held
    expect((await ctx.circle.member(3)).collateral).to.equal(U(5));
    await finishAndWithdraw(ctx);
    expect(await nets(ctx)).to.deep.equal([0, 0, 0, 0]);
  });

  it("a short payout at 20% cover: a seat whose collateral is under one share locked it all and has nothing held", async function () {
    const ctx = await deployCircle({ n: 5, c: 100, k: 2000, fromPayout: true });
    await acceptAll(ctx);
    await playRound(ctx, [0, 1, 2, 3, 4]);
    await playRound(ctx, [1, 2, 3, 4]); // seat 1 misses; its collateral (80) pays 80 of 100
    const m2 = await ctx.circle.member(1);
    expect(m2.unpaidEntitlement).to.equal(U(20));
    // seat 2's collateral ceil(3 x 100 x 20%) = 60 is under one share, so it was all locked to join:
    // nothing is held and the whole 480 credited is withdrawable
    expect(m2.collateral).to.equal(U(60));
    expect(await ctx.circle.withdrawable(ctx.members[1].address)).to.equal(U(480));
    await checkLedgers(ctx);
  });

  it("at 100% cover a member who walks away after the pot gains nothing and nobody loses", async function () {
    for (const seat of [0, 1, 2]) {
      const ctx = await deployCircle({ n: 6, c: 50, k: 10000, fromPayout: true });
      await acceptAll(ctx);
      for (let r = 1; r <= 6; r++) {
        const payers = [0, 1, 2, 3, 4, 5].filter((i) => !(i === seat && r > seat + 1));
        await playRound(ctx, payers);
      }
      await finishAndWithdraw(ctx);
      const n = await nets(ctx);
      expect(n.every((x) => x === 0), `seat ${seat + 1} walks: ${n}`).to.equal(true);
    }
  });

  it("leaving before the start returns the bond; a cancelled circle returns every bond", async function () {
    const ctx = await deployCircle({ n: 3, c: 100, k: 10000, fromPayout: true });
    const addr = await ctx.circle.getAddress();
    const [a, b] = ctx.members;
    await ctx.token.connect(a).approve(addr, U(100));
    await ctx.circle.connect(a).accept();
    await ctx.token.connect(b).approve(addr, U(100));
    await ctx.circle.connect(b).accept();
    await ctx.circle.connect(a).leave();
    expect(await ctx.circle.withdrawable(a.address)).to.equal(U(100));
    await checkLedgers(ctx);
    // the join window passes without everyone accepting: the circle is cancelled, bonds returned
    await time.increase(JOIN + 1);
    await ctx.circle.cancel();
    expect(await ctx.circle.withdrawable(b.address)).to.equal(U(100));
    await checkLedgers(ctx);
  });

  it("a catch-up with too little approved reverts and changes nothing", async function () {
    const ctx = await deployCircle({ n: 4, c: 100, k: 2000, fromPayout: true });
    await acceptAll(ctx);
    await playRound(ctx, [0, 1, 2, 3]);
    await playRound(ctx, [1, 2, 3]);
    const before = await ctx.circle.member(0);
    const reserve = await ctx.circle.freeReserve();
    const [total] = await ctx.circle.catchUpCost(0);
    await ctx.token.connect(ctx.members[0]).approve(await ctx.circle.getAddress(), total - 1n);
    await expect(ctx.circle.connect(ctx.members[0]).catchUp()).to.be.reverted;
    expect(await ctx.circle.member(0)).to.deep.equal(before);
    expect(await ctx.circle.freeReserve()).to.equal(reserve);
    await checkLedgers(ctx);
  });
});

describe("v9.2 — factory rules", function () {
  async function factory(minCover) {
    const s = await ethers.getSigners();
    const token = await ethers.deployContract("MockUSD");
    const f = await ethers.deployContract("CircleFactory", [await token.getAddress(), s[9].address, 50, 60, 30, U(1), minCover]);
    return { s, token, f };
  }

  it("rules() returns every creation rule and the interface version", async function () {
    const { s, token, f } = await factory(5000);
    const r = await f.rules();
    expect(r.token_).to.equal(await token.getAddress());
    expect(r.treasury_).to.equal(s[9].address);
    expect(r.feeBps_).to.equal(50n);
    expect(r.minRoundLength_).to.equal(60n);
    expect(r.minGrace_).to.equal(30n);
    expect(r.minContribution_).to.equal(U(1));
    expect(r.minCoverageBps_).to.equal(5000n);
    expect(r.version_).to.equal(92n);
    expect(await f.FACTORY_VERSION()).to.equal(92n);
  });

  it("enforces the minimum cover in both collateral modes and passes the mode to the circle", async function () {
    const { s, f } = await factory(10000);
    const two = [s[1].address, s[2].address];
    for (const mode of [false, true]) {
      for (const k of [0, 2000, 3000, 4000, 5000]) {
        await expect(f.createCircle("x", two, U(1), k, ROUND, GRACE, JOIN, mode)).to.be.revertedWithCustomError(f, "BadConfig");
      }
      await f.createCircle(`ok ${mode}`, two, U(1), 10000, ROUND, GRACE, JOIN, mode);
    }
    const list = await f.circlesPage(0, 10);
    expect(list.length).to.equal(2);
    for (const a of list) {
      const mode = (await f.nameOf(a)) === "ok true";
      expect(await (await ethers.getContractAt("SavingsCircle", a)).collateralFromPayout()).to.equal(mode);
    }
  });

  it("the factory's own circles are the only ones the app trusts; a circle deployed directly has no factory record", async function () {
    // SavingsCircle can be deployed without the factory (with any cover). The minimum is a factory
    // rule: the app only shows circles the configured factory created (isCircle), so such a
    // circle is flagged as not genuine instead of being trusted.
    const { f } = await factory(10000);
    const ctx = await deployCircle({ n: 2, c: 1, k: 0 });
    expect(await f.isCircle(await ctx.circle.getAddress())).to.equal(false);
  });
});
