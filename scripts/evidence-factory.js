// Local chain only: deploys a mock 6-decimal token and a demo-mode factory (60 s rounds, no
// minimum cover) for scripts/run-evidence.sh. Prints the factory address on the last line.
const { ethers, network } = require("hardhat");

async function main() {
  if (network.name !== "localhost" && network.name !== "hardhat") throw new Error("local chains only");
  const [me] = await ethers.getSigners();
  const token = await (await ethers.getContractFactory("MockUSD")).deploy();
  await token.waitForDeployment();
  await (await token.mint(me.address, 5_000_000n)).wait(); // 5 tokens for the demo wallets
  const factory = await (await ethers.getContractFactory("CircleFactory")).deploy(await token.getAddress(), me.address, 50, 60, 30, 10000, 0);
  await factory.waitForDeployment();
  console.log(await factory.getAddress());
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
