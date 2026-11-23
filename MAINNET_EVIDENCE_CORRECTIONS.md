# Mainnet evidence: corrections

Every error or ambiguity found in the v9.3 mainnet evidence and documentation, and what was done. None of them changes an on-chain result: every receipt, balance and circle state was re-read from QIE mainnet and agrees with the corrected figures ([`MAINNET_FINANCIAL_RECONCILIATION.md`](MAINNET_FINANCIAL_RECONCILIATION.md)).

| # | What was wrong | Correction | Where |
| --- | --- | --- | --- |
| 1 | `MAINNET_TEST_RESULTS.csv` said "one row per circle", but S5 and S6 have the same circle address on two rows | Replaced by three reports with one grain each: attempts, unique circles, unique transactions. The old file is kept, unchanged, in `mainnet-runs/legacy/` | `MAINNET_RUN_ATTEMPTS.csv`, `MAINNET_CIRCLES.csv`, `MAINNET_TRANSACTIONS.csv` |
| 2 | The same CSV repeated S3's scenario-wide totals (90 transactions, 13,347,195 gas) on both S3 circle rows, so a sum double-counted them | Per-circle figures computed per transaction: 45 transactions and 6,666,694 / 6,680,501 gas | `MAINNET_CIRCLES.csv` |
| 3 | S6 was reported as 112 transactions and 0.013127 QIE. That includes S5's first 37 transactions, also reported under S5 | Per attempt, S6 added 75 transactions (5,406,499 gas, 0.006082 QIE). The figure of 112 is correct only per circle (S5 + S6). Every total is now summed over unique hashes: 511 (1 deployment, 508 test, 2 return) | `MAINNET_RUN_ATTEMPTS.csv`, `MAINNET_FINANCIAL_RECONCILIATION.md`, `MAINNET_TEST_RESULTS.md`, `MAINNET_GAS_BUDGET.md` |
| 4 | "86 checks passed": S6's 14 include the 2 S5 checks carried with its circle | Stated explicitly: 84 checks in passing attempts, plus 2 that passed inside the failed S5 attempt | `MAINNET_TEST_RESULTS.md`, `MAINNET_RUN_ATTEMPTS.csv` |
| 5 | S1 appeared as one run. It was two attempts: the first runner sent 18 transactions and stopped at the 3-minute command limit; the resumable runner sent the other 9 | Two rows, A1 (interrupted, not a test failure) and A2 (pass) | `MAINNET_RUN_ATTEMPTS.csv` |
| 6 | The deployment was evidenced only by an address and a block in `deploy.log` | Deployment transaction recovered from the chain: `0xd2e9eac9…f147`, the only transaction in block 12,109,975. Its receipt's `contractAddress` is the factory: status 1, gas 5,572,279, fee 0.006268813875 QIE | `MAINNET_DEPLOYMENT_RECONCILIATION.md` |
| 7 | The gas budget listed the deployment at 5,575,127 gas (a rehearsal figure) | Receipt figure: 5,572,279 | `MAINNET_GAS_BUDGET.md` |
| 8 | The return of funds (2 transactions, 0.000077 QIE) was in no total | Included as attempt A9 | all three CSVs, reconciliation |
| 9 | `DEPLOYMENT_CHECKLIST.md` said no deployment was attempted; `MAINNET_TEST_ARCHITECTURE.md` said nothing was deployed; the README's v9.2/v9.2.1 sections said "Nothing has been deployed" | Current state written into each; the README's old sections are marked as describing that time; 23 older documents carry a "Historical document" banner | those files |
| 10 | The README's mainnet steps told users to create 4 demo wallets and deploy a factory; the runner uses 6 wallets and the factory already exists | Rewritten: the demo factory exists, a production factory follows `PRODUCTION_FACTORY_RECOMMENDATION.md`, test wallets are throwaway and must never be zipped | `README.md` |
| 11 | `TEST_EVIDENCE_V9_2_2.md` refers to an `evidence/` folder of raw logs that was never included in any delivered archive | Those v9.2.2 logs no longer exist; that document is now marked historical. v9.3 ships its raw logs, source hashes and exit codes in `evidence/v93-release/` | `evidence/v93-release/` |
| 12 | Nothing said whether the contracts were verified on the explorer; the deploy script only *printed* the verify commands | Checked through the explorer's API: **not verified** (factory known but unverified; deployer and circles have no record). Bytecode matching against this source is a separate result, and it passes | `MAINNET_DEPLOYMENT_RECONCILIATION.md` |
| 13 | The mainnet runs never called `CircleFactory.recordCircle()`, but nothing said so | Stated in the results; the flow is now tested locally and on a local copy of mainnet for all 7 real circles, with a one-transaction proposal | `LOCAL_FORK_EDGE_CASE_REPORT.md` |
| 14 | `MAINNET_TEST_MATRIX.md` described 0.05 QUSDC contributions; the live runs used 0.02 | Stated at the top; amounts in the S3 description corrected | `MAINNET_TEST_MATRIX.md` |
| 15 | In the evidence file, S1's "your wallet" figures first showed the balance at the time the run was adopted, not at its start | Corrected from the chain at the block before S1's first transaction (1.993504 QIE, 0.980746 QUSDC); adopted transactions' gas estimates show "—" (they were not recorded) | `MAINNET_TRANSACTION_EVIDENCE.md` |
| 16 | The evidence file did not warn that S6's table repeats S5's rows | Explained at the top; S5's rows are marked *(S5)* in S6's table | `MAINNET_TRANSACTION_EVIDENCE.md` |
| 17 | The source archive `potloop-v9.3.zip` contained 7 private keys | Incident handling, scan and fail-closed packaging | `SECURITY_INCIDENT_AND_KEY_ROTATION.md`, `SAFE_RELEASE_MANIFEST.md` |

## Labels used from now on

| Label | Meaning |
| --- | --- |
| **Live mainnet** | Sent to QIE mainnet (chain 1990) and re-read from its receipts. Only `mainnet-runs/live-S*.json` and the three CSVs |
| **Local copy of mainnet (fork)** | Real deployed contracts and real QUSDC code, run in-process; nothing sent. `mainnet-runs/fork-S*.json` (the pre-run rehearsals) and `mainnet-runs/reconciliation/fork-*.json` (v9.3 release checks) |
| **Local** | Hardhat's in-process chain with test tokens (`evidence/v93-release/`) |
| **Historical** | Written for an earlier version; describes that time |
| **Unverified assumption** | Listed as such in `FINAL_RELEASE_READINESS.md` (for example QIE's hardfork history, Safe availability) |
