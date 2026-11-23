const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const { cfg, U, ROUND, GRACE, JOIN, deployCircle, acceptAll, playRound, finishAndWithdraw, nets, catchUp, passCureWindow, checkLedgers } = require("./helpers");

const ALL = [0, 1, 2, 3, 4];
const without = (...out) => ALL.filter((i) => !out.includes(i));

describe("SavingsCircle — spec v3 worked examples", function () {
  it("collateral by slot at 50%: 200 / 150 / 100 / 50 / 50 (last slot locks one share too)", async function () {
    const ctx = await deployCircle();
    const cols = [];
    for (let i = 0; i < 5; i++) cols.push(await ctx.circle.collateralFor(i));
    expect(cols).to.deep.equal([U(200), U(150), U(100), U(50), U(50)]);
  });

  it("honest cycle: everyone ends even, all collateral returned", async function () {
    const ctx = await deployCircle();
    await acceptAll(ctx);
    for (let r = 1; r <= 5; r++) await playRound(ctx, ALL);
    await finishAndWithdraw(ctx);
    expect(await nets(ctx)).to.deep.equal([0, 0, 0, 0, 0]);
  });

  it("risk meter matches the spec table in an honest cycle", async function () {
    const ctx = await deployCircle();
    await acceptAll(ctx);
    const expected = [
      [400, 200], // after round 1: still owed, secured
      [600, 350],
      [600, 450],
      [400, 350],
      [0, 0],
    ];
    for (let r = 0; r < 5; r++) {
      await playRound(ctx, ALL);
      const risk = await ctx.circle.risk();
      expect(risk.stillOwed).to.equal(U(expected[r][0]), `still owed after round ${r + 1}`);
      expect(risk.secured).to.equal(U(expected[r][1]), `secured after round ${r + 1}`);
      expect(risk.netUncovered).to.equal(U(expected[r][0] - expected[r][1]));
    }
  });

  it("post-payout default: A takes the pot and stops; D and E lose 100 each", async function () {
    const ctx = await deployCircle();
    await acceptAll(ctx);
    await playRound(ctx, ALL); // A paid 500
    // before A stops paying, the meter shows A could cost the group 200
    expect((await ctx.circle.memberExposure(0)).uncovered).to.equal(U(200));
    for (let r = 2; r <= 5; r++) await playRound(ctx, without(0));
    expect((await ctx.circle.member(3)).unpaidEntitlement).to.equal(U(100));
    await finishAndWithdraw(ctx);
    expect(await nets(ctx)).to.deep.equal([200, 0, 0, -100, -100]);
    expect((await ctx.circle.member(3)).recordedLoss).to.equal(U(100));
    expect((await ctx.circle.member(4)).recordedLoss).to.equal(U(100));
  });

  it("post-payout default late: A misses only rounds 4–5, collateral covers it all", async function () {
    const ctx = await deployCircle();
    await acceptAll(ctx);
    for (let r = 1; r <= 3; r++) await playRound(ctx, ALL);
    for (let r = 4; r <= 5; r++) await playRound(ctx, without(0));
    await finishAndWithdraw(ctx);
    expect(await nets(ctx)).to.deep.equal([0, 0, 0, 0, 0]);
  });

  it("pre-payout default: C stops in round 2; C forfeits one share (100), honest members split it", async function () {
    const ctx = await deployCircle();
    await acceptAll(ctx);
    await playRound(ctx, ALL);
    await expect(playRound(ctx, without(2))).to.not.be.reverted;
    expect((await ctx.circle.member(2)).refundClaim).to.equal(U(100)); // paid 100 + collateral 100 - penalty 100
    for (let r = 3; r <= 5; r++) await playRound(ctx, without(2));
    await finishAndWithdraw(ctx);
    expect(await nets(ctx)).to.deep.equal([25, 25, -100, 25, 25]);
    expect((await ctx.circle.member(2)).refundPaid).to.equal(U(100));
  });

  it("recipient misses their own round: C pays rounds 1–2, misses 3, gets no pot", async function () {
    const ctx = await deployCircle();
    await acceptAll(ctx);
    await playRound(ctx, ALL);
    await playRound(ctx, ALL);
    await playRound(ctx, without(2)); // C's own round
    const c = await ctx.circle.member(2);
    expect(c.paidOut).to.equal(false);
    expect(c.status).to.equal(1n); // PrePayoutDefault
    for (let r = 4; r <= 5; r++) await playRound(ctx, without(2));
    await finishAndWithdraw(ctx);
    // C paid 200 + locked 100, forfeits one share; honest members split the 100
    expect(await nets(ctx)).to.deep.equal([25, 25, -100, 25, 25]);
    expect((await ctx.circle.member(2)).refundPaid).to.equal(U(200));
  });

  it("last slot: E stops in round 2; E's 50 collateral helps B at once, B, C, D are repaid in round 5", async function () {
    const ctx = await deployCircle();
    await acceptAll(ctx);
    await playRound(ctx, ALL);
    await playRound(ctx, without(4));
    expect((await ctx.circle.member(1)).unpaidEntitlement).to.equal(U(50));
    await playRound(ctx, without(4));
    await playRound(ctx, without(4));
    expect((await ctx.circle.member(3)).unpaidEntitlement).to.equal(U(100));
    await playRound(ctx, without(4)); // E's vacated round repays B, C, D
    for (const i of [1, 2, 3]) expect((await ctx.circle.member(i)).unpaidEntitlement).to.equal(0n);
    await finishAndWithdraw(ctx);
    expect(await nets(ctx)).to.deep.equal([25, 25, 25, 25, -100]);
    expect((await ctx.circle.member(4)).refundPaid).to.equal(U(50));
  });

  it("two pre-payout defaults (C and E): each forfeits one share, honest members gain, nobody honest loses", async function () {
    const ctx = await deployCircle();
    await acceptAll(ctx);
    await playRound(ctx, ALL);
    for (let r = 2; r <= 5; r++) await playRound(ctx, without(2, 4));
    await finishAndWithdraw(ctx);
    const n = await nets(ctx);
    expect(n[2]).to.equal(-100);
    expect(n[4]).to.equal(-100);
    for (const i of [0, 1, 3]) expect(n[i]).to.be.closeTo(66.67, 0.01);
  });

  it("mixed: A defaults after payout, C before; B, D, E even, A +200, C −200", async function () {
    const ctx = await deployCircle();
    await acceptAll(ctx);
    await playRound(ctx, ALL);
    for (let r = 2; r <= 5; r++) await playRound(ctx, without(0, 2));
    await finishAndWithdraw(ctx);
    expect(await nets(ctx)).to.deep.equal([200, 0, -200, 0, 0]);
  });

  it("four of five leave early: no stuck funds, the honest member collects their four penalties", async function () {
    const ctx = await deployCircle();
    await acceptAll(ctx);
    await playRound(ctx, ALL);
    for (let r = 2; r <= 5; r++) await playRound(ctx, [0]);
    await finishAndWithdraw(ctx);
    const n = await nets(ctx);
    expect(n[0]).to.equal(400); // four leavers forfeit one share each
    expect(n.slice(1)).to.deep.equal([-100, -100, -100, -100]);
    expect(n.reduce((a, b) => a + b, 0)).to.equal(0);
  });

  it("0% coverage: A takes the pot and stops; every later recipient loses 100", async function () {
    const ctx = await deployCircle({ k: 0 });
    await acceptAll(ctx);
    await playRound(ctx, ALL);
    expect((await ctx.circle.risk()).netUncovered).to.equal(U(400));
    for (let r = 2; r <= 5; r++) await playRound(ctx, without(0));
    await finishAndWithdraw(ctx);
    expect(await nets(ctx)).to.deep.equal([400, -100, -100, -100, -100]);
  });

  it("100% coverage: A takes the pot and stops; nobody loses anything", async function () {
    const ctx = await deployCircle({ k: 10000 });
    await acceptAll(ctx);
    await playRound(ctx, ALL);
    expect((await ctx.circle.risk()).netUncovered).to.equal(0n);
    for (let r = 2; r <= 5; r++) await playRound(ctx, without(0));
    await finishAndWithdraw(ctx);
    expect(await nets(ctx)).to.deep.equal([0, 0, 0, 0, 0]);
  });
});

describe("SavingsCircle — safety checks", function () {
  it("rejects bad setups: duplicate member, zero address, unsupported coverage", async function () {
    const [, a, b] = await ethers.getSigners();
    const token = await ethers.deployContract("MockUSD");
    const t = await token.getAddress();
    const F = await ethers.getContractFactory("SavingsCircle");
    await expect(F.deploy(cfg([a.address, a.address], t))).to.be.revertedWithCustomError(F, "BadConfig");
    await expect(F.deploy(cfg([a.address, ethers.ZeroAddress], t))).to.be.revertedWithCustomError(F, "BadConfig");
    await expect(F.deploy(cfg([a.address, b.address], t, { k: 2500 }))).to.be.revertedWithCustomError(F, "BadConfig");
    await expect(F.deploy(cfg([a.address, b.address], t, { grace: 0 }))).to.be.revertedWithCustomError(F, "BadConfig");
    await expect(F.deploy(cfg([a.address, b.address], t, { feeBps: 101, treasury: b.address }))).to.be.revertedWithCustomError(F, "BadConfig");
    await expect(F.deploy(cfg([a.address, b.address], t, { feeBps: 50 }))).to.be.revertedWithCustomError(F, "BadConfig");
  });

  it("only the assigned address can accept a slot, and only once", async function () {
    const ctx = await deployCircle();
    const [outsider] = await ethers.getSigners();
    await expect(ctx.circle.connect(outsider).accept()).to.be.revertedWithCustomError(ctx.circle, "NotMember");
    await ctx.token.connect(ctx.members[4]).approve(await ctx.circle.getAddress(), U(50));
    await ctx.circle.connect(ctx.members[4]).accept(); // slot 5
    await expect(ctx.circle.connect(ctx.members[4]).accept()).to.be.revertedWithCustomError(ctx.circle, "AlreadyAccepted");
  });

  it("no double contribution in a round", async function () {
    const ctx = await deployCircle();
    await acceptAll(ctx);
    const addr = await ctx.circle.getAddress();
    await ctx.token.connect(ctx.members[0]).approve(addr, ctx.c * 2n);
    await ctx.circle.connect(ctx.members[0]).contribute();
    await expect(ctx.circle.connect(ctx.members[0]).contribute()).to.be.revertedWithCustomError(ctx.circle, "AlreadyContributed");
  });

  it("settle cannot run early or twice for the same round", async function () {
    const ctx = await deployCircle();
    await acceptAll(ctx);
    await expect(ctx.circle.settle()).to.be.revertedWithCustomError(ctx.circle, "TooEarlyToSettle");
    await playRound(ctx, ALL);
    expect(await ctx.circle.currentRound()).to.equal(2n);
    await expect(ctx.circle.settle()).to.be.revertedWithCustomError(ctx.circle, "TooEarlyToSettle");
  });

  it("no payment after deadline + grace, and a member who left before their payout cannot pay again", async function () {
    const ctx = await deployCircle();
    await acceptAll(ctx);
    await time.increase(ROUND + GRACE + 1);
    const addr = await ctx.circle.getAddress();
    await ctx.token.connect(ctx.members[0]).approve(addr, ctx.c);
    await expect(ctx.circle.connect(ctx.members[0]).contribute()).to.be.revertedWithCustomError(ctx.circle, "ContributionWindowClosed");
    await ctx.circle.settle(); // everyone missed round 1
    await expect(ctx.circle.connect(ctx.members[0]).contribute()).to.be.revertedWithCustomError(ctx.circle, "MemberDefaulted");
  });

  it("collateral cannot be withdrawn before the end", async function () {
    const ctx = await deployCircle();
    await acceptAll(ctx);
    await expect(ctx.circle.connect(ctx.members[0]).withdraw()).to.be.revertedWithCustomError(ctx.circle, "NothingToWithdraw");
    await expect(ctx.circle.finalize()).to.be.revertedWithCustomError(ctx.circle, "RoundsNotDone");
  });

  it("a short-changing token is rejected at accept", async function () {
    const ctx = await deployCircle({ tokenKind: "FeeOnTransferUSD" });
    const addr = await ctx.circle.getAddress();
    await ctx.token.connect(ctx.members[0]).approve(addr, U(200));
    await expect(ctx.circle.connect(ctx.members[0]).accept()).to.be.revertedWithCustomError(ctx.circle, "TransferAmountMismatch");
  });

  it("join window ends unfilled: anyone cancels, every deposit comes back", async function () {
    const ctx = await deployCircle();
    const addr = await ctx.circle.getAddress();
    for (let i = 0; i < 4; i++) {
      const col = await ctx.circle.collateralFor(i);
      if (col > 0n) await ctx.token.connect(ctx.members[i]).approve(addr, col);
      await ctx.circle.connect(ctx.members[i]).accept();
    }
    await expect(ctx.circle.cancel()).to.be.revertedWithCustomError(ctx.circle, "JoinWindowOpen");
    await time.increase(JOIN + 1);
    const [outsider] = await ethers.getSigners();
    await ctx.circle.connect(outsider).cancel();
    for (let i = 0; i < 4; i++) {
      if ((await ctx.circle.withdrawable(ctx.members[i].address)) > 0n) await ctx.circle.connect(ctx.members[i]).withdraw();
    }
    expect(await nets(ctx)).to.deep.equal([0, 0, 0, 0, 0]);
    expect(await ctx.token.balanceOf(addr)).to.equal(0n);
  });

  it("the organizer has no special powers", async function () {
    const ctx = await deployCircle();
    await acceptAll(ctx);
    await expect(ctx.circle.connect(ctx.organizer).contribute()).to.be.revertedWithCustomError(ctx.circle, "NotMember");
    await expect(ctx.circle.connect(ctx.organizer).withdraw()).to.be.revertedWithCustomError(ctx.circle, "NothingToWithdraw");
  });
});

describe("SavingsCircle — v3 review fixes", function () {
  it("oldest first: money freed in round 3 repays B before C (this round's recipient) draws on it", async function () {
    const ctx = await deployCircle();
    await acceptAll(ctx);
    await playRound(ctx, ALL);
    await playRound(ctx, without(4)); // E leaves: 50 to reserve, B short 50
    expect((await ctx.circle.member(1)).unpaidEntitlement).to.equal(U(50));
    await playRound(ctx, without(3, 4)); // D leaves: D's 50 collateral goes to B first
    expect((await ctx.circle.member(1)).unpaidEntitlement).to.equal(0n);
    expect((await ctx.circle.member(2)).unpaidEntitlement).to.equal(U(200));
    for (let r = 4; r <= 5; r++) await playRound(ctx, without(3, 4));
    await finishAndWithdraw(ctx);
  });

  it("netting: a recipient who was shorted and then stops paying is not repaid ahead of honest members", async function () {
    const ctx = await deployCircle();
    await acceptAll(ctx);
    await playRound(ctx, without(4)); // E leaves in round 1: A is shorted 50
    expect((await ctx.circle.member(0)).unpaidEntitlement).to.equal(U(50));
    for (let r = 2; r <= 5; r++) await playRound(ctx, without(0, 4)); // A stops after payout
    expect((await ctx.circle.member(0)).unpaidEntitlement).to.equal(U(50), "never repaid while defaulted");
    await passCureWindow(ctx);
    await expect(ctx.circle.finalize()).to.emit(ctx.circle, "EntitlementNetted");
    expect((await ctx.circle.member(0)).unpaidEntitlement).to.equal(0n);
  });

  it("catch-up: A misses round 2 after payout, then pays again; collateral is drawn only once", async function () {
    const ctx = await deployCircle();
    await acceptAll(ctx);
    await playRound(ctx, ALL);
    await playRound(ctx, without(0));
    expect((await ctx.circle.member(0)).status).to.equal(2n); // PostPayoutDefault
    for (let r = 3; r <= 5; r++) await playRound(ctx, ALL); // A resumes paying
    const a = await ctx.circle.member(0);
    expect(a.collateralUsed).to.equal(U(100));
    expect(a.collateral).to.equal(U(100));
    await finishAndWithdraw(ctx);
    expect(await nets(ctx)).to.deep.equal([0, 0, 0, 0, 0]);
  });

  it("service fee: 0.5% of each pot goes to the treasury", async function () {
    const ctx = await deployCircle({ feeBps: 50 });
    await acceptAll(ctx);
    for (let r = 1; r <= 5; r++) await playRound(ctx, ALL);
    await ctx.circle.finalize();
    expect(await ctx.circle.withdrawable(ctx.treasury)).to.equal(U(12.5));
    const [, , , , , , treasurySigner] = await ethers.getSigners();
    await ctx.circle.connect(treasurySigner).withdraw();
    for (const m of ctx.members) await ctx.circle.connect(m).withdraw();
    expect(await ctx.token.balanceOf(await ctx.circle.getAddress())).to.equal(0n);
    expect(await nets(ctx)).to.deep.equal([-2.5, -2.5, -2.5, -2.5, -2.5]);
  });

  it("tokens sent straight to the contract can be swept into the reserve and end up with honest members", async function () {
    const ctx = await deployCircle();
    await acceptAll(ctx);
    const addr = await ctx.circle.getAddress();
    await ctx.token.connect(ctx.members[0]).transfer(addr, U(10));
    expect(await ctx.circle.accountedBalance()).to.equal((await ctx.token.balanceOf(addr)) - U(10));
    await ctx.circle.sweepSurplus();
    await expect(ctx.circle.sweepSurplus()).to.be.revertedWithCustomError(ctx.circle, "NothingToWithdraw");
    for (let r = 1; r <= 5; r++) await playRound(ctx, ALL);
    await finishAndWithdraw(ctx);
    expect(await nets(ctx)).to.deep.equal([-8, 2, 2, 2, 2]);
  });
});

describe("CircleFactory", function () {
  async function setup(feeBps = 50) {
    const s = await ethers.getSigners();
    const token = await ethers.deployContract("MockUSD");
    const factory = await ethers.deployContract("CircleFactory", [await token.getAddress(), s[9].address, feeBps, 60, 30, U(1), 0]);
    const members = s.slice(1, 4);
    for (const m of members) await token.mint(m.address, U(10000));
    return { s, token, factory, members };
  }

  it("creates a listed circle; invited members are only indexed once they accept", async function () {
    const { s, token, factory, members } = await setup();
    const tx = await factory.connect(s[0]).createCircle("Office committee", members.map((m) => m.address), U(100), 5000, ROUND, GRACE, JOIN, false);
    await expect(tx).to.emit(factory, "CircleCreated");
    await expect(tx).to.emit(factory, "Invited");
    const [addr] = await factory.circlesPage(0, 10);
    expect(await factory.isCircle(addr)).to.equal(true);
    expect(await factory.nameOf(addr)).to.equal("Office committee");
    expect(await factory.joinedCount(members[1].address)).to.equal(0n, "invitation alone does not index");
    const circle = await ethers.getContractAt("SavingsCircle", addr);
    expect(await circle.organizer()).to.equal(s[0].address);
    await token.connect(members[1]).approve(addr, await circle.collateralFor(1));
    await circle.connect(members[1]).accept();
    expect(await factory.joinedPage(members[1].address, 0, 10)).to.deep.equal([addr]);
  });

  it("only its own circles can write; bad setups, tiny amounts, short rounds and control characters are rejected", async function () {
    const { s, token, factory } = await setup();
    const two = [s[1].address, s[2].address];
    await expect(factory.recordJoin(s[1].address)).to.be.revertedWithCustomError(factory, "NotACircle");
    await expect(factory.recordCircle(s[1].address)).to.be.revertedWithCustomError(factory, "NotACircle");
    await expect(factory.createCircle("", two, U(1), 0, ROUND, GRACE, JOIN, false)).to.be.revertedWithCustomError(factory, "BadConfig");
    await expect(factory.createCircle("a\nb", two, U(1), 0, ROUND, GRACE, JOIN, false)).to.be.revertedWithCustomError(factory, "BadConfig");
    await expect(factory.createCircle("x", two, U(0.5), 0, ROUND, GRACE, JOIN, false)).to.be.revertedWithCustomError(factory, "BadConfig");
    await expect(factory.createCircle("x", two, U(1), 0, 59, GRACE, JOIN, false)).to.be.revertedWithCustomError(factory, "BadConfig");
    await expect(factory.createCircle("x", two, U(1), 0, ROUND, 29, JOIN, false)).to.be.revertedWithCustomError(factory, "BadConfig");
    const F = await ethers.getContractFactory("CircleFactory");
    await expect(F.deploy(await token.getAddress(), s[9].address, 101, 60, 30, 1, 0)).to.be.revertedWithCustomError(F, "BadConfig");
    await expect(F.deploy(s[5].address, s[9].address, 0, 60, 30, 1, 0)).to.be.revertedWithCustomError(F, "BadConfig"); // not a contract
    await expect(F.deploy(await token.getAddress(), s[9].address, 0, 60, 30, 1, 10001)).to.be.revertedWithCustomError(F, "BadConfig");
  });

  it("a production factory (1-day rounds) refuses the 1-second trap circle", async function () {
    const s = await ethers.getSigners();
    const token = await ethers.deployContract("MockUSD");
    const factory = await ethers.deployContract("CircleFactory", [await token.getAddress(), s[9].address, 50, 86400, 43200, U(1), 0]);
    await expect(factory.createCircle("trap", [s[1].address, s[2].address], U(100), 10000, 60, 30, JOIN, false)).to.be.revertedWithCustomError(factory, "BadConfig");
  });

  it("a factory with a minimum cover refuses circles below it (no member can profit from walking away)", async function () {
    const s = await ethers.getSigners();
    const token = await ethers.deployContract("MockUSD");
    const factory = await ethers.deployContract("CircleFactory", [await token.getAddress(), s[9].address, 50, 60, 30, U(1), 10000]);
    const two = [s[1].address, s[2].address];
    await expect(factory.createCircle("low", two, U(1), 5000, ROUND, GRACE, JOIN, false)).to.be.revertedWithCustomError(factory, "BadConfig");
    await factory.createCircle("full", two, U(1), 10000, ROUND, GRACE, JOIN, false);
    expect(await factory.minCoverageBps()).to.equal(10000n);
  });

  it("paging is newest first and never overflows on a huge limit", async function () {
    const { s, factory } = await setup();
    for (let i = 0; i < 3; i++) await factory.createCircle(`c${i}`, [s[1].address, s[2].address], U(1), 0, ROUND, GRACE, JOIN, false);
    const all = await factory.circlesPage(0, ethers.MaxUint256);
    expect(all.length).to.equal(3);
    expect(await factory.nameOf(all[0])).to.equal("c2");
    expect((await factory.circlesPage(2, 5)).length).to.equal(1);
    expect((await factory.circlesPage(5, 5)).length).to.equal(0);
  });
});

describe("SavingsCircle — v4 adversarial cases (second review)", function () {
  const approveAndCatchUp = catchUp;

  it("paid short, then misses, then catches up: back in good standing, still repaid what it is owed, collateral returned", async function () {
    const ctx = await deployCircle();
    await acceptAll(ctx);
    await playRound(ctx, without(4)); // E leaves in round 1: A is paid 50 short
    expect((await ctx.circle.member(0)).unpaidEntitlement).to.equal(U(50));
    await playRound(ctx, without(0, 4)); // A misses round 2: 100 of A's collateral pays for A
    expect((await ctx.circle.member(0)).status).to.equal(2n);
    const [restore, uncovered] = await ctx.circle.arrearsOf(0);
    expect(restore).to.equal(U(100));
    expect(uncovered).to.equal(0n);
    await approveAndCatchUp(ctx, 0);
    const a = await ctx.circle.member(0);
    expect(a.status).to.equal(0n); // Good again
    expect(a.missedRounds).to.equal(1n); // history kept
    expect(a.collateral).to.equal(U(200)); // refilled
    for (let r = 3; r <= 5; r++) await playRound(ctx, without(4));
    expect((await ctx.circle.member(0)).unpaidEntitlement).to.equal(0n, "repaid with normal priority");
    await finishAndWithdraw(ctx);
    const n = await nets(ctx);
    // E paid nothing and locked 50: that 50 is E's penalty. A also paid a 2% late fee on the 100
    // refilled (2). Both are shared by the four who finished in good standing (A included): 13 each.
    expect(n).to.deep.equal([11, 13, 13, 13, -50]);
  });

  it("catch-up after collateral ran out: the uncovered share goes to the reserve and repays whoever was shorted", async function () {
    const ctx = await deployCircle({ k: 2000 }); // A locks 80
    await acceptAll(ctx);
    await playRound(ctx, ALL);
    await playRound(ctx, without(0)); // 80 collateral: 80 used, B short 20
    await playRound(ctx, without(0)); // nothing left: C short 100
    expect((await ctx.circle.member(2)).unpaidEntitlement).to.equal(U(100));
    const [restore, uncovered] = await ctx.circle.arrearsOf(0);
    expect(restore).to.equal(U(80));
    expect(uncovered).to.equal(U(120));
    await approveAndCatchUp(ctx, 0); // 80 refill + 120 uncovered + round 4 (100) + 2% late fee on 200 (4)
    expect((await ctx.circle.member(1)).unpaidEntitlement).to.equal(0n);
    expect((await ctx.circle.member(2)).unpaidEntitlement).to.equal(0n);
    for (let r = 4; r <= 5; r++) await playRound(ctx, ALL);
    await finishAndWithdraw(ctx);
    expect(await nets(ctx)).to.deep.equal([-3.2, 0.8, 0.8, 0.8, 0.8]); // the late fee is shared by everyone in good standing
  });

  it("the factory records four outcomes and volume, only via recordCircle after the circle is finished", async function () {
    const s = await ethers.getSigners();
    const token = await ethers.deployContract("MockUSD");
    const factory = await ethers.deployContract("CircleFactory", [await token.getAddress(), s[9].address, 0, 60, 30, 1, 0]);
    const m = s.slice(1, 5);
    for (const x of m) await token.mint(x.address, U(10000));
    await factory.createCircle("t", m.map((x) => x.address), U(100), 10000, ROUND, GRACE, JOIN, false);
    const [addr] = await factory.circlesPage(0, 10);
    const circle = await ethers.getContractAt("SavingsCircle", addr);
    for (let i = 0; i < 4; i++) {
      await token.connect(m[i]).approve(addr, await circle.collateralFor(i));
      await circle.connect(m[i]).accept();
    }
    const ctx = { circle, token, members: m, c: U(100), n: 4, round: ROUND, grace: GRACE };
    await playRound(ctx, [0, 1, 2]); // seat 4 leaves before its turn
    await playRound(ctx, [1, 2]); // seat 1 stops after its turn
    await catchUp(ctx, 0); // ...and catches up
    await playRound(ctx, [0, 2]); // seat 2 stops after its turn and never comes back
    await playRound(ctx, [0, 2]);
    await expect(factory.recordCircle(addr)).to.be.revertedWithCustomError(factory, "NotFinished");
    await passCureWindow(ctx);
    await circle.finalize();
    await factory.recordCircle(addr);
    await expect(factory.recordCircle(addr)).to.be.revertedWithCustomError(factory, "AlreadyRecorded");
    const h = async (i) => { const x = await factory.history(m[i].address); return [x.completed, x.caughtUp, x.leftEarly, x.walkedAway]; };
    expect(await h(0)).to.deep.equal([0n, 1n, 0n, 0n]);
    expect(await h(1)).to.deep.equal([0n, 0n, 0n, 1n]);
    expect(await h(2)).to.deep.equal([1n, 0n, 0n, 0n]);
    expect(await h(3)).to.deep.equal([0n, 0n, 1n, 0n]);
    expect((await factory.history(m[2].address)).volume).to.equal(U(400));
    expect((await factory.history(m[1].address)).volume).to.equal(0n);
  });

  it("someone who is not behind cannot use catchUp", async function () {
    const ctx = await deployCircle();
    await acceptAll(ctx);
    await expect(ctx.circle.connect(ctx.members[0]).catchUp()).to.be.revertedWithCustomError(ctx.circle, "NotBehind");
  });

  it("penalty is capped by what the leaver has in: at 20% cover the last seat leaving at once forfeits its 20 collateral", async function () {
    const ctx = await deployCircle({ k: 2000 });
    await acceptAll(ctx);
    await playRound(ctx, without(4));
    expect(await ctx.circle.penaltyPaid(4)).to.equal(U(20));
    expect((await ctx.circle.member(4)).refundClaim).to.equal(0n);
    for (let r = 2; r <= 5; r++) await playRound(ctx, without(4));
    await finishAndWithdraw(ctx);
    const n = await nets(ctx);
    expect(n[4]).to.equal(-20);
    for (let i = 0; i < 4; i++) expect(n[i]).to.equal(5);
  });

  it("tokens sent during joining: swept to the reserve, and shared equally if the circle is cancelled", async function () {
    const ctx = await deployCircle();
    const addr = await ctx.circle.getAddress();
    await ctx.token.connect(ctx.members[0]).approve(addr, U(200));
    await ctx.circle.connect(ctx.members[0]).accept();
    await ctx.token.connect(ctx.members[1]).transfer(addr, U(50));
    await ctx.circle.sweepSurplus();
    expect(await ctx.circle.freeReserve()).to.equal(U(50));
    await time.increase(JOIN + 1);
    await ctx.circle.cancel();
    for (const m of ctx.members) if ((await ctx.circle.withdrawable(m.address)) > 0n) await ctx.circle.connect(m).withdraw();
    expect(await ctx.token.balanceOf(addr)).to.equal(0n);
    expect(await nets(ctx)).to.deep.equal([10, -40, 10, 10, 10]);
  });

  it("tokens sent after the last round and after finishing are never stranded", async function () {
    const ctx = await deployCircle();
    await acceptAll(ctx);
    const addr = await ctx.circle.getAddress();
    for (let r = 1; r <= 5; r++) await playRound(ctx, ALL);
    await ctx.token.connect(ctx.members[0]).transfer(addr, U(5)); // after the last settle
    await ctx.circle.sweepSurplus();
    await ctx.circle.finalize();
    await ctx.token.connect(ctx.members[0]).transfer(addr, U(5)); // after finishing
    await ctx.circle.sweepSurplus();
    for (const m of ctx.members) await ctx.circle.connect(m).withdraw();
    expect(await ctx.token.balanceOf(addr)).to.equal(0n);
    expect(await nets(ctx)).to.deep.equal([-8, 2, 2, 2, 2]);
  });

  it("two members stop after their turns: losses fall only on the later recipients, and every token is accounted for", async function () {
    const ctx = await deployCircle(); // collateral 200, 150, ...
    await acceptAll(ctx);
    await playRound(ctx, ALL);
    await playRound(ctx, without(0)); // A stops
    for (let r = 3; r <= 5; r++) await playRound(ctx, without(0, 1)); // B stops too
    await finishAndWithdraw(ctx);
    const n = await nets(ctx);
    expect(n.reduce((a, b) => a + b, 0)).to.be.closeTo(0, 1e-6);
    const losses = [];
    for (let i = 0; i < 5; i++) losses.push(Number(ethers.formatUnits((await ctx.circle.member(i)).recordedLoss, 6)));
    for (const i of [2, 3, 4]) expect(n[i]).to.be.closeTo(-losses[i], 1e-6);
    expect(n[0]).to.be.greaterThan(0); // A took more than A paid: exactly what the losses fund
  });

  it("three members stop after their turns at 20% cover: reserve runs dry, no collateral or claim is counted twice", async function () {
    const ctx = await deployCircle({ k: 2000 });
    await acceptAll(ctx);
    await playRound(ctx, ALL);
    await playRound(ctx, without(0));
    await playRound(ctx, without(0, 1));
    for (let r = 4; r <= 5; r++) await playRound(ctx, without(0, 1, 2));
    for (let i = 0; i < 3; i++) {
      const m = await ctx.circle.member(i);
      expect(m.collateralUsed + m.collateral).to.be.at.most(await ctx.circle.collateralFor(i));
    }
    await finishAndWithdraw(ctx);
    const n = await nets(ctx);
    expect(n.reduce((a, b) => a + b, 0)).to.be.closeTo(0, 1e-6);
    expect(n[3]).to.be.at.most(0);
    expect(n[4]).to.be.at.most(0);
  });

  it("shorted member with collateral left who stops: what they're owed is netted, the rest refunded last", async function () {
    const ctx = await deployCircle({ k: 10000 }); // A locks 400
    await acceptAll(ctx);
    await playRound(ctx, without(4)); // E leaves (collateral 100 to reserve): A is fully paid from reserve
    // make A short instead: second circle with 50% cover
    const ctx2 = await deployCircle({ k: 5000 });
    await acceptAll(ctx2);
    await playRound(ctx2, without(4)); // A short 50
    for (let r = 2; r <= 3; r++) await playRound(ctx2, without(4));
    for (let r = 4; r <= 5; r++) await playRound(ctx2, without(0, 4)); // A stops late: collateral 200 covers it
    const a = await ctx2.circle.member(0);
    expect(a.collateral).to.equal(0n);
    await passCureWindow(ctx2);
    await expect(ctx2.circle.finalize()).to.emit(ctx2.circle, "EntitlementNetted").withArgs(ctx2.members[0].address, 0n, a.unpaidEntitlement);
    for (const m of ctx2.members) if ((await ctx2.circle.withdrawable(m.address)) > 0n) await ctx2.circle.connect(m).withdraw();
    expect(await ctx2.token.balanceOf(await ctx2.circle.getAddress())).to.equal(0n);
  });
});
