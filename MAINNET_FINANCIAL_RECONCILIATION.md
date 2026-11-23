# Mainnet financial reconciliation

Independent of the test runner. Every figure is recomputed from QIE mainnet on 23 Nov 2026, from transaction receipts (gas, fees, status) and from every QUSDC `Transfer` log that touches a test circle or a test wallet (blocks 12,089,975 to 12,112,685; 251 transfers). The runner's own records are used only to label transactions, and are then checked against these figures.
Sources: `mainnet-runs/reconciliation/onchain.json`, `token-flows.json`, `summary.json`. Rebuild: `node scripts/build-mainnet-reports.js`.

## Transactions and gas

| | Unique transactions | Successful | Reverted | Gas used | Fee (QIE) |
| --- | --- | --- | --- | --- | --- |
| Factory deployment (A0) | 1 | 1 | 0 | 5,572,279 | 0.006268813875 |
| Test runs S1–S7 (A1–A8) | 508 | 507 | 1 | 61,026,560 | 0.068654880000 |
| Return of funds to the owner (A9) | 2 | 2 | 0 | 68,374 | 0.000076920750 |
| **Total** | **511** | **510** | **1** | **66,667,213** | **0.075000614625** |

Gas price was 1.125 gwei for every transaction. The one reverted transaction is Farah's round-1 payment in S5 ([`0xbc1978dd…`](https://mainnet.qie.digital/tx/0xbc1978dd7a431bbe7c911bbe5bc4e4970c235eb8325446f0074c0457daf993bf)). It was mined after the payment window had closed: gas used 77,149, fee 0.000086792625 QIE, included above.

### By attempt (no transaction counted twice)

| Attempt | Scenario | New transactions | Gas | Fee (QIE) |
| --- | --- | --- | --- | --- |
| A1 | S1, first runner (stopped by the 3-minute command limit) | 18 | 4,917,857 | 0.005532589 |
| A2 | S1, resumed | 9 | 499,011 | 0.000561387 |
| A3 | S2 | 67 | 8,257,460 | 0.009289643 |
| A4 | S3 (two circles, 45 transactions each) | 90 | 13,347,195 | 0.015015594 |
| A5 | S4 | 89 | 10,058,703 | 0.011316041 |
| A6 | S5 (failed) | 37 | 6,262,276 | 0.007045061 |
| A7 | S6 (continuation of S5's circle; only its own new transactions) | 75 | 5,406,499 | 0.006082311 |
| A8 | S7 | 123 | 12,277,559 | 0.013812254 |

The earlier `MAINNET_TEST_RESULTS.md` and `MAINNET_TRANSACTION_EVIDENCE.md` gave S6 as 112 transactions and 0.013127 QIE. Those figures include S5's 37 transactions. The per-circle view in `MAINNET_CIRCLES.csv` gives circle 6 (S5 + S6) 112 transactions and 0.013127 QIE, which is correct *per circle*; per attempt, S6 added only 75. Totals here are summed per unique hash.

## QUSDC

| Flow | QUSDC |
| --- | --- |
| Test wallet received from the owner's swap (before any test) | 0.980746 |
| Test wallet → members (funding, all scenarios) | 3.224800 |
| Members → circles (collateral, contributions, catch-ups) | 3.104800 |
| Circles → members (payouts, collateral returns, refunds) | 3.091900 |
| Circles → treasury (fees) | **0.012900** |
| Members → test wallet (returned after each scenario) | 3.211900 |
| Test wallet → owner's main wallet (end) | 0.980746 |

Checks, all exact to the base unit:

- **Circles:** in 3.104800 = out to members 3.091900 + fees 0.012900. Each circle's in equals its out (`MAINNET_CIRCLES.csv`), and each holds 0 today.
- **Members:** across all circles they lost exactly 0.012900, the fees. Funded 3.224800, returned 3.211900.
- **Test wallet:** 0.980746 + 3.211900 returned + 0.012900 fees − 3.224800 funded − 0.980746 sent to the owner = **0**.
- **Treasury income:** 0.012900 QUSDC. The treasury is the test wallet, which withdrew each fee and sent it on to the owner as part of the 0.980746. By circle: S1 0.0004, S2 0.0016, S3-upfront 0.0009, S3-from-pot 0.0009, S4 0.0025, S5/S6 0.0030, S7 0.0036.

### Every member in every circle

On-chain net = what the circle paid the member minus what the member paid in. It agrees with the runner's simulator-based check in all 29 member-circle pairs.

| Circle | Member results (net QUSDC) |
| --- | --- |
| S1 `0x4a26…F291` | Sipho −0.0002, Thandi −0.0002 (each pays the 0.5% fee on their pot) |
| S2 `0x84f7…E421` | each of 4: −0.0004 |
| S3-upfront `0x27A3…4Ec0` | each of 3: −0.0003 |
| S3-from-pot `0x474E…E110` | each of 3: −0.0003 (identical to upfront mode, as designed) |
| S4 `0xe746…c804` | Sipho −0.00114 (fee plus 2% late fee on the 0.04 he caught up), the other four −0.00034 each (fee minus their share of the late fee) |
| S5/S6 `0x905F…6526` | Farah −0.02 (her collateral, forfeited when her payment arrived after the deadline, before her turn); the other five +0.0034 each (their share of it, after fees) |
| S7 `0x6330…B054` | each of 6: −0.0006 |

## Final balances (read 23 Nov 2026)

| Address | QIE | QUSDC |
| --- | --- | --- |
| All 7 circles | — | 0 each; ledgers 0; nothing withdrawable |
| Test wallet / treasury `0x918D…db76` | 0.00004725 | 0 |
| Each of the 6 member wallets | 0.000023625 | 0 |
| Owner's main wallet `0x7145…6910` | 17.224441 | 0.980746 |

The member wallets keep 2 × 21,000 gas worth of QIE by design: the runner's sweep leaves enough to pay for its own transfer.

## Owner's cost

- QIE spent on gas: 0.075000614625 (deployment 0.006269, tests 0.068655, returning funds 0.000077).
- QUSDC: none lost. The 0.980746 QUSDC came back in full, fees included.
- Not reconciled here: the QIE the owner converted into the 0.980746 QUSDC before testing (an exchange, not a test cost), and the 8 QIE sent to the test wallet. The test wallet's remaining 1.924583 QIE was returned to the owner (`MAINNET_TRANSACTIONS.csv`, attempt A9).
