> **Historical document.** Written for an earlier version, before the QIE mainnet deployment of 23 Nov 2026. Statements about what has or has not been deployed, which wallets to create and test counts describe that time. Current state: [`FINAL_RELEASE_READINESS.md`](FINAL_RELEASE_READINESS.md).

> **Historical (v9).** This file records an earlier environment where dependencies could not be installed. It is not evidence for v9.1 or v9.2. Current, reproducible evidence: [`TEST_EVIDENCE_V9_2.md`](TEST_EVIDENCE_V9_2.md) and the raw logs in `evidence/`.

# Test evidence

## Environment

- Date: 2026-11-20 (client timezone Asia/Karachi)
- Node.js: v24.22.0
- npm: 11.19.1
- Dependencies: not installed; npm registry DNS unavailable.

## Commands and observed results

| Command | Result |
| --- | --- |
| `npm test` | Did not run tests: `'hardhat' is not recognized as an internal or external command` |
| `npm ci --verbose` | Failed to retrieve missing packages: `getaddrinfo ENOTFOUND registry.npmjs.org` |

No compile, unit, regression, randomized, exhaustive, invariant, fuzz, frontend build, or static-analysis result is claimed. New regression cases are present in `test/SavingsCircle.v6.test.js` but have not executed.

## Existing test inventory (source inspection only)

- `SavingsCircle.scenarios.test.js`: examples, lifecycle, factory and historical flows.
- `SavingsCircle.v6.test.js`: timing, token behavior, bounds, accounting examples and randomized action order; now includes the expired-round catch-up regression and insufficient-funds rollback case.
- `SavingsCircle.attacks.test.js`: adversarial token callback and lifecycle cases.
- `SavingsCircle.invariants.test.js`: randomized default patterns and ledger checks.
- `SavingsCircle.exhaustive.test.js`: optional exhaustive patterns, gated by `EXHAUSTIVE`.

The README's historical expected test count and prior static-analysis statement were not revalidated and must not be treated as current evidence.

## Next verification commands

After restoring package registry access and installing the lockfile dependencies, run `npm ci`, `npm test`, `npm run compile`, `npm run build --prefix app`, the invariant and exhaustive suites using their documented environment flags, and Slither if available. Record exact output and resolve every failure before release consideration.

## V9 source sanity checks (2026-11-20)

| Command | Result |
| --- | --- |
| `node --check scripts/demo-v9-terms.js` | Passed |
| `node --check scripts/keeper.js` | Passed |
| Node parse of `app/src/circleAbi.json` | Passed |
| Node parse of root and app `package.json` | Passed |

The extracted archive contained empty `node_modules` directories, and neither `solc` nor Foundry was available on the execution path. Solidity compilation and test execution remain unperformed. `CLAUDE_CODE_HANDOFF.md` supersedes the earlier generic command list with V9-specific validation scenarios.

## Verification run (Claude workspace, 2026-11-20, after the catch-up fix)

The same source (this commit's `contracts/`, `test/`, `scripts/keeper.js`) was copied into a workspace with registry access and run there.

| Command | Result |
| --- | --- |
| `npx hardhat compile --force` (Solidity 0.8.39, paris) | Compiled 16 files, no errors |
| `npx hardhat test` | **65 passing, 3 pending** (the 3 pending are the exhaustive tests, skipped by default) |
| New regression test against the previous contract | **Fails** on the previous `catchUpCost()` (current-round part was 0 after the window), so the bug was real |
| Same test against this contract | Passes |
| `INVARIANT_RUNS=1500 npx hardhat test test/SavingsCircle.invariants.test.js` | Passing (random defaults plus random catch-ups) |
| `EXHAUSTIVE=1 npx hardhat test test/SavingsCircle.exhaustive.test.js` | Partly re-run on this source: 0% cover passed all 7,776 patterns; 50% cover reached 4,000 of 7,776 with no failures before the environment restarted; 100% cover not re-run. These patterns never call catch-up (the only changed function); the full 23,328-run pass on the previous v6 source still covers the rest. |
| `slither . --hardhat-ignore-compile --filter-paths "node_modules|contracts/test" --exclude-informational` | 10 results, none reentrancy or access control: divide-before-multiply in dust splitting (intentional), strict equality in exact-amount checks (intentional), calls in a loop of at most 12 in `recordCircle`, block timestamps for deadlines |
| `node --check scripts/keeper.js` and a 30-second keeper run on a local chain | Passed; the keeper walked the paged list and settled an overdue round |
| `npm run build` in `app/` (ABIs regenerated) | Built |

Tool versions: Node 22.23.5, Hardhat 2.29.2.

Still not done: independent audit by a firm, Echidna/Medusa fuzzing, on-chain inspection of the QUSDC contract's admin powers, mainnet deployment.

## V9 verification run (Claude workspace, 2026-11-20)

The exact `potloop-v9` source was copied into a workspace with dependencies and run there.

| Command | Result |
| --- | --- |
| `npx hardhat compile --force` (Solidity 0.8.39, paris) | Compiled 16 files, no errors |
| `npx hardhat test` | **66 passing, 3 pending** (includes the new `seatTerms` test; the 3 pending are the exhaustive tests) |
| `npx hardhat run scripts/demo-v9-terms.js` (local chain) | Ran; printed correct terms for all 4 seats (e.g. seat 1 locks 37.5, still owes 75, uncovered 37.5 at 50% cover) |
| `npm run build` in `app/` | Built |
| App ABI vs compiled ABI | Same functions and events (formatting differs only) |
| Browser check of home, create and seat screens on a local chain | No page errors; the per-seat commitment grid matches the contract formula |

`seatTerms()` is a read-only view; it does not change any money logic, so the earlier exhaustive and Slither results on the settlement code still apply.
