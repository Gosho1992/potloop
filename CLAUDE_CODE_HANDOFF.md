# PotLoop V9 validation handoff

> **Historical document.** Written for an earlier version, before the QIE mainnet deployment of 23 Nov 2026. Statements about what has or has not been deployed, which wallets to create and test counts describe that time. Current state: [`FINAL_RELEASE_READINESS.md`](FINAL_RELEASE_READINESS.md).

Run from the `potloop-v9` directory after dependencies are available. Record the terminal output with the commit or archive hash used.

## Required commands

1. `npm ci`
2. `npx hardhat compile`
3. `npx hardhat test`
4. `$env:INVARIANT_RUNS="1500"; npx hardhat test test/SavingsCircle.invariants.test.js`
5. `$env:EXHAUSTIVE="1"; npx hardhat test test/SavingsCircle.exhaustive.test.js`
6. `npm ci --prefix app`
7. `npm run build --prefix app`
8. If installed: `slither . --filter-paths "node_modules|contracts/test" --exclude-informational`

## Critical scenarios

- `seatTerms`: confirm each returned amount matches `collateralFor`, configured fee rounding and fixed payout order. Confirm an index equal to size reverts.
- Catch-up after the current deadline but before settlement: the quote includes the current round; catch-up records that contribution; settlement leaves the member Good.
- Catch-up with insufficient allowance or balance: the transaction reverts and neither status, collateral nor contribution record changes.
- Default after payout under 0%, 20%, 50% and 100% cover: confirm collateral draws once per missed round, liabilities remain accounted, and displayed uncovered exposure matches contract values.
- Final-round default: confirm the cure window blocks premature finalization, catch-up works during it and finalization is idempotently blocked after completion.
- Direct token donation plus `sweepSurplus`: confirm internal liabilities are never swept and repeated sweeping without excess reverts.
- Reentrant, fee-on-transfer, outbound-fee and blocked-recipient mock tokens: retain or extend the existing adversarial tests.
- Factory pages over 200 circles: confirm page size is capped at 100 and keeper visits older pages in one tick without overlapping work.
- Frontend: build a V9 deployment, verify the member seat page uses the on-chain quote; verify a V8 circle uses the formula fallback without showing invented data.

## Expected outcomes

All unit, scenario, adversarial and invariant tests should pass. The exhaustive suite is intentionally slow; it must finish without excluding any coverage level. The Vite build must complete without lint or module-resolution errors. Any skipped or failed command is a release blocker until documented and assessed.

## Known limitations

This handoff package has not run the commands above in its current environment. QIE mainnet token bytecode, issuer controls, deployed factories, RPC behavior, and frontend wallet behavior need live verification. Independent contract review remains required before handling material funds.
