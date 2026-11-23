# UI acceptance report (automated)

**Result: 23 of 23 cases pass** on the production build of the app, after three app bugs were fixed (two found by this suite, one found on the live app on 23 Nov 2026 and now covered by E2E-23). Raw results: `evidence/v93-release/ui-e2e/results.json`, a screenshot per case, and the browser console log.

## What was tested, and how

| | |
| --- | --- |
| App | The real React app (`app/src`), built in **production mode** with `vite build` and served by `vite preview`, with the test factory baked in. URL settings are ignored, as in a real deployment |
| Chain | A local Hardhat node (chain 31337) with a test token and a `CircleFactory` that has the QIE demo factory's rules: 0.5% fee, 60 s minimum round, 30 s grace, 0.01 minimum, 0% minimum cover (`scripts/e2e-deploy.js`) |
| Browser | Chromium (Google Chrome, headless) driven by Playwright 1.63 |
| Wallet | A scripted EIP-1193 wallet (`app/e2e/wallet-double.js`). It announces itself through EIP-6963 as QIE Wallet (`rdns me.qiewallet`), the same discovery path the app uses for the real extension, and signs with the node's test accounts. It can reject a connection, a network switch or a signature, change account or network, and disconnect |
| Verification | Every action is done through the page; its result is then checked **on chain** (calls to the factory, circle and token), not only on screen |
| Run | `node app/e2e/run-e2e.cjs` from the project folder (about 2.5 minutes; needs `npm i --no-save playwright@1.63.0` in `app` once, or `CHROME=<path to Chrome>`) |

**Not tested here:** the real QIE Wallet extension and mobile app, the real QIE RPC, QIE ID (`.qie`) name lookup (mainnet only), explorer links, small screens, and screen readers. These are in the manual plan, `POTLOOP_UAT_PLAN.md`.

## Cases

| ID | Case | Result | What was checked |
| --- | --- | --- | --- |
| E2E-01 | QIE Wallet discovered via EIP-6963 and connects | PASS | Header shows the account; `eth_requestAccounts` requested |
| E2E-02 | User rejects the connection | PASS | "You cancelled it in your wallet."; not connected |
| E2E-03 | Wallet on the wrong network; switch accepted | PASS | `wallet_switchEthereumChain` requested; connected on the right chain |
| E2E-04 | Wallet on the wrong network; user refuses to switch | PASS | Clear message; not connected |
| E2E-05 | Create page reads the factory's real rules | PASS | Minimum 0.01 shown; 3-minute schedule offered; 0% cover enabled because the factory allows it |
| E2E-06 | Create a circle from the UI | PASS | On chain: registered, name, members in order, 0.5 per round, 100% cover, 180 s rounds |
| E2E-07 | Copy invite link; open it as another member | PASS | Link is exactly `<site>/#/c/<circle>`; opens the circle |
| E2E-08 | Accept three seats; exact collateral approval | PASS | Each `approve` the app sent equals `upfrontCollateral(seat)` and names the circle as spender; circle Active |
| E2E-09 | Contribute from three accounts | PASS | `contributed(1, seat)` true for all |
| E2E-10 | Settle, refresh, reconnect | PASS | Round 2 shown after refresh, as on chain. After a refresh the user must press Connect again (no silent reconnect) |
| E2E-11 | Rejected signature | PASS | Message shown; no transaction sent; not recorded as paid; retry succeeds |
| E2E-12 | Slow confirmation (mining paused) | PASS | "confirming on QIE" with a transaction link; buttons disabled until mined; success message after |
| E2E-13 | Default after the payout; settle after the deadline | PASS | "Behind on payments" warning; catch-up amount, secured and still-owed figures equal `catchUpCost` and `risk()` on chain |
| E2E-14 | Catch up from the UI | PASS | Breakdown (arrears, this round, late fee) equals the chain's; approval equals the total; status back to good |
| E2E-15 | Last round and finalize | PASS | Phase Completed on chain |
| E2E-16 | Record results | PASS | `recorded` true; seat 1 caught up 1, seats 2–3 completed 1; the button disappears at once (88 ms) |
| E2E-17 | Withdraw for each member | PASS | The button shows the exact withdrawable amount; each wallet receives exactly it; the circle keeps only the treasury's fee; members' losses equal that fee |
| E2E-18 | Wallet disconnects | PASS | Account dropped; Connect offered |
| E2E-19 | Wallet switches network mid-session | PASS | Connection dropped with a clear message |
| E2E-20 | RPC unreachable | PASS | "Can't reach the QIE network right now…" and "Can't read the circle right now"; no action buttons; a genuine circle is **not** called fake |
| E2E-21 | Circle not created by the official factory | PASS | Refused with a warning; no actions |
| E2E-22 | URL tries to set factory and RPC | PASS | Ignored by the production build |
| E2E-23 | Every tab of a finished circle that had a default and a catch-up | PASS | No page errors; 28 history lines, the default and the catch-up described in words, no event shown by its raw name |

## Bugs found by this suite and fixed (app only; no contract change)

| Severity | Bug | Fix | Proof |
| --- | --- | --- | --- |
| Medium | With the RPC unreachable, a **genuine circle was shown as "not a circle created by PotLoop's official factory. Don't approve or send anything to it."** The failed `isCircle` call was treated as "no". The header also said the network was the wrong chain rather than unreachable. In a demo or a pilot this tells members their real circle is a scam | `loadCircle` no longer swallows the factory lookup error (it becomes "Can't read the circle right now"); `verifyNetwork` distinguishes unreachable (`null`) from the wrong chain (`false`); new message for unreachable | Seen in the first full run on the original code (its screenshot showed the warning on the genuine circle; that run's files were overwritten by later runs). Passes now |
| Low | A refresh requested while another was running was dropped, so the screen could lag. After an action, "Record results" stayed visible and a second press gave a correct but confusing "already recorded" error. After an **account switch in the wallet**, the previous account's view and buttons could stay on screen for 15 s or more | A refresh asked for during another one now runs right after it | E2E-16 failed on the original code ("record button still offered"). The current suite run against the original app (commit `2cfb6b2`) fails 12 of 22, starting with the new account's "accept seat 2" button not appearing within 30 s: `evidence/v93-release/ui-e2e-before-fix/`. All pass after the fix |

| High | Opening **Risk and history** on any circle that had paid a pot showed a **blank page**. The history text for a payout read `circle.fromPayout`, but the function that writes it was never given the circle (`ReferenceError: circle is not defined`). Found while filming the demo on the 7 mainnet circles; the suite had never opened that tab. Also: returned collateral was listed by its raw event name, and the members table said "2 misss" | The circle is passed to `eventText`; `CollateralReturned` has a sentence; the members table says "missed rounds" | New case E2E-23 fails on the old code ("page error on Risk and history: circle is not defined") and passes now. All 3 tabs checked on all 7 mainnet circles with no page errors |

## Observations, not changed

- After a page refresh the wallet is not reconnected automatically; the user presses Connect. This is safe and simple. Silent reconnection (`eth_accounts`) would be a feature, so it was not added.
- The production bundle is larger than 500 kB (Vite warning). It loads fine; code-splitting is an optimisation, not a defect.
