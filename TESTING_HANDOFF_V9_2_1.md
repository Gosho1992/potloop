# V9.2.1 testing handoff (for Claude Code or any reviewer)

> **Historical document.** Written for an earlier version, before the QIE mainnet deployment of 23 Nov 2026. Statements about what has or has not been deployed, which wallets to create and test counts describe that time. Current state: [`FINAL_RELEASE_READINESS.md`](FINAL_RELEASE_READINESS.md).

The fastest complete check: from a copy of this folder **without** `node_modules`, run

```
FORK_URL=https://rpc1mainnet.qie.digital EXHAUSTIVE=1 bash scripts/run-evidence.sh
```

It installs from both lockfiles, runs every step below, and writes raw logs plus SHA-256 hashes of the source to `evidence/`. Drop `FORK_URL` to skip the mainnet-copy check (it needs network access to a QIE RPC, and only reads from it). Drop `EXHAUSTIVE=1` to skip the 45-minute exhaustive suite. Compare with `TEST_EVIDENCE_V9_2_1.md`. On Windows use Git Bash or WSL, or run the steps one by one:

| Step | Command (project folder unless noted) | Expected |
| --- | --- | --- |
| 1 | `npm ci` | Installs from the lockfile |
| 2 | `npx hardhat compile --force` | 17 files; one pre-existing warning (`leave` will become a keyword) |
| 3 | `npx hardhat run scripts/bytecode-sizes.js` | Runtime: SavingsCircle 15,905, CircleFactory 6,492, CircleDeployer 18,990; factory init 26,247 |
| 4 | `npx hardhat test` | 122 passing, 6 pending (the exhaustive tests: 3 cover levels × 2 collateral modes) |
| 5 | `node scripts/mutation-sim.mjs` | `14/14 mutations caught` (the last two put the old rule in the contract **and** the simulator; R2 must catch them) |
| 6 | `node scripts/payoff-matrix.mjs` and `node scripts/compare-modes.mjs` | `docs/PAYOFF_MATRIX.md` and `docs/MODE_COMPARISON.md` regenerate byte-identically |
| 7 | `cd app`, `npm ci`, `npm run build` | Builds (a chunk-size warning is expected) |
| 8 | `$env:HARDHAT_CHAIN_ID="1983"; npx hardhat run scripts/testnet-deploy.js` | Dry run: deploys and reads back the rules on a local chain reporting 1983. Without the variable it must refuse. |
| 9 | `$env:FORK_URL="https://rpc1mainnet.qie.digital"; npx hardhat run scripts/fork-production-check.js` | "Production-configuration check passed" (real QUSDC, production settings, local copy only) |
| 10 | `$env:EXHAUSTIVE="1"; npx hardhat test test/SavingsCircle.exhaustive.test.js` | 6 passing (3 cover levels × 2 collateral modes, 7,776 patterns each) |

**What to look at first:**
- `contracts/SavingsCircle.sol`: `_payOut()` and `upfrontCollateral()`.
- `test/circleRunner.js`: the independent rules R1–R3.
- `test/SavingsCircle.v921.test.js`: the exact numbers in scenarios A–C.
- `docs/MODE_COMPARISON.md`: the one combination where the modes differ.

**How to see the old bug:** in `SavingsCircle.sol`, change the hold condition and target in `_payOut()` back to `if (collateralFromPayout && r < size)` and `((size - r) * contribution * coverageBps + 9999) / 10000`, then run `npx hardhat test test/SavingsCircle.v921.test.js`. Scenario A/B fails (collateral 298 instead of 300), and so does rule R2 in the parity suite.

**Not verified here:** QIE testnet (follow `DEPLOYMENT_READINESS_V9_2_1.md`), real wallet signing in the app, and anything on mainnet itself. There has been no independent audit.
