// Creates one circle through the CircleFactory.
// Usage (PowerShell):
//   $env:DEPLOYER_PRIVATE_KEY="0x..."            # organizer wallet (needs a little QIE for gas)
//   $env:FACTORY="0x..."                          # from deploy-factory.js
//   $env:NAME="Office committee"
//   $env:MEMBERS="0xA,0xB,0xC,0xD,0xE"            # payout order: first address is paid first
//   $env:CONTRIBUTION="0.02"                      # QUSDC per member per round
//   $env:COVERAGE_BPS="5000"                      # 0, 2000, 3000, 4000, 5000 or 10000
//   $env:ROUND_SECONDS="120"; $env:GRACE_SECONDS="30"; $env:JOIN_SECONDS="900"
//   npx hardhat run scripts/deploy.js --network qieMainnet
const { ethers } = require("hardhat");

async function main() {
  const factoryAddr = process.env.FACTORY;
  if (!factoryAddr) throw new Error("Set FACTORY to the CircleFactory address");
  const members = (process.env.MEMBERS || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (members.length < 2) throw new Error("Set MEMBERS to a comma-separated list of addresses in payout order");

  const factory = await ethers.getContractAt("CircleFactory", factoryAddr);
  const tokenAddr = await factory.token();
  const token = await ethers.getContractAt(["function decimals() view returns (uint8)", "function symbol() view returns (string)"], tokenAddr);
  const decimals = await token.decimals();
  const symbol = await token.symbol();
  const contribution = ethers.parseUnits(process.env.CONTRIBUTION || "0.02", decimals);
  const coverage = Number(process.env.COVERAGE_BPS || 5000);
  const round = Number(process.env.ROUND_SECONDS || 120);
  const grace = Number(process.env.GRACE_SECONDS || 30);
  const join = Number(process.env.JOIN_SECONDS || 900);
  const name = process.env.NAME || "PotLoop circle";

  const tx = await factory.createCircle(name, members, contribution, coverage, round, grace, join, process.env.COLLATERAL_FROM_POT !== "0");
  const rc = await tx.wait();
  const ev = rc.logs.map((l) => { try { return factory.interface.parseLog(l); } catch { return null; } }).find((e) => e && e.name === "CircleCreated");
  const addr = ev.args.circle;
  const circle = await ethers.getContractAt("SavingsCircle", addr);
  console.log(`Circle "${name}" created at ${addr} (tx ${tx.hash})`);
  for (let i = 0; i < members.length; i++) {
    console.log(`  seat ${i + 1}: ${members[i]} locks ${ethers.formatUnits(await circle.upfrontCollateral(i), decimals)} ${symbol} to join`);
  }
  console.log(`\nInvite link (after hosting the app): <your-app-url>/#/c/${addr}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
