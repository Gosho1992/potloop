# V9.2.2 changelog

> **Historical document.** Written for an earlier version, before the QIE mainnet deployment of 23 Nov 2026. Statements about what has or has not been deployed, which wallets to create and test counts describe that time. Current state: [`FINAL_RELEASE_READINESS.md`](FINAL_RELEASE_READINESS.md).

- `test/circleRunner.js`: rule R3 now checks every original payout as well as every repayment. It verifies the fee (computed independently from the gross), the collateral held, the withdrawable increase, the paid-out flag, the recorded shortfall, the entitlement reduction, and FeeCharged events = treasury rise.
- `test/SavingsCircle.v921.test.js`: a test proving every original payout and repayment passes through R3.
- `scripts/mutation-sim.mjs`: 15 mutations. The new one: the fee rounds up in both the contract and the simulator, caught by R3.
- `scripts/run-evidence.sh`: the Slither step returns Slither's real exit code.
- No contract, simulator or app changes.
