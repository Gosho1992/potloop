# Production factory: recommendation for approval

**Deployed 24 Nov 2026** with the pilot settings below (grace 6 h, fee 0, no treasury): factory `0xE1ea943b865F47e984156526add5E07B03893834`, block 12,132,174, [deployment transaction](https://mainnet.qie.digital/tx/0xc8ae6efb0a0124ace60c2d05226b331e4c2b4db61c243c90f6910234c2636ea5), 5,572,073 gas (0.0056 QIE). The owner approved the settings in chat and signed the deployment in their own QIE Wallet (the deploying account is not one of the exposed addresses and gets no power over the factory). The creation code is the same build whose code matched the testing factory byte for byte, and the source is **verified on the QIE explorer**. Rules read back from the chain: QUSDC, treasury 0x0, fee 0, 86,400 s, 21,600 s, 1,000,000 (1 QUSDC), 10,000 (100%), version 92. The app now creates circles there and still opens the testing factory's circles (`VITE_EARLIER_FACTORIES`), marked as test circles, so the migration notes below were handled without a separate demo build.

The proposal as written before the deployment follows.

## The deployed factory is a demo factory

| Setting | Demo factory `0xD099…Dae4` (deployed) | Script's production mode | Recommended for a controlled pilot | Recommended for production |
| --- | --- | --- | --- | --- |
| Minimum round | 60 s | 1 day | **1 day** | 1 day |
| Minimum grace | 30 s | 12 h | **6 h** (see note 1) or 12 h | 12 h |
| Minimum contribution | 0.01 QUSDC | 1 QUSDC | **1 QUSDC** | 1 QUSDC |
| Minimum cover | 0% | 100% | **100%** | 100% |
| Fee | 0.5% | 0.5% | **0%** (note 2) | 0.5% or as decided |
| Treasury | test wallet, key **exposed** | deployer wallet unless `TREASURY` is set | **none** (address zero; possible only with fee 0) | a multisig (note 3) |
| Token | QUSDC | QUSDC (pinned, 6 decimals checked) | QUSDC | QUSDC |
| Deployer | test wallet (exposed) | any | **fresh wallet**, gas only, discarded after | fresh wallet |
| Explorer source verification | not done | printed commands | **done before any invitation** | done |

All of these are immutable once deployed. Nothing about the demo factory can be changed, so a pilot means a new factory.

Why each recommendation:

- **1-day minimum rounds.** S5 failed on mainnet because 12 confirmations took longer than a 60-second round. Real groups need hours to react, and a payment a few seconds late before your turn costs your collateral.
- **1 QUSDC minimum.** It makes farming track records with dust circles cost something. On the demo factory a full 2-member circle costs 0.02 QUSDC.
- **100% minimum cover.** Below 100%, the member paid first can profit by walking away (`docs/PAYOFF_MATRIX.md`; tested in `test/ReleaseAcceptance.test.js` at 0, 20 and 50%). With full cover, a walk-away gains nothing and nobody else loses.
- **Note 1, grace.** The app offers "Every day" with 6 hours' grace. With a 12-hour minimum grace the factory would refuse that schedule, and the app hides it (it filters schedules by the factory's rules), leaving weekly and 30-day circles. Choose either 6 h (keeps daily circles) or 12 h (no daily circles), on purpose.
- **Note 2, fee 0 for a pilot.** With no fee the treasury can be the zero address (the contract allows it only then), so no key anywhere can ever collect from the factory. This removes the treasury question entirely for a pilot.
- **Note 3, multisig.** Safe is **not deployed on QIE mainnet**: none of its standard v1.3.0 or v1.4.1 contract addresses, its singleton factory, or the common deterministic deployer has code there (read on 23 Nov 2026). Before a production factory with a fee, either get Safe deployed on QIE (normally through Safe or QIE), or deploy and independently review a minimal multisig. `scripts/deploy-factory.js` now refuses a plain-wallet treasury in production unless `ALLOW_EOA_TREASURY=1` is set as a recorded decision.

## Deployment command (for when it is approved)

Pilot settings with grace 6 h, fee 0, no treasury, run from a fresh wallet:

```powershell
# 1. preview: without APPROVE_DEPLOY the script prints the exact settings and their approval code, and sends nothing
$env:MODE="production"; $env:FEE_BPS="0"; $env:MIN_COVER_BPS="10000"; $env:MIN_GRACE_SECONDS="21600"
npx hardhat run scripts/deploy-factory.js --network qieMainnet      # prints "approval code is D-xxxxxxxx"
# 2. only after the owner approves those printed settings in writing:
$env:APPROVE_DEPLOY="D-xxxxxxxx"; npx hardhat run scripts/deploy-factory.js --network qieMainnet
# 3. verify the source (no transaction): the deploy script prints both exact commands
npx hardhat verify --network qieMainnet <factory> <token> <treasury> <fee> <minRound> <minGrace> <minContribution> <minCover>
npx hardhat verify --network qieMainnet <deployer>
```

The script refuses the 7 exposed addresses as deployer or treasury.

## Cost estimate

The bytecode is identical to the demo factory's, so gas is essentially the same. Only the constructor arguments differ, and calldata costs a few hundred gas more or less.

| | Gas | QIE at 1.125 gwei |
| --- | --- | --- |
| Demo deployment, receipt | 5,572,279 | 0.006269 |
| Production deployment, estimate | about 5.57 million | about 0.0063 |
| Fund the fresh deployer with | — | **0.02 QIE** (covers a 50% price rise and the margin the script adds) |

Explorer verification costs nothing on chain.

## Migration implications

- **Circles do not move.** The seven demo circles are finished and empty, and stay on the demo factory. Nothing needs migrating.
- **History does not carry over.** Each factory keeps its own track record. A new factory starts empty, which is right here: the demo addresses' keys are exposed.
- **The app trusts exactly one factory per build.** A production build pinned to the new factory will warn that demo circles are "not created by PotLoop's official factory". Keep a separate demo build (`app/.env` with the demo factory) for the hackathon, or accept that old demo links show the warning.
- **Invite links** contain only the circle address. Links from demo circles keep opening the demo build.
- **App configuration** for the pilot build: `VITE_FACTORY_ADDRESS` = new factory; `VITE_FROM_BLOCK` = its deployment block; `VITE_CHAIN_ID=1990`; `VITE_RPC_URL` = the most reliable QIE RPC at the time (rpc1 was slow on 23 Nov 2026; rpc3 was fast); never set `VITE_ALLOW_URL_CONFIG`.
- **Contribution ceiling.** The contract allows up to 10⁹ QUSDC per round, and a factory cannot set a lower maximum. A pilot ceiling (for example 50 QUSDC per round) must be agreed with members and shown in the app. Not enforced on chain.

## Conditions before inviting real savings groups

1. An independent smart-contract review of this exact source.
2. The new factory deployed with the settings above, source verified on the explorer, and its bytecode matched (`scripts/reconcile-mainnet.js` with `FACTORY=`).
3. The manual QIE Wallet acceptance (`POTLOOP_UAT_PLAN.md`) passed on a real phone and desktop.
4. Members told, in the app and in writing, of the QUSDC administrator risk (`MAINNET_DEPLOYMENT_RECONCILIATION.md`), and of the per-round ceiling.
5. An incident plan: circles cannot be paused, so the plan is to communicate quickly and to stop creating new circles.
