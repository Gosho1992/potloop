# PotLoop security review (workspace review, 2026-11-20)

> **Historical document.** Written for an earlier version, before the QIE mainnet deployment of 23 Nov 2026. Statements about what has or has not been deployed, which wallets to create and test counts describe that time. Current state: [`FINAL_RELEASE_READINESS.md`](FINAL_RELEASE_READINESS.md).

## Scope and confidence

Reviewed the checked-out source files under `contracts/`, `scripts/`, `app/src/`, `test/`, root configuration and README. This is an engineering review, not an independent audit. Execution was blocked in the original environment (no npm registry access); compilation, tests and static analysis were then run on the same source in a second environment, recorded in `TEST_EVIDENCE.md`. No production-chain verification was done. This document does not certify the protocol as secure.

## Confirmed findings

### High: catch-up could restore a member before paying an expired, unsettled round

Before remediation, `catchUpCost()` only included the current contribution while `deadline() + grace` had not passed. `catchUp()` could therefore restore a post-payout defaulter to Good after the current window expired but before anyone settled. The subsequent `settle()` would mark that member in default again. This was reproducible from the contract logic and is now addressed by including every unrecorded current-round contribution in catch-up cost; catch-up also marks that round contributed and funds `roundFund` atomically. A regression test was added. **Verified afterwards:** the test fails on the previous contract and passes on this one, and the full suite, 1,500 random runs, the exhaustive suite and Slither were run on this source (see `TEST_EVIDENCE.md`).

## Review notes requiring further validation

- The circle has a bounded maximum of 12 members, exact-delta ERC20 checks, SafeERC20, and `nonReentrant` on state-changing circle operations. The mock-token tests include reentrant and transfer-fee cases; they pass on this source (see `TEST_EVIDENCE.md`).
- `sweepSurplus()` computes surplus above internal ledgers; it does not deliberately count liabilities as surplus. A complete stateful assets-versus-liabilities proof is not available from the current tests, and an independent auditor should review every state transition.
- CircleFactory `recordCircle()` loops over at most 12 contract members. Read pagination is now capped at 100 results per call. Circle creation itself is bounded by the SavingsCircle constructor's 2–12 member validation.
- Keeper now visits every page and its loop is sequential, so one invocation does not overlap itself. RPC and transaction failures are caught at the outer tick boundary; monitoring and retry behavior still need operational testing.
- Production UI config ignores URL overrides unless explicitly enabled by build configuration, and circles are checked against the configured factory and token. The configured factory address remains a deployment trust root and must be reviewed and pinned by the operator.
- QIE's official developer information lists chain ID 1990 and QUSDC at the address present in source, and QIE describes QUSDC as bridged, not issued by Circle. This verifies published identifiers only; token bytecode, decimals on-chain, administrative/freeze behavior, reserves, RPC responses and explorer behavior were not queried. No deployment was made.
- Identity names and reputation are wallet-level signals only; they do not establish unique persons or creditworthiness.

## Required independent review before real funds

Review the modified contract and regression test, run the full suite plus stateful invariants and static analysis, verify the official QUSDC contract and factory configuration from authoritative QIE sources, inspect the deployed bytecode/source match, and conduct an external smart-contract audit. Do not use real users or material funds before those steps.
