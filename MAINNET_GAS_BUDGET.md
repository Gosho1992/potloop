# PotLoop mainnet gas budget

> **Status (23 Nov 2026):** the first table is the *plan*, measured in a rehearsal on a local copy of mainnet with 0.05 QUSDC per round. The live runs used 0.02 QUSDC. Actual, receipt-based figures are in the last section and in [`MAINNET_FINANCIAL_RECONCILIATION.md`](MAINNET_FINANCIAL_RECONCILIATION.md).

Gas was measured by running every scenario in full on a local copy of QIE mainnet (block ~12,106,000, real QUSDC contract). Costs are priced at the mainnet gas price read on 2026-11-23: **1.125 gwei** (base fee 1 gwei). `scripts/mainnet-preflight.js` reprices everything at the live gas price before each step.

| Step | Transactions | Gas used (rehearsal) | QIE at 1.125 gwei | With 30% margin | QUSDC needed at once |
| --- | --- | --- | --- | --- | --- |
| Deploy factory (+ its deployer) | 1 | 5,569,779 (live estimate) | 0.00627 | 0.00815 | 0 |
| 1. Two-member smoke test | 27 | 5,419,266 | 0.00610 | 0.00793 | 0.30 |
| 2. Four-member lifecycle | 67 | 8,297,445 | 0.00933 | 0.01214 | 0.95 |
| 3. Collateral modes (2 circles) | 90 | 13,453,900 | 0.01514 | 0.01968 | 0.65 |
| 4. Default and recovery | 89 | 10,131,152 | 0.01140 | 0.01482 | 1.362 |
| 5. Six-member acceptance | 123 | 12,357,460 | 0.01390 | 0.01807 | 2.10 |
| **Total** | **397** | **55.2 million** | **0.0621** | **0.0808** | **2.10 peak** |

Each circle costs about 4 million gas just to create, because it is its own contract.

**What you need in your wallet**
- **QIE:** 0.0808 (all steps with margin) + 0.018 (member gas float: 0.003 per member wallet, swept back after each scenario) + 0.02 (reserve the scripts never touch) = **about 0.12 QIE**.
- **QUSDC:** **2.10** at once for the largest scenario. Everything comes back after each scenario, including the 0.5% fee, because your wallet is the treasury. Net QUSDC cost: 0.

**Limits the scripts enforce:** `BUDGET_QIE` (default 0.05 per scenario run; the largest needs at most 0.038 including the member float) and `RESERVE_QIE` (default 0.02). Either one stops the run *before* the transaction that would break it.

If the gas price changes, the QIE figures scale with it; the gas amounts don't.

## Actual mainnet use (23 Nov 2026, contribution 0.02 QUSDC)

The estimates above were measured with 0.05 QUSDC per round. The live runs used 0.02 QUSDC, so the QUSDC needed at the peak (the six-member circles) was 0.84 QUSDC. Gas does not depend on the amount.

| Run | Gas | Fees (QIE) |
| --- | --- | --- |
| Factory deployment (receipt) | 5,572,279 | 0.006269 |
| S1 | 5,416,868 | 0.006094 |
| S2 | 8,257,460 | 0.009290 |
| S3 | 13,347,195 | 0.015016 |
| S4 | 10,058,703 | 0.011316 |
| S5 (stopped; 37 transactions) | 6,262,276 | 0.007045 |
| S6 (finished S5's circle; 75 new transactions) | 5,406,499 | 0.006082 |
| S7 | 12,277,559 | 0.013812 |
| Returning funds to the owner (2 transactions) | 68,374 | 0.000077 |
| **Total, 511 unique transactions** | **66,667,213** | **0.075001** |

Total 0.075000614625 QIE including the deployment and the return of funds. Gas price was 1.125 gwei throughout. See [`MAINNET_TEST_RESULTS.md`](MAINNET_TEST_RESULTS.md).
