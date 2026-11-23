// v9.3 release acceptance: factory history (recordCircle) and the edge cases listed in the release
// assignment. Expected values here are computed by hand from the rules in the contract's comments,
// not taken from app/src/sim.js, and every step checks an independent ledger:
//   sum of member collateral + free reserve + round fund + every known address's withdrawable
//   == the circle's actual token balance, and totalWithdrawable == the sum of those credits.
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const { expect } = require("chai");

const U = (x) => ethers.parseUnits(String(x), 6);
const ROUND = 180;
const GRACE = 60;
const JOIN = 600;

async function world({ feeBps = 0, minCover = 0, tokenKind = "MockUSD" } = {}) {
  const s = await ethers.getSigners();
  const token = await ethers.deployContract(tokenKind);
  const treasury = s[19];
  const factory = await ethers.deployContract("CircleFactory", [await token.getAddress(), treasury.address, feeBps, 60, 30, 1, minCover]);
  const pool = s.slice(1, 14); // up to 13 member wallets
  for (const m of pool) await token.mint(m.address, U(1000000));
  return { s, token, factory, treasury, pool, feeBps, outsider: s[17], alt: s[18], organizer: s[0] };
}

async function open(w, { n = 5, c = 100, k = 10000, fromPayout = false, members, name = "circle" } = {}) {
  const ms = members || w.pool.slice(0, n);
  await w.factory.connect(w.organizer).createCircle(name, ms.map((m) => m.address), U(c), k, ROUND, GRACE, JOIN, fromPayout);
  const [addr] = await w.factory.circlesPage(0, 1);
  const circle = await ethers.getContractAt("SavingsCircle", addr);
  const start = await Promise.all(ms.map((m) => w.token.balanceOf(m.address)));
  const tStart = await w.token.balanceOf(w.treasury.address);
  return { ...w, circle, addr, members: ms, n: ms.length, c: U(c), k, fromPayout, start, tStart, stray: 0n };
}

/** The independent ledger. `stray` = tokens sent straight to the circle and not yet swept. */
async function ledger(x) {
  const bal = await x.token.balanceOf(x.addr);
  let col = 0n;
  for (let i = 0; i < x.n; i++) col += (await x.circle.member(i)).collateral;
  let credits = 0n;
  for (const a of new Set([...x.members.map((m) => m.address), x.treasury.address])) credits += await x.circle.withdrawable(a);
  expect(await x.circle.totalWithdrawable()).to.equal(credits, "credits belong only to members and the treasury");
  const rebuilt = col + (await x.circle.freeReserve()) + (await x.circle.roundFund()) + credits;
  expect(rebuilt + x.stray).to.equal(bal, "independent ledger == token balance");
  expect(await x.circle.accountedBalance()).to.equal(rebuilt, "contract's own sum agrees with the independent one");
}

async function acceptAll(x, order) {
  for (const i of order || [...Array(x.n).keys()]) {
    const up = await x.circle.upfrontCollateral(i);
    if (up > 0n) await x.token.connect(x.members[i]).approve(x.addr, up);
    await x.circle.connect(x.members[i]).accept();
    await ledger(x);
  }
}

async function pay(x, i) {
  await x.token.connect(x.members[i]).approve(x.addr, x.c);
  await x.circle.connect(x.members[i]).contribute();
  await ledger(x);
}

/** One round: `payers` pay, then settle (waiting out deadline + grace if anyone allowed to pay did not). */
async function round(x, payers) {
  const r = await x.circle.currentRound();
  for (const i of payers) if (!(await x.circle.contributed(r, i))) await pay(x, i);
  let all = true;
  for (let i = 0; i < x.n; i++) if ((await x.circle.member(i)).status !== 1n && !(await x.circle.contributed(r, i))) all = false;
  if (!all) {
    const due = Number(await x.circle.deadline()) + GRACE + 1;
    if ((await time.latest()) < due) await time.increaseTo(due);
  }
  const tx = await x.circle.settle();
  await ledger(x);
  return tx;
}

async function catchUp(x, i) {
  const [total] = await x.circle.catchUpCost(i);
  await x.token.connect(x.members[i]).approve(x.addr, total);
  await x.circle.connect(x.members[i]).catchUp();
  await ledger(x);
}

async function finalize(x) {
  const fa = Number(await x.circle.finalizeAfter());
  if ((await time.latest()) < fa) await time.increaseTo(fa);
  await x.circle.finalize();
  await ledger(x);
}

async function withdrawAll(x) {
  for (const a of [...x.members, x.treasury]) if ((await x.circle.withdrawable(a.address)) > 0n) await x.circle.connect(a).withdraw();
  await ledger(x);
  expect(await x.token.balanceOf(x.addr)).to.equal(0n, "circle ends empty");
}

async function nets(x) {
  const m = await Promise.all(x.members.map(async (a, i) => (await x.token.balanceOf(a.address)) - x.start[i]));
  const t = (await x.token.balanceOf(x.treasury.address)) - x.tStart;
  return { m, t };
}

/** Conservation: what members lost in total is exactly what the treasury received (plus stray tokens that were added). */
async function conserved(x, added = 0n) {
  const { m, t } = await nets(x);
  expect(m.reduce((a, b) => a + b, 0n) + t).to.equal(added, "no money created or destroyed");
}

const sumBig = (a) => a.reduce((s, v) => s + v, 0n);

// ---------------------------------------------------------------------------------------------
describe("v9.3 release acceptance — factory history (recordCircle)", function () {
  it("records completed / caught up / left early / walked away, volume only for good standing, once, without touching money", async function () {
    const w = await world({ feeBps: 50 });
    const x = await open(w, { n: 6, c: 100, k: 10000 });
    await acceptAll(x);
    await round(x, [0, 1, 2, 3, 4]); // r1: seat 6 misses before its turn -> leaves
    await round(x, [1, 2, 3, 4]); //    r2: seat 1 (paid in r1) stops for good -> walks away
    await round(x, [2, 3, 4]); //       r3: seat 2 (paid in r2) misses too
    await catchUp(x, 1); //             r4: seat 2 catches up in full (including round 4)
    await round(x, [1, 2, 3, 4]);
    await round(x, [1, 2, 3, 4]);
    await round(x, [1, 2, 3, 4]); //    r6: seat 6's payout is cancelled (it left)
    await expect(w.factory.recordCircle(x.addr)).to.be.revertedWithCustomError(w.factory, "NotFinished");
    await finalize(x); // waits out the cure window: seat 1 is still behind

    // the outcomes the circle reports, as designed
    const expected = [3n, 1n, 0n, 0n, 0n, 2n];
    for (let i = 0; i < 6; i++) expect(await x.circle.outcomeOf(i)).to.equal(expected[i]);

    // money before recording
    const before = await Promise.all([...x.members, x.treasury].map(async (a) => [await x.circle.withdrawable(a.address), await w.token.balanceOf(a.address)]));
    const balBefore = await w.token.balanceOf(x.addr);
    const totalBefore = await x.circle.totalWithdrawable();

    // anyone can record, here an outsider who is not a member
    const tx = await w.factory.connect(w.outsider).recordCircle(x.addr);
    const rc = await tx.wait();
    const events = rc.logs.map((l) => { try { return w.factory.interface.parseLog(l); } catch { return null; } }).filter((e) => e && e.name === "ResultRecorded");
    expect(events.map((e) => [e.args.member, BigInt(e.args.outcome)])).to.deep.equal(x.members.map((m, i) => [m.address, expected[i]]));
    expect(await w.factory.recorded(x.addr)).to.equal(true);

    // history counters and volume (pot = 6 x 100 = 600, only for outcomes 0 and 1)
    const want = [
      [0n, 0n, 0n, 1n, 0n],
      [0n, 1n, 0n, 0n, U(600)],
      [1n, 0n, 0n, 0n, U(600)],
      [1n, 0n, 0n, 0n, U(600)],
      [1n, 0n, 0n, 0n, U(600)],
      [0n, 0n, 1n, 0n, 0n],
    ];
    for (let i = 0; i < 6; i++) {
      const h = await w.factory.history(x.members[i].address);
      expect([h.completed, h.caughtUp, h.leftEarly, h.walkedAway, h.volume]).to.deep.equal(want[i], `seat ${i + 1}`);
    }

    // a second record is refused
    await expect(w.factory.recordCircle(x.addr)).to.be.revertedWithCustomError(w.factory, "AlreadyRecorded");

    // recording changed nothing about the money
    const after = await Promise.all([...x.members, x.treasury].map(async (a) => [await x.circle.withdrawable(a.address), await w.token.balanceOf(a.address)]));
    expect(after).to.deep.equal(before, "no entitlement or wallet balance changed");
    expect(await w.token.balanceOf(x.addr)).to.equal(balBefore);
    expect(await x.circle.totalWithdrawable()).to.equal(totalBefore);
    await ledger(x);

    // everyone can still withdraw exactly what they were owed
    await withdrawAll(x);
    await conserved(x);
  });

  it("history accumulates across circles of the same factory and is per factory, per address", async function () {
    const w = await world();
    const a = await open(w, { n: 3, c: 10, k: 10000, name: "first" });
    await acceptAll(a);
    for (let r = 0; r < 3; r++) await round(a, [0, 1, 2]);
    await finalize(a);
    await w.factory.recordCircle(a.addr);
    const b = await open(w, { n: 3, c: 20, k: 10000, name: "second", members: [w.pool[2], w.pool[0], w.pool[1]] });
    await acceptAll(b);
    for (let r = 0; r < 3; r++) await round(b, [0, 1, 2]);
    await finalize(b);
    expect(await w.factory.recorded(b.addr)).to.equal(false, "recording one circle does not mark another");
    await w.factory.recordCircle(b.addr);
    for (const m of w.pool.slice(0, 3)) {
      const h = await w.factory.history(m.address);
      expect(h.completed).to.equal(2n);
      expect(h.volume).to.equal(U(3 * 10) + U(3 * 20));
    }
    // another factory keeps its own, empty history
    const other = await ethers.deployContract("CircleFactory", [await w.token.getAddress(), w.treasury.address, 0, 60, 30, 1, 0]);
    expect((await other.history(w.pool[0].address)).completed).to.equal(0n);
    await expect(other.recordCircle(a.addr)).to.be.revertedWithCustomError(other, "NotACircle");
  });

  it("a cancelled circle and a circle still running cannot be recorded", async function () {
    const w = await world();
    const x = await open(w, { n: 3 });
    await acceptAll(x, [0, 1]);
    await expect(w.factory.recordCircle(x.addr)).to.be.revertedWithCustomError(w.factory, "NotFinished");
    await time.increase(JOIN + 1);
    await x.circle.cancel();
    await expect(w.factory.recordCircle(x.addr)).to.be.revertedWithCustomError(w.factory, "NotFinished");
    const y = await open(w, { n: 2 });
    await acceptAll(y);
    await round(y, [0, 1]);
    await expect(w.factory.recordCircle(y.addr)).to.be.revertedWithCustomError(w.factory, "NotFinished");
    await expect(w.factory.recordCircle(w.outsider.address)).to.be.revertedWithCustomError(w.factory, "NotACircle");
  });
});

// ---------------------------------------------------------------------------------------------
describe("v9.3 release acceptance — membership", function () {
  it("2 and 12 members run a full cycle in both collateral modes; nets are exactly the fee", async function () {
    for (const n of [2, 12]) {
      for (const fromPayout of [false, true]) {
        const w = await world({ feeBps: 50 });
        const x = await open(w, { n, c: 100, k: 10000, fromPayout });
        await acceptAll(x);
        for (let r = 0; r < n; r++) await round(x, [...Array(n).keys()]);
        await finalize(x);
        await withdrawAll(x);
        // each pot is n x 100; the fee is 0.5% of each pot; each member pays in one pot and receives one pot less the fee
        const feePerPot = (BigInt(n) * U(100) * 50n) / 10000n;
        const { m, t } = await nets(x);
        expect(m).to.deep.equal(Array(n).fill(-feePerPot), `n=${n} fromPayout=${fromPayout}`);
        expect(t).to.equal(feePerPot * BigInt(n));
      }
    }
  });

  it("rejects 1 or 13 members, a duplicate, the zero address, and cover below the factory minimum", async function () {
    const w = await world();
    const p = w.pool.map((m) => m.address);
    const make = (ms, k = 10000) => w.factory.createCircle("x", ms, U(1), k, ROUND, GRACE, JOIN, false);
    await expect(make([p[0]])).to.be.revertedWithCustomError(w.factory, "BadConfig");
    await expect(make(p.slice(0, 13))).to.be.revertedWithCustomError(w.factory, "BadConfig");
    await expect(make([p[0], p[1], p[0]])).to.be.revertedWithCustomError(w.factory, "BadConfig");
    await expect(make([p[0], ethers.ZeroAddress])).to.be.revertedWithCustomError(w.factory, "BadConfig");
    await expect(make([p[0], p[1]], 2500)).to.be.revertedWithCustomError(w.factory, "BadConfig"); // not an allowed cover level
    const strict = await ethers.deployContract("CircleFactory", [await w.token.getAddress(), w.treasury.address, 0, 86400, 43200, U(1), 10000]);
    await expect(strict.createCircle("x", [p[0], p[1]], U(1), 5000, 86400, 43200, JOIN, false)).to.be.revertedWithCustomError(strict, "BadConfig");
    await expect(strict.createCircle("x", [p[0], p[1]], U(1), 10000, 3600, 43200, JOIN, false)).to.be.revertedWithCustomError(strict, "BadConfig");
    await expect(strict.createCircle("x", [p[0], p[1]], U(0.5), 10000, 86400, 43200, JOIN, false)).to.be.revertedWithCustomError(strict, "BadConfig");
    await strict.createCircle("x", [p[0], p[1]], U(1), 10000, 86400, 43200, JOIN, false); // the production minimums themselves are allowed
  });

  it("payout order is the members list, whatever the address order or the order of accepting; outsiders and repeat accepts are refused", async function () {
    const w = await world();
    const ms = [...w.pool.slice(0, 4)].sort((a, b) => (BigInt(b.address) > BigInt(a.address) ? 1 : -1)); // descending addresses
    const x = await open(w, { n: 4, c: 50, k: 10000, members: ms });
    await expect(x.circle.connect(w.outsider).accept()).to.be.revertedWithCustomError(x.circle, "NotMember");
    await acceptAll(x, [3, 1, 0, 2]);
    await expect(x.circle.connect(ms[0]).accept()).to.be.revertedWithCustomError(x.circle, "WrongPhase");
    const got = [];
    for (let r = 0; r < 4; r++) {
      const rc = await (await round(x, [0, 1, 2, 3])).wait();
      const e = rc.logs.map((l) => { try { return x.circle.interface.parseLog(l); } catch { return null; } }).find((e) => e && e.name === "PotCredited");
      got.push(e.args.recipient);
    }
    expect(got).to.deep.equal(ms.map((m) => m.address));
  });

  it("join window: accept closes at the deadline; cancel only after it; leave and cancel return collateral exactly", async function () {
    const w = await world();
    const x = await open(w, { n: 3, c: 100, k: 5000 });
    await acceptAll(x, [0, 1]);
    await expect(x.circle.activate()).to.be.revertedWithCustomError(x.circle, "NotAllAccepted");
    await expect(x.circle.cancel()).to.be.revertedWithCustomError(x.circle, "JoinWindowOpen");
    await x.circle.connect(x.members[1]).leave(); // changes their mind
    expect(await x.circle.withdrawable(x.members[1].address)).to.equal(U(50)); // collateralFor(1) = 1 x 100 x 50%
    await ledger(x);
    await time.increase(JOIN + 1);
    const up = await x.circle.upfrontCollateral(2);
    await x.token.connect(x.members[2]).approve(x.addr, up);
    await expect(x.circle.connect(x.members[2]).accept()).to.be.revertedWithCustomError(x.circle, "JoinWindowClosed");
    await x.circle.cancel();
    expect(await x.circle.phase()).to.equal(3n);
    expect(await x.circle.withdrawable(x.members[0].address)).to.equal(U(100)); // collateralFor(0) = 2 x 100 x 50%
    await ledger(x);
    await withdrawAll(x);
    const { m } = await nets(x);
    expect(m).to.deep.equal([0n, 0n, 0n]);
  });
});

// ---------------------------------------------------------------------------------------------
describe("v9.3 release acceptance — coverage, collateral modes and defaults", function () {
  it("seat 1 walks away after its payout: 0%, 20%, 50%, 100% cover in both modes match the hand-computed loss", async function () {
    for (const k of [0, 2000, 5000, 10000]) {
      for (const fromPayout of [false, true]) {
        const w = await world();
        const x = await open(w, { n: 5, c: 100, k, fromPayout });
        await acceptAll(x);
        await round(x, [0, 1, 2, 3, 4]);
        const target = (4n * U(100) * BigInt(k)) / 10000n; // collateralFor(0) = 4 x c x k
        // from-payout mode tops collateral up to the same target out of seat 1's own pot
        expect((await x.circle.member(0)).collateral).to.equal(target, `collateral after payout k=${k} fromPayout=${fromPayout}`);
        for (let r = 2; r <= 5; r++) {
          await round(x, [1, 2, 3, 4]);
          const used = U(100) * BigInt(r - 1) < target ? U(100) * BigInt(r - 1) : target;
          const m0 = await x.circle.member(0);
          expect(m0.collateralUsed).to.equal(used, `collateral used after round ${r}`); // partial, then full exhaustion
          expect(m0.collateral).to.equal(target - used);
        }
        await finalize(x);
        await withdrawAll(x);
        const { m } = await nets(x);
        const shortfall = 4n * U(100) - target; // what the walker never paid and collateral did not cover
        expect(m[0]).to.equal(shortfall, `walker gains exactly the uncovered amount (k=${k}, fromPayout=${fromPayout})`);
        expect(sumBig(m.slice(1))).to.equal(-shortfall, "the others lose exactly that, together");
        let losses = 0n;
        for (let i = 1; i < 5; i++) losses += (await x.circle.member(i)).recordedLoss;
        expect(losses).to.equal(shortfall, "recorded losses equal the shortfall");
        expect(await x.circle.outcomeOf(0)).to.equal(3n);
        await conserved(x);
      }
    }
  });

  it("default before receiving the pot: the leaver forfeits up to one share, which goes to those who stayed", async function () {
    for (const k of [0, 10000]) {
      const w = await world();
      const x = await open(w, { n: 5, c: 100, k });
      await acceptAll(x);
      await round(x, [0, 1, 2, 3]); // seat 5 misses round 1
      expect((await x.circle.member(4)).status).to.equal(1n);
      await x.token.connect(x.members[4]).approve(x.addr, x.c);
      await expect(x.circle.connect(x.members[4]).contribute()).to.be.revertedWithCustomError(x.circle, "MemberDefaulted");
      for (let r = 2; r <= 5; r++) await round(x, [0, 1, 2, 3]);
      await finalize(x);
      await withdrawAll(x);
      const { m } = await nets(x);
      // collateralFor(4) = 1 x 100 x k; penalty = min(paid in + collateral, 100) = the collateral here
      const penalty = (U(100) * BigInt(k)) / 10000n;
      expect(m[4]).to.equal(-penalty);
      expect(sumBig(m.slice(0, 4))).to.equal(penalty);
      expect(await x.circle.outcomeOf(4)).to.equal(2n);
      await conserved(x);
    }
  });

  it("multiple simultaneous defaults (two walkers and a leaver in the same round) keep every ledger exact", async function () {
    const w = await world({ feeBps: 50 });
    const x = await open(w, { n: 6, c: 100, k: 5000, fromPayout: true });
    await acceptAll(x);
    await round(x, [0, 1, 2, 3, 4, 5]);
    await round(x, [0, 1, 2, 3, 4, 5]);
    for (let r = 3; r <= 6; r++) {
      const rc = await (await round(x, [2, 3, 4])).wait(); // seats 1 and 2 stop after their payouts, seat 6 leaves before its turn
      // oldest first: if seat j was repaid in this settlement, every earlier seat in good standing is owed nothing
      const repaid = rc.logs.map((l) => { try { return x.circle.interface.parseLog(l); } catch { return null; } }).filter((e) => e && e.name === "EntitlementRepaid").map((e) => x.members.findIndex((m) => m.address === e.args.recipient));
      for (const j of repaid) for (let i = 0; i < j; i++) {
        const mi = await x.circle.member(i);
        if (mi.status === 0n) expect(mi.unpaidEntitlement).to.equal(0n, `seat ${j + 1} repaid before seat ${i + 1}`);
      }
    }
    await finalize(x);
    const outcomes = await Promise.all([0, 1, 2, 3, 4, 5].map((i) => x.circle.outcomeOf(i)));
    expect(outcomes).to.deep.equal([3n, 3n, 0n, 0n, 0n, 2n]);
    await withdrawAll(x);
    await conserved(x);
  });

  it("catch-up before settlement costs restore + uncovered + this round + 2% late fee, exactly", async function () {
    const w = await world();
    const x = await open(w, { n: 5, c: 100, k: 2000 });
    await acceptAll(x);
    await round(x, [0, 1, 2, 3, 4]);
    await round(x, [1, 2, 3, 4]); // seat 1 misses round 2: its 80 collateral covers 80 of 100
    const [restore, uncovered] = await x.circle.arrearsOf(0);
    expect([restore, uncovered]).to.deep.equal([U(80), U(20)]);
    const [total, currentPart, lateFee] = await x.circle.catchUpCost(0);
    expect([currentPart, lateFee, total]).to.deep.equal([U(100), U(2), U(202)]);
    await catchUp(x, 0);
    const m0 = await x.circle.member(0);
    expect([m0.status, m0.collateral, m0.collateralUsed]).to.deep.equal([0n, U(80), 0n]);
    expect(await x.circle.contributed(3, 0)).to.equal(true, "the catch-up paid round 3 too");
    for (let r = 3; r <= 5; r++) await round(x, [0, 1, 2, 3, 4]);
    await finalize(x);
    expect(await x.circle.outcomeOf(0)).to.equal(1n);
    await withdrawAll(x);
    await conserved(x);
  });

  it("catch-up after the contribution window expired but before settlement counts for that round", async function () {
    const w = await world();
    const x = await open(w, { n: 4, c: 100, k: 5000 });
    await acceptAll(x);
    await round(x, [0, 1, 2, 3]);
    await round(x, [1, 2, 3]); // seat 1 behind
    for (const i of [1, 2, 3]) await pay(x, i);
    await time.increaseTo(Number(await x.circle.deadline()) + GRACE + 5);
    await x.token.connect(x.members[0]).approve(x.addr, x.c);
    await expect(x.circle.connect(x.members[0]).contribute()).to.be.revertedWithCustomError(x.circle, "ContributionWindowClosed");
    await catchUp(x, 0); // still allowed: includes round 3
    await x.circle.settle();
    await ledger(x);
    const m0 = await x.circle.member(0);
    expect([m0.status, m0.missedRounds]).to.deep.equal([0n, 1n], "no new miss recorded for round 3");
    await round(x, [0, 1, 2, 3]);
    await finalize(x);
    await withdrawAll(x);
    await conserved(x);
  });

  it("catch-up after a partial repayment repays the oldest entitlement first; insufficient funds change nothing", async function () {
    const w = await world();
    const x = await open(w, { n: 5, c: 100, k: 2000 });
    await acceptAll(x);
    await round(x, [0, 1, 2, 3, 4]); // r1: seat 1 paid
    await round(x, [1, 2, 3, 4]); //    r2: seat 1 misses; collateral 80 -> seat 2 short 20
    await round(x, [1, 2, 3, 4]); //    r3: no collateral left -> seat 3 short 100
    await round(x, [1, 2, 3]); //       r4: seat 5 leaves; its 20 collateral repays seat 2's 20 (partial repayment of the 120 owed); seat 4 short 200
    const ent = async () => Promise.all([1, 2, 3].map(async (i) => (await x.circle.member(i)).unpaidEntitlement));
    expect(await ent()).to.deep.equal([0n, U(100), U(200)]);

    // recovery attempts without enough approval or balance revert and leave everything as it was
    const [total] = await x.circle.catchUpCost(0);
    expect(total).to.equal(U(406)); // restore 80 + uncovered 220 + round 5 100 + 2% of 300
    await x.token.connect(x.members[0]).approve(x.addr, total - 1n);
    await expect(x.circle.connect(x.members[0]).catchUp()).to.be.reverted;
    const bal = await x.token.balanceOf(x.members[0].address);
    await x.token.connect(x.members[0]).transfer(w.outsider.address, bal - U(400)); // leaves 400 < 406
    await x.token.connect(x.members[0]).approve(x.addr, total);
    await expect(x.circle.connect(x.members[0]).catchUp()).to.be.reverted;
    expect((await x.circle.member(0)).status).to.equal(2n);
    await ledger(x);
    await x.token.connect(w.outsider).transfer(x.members[0].address, bal - U(400));

    await catchUp(x, 0); // 226 to the reserve: seat 3's 100 first, then 126 of seat 4's 200
    expect(await ent()).to.deep.equal([0n, 0n, U(74)]);
    await round(x, [0, 1, 2, 3]); // r5: seat 5's pot is cancelled; it repays seat 4's remaining 74
    expect(await ent()).to.deep.equal([0n, 0n, 0n]);
    await finalize(x);
    await withdrawAll(x);
    await conserved(x);
  });
});

// ---------------------------------------------------------------------------------------------
describe("v9.3 release acceptance — withdrawals, finalization, surplus, treasury, isolation", function () {
  it("withdraw, a second withdraw, withdrawTo another address, and bad recipients", async function () {
    const w = await world();
    const x = await open(w, { n: 2, c: 100, k: 10000 });
    await acceptAll(x);
    await round(x, [0, 1]);
    await round(x, [0, 1]);
    await finalize(x);
    const owed = await x.circle.withdrawable(x.members[0].address);
    await expect(x.circle.connect(x.members[0]).withdrawTo(ethers.ZeroAddress)).to.be.revertedWithCustomError(x.circle, "BadRecipient");
    await expect(x.circle.connect(x.members[0]).withdrawTo(x.addr)).to.be.revertedWithCustomError(x.circle, "BadRecipient");
    const altBefore = await w.token.balanceOf(w.alt.address);
    await x.circle.connect(x.members[0]).withdrawTo(w.alt.address);
    expect((await w.token.balanceOf(w.alt.address)) - altBefore).to.equal(owed);
    expect(await x.circle.withdrawable(x.members[0].address)).to.equal(0n);
    await expect(x.circle.connect(x.members[0]).withdraw()).to.be.revertedWithCustomError(x.circle, "NothingToWithdraw");
    await expect(x.circle.connect(w.outsider).withdraw()).to.be.revertedWithCustomError(x.circle, "NothingToWithdraw");
    await x.circle.connect(x.members[1]).withdraw();
    await expect(x.circle.connect(x.members[1]).withdraw()).to.be.revertedWithCustomError(x.circle, "NothingToWithdraw");
    await ledger(x);
    expect(await w.token.balanceOf(x.addr)).to.equal(0n);
  });

  it("finalize waits for the last round and, if anyone is behind, the cure window; nothing runs after it", async function () {
    const w = await world();
    const x = await open(w, { n: 3, c: 100, k: 5000 });
    await acceptAll(x);
    await round(x, [0, 1, 2]);
    await expect(x.circle.finalize()).to.be.revertedWithCustomError(x.circle, "RoundsNotDone");
    await round(x, [1, 2]); // seat 1 behind
    await round(x, [1, 2]);
    await expect(x.circle.finalize()).to.be.revertedWithCustomError(x.circle, "CureWindowOpen");
    await catchUp(x, 0); // allowed inside the cure window
    await x.circle.finalize(); // nobody behind any more: no need to wait
    await ledger(x);
    await expect(x.circle.finalize()).to.be.revertedWithCustomError(x.circle, "WrongPhase");
    await expect(x.circle.settle()).to.be.revertedWithCustomError(x.circle, "WrongPhase");
    await expect(x.circle.connect(x.members[0]).contribute()).to.be.revertedWithCustomError(x.circle, "WrongPhase");
    await expect(x.circle.connect(x.members[0]).catchUp()).to.be.revertedWithCustomError(x.circle, "WrongPhase");
    await withdrawAll(x);
    await conserved(x);
  });

  it("stray tokens: swept into the reserve while running, shared equally after the end; never lost", async function () {
    const w = await world();
    const x = await open(w, { n: 4, c: 100, k: 10000 });
    await acceptAll(x);
    await expect(x.circle.sweepSurplus()).to.be.revertedWithCustomError(x.circle, "NothingToWithdraw");
    await w.token.mint(w.outsider.address, U(1000));
    await w.token.connect(w.outsider).transfer(x.addr, U(40));
    x.stray = U(40);
    await ledger(x);
    await x.circle.sweepSurplus();
    x.stray = 0n;
    expect(await x.circle.freeReserve()).to.equal(U(40));
    await ledger(x);
    for (let r = 0; r < 4; r++) await round(x, [0, 1, 2, 3]);
    await finalize(x);
    await w.token.connect(w.outsider).transfer(x.addr, U(8)); // after the end
    x.stray = U(8);
    await x.circle.sweepSurplus();
    x.stray = 0n;
    await withdrawAll(x);
    const { m } = await nets(x);
    expect(m).to.deep.equal([U(12), U(12), U(12), U(12)], "40 shared by the 4 in good standing, then 8 shared equally");
    await conserved(x, U(48));
  });

  it("the treasury receives exactly the fee on pot money paid out, and only the treasury can take it", async function () {
    const w = await world({ feeBps: 100 });
    const x = await open(w, { n: 4, c: 250, k: 10000, fromPayout: true });
    await acceptAll(x);
    for (let r = 0; r < 4; r++) await round(x, [0, 1, 2, 3]);
    await finalize(x);
    expect(await x.circle.withdrawable(w.treasury.address)).to.equal(4n * ((4n * U(250) * 100n) / 10000n)); // 4 pots x 1% of 1000
    await expect(x.circle.connect(w.outsider).withdraw()).to.be.revertedWithCustomError(x.circle, "NothingToWithdraw");
    await withdrawAll(x);
    const { t } = await nets(x);
    expect(t).to.equal(U(40));
    await conserved(x);
  });

  it("circles of one factory are isolated: actions, stray tokens and withdrawals in one never move the other", async function () {
    const w = await world();
    const a = await open(w, { n: 3, c: 100, k: 10000, name: "A" });
    await acceptAll(a);
    const b = await open(w, { n: 3, c: 100, k: 10000, name: "B" });
    await acceptAll(b);
    const snap = async (x) => [await w.token.balanceOf(x.addr), await x.circle.accountedBalance(), await x.circle.freeReserve(), await x.circle.currentRound()];
    const bBefore = await snap(b);
    await round(a, [0, 1, 2]);
    await w.token.mint(w.outsider.address, U(5));
    await w.token.connect(w.outsider).transfer(a.addr, U(5));
    await a.circle.sweepSurplus();
    await round(a, [0, 1, 2]);
    await round(a, [0, 1, 2]);
    await finalize(a);
    await withdrawAll(a);
    await w.factory.recordCircle(a.addr);
    expect(await snap(b)).to.deep.equal(bBefore);
    expect(await w.factory.recorded(b.addr)).to.equal(false);
    await ledger(b);
  });
});

// ---------------------------------------------------------------------------------------------
describe("v9.3 release acceptance — token administrator risk (QUSDC model)", function () {
  it("if the token administrator burns from a circle, the ledger exceeds the balance and the last withdrawals fail", async function () {
    const w = await world({ tokenKind: "AdminBurnUSD" });
    const x = await open(w, { n: 3, c: 100, k: 10000 });
    await acceptAll(x);
    for (let r = 0; r < 3; r++) await round(x, [0, 1, 2]);
    await finalize(x);
    await w.token.connect(w.s[0]).burn(x.addr, U(150)); // the deployer of the mock is its admin
    expect((await x.circle.accountedBalance()) - (await w.token.balanceOf(x.addr))).to.equal(U(150));
    // credits: each member 300 back (pot) + collateral; the first withdrawals succeed, the last cannot be paid
    const owed = await Promise.all(x.members.map((m) => x.circle.withdrawable(m.address)));
    let failed = 0;
    for (let i = 0; i < 3; i++) {
      try { await x.circle.connect(x.members[i]).withdraw(); } catch { failed++; }
    }
    expect(failed).to.be.greaterThan(0, "a burned circle cannot pay everyone: a token-level risk outside PotLoop's control");
    expect(owed.every((o) => o > 0n)).to.equal(true);
  });
});
