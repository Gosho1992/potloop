# Security incident: test wallet keys in a shared archive, and key rotation

**Status (23 Nov 2026): contained for value at risk; one permanent consequence (the demo factory's treasury) remains and cannot be rotated.**
No private key, seed phrase or hash of a key appears in this document or in the release package.

## What happened

| | |
| --- | --- |
| Exposed files | `funder-wallet.json` (1 key), `demo-wallets.json` (6 keys) |
| Where they were | `Downloads\QIE\potloop-v9.3\` on the owner's computer (git-ignored, but the folder is not a git repository); inside `Downloads\QIE\potloop-v9.3.zip` (158 MB, made by hand after the mainnet run, also contains `node_modules` and `upd-s6s7.tgz`); in the private working copy used to run the tests |
| How they got out | `potloop-v9.3.zip` was shared with an outside reviewer. `.gitignore` excluded the files from git, but no packaging step used `.gitignore`, so a plain ZIP of the folder included them |
| Not in | `potloop-v9.3-mainnet-results.zip`, every older archive (v9.1 to v9.2.2, `savings-circle.zip`), any `.md`, `.csv`, log or report. Confirmed by `scripts/release-scan.js` over the folder, the 158 MB ZIP's contents and every other archive |
| Never exposed | The owner's main wallet `0x7145be20923340bbea3469c3804b384b93356910` (its key was never handled) and the recovery phrase |
| Other secrets | None found: no `.env` files (only `app/.env.example`), no API tokens, no PEM or key-store files |

The scanner confirms each key is a key: for every 32-byte value in the files it derives the address and matches it to an address used in the project. It printed the 7 addresses below and nothing else.

## Which addresses are affected

| Role | Address | Balance now (read 23 Nov 2026) |
| --- | --- | --- |
| Test funder, **factory deployer and factory treasury** | `0x918Da8404d39195dEbB2c039F376ce7ab922db76` | 0.00004725 QIE, 0 QUSDC |
| Member Sipho | `0x15e58fFF4eA6a954D8E02F20C07544eb6EAC036A` | 0.000023625 QIE, 0 QUSDC |
| Member Thandi | `0xc83847e16AAb28Bc39093D5fd11fC39aaCAA2EF3` | 0.000023625 QIE, 0 QUSDC |
| Member Ayesha | `0xA6AE5bFd19E1EABDD2e2bF1B4180dBB71ee2cBA5` | 0.000023625 QIE, 0 QUSDC |
| Member Bilal | `0x23d676B5146CAe065bB699d60Cff387558870D3d` | 0.000023625 QIE, 0 QUSDC |
| Member Naledi | `0xDB43A27c047643758259F996A3827afEbdb1F911` | 0.000023625 QIE, 0 QUSDC |
| Member Farah | `0x16ada809013a7f41D33Ab5099909a2773bbf6fAb` | 0.000023625 QIE, 0 QUSDC |

Value at risk today: about 0.00019 QIE (gas dust). Every test circle holds 0 QUSDC and owes nothing to anyone: `MAINNET_CIRCLES.csv`.

## What an attacker can do with these keys

| With the key of | They can | Consequence |
| --- | --- | --- |
| Any member wallet | Spend its dust; withdraw from any circle where it is owed something (nothing today); act as that member in any future circle that lists it | Low today. **Never put these addresses in a new circle** |
| Any member wallet | Inflate or damage the history of that address by joining new circles on the demo factory | History is per address and the demo factory allows tiny 0.01 QUSDC circles, so it is already a weak signal; treat these addresses' history as meaningless |
| The funder / treasury | Withdraw the 0.5% fee from **every circle anyone ever creates on the demo factory** `0xD099c736…Dae4`: the factory passes this treasury address, unchangeably, to every new circle | **Permanent.** Members' money is not at risk (the treasury can only take its own fee credit), but no honest operator can ever collect fees from this factory |

The treasury cannot be rotated. `CircleFactory.treasury` is `immutable` and each `SavingsCircle` copies it in its constructor; there is no owner and no setter. Rotating to a new key changes nothing for this factory.

## Decision on the deployed factory

- **Keep it as the hackathon demonstration factory only.** It is correctly deployed, its bytecode matches this source, it has been tested on mainnet, and the exposed treasury costs members nothing.
- **Do not offer it to real savings groups.** Its demo rules (60-second rounds, 0% minimum cover, 0.01 QUSDC minimum) are also unsuitable: see `PRODUCTION_FACTORY_RECOMMENDATION.md`.
- **Real users need a new factory** with a treasury nobody involved in the incident controls. Safe is not deployed on QIE mainnet: none of its standard contract addresses has code there (checked 23 Nov 2026). The simplest safe choice for a pilot is **fee 0**, which makes the treasury address zero: no key can collect anything. For a production fee, first deploy a multisig on QIE.
- `scripts/deploy-factory.js` now refuses the 7 exposed addresses as deployer or treasury. On mainnet production with a fee, it requires an explicitly chosen treasury that is not the deploying wallet and is a contract, unless overridden on purpose.

## Rotation procedure (the owner, through their own wallet)

1. **Do not import** `funder-wallet.json` or `demo-wallets.json` into any wallet. There is nothing worth moving (dust only). If you want the dust back, it is not worth the risk of handling the keys.
2. **Delete** both files and `upd-s6s7.tgz` from `Downloads\QIE\potloop-v9.3\`, and delete `Downloads\QIE\potloop-v9.3.zip`. Empty the Recycle Bin.
3. **Ask the reviewer** who received `potloop-v9.3.zip` to delete it and any extracted copy.
4. **Retire the 7 addresses.** Never fund them or list them as members again. New test wallets must be made fresh on the machine that uses them (`node scripts/make-wallets.js <n>`), used once, and never zipped.
5. For any future factory, use a **fresh deployer wallet** with only the gas it needs, and a treasury chosen as above.
6. Before sharing anything, build it with `node scripts/package-release.js`. It copies an allowlist of folders, runs the secret scan on exactly what will ship, and stops without writing a ZIP if anything is found. Never ZIP the project folder by hand.

## Controls added

| Control | Where | Tested |
| --- | --- | --- |
| Pre-release secret scan: wallet files, `.env` files, key stores and PEM keys, nested archives, key-shaped JSON fields, `PRIVATE_KEY=` with 64 hex, API token prefixes, and any 32-byte value whose derived address is used in the package | `scripts/release-scan.js` | Fails on a planted random key; flags all 7 real keys in the owner's folder and inside the 158 MB ZIP; passes on the release package |
| Packaging fails closed | `scripts/package-release.js` | Runs the scan on the staged copy; no archive is written if it fails |
| Git ignore patterns | `.gitignore` adds `*wallet*.json`, `.env.*` (except examples), archives, `release/` | — |
| Deploy guard | `scripts/deploy-factory.js` | Refuses exposed addresses; production treasury rules above |
| Evidence scripts are read-only | `scripts/reconcile-mainnet.js`, `scripts/reconcile-token-flows.js` refuse to run with `DEPLOYER_PRIVATE_KEY` set | — |

Scripts that still read a key file by design, for local or test use only: `scripts/make-wallets.js` and `scripts/make-funder.js` (create them), `scripts/mainnet/harness.js` (`memberWallets`), `scripts/demo-mainnet.js`, `scripts/return-funds.js`, `scripts/mainnet-step.sh`. The files they create are now blocked by `.gitignore`, the scan and the packager.
