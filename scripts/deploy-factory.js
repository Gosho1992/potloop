// Deploys the V9 CircleFactory (once). Every new PotLoop circle then includes the
// SavingsCircle V9 `seatTerms` member-commitment quote.
// Usage (PowerShell, in the project folder):
//   $env:DEPLOYER_PRIVATE_KEY="0x..."   # your own wallet key, typed only into your own terminal
//   $env:MODE="demo"                    # "demo": 1-minute minimum rounds for a live demo
//                                       # "production" (default): 1-day rounds, 12-hour grace
//   $env:MIN_COVER_BPS="10000"          # optional: lowest cover circles may use (default 0 in demo
//                                       # mode, 10000 = full cover in production mode)
//   $env:FEE_BPS="50"                   # optional: service fee on pot money, 50 = 0.5% (max 100)
//   $env:TREASURY="0x..."               # who receives the fee; use a Safe multisig for real use
//   npx hardhat run scripts/deploy-factory.js --network qieMainnet
const { ethers, network } = require("hardhat");

const QUSDC_MAINNET = "0x3F43DA82eC9A4f5285F10FaF1F26EcA7319E5DA5";
const QIE_MAINNET = 1990n;

async function main() {
  const [deployer] = await ethers.getSigners();
  const { chainId } = await ethers.provider.getNetwork();
  let token = process.env.TOKEN || "";
  if (network.name === "qieMainnet") {
    if (chainId !== QIE_MAINNET) throw new Error(`RPC says chain ${chainId}, expected ${QIE_MAINNET}. Stopping.`);
    if (token && token.toLowerCase() !== QUSDC_MAINNET.toLowerCase()) throw new Error("On QIE mainnet the token must be the official QUSDC. Stopping.");
    token = QUSDC_MAINNET;
  }
  if (!token) throw new Error("Set TOKEN (QUSDC is used automatically on qieMainnet)");
  const erc = await ethers.getContractAt(["function decimals() view returns (uint8)", "function symbol() view returns (string)"], token);
  if ((await ethers.provider.getCode(token)) === "0x") throw new Error("No contract at the token address. Stopping.");
  const decimals = await erc.decimals();
  if (network.name === "qieMainnet" && Number(decimals) !== 6) throw new Error(`QUSDC should have 6 decimals, got ${decimals}. Stopping.`);

  const mode = process.env.MODE || "production";
  const [defRound, defGrace, defMin] =
    mode === "demo" ? [60, 30, ethers.parseUnits("0.01", decimals)] : [86400, 43200, ethers.parseUnits("1", decimals)];
  // optional overrides (part of the approval code): MIN_ROUND_SECONDS, MIN_GRACE_SECONDS (e.g. 21600 keeps the app's
  // daily schedule, which uses 6 h grace), MIN_CONTRIBUTION (in tokens, e.g. "1")
  const minRound = Number(process.env.MIN_ROUND_SECONDS || defRound);
  const minGrace = Number(process.env.MIN_GRACE_SECONDS || defGrace);
  const minContribution = process.env.MIN_CONTRIBUTION ? ethers.parseUnits(process.env.MIN_CONTRIBUTION, decimals) : defMin;
  const feeBps = Number(process.env.FEE_BPS || 50);
  // production: full cover by default, so no member can profit from walking away after their turn
  const minCover = Number(process.env.MIN_COVER_BPS ?? (mode === "demo" ? 0 : 10000));
  // Keys of these test wallets were exposed in a shared archive on 23 Nov 2026
  // (SECURITY_INCIDENT_AND_KEY_ROTATION.md). None of them may deploy a factory or receive its fee.
  const EXPOSED = ["0x918Da8404d39195dEbB2c039F376ce7ab922db76", "0x15e58fFF4eA6a954D8E02F20C07544eb6EAC036A", "0xc83847e16AAb28Bc39093D5fd11fC39aaCAA2EF3", "0xA6AE5bFd19E1EABDD2e2bF1B4180dBB71ee2cBA5", "0x23d676B5146CAe065bB699d60Cff387558870D3d", "0xDB43A27c047643758259F996A3827afEbdb1F911", "0x16ada809013a7f41D33Ab5099909a2773bbf6fAb"].map((a) => a.toLowerCase());
  // With no fee there is no treasury at all (address zero): no key can ever collect anything.
  const treasury = feeBps === 0 ? process.env.TREASURY || ethers.ZeroAddress : process.env.TREASURY || deployer.address;
  if (EXPOSED.includes(deployer.address.toLowerCase())) throw new Error("This deployer key was exposed. Use a fresh wallet.");
  if (EXPOSED.includes(treasury.toLowerCase())) throw new Error("This treasury's key was exposed. Choose another treasury.");
  if (network.name === "qieMainnet" && mode !== "demo" && feeBps > 0) {
    // a production factory fixes its treasury forever: it must be chosen on purpose, and not be the deployer's hot wallet
    if (!process.env.TREASURY) throw new Error("Production with a fee: set TREASURY explicitly (a multisig if one is available on QIE), or set FEE_BPS=0.");
    if (treasury.toLowerCase() === deployer.address.toLowerCase()) throw new Error("Production: the treasury must not be the deploying wallet.");
    if ((await ethers.provider.getCode(treasury)) === "0x" && process.env.ALLOW_EOA_TREASURY !== "1")
      throw new Error("Production: the treasury is a plain wallet, not a contract (multisig). Set ALLOW_EOA_TREASURY=1 only if that is a deliberate, documented decision.");
  }
  if (!process.env.TREASURY && feeBps > 0) console.log("Note: the fee goes to your deployer wallet (demo only).");

  console.log(`Network ${network.name} (chain ${chainId}), deployer ${deployer.address}`);
  console.log(`Balance: ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} QIE`);
  console.log(`Mode ${mode}: minimum round ${minRound}s, grace ${minGrace}s, contribution ${ethers.formatUnits(minContribution, decimals)} ${await erc.symbol()}, minimum cover ${minCover / 100}%`);
  if (network.name === "qieMainnet") {
    // explicit approval for this exact deployment: printed by scripts/mainnet-preflight.js
    const { deployApprovalCode } = require("./mainnet/harness");
    const code = deployApprovalCode({ chain: chainId.toString(), deployer: deployer.address, token, treasury, feeBps, minRound, minGrace, minContribution: minContribution.toString(), minCover });
    if (process.env.APPROVE_DEPLOY !== code) {
      throw new Error(`Not approved. This exact deployment's approval code is ${code}. Review scripts/mainnet-preflight.js output, then set APPROVE_DEPLOY=${code}.`);
    }
  }
  const factory = await ethers.deployContract("CircleFactory", [token, treasury, feeBps, minRound, minGrace, minContribution, minCover]);
  await factory.waitForDeployment();
  const addr = await factory.getAddress();
  const block = await ethers.provider.getBlockNumber();
  console.log(`\nCircleFactory deployed at ${addr} (block ${block})`);
  const deployerAddr = await factory.deployer();
  const rules = await factory.rules();
  console.log(`CircleDeployer (created by the factory, only the factory can use it): ${deployerAddr}`);
  console.log(`Factory rules read back: fee ${rules.feeBps_} bps, min round ${rules.minRoundLength_}s, min grace ${rules.minGrace_}s, min contribution ${rules.minContribution_}, min cover ${rules.minCoverageBps_} bps, version ${rules.version_}`);
  console.log(`\nVerify on the explorer:`);
  console.log(`  npx hardhat verify --network ${network.name} ${addr} ${token} ${treasury} ${feeBps} ${minRound} ${minGrace} ${minContribution} ${minCover}`);
  console.log(`  npx hardhat verify --network ${network.name} ${deployerAddr}`);
  console.log(`\nPut these in app/.env:\n  VITE_FACTORY_ADDRESS=${addr}\n  VITE_FROM_BLOCK=${block}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
