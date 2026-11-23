const { expect } = require("chai");
const { ethers } = require("hardhat");
const { cfg, U, ROUND, GRACE, JOIN, deployCircle, acceptAll, playRound } = require("./helpers");

describe("SavingsCircle — attack and state-machine tests", function () {
  it("reentrancy: a malicious token cannot make withdraw() pay twice", async function () {
    const signers = await ethers.getSigners();
    const token = await ethers.deployContract("ReentrantUSD");
    const attacker = await ethers.deployContract("AttackerMember");
    const others = signers.slice(1, 5);
    const memberAddrs = [await attacker.getAddress(), ...others.map((s) => s.address)];
    const circle = await ethers.deployContract("SavingsCircle", [cfg(memberAddrs, await token.getAddress())]);
    const cAddr = await circle.getAddress();
    await attacker.setUp(cAddr, await token.getAddress());
    await token.mint(await attacker.getAddress(), U(10000));
    for (const s of others) await token.mint(s.address, U(10000));

    await attacker.approveAndAccept(U(200)); // slot 1 collateral
    for (let i = 0; i < 4; i++) {
      const col = await circle.collateralFor(i + 1);
      if (col > 0n) await token.connect(others[i]).approve(cAddr, col);
      await circle.connect(others[i]).accept();
    }
    await attacker.approveAndContribute(U(100));
    for (const s of others) {
      await token.connect(s).approve(cAddr, U(100));
      await circle.connect(s).contribute();
    }
    await circle.settle(); // attacker is credited the 500 pot

    await token.arm(cAddr, await attacker.getAddress());
    const before = await token.balanceOf(cAddr);
    await expect(attacker.withdraw()).to.be.revertedWithCustomError(circle, "ReentrancyGuardReentrantCall");
    expect(await token.balanceOf(cAddr)).to.equal(before, "nothing left the contract");
    expect(await circle.withdrawable(await attacker.getAddress())).to.equal(U(500), "attacker's balance untouched");
    expect(await circle.accountedBalance()).to.equal(before);
  });

  it("phase rules: no early activate, no contribution before start, no cancel once full", async function () {
    const ctx = await deployCircle();
    await expect(ctx.circle.activate()).to.be.revertedWithCustomError(ctx.circle, "NotAllAccepted");
    await expect(ctx.circle.connect(ctx.members[0]).contribute()).to.be.revertedWithCustomError(ctx.circle, "WrongPhase");
    await acceptAll(ctx);
    expect(await ctx.circle.phase()).to.equal(1n); // Active
    await expect(ctx.circle.cancel()).to.be.revertedWithCustomError(ctx.circle, "WrongPhase");
    await expect(ctx.circle.connect(ctx.members[0]).accept()).to.be.revertedWithCustomError(ctx.circle, "WrongPhase");
  });

  it("after the last round: no more contributions or settles, finalize only once, withdraw only once", async function () {
    const ctx = await deployCircle();
    await acceptAll(ctx);
    for (let r = 1; r <= 5; r++) await playRound(ctx, [0, 1, 2, 3, 4]);
    await expect(ctx.circle.settle()).to.be.revertedWithCustomError(ctx.circle, "WrongPhase");
    await expect(ctx.circle.connect(ctx.members[0]).contribute()).to.be.revertedWithCustomError(ctx.circle, "WrongPhase");
    await ctx.circle.finalize();
    await expect(ctx.circle.finalize()).to.be.revertedWithCustomError(ctx.circle, "WrongPhase");
    await ctx.circle.connect(ctx.members[0]).withdraw();
    await expect(ctx.circle.connect(ctx.members[0]).withdraw()).to.be.revertedWithCustomError(ctx.circle, "NothingToWithdraw");
  });

  it("a member cannot join after the join window closes", async function () {
    const ctx = await deployCircle();
    const { time } = require("@nomicfoundation/hardhat-network-helpers");
    await time.increase(JOIN + 1);
    await expect(ctx.circle.connect(ctx.members[4]).accept()).to.be.revertedWithCustomError(ctx.circle, "JoinWindowClosed");
  });
});
