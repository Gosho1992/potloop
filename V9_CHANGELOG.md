# PotLoop V9 implementation changelog

> **Historical document.** Written for an earlier version, before the QIE mainnet deployment of 23 Nov 2026. Statements about what has or has not been deployed, which wallets to create and test counts describe that time. Current state: [`FINAL_RELEASE_READINESS.md`](FINAL_RELEASE_READINESS.md).

## Product thesis

PotLoop is a non-custodial QUSDC savings circle for small, known groups. Its differentiator is not that it is a ROSCA: it turns payout-order exposure into an explicit collateral requirement, then exposes the complete settlement and recovery path from live contract state.

## Implemented in V9

- Added `SavingsCircle.seatTerms(slotIndex)`, an on-chain quote for a seat's collateral, total commitment, expected payout after the configured fee, remaining post-payout payments and initially uncovered scheduled exposure.
- Added an exact member-term test for that quote, including fee calculation and invalid seat rejection.
- Centralized frontend financial calculations in `app/src/economics.js`. The creation flow, seat page and worst-case simulation now share integer-only calculations that mirror contract rules.
- Upgraded circle creation with a per-seat commitment grid: total payments, collateral, expected payout, post-payout obligation, collateral-backed amount, uncovered amount and a conservative default simulation.
- Upgraded the member seat page with contract-preferred terms. Existing circles fall back to the same immutable formula; V9 deployments read the quote directly from the contract.
- Expanded catch-up feedback to itemize arrears, the still-unsettled current round and the deterministic late fee before a member approves the transaction.
- Added landing-page product framing focused on position-priced commitments, the settlement waterfall and on-chain recovery, plus a realistic first-pilot scope.
- Kept circle mechanics non-custodial and permissionless. No mainnet deployment, private-key handling, or fund movement was performed.

## Deployment compatibility

`seatTerms` is a new view function and requires V9 circle deployments to be present on chain. The frontend remains readable for older circles: it handles a missing quote and calculates the same terms from immutable configuration. Do not represent an older factory's circles as V9 deployments unless their bytecode includes the new function.

## Deliberately not claimed

V9 does not claim identity verification, credit scoring, insurance, guaranteed recovery, protection from QUSDC issuer controls, or resistance to a coordinated multi-wallet Sybil strategy. Wallet history is a signal only.
