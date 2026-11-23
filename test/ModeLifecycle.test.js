// The lifecycle situations of docs/MODE_COMPARISON.md, run on the contract in BOTH collateral
// modes. Every transaction passes the rule checks R1–R3 (test/circleRunner.js); every member's
// final balance must equal the simulator's; and the two modes must give the same net result for
// every member exactly where the comparison says so.
const path = require("path");
const { expect } = require("chai");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const { runOnChain } = require("./circleRunner");
const { deployCircle, checkLedgers } = require("./helpers");

const C = 100_000_000n;

describe("Collateral modes across the circle's lifecycle (on the contract)", function () {
  let simulate, lifecycle;
  before(async () => {
    ({ simulate } = await import(path.join(__dirname, "../app/src/sim.js")));
    ({ lifecycle } = await import(path.join(__dirname, "../scripts/lifecycle-scenarios.mjs")));
  });

  it("every situation: rules hold, balances match the simulator, and the modes differ only where documented", async function () {
    this.timeout(0);
    for (const [name, sc] of lifecycle) {
      const p = { c: C, feeBps: 0, stopAt: [], catchUpAt: [], ...sc };
      const late = p.late ? p.catchUpAt.map((x) => x > 0) : [];
      const nets = {};
      for (const fromPayout of [false, true]) {
        const q = { ...p, fromPayout, lateCatchUp: late };
        const { trace } = await runOnChain(q, `${name} / ${fromPayout}`);
        const sim = simulate(q);
        const chainFinal = trace[trace.length - 1].members.map((m) => m.withdrawable);
        const simFinal = sim.trace[sim.trace.length - 1].members.map((m) => m.withdrawable);
        expect(chainFinal, `${name} / fromPayout=${fromPayout}: final balances`).to.deep.equal(simFinal);
        nets[fromPayout] = sim.members.map((m) => m.net);
      }
      const leftEarly = p.stopAt.some((s, i) => s > 0 && s <= i + 1);
      const walked = p.stopAt.some((s, i) => s > i + 1 && !p.catchUpAt[i]);
      if (!(leftEarly && walked)) expect(nets[true], `${name}: same results in both modes`).to.deep.equal(nets[false]);
      if (p.k === 10000) {
        // at full cover nobody who keeps paying is worse off in from-pot mode
        nets[true].forEach((v, i) => {
          if (!p.stopAt[i]) expect(v >= nets[false][i], `${name}: seat ${i + 1}`).to.equal(true);
        });
      }
    }
  });

  for (const fromPayout of [false, true]) {
    it(`leaving before the start and a cancelled circle return exactly what was locked (${fromPayout ? "from the pot" : "upfront"})`, async function () {
      const ctx = await deployCircle({ n: 4, c: 100, k: 5000, fromPayout });
      const addr = await ctx.circle.getAddress();
      const locked = [];
      for (let i = 0; i < 3; i++) {
        const amt = await ctx.circle.upfrontCollateral(i);
        locked.push(amt);
        await ctx.token.connect(ctx.members[i]).approve(addr, amt);
        await ctx.circle.connect(ctx.members[i]).accept();
      }
      await ctx.circle.connect(ctx.members[0]).leave();
      expect(await ctx.circle.withdrawable(ctx.members[0].address)).to.equal(locked[0]);
      await time.increase(10 * 60 + 1);
      await ctx.circle.cancel();
      for (let i = 1; i < 3; i++) expect(await ctx.circle.withdrawable(ctx.members[i].address)).to.equal(locked[i]);
      await checkLedgers(ctx);
    });
  }
});
