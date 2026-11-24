// Local deployment for the UI acceptance suite (app/e2e). Runs only on a local Hardhat node.
//   npx hardhat run scripts/e2e-deploy.js --network localhost
// Deploys a test token and a CircleFactory with the same rules as the QIE mainnet demo factory
// (0.5% fee, 60 s minimum round, 30 s minimum grace, 0.01 minimum, 0% minimum cover), funds six
// member accounts, and writes app/e2e/deployment.json.
const fs = require("fs");
const path = require("path");
const { ethers, network } = require("hardhat");

async function main() {
  if (network.name !== "localhost") throw new Error("Local Hardhat node only (--network localhost).");
  const s = await ethers.getSigners();
  const token = await ethers.deployContract("MockUSD");
  const treasury = s[9];
  const factory = await ethers.deployContract("CircleFactory", [await token.getAddress(), treasury.address, 50, 60, 30, 10000, 0]);
  const members = s.slice(1, 7);
  for (const m of members) await (await token.mint(m.address, ethers.parseUnits("1000", 6))).wait();
  // an earlier factory, as on mainnet (the testing factory): its circles must still open, marked
  // as test circles, while new circles go to the current factory
  const earlier = await ethers.deployContract("CircleFactory", [await token.getAddress(), treasury.address, 50, 60, 30, 10000, 0]);
  const ec = await earlier.connect(members[0]).createCircle.staticCall("Earlier test circle", [members[0].address, members[1].address], 1_000000, 10000, 3600, 600, 3600, true);
  await (await earlier.connect(members[0]).createCircle("Earlier test circle", [members[0].address, members[1].address], 1_000000, 10000, 3600, 600, 3600, true)).wait();
  const out = {
    chainId: Number((await ethers.provider.getNetwork()).chainId),
    token: await token.getAddress(),
    factory: await factory.getAddress(),
    fromBlock: await ethers.provider.getBlockNumber(),
    treasury: treasury.address,
    earlierFactory: await earlier.getAddress(),
    earlierCircle: ec,
    members: members.map((m) => m.address),
  };
  fs.writeFileSync(path.join(__dirname, "..", "app", "e2e", "deployment.json"), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out));
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
