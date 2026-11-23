// Lifecycle situations compared between collateral modes (scripts/compare-modes.mjs) and run on
// the contract in both modes (test/ModeLifecycle.test.js). `late`: the catch-up happens after the
// round's deadline, before settlement.
export const lifecycle = [
  ["Everyone pays; every payout in full", { n: 5, k: 5000 }],
  ["A short payout (3 of 5 leave in round 1), repaid later", { n: 5, k: 10000, feeBps: 100, stopAt: [0, 0, 1, 1, 1] }],
  ["Seat 1 stops right after its payout", { n: 6, k: 5000, stopAt: [2] }],
  ["Seat 3 stops before its payout (round 2)", { n: 6, k: 5000, stopAt: [0, 0, 2] }],
  ["Seat 3 leaves in round 1, before paying anything", { n: 6, k: 5000, stopAt: [0, 0, 1] }],
  ["Seat 1 stops, its collateral pays, it catches up in round 4", { n: 6, k: 5000, stopAt: [2], catchUpAt: [4] }],
  ["Seat 1 catches up after the deadline, before settlement", { n: 6, k: 5000, stopAt: [2], catchUpAt: [4], late: true }],
  ["Seat 2 catches up in the cure window", { n: 6, k: 3000, stopAt: [0, 3], catchUpAt: [0, 7] }],
  ["Old entitlement repaid in two parts", { n: 6, k: 10000, feeBps: 100, stopAt: [2, 0, 1, 1, 1, 0], catchUpAt: [3] }],
  ["Three members stop after their payouts", { n: 6, k: 4000, stopAt: [2, 3, 4] }],
  ["Reserve exhausted (20% cover, two early walkers)", { n: 6, k: 2000, stopAt: [2, 3] }],
  ["Finalize with entitlements still unpaid (0% cover)", { n: 5, k: 0, stopAt: [2, 3] }],
  ["Last member receives its payout", { n: 4, k: 10000 }],
  ["0% cover, seat 1 walks", { n: 5, k: 0, stopAt: [2] }],
  ["Seat 1 leaves in round 1; seats 2 and 3 stop after their payouts", { n: 4, k: 5000, stopAt: [1, 3, 4] }],
];