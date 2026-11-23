// Every possible default pattern for 5 members: each member never stops, or stops paying
// from round 1, 2, 3, 4 or 5 onward => 6^5 = 7,776 patterns per coverage level.
// Slow, so it only runs when asked:  $env:EXHAUSTIVE="1"; npx hardhat test test/SavingsCircle.exhaustive.test.js
// Optional: $env:EXHAUSTIVE_K="5000" (default runs 0, 5000 and 10000)
// Optional: $env:EXHAUSTIVE_MODE="upfront" or "pot" (default runs both collateral modes)
const { expect } = require("chai");
const { takeSnapshot } = require("@nomicfoundation/hardhat-network-helpers");
const { deployCircle, acceptAll, playRound, finishAndWithdraw, nets } = require("./helpers");

const run = process.env.EXHAUSTIVE === "1" ? describe : describe.skip;
const COVERAGES = (process.env.EXHAUSTIVE_K || "0,5000,10000").split(",").map(Number);
const MODES = { upfront: [false], pot: [true] }[process.env.EXHAUSTIVE_MODE] || [false, true];

run("SavingsCircle — exhaustive default patterns", function () {
  this.timeout(0);

  for (const fromPayout of MODES) for (const k of COVERAGES) {
    const mode = fromPayout ? "collateral from the pot" : "upfront collateral";
    it(`all 7,776 patterns at coverage ${k / 100}%, ${mode}`, async function () {
      // 30-day rounds: the run takes real minutes and the chain clock follows real time
      const ctx = await deployCircle({ k, c: 100, round: 30 * 86400, grace: 3 * 86400, join: 7 * 86400, fromPayout });
      await acceptAll(ctx);
      const snap = await takeSnapshot();
      let checked = 0;

      for (let code = 0; code < 6 ** 5; code++) {
        const stopAt = [];
        let x = code;
        for (let i = 0; i < 5; i++) {
          stopAt.push(x % 6);
          x = Math.floor(x / 6);
        }
        for (let r = 1; r <= 5; r++) {
          await playRound(ctx, [0, 1, 2, 3, 4].filter((i) => stopAt[i] === 0 || r < stopAt[i]));
        }
        await finishAndWithdraw(ctx);

        const n = await nets(ctx); // relative to the balance minted before joining
        const label = `${mode}, k=${k}, stopAt=${JSON.stringify(stopAt)}, nets=${JSON.stringify(n)}`;
        expect(Math.abs(n.reduce((a, b) => a + b, 0))).to.be.lessThan(1e-6, `conservation: ${label}`);
        const anyPost = stopAt.some((s, i) => s !== 0 && s > i + 1);
        const anyPre = stopAt.some((s, i) => s !== 0 && s <= i + 1);
        for (let i = 0; i < 5; i++) {
          const honest = stopAt[i] === 0;
          const pre = !honest && stopAt[i] <= i + 1;
          if (honest) {
            if (!anyPre) expect(n[i]).to.be.at.most(1e-6, `honest never gains: ${label}`);
            if (!anyPost || k === 10000) expect(n[i]).to.be.at.least(-1e-6, `honest never loses: ${label}`);
          }
          if (pre) expect(n[i]).to.be.at.most(1e-6, `pre-payout defaulter never profits: ${label}`);
        }
        checked++;
        if (checked % 1000 === 0) console.log(`      ${checked} / 7776 patterns OK at k=${k}, ${mode}`);
        await snap.restore();
      }
      expect(checked).to.equal(7776);
    });
  }
});
