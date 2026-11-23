# QIE mainnet deployment reconciliation

Read-only, from QIE mainnet on 23 Nov 2026 (latest block 12,112,635, 10:44 UTC). Nothing was sent or signed.
Raw data: `mainnet-runs/reconciliation/onchain.json` (from `scripts/reconcile-mainnet.js`, which refuses to run if a key is loaded) and the explorer responses next to it.
RPC: `rpc1mainnet.qie.digital` took 15 s or more per call that day, and `rpc2` the same. `rpc3mainnet.qie.digital` answered in about 1 s and was used (`QIE_RPC` override).

## Network and factory

| Item | Value | How checked |
| --- | --- | --- |
| Chain ID | **1990** | `eth_chainId` |
| CircleFactory | `0xD099c7361157Ec20a9Ac145aF4B66Af553AeDae4` | |
| Deployment transaction | [`0xd2e9eac9d726da91e5c5e4659aa36f1fab63c87e32db76c7e6319f456958f147`](https://mainnet.qie.digital/tx/0xd2e9eac9d726da91e5c5e4659aa36f1fab63c87e32db76c7e6319f456958f147) | **recovered**: the only transaction in block 12,109,975, and its receipt's `contractAddress` is the factory |
| Receipt | status 1, block 12,109,975 (08:03:25 UTC), from `0x918Da840…db76` (nonce 3), gas used 5,572,279 at 1.125 gwei, fee **0.006268813875 QIE** | receipt |
| CircleDeployer | `0xb24EcA9a5cbdab9e05963d22461f1d704ac41B00`, created by the factory's constructor in the same transaction; its `factory()` returns the factory | `factory.deployer()`, `deployer.factory()` |
| Token | `0x3F43DA82eC9A4f5285F10FaF1F26EcA7319E5DA5`, name and symbol QUSDC, **6 decimals**, total supply 8,929.088928 | token calls |
| Treasury | `0x918Da8404d39195dEbB2c039F376ce7ab922db76`: the test funder and deployer, whose key is exposed (`SECURITY_INCIDENT_AND_KEY_ROTATION.md`) | `rules()` |
| Fee | 50 bps (0.5% of pot money paid out) | `rules()` |
| Minimum round / grace | 60 s / 30 s | `rules()` |
| Minimum contribution | 10,000 base units = 0.01 QUSDC | `rules()` |
| Minimum cover | 0 bps (any of 0, 20, 30, 40, 50, 100%) | `rules()` |
| Factory version | 92 | `rules()` |
| Circles registered | 7 | `circleCount()` |

These are the demo settings (`MODE=demo`) the owner approved with code `D-…` before deployment. They are immutable.

## Bytecode against the exact source build

Comparison: the on-chain runtime code against this project's compiled `deployedBytecode` (solc 0.8.39, optimizer 200 runs, EVM paris), byte for byte, with only the immutable-value slots masked (token, treasury, fee, minimums, deployer and factory addresses, which are filled in at deployment). The code is `codeMatches` in `scripts/mainnet/harness.js`.

| Contract | Runtime size | Result |
| --- | --- | --- |
| CircleFactory | 6,492 bytes | **match** |
| CircleDeployer | 18,990 bytes | **match** |
| SavingsCircle ×7 | 15,905 bytes each | **match** (all seven) |

The contract sources are byte-identical to v9.2.1 and v9.2.2 (no contract changes since).

## Explorer source verification

**Update, 23 Nov 2026 (after this report was first written): the factory is now verified.** [Code tab](https://mainnet.qie.digital/address/0xD099c7361157Ec20a9Ac145aF4B66Af553AeDae4#code): `is_verified` and `is_fully_verified` true, compiler v0.8.39, optimizer 200 runs, EVM paris. The verified source bundle includes `contracts/SavingsCircle.sol` and `contracts/CircleDeployer.sol`, so all three contracts can be read there.

The deployer and the 7 circles **cannot be verified on this explorer**. They were created by contracts (the factory and the deployer), and QIE's explorer does not index internal transactions: it lists 0 internal transactions for the factory and shows the deployer and the circles as plain addresses ("EOA"). Verifying the deployer returned "The address is not a smart contract". Their bytecode is matched against this source by `scripts/reconcile-mainnet.js` instead (table above).

The rest of this section records the state before verification:

| Address | Explorer API (`/api/v2/smart-contracts/<address>`) |
| --- | --- |
| Factory | HTTP 200, `is_verified` not set: bytecode known, **no verified source** |
| CircleDeployer | HTTP 404: no smart-contract record |
| The 7 circles | HTTP 404 each |
| QUSDC (for comparison) | HTTP 200, `is_verified: true`, name QUSDC, compiler v0.8.20 |

Done for the factory with the owner's approval: `npx hardhat verify --network qieMainnet --contract contracts/CircleFactory.sol:CircleFactory 0xD099c7361157Ec20a9Ac145aF4B66Af553AeDae4 0x3F43DA82eC9A4f5285F10FaF1F26EcA7319E5DA5 0x918Da8404d39195dEbB2c039F376ce7ab922db76 50 60 30 10000 0` (no key, no transaction).

## Every circle: registration and final state

All seven are registered by the factory (`isCircle` true), use the factory's token, treasury (fee 50 bps) and registry, and have 60 s rounds and 30 s grace.

| # | Circle | Name on chain | Members | Per round | Cover | Collateral | Phase | All rounds settled | QUSDC held | Ledgers (accounted) | Owed to anyone | Results recorded |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `0x4a26e0c8…F291` | PotLoop test S1 | 2 | 0.02 | 100% | from pot | Completed | yes | 0 | 0 | 0 | no |
| 2 | `0x84f78c7a…E421` | PotLoop test S2 | 4 | 0.02 | 50% | from pot | Completed | yes | 0 | 0 | 0 | no |
| 3 | `0x27A34e93…4Ec0` | PotLoop test S3-upfront | 3 | 0.02 | 100% | up front | Completed | yes | 0 | 0 | 0 | no |
| 4 | `0x474E6c16…E110` | PotLoop test S3-from-pot | 3 | 0.02 | 100% | from pot | Completed | yes | 0 | 0 | 0 | no |
| 5 | `0xe7461b15…c804` | PotLoop test S4 | 5 | 0.02 | 20% | from pot | Completed | yes | 0 | 0 | 0 | no |
| 6 | `0x905Fc41c…6526` | PotLoop test S5 | 6 | 0.02 | 100% | from pot | Completed | yes | 0 | 0 | 0 | no |
| 7 | `0x6330787f…B054` | PotLoop test S5-rerun | 6 | 0.02 | 100% | from pot | Completed | yes | 0 | 0 | 0 | no |

Member outcomes on chain (`outcomeOf`): circle 5 seat 1 (Sipho) **caught up** (missed 2 rounds); circle 6 seat 6 (Farah) **left early** (missed 1 round). Every other seat in every circle **completed**. All collateral, entitlements, recorded losses and the reserve are 0. Creation transactions are in `MAINNET_CIRCLES.csv`.

No circle has had its results recorded in the factory's history (`recorded` false; every member's history is all zeros). That step was never part of the live runs; see `LOCAL_FORK_EDGE_CASE_REPORT.md` for the local-copy test of recording all seven, and the one-transaction proposal.

## Token administrator powers (QUSDC)

From QUSDC's explorer-verified source and its role events (read-only):

- QUSDC is a plain OpenZeppelin `ERC20` + `AccessControl` contract, not a proxy (no EIP-1967 implementation or admin slot). There is no pause, freeze or blacklist function.
- `mint(to, amount)` and **`burn(from, amount)` need `VAULT_ROLE`. `burn` takes tokens from any address without an allowance**, including a PotLoop circle.
- `VAULT_ROLE` is held by `0xdc20f1fe…3d45` (QUSDVault, verified on the explorer). Its only burn path burns the caller's own QUSDC when redeeming for WUSDC, so the vault cannot burn a circle's balance.
- `DEFAULT_ADMIN_ROLE` is held by `0xe1acec63…8d28`, an ordinary wallet (no code), and was never revoked. **That key can grant `VAULT_ROLE` to any address, which could then burn any holder's QUSDC, a circle included, or mint unbacked QUSDC.**
- A local test (`AdminBurnUSD` model in `test/ReleaseAcceptance.test.js`) shows the effect: after such a burn, a circle's ledgers exceed its balance and the last members to withdraw cannot be paid. PotLoop cannot prevent this; it is the issuer's risk. It is a release blocker only for production and is listed in `FINAL_RELEASE_READINESS.md`.

## Limitations of this reconciliation

- QIE publishes no hardfork history we could verify. The local copies used `london: 0`, which is enough to run our paris-target bytecode, but this does not establish full EVM equivalence for every opcode.
- The explorer's verification status is what its API reported on 23 Nov 2026. A web page could differ.
- The owner's own funding steps before the deployment (8 QIE sent to the test wallet; the WQIE→QUSDC swap) are outside the test runs and were not reconciled here, beyond the QUSDC the test wallet received (0.980746).
