# PotLoop mainnet test matrix

> **Status (23 Nov 2026):** S1–S5 were run on QIE mainnet with **0.02 QUSDC** per round (the plan below says 0.05; it was lowered to fit the QUSDC available). S5 failed on timing; S6 and S7 were added (rows below). Results: [`MAINNET_TEST_RESULTS.md`](MAINNET_TEST_RESULTS.md). Tests that need no real funds (12 members, 0% cover, upfront-mode defaults, history recording) were run locally and on a local copy of mainnet instead: [`LOCAL_FORK_EDGE_CASE_REPORT.md`](LOCAL_FORK_EDGE_CASE_REPORT.md).

Each scenario runs alone (`$env:SCENARIO="n"`), creates its own new circle(s) on the one factory, and uses member wallets that start empty and are swept back afterwards. Contribution 0.05 QUSDC, rounds of 60 s with 30 s grace, 0.5% fee.

| # | Scenario | Circle(s) | Pattern | What it proves |
| --- | --- | --- | --- | --- |
| 1 | Two-member smoke test | 2 members, 100% cover, collateral from the pot | everyone pays | join, contribute, payout with collateral held from the pot, finalize, withdraw |
| 2 | Normal lifecycle | 4 members, 50% cover, from the pot | everyone pays, 4 rounds | a complete multi-round circle |
| 3 | Collateral modes compared | two circles: 3 members, 100% cover, upfront vs from the pot | everyone pays | identical net results; upfront locks 2 shares for seat 1 vs 1 share from the pot (0.04 vs 0.02 QUSDC in the live run) |
| 4 | Default and recovery | 5 members, 20% cover, from the pot | seat 1 takes the pot, misses round 2, catches up in round 4 | collateral pays, payouts short, entitlements recorded, catch-up with late fee, repayments oldest first, reserve reconciled |
| 5 | Full acceptance | 6 members, 100% cover, from the pot | everyone pays, 6 rounds | all payouts, finalize, all withdrawals |
| 6 | S5's circle, finished as it stood (added) | same circle as 5 | Farah's round-1 payment refused after the deadline: she leaves before her turn | a pre-payout default on mainnet: collateral forfeited to the others, payout cancelled |
| 7 | S5 repeated (added) | new circle, as 5 | everyone pays; each round's payments sent in parallel | the full six-member lifecycle |

## Checks in every circle (exact, in QUSDC base units)

- **Factory:** it registered the new circle, and the circle is new.
- **State:** after every catch-up, every round's payments, every settle and finalize, the circle's full state equals the simulator's. That covers each member's status, collateral, payments, entitlements, losses, refunds, penalties and withdrawable balance, plus the round fund, reserve, treasury share and quoted catch-up cost.
- **Withdrawals:** every member withdraws, and a second withdrawal reverts with `NothingToWithdraw`.
- **Fee:** the fee owed to the treasury equals the simulator's, and the treasury receives exactly that.
- **Members:** each member's wallet change equals the simulator's net result.
- **Circle balance:** the circle holds 0 QUSDC after everyone has withdrawn.
- **Other circles:** every earlier circle's balance is unchanged.
- **Scenario 3 only:** every member's net result is identical in both modes.

## Rehearsal result (local copy of QIE mainnet, real QUSDC; not mainnet evidence)

All 5 scenarios **PASS**: 72 checks, 0 failed, 396 transactions (`MAINNET_TEST_RESULTS.csv`, rows with mode `fork`).

## Mainnet result (QIE mainnet, 23 Nov 2026)

S1 PASS 10/10, S2 PASS 12/12, S3 PASS 23/23, S4 PASS 13/13, S5 FAIL (a payment arrived after the 60 s deadline), S6 PASS 14/14 (S5's circle finished as it stood), S7 PASS 14/14 (S5 repeated with parallel payments). Details: [`MAINNET_TEST_RESULTS.md`](MAINNET_TEST_RESULTS.md).
