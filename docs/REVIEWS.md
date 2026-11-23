# Review log

> **Historical document.** Written for an earlier version, before the QIE mainnet deployment of 23 Nov 2026. Statements about what has or has not been deployed, which wallets to create and test counts describe that time. Current state: [`FINAL_RELEASE_READINESS.md`](FINAL_RELEASE_READINESS.md).

PotLoop has been reviewed five times by independent AI reviewers. This file lists every finding and what was done. Scores are the reviewers' estimates, not hackathon judging.

| Review | Version reviewed | Overall estimate |
| --- | --- | --- |
| Fable 5.2 | v2 (single circle) | 5.6 / 10 |
| GPT, first | v2 (old zip without the frontend) | 5.5 / 10 |
| GPT, second | v3 (factory, invite links) | 6.4 / 10 |
| Fable 5.2, second | v4 | 5.7 / 10 (about 7 after fixes + mainnet) |
| GPT, security audit | v5 (= v4 contracts + app) | No-go for production funds until P0 items fixed |

## Contract findings

| # | Finding | Source | Status |
| --- | --- | --- | --- |
| 1 | Member owed money who later defaults was repaid first | Fable 1 | Fixed v3 (netting) |
| 2 | Leaving before your turn cost nothing; last seat locked nothing | Fable 1 | Fixed v3; rule stated exactly in v4 ("up to one round's payment from what you have in") |
| 3 | One late payment was permanent | Fable 1 | Fixed v3/v4 (resume paying, `catchUp()`) |
| 4 | Current recipient drew on the reserve before older unpaid members | Fable 1 | Fixed v3 |
| 5 | Stray tokens stranded | GPT 1, GPT 2 | Fixed v3/v4 |
| 6 | Catch-up didn't restore standing; history mixed with current state | GPT 2 | Fixed v4 |
| 7 | **Tiny round/grace allowed a "trap circle"** (seat 1 settles 2 seconds after the start, everyone else marked as leaving) | Fable 2 (H1) | **Fixed v6**: hard bounds in the circle + stricter factory minimums (production factory: 1-day rounds, 12-hour grace); test proves the trap circle is refused |
| 8 | Huge round length overflows `deadline()` or locks funds for decades | Fable 2 (H2), GPT 3 (#10) | **Fixed v6**: upper bounds on round, grace, join window and contribution |
| 9 | **Early settle ignored members behind who were still allowed to pay** | GPT 3 (critical 1), Fable 2 (L2) | **Fixed v6**: early settle waits for every member allowed to pay; tested |
| 10 | **Finalize could race a catch-up** | GPT 3 (critical 2), Fable 2 (M2) | **Fixed v6**: cure window of one grace period after the last round when anyone is behind; `catchUp()` works through it; tested |
| 11 | Cross-function reentrancy: token callback into `sweepSurplus()` during `withdraw()` | GPT 3 (#3) | **Fixed v6**: every state-changing function is `nonReentrant`; tested with a malicious token that calls back before balances move |
| 12 | Leftover collateral of a fully covered defaulter paid other people's debts | Fable 2 (M1) | **Fixed v6**: returned straight to them; tested |
| 13 | Registry write inside try/catch could be gas-griefed to erase a default | Fable 2 (M3), GPT 3 (#18) | **Fixed v6**: no registry call in `finalize()`; permissionless, once-only `recordCircle()` pulls outcomes afterwards |
| 14 | Track record farmed with dust circles | Fable 2 (M4), GPT 3 (#17) | **Fixed v6**: factory minimum contribution; history records pot volume; UI states it is not identity or a credit check |
| 15 | Invitation spam fills a member's circle list | Fable 2 (M5), GPT 3 (#7) | **Fixed v6**: members indexed only after they accept; invitations from bounded event queries; paged getters |
| 16 | Catch-up after the window closes re-defaults at the next settle | Fable 2 (L1) | **Fixed v6**: catch-up also pays the current round when it is open |
| 17 | No fee on pot money repaid later | Fable 2 (L3) | **Fixed v6** |
| 18 | Round start drifts with settle time | Fable 2 (L4) | **Fixed v6**: fixed schedule |
| 19 | No way to leave while joining is open | Fable 2 (L5) | **Fixed v6**: `leave()` |
| 20 | Blacklisted address can't withdraw | Fable 2 (L6), GPT 3 (#8) | **Fixed v6**: `withdrawTo(address)`; tested |
| 21 | `circlesPage` overflow on a huge limit | Fable 2 (L7) | **Fixed v6**; tested with `MaxUint256` |
| 22 | Outgoing transfer not checked at the recipient | GPT 3 (#9) | **Fixed v6**: recipient must receive exactly the credited amount; tested with an outbound-fee token |
| 23 | Token address not checked for code; script could override QUSDC on mainnet | GPT 3 (#8) | **Fixed v6**: code check in factory and circle; deploy script refuses any mainnet token but QUSDC, checks chain ID and 6 decimals |
| 24 | Collateral could round to zero at tiny amounts | GPT 3 (#11) | **Fixed v6**: rounds up; tested |
| 25 | Rounding remainder all to the first member | GPT 3 (#11) | **Fixed v6**: one unit each |
| 26 | Catch-up was an interest-free loan | Fable 2 | **Fixed v6**: 2% late fee to the group reserve |
| 27 | "Defaulted" mixed "left early" with "walked away with the pot" | Fable 2 | **Fixed v6**: four outcomes |
| 28 | Risk view lacked the claim shortfall | GPT 3 (#4) | **Fixed v6**: `claimShortfall` in `risk()` |
| 29 | Old compiler (0.8.24) | GPT 3 | **Fixed v6**: 0.8.39, `paris` target kept, all tests and the exhaustive suite re-run on it |
| 32 | Catch-up after the payment window closed (but before settle) restored good standing without paying that round, so the next settle marked the member behind again | Workspace review on your PC (Nov 20) | **Fixed**: catch-up always includes an unpaid, unsettled current round; regression test fails on the old contract and passes now |
| 33 | Factory pages unbounded in size; keeper only scanned the newest 200 circles | Workspace review on your PC | **Fixed**: pages capped at 100; keeper walks every page |
| 30 | No pause or recovery | GPT 1 | By design (no admin is a trust property); documented |
| 31 | Token freeze or pause by the issuer | Fable 2, GPT 3 | Can't be fixed in code; disclosed on the Risks page; `withdrawTo` covers single-address blocks |

## App findings

| Finding | Source | Status |
| --- | --- | --- |
| URL parameters could replace network, RPC, factory, explorer | GPT 3 (#5) | **Fixed v6**: ignored in production builds; invite links carry only the circle address |
| Fake circle via invite link | Fable 2 (M6), GPT 3 (#5) | **Fixed v6**: `factory.isCircle` + token match; otherwise a red warning and no buttons |
| Wallet network can change after connecting | GPT 3 (#6) | **Fixed v6**: re-check after switching, `chainChanged` handling, re-check before every write; RPC chain ID verified |
| Uncovered percentage wrong; claim shortfall hidden | GPT 3 (#4) | **Fixed v6** |
| Seat numbers on the create screen could differ from the contract | GPT 3 (#12) | **Fixed v6**, plus a "Check before you sign" step |
| Slow `.qie` lookup could overwrite an edited row | GPT 3 (#13) | **Fixed v6**: stable row IDs, result applied only if the row is unchanged |
| Calendar export not escaped | GPT 3 (#14) | **Fixed v6**: RFC 5545 escaping and folding; factory also refuses control characters in names |
| History re-fetched in full every 15 seconds | GPT 2, GPT 3 (#15) | **Fixed v6**: incremental, bounded ranges, limited parallel calls, no overlapping refresh |
| Amounts rounded to 2 decimals | GPT 3 (#16) | **Fixed v6**: exact amounts |
| Default cover, worst-case disclosure, early-seat warnings | Fable 2 | **Fixed v6**: 100% default, "friends only" labels, worst case per seat before joining |
| Reminders | Fable 2 | **Added v6**: keeper bot with Telegram reminders; calendar file |
| Plain terms and risk statement | Fable 2 | **Added v6**: Risks and rules page |

## Still open (honest list)

- No independent security audit by a firm. No fuzzing with Echidna/Medusa (randomized Hardhat tests and an exhaustive pattern check are used instead).
- Track record is per address; one person can have many addresses.
- Real users and traction.
- Treasury should be a Safe multisig for real use (the deploy script warns).

## Test results (run, not estimated)

- `npx hardhat test` on the current source (Solidity 0.8.39): 65 passing, 3 pending (the exhaustive tests, skipped by default). Full command log in `TEST_EVIDENCE.md`.
- `INVARIANT_RUNS=1500`: passing (random defaults plus random catch-ups).
- Random action ordering: 40 runs passing (inside the normal suite).
- Exhaustive, 7,776 patterns at each of 0%, 50% and 100% cover (23,328 runs) on the final v6 code (Solidity 0.8.39): 3 passing (44 minutes), Nov 20, 2026.
- Slither on v6: no reentrancy or access-control findings.
