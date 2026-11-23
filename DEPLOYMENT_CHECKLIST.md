# Deployment checklist

## Current status (23 Nov 2026)

- **A demo factory is deployed on QIE mainnet**: `0xD099c7361157Ec20a9Ac145aF4B66Af553AeDae4` (block 12,109,975). Its bytecode matches this source and seven test circles ran on it with real QUSDC ([`MAINNET_DEPLOYMENT_RECONCILIATION.md`](MAINNET_DEPLOYMENT_RECONCILIATION.md)). Its settings are demo settings (60 s rounds, 0% minimum cover, 0.01 QUSDC minimum) and its treasury key is exposed ([`SECURITY_INCIDENT_AND_KEY_ROTATION.md`](SECURITY_INCIDENT_AND_KEY_ROTATION.md)). **Use it for demonstrations only.**
- **Not approved for real user funds.** A new factory is needed for any pilot: configuration and blockers in [`PRODUCTION_FACTORY_RECOMMENDATION.md`](PRODUCTION_FACTORY_RECOMMENDATION.md) and [`FINAL_RELEASE_READINESS.md`](FINAL_RELEASE_READINESS.md).
- Not yet done: explorer source verification of the factory and deployer; an independent audit; manual QIE Wallet acceptance ([`POTLOOP_UAT_PLAN.md`](POTLOOP_UAT_PLAN.md)).

## Before any deployment

- Any production deployment is a **new factory** (the demo factory's settings and treasury are fixed) (corrected collateral rule, new join amount, `CircleDeployer`). Runtime sizes: SavingsCircle 15,905, CircleFactory 6,492, CircleDeployer 18,990 bytes (limit 24,576); factory init code 26,247 bytes (EIP-3860 limit 49,152). Check with `npx hardhat run scripts/bytecode-sizes.js`. Verify both the factory and its deployer on the explorer (the deploy script prints both commands).
- Follow [`PRODUCTION_FACTORY_RECOMMENDATION.md`](PRODUCTION_FACTORY_RECOMMENDATION.md). Build anything you share with `node scripts/package-release.js` (it refuses to package keys).
- Decide the factory's minimum cover (`MIN_COVER_BPS`): 10000 allows only full-cover circles; 0 also allows trust circles, with the app's risk acknowledgement.
- Reproduce the evidence with `bash scripts/run-release-evidence.sh` on the exact source to be deployed, and the UI suite with `node app/e2e/run-e2e.cjs`.

- Obtain an independent smart-contract review of the exact final source and deployed bytecode.
- Verify QIE chain ID 1990 and RPC against authoritative QIE information. A configured RPC's response alone does not establish endpoint authenticity.
- Verify official QUSDC address, deployed bytecode, decimals, transfer semantics, pause/freeze/blacklist controls and issuer risks from authoritative sources. Confirm the factory uses that exact address.
- Review factory constructor values: treasury, fee, minimum duration, grace and minimum contribution. Prefer a governed Safe treasury for any fee.
- Confirm app build-time factory, RPC, chain ID and explorer values. Keep `VITE_ALLOW_URL_CONFIG` disabled in production. Never publish private keys.
- Verify factory and circle source and constructor arguments on the explorer. Confirm the app accepts circles only when registered by the pinned factory and using its token.
- Test wallet `chainChanged` and `accountsChanged`, transaction prompts, invite URLs, invalid factories and unavailable RPC behavior on a test network.
- Run the full test suite, adversarial/invariant/fuzz/boundary tests, frontend production build, static analysis and an independent review; retain exact evidence.
- Exercise a demo with test funds and test wallets only. Document a pause/incident communication plan; immutable circles have no pause or admin recovery.

## Operational precautions

- Never deploy an experimental build with material funds or use real participants as testers.
- Do not run demo funding/refund scripts until their addresses, balances, network and private-key handling have been reviewed for the specific environment.
- Keep keeper credentials in a dedicated low-balance wallet. The keeper is optional and permissionless functions remain callable by participants.
- Monitor RPC availability, contract liabilities, stuck rounds, token freezes, and incomplete results recording.

## Release gate

Mainnet deployment requires explicit human approval after a concrete build has passed independent review and the exact token, factory parameters, treasury, app configuration and verification records are available for inspection. This checklist does not itself authorize deployment.
