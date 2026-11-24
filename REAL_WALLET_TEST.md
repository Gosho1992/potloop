# Real QIE Wallet test on QIE mainnet (24 Nov 2026)

A person (the developer) used the live app at https://potloop.vercel.app with the **real QIE Wallet browser extension** on **QIE mainnet** and approved every wallet prompt by hand. The screen was recorded; 13 seconds of it are in the demo video.

## What was done

| Step | Result | Transaction |
| --- | --- | --- |
| Connect QIE Wallet (account `woifz84188.qie`, 0x7145…6910) | Connected; the QIE ID name shows in the header | none |
| Create circle "Live wallet test": 2 members, 0.01 QUSDC every 3 minutes, 100% cover, collateral from the pot | Created at [0xcf2f…3c1c](https://mainnet.qie.digital/address/0xcf2f8b769447E15006afaEBBd9d1263669B53c1c). The QIE Wallet prompt showed the factory as recipient, 0 QIE sent and the gas fee | [0x4aae2a…e085](https://mainnet.qie.digital/tx/0x4aae2abe4a21e569d8c2f3efdf8ec2986f64674f9c1cd95988e464a48130e085) |
| Accept seat 1: approve exactly 0.01 QUSDC, then lock it | Both prompts approved in QIE Wallet; "1 of 2 members have accepted their seats" | approval [0x1475f5…9f26](https://mainnet.qie.digital/tx/0x1475f5bed8824f4a585e756c56b477effe12b7da4b99f2ae940bdf72be6c9f26), accept [0x3a9446…1a7d](https://mainnet.qie.digital/tx/0x3a9446412777dce507aaf949c6f91aca23f57ccdf21b9fa47c93b5de2bce1a7d) |
| Reload the page | The wallet reconnected without a prompt (quiet reconnect) | none |
| Deploy the production factory (one-off owner page) | Deployed `0xE1ea943b865F47e984156526add5E07B03893834` with the agreed rules. The page showed "Request timeout" because QIE Wallet answered slowly, but the transaction went through; the rules were read back from the chain | [0xc8ae6e…6ea5](https://mainnet.qie.digital/tx/0xc8ae6efb0a0124ace60c2d05226b331e4c2b4db61c243c90f6910234c2636ea5) |
| Record S4's results to the track records (circle page button) | "Everyone's track record is updated"; `recorded(S4)` is true. 331,272 gas, exactly the figure measured beforehand on a local copy of mainnet | [0xedad45…099f](https://mainnet.qie.digital/tx/0xedad45665b5dad667e7729867012c74c3fb9c774ed41cd8adccbf8525c28099f) |

Seat 2 was not joined, so the circle is cancelled when joining closes and seat 1's 0.01 QUSDC can be withdrawn from the circle page.

## Two bugs found and fixed during the test

1. **Accepting a seat failed before the wallet opened** with "missing revert data". QIE Wallet's own node could not estimate gas for the QUSDC approval, although the same transaction estimated fine (46,949 gas) on QIE's public RPC. Fix: the app estimates gas on its own QIE RPC and adds 25%, so the wallet only signs (`signerFrom` in `app/src/chain.js`). A real revert now also comes back with its reason. The allowance is read from the app's RPC too. After the fix, seat 1 was accepted at the first try.
2. **History and invitations stopped loading** once the factory was more than 10,000 blocks old: QIE's public RPC refuses `eth_getLogs` over more than 10,000 blocks, and the app asked for 20,000. Fix: 5,000-block pages.

Both fixes were deployed during the test (commit `534f304`), and the UI acceptance suite passes 25/25 with them.

## Not covered

The test used the browser extension on Windows, not the QIE Wallet mobile app, and stopped after one accepted seat: payments, payout, catch-up and withdrawal with a real wallet remain covered by the mainnet runs S1–S7 (scripted wallets) and the browser suite (scripted wallet). See `POTLOOP_UAT_PLAN.md` for the full manual checklist.
