# V9.1 changelog

> **Historical document.** Written for an earlier version, before the QIE mainnet deployment of 23 Nov 2026. Statements about what has or has not been deployed, which wallets to create and test counts describe that time. Current state: [`FINAL_RELEASE_READINESS.md`](FINAL_RELEASE_READINESS.md).

**Fixed**
- Create screen said seat 1's default risk was zero at every cover level (its calculation only modelled earlier seats defaulting). Every seat now shows its own walk-away exposure, the cost to the members paid after it, and its payout shortfall if earlier seats default.

**Added**
- `app/src/sim.js`: exact settlement simulator (settle, catchUp, finalize, fees, penalties, reserve, netting, refunds). `test/Sim.parity.test.js` proves it matches the contract to the base unit across 120 random scenarios.
- `app/src/SeatRisk.jsx`: one shared "commitment / exposure / what if" view, used on the create, join (link) and seat screens. Contract figures from `seatTerms()`, labelled; formula fallback labelled.
- `app/src/WhatIf.jsx`: choose who stops paying, from which round, and whether they catch up; see every member's outcome. On the create screen and the risk tab.
- `CircleFactory.minCoverageBps` (constructor argument): a deployment can require a minimum cover. `deploy-factory.js`: production mode defaults to 100%, demo mode to 0% (`MIN_COVER_BPS` overrides). **New factory deployment required.**
- `scripts/payoff-matrix.mjs` → `docs/PAYOFF_MATRIX.md`: honest, walk-away, catch-up, leave-early and coordinated-default outcomes for 2/3/6/12 members, every cover, every seat.
- Demo story in `scripts/demo-mainnet.js`: default at 20% cover, shortfall recorded, catch-up repays the members paid short (`COVERAGE_BPS`, `CATCH_UP_ROUND`).

**Removed**
- `app/src/worstCase.js` and `worstCaseForConfig` (the model behind the bug).

**Unchanged**
- `SavingsCircle.sol` logic. Last-seat collateral floor kept as a joining bond (see `SUGGESTION_EVALUATION.md`).
