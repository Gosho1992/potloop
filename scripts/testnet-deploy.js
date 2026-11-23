// QIE TESTNET ONLY. Deploys PotLoop v9.2.1 for an end-to-end test with valueless tokens.
//
//   1. Put a TESTNET-ONLY private key in DEPLOYER_PRIVATE_KEY (a fresh wallet, never your main one)
//      and get testnet QIE for gas from QIE's faucet.
//   2. npx hardhat run scripts/testnet-deploy.js --network qieTestnet
//      Optional: TOKEN=<address of an existing testnet stablecoin>. Without it, the project's mock token
//      (symbol mQUSDC, 6 decimals, anyone can mint, no value) is deployed and 1,000 are minted to you.
//      Optional: MIN_COVER_BPS (default 0), FEE_BPS (default 0), TREASURY (default: you).
//   3. Run the full story against it:
//      $env:FACTORY="<printed address>"; node scripts/make-wallets.js 4
//      npx hardhat run scripts/demo-mainnet.js --network qieTestnet
//      (create, accept, contribute, settle, a default, collateral paying, short payouts, a catch-up,
//      entitlement repayment, finalize and withdrawals, all as real testnet transactions)
//
// Refuses to run on any chain other than 1983, and never on mainnet.
const { ethers, network } = require("hardhat");
const fs = require("fs");

const QIE_TESTNET = 1983n;

async function main() {
  const { chainId } = await ethers.provider.getNetwork();
  if (chainId !== QIE_TESTNET) throw new Error(`RPC says chain ${chainId}; this script only runs on QIE testnet (${QIE_TESTNET}). Stopping.`);
  const [me] = await ethers.getSigners();
  if (!me) throw new Error("Set DEPLOYER_PRIVATE_KEY to a testnet-only key.");
  const gas = await ethers.provider.getBalance(me.address);
  console.log(`QIE testnet (chain ${chainId}) via ${network.config.url}`);
  console.log(`Deployer ${me.address}, ${ethers.formatEther(gas)} testnet QIE`);
  if (gas === 0n) throw new Error("No testnet QIE for gas. Get some from QIE's testnet faucet first.");

  let token = process.env.TOKEN;
  if (token) {
    if ((await ethers.provider.getCode(token)) === "0x") throw new Error(`TOKEN ${token} has no contract on testnet.`);
  } else {
    const t = await ethers.deployContract("MockUSD");
    await t.waitForDeployment();
    token = await t.getAddress();
    await (await t.mint(me.address, 1_000_000_000n)).wait();
    console.log(`Test token (valueless, anyone can mint) deployed at ${token}; minted 1,000 to you`);
  }
  const erc = await ethers.getContractAt("MockUSD", token);
  const decimals = Number(await erc.decimals());
  const symbol = await erc.symbol();
  if (decimals !== 6) console.log(`Note: ${symbol} has ${decimals} decimals. PotLoop's maximum contribution is 1e15 base units, which only suits low-decimal tokens.`);

  const minCover = Number(process.env.MIN_COVER_BPS ?? 0);
  const feeBps = Number(process.env.FEE_BPS ?? 0);
  const treasury = process.env.TREASURY || me.address;
  const minContribution = 10n ** BigInt(decimals) / 100n; // 0.01 token
  const factory = await ethers.deployContract("CircleFactory", [token, treasury, feeBps, 60, 30, minContribution, minCover]);
  await factory.waitForDeployment();
  const addr = await factory.getAddress();
  const block = await ethers.provider.getBlockNumber();
  const deployerAddr = await factory.deployer();
  const r = await factory.rules();
  const d = await ethers.getContractAt("CircleDeployer", deployerAddr);
  if ((await d.factory()) !== addr) throw new Error("CircleDeployer does not point back to the factory. Stopping.");

  console.log(`\nCircleFactory   ${addr} (block ${block})`);
  console.log(`CircleDeployer  ${deployerAddr} (created by the factory; only the factory can use it)`);
  console.log(`Rules: token ${r.token_}, fee ${r.feeBps_} bps, treasury ${r.treasury_}, min round ${r.minRoundLength_}s, min grace ${r.minGrace_}s, min contribution ${ethers.formatUnits(r.minContribution_, decimals)} ${symbol}, min cover ${r.minCoverageBps_} bps, version ${r.version_}`);

  const out = { network: "qieTestnet", chainId: Number(chainId), rpc: network.config.url, deployer: me.address, token, tokenSymbol: symbol, tokenDecimals: decimals, factory: addr, circleDeployer: deployerAddr, fromBlock: block, deployedAt: new Date().toISOString() };
  fs.writeFileSync("testnet-deployment.json", JSON.stringify(out, null, 2) + "\n");
  console.log(`\nSaved testnet-deployment.json (addresses only, no keys).`);
  console.log(`\nApp against testnet (local dev, URL overrides are dev-only):`);
  console.log(`  cd app; npm run dev   then open  http://localhost:5173/?factory=${addr}&rpc=${encodeURIComponent(network.config.url)}&chain=1983&from=${block}`);
  console.log(`\nNext: the full story`);
  console.log(`  $env:FACTORY="${addr}"; node scripts/make-wallets.js 4; npx hardhat run scripts/demo-mainnet.js --network qieTestnet`);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exitCode = 1;
});
