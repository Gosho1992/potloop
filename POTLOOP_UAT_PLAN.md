# PotLoop user acceptance plan (live wallet)

The automated suite (`UI_E2E_REPORT.md`) proves the app's logic with a scripted wallet. This plan is what a **person** must do with the **real QIE Wallet** before PotLoop is shown to outside users. Every case is in `UAT_TEST_CASES.csv`, with whether a person is needed and which automated case already covers the logic.

## Two stages

| Stage | Where | Money | Approval |
| --- | --- | --- | --- |
| **A. Local rehearsal** | `npx hardhat node` + `npm run dev` in `app` (or the e2e build), QIE Wallet pointed at the local chain (chain 31337, RPC `http://127.0.0.1:8545`), local test accounts imported **only into a throwaway browser profile** | Test tokens only | None |
| **B. Mainnet UAT** | The app built with `app/.env` from `app/.env.example` (demo factory), QIE Wallet on QIE mainnet | Real QUSDC and QIE, small | **Separate explicit written approval from the owner before the first transaction.** Not part of this assignment |

Stage B is the only way to test the real extension against the real chain. Its proposed budget, for approval later:

| Item | Amount |
| --- | --- |
| Wallets | 3 **fresh** wallets made in QIE Wallet on the tester's devices (never exported, never zipped). Not the 7 retired test wallets |
| Circle | 3 members, 0.02 QUSDC per round, "Every 3 minutes", 100% cover, collateral from the pot, on the demo factory |
| QUSDC | 0.06 per wallet (0.18 in all); comes back at the end, minus 0.0003 per member in fees |
| QIE | 0.02 per wallet for gas (0.06 in all); one circle costs about 0.007 QIE in total |
| Note | The demo factory's 0.5% fee (0.0009 QUSDC for this circle) goes to the exposed test treasury: negligible, but stated |

## Roles

- **Operator (person):** runs the browser, approves or rejects in QIE Wallet, records results and screenshots.
- **Observer (person or script):** checks each result on the explorer or with `scripts/reconcile-mainnet.js` (read-only).
- Cases marked **HUMAN** cannot be automated: they need the real extension's own screens.

## Procedure (stage B; stage A is the same against the local chain)

| Step | Who | Action | Pass when |
| --- | --- | --- | --- |
| 1 | HUMAN | Install QIE Wallet in a fresh browser profile; create 3 wallets; fund each with 0.06 QUSDC and 0.02 QIE from the owner's wallet | Balances show in QIE Wallet |
| 2 | HUMAN | Open the app with QIE Wallet set to another network; press Connect | QIE Wallet shows a network-switch prompt; after approval the header shows the account (UAT-01, UAT-02) |
| 3 | HUMAN | Reject a connection once, then accept | The rejection gives "You cancelled it in your wallet."; accepting connects (UAT-03) |
| 4 | HUMAN | Reload the page | Wallet shown as disconnected; Connect reconnects without a new permission prompt (UAT-04) |
| 5 | HUMAN | Open "Start a circle" | Minimum 0.01 QUSDC; 3-minute schedule; 0% cover allowed with the risk box (UAT-05) |
| 6 | HUMAN | Create the circle: wallet 1 first, then wallets 2 and 3 by address or `.qie` name | QIE Wallet shows one transaction to the factory; the app opens the new circle (UAT-06) |
| 7 | HUMAN | Copy the invite link; open it in wallet 2's browser | The circle opens; "0 of 3 have accepted" (UAT-07) |
| 8 | HUMAN | Each wallet: "Lock … and accept seat n" | **QIE Wallet's approval screen shows exactly the seat's collateral (0.02), spender = the circle**; then the accept transaction (UAT-08) |
| 9 | HUMAN | Each wallet pays round 1; then Settle | QIE Wallet shows approve 0.02, then contribute; round 2 starts (UAT-09, UAT-10) |
| 10 | HUMAN | Reject one payment in QIE Wallet, then pay again | Clear message; nothing sent; retry works (UAT-11) |
| 11 | HUMAN | Round 2: wallet 1 (paid out in round 1) does not pay; wait out the deadline and grace (about 4 minutes); Settle | Warning that wallet 1 is behind; catch-up amount shown, equal to `catchUpCost(0)` on the explorer (UAT-13) |
| 12 | HUMAN | Wallet 1: "Catch up: pay 0.0404" (0.02 arrears + 0.02 for round 3 + 0.0004 late fee) | QIE Wallet approval equals the total; status back to good (UAT-14) |
| 13 | HUMAN | Wallets 2 and 3 pay round 3; Settle; "Finish the circle" | "This circle is finished." (UAT-15) |
| 14 | HUMAN | "Record results to track records" | One transaction to the factory; seat 1 shows "caught up", the others "completed"; the button disappears (UAT-16) |
| 15 | HUMAN | Each wallet: Withdraw; also try "Withdraw to another address" once | Exact amounts received; the balance shown in QIE Wallet matches (UAT-17, UAT-18) |
| 16 | HUMAN | During any step: switch account in QIE Wallet, switch network, lock the wallet | The app follows the account, drops on a network change, asks to connect when locked (UAT-19 to UAT-21) |
| 17 | HUMAN | Turn the network off mid-page (aeroplane mode), then on | "Can't reach the QIE network…"; never "not a genuine circle"; recovers after reload (UAT-22) |
| 18 | HUMAN | Repeat steps 2, 8, 9 and 15 on the **QIE Wallet mobile app** (in-app browser) | Same results on a phone screen (UAT-23) |
| 19 | Observer | `scripts/reconcile-mainnet.js` (read-only) with the new circle | Circle holds 0; ledgers 0; recorded; outcomes as expected (UAT-24) |

## Evidence to keep

For each case: pass/fail, the transaction hash, a screenshot of QIE Wallet's prompt and of the app, and the tester's name and time. A failed case stops the stage. It is retried only after the cause is understood, never by repeating payments blindly.

## Exit criteria

Every UAT case passes in stage A. Before outside users are invited, every case in stage B passes on desktop and steps 2, 8, 9 and 15 on mobile. Any defect is fixed and re-run in stage A first.
