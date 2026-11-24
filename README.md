# PotLoop v9.3: savings circles where you see your risk before you join

**Your circle. Your turn. Your money.**

A non-custodial savings circle (committee, stokvel, tanda, ROSCA) on QIE, paid in QUSDC. Everyone pays the same amount each round and one member takes the pot. Earlier recipients still owe more payments after they are paid, so PotLoop backs those payments with collateral and enforces the rules in an immutable contract.

**What makes it different:** before joining, every member sees what they need to start, what stays locked, what they could lose, and what happens if anyone stops paying. Those figures come from the same rules the contract enforces, and a simulator that is tested against the contract at every step.

**Try it:** [potloop.vercel.app](https://potloop.vercel.app). No wallet is needed to look around: open [How it works](https://potloop.vercel.app/#/guide), a [real mainnet circle with a default and a catch-up](https://potloop.vercel.app/#/c/0xe7461b1505f74663707786C3fc22bCBB8aaAc804), or start a circle and play with the What-if panel. Demo video and slides: see the submission.

## In two minutes

1. Create a 2–12 member circle: payout order, contribution, schedule and cover. Only the cover levels the factory allows can be picked; 100% is the default.
2. **Collateral mostly from the pot** (default): every member locks at most one share to join. When a member is paid, enough of their pot is held back to back what they still owe, and it is returned at the end. At 100% cover a 12-member circle's first seat needs 2 shares to start (1 to join plus its first payment) instead of 12, with exactly the same protection.
3. Every seat card answers: money to start, locked until the end, and the most you could lose if you keep paying. A comparison shows seat 1's figures at every allowed cover level.
4. The **What-if panel**: pick who stops paying, from which round, and whether they catch up, and see every member's outcome.
5. If a member stops paying after their turn, their collateral pays what it can, members paid short are recorded as owed, and a catch-up repays them oldest first. A cure window after the last round keeps catch-up open.

**Honest limits:** below 100% cover, walking away after your payout is profitable for early seats, and the app shows the exact amount and requires the creator to acknowledge it. At 100% cover it gains nothing and nobody loses ([payoff matrix](docs/PAYOFF_MATRIX.md)). The price is that early seats get little credit at their turn. Cover does not protect against token issuer actions or contract defects.

## Status (24 Nov 2026)

| | |
| --- | --- |
| **Where it stands** | **Live on QIE mainnet: 7 circles ran end to end with real QUSDC, and anyone can try the app.** Before real groups put in larger amounts it needs an independent audit, a test with the real QIE Wallet by a person, and a production factory. Evidence: [`FINAL_RELEASE_READINESS.md`](FINAL_RELEASE_READINESS.md) |
| QIE mainnet | Factory `0xD099c7361157Ec20a9Ac145aF4B66Af553AeDae4` (block 12,109,975). **The factory's source is verified on the explorer** ([code](https://mainnet.qie.digital/address/0xD099c7361157Ec20a9Ac145aF4B66Af553AeDae4#code)), and its verified source bundle includes `SavingsCircle.sol` and `CircleDeployer.sol`. The deployer and the 7 circles are **not individually verified**: QIE's explorer does not index contracts created by other contracts. Instead, their on-chain bytecode was matched against this build (`MAINNET_DEPLOYMENT_RECONCILIATION.md`). Its rules are set for testing (60 s rounds, 0% minimum cover, 0.01 QUSDC minimum, 0.5% fee), and the key of the wallet that receives its fees was exposed ([`SECURITY_INCIDENT_AND_KEY_ROTATION.md`](SECURITY_INCIDENT_AND_KEY_ROTATION.md)); that wallet only receives fees and has no power over circles. Real groups will use a new production factory ([`PRODUCTION_FACTORY_RECOMMENDATION.md`](PRODUCTION_FACTORY_RECOMMENDATION.md)) |
| Mainnet runs | 7 circles with real QUSDC. **511 transactions in total**: 508 in the test runs S1–S7, 1 factory deployment and 2 returning the funds; 510 succeeded and 1 reverted (a late payment in S5). S1–S4 passed; S5 stopped early when a payment arrived after its 60-second deadline and the contract refused it, as designed; S6 finished that circle; S7 repeated S5 and passed. Reconciled from receipts and QUSDC transfer logs: [`MAINNET_FINANCIAL_RECONCILIATION.md`](MAINNET_FINANCIAL_RECONCILIATION.md) |
| Local evidence (this source) | 142 tests passing, 6 pending, including 19 new release-acceptance tests; 1,500 random invariant runs; 15/15 mutations caught; exhaustive suite 46,656/46,656 patterns; Slither (13 known items); UI acceptance 25/25 on the production build, with no WCAG A/AA issues found by axe on any page, desktop and mobile: [`LOCAL_FORK_EDGE_CASE_REPORT.md`](LOCAL_FORK_EDGE_CASE_REPORT.md), [`UI_E2E_REPORT.md`](UI_E2E_REPORT.md) |
| Real QIE Wallet | Tested by a person on mainnet (24 Nov 2026): connect, create a circle, accept a seat, quiet reconnect. Two bugs found and fixed during the test: [`REAL_WALLET_TEST.md`](REAL_WALLET_TEST.md) |
| Not done | Independent audit; the rest of the manual QIE Wallet checklist (payments, payout, mobile app: [`POTLOOP_UAT_PLAN.md`](POTLOOP_UAT_PLAN.md)); a production factory ([`PRODUCTION_FACTORY_RECOMMENDATION.md`](PRODUCTION_FACTORY_RECOMMENDATION.md)) |

## What's new on 24 Nov 2026 (easier to use)

- **How it works** page (`#/guide`), linked from the header on every page and from the home page: a two-minute tour that needs no wallet, what you need (QIE Wallet, a little QIE, QUSDC from QIEDEX), step-by-step for organisers and members, what happens when something goes wrong, and a glossary.
- **Quiet reconnect:** a wallet that has already allowed the site reconnects on reload without a prompt; it never connects on its own otherwise, or on the wrong network.
- **Before you lock money** notice on the seat card (not yet independently audited; QUSDC's administrator can burn tokens), and a warning on the create screen when a pot is above 500 QUSDC.
- **Faster first load:** libraries are split into their own cached files and pages load when first opened (home page about 160 KB gzipped).
- **Fixed:** the Risk and history tab of a circle that had paid a pot showed a blank page.
- UI acceptance now 25 cases, including the guide and the reconnect; an accessibility check (axe, WCAG A/AA) found nothing on any page at desktop and phone sizes.

## What's new in v9.3 (release readiness)

- **Security:** wallet key files were found in a hand-made ZIP; treated as an incident. `scripts/release-scan.js` finds key material, including any 32-byte value that derives to an address the project uses; `scripts/package-release.js` builds the shareable package and refuses if the scan fails. `deploy-factory.js` refuses the exposed addresses and, in production, a treasury that is the deploying wallet.
- **Mainnet evidence reconciled read-only:** deployment transaction recovered, bytecode of the factory, deployer and all 7 circles matched, and three corrected reports: [`MAINNET_RUN_ATTEMPTS.csv`](MAINNET_RUN_ATTEMPTS.csv), [`MAINNET_CIRCLES.csv`](MAINNET_CIRCLES.csv) and [`MAINNET_TRANSACTIONS.csv`](MAINNET_TRANSACTIONS.csv). Errors in the earlier reporting: [`MAINNET_EVIDENCE_CORRECTIONS.md`](MAINNET_EVIDENCE_CORRECTIONS.md).
- **Factory history (`recordCircle`) tested:** locally, on a local copy of mainnet for all 7 real circles, and as an optional step in the mainnet runner (not run on mainnet). A one-transaction mainnet proposal: `scripts/mainnet-record-history.js` (dry run by default).
- **Edge cases:** 2 and 12 members, 0/20/50/100% cover in both collateral modes, defaults before and after the pot, simultaneous defaults, catch-up timing, oldest-first repayment, withdrawals, surplus, treasury, cross-circle isolation. Each is checked against an independent ledger rebuilt from public views.
- **QUSDC token risk found:** QUSDC's administrator can grant itself the right to burn any address's QUSDC, a circle's included ([`MAINNET_DEPLOYMENT_RECONCILIATION.md`](MAINNET_DEPLOYMENT_RECONCILIATION.md)).
- **App fixes:** an unreachable RPC no longer makes the app call a genuine circle "not created by PotLoop's official factory", and no longer says the network is the wrong chain; a refresh requested during another refresh is no longer dropped (the screen showed stale buttons for up to 15 s after an action).
- **UI acceptance suite:** `node app/e2e/run-e2e.cjs` drives the production build through the whole circle lifecycle and the error states.

*The sections below describe earlier versions as they were at the time.*

## What's new in v9.2.2

- The independent accounting check (rule R3) now covers every original payout, not only repayments, and reconciles fees with the treasury. 15/15 mutations caught.
- The evidence summary reports Slither's real exit code.
- No contract or app changes. See [`SUGGESTION_EVALUATION_V9_2_2.md`](SUGGESTION_EVALUATION_V9_2_2.md) and [`TEST_EVIDENCE_V9_2_2.md`](TEST_EVIDENCE_V9_2_2.md).

## What's new in v9.2.1

- **Fixed:** collateral held from pot money now always targets the member's seat amount, including when an old shortfall is repaid in a later round. The old rule could leave a member's backing slightly short (found in 106 of 842,970 exhaustively searched small-circle scenarios; final results were never affected).
- **Changed:** the join amount is the smaller of the seat's collateral and one share, so leaving early costs the same in both collateral modes.
- **Rules checked on the contract after every transaction**, independently of the simulator. A mutation that puts the old rule into both the contract and the simulator is caught.
- **CircleDeployer:** the factory is now 6,492 bytes (it was 24,481); every contract has at least 5.5 KB of headroom.
- **Both modes compared honestly** ([docs/MODE_COMPARISON.md](docs/MODE_COMPARISON.md)): identical results except when an early leaver and an unrecovered walker occur together.
- **Exhaustive suite run** in both modes; the production settings were checked against the real QUSDC on a local copy of QIE mainnet; QIE testnet deploy script and checklist.
- **Needs a new factory deployment.** (Nothing had been deployed at the time.)

See [`SUGGESTION_EVALUATION_V9_2_1.md`](SUGGESTION_EVALUATION_V9_2_1.md), [`V9_2_1_CHANGELOG.md`](V9_2_1_CHANGELOG.md), [`TEST_EVIDENCE_V9_2_1.md`](TEST_EVIDENCE_V9_2_1.md), [`TESTING_HANDOFF_V9_2_1.md`](TESTING_HANDOFF_V9_2_1.md) and [`DEPLOYMENT_READINESS_V9_2_1.md`](DEPLOYMENT_READINESS_V9_2_1.md).

## What's new in v9.2

- Collateral from the pot (contract option), plus `upfrontCollateral()` and the `CollateralHeldFromPot` event.
- The factory's `rules()` and `FACTORY_VERSION`. The app reads the real minimum cover, disables what isn't allowed, and never assumes a lower minimum.
- A capital preview on every seat and a cover comparison on the create screen.
- The parity test now compares the full state after every step (not only final balances), in both modes. 11 of 11 deliberate simulator errors are caught (`scripts/mutation-sim.mjs`).
- Reproducible evidence: `bash scripts/run-evidence.sh` installs from the lockfiles and saves raw logs and source hashes to `evidence/`.
- **Needs a new factory deployment.** (Nothing had been deployed to mainnet at the time.)

See [`SUGGESTION_EVALUATION_V9_2.md`](SUGGESTION_EVALUATION_V9_2.md), [`V9_2_CHANGELOG.md`](V9_2_CHANGELOG.md), [`TEST_EVIDENCE_V9_2.md`](TEST_EVIDENCE_V9_2.md) and [`TESTING_HANDOFF_V9_2.md`](TESTING_HANDOFF_V9_2.md).

## What's new in v9.1

- Fixed: the create screen said seat 1 had no default risk at any cover.
- `app/src/sim.js`: exact settlement simulator, parity-tested against the contract (`test/Sim.parity.test.js`, 120 random scenarios).
- Seat risk cards and the What-if panel (create screen, seat tab, risk tab).
- `CircleFactory.minCoverageBps`: a deployment can require a minimum cover; production deployments default to 100%. **Needs a new factory deployment.** `SavingsCircle` is unchanged.
- `docs/PAYOFF_MATRIX.md`: honest, walk-away, catch-up and leave-early outcomes for 2/3/6/12 members at every cover.
- Mainnet demo now shows a real default, a short payout and a catch-up that repays the members paid short.

See [`SUGGESTION_EVALUATION.md`](SUGGESTION_EVALUATION.md) (what was accepted, changed or rejected, and why), [`V9_1_CHANGELOG.md`](V9_1_CHANGELOG.md) and [`TESTING_HANDOFF_V9_1.md`](TESTING_HANDOFF_V9_1.md).

## What's new in v6 (fourth round of reviews: Fable 5.2 on v4, GPT security audit on v5)

Every finding from both reviews is fixed or explicitly documented; see `docs/REVIEWS.md` for the full list with status.

**Contracts**
- **Early settle waits for everyone still allowed to pay**, including members behind. Nobody can be pushed into an extra missed round while their window is open.
- **Cure window after the last round**: if anyone is behind, the circle can't be finished until one grace period has passed, and `catchUp()` works until then.
- **Every state-changing function is `nonReentrant`**, including `sweepSurplus()` (cross-function reentrancy through a token callback is blocked and tested).
- **Bounds on everything**: rounds 1 minute to 365 days, grace 30 seconds to one round, joining 1 minute to 60 days, contribution up to 10^15 units. The factory sets stricter minimums at deployment: a production factory uses 1-day rounds and 12-hour grace; a demo factory 1-minute rounds. This closes the "1-second trap circle".
- **Token checks**: the token must be a contract; withdrawals check the recipient receives exactly the amount; `withdrawTo(address)` for addresses blocked by the token issuer.
- **Collateral rounds up**, so any cover above 0% always locks something; leftover dust is split one unit at a time.
- **Leftover collateral of a member whose misses were all covered goes back to them**, never to other people's debts.
- **Catch-up pays the current round too**, even if its window expired but nobody has settled it yet, plus a 2% fee on arrears to the group reserve. The payment is recorded in that round atomically, so settlement cannot immediately default the member again.
- **Fixed schedule**: an early settle doesn't pull the next deadline forward, so calendar dates stay right.
- **`leave()`** before the circle starts returns your collateral.
- **Fee also on pot money repaid later.**
- **Track record is pull-based and can't be gas-griefed**: `factory.recordCircle(circle)` writes four outcomes (finished, caught up, left before turn, walked away) plus pot volume, once, after the circle is finished.
- **Members are listed only after they accept** (no invitation spam in anyone's list); invitations come from events; every list is paged.
- **Factory refuses names with control characters and amounts below its minimum.** Compiler updated to Solidity 0.8.39 (paris target kept).

**App**
- Production builds **ignore URL settings**: an invite link can only choose which circle to open. Network, RPC, factory and explorer are pinned at build time.
- **Every circle is checked against the official factory and its token**; anything else gets a red warning and no buttons.
- The RPC's chain ID is verified; the wallet's chain is re-checked after switching, on `chainChanged`, and before every transaction.
- Risk panel separates: still owed, secured by collateral, already owed to members paid short, the part the reserve can't cover, and the uncovered percentage (computed correctly).
- **Worst case for your seat** shown before you join and on the seat tab, using the contract's own rules.
- Create form: **100% cover by default**, lower cover labelled "friends only", seat numbers match the contract's order, stable rows (a slow `.qie` lookup can't overwrite an edited row), the factory's minimums, and a **"Check before you sign"** step.
- Exact token amounts (no rounding), calendar export escaped per RFC 5545, history fetched incrementally in bounded ranges, no overlapping refreshes.
- A plain-language **Risks and rules** page.
- **Keeper bot** (`scripts/keeper.js`): settles rounds, finishes circles after the cure window, records results, and can post payment reminders to Telegram.

## v4 changes (third review)

| Change | Why |
| --- | --- |
| **Missed-payment history kept separate from current standing.** `missedRounds` never resets; status says whether the member is behind *now* | A member who resumed paying was still shown as "stopped paying" |
| **`catchUp()`**: a member behind after their turn refills the collateral the circle used and pays any share it could not cover; they are back in good standing, with normal priority for anything owed to them | Resuming payments alone didn't restore standing |
| **Track record has three outcomes**: finished, finished after catching up, walked away | History vs. recovery |
| **Stray tokens handled in every phase**: before/during the circle they join the reserve; after it ends (or is cancelled) they are shared equally | Tokens sent before start or after the end could be stranded |
| **Penalty stated exactly**: up to one round's payment, taken from what the leaver has paid in plus their collateral | The old wording promised a full round's payment even when less was available |
| **Plain disclosures**: collateral comes back minus anything used for your own misses; full cover protects against members stopping, not against token or contract failures; nobody guarantees payouts beyond collateral and reserve | Over-optimistic wording |
| Website: "Catch up" button, "Paying again" / "Behind" labels, invitations shown separately, calendar reminders (.ics), statement download (CSV), a warning when early seats go to members with no track record, paged circle list | Review findings and common features of existing products |

See `docs/REVIEWS.md` for every review finding and its status, and `docs/COMPARISON.md` for how PotLoop compares with existing savings-circle products.

## v3 changes (after the first two reviews)

| Change | Why |
| --- | --- |
| **CircleFactory**: anyone creates a circle from the website; a public list of circles; invite links | One contract per circle had no way to grow |
| **Track record**: each finished circle writes "completed" or "missed" for every member to the factory; shown next to every member | Strangers can see who has paid before |
| **Leaving early costs one round's payment**, which goes to the members who stayed; the last seat now also locks one share of collateral | Before, leaving before your turn cost nothing |
| **Oldest debts first**: money freed in a round repays members paid short earlier before this round's recipient draws on it | Matches the rule; the old order let the newest recipient jump the queue |
| **Netting**: a member who was paid short and then stops paying is no longer repaid ahead of honest members; what they're owed is set against what they owe | Review finding |
| **Catch-up**: a member who missed a payment after their turn can start paying again; their collateral stops being drawn | One late payment was permanent |
| **sweepSurplus()**: tokens sent straight to the contract go to the group reserve instead of being stuck | Review finding |
| **0.5% fee** on each pot paid out, to a fixed treasury (max 1%, set at factory deployment) | Revenue model |
| **Grace period is required** (> 0) | Review finding |
| Website: home with your circles and all circles, "Start a circle" form (accepts `name.qie`), invite link, join screen with a "you need QUSDC, swap on QIEDEX" note, track record column | Join flow and onboarding |

## What is in this folder

| Path | What it is |
| --- | --- |
| `contracts/SavingsCircle.sol` | One circle. Immutable: no owner, no admin, no pause, no proxy |
| `contracts/CircleFactory.sol` | Creates circles, lists them, keeps each member's track record, enforces a minimum cover. No owner |
| `contracts/test/MockTokens.sol`, `contracts/test/AdminBurnUSD.sol` | Test tokens (normal, fee-on-transfer, reentrant, blacklisting, administrator burn) and an attacker contract, for local tests only |
| `test/` | Worked examples, safety checks, review fixes, factory, randomized and exhaustive tests |
| `scripts/deploy-factory.js` | Deploys a factory (needs the owner's approval code on mainnet; refuses exposed wallets) |
| `scripts/release-scan.js`, `scripts/package-release.js` | Secret scan; the only supported way to build a package to share |
| `scripts/run-release-evidence.sh` | Runs every local check and saves raw logs and exit codes |
| `app/e2e/` | UI acceptance suite for the production build (Playwright and a scripted wallet) |
| `scripts/make-wallets.js` | Creates throwaway member wallets on your PC (`demo-wallets.json`: holds keys; never share, never ZIP; delete after use) |
| `scripts/demo-mainnet.js` | Funds the demo wallets from yours and runs a real circle on mainnet: a default at 20% cover, then a catch-up |
| `scripts/return-funds.js` | Sends the demo wallets' QUSDC and QIE back to you |
| `scripts/deploy.js` | Creates one circle through the factory from the command line |
| `scripts/demo-local.js` | Builds demo circles on a local test chain |
| `scripts/demo-v9-terms.js` | Deploys a local V9 circle and prints each on-chain member commitment |
| `scripts/payoff-matrix.mjs` | Regenerates `docs/PAYOFF_MATRIX.md` from the simulator |
| `app/` | The website (`app/src/sim.js` is the simulator) |

## Run the tests (Windows, PowerShell)

1. Install Node.js 20 or newer from nodejs.org.
2. Open PowerShell in this folder.
3. `npm install`
4. `npx hardhat test`

Expected: **142 passing, 6 pending** (the 6 pending are the exhaustive tests, 3 cover levels × 2 collateral modes, skipped unless `EXHAUSTIVE=1`; about an hour on two cores). Every check, with raw logs and exit codes: `bash scripts/run-release-evidence.sh` (writes `evidence/v93-release/`); the v9.3 results are in [`LOCAL_FORK_EDGE_CASE_REPORT.md`](LOCAL_FORK_EDGE_CASE_REPORT.md). UI acceptance: `node app/e2e/run-e2e.cjs` ([`UI_E2E_REPORT.md`](UI_E2E_REPORT.md)).

| Test file | What it proves |
| --- | --- |
| `SavingsCircle.scenarios.test.js` | Worked examples give exact numbers; 0% and 100% cover; safety checks; every v3 fix (oldest-first, netting, resume paying, fee, sweep); factory creates, lists and records results, and only its own circles can write history; v4 adversarial cases: paid short then default then catch-up, catch-up after collateral ran out, three-outcome track record, penalty at 20% cover, stray tokens while joining / after the last round / after finishing, two and three members defaulting after their turns, netting with collateral left |
| `SavingsCircle.v6.test.js` | Every v6 finding: early-settle attack, finalize race and cure window, fixed schedule, catch-up paying the current round, cross-function reentrancy token, blacklisted address withdrawing elsewhere, outbound-fee token refused, no-code token refused, every out-of-range parameter, collateral rounding, fair dust split, leftover collateral returned, `leave()`, fee on later repayments, claim shortfall in the risk view, and 40 runs of random action ordering (stray transfers, sweeps, premature settles and finalizes, catch-ups) |
| `SavingsCircle.attacks.test.js` | A malicious member whose token calls back into the contract cannot withdraw twice; phase rules; nothing after the last round; no joining after the window |
| `Sim.parity.test.js` | The app's simulator matches the contract's full state after every step: 16 named scenarios in both collateral modes, precision cases from 1 base unit to the maximum, 160 random scenarios; rules R1–R3 checked on the contract after every transaction |
| `circleRunner.js` | Shared runner: plays a scenario on the contract and checks the collateral and repayment rules independently of the simulator |
| `SavingsCircle.v921.test.js` | The v9.2.1 collateral fix (scenarios A–E with exact numbers), the circle deployer, bytecode size limits |
| `ModeLifecycle.test.js` | Every lifecycle situation on the contract in both collateral modes |
| `SavingsCircle.v92.test.js` | Collateral from the pot, factory `rules()`, minimum cover in both modes |
| `SavingsCircle.invariants.test.js` | 150 random default patterns at random cover and amounts, some members catching up at random rounds (`$env:INVARIANT_RUNS="1500"` for more); ledgers checked after every call |
| `ReleaseAcceptance.test.js` | v9.3: factory history recorded once with exact counters and volume and no money moved; 2 and 12 members; duplicate, zero and out-of-range members; payout order; join window, leave and cancel; seat 1 walking away at 0/20/50/100% cover in both modes against hand-computed losses; defaults before and after the pot; simultaneous defaults with oldest-first repayment; catch-up before settlement, after the window and after partial repayment; insufficient funds; withdrawals and `withdrawTo`; cure window; stray tokens; treasury; cross-circle isolation; a token administrator burning a circle's balance |
| `SavingsCircle.exhaustive.test.js` | Every "who stops paying in which round" pattern for 5 members: 7,776 patterns at each of 0%, 50% and 100% cover in both collateral modes (46,656 runs; v9.3: all passed, about 3.3 hours on 2 cores). Run one combination per process to stay within memory: `$env:EXHAUSTIVE="1"; $env:EXHAUSTIVE_MODE="upfront"; $env:EXHAUSTIVE_K="5000"; npx hardhat test test/SavingsCircle.exhaustive.test.js` |

Properties checked in the random and exhaustive tests:
- the contract's ledgers equal its token balance after every call, and it ends with exactly zero. Since v9.3 this is checked twice: with the contract's own `accountedBalance()`, and with a total rebuilt independently from every member's collateral, the reserve, the round fund and every address's withdrawable balance (`test/helpers.js`);
- no money is created or lost across members;
- an honest member never loses when nobody is left behind after being paid (or everyone behind caught up), or when cover is 100%;
- an honest member gains only when someone leaves early (their one-round penalty);
- a member who leaves before their turn never profits.

These tests are evidence, not a proof of every sequence, and not an audit.

Static analysis: Slither 0.11.6 on this exact source reports 13 results (exit code 255), the same 13 reviewed since v9.2.1: deadline timestamps, exact-amount equality checks, dust-split arithmetic, a loop over at most 12 members in `recordCircle`, and a benign reentrancy note on `createCircle` calling the factory's own deployer. None is a confirmed vulnerability. Raw output: `evidence/v93-release/08-slither.log`.

## QIE mainnet

**The demo factory already exists** (`0xD099c7361157Ec20a9Ac145aF4B66Af553AeDae4`). Use it for demonstrations only. A factory for real users must be new, with the configuration in [`PRODUCTION_FACTORY_RECOMMENDATION.md`](PRODUCTION_FACTORY_RECOMMENDATION.md), a fresh deployer wallet and the owner's explicit approval (`scripts/mainnet-preflight.js` prints the approval code).

Rules for any key on this project:

- Use a fresh wallet that holds only what the step needs. Type its key only into your own PowerShell window: `$env:DEPLOYER_PRIVATE_KEY="0x..."`. Close the window afterwards.
- Never paste a key into a chat or a file you share. Never ZIP the project folder by hand: build what you share with `node scripts/package-release.js`, which stops if any key or wallet file is present.
- Test wallets made with `node scripts/make-wallets.js 6` (the mainnet runner uses up to 6) or `scripts/make-funder.js` live in `demo-wallets.json` / `funder-wallet.json`. Delete them when the test is over and never reuse them. The 7 wallets from 23 Nov 2026 are retired.

Mainnet test tooling (each script refuses to send anything without its approval code):

| Script | Purpose |
| --- | --- |
| `scripts/mainnet-preflight.js` | Read-only: balances, gas, factory check, per-scenario cost, approval codes |
| `scripts/mainnet-step-runner.js` | Runs a scenario in resumable steps (`RECORD_HISTORY=1` adds the history step) |
| `scripts/mainnet-record-history.js` | One `recordCircle` transaction; dry run by default |
| `scripts/reconcile-mainnet.js`, `scripts/reconcile-token-flows.js` | Read-only reconciliation; refuse to run with a key loaded |
| `scripts/build-mainnet-reports.js` | Builds the three CSV reports and the totals from the reconciliation data |

**Website** (Window 2, the `app` folder):

1. Copy `.env.example` to `.env`. It already points at the demo factory and its deployment block; change them for any other factory. If `rpc1mainnet` is slow, `https://rpc3mainnet.qie.digital` answered reliably on 23 Nov 2026.
2. `npm install` (first time only)
3. `npm run build`
4. Host the `app/dist` folder on any static host (Vercel, Netlify, GitHub Pages, your own server). Invite links look like `https://your-site/#/c/0x...circle`.

## Local demo (three PowerShell windows)

Window 1 (keep open, the local chain): `npx hardhat node`

Window 2 (then close it): `npx hardhat run scripts/demo-local.js --network localhost`, copy the `All circles:` link.

Window 3 (keep open, the website): in `app`, `npm install` once, then `npm run dev`, then open the link from window 2.

## The rules

- Collateral for seat s (1-based) = max(N − s, 1) × contribution × cover. The group picks cover: 0, 20, 30, 40, 50 or 100%.
- Seats are fixed when the circle is created; each member accepts their seat by locking its collateral. The circle starts when every seat is accepted; if the join window ends first, anyone can cancel and every deposit comes back.
- Pay inside the grace period and nothing happens: you are just late.
- Miss a payment **before** your turn: you leave the circle and lose your turn. Up to one round's payment, taken from what you paid in plus your collateral, goes to the members who stayed (at 0% cover, someone who never paid has nothing to take); the rest is refunded last, after honest members are whole.
- Miss a payment **after** your turn: your collateral pays your share for each round you miss, until it runs out; any shortfall is recorded against the members it affects. You may resume paying, and `catchUp()` (refill the collateral used + pay any uncovered share) puts you back in good standing.
- Every missed round stays in your history; the track record shows finished / finished after catching up / walked away.
- Tokens sent straight to a circle never get stuck: `sweepSurplus()` adds them to the reserve, or shares them equally once the circle has ended.
- The reserve repays the oldest unpaid amounts first. Defaulter refunds always come last.
- settle() and finalize() only update ledgers; money leaves only through withdraw().
- 0.5% of each pot paid out goes to the PotLoop treasury.

## Honest limits

- Unaudited. Use small amounts.
- QUSDC is a bridged USDC token on QIE, not issued by Circle. Its verified source has no pause or blacklist, but its administrator (a single wallet) can grant the vault role, which can **burn QUSDC from any address, a circle included**, or mint. A circle has no admin and no override, so such a burn would leave the last members to withdraw unpaid. Size circles accordingly.
- Below 100% cover, a member who walks away after being paid can cost honest members money. The risk meter shows how much, before anyone joins.
- Collateral ties up money; that's the price of protection. Full cover is safest and most expensive for early seats.
- The track record counts finished circles only, and one person can make many wallets. It is a signal, not identity.
- Nobody (including PotLoop) tops up a shortfall beyond the collateral and reserve. Products such as Money Fellows cover missed payments from company money after a credit check; PotLoop doesn't. It shows the uncovered amount instead.
- The organizer chooses seat order and cover; members agree by accepting.

## Prior art

Collateral-backed savings circles exist elsewhere (WeTrust, Starosca, Saving Circles, Armina, CircleFi, AjoDAO, Kameti, RizqFi and others). PotLoop claims only its combination: collateral priced by seat, explicit before-turn and after-turn default rules with penalties and catch-up, oldest-first repayment, a cross-circle track record, and exposure shown from contract state before anyone deposits.
