# PotLoop mainnet test results (QIE mainnet, chain 1990, 23 Nov 2026)

All runs used one factory deployment and real QUSDC. Every transaction is listed with its explorer link in [`MAINNET_TRANSACTION_EVIDENCE.md`](MAINNET_TRANSACTION_EVIDENCE.md); the raw reports are in `mainnet-runs/live-S*.json`. The corrected, receipt-based reports are [`MAINNET_RUN_ATTEMPTS.csv`](MAINNET_RUN_ATTEMPTS.csv) (one row per attempt), [`MAINNET_CIRCLES.csv`](MAINNET_CIRCLES.csv) (one row per circle) and [`MAINNET_TRANSACTIONS.csv`](MAINNET_TRANSACTIONS.csv) (one row per transaction), with totals in [`MAINNET_FINANCIAL_RECONCILIATION.md`](MAINNET_FINANCIAL_RECONCILIATION.md). The old `MAINNET_TEST_RESULTS.csv` mixed attempts and circles and is kept only in `mainnet-runs/legacy/`.

- Factory [0xD099c7361157Ec20a9Ac145aF4B66Af553AeDae4](https://mainnet.qie.digital/address/0xD099c7361157Ec20a9Ac145aF4B66Af553AeDae4) (deployer [0xb24EcA9a5cbdab9e05963d22461f1d704ac41B00](https://mainnet.qie.digital/address/0xb24EcA9a5cbdab9e05963d22461f1d704ac41B00)), version 92, fee 0.5%, demo minimums: 60 s rounds, 30 s grace, 0.01 QUSDC.
- Contribution 0.02 QUSDC per round in every circle.

| Run | What it tests | Circle(s) | Result | Transactions | Fees (QIE) |
| --- | --- | --- | --- | --- | --- |
| S1 | 2 members, 100% cover: join, pay, payout, finalize, withdraw | [0x4a26…F291](https://mainnet.qie.digital/address/0x4a26e0c8f314a752FBd7EB82375B4066b4D1F291) | PASS, 10/10 | 27 | 0.006094 |
| S2 | 4 members, 50% cover, full lifecycle | [0x84f7…E421](https://mainnet.qie.digital/address/0x84f78c7aE65dc91c6C1367a33366380EC49Ce421) | PASS, 12/12 | 67 | 0.009290 |
| S3 | Same 3-member circle, collateral up front vs from the pot: identical results | [0x27A3…4Ec0](https://mainnet.qie.digital/address/0x27A34e931156781BA256A353d7aBb28DBF464Ec0), [0x474E…E110](https://mainnet.qie.digital/address/0x474E6c16b43ff480f078186e6278451babB7E110) | PASS, 23/23 | 90 | 0.015016 |
| S4 | 5 members, 20% cover: seat 1 takes the pot and stops, collateral pays, catch-up, repayment | [0xe746…c804](https://mainnet.qie.digital/address/0xe7461b1505f74663707786C3fc22bCBB8aaAc804) | PASS, 13/13 | 89 | 0.011316 |
| S5 | 6 members, 100% cover, full lifecycle | [0x905F…6526](https://mainnet.qie.digital/address/0x905Fc41c695bf97A915B2dEA901bC4bE6edA6526) | **FAIL**: stopped in round 1 (see below) | 37 | 0.007045 |
| S6 | S5's circle finished as it actually stood | same circle as S5 | PASS, 14/14 | 75 more (112 with S5's) | 0.006082 more |
| S7 | S5 repeated, each round's payments sent in parallel | [0x6330…B054](https://mainnet.qie.digital/address/0x6330787fFc96019D1806C8e2EAb0C34d3202B054) | PASS, 14/14 | 123 | 0.013812 |

Totals: 7 circles completed; 1 attempt failed (S5); 508 unique test transactions (507 successful, 1 reverted); 0.068655 QIE in test fees plus 0.006269 QIE for the factory deployment and 0.000077 QIE to return the funds (0.075001 QIE in all). Checks: 86 passed across the completed scenario reports. S6's 14 include the 2 S5 checks that came with its circle (factory registered it, circle is new), so 84 checks passed in passing attempts and 2 in the failed S5 attempt. History recording (`recordCircle`) was **not** part of these runs: see [`LOCAL_FORK_EDGE_CASE_REPORT.md`](LOCAL_FORK_EDGE_CASE_REPORT.md). Every member wallet ended with exactly the simulator's predicted result, every circle ended holding 0 QUSDC, and the treasury received exactly the predicted fee each time. All QUSDC and QIE were returned to the main wallet at the end (`mainnet-runs/logs/return-to-main.log`).

## What happened in S5

S5's members paid one after another, two transactions each (approve, then pay), so a round needed 12 confirmed transactions. Mainnet confirmations took about 8 s each, so the 12th transaction, Farah's round-1 payment ([0xbc1978dd…](https://mainnet.qie.digital/tx/0xbc1978dd7a431bbe7c911bbe5bc4e4970c235eb8325446f0074c0457daf993bf)), arrived 34 s after the round's 60 s deadline and the contract refused it, as it should. The runner stopped there; nothing was retried.

- **S6** finished that same circle without changing anything: Farah had missed a round before her payout, so the contract treated her as leaving. Her 0.02 QUSDC collateral covered round 1 and the other five shared it. The simulator was given exactly that path (Farah stops at round 1) and every state change matched it, including Farah's loss of 0.02 and the others' gain of 0.0034 each.
- **S7** repeated S5's settings unchanged. The only difference is in the test runner: each round's approvals are sent together, then the payments together (they come from different wallets), so a round takes about 20 s instead of 90 s. All 14 checks passed.

Lesson for the product: with real rounds measured in days this cannot happen, but it shows the deadline is strict and that a member who pays seconds late before receiving the pot loses their collateral. The app should warn members as the deadline approaches.

## How the runs were made

The S1 row combines two attempts: the first runner sent 18 transactions and was stopped by the command time limit, then the resumable runner sent the other 9.

The first runner was written to run a whole scenario in one go. The commands that ran it from this computer stop after at most 3 minutes, so it stopped part-way through S1. `scripts/mainnet-step-runner.js` does the same steps and checks but saves its progress after every step and continues exactly where it stopped; a transaction that was sent but not yet confirmed is waited for, never sent again. S1's first 18 transactions came from the first runner and were re-read from their receipts. `scripts/mainnet-step.sh <n>` runs one slice; repeat it until it prints `SCENARIO COMPLETE`.

Every run was within its 0.05 QIE budget and kept the 0.02 QIE reserve. S6 and S7 were added after S5 stopped and have their own approval codes (`S6-5b66b7df`, `S7-813b37b2`), run under the go-ahead given for the five tests.
