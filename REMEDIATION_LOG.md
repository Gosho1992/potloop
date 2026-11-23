# Remediation log

> **Historical document.** Written for an earlier version, before the QIE mainnet deployment of 23 Nov 2026. Statements about what has or has not been deployed, which wallets to create and test counts describe that time. Current state: [`FINAL_RELEASE_READINESS.md`](FINAL_RELEASE_READINESS.md).

## 2026-11-20 — workspace remediation

- **Catch-up lifecycle (confirmed):** changed catch-up pricing so an unrecorded current-round contribution remains payable after the deadline as well as before it. Existing catch-up effects atomically mark it contributed, add it to the round fund, restore collateral, and restore status. Added tests for the expired-window-before-settlement sequence and insufficient funds. The late fee remains computed on arrears (`restore + uncovered`); the current-round contribution itself is not included in that fee.
- **Factory pagination:** bounded each page result to `MAX_PAGE_SIZE = 100` to avoid oversized RPC responses and unbounded client allocations.
- **Keeper coverage:** changed scanning to walk all factory pages in sequential batches of 100 instead of only the newest 200 circles.
- **Verification status:** not runnable in the original environment (no npm registry access). Afterwards compiled and tested on the same source elsewhere: 65 passing, 1,500 random runs passing, exhaustive suite and Slither run; the new regression test fails on the previous contract and passes now. See `TEST_EVIDENCE.md`.

## Not yet remediated or verified

The broader requested economic/game-theoretic assessment, full stateful liability invariant suite, all frontend financial-display checks, official QIE token verification, production configuration verification, comprehensive keeper mock tests, Echidna/Medusa fuzzing and an external audit remain outstanding. No claim of security or production readiness is made.
