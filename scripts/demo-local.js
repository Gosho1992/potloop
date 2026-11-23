// Local demo: a circle where seat 1 takes the pot and then stops paying.
//   Terminal 1:  npx hardhat node
//   Terminal 2:  npx hardhat run scripts/demo-local.js --network localhost
// Then open the printed URL with the app running (cd app && npm run dev).
const { ethers, network } = require("hardhat");

const U = (x) => ethers.parseUnits(String(x), 6);

async function main() {
  const signers = await ethers.getSigners();
  const members = signers.slice(1, 6);
  const names = ["Sipho", "Thandi", "Ayesha", "Bilal", "Naledi"];

  const token = await ethers.deployContract("MockUSD");
  for (const m of members) await token.mint(m.address, U(100));
  const tokenAddr = await token.getAddress();
  const fromBlock = await ethers.provider.getBlockNumber();
  // demo factory: 1-minute minimum rounds (a production factory uses 1 day)
  const factory = await ethers.deployContract("CircleFactory", [tokenAddr, signers[0].address, 50, 60, 30, U(0.01), 0]);
  const factoryAddr = await factory.getAddress();

  const tx = await factory.createCircle("Sipho's committee", members.map((m) => m.address), U(1), 5000, 180, 60, 600, true);
  const rc = await tx.wait();
  const addr = rc.logs.map((l) => { try { return factory.interface.parseLog(l); } catch { return null; } }).find((e) => e && e.name === "CircleCreated").args.circle;
  const circle = await ethers.getContractAt("SavingsCircle", addr);

  // a second circle, still open for joining, to show the invite screen
  await factory.createCircle("Weekend stokvel", [signers[6].address, members[1].address, members[3].address], U(2), 3000, 180, 60, 3600, false);

  for (let i = 0; i < 5; i++) {
    const col = await circle.upfrontCollateral(i);
    if (col > 0n) await token.connect(members[i]).approve(addr, col);
    await circle.connect(members[i]).accept();
  }
  const pay = async (i) => {
    await token.connect(members[i]).approve(addr, U(1));
    await circle.connect(members[i]).contribute();
  };

  // round 1: everyone pays, Sipho (seat 1) receives the pot
  for (let i = 0; i < 5; i++) await pay(i);
  await circle.settle();

  // round 2: Sipho stops paying; his collateral covers his share, Thandi still gets the full pot
  for (const i of [1, 2, 3, 4]) await pay(i);
  const due = Number(await circle.deadline()) + 60 + 1;
  const now = (await ethers.provider.getBlock("latest")).timestamp;
  await network.provider.send("evm_increaseTime", [Math.max(0, due - now)]);
  await circle.settle();

  // round 3 in progress: Thandi and Bilal have paid, and Sipho pays again (still behind until he catches up)
  await pay(1);
  await pay(3);
  await pay(0);

  const labels = [...members, signers[6]].map((m, i) => `${m.address}:${[...names, "Farah"][i]}`).join(",");
  console.log(`Factory: ${factoryAddr}`);
  console.log(`Circle: ${addr}`);
  console.log(`Open: http://localhost:5173/?factory=${factoryAddr}&rpc=http://127.0.0.1:8545&chain=31337&explorer=&from=${fromBlock}&labels=${labels}#/c/${addr}`);
  console.log(`All circles: http://localhost:5173/?factory=${factoryAddr}&rpc=http://127.0.0.1:8545&chain=31337&explorer=&from=${fromBlock}&labels=${labels}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
