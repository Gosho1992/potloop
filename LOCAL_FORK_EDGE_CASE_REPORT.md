# Local and local-copy-of-mainnet test report (v9.3 release)

No mainnet transaction was sent for anything in this report.

## Source and toolchain

| | |
| --- | --- |
| Source revision | git `2cfb6b2` in the release working copy. Contracts and tests have not changed since; later commits touch only the app, scripts and documents. Exact hashes of all 159 files: `evidence/v93-release/SOURCE_HASHES.txt` |
| Contracts | byte-identical to v9.2.1 / v9.2.2 and to the bytecode deployed on QIE mainnet (`MAINNET_DEPLOYMENT_RECONCILIATION.md`) |
| Compiler | solc 0.8.39, optimizer on, 200 runs, EVM target paris, viaIR off |
| Tools | Node 22.23.5, npm 10.9.9, Hardhat 2.29.2, Slither 0.11.6, Playwright 1.63.0, Linux x86_64 (2 cores) |
| Run everything | `bash scripts/run-release-evidence.sh` (raw logs and exit codes in `evidence/v93-release/`) |

## Results (raw logs in `evidence/v93-release/`)

| Step | Command | Exit | Result |
| --- | --- | --- | --- |
| Compile | `npx hardhat compile --force` | 0 | 17 files |
| Bytecode sizes | `npx hardhat run scripts/bytecode-sizes.js` | 0 | SavingsCircle 15,905; CircleFactory 6,492; CircleDeployer 18,990 bytes (limit 24,576) |
| Full suite | `npx hardhat test` | 0 | **142 passing, 6 pending** (the 6 are the exhaustive tests, skipped unless `EXHAUSTIVE=1`) |
| Release acceptance | `npx hardhat test test/ReleaseAcceptance.test.js` | 0 | **19 passing** (new) |
| Reentrancy and malicious tokens | `npx hardhat test test/SavingsCircle.attacks.test.js test/SavingsCircle.v6.test.js` | 0 | 24 passing |
| Random invariants | `INVARIANT_RUNS=1500 npx hardhat test test/SavingsCircle.invariants.test.js` | 0 | **1,500 random circles**, 1 passing (11 min) |
| Mutation check | `node scripts/mutation-sim.mjs` | 0 | **15/15 mutations caught** |
| Slither | `slither . --hardhat-ignore-compile --filter-paths "node_modules\|contracts/test" --exclude-informational --exclude-optimization` | 255 | 13 results: the same 13 reviewed since v9.2.1 (see below) |
| App build | `cd app && npm run build` | 0 | built |
| Secret scan | `node scripts/release-scan.js` | 0 | PASS |
| Exhaustive suite, all 6 combinations | see the next section | 0 for every combination | **46,656 of 46,656 patterns passed** |
| UI acceptance | `node app/e2e/run-e2e.cjs` | 0 | 26/26 (`UI_E2E_REPORT.md`) |
| Local copy of mainnet | `scripts/fork-release-checks.js` (`PART=record`, `twelve`, `upfront`) | 0 | 49 checks, 0 failed (below) |

### Exhaustive suite: every default pattern for 5 members

Each combination plays all 6⁵ = 7,776 patterns: every member either never stops paying, or stops from round 1, 2, 3, 4 or 5. After each pattern the circle is finalized, everyone withdraws, and the checks run:
- the independent ledger after every call, and conservation;
- an honest member never gains unless someone left early;
- an honest member never loses when nobody walked away after the pot, or at 100% cover;
- a pre-payout defaulter never profits;
- the test asserts the count `checked == 7776`.

No pattern was skipped or sampled. Command: `EXHAUSTIVE=1 EXHAUSTIVE_MODE=<upfront|pot> [EXHAUSTIVE_K=<k>] npx hardhat test --no-compile test/SavingsCircle.exhaustive.test.js`.

| # | Collateral mode | Cover | Patterns completed | Result | Test time | Process (log) | Process exit | Process peak memory |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | from the pot | 0% | 7,776 / 7,776 | **PASS** | 23.8 min | one process for all 3 from-pot levels (`11b-exhaustive-pot.log`) | 0 (5,207 s in all) | 5.15 GB |
| 2 | from the pot | 50% | 7,776 / 7,776 | **PASS** | 28.3 min | same process | 0 | (same) |
| 3 | from the pot | 100% | 7,776 / 7,776 | **PASS** | 34.7 min | same process | 0 | (same) |
| 4 | upfront | 0% | 7,776 / 7,776 | **PASS** | 33.0 min | own process (`11e-exhaustive-upfront-k0.log`) | 0 (1,983 s) | 2.86 GB |
| 5 | upfront | 50% | 7,776 / 7,776 | **PASS** | 33.6 min | own process (`11c-exhaustive-upfront-k5000.log`) | 0 (2,026 s) | 2.91 GB |
| 6 | upfront | 100% | 7,776 / 7,776 | **PASS** | 37.0 min | own process (`11d-exhaustive-upfront-k10000.log`) | 0 (2,222 s) | 2.92 GB |

**Overall: 46,656 of 46,656 patterns passed; every combination ran in a process that exited 0.**

How the runs went, including the failed attempt:

1. **Single process (stopped by me).** The suite first ran as one process for all six combinations. I stopped it after 2,000 patterns because, with the new independent ledger check after every call, it would have taken about 2.5 hours. Log: `11-exhaustive-single-process-stopped.log`, exit 143.
2. **Two parallel processes, one per mode.** The from-pot process completed all three of its combinations (exit 0).
   - The upfront process passed upfront 0% (its ✔ line is in `11a-exhaustive-upfront.log`, 23.7 min).
   - It was then **killed by the out-of-memory killer** during upfront 50%, at 5,000 of 7,776 patterns: exit 137. The kernel log shows a memory-cgroup OOM kill.
   - Cause: the two processes held over 3 GB each, and each process's memory grows with every combination it runs, against an 8 GB limit.
3. **One combination per process, run one after another.** Upfront 50% and upfront 100% were then run this way, which kept the peak under 3 GB.
4. **Upfront 0% re-run.** Its pass in step 2 came from a process that later exited 137, so it was re-run alone so that every combination has a cleanly exiting process. The step-2 log is kept as an earlier attempt.

No combination failed an assertion at any point, and the workload was not reduced. Each run is slower than in v9.2.1 because every step also runs the independent ledger check.

### The independent accounting check

Every test that uses the shared helpers (all scenario, invariant, exhaustive and acceptance tests) now checks after each state change that:

```
sum of every member's collateral + free reserve + round fund + withdrawable of every member and the treasury
  == the circle's actual token balance
totalWithdrawable == the sum of those withdrawable balances (no credit to an unknown address)
```

This is rebuilt from public per-member and per-address views, independently of the contract's own `accountedBalance()`, which is also checked. The new acceptance tests compare against amounts computed by hand from the contract's rules, not from `app/src/sim.js`. They also check conservation: the members' total change plus the treasury's equals 0, or exactly the stray tokens added. Two planted bugs were caught by these tests and reverted: the late fee raised to 3%, and history volume credited to members who left early.

### Slither's 13 results (reviewed; none a confirmed vulnerability)

Deadline comparisons with `block.timestamp` (by design; a validator can shift time by seconds, which matters only for 60-second demo rounds); strict equalities `amount == 0`, `claim == 0`, `stillOwed == 0` (exact ledger values, intended); multiplication after division in dust splitting (remainder handled explicitly); external calls in a loop in `recordCircle` (at most 12 members, own circles only); benign reentrancy in `createCircle` (the factory calls its own deployer, which only the factory can call).

## Phase 3: factory history (`recordCircle`)

| Where | What | Result |
| --- | --- | --- |
| Local (`ReleaseAcceptance.test.js`) | 6-member circle with every outcome: seat 1 walks away, seat 2 catches up, seats 3–5 complete, seat 6 leaves early. Record by an outsider; `ResultRecorded` per member; counters and volume (600 for outcomes 0 and 1, 0 otherwise) exact; `recorded` true; second call reverts `AlreadyRecorded`; every withdrawable and wallet balance unchanged, then everyone withdraws in full | PASS |
| Local | History adds up across two circles of one factory; another factory's history is separate; recording one circle does not mark another | PASS |
| Local | `NotFinished` for open, running and cancelled circles; `NotACircle` for anything else | PASS |
| UI (E2E-16) | "Record results" in the app writes the history; the button disappears | PASS |
| **Local copy of mainnet, real deployed circles** (`PART=record`, block 12,112,869) | `recordCircle` on all 7 real completed circles, called by an unrelated address: events match `outcomeOf`; `recorded` true; `AlreadyRecorded` on repeat; no balance or entitlement changed; cumulative history of the six real member addresses exact (for example Sipho: completed 6, caught up 1, volume 0.58 QUSDC; Farah: completed 1, left early 1, volume 0.12) | **34/34** |
| Mainnet runner | `RECORD_HISTORY=1` adds a `recordHistory` step after `finalize` and before withdrawals. It checks recorded, every member's counter and volume change against the scenario's own pattern, `AlreadyRecorded`, and no money moved. It changes the approval code. **Not run on mainnet** | code only |

Gas per recording on the local copy: 118,814 (3 members) to 207,901 (4 members). The first time an address gets a history entry costs more, because a storage slot is written for the first time.

### One-transaction mainnet proposal (for the owner's separate approval; not executed)

| | |
| --- | --- |
| Circle | S4, `0xe7461b1505f74663707786C3fc22bCBB8aaAc804`: the only circle with a "caught up" member, so the transaction exercises two outcomes |
| Call | `CircleFactory(0xD099…Dae4).recordCircle(0xe746…c804)`; anyone may send it; it moves no money |
| Expected history change | Sipho +1 caught up; Thandi, Ayesha, Bilal and Naledi +1 completed; each +0.1 QUSDC volume (5 × 0.02). No other address changes |
| Gas | **331,272** (`eth_estimateGas` on mainnet, read-only, 23 Nov 2026; every slot is new) → about **0.000373 QIE** at 1.125 gwei; the script sends a 430,653 gas limit |
| Sender | Any fresh wallet with 0.001 QIE, or the owner through the app's "Record results" button with QIE Wallet (which doubles as UAT-16). **Not** one of the 7 retired wallets |
| Approval | Dry run: `npx hardhat run scripts/mainnet-record-history.js --network qieMainnet` (read-only, done: `mainnet-runs/reconciliation/record-history-dryrun.txt`). Approval code for sender `0x7145…6910`: `R-ec585ac5` (it changes with the sender). Live: `MODE=live` + `APPROVE=<code>` + a key in the operator's own window, **only after the owner's written approval** |
| Checks after | status 1; `recorded` true; each member's counters exactly as above; a simulated second call reverts `AlreadyRecorded`; no withdrawable or wallet balance changed |

## Phase 4: edge cases and where each is tested

L = local (`test/ReleaseAcceptance.test.js` unless noted), F = local copy of mainnet with the real factory and QUSDC (`scripts/fork-release-checks.js`), M = live mainnet run.

| Dimension | Case | Where | Result |
| --- | --- | --- | --- |
| Membership | Minimum (2) and maximum (12) members, full cycle, both collateral modes; nets exactly −fee per member | L; F (12 members) | PASS |
| | 1 and 13 members, duplicate, zero address | L | refused (`BadConfig`) |
| | "Invalid order": payout follows the members list whatever the address order or accept order; outsider `NotMember`; repeat accept refused | L | PASS |
| | Join window: accept after the deadline refused; cancel before refused; `leave` and `cancel` return collateral exactly | L | PASS |
| Coverage | 0%, 20%, 50%, 100%: seat 1 walks away; collateral used per round and the loss equal hand computation (uncovered = 4c(1−k)) | L (both modes); F (0% upfront) | PASS |
| | Factory minimum cover enforced (production minimums 1 day / 12 h / 1 QUSDC / 100%) | L | PASS |
| Collateral modes | Upfront and from-the-pot in every coverage case; identical economics | L; F; M (S3) | PASS |
| Defaults | Before the pot (leaver forfeits up to one share to those who stayed) | L; M (S6) | PASS |
| | After the pot (walk away) | L; F; M (S4) | PASS |
| | Multiple simultaneous (two walkers and a leaver in one round) | L | PASS |
| | Partial collateral exhaustion (50%: 200 → 100 → 0) and full exhaustion (20%) | L | PASS |
| Recovery | Catch-up before settlement: cost = 80 + 20 + 100 + 2 exactly | L | PASS |
| | Catch-up after the payment window closed, before settlement: counts for that round, no new miss | L | PASS |
| | Catch-up after a partial repayment: 226 to the reserve repays seat 3's 100, then 126 of seat 4's 200 | L | PASS |
| | Insufficient allowance or balance: reverts, nothing changes | L | PASS |
| | Oldest-first repayment, asserted after every settlement | L | PASS |
| Withdrawals | Normal, second (`NothingToWithdraw`), `withdrawTo` another address, bad recipients | L; M | PASS |
| | Finalize: `RoundsNotDone`, `CureWindowOpen`, catch-up inside the cure window, nothing after completion | L | PASS |
| | Stray tokens swept to the reserve while running, shared equally after the end | L | PASS |
| | Treasury receives exactly 1% of pots at the maximum fee; nobody else can take it | L; M | PASS |
| | Factory history recording | L; F; UI | PASS |
| | Cross-circle isolation (actions, stray tokens, withdrawals, recording) | L; M (earlier circles unchanged) | PASS |
| Token | Administrator burns from a circle (QUSDC's real power): the last withdrawals fail | L (`AdminBurnUSD`) | demonstrates the risk |
| | Reentrant token, fee-on-transfer, blacklisting token, no-code token | L (`attacks`, `v6`) | PASS |

### Local copy of mainnet with the real deployed factory and QUSDC (block 12,112,869)

| Part | Circle | Checks |
| --- | --- | --- |
| `twelve` | 12 members, 0% cover, from the pot, 0.01 QUSDC: full cycle; independent ledger after every step; ends at 0; members' losses = treasury fee (0.0072); results recorded | 5/5 |
| `upfront` | 5 members, 20% cover, **upfront**: seat 1 defaults after its payout and catches up; fee 0.0025; outcomes caught up + 4 completed | 5/5 |
| `upfront` | 4 members, 0% cover, upfront: seat 1 walks away with an uncovered loss; ledger exact; conservation exact; outcome "walked away" recorded | 5/5 |

QUSDC was minted to the local test accounts by impersonating QUSDC's vault on the local copy only; nothing was sent to mainnet.
