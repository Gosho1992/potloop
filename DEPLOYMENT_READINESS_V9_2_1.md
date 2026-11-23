# V9.2.1 deployment readiness: QIE testnet first

> **Historical document.** Written for an earlier version, before the QIE mainnet deployment of 23 Nov 2026. Statements about what has or has not been deployed, which wallets to create and test counts describe that time. Current state: [`FINAL_RELEASE_READINESS.md`](FINAL_RELEASE_READINESS.md).

**Status: ready for a QIE testnet deployment by you. Not approved for mainnet.** Nothing has been deployed anywhere and no funds were moved.

## What was verified from here, and how

| Item | Result | How |
| --- | --- | --- |
| QIE mainnet RPC | Reachable, chain ID 1990 | `eth_chainId` on `https://rpc1mainnet.qie.digital` returned `0x7c6` |
| QUSDC on mainnet | Contract at `0x3F43DA82eC9A4f5285F10FaF1F26EcA7319E5DA5`, symbol QUSDC, 6 decimals, total supply about 8,929 QUSDC | Read on a local copy of mainnet at block ~12,092,170 |
| QUSDC behaviour with PotLoop | Transfers and approvals land exactly; a full circle (accept, contribute, default, collateral paying, catch-up, finalize, withdraw) ends with the circle holding 0 | `scripts/fork-production-check.js` on a **local copy** of mainnet; nothing sent to mainnet |
| Production factory settings | 1-day minimum rounds, 12-hour grace, 1 QUSDC minimum, 0.5% fee, 100% minimum cover: factory deploys (5,575,199 gas), `rules()` reads back correctly, `CircleDeployer` points back to the factory | Same script |
| QIE testnet RPC | **Not verified.** `https://rpc1testnet.qie.digital` resolves but reset the connection from our build machine | `curl` from the workspace |
| QIE testnet chain ID | 1983, **from a third-party listing and earlier project notes**; QIE's own docs page could not be fetched from here | Web search |
| Testnet stablecoin | **Unknown.** No testnet QUSDC address could be found | Web search |
| Testnet explorer and contract verification | **Unknown.** No testnet explorer URL could be confirmed, so `hardhat.config.js` has no testnet verification entry | |
| Testnet faucet | **Unknown** | |
| Deploy script on chain 1983 | Runs end to end on a local chain that reports 1983; refuses any other chain | `HARDHAT_CHAIN_ID=1983 npx hardhat run scripts/testnet-deploy.js` |
| Wallet connection and signing in the app | **Not verified** (needs your browser and QIE Wallet) | |

## Before you start

1. Confirm in QIE's official docs or the QIE Wallet: the testnet RPC URL, chain ID 1983, the explorer URL and the faucet. If the RPC differs, set `QIE_TESTNET_RPC` (PowerShell: `$env:QIE_TESTNET_RPC="https://..."`).
2. Create a **fresh testnet-only wallet** in QIE Wallet. Never use your main wallet's key here.
3. Get testnet QIE for gas from the faucet.

## Deploy and test (PowerShell, in the `potloop-v9.2.1` folder)

Window 1:

1. `npm install`
2. `$env:DEPLOYER_PRIVATE_KEY="<testnet-only key>"`
3. `npx hardhat run scripts/testnet-deploy.js --network qieTestnet`
   - Without `TOKEN`, it deploys the project's mock token (symbol mQUSDC, 6 decimals, valueless, anyone can mint) and mints 1,000 to you. If QIE publishes a testnet stablecoin, set `$env:TOKEN="<address>"` first.
   - It prints the factory and `CircleDeployer` addresses, reads back the rules, checks the deployer points to the factory, and saves `testnet-deployment.json` (addresses only).
4. `$env:FACTORY="<printed factory address>"`
5. `node scripts/make-wallets.js 4` (creates 4 throwaway demo wallets in `demo-wallets.json`; it's in `.gitignore`)
6. `npx hardhat run scripts/demo-mainnet.js --network qieTestnet`. Despite its name, it runs on any network. It is the full story with real testnet transactions: the circle is created, members accept (collateral held from the pot), contribute and settle; seat 1 defaults and its collateral pays; the next payouts are short and the entitlements recorded; seat 1 catches up and the entitlements are repaid; then finalize and every withdrawal. It takes about 6–8 minutes with 1-minute rounds.
7. Pull the demo wallets' money back: `$env:TOKEN="<token address>"; npx hardhat run scripts/return-funds.js --network qieTestnet`

Window 2 (the app against testnet; URL overrides work only in dev builds):

8. `cd app`, `npm install`, `npm run dev`
9. Open the link printed by step 3 and check, with QIE Wallet on testnet: connecting, the chain check, the create screen's cover levels and capital figures, creating a small circle yourself, approving and accepting, contributing, and the history lines for payouts, held collateral and repayments.

Close window 2 with Ctrl+C when you're done.

## Checklist

- [ ] RPC URL and chain ID 1983 confirmed from QIE's own source
- [ ] Testnet-only deployer wallet funded from the faucet
- [ ] `testnet-deploy.js` run; factory and `CircleDeployer` addresses recorded; `rules()` as expected
- [ ] Contracts verified on the testnet explorer (once its URL and API are known, add a `customChains` entry like mainnet's)
- [ ] Story run completed (`demo-mainnet.js`), every step's transaction visible on the explorer
- [ ] App: wallet connects, wrong-chain warning works, approvals show exact amounts, create / accept / contribute / settle / catch-up / withdraw all succeed from the UI
- [ ] Demo funds returned

## Mainnet, later

Only after the testnet checklist passes and you decide: `scripts/deploy-factory.js --network qieMainnet` (it pins QUSDC and checks chain 1990 and 6 decimals). Choose `MIN_COVER_BPS` (10000 = full cover only; 0 also allows trust circles) and a treasury (a Safe multisig for real use). See `DEPLOYMENT_CHECKLIST.md`. There is still no independent audit.
