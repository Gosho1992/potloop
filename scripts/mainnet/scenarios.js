// The five mainnet acceptance scenarios. Each creates its own NEW circle(s) on the one factory.
// Amounts are in QUSDC base units (6 decimals): 20_000 = 0.02 QUSDC per round.
// stopAt[i] = round from which member i stops paying (0 = never); catchUpAt[i] = round at whose
// start member i catches up (0 = never). These drive both the real run and the simulator's
// expected values, so every result is compared exactly.
const C = 20_000n;
const ROUND = 60; // seconds; the factory's demo-mode minimum
const GRACE = 30;
const JOIN = 15 * 60;

const scenarios = {
  1: {
    title: "Two-member smoke test: join, contribute, payout, finalize, withdraw",
    circles: [{ label: "S1", n: 2, c: C, k: 10000, fromPayout: true }],
  },
  2: {
    title: "Four-member normal lifecycle, every round completed",
    circles: [{ label: "S2", n: 4, c: C, k: 5000, fromPayout: true }],
  },
  3: {
    title: "Collateral modes compared: the same circle with upfront collateral and with collateral held from the pot",
    circles: [
      { label: "S3-upfront", n: 3, c: C, k: 10000, fromPayout: false },
      { label: "S3-from-pot", n: 3, c: C, k: 10000, fromPayout: true },
    ],
    compareNets: ["S3-upfront", "S3-from-pot"], // every member must end with the same net result
  },
  4: {
    title: "Default and recovery: seat 1 takes the pot and stops, collateral pays, short payouts, catch-up, repayments",
    circles: [{ label: "S4", n: 5, c: C, k: 2000, fromPayout: true, stopAt: [2], catchUpAt: [4] }],
  },
  5: {
    title: "Six-member complete acceptance lifecycle: all payouts, finalize, all withdrawals",
    circles: [{ label: "S5", n: 6, c: C, k: 10000, fromPayout: true }],
  },
  // Added after S5's first live run: with 60 s rounds, 12 one-after-another transactions per round
  // took longer than the round on mainnet, so Farah's round-1 payment arrived after the deadline
  // and the contract refused it (as designed). S6 finishes that same circle as it actually stands
  // (Farah missed round 1 before her payout, so the contract treats her as leaving: her collateral
  // covers round 1 and the others share it), checked against the simulator for that path.
  // S7 repeats S5 unchanged, with each round's payments sent in parallel ("batch").
  6: {
    title: "S5 circle finished as it ran: Farah's round-1 payment arrived after the deadline, so she leaves and her collateral covers her",
    continues: 5,
    circles: [{ label: "S5-as-run", n: 6, c: C, k: 10000, fromPayout: true, stopAt: [0, 0, 0, 0, 0, 1], batch: true }],
  },
  7: {
    title: "Six-member complete acceptance lifecycle (S5 repeated, payments sent in parallel)",
    circles: [{ label: "S5-rerun", n: 6, c: C, k: 10000, fromPayout: true, batch: true }],
  },
};

for (const s of Object.values(scenarios)) {
  for (const c of s.circles) {
    c.stopAt = c.stopAt || [];
    c.catchUpAt = c.catchUpAt || [];
    c.round = ROUND;
    c.grace = GRACE;
    c.join = JOIN;
  }
}

module.exports = { scenarios, C, ROUND, GRACE, JOIN, MAX_MEMBERS: 6 };
