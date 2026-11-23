# PotLoop mainnet test architecture

> **Status (23 Nov 2026):** the factory below is **deployed** (`0xD099c7361157Ec20a9Ac145aF4B66Af553AeDae4`, block 12,109,975, transaction `0xd2e9eac9…f147`) and the scenarios have run: [`MAINNET_DEPLOYMENT_RECONCILIATION.md`](MAINNET_DEPLOYMENT_RECONCILIATION.md), [`MAINNET_TEST_RESULTS.md`](MAINNET_TEST_RESULTS.md). The runs used `scripts/mainnet-step-runner.js` (resumable) after the first runner hit a 3-minute command limit. Its treasury key was later exposed: [`SECURITY_INCIDENT_AND_KEY_ROTATION.md`](SECURITY_INCIDENT_AND_KEY_ROTATION.md). It is a demo deployment, not a production one.

## One deployment, many independent circles

Checked in the code:

- `CircleFactory.createCircle` deploys a brand-new `SavingsCircle` contract through the factory's own `CircleDeployer` each time. Each circle has its own address, its own token balance, its own ledgers and its own members. Nothing is shared between circles except the read-only factory rules and the factory's track-record counters.
- Circles cannot touch each other's money. A circle only moves tokens it holds, and every transfer in or out is checked against its own ledgers. The runner also proves this on chain: before and after every scenario it reads the QUSDC balance of every earlier circle and requires it to be unchanged.
- **So five scenarios need ONE factory deployment**, not five. That deployment was made on 23 Nov 2026 and every run used it.

## The one deployment (approved and made, 23 Nov 2026)

`scripts/deploy-factory.js` with `MODE=demo` on `--network qieMainnet`:

| Setting | Value | Why |
| --- | --- | --- |
| Token | QUSDC `0x3F43DA82eC9A4f5285F10FaF1F26EcA7319E5DA5` | pinned by the script on mainnet, 6 decimals checked |
| Minimum round / grace | 60 s / 30 s | circles can still choose weekly or monthly rounds; production minimums (1 day) would make the 5 scenarios take weeks |
| Minimum contribution | 0.01 QUSDC | the live scenarios used 0.02 QUSDC |
| Minimum cover | 0% | scenario 4 needs cover below 100% to show short payouts and repayments; the app requires a risk acknowledgement below 100% |
| Fee | 0.5% to the test wallet (treasury) | the fees came back to the owner, so the test's net QUSDC cost was 0. That wallet's key was later exposed, so this factory must stay a demo |

The factory creates its `CircleDeployer` in the same transaction. Both are immutable, with no owner. Every setting is fixed forever, and it is the factory the app and the judges will use.

## Safety built into the scripts

| Rule | How |
| --- | --- |
| Dry run first | `MODE=fork` runs every scenario on a local copy of QIE mainnet with the real QUSDC; nothing is sent |
| Read-only check | `scripts/mainnet-preflight.js` sends nothing: balances, gas price, factory verification, per-scenario cost, GO / NO-GO |
| Explicit approval per batch | the deployment needs `APPROVE_DEPLOY`, and each scenario needs `APPROVE`. Each code is a hash of that exact plan (chain, factory, your address, member addresses, budget, reserve, scenario); change anything and the code changes |
| Spending limit | every transaction's gas is estimated and priced first; the run stops before any transaction that would push its fees over `BUDGET_QIE` or your wallet below `RESERVE_QIE` |
| No blind retries | a failure stops the run; if the transaction was broadcast, its hash is printed so you can check the explorer first |
| No keys in files | your key only in the PowerShell window (`DEPLOYER_PRIVATE_KEY`); member keys only in `demo-wallets.json` on your computer (git-ignored). Reports contain addresses and hashes only |
| No contract bypass | real time is waited for round deadlines and the cure window; collateral, cover and authorization all go through the contracts |
| Verified deployment | the runner and preflight compare the factory's and deployer's on-chain code byte by byte with this build (immutable values aside) and check the deployer points back |
| No carried balances | every scenario requires the member wallets to start with 0 QUSDC, funds them for that circle only, and sweeps them back at the end |

## Files

- `scripts/mainnet-preflight.js`: the read-only check.
- `scripts/mainnet-test-runner.js`: the scenarios (`MODE=fork` or `MODE=live`).
- `scripts/mainnet/scenarios.js`: the five scenario definitions.
- `scripts/mainnet/harness.js`: verification, the budget ledger, snapshots and approval codes.
- `scripts/mainnet/gas-table.json`: gas measured in the rehearsal.
- `scripts/mainnet-evidence.js`: builds `MAINNET_TRANSACTION_EVIDENCE.md`.
- Output: `mainnet-runs/*.json` (one report per run), `MAINNET_TEST_RESULTS.csv` (one row per circle).

## Differences from the plan we were given

1. "Reuse the existing deployment": there is none yet, so the plan starts with one deployment.
2. Production minimums (1-day rounds) would make the scenarios take weeks, so the test factory uses demo minimums. That doesn't limit real circles, which can still choose long rounds.
3. "Partial repayment" (scenario 4) needs cover below 100%, so the factory's minimum cover is 0%.
4. Scenario 3 creates two circles (one per collateral mode), so the five scenarios create six circles.
5. "Approval before every batch" is enforced by approval codes in the scripts, not just by convention.
6. A separate gas-estimation mode on live mainnet isn't possible for later steps, because they depend on the earlier ones being executed. The estimates come from the full rehearsal on a mainnet copy (same EVM, same token) plus a 30% margin, priced at the live gas price by the preflight.
