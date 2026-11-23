# V9.1 testing handoff (for Claude Code or any reviewer)

> **Historical document.** Written for an earlier version, before the QIE mainnet deployment of 23 Nov 2026. Statements about what has or has not been deployed, which wallets to create and test counts describe that time. Current state: [`FINAL_RELEASE_READINESS.md`](FINAL_RELEASE_READINESS.md).

Run from the project folder after `npm install` (and `npm install` in `app/`).

| Step | Command | Expected |
| --- | --- | --- |
| 1 | `npx hardhat compile --force` | 16 files, no errors |
| 2 | `npx hardhat test` | 68 passing, 3 pending |
| 3 | `npx hardhat test test/Sim.parity.test.js` | 1 passing (120 scenarios, simulator = contract) |
| 4 | Mutation check: change `LATE_FEE_BPS` in `app/src/sim.js` to `300n`, rerun step 3 | Fails. Restore the file afterwards |
| 5 | `INVARIANT_RUNS=1500 npx hardhat test test/SavingsCircle.invariants.test.js` | Passing |
| 6 | `EXHAUSTIVE=1 npx hardhat test test/SavingsCircle.exhaustive.test.js` (about 45 min) | 3 passing |
| 7 | `node scripts/payoff-matrix.mjs` | Regenerates `docs/PAYOFF_MATRIX.md`; 100% cover column of the summary is all 0 |
| 8 | `cd app && npm run build` | Builds |
| 9 | Local demo: window 1 `npx hardhat node`; window 2 `npx hardhat run scripts/demo-local.js --network localhost`; window 3 `cd app && npm run dev`, open the printed link | Seat tab shows "Your commitment / exposure / What if"; risk tab has the What-if panel |
| 10 | Create screen: 3 members, 50% cover | Seat 1 card says it would be 1 better off by walking away and others lose 0.995 (per 1 contribution, 0.5% fee); never "covers every round" below 100% |

Scenarios worth checking by hand in the What-if panel: seat 1 stops from round 2 and never catches up (20% cover); same with a catch-up in round 4 (members paid short are repaid); several early seats stop together; the last seat leaves in round 1.
