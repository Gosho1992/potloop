const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const { expect } = require("chai");

const U = (x) => ethers.parseUnits(String(x), 6); // 6-decimal token units
const ROUND = 3 * 60; // demo values: 3-minute rounds
const GRACE = 60;
const JOIN = 10 * 60;
const START_BALANCE = U(10000);

/** Constructor config for SavingsCircle (v3 takes one struct). */
function cfg(memberAddrs, tokenAddr, { c = U(100), k = 5000, round = ROUND, grace = GRACE, join = JOIN, organizer = ethers.ZeroAddress, treasury = ethers.ZeroAddress, feeBps = 0, registry = ethers.ZeroAddress, fromPayout = false } = {}) {
  return { members: memberAddrs, token: tokenAddr, contribution: c, coverageBps: k, roundLength: round, grace, joinWindow: join, organizer, treasury, feeBps, registry, collateralFromPayout: fromPayout };
}

// `c` is in whole tokens (6 decimals) unless `cRaw` (base units) is given.
async function deployCircle({ k = 5000, c = 100, cRaw, n = 5, tokenKind = "MockUSD", round = ROUND, grace = GRACE, join = JOIN, feeBps = 0, fromPayout = false } = {}) {
  const signers = await ethers.getSigners();
  const organizer = signers[0];
  const members = signers.slice(1, 1 + n);
  const treasury = feeBps > 0 ? signers[1 + n].address : ethers.ZeroAddress;
  const token = await ethers.deployContract(tokenKind);
  const cUnits = cRaw !== undefined ? BigInt(cRaw) : U(c);
  // enough for any scenario: every contribution, the largest collateral and catch-ups
  const fund = START_BALANCE > cUnits * 40n ? START_BALANCE : cUnits * 40n;
  for (const m of members) await token.mint(m.address, fund);
  const circle = await ethers.deployContract("SavingsCircle", [
    cfg(members.map((m) => m.address), await token.getAddress(), { c: cUnits, k, round, grace, join, treasury, feeBps, fromPayout }),
  ]);
  return { circle, token, organizer, members, treasury, c: cUnits, n, round, grace };
}

async function checkLedgers(ctx) {
  const bal = await ctx.token.balanceOf(await ctx.circle.getAddress());
  expect(await ctx.circle.accountedBalance()).to.equal(bal, "ledgers must equal token balance");
  // independent of accountedBalance(): rebuild the total from every member's collateral, the
  // reserve, the round fund and each known address's withdrawable balance
  const n = ctx.n || ctx.members.length;
  let collateral = 0n;
  for (let i = 0; i < n; i++) collateral += (await ctx.circle.member(i)).collateral;
  const holders = new Set(ctx.members.slice(0, n).map((m) => m.address));
  if (ctx.treasury && ctx.treasury !== ethers.ZeroAddress) holders.add(ctx.treasury.address || ctx.treasury);
  let credits = 0n;
  for (const h of holders) credits += await ctx.circle.withdrawable(h);
  expect(await ctx.circle.totalWithdrawable()).to.equal(credits, "every withdrawable credit belongs to a member or the treasury");
  const rebuilt = collateral + (await ctx.circle.freeReserve()) + (await ctx.circle.roundFund()) + credits;
  expect(rebuilt).to.equal(bal, "collateral + reserve + round fund + credits must equal the token balance");
}

async function acceptAll(ctx) {
  const addr = await ctx.circle.getAddress();
  for (let i = 0; i < ctx.n; i++) {
    const m = ctx.members[i];
    const col = await ctx.circle.upfrontCollateral(i);
    if (col > 0n) await ctx.token.connect(m).approve(addr, col);
    await ctx.circle.connect(m).accept();
    await checkLedgers(ctx);
  }
}

/**
 * Runs one round. `payers` = slot indices that pay this round.
 * If someone does not pay, time is moved past deadline + grace before settling.
 */
async function playRound(ctx, payers) {
  const addr = await ctx.circle.getAddress();
  const r0 = await ctx.circle.currentRound();
  for (const i of payers) {
    if (await ctx.circle.contributed(r0, i)) continue; // already paid (e.g. while catching up)
    await ctx.token.connect(ctx.members[i]).approve(addr, ctx.c);
    await ctx.circle.connect(ctx.members[i]).contribute();
    await checkLedgers(ctx);
  }
  const r = await ctx.circle.currentRound();
  let allGoodPaid = true;
  for (let i = 0; i < ctx.n; i++) {
    const m = await ctx.circle.member(i);
    if (m.status !== 1n && !(await ctx.circle.contributed(r, i))) allGoodPaid = false; // anyone still allowed to pay
  }
  if (!allGoodPaid) {
    const due = Number(await ctx.circle.deadline()) + ctx.grace + 1;
    const now = await time.latest();
    if (now < due) await time.increaseTo(due);
  }
  await ctx.circle.settle();
  await checkLedgers(ctx);
}

/** Waits out the cure window after the last round if anyone is still behind. */
/** Approves exactly what catchUp() will pull, then catches up. */
async function catchUp(ctx, i) {
  const [total] = await ctx.circle.catchUpCost(i);
  await ctx.token.connect(ctx.members[i]).approve(await ctx.circle.getAddress(), total);
  await ctx.circle.connect(ctx.members[i]).catchUp();
}

async function passCureWindow(ctx) {
  const fa = Number(await ctx.circle.finalizeAfter());
  if ((await time.latest()) < fa) await time.increaseTo(fa);
}

async function finishAndWithdraw(ctx) {
  await passCureWindow(ctx);
  await ctx.circle.finalize();
  await checkLedgers(ctx);
  for (const m of ctx.members) {
    if ((await ctx.circle.withdrawable(m.address)) > 0n) {
      await ctx.circle.connect(m).withdraw();
    }
  }
  expect(await ctx.token.balanceOf(await ctx.circle.getAddress())).to.equal(0n, "contract must end empty");
}

/** Net result per member in whole tokens (positive = gained). */
async function nets(ctx) {
  const out = [];
  for (const m of ctx.members) {
    const b = await ctx.token.balanceOf(m.address);
    out.push(Number(ethers.formatUnits(b - START_BALANCE, 6)));
  }
  return out;
}

module.exports = { catchUp, passCureWindow, cfg, U, ROUND, GRACE, JOIN, deployCircle, acceptAll, playRound, finishAndWithdraw, nets, checkLedgers };
