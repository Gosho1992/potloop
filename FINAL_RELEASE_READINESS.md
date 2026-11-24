# PotLoop v9.3: final release readiness

> **Update, 24 Nov 2026.** Done since this assessment: the **production factory** is deployed and source-verified at `0xE1ea943b865F47e984156526add5E07B03893834` (1-day rounds, 6 h grace, 1 QUSDC minimum, 100% cover, no fee, no treasury), from the owner's own QIE Wallet; the app creates new circles there and still opens the 7 test circles, marked as such. `recordCircle` ran on mainnet for S4 ([transaction](https://mainnet.qie.digital/tx/0xedad45665b5dad667e7729867012c74c3fb9c774ed41cd8adccbf8525c28099f)): 331,272 gas, as predicted on the local copy of mainnet (M4 resolved). A person used the real QIE Wallet on mainnet (`REAL_WALLET_TEST.md`; H5 partly resolved). UI acceptance is 26/26. Still open: independent audit (H4), QUSDC issuer risk (H3, disclosed in the app), the rest of the manual wallet checklist, and deleting the exposed key files (C1).

## Recommendation

**PotLoop is live on QIE mainnet and ready for a hackathon demonstration. Before a controlled external pilot it needs the items under "What a pilot still needs" below; production also needs a multisig treasury.**

### Why a demonstration is supported

- **The contracts work on QIE mainnet with the real QUSDC.** Seven circles ran end to end: joining, payments, payouts, a post-payout default and catch-up (S4), a pre-payout default (S6), both collateral modes (S3), finalize and withdrawals. All 511 transactions were re-read from their receipts. Every circle ends at 0 QUSDC with nothing owed, and in all 29 member-circle pairs the result agrees with the on-chain transfer logs (`MAINNET_FINANCIAL_RECONCILIATION.md`).
- **The deployed code is this code.** The factory, deployer and all 7 circles match this source's build byte for byte, apart from the immutable values, and the deployment transaction was recovered (`MAINNET_DEPLOYMENT_RECONCILIATION.md`).
- **The local evidence is complete and recorded:**
  - 142 tests passing (6 pending: the exhaustive tests, run separately), with every ledger rebuilt independently after each step.
  - 19 new release-acceptance tests, computed by hand.
  - 1,500 random invariant runs.
  - 15/15 mutations caught.
  - The exhaustive suite: all 6 combinations of collateral mode and 0/50/100% cover, 46,656 of 46,656 default patterns passed, every process exiting 0.
  - Slither (13 known, reviewed items).
  - Raw logs and exit codes in `evidence/v93-release/` (`LOCAL_FORK_EDGE_CASE_REPORT.md`).
- **The real app works end to end.** The production build passed 26/26 browser cases, from connecting a wallet to withdrawing: wrong network, rejected signature, pending transaction, RPC failure, refresh and disconnect. Two app bugs found this way were fixed (`UI_E2E_REPORT.md`).
- **History recording works**, locally and on a local copy of mainnet against all 7 real circles (34/34), without moving money.

### What a pilot still needs

Each of these is a blocker, and the pilot needs all of them resolved:

1. ~~**The demo factory cannot serve real users.**~~ Resolved 24 Nov 2026: production factory `0xE1ea943b865F47e984156526add5E07B03893834` deployed and verified.
   - Its treasury key is exposed and immutable (H1).
   - Its rules allow 60-second rounds and 0% cover (H2).
   - Real users need a new factory (`PRODUCTION_FACTORY_RECOMMENDATION.md`), which needs the owner's approval to deploy.
2. **The real QIE Wallet has not been tested by a person** (H5). The automated suite uses a scripted wallet; `POTLOOP_UAT_PLAN.md` is ready to execute.
3. **No independent audit** (H4).
4. **QUSDC's administrator can burn any holder's QUSDC, a circle's included** (H3). Members must be told before they deposit, and amounts limited.
5. ~~The source is not verified on the explorer~~: the factory is now verified, with all three contracts' sources (M2).
6. **The exposed key files still exist** on the owner's computer and with the reviewer (C1, human action).

**Production** additionally needs a multisig treasury. Safe is not available on QIE today (L3). It also needs the pilot's results.

## How the test counts fit together

All counts below are actual recorded results. None was adjusted to match another.

| Count | What it is | Scope and why it differs from other counts |
| --- | --- | --- |
| **142 passing, 6 pending** | `npx hardhat test`, local, this source | v9.2.2 reported 123 passing; the difference is the 19 new release-acceptance tests. The 6 pending are the exhaustive combinations, skipped unless `EXHAUSTIVE=1` and run separately below |
| **19** | `test/ReleaseAcceptance.test.js` | Part of the 142; hand-computed expectations |
| **1,500** random circles | invariant test with `INVARIANT_RUNS=1500` | One mocha test (counted once in the 142 at its default 150 runs); run again separately at 1,500 |
| **46,656 / 46,656** patterns | exhaustive suite, 6 combinations × 7,776 | Same pattern count as v9.2.1's run; this time every step also runs the independent ledger check |
| **15 / 15** | mutation check | Unchanged count from v9.2.2; contracts and simulator unchanged |
| **22 / 22** | browser cases, production build, scripted wallet | Not the real QIE Wallet (manual plan pending) |
| **34 / 34** | `recordCircle` checks on a local copy of mainnet against the 7 real circles | 4 checks per circle (events, recorded, `AlreadyRecorded`, no money moved) = 28, plus the cumulative history of the 6 member addresses = 6. Separate from the 3 local history tests in the 19 and from E2E-16 |
| **511** transactions | all re-read from QIE mainnet receipts | 1 deployment + 508 test + 2 returning funds; 510 succeeded, 1 reverted (S5) |
| **7** circles | factory, deployer and all 7 circles: bytecode matches; all Completed, holding 0 | — |
| **86** checks | the live mainnet runner's checks across the scenario reports | 84 in passing attempts plus 2 inside the failed S5 attempt, carried with S6's circle (`MAINNET_EVIDENCE_CORRECTIONS.md`) |

## Findings

Severity: Critical / High / Medium / Low. Status: verified (confirmed true), fixed, tested, unresolved, requires human action.

| ID | Severity | Finding | Status | Evidence / next action |
| --- | --- | --- | --- | --- |
| C1 | **Critical** | Private keys of the test funder (also the demo factory's deployer and treasury) and of all six test members were in `potloop-v9.3.zip`, which was shared outside | **verified**; value at risk contained (0.00019 QIE of dust; all circles empty); scan and fail-closed packaging **fixed and tested**; **requires human action** | `SECURITY_INCIDENT_AND_KEY_ROTATION.md`: delete the key files, the 158 MB ZIP and `upd-s6s7.tgz`; ask the reviewer to delete their copy; retire the 7 addresses |
| H1 | High | The demo factory's treasury is immutable and its key is exposed: whoever holds it collects the 0.5% fee of every future circle on that factory | **verified**; **unresolved by design** (cannot be changed) | Demo use only. New factory for any real use, with fee 0 (no treasury) or a multisig |
| H2 | High | Demo factory rules (60 s rounds, 30 s grace, 0.01 QUSDC, 0% cover) are unsafe for real groups: S5 showed a seconds-late payment forfeits collateral; below 100% cover early seats profit by walking away | **verified**; **requires human approval** for a new factory | `PRODUCTION_FACTORY_RECOMMENDATION.md` (1 day, 6–12 h, 1 QUSDC, 100%, fee 0 for the pilot; about 0.0063 QIE) |
| H3 | High | QUSDC's `DEFAULT_ADMIN_ROLE` is a single ordinary wallet that can grant `VAULT_ROLE`; that role can `burn(from, amount)` from any address, including a circle, and mint | **verified** (explorer-verified source, role events, `hasRole`); impact **tested** with a model token; **unresolved** (outside PotLoop) | Disclose in the app and to members; cap amounts per round in the pilot; README updated |
| H4 | High | No independent smart-contract audit | **unresolved**; **requires human action** | Commission a review of this exact source before the pilot |
| H5 | High | The real QIE Wallet (extension and mobile) has not been accepted by a person | **unresolved**; plan **ready**; **requires human action** (stage B also needs approval for small mainnet amounts) | `POTLOOP_UAT_PLAN.md`, `UAT_TEST_CASES.csv` |
| M1 | Medium | With the RPC unreachable, the app labelled a genuine circle "not created by PotLoop's official factory" and said the network was the wrong chain | **fixed and tested** (E2E-20) | `app/src/chain.js`, `App.jsx` |
| M2 | Medium | Factory and deployer source not verified on the explorer (bytecode does match) | **fixed for the factory** (fully verified on 23 Nov 2026, with the circle and deployer sources in its bundle); the deployer and circles **cannot** be verified because QIE's explorer does not index contract-created contracts (explorer limitation) | `MAINNET_DEPLOYMENT_RECONCILIATION.md` |
| M3 | Medium | Mainnet reporting double-counted S5's transactions under S6, repeated S3's totals per circle, and mixed attempts with circles | **fixed**; **verified** against receipts | `MAINNET_EVIDENCE_CORRECTIONS.md`, the three CSVs |
| M4 | Medium | `recordCircle()` was never part of the mainnet acceptance runs | **tested** locally, on a local copy of mainnet (7 real circles) and in the UI; added to the runner (off by default); mainnet **requires human approval** | `LOCAL_FORK_EDGE_CASE_REPORT.md` (one transaction, about 331k gas, about 0.00037 QIE) |
| M5 | Medium | `deploy-factory.js` defaulted the treasury to the deploying wallet, also in production | **fixed** (production with a fee needs an explicit, non-deployer, contract treasury; exposed addresses refused; fee 0 gives a zero treasury); **tested** locally | `scripts/deploy-factory.js` |
| M6 | Medium | The public RPC `rpc1mainnet.qie.digital` took 15 s or more per call on 23 Nov 2026 (rpc3 took about 1 s). A slow RPC can stall a live demo | **verified**; **requires human action** on demo day | Check both RPCs before the demo; set `VITE_RPC_URL` in `app/.env` to the faster one |
| L1 | Low | A requested refresh was dropped while another ran: stale buttons after an action, and the previous account's view kept for 15 s or more after a wallet account switch | **fixed and tested** (E2E-16, E2E-08; 12/22 fail on the original app) | `app/src/CirclePage.jsx` |
| L2 | Low | The app does not reconnect the wallet silently after a page refresh | **verified**; kept (safe default; adding it would be a feature) | E2E-10 |
| L3 | Low | Safe (multisig) is not deployed on QIE mainnet at its standard addresses | **verified** (read-only) | Pilot: fee 0. Production: obtain a multisig first |
| L4 | Low | QIE publishes no hardfork history we could verify; local copies use `london: 0` | **unverified assumption** | Bytecode is paris-target; mainnet behaviour was confirmed by the live runs |
| L5 | Low | History is per address and the demo factory allows 0.01 QUSDC circles, so history on it is cheap to farm; the exposed member addresses' history is meaningless | **verified** | Production minimum 1 QUSDC; the app labels history "not identity" |
| L6 | Low | Slither: 13 results (timestamps, strict equalities, dust arithmetic, bounded loop, benign reentrancy) | **verified**, reviewed; none confirmed | `evidence/v93-release/08-slither.log` |
| L7 | Low | Production JavaScript bundle over 500 kB | **verified**; not changed (optimisation) | — |

## Acceptance criteria for this phase

| Criterion | Met? | Evidence |
| --- | --- | --- |
| No private key or secret in the release package | **Yes** | `SAFE_RELEASE_MANIFEST.md`: scan PASS on the staged package; the packager refuses otherwise |
| The deployed factory's actual configuration and treasury documented | **Yes** | `MAINNET_DEPLOYMENT_RECONCILIATION.md` |
| Deployment and transaction evidence reconciled without double-counting | **Yes** | three CSVs; `MAINNET_FINANCIAL_RECONCILIATION.md` |
| `recordCircle()` and the history lifecycle tested | **Yes** | local, local copy of mainnet, UI |
| The frontend build succeeds | **Yes** | `evidence/v93-release/09-app-build.log`; UI suite on the production build |
| Local test and invariant suites have actual recorded results | **Yes** | `evidence/v93-release/` |
| The UI wallet acceptance plan is executable | **Yes** | `POTLOOP_UAT_PLAN.md`, `UAT_TEST_CASES.csv`; the automated half runs with one command |
| Production factory requirements documented | **Yes** | `PRODUCTION_FACTORY_RECOMMENDATION.md` |
| All remaining security and deployment blockers listed | **Yes** | this document |

## Owner decisions needed (nothing below has been done)

1. Delete the key files and archives, and ask the reviewer to delete their copy (C1).
2. ~~Explorer verification~~: done for the factory (M2).
3. ~~Approve the `recordCircle` mainnet test on S4 (M4)~~: done 24 Nov 2026.
4. ~~Choose the production factory settings and approve its deployment (H2)~~: done 24 Nov 2026 (grace 6 h, fee 0).
5. Arrange the manual QIE Wallet acceptance (H5) and an independent review (H4).

## Deliverables of this phase

`SECURITY_INCIDENT_AND_KEY_ROTATION.md`, `SAFE_RELEASE_MANIFEST.md`, `MAINNET_DEPLOYMENT_RECONCILIATION.md`, `MAINNET_RUN_ATTEMPTS.csv`, `MAINNET_CIRCLES.csv`, `MAINNET_TRANSACTIONS.csv`, `MAINNET_FINANCIAL_RECONCILIATION.md`, `MAINNET_EVIDENCE_CORRECTIONS.md`, `POTLOOP_UAT_PLAN.md`, `UAT_TEST_CASES.csv`, `UI_E2E_REPORT.md`, `LOCAL_FORK_EDGE_CASE_REPORT.md`, `PRODUCTION_FACTORY_RECOMMENDATION.md`, `FINAL_RELEASE_READINESS.md` (this file).

New code: `scripts/release-scan.js`, `scripts/package-release.js`, `scripts/reconcile-mainnet.js`, `scripts/reconcile-token-flows.js`, `scripts/build-mainnet-reports.js`, `scripts/fork-release-checks.js`, `scripts/mainnet-record-history.js`, `scripts/run-release-evidence.sh`, `scripts/e2e-deploy.js`, `app/e2e/`, `test/ReleaseAcceptance.test.js`, `contracts/test/AdminBurnUSD.sol`. Changed: `test/helpers.js` (independent ledger), `scripts/deploy-factory.js`, `scripts/mainnet-step-runner.js` (optional history step, report path), `app/src/chain.js`, `App.jsx` and `CirclePage.jsx` (two bug fixes), `app/.env.example`, `hardhat.config.js` (`QIE_RPC`, `FORK_BLOCK`), `.gitignore`. **No production contract changed.**
