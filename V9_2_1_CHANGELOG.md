# V9.2.1 changelog

> **Historical document.** Written for an earlier version, before the QIE mainnet deployment of 23 Nov 2026. Statements about what has or has not been deployed, which wallets to create and test counts describe that time. Current state: [`FINAL_RELEASE_READINESS.md`](FINAL_RELEASE_READINESS.md).

**Contracts (new factory deployment required)**
- Fixed: in from-pot mode, collateral held from pot money now always targets the member's seat amount (`collateralFor(seat)`), for the original payout and every later repayment. v9.2 used the round the money arrived in, so a late repayment of a very short payout could leave collateral below the seat's amount, and a catch-up at the start of a round targeted one round too few.
- Changed: the join amount in from-pot mode is `min(collateralFor(seat), contribution)` instead of `contribution × cover`. Leaving before your turn now costs exactly what it costs in upfront mode. Still at most one share to join.
- New `CircleDeployer`, created by the factory and usable only by it. Factory runtime drops from 24,481 to 6,492 bytes; every contract now has at least 5.5 KB of runtime headroom.

**Tests and evidence**
- `test/circleRunner.js`: rules R1–R3 on the contract's state after every transaction, independent of the simulator; used by the parity, regression and lifecycle tests.
- `test/SavingsCircle.v921.test.js`: regression scenarios A–E with exact numbers, the deployer's access control, and bytecode size limits.
- `test/ModeLifecycle.test.js`: the lifecycle situations on the contract in both modes.
- The parity suite adds the short-payout repayment scenarios (34 tests in total).
- `scripts/mutation-sim.mjs`: 14 mutations, including the old rule placed in both the contract and the simulator (caught by R2).
- `scripts/compare-modes.mjs` generates `docs/MODE_COMPARISON.md`, an exhaustive comparison of both modes for 3–5 members.
- The exhaustive suite now covers both collateral modes.
- `scripts/bytecode-sizes.js`, `scripts/fork-production-check.js` (production settings with real QUSDC on a local copy of QIE mainnet), and `scripts/testnet-deploy.js` (QIE testnet only).
- `scripts/run-evidence.sh` runs all of these (the fork check with `FORK_URL`, the exhaustive suite with `EXHAUSTIVE=1`).

**App**
- The seat card separates pot, fee, collateral held back and the withdrawable amount. History lines say "before the fee and any collateral held back". The members table shows collateral against the seat's full amount. The create screen describes the remaining mode difference.

**Scripts**
- The demo prints a mainnet explorer link only on mainnet (or with `EXPLORER`). `deploy-factory.js` prints and verifies the deployer.
