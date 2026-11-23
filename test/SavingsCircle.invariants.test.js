const { expect } = require("chai");
const { deployCircle, acceptAll, playRound, finishAndWithdraw, nets, checkLedgers, catchUp } = require("./helpers");

// small deterministic random generator so failures are reproducible
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const COVERAGES = [0, 2000, 3000, 4000, 5000, 10000];
const RUNS = Number(process.env.INVARIANT_RUNS || 150);

describe(`SavingsCircle — invariants over ${RUNS} random default patterns`, function () {
  this.timeout(0);

  it("ledgers always balance, the contract ends empty, and honest members are protected as promised", async function () {
    for (let seed = 1; seed <= RUNS; seed++) {
      const rand = rng(seed);
      const k = COVERAGES[Math.floor(rand() * COVERAGES.length)];
      const c = 1 + Math.floor(rand() * 200); // 1..200 tokens per round
      const fromPayout = seed % 2 === 0; // both collateral modes
      const ctx = await deployCircle({ k, c, fromPayout });
      await acceptAll(ctx);

      // each member either never stops (0) or stops paying from round 1..5 onward
      const stopAt = [0, 1, 2, 3, 4].map(() => (rand() < 0.6 ? 0 : 1 + Math.floor(rand() * 5)));

      // some members who stop after their turn later catch up in full and pay to the end
      const catchAt = stopAt.map((s, i) => (s > i + 1 && s < 5 && rand() < 0.4 ? s + 1 + Math.floor(rand() * (5 - s)) : 0));
      const addr = await ctx.circle.getAddress();
      for (let r = 1; r <= 5; r++) {
        for (let i = 0; i < 5; i++) {
          if (catchAt[i] === r && (await ctx.circle.member(i)).status === 2n) {
            await catchUp(ctx, i);
            await checkLedgers(ctx);
          }
        }
        const payers = [0, 1, 2, 3, 4].filter((i) => stopAt[i] === 0 || r < stopAt[i] || (catchAt[i] && r >= catchAt[i]));
        await playRound(ctx, payers); // checks ledgers == token balance after every call
      }
      await finishAndWithdraw(ctx); // checks the contract ends with exactly 0

      const n = await nets(ctx);
      const label = `seed ${seed}, fromPayout=${fromPayout}, k=${k}, c=${c}, stopAt=${JSON.stringify(stopAt)}, catchAt=${JSON.stringify(catchAt)}, nets=${JSON.stringify(n)}`;
      const sum = n.reduce((a, b) => a + b, 0);
      expect(Math.abs(sum)).to.be.lessThan(1e-6, `no money created or lost: ${label}`);

      const honest = [0, 1, 2, 3, 4].filter((i) => stopAt[i] === 0);
      // slot i is paid in round i+1; stopping later than that = defaulting after payout
      // a stopper who caught up in full no longer leaves anyone short
      const anyPostPayout = stopAt.some((s, i) => s !== 0 && s > i + 1 && !catchAt[i]);
      const anyPrePayout = stopAt.some((s, i) => s !== 0 && s <= i + 1);

      for (const i of honest) {
        if (!anyPrePayout && !catchAt.some((x) => x)) {
          // honest members gain only from leavers' penalties and catch-up late fees
          expect(n[i]).to.be.at.most(1e-6, `an honest member never gains at others' expense: ${label}`);
        }
        if (!anyPostPayout || k === 10000) {
          expect(n[i]).to.be.at.least(-1e-6, `honest member never loses: ${label}`);
        }
      }
      for (let i = 0; i < 5; i++) {
        const pre = stopAt[i] !== 0 && stopAt[i] <= i + 1;
        if (pre) expect(n[i]).to.be.at.most(1e-6, `a pre-payout defaulter never profits: ${label}`);
      }
    }
  });
});
