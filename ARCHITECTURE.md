# PotLoop architecture

```mermaid
flowchart LR
  U[Member browser] --> W[QIE wallet]
  U --> A[React / Vite app]
  A --> R[Configured QIE RPC]
  W --> F[CircleFactory]
  F --> C[One SavingsCircle per circle]
  C --> T[Configured QUSDC ERC20]
  C -. accepted member and results .-> F
  K[Optional keeper] --> R
  K --> C
  K --> F
  A -. .qie name lookup .-> N[QIE name service endpoint]
  U -. optional swap link .-> D[QIEDEX]
```

## Components and trust boundaries

- **Frontend (`app/src`)** reads from a configured RPC and requests transactions through the connected wallet. It derives circle identity from the trusted configured factory, factory registration, and factory token match. Production builds ignore URL configuration unless explicitly enabled.
- **CircleFactory** has immutable token, fee, treasury and minimum-parameter configuration, including a minimum cover level `minCoverageBps` that `createCircle` enforces. `rules()` returns every rule in one read, with `FACTORY_VERSION` (92) so the app knows which `createCircle` signature it has. The app reads these rules before allowing creation and never assumes a lower minimum. A `SavingsCircle` deployed directly (bypassing the factory) is not in `isCircle`, and the app treats it as not genuine. It creates immutable `SavingsCircle` instances through its own `CircleDeployer`, indexes accepted membership and records wallet-level circle outcomes. There is no factory administrator.
- **CircleDeployer** (v9.2.1) holds the circle's creation code, so the factory stays at 6,492 bytes instead of 24,481. The factory creates it in its own constructor; it records that factory as its only caller and has no owner, settings or other function. Calling `deploy` from anywhere else reverts, so the factory's rules cannot be bypassed through it, and its address is fixed in the factory (immutable `deployer()`), so it cannot be swapped. Circles still record the factory as their registry, and the factory still registers each circle it asked for. A `SavingsCircle` can always be deployed directly by anyone; such a circle is not in the factory's `isCircle` list and the app treats it as not genuine.
- **SavingsCircle** holds one circle's state and token balance. The organizer has no administrative controls. Members accept, contribute and catch up; any caller may settle, finalize when conditions permit, sweep unsolicited surplus, and record a finished circle at the factory. Token outflows are user withdrawals from internal credits.
- **Member terms** are an on-chain read path: V9's `seatTerms` exposes the immutable commitment for each payout position, so a wallet can review collateral and scheduled exposure before approval.
- **Simulator (`app/src/sim.js`)** runs in the browser and reproduces the circle's settlement rules exactly. It powers the seat risk cards (`SeatRisk.jsx`) and the What-if panel (`WhatIf.jsx`). It never decides anything on chain; `test/Sim.parity.test.js` keeps it identical to the contract after every step, and the rule checks in `test/circleRunner.js` verify the collateral and repayment rules on the contract independently of the simulator. Commitment figures come from `seatTerms()` when the circle has it and are labelled by source.
- **QUSDC** is an external token dependency. The circle assumes standard exact-transfer behavior and rejects balance deltas that differ from the amount requested. Issuer controls (including possible freezes) remain outside PotLoop.
- **Keeper** is optional. It submits public settlement/finalization/history operations from an operator wallet. It is not required for members to call permissionless actions themselves.
- **QIE name lookup and QIEDEX** are auxiliary UI integrations; neither controls protocol accounting.

## Main call flows

1. Organizer calls factory `createCircle` (rejected below the factory's minimum cover); the factory deploys the circle and emits invitations.
2. Each invited member approves `upfrontCollateral(slot)` and calls circle `accept`; the circle transfers it and notifies the factory. The final acceptance activates round 1.
3. Members approve and call `contribute`. A caller invokes `settle` after all eligible members paid or after deadline plus grace. Settlement allocates pot funds, reserve and collateral across internal ledgers. In from-pot circles, part of each early recipient's pot is moved into their collateral (`CollateralHeldFromPot`).
4. A post-payout defaulter may catch up by paying used collateral, uncovered arrears, an open/unsettled current contribution, and a 2% fee on arrears. Any withdrawal is made later through `withdraw` or `withdrawTo`.
5. After the last round, a cure window applies while a member is behind. `finalize` returns remaining collateral, nets unpaid entitlements, allocates remaining reserve according to contract rules and marks the circle complete.
6. Anyone can call factory `recordCircle` after completion to write wallet-level outcomes.

Financial state machine and formula details are in `ECONOMIC_MODEL.md`. Deployment trust checks are in `DEPLOYMENT_CHECKLIST.md`.
