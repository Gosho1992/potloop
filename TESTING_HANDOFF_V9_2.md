# V9.2 testing handoff (for Claude Code or any reviewer)

> **Historical document.** Written for an earlier version, before the QIE mainnet deployment of 23 Nov 2026. Statements about what has or has not been deployed, which wallets to create and test counts describe that time. Current state: [`FINAL_RELEASE_READINESS.md`](FINAL_RELEASE_READINESS.md).

The fastest complete check: from a copy of this folder **without** `node_modules`, run

```
bash scripts/run-evidence.sh
```

It installs from both lockfiles, runs every step below, and writes raw logs plus SHA-256 hashes of the source to `evidence/`. Compare with `TEST_EVIDENCE_V9_2.md`. On Windows run it in Git Bash or WSL, or run the steps one by one in PowerShell:

| Step | Command (project folder unless noted) | Expected |
| --- | --- | --- |
| 1 | `npm ci` | Installs from the lockfile |
| 2 | `npx hardhat compile --force` | 16 files compile; one pre-existing warning (`leave` will become a keyword) |
| 3 | `npx hardhat test` | 107 passing, 3 pending (the exhaustive tests, skipped by default) |
| 4 | `node scripts/mutation-sim.mjs` | `11/11 mutations caught` |
| 5 | `node scripts/payoff-matrix.mjs` | `docs/PAYOFF_MATRIX.md` regenerates byte-identically |
| 6 | `cd app`, `npm ci`, `npm run build` | Builds (a chunk-size warning is expected) |
| 7 | `slither . --hardhat-ignore-compile --filter-paths "node_modules\|contracts/test" --exclude-informational --exclude-optimization` | Review the findings against `evidence/08-slither.log` |
| 8 | Optional: `$env:EXHAUSTIVE="1"; npx hardhat test test/SavingsCircle.exhaustive.test.js` (about 45 minutes) | 3 passing |

Hand checks in the app (local chain; window 1 `npx hardhat node`, window 2 `npx hardhat run scripts/demo-local.js --network localhost`, window 3 `cd app` and `npm run dev`, then open the printed link):

1. Start a circle with 3 members and 1 per round. At 100% with "Mostly from the pot", seat 1 shows "1 to join" and the comparison table shows 2 to start and 0 walk-away gain.
2. Switch to "All up front": seat 1 needs 2 to join (3 to start).
3. Pick 50%: Review stays disabled until the risk box is ticked. The box states the exact gain and loss.
4. Deploy a factory with `MIN_COVER_BPS=5000` and open the create screen with it: 40%, 30%, 20% and 0% are disabled with "not allowed here" and an explanation.
5. Open the app with a factory address that has no contract: the create screen says so and Create is off.

Not verified here: behaviour on QIE mainnet, the real QIE Wallet, and the real QUSDC token. Nothing was deployed.
