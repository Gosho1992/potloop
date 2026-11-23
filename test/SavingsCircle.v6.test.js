// Tests for every finding in the third round of reviews (Fable 5.2 on v4, GPT on v5).
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const { cfg, U, ROUND, GRACE, JOIN, deployCircle, acceptAll, playRound, finishAndWithdraw, nets, catchUp, passCureWindow, checkLedgers } = require("./helpers");

const ALL = [0, 1, 2, 3, 4];
const without = (...out) => ALL.filter((i) => !out.includes(i));

async function quickCircle(tokenKind, n = 2, k = 10000) {
  const signers = await ethers.getSigners();
  const members = signers.slice(1, 1 + n);
  const token = await ethers.deployContract(tokenKind);
  for (const m of members) await token.mint(m.address, U(10000));
  const circle = await ethers.deployContract("SavingsCircle", [cfg(members.map((m) => m.address), await token.getAddress(), { k })]);
  const ctx = { circle, token, members, c: U(100), n, round: ROUND, grace: GRACE };
  return ctx;
}

describe("v6 — timing attacks", function () {
  it("early settle waits for a member who is behind but still allowed to pay (GPT critical 1, Fable L2)", async function () {
    const ctx = await deployCircle();
    await acceptAll(ctx);
    await playRound(ctx, ALL);
    await playRound(ctx, without(0)); // A is now behind after taking the pot
    const addr = await ctx.circle.getAddress();
    for (const i of [1, 2, 3, 4]) {
      await ctx.token.connect(ctx.members[i]).approve(addr, ctx.c);
      await ctx.circle.connect(ctx.members[i]).contribute();
    }
    await expect(ctx.circle.settle()).to.be.revertedWithCustomError(ctx.circle, "TooEarlyToSettle");
    await ctx.token.connect(ctx.members[0]).approve(addr, ctx.c);
    await ctx.circle.connect(ctx.members[0]).contribute(); // A pays this round
    await ctx.circle.settle(); // now everyone allowed to pay has paid
    expect((await ctx.circle.member(0)).missedRounds).to.equal(1n, "no extra miss was forced on A");
  });

  it("finalize waits for the cure window when someone is behind; they can catch up in it (GPT critical 2, Fable M2)", async function () {
    const ctx = await deployCircle();
    await acceptAll(ctx);
    for (let r = 1; r <= 4; r++) await playRound(ctx, ALL);
    await playRound(ctx, without(0)); // A misses the very last round
    await expect(ctx.circle.finalize()).to.be.revertedWithCustomError(ctx.circle, "CureWindowOpen");
    const [total, currentPart, lateFee] = await ctx.circle.catchUpCost(0);
    expect(currentPart).to.equal(0n);
    expect(lateFee).to.equal(U(2)); // 2% of the 100 of collateral used
    expect(total).to.equal(U(102));
    await catchUp(ctx, 0);
    await ctx.circle.finalize(); // nobody is behind any more: no need to wait
    expect(await ctx.circle.outcomeOf(0)).to.equal(1n);
  });

  it("with nobody behind, finalize needs no wait", async function () {
    const ctx = await deployCircle();
    await acceptAll(ctx);
    for (let r = 1; r <= 5; r++) await playRound(ctx, ALL);
    await ctx.circle.finalize();
  });

  it("fixed schedule: an early settle does not pull the next deadline forward (Fable L4)", async function () {
    const ctx = await deployCircle();
    await acceptAll(ctx);
    const d1 = await ctx.circle.deadline();
    await playRound(ctx, ALL); // settled early
    expect(await ctx.circle.deadline()).to.equal(d1 + BigInt(ROUND));
  });

  it("catching up while a round is open also pays that round, so the member cannot re-default (Fable L1)", async function () {
    const ctx = await deployCircle();
    await acceptAll(ctx);
    await playRound(ctx, ALL);
    await playRound(ctx, without(0));
    const [total, currentPart] = await ctx.circle.catchUpCost(0);
    expect(currentPart).to.equal(ctx.c);
    expect(total).to.equal(U(100 + 100 + 2));
    await catchUp(ctx, 0);
    expect(await ctx.circle.contributed(3, 0)).to.equal(true);
    await playRound(ctx, ALL);
    expect((await ctx.circle.member(0)).status).to.equal(0n);
  });

  it("catch-up after the current payment window expires but before settlement pays that round", async function () {
    const ctx = await deployCircle();
    await acceptAll(ctx);
    await playRound(ctx, ALL);
    await playRound(ctx, without(0));
    // Round 3 has started. Let its deadline and grace expire without anyone settling it.
    const due = Number(await ctx.circle.deadline()) + ctx.grace + 1;
    if ((await time.latest()) < due) await time.increaseTo(due);
    const [total, currentPart] = await ctx.circle.catchUpCost(0);
    expect(currentPart).to.equal(ctx.c);
    expect(total).to.equal(U(202)); // 100 refill + 100 late round + 2% on the refill
    await catchUp(ctx, 0);
    expect(await ctx.circle.contributed(3, 0)).to.equal(true);
    expect((await ctx.circle.member(0)).status).to.equal(0n);
    await ctx.circle.settle();
    expect((await ctx.circle.member(0)).status).to.equal(0n);
    await checkLedgers(ctx);
  });

  it("insufficient catch-up funds cannot partially restore status or collateral", async function () {
    const ctx = await deployCircle();
    await acceptAll(ctx);
    await playRound(ctx, ALL);
    await playRound(ctx, without(0));
    const [total] = await ctx.circle.catchUpCost(0);
    const addr = await ctx.circle.getAddress();
    await ctx.token.connect(ctx.members[0]).approve(addr, total - 1n);
    await expect(ctx.circle.connect(ctx.members[0]).catchUp()).to.be.reverted;
    expect((await ctx.circle.member(0)).status).to.equal(2n);
    await checkLedgers(ctx);
  });
});

describe("v6 — tokens and transfers", function () {
  it("cross-function reentrancy: a token calling sweepSurplus() from inside a withdrawal is blocked (GPT 3)", async function () {
    const ctx = await quickCircle("SweepCallbackUSD");
    await acceptAll(ctx);
    await playRound(ctx, [0, 1]);
    await ctx.token.arm(await ctx.circle.getAddress());
    await expect(ctx.circle.connect(ctx.members[0]).withdraw()).to.be.revertedWithCustomError(ctx.circle, "ReentrancyGuardReentrantCall");
    await checkLedgers(ctx);
  });

  it("a blocked address can withdraw to another address (Fable L6)", async function () {
    const ctx = await quickCircle("BlacklistUSD");
    await acceptAll(ctx);
    await playRound(ctx, [0, 1]);
    await ctx.token.setBlocked(ctx.members[0].address, true);
    await expect(ctx.circle.connect(ctx.members[0]).withdraw()).to.be.reverted;
    const [, , , , , , , safe] = await ethers.getSigners();
    await ctx.circle.connect(ctx.members[0]).withdrawTo(safe.address);
    expect(await ctx.token.balanceOf(safe.address)).to.equal(U(200));
    await expect(ctx.circle.connect(ctx.members[1]).withdrawTo(ethers.ZeroAddress)).to.be.revertedWithCustomError(ctx.circle, "BadRecipient");
  });

  it("a token that skims outgoing transfers is refused at withdrawal (GPT 9)", async function () {
    const ctx = await quickCircle("OutboundFeeUSD");
    await acceptAll(ctx);
    await playRound(ctx, [0, 1]);
    await ctx.token.setFeeFrom(await ctx.circle.getAddress());
    await expect(ctx.circle.connect(ctx.members[0]).withdraw()).to.be.revertedWithCustomError(ctx.circle, "TransferAmountMismatch");
  });

  it("a token address with no contract code is rejected (GPT 8)", async function () {
    const [, a, b, eoa] = await ethers.getSigners();
    const F = await ethers.getContractFactory("SavingsCircle");
    await expect(F.deploy(cfg([a.address, b.address], eoa.address))).to.be.revertedWithCustomError(F, "BadConfig");
  });
});

describe("v6 — input bounds and rounding", function () {
  it("publishes exact immutable seat terms for the member review flow", async function () {
    const ctx = await deployCircle({ n: 3, c: 100, k: 5000, feeBps: 50 });
    const terms = await ctx.circle.seatTerms(0);
    expect(terms.requiredCollateral).to.equal(U(100));
    expect(terms.totalContributions).to.equal(U(300));
    expect(terms.expectedPayout).to.equal(U("298.5"));
    expect(terms.payoutFee).to.equal(U("1.5"));
    expect(terms.remainingAfterPayout).to.equal(U(200));
    expect(terms.uncoveredAfterPayout).to.equal(U(100));
    await expect(ctx.circle.seatTerms(3)).to.be.revertedWithCustomError(ctx.circle, "BadConfig");
  });

  it("rejects zero, huge and out-of-range schedules and amounts (Fable H1/H2, GPT 10)", async function () {
    const [, a, b] = await ethers.getSigners();
    const t = await (await ethers.deployContract("MockUSD")).getAddress();
    const F = await ethers.getContractFactory("SavingsCircle");
    const two = [a.address, b.address];
    const bad = [
      { round: 1 }, { round: 366 * 86400 }, { round: ethers.MaxUint256 },
      { grace: 1 }, { grace: ROUND + 1 }, { join: 1 }, { join: 61 * 86400 },
      { c: 0n }, { c: 10n ** 15n + 1n },
    ];
    for (const o of bad) await expect(F.deploy(cfg(two, t, o))).to.be.revertedWithCustomError(F, "BadConfig");
    await F.deploy(cfg(two, t, { c: 10n ** 15n, k: 10000 })); // the largest allowed amount still works
  });

  it("collateral rounds up: the smallest contribution at 20% cover still locks something (GPT 11)", async function () {
    const [, a, b, c] = await ethers.getSigners();
    const t = await (await ethers.deployContract("MockUSD")).getAddress();
    const circle = await ethers.deployContract("SavingsCircle", [cfg([a.address, b.address, c.address], t, { c: 1n, k: 2000 })]);
    expect(await circle.collateralFor(0)).to.equal(1n);
    expect(await circle.collateralFor(2)).to.equal(1n);
  });

  it("leftover tokens are shared one unit at a time, not all to the first member (GPT 11)", async function () {
    const ctx = await deployCircle({ n: 3 });
    const addr = await ctx.circle.getAddress();
    await ctx.token.connect(ctx.members[0]).transfer(addr, 2n); // 2 units across 3 members
    await time.increase(JOIN + 1);
    await ctx.circle.sweepSurplus();
    await ctx.circle.cancel();
    expect(await ctx.circle.withdrawable(ctx.members[0].address)).to.equal(1n);
    expect(await ctx.circle.withdrawable(ctx.members[1].address)).to.equal(1n);
    expect(await ctx.circle.withdrawable(ctx.members[2].address)).to.equal(0n);
  });
});

describe("v6 — money rules", function () {
  it("leftover collateral of a member whose misses were all covered goes back to them, not to others' debts (Fable M1)", async function () {
    const ctx = await deployCircle({ k: 10000 }); // A locks 400
    await acceptAll(ctx);
    await playRound(ctx, without(4)); // E leaves in round 1: A is paid short (E's 100 collateral helps)
    for (let r = 2; r <= 4; r++) await playRound(ctx, without(4));
    await playRound(ctx, without(0, 4)); // A misses only the last round: 100 of collateral covers it
    await passCureWindow(ctx);
    const tx = ctx.circle.finalize();
    await expect(tx).to.emit(ctx.circle, "CollateralReturned").withArgs(ctx.members[0].address, U(300));
    for (const m of ctx.members) if ((await ctx.circle.withdrawable(m.address)) > 0n) await ctx.circle.connect(m).withdraw();
    expect(await ctx.token.balanceOf(await ctx.circle.getAddress())).to.equal(0n);
  });

  it("leave() before the start returns the collateral; the seat can be taken again (Fable L5)", async function () {
    const ctx = await deployCircle();
    const addr = await ctx.circle.getAddress();
    await ctx.token.connect(ctx.members[0]).approve(addr, U(400));
    await ctx.circle.connect(ctx.members[0]).accept();
    await ctx.circle.connect(ctx.members[0]).leave();
    expect(await ctx.circle.acceptedCount()).to.equal(0n);
    expect(await ctx.circle.withdrawable(ctx.members[0].address)).to.equal(U(200));
    await expect(ctx.circle.connect(ctx.members[0]).leave()).to.be.revertedWithCustomError(ctx.circle, "NotAccepted");
    await ctx.circle.connect(ctx.members[0]).accept();
    await checkLedgers(ctx);
  });

  it("the service fee also applies to pot money repaid later (Fable L3)", async function () {
    const ctx = await deployCircle({ feeBps: 50 });
    await acceptAll(ctx);
    for (let r = 1; r <= 5; r++) await playRound(ctx, without(4)); // E leaves: shortfalls repaid later
    await passCureWindow(ctx);
    await ctx.circle.finalize();
    // every unit of pot money that reached a recipient carried 0.5%
    let gross = 0n;
    for (let i = 0; i < 5; i++) gross += (await ctx.circle.member(i)).paidOut ? U(500) - (await ctx.circle.member(i)).recordedLoss : 0n;
    expect(await ctx.circle.withdrawable(ctx.treasury)).to.equal((gross * 50n) / 10000n);
  });

  it("risk view reports a claim shortfall when the reserve can't cover what is already owed (GPT 4)", async function () {
    const ctx = await deployCircle({ k: 0 });
    await acceptAll(ctx);
    await playRound(ctx, without(4)); // E leaves: A short 100, reserve empty
    const r = await ctx.circle.risk();
    expect(r.unpaidEntitlements).to.equal(U(100));
    expect(r.claimShortfall).to.equal(U(100));
  });
});

describe("v6 — random action ordering", function () {
  it("stray transfers, sweeps, premature settle/finalize attempts and catch-ups never break the ledgers", async function () {
    this.timeout(0);
    let seed = 7;
    const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (let run = 0; run < 40; run++) {
      const ctx = await deployCircle({ k: [0, 2000, 5000, 10000][run % 4], c: 1 + Math.floor(rand() * 150) });
      const addr = await ctx.circle.getAddress();
      await acceptAll(ctx);
      const stop = ALL.map(() => (rand() < 0.5 ? 0 : 1 + Math.floor(rand() * 5)));
      for (let r = 1; r <= 5; r++) {
        if (rand() < 0.3) {
          await ctx.token.connect(ctx.members[Math.floor(rand() * 5)]).transfer(addr, 1n + BigInt(Math.floor(rand() * 1000)));
          await ctx.circle.sweepSurplus();
        }
        await ctx.circle.settle().catch(() => {}); // premature attempts must fail cleanly or be legitimate
        for (let i = 0; i < 5; i++) {
          const m = await ctx.circle.member(i);
          if (m.status === 2n && rand() < 0.3) await catchUp(ctx, i);
        }
        if ((await ctx.circle.phase()) !== 1n || (await ctx.circle.allRoundsSettled())) break;
        await playRound(ctx, ALL.filter((i) => stop[i] === 0 || r < stop[i]));
        await checkLedgers(ctx);
      }
      await ctx.circle.finalize().catch(() => {});
      await finishAndWithdraw(ctx).catch(async () => {
        // already finalized above: just withdraw everyone
        for (const m of ctx.members) if ((await ctx.circle.withdrawable(m.address)) > 0n) await ctx.circle.connect(m).withdraw();
      });
      expect(await ctx.token.balanceOf(addr)).to.equal(0n, `run ${run}: contract ends empty`);
      const n = await nets(ctx);
      expect(Math.abs(n.reduce((a, b) => a + b, 0))).to.be.lessThan(1e-6, `run ${run}: no money created or lost`);
    }
  });
});
