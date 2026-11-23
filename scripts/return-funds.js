// Sends everything in the demo wallets (QUSDC and leftover QIE) back to your wallet.
//   $env:DEPLOYER_PRIVATE_KEY="0x..."; npx hardhat run scripts/return-funds.js --network qieMainnet
const fs = require("fs");
const path = require("path");
const { ethers } = require("hardhat");

const QUSDC_MAINNET = "0x3F43DA82eC9A4f5285F10FaF1F26EcA7319E5DA5";

async function main() {
  const [me] = await ethers.getSigners();
  const demo = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "demo-wallets.json"), "utf8"));
  const token = await ethers.getContractAt("@openzeppelin/contracts/token/ERC20/IERC20.sol:IERC20", process.env.TOKEN || QUSDC_MAINNET);
  for (const d of demo) {
    const w = new ethers.Wallet(d.privateKey, ethers.provider);
    const bal = await token.balanceOf(w.address);
    if (bal > 0n) await (await token.connect(w).transfer(me.address, bal)).wait();
    const qie = await ethers.provider.getBalance(w.address);
    const fee = await ethers.provider.getFeeData();
    const gasCost = 21000n * (fee.gasPrice || 0n) * 2n;
    if (qie > gasCost) await (await w.sendTransaction({ to: me.address, value: qie - gasCost, gasLimit: 21000n })).wait();
    console.log(`${d.name}: returned ${ethers.formatUnits(bal, 6)} QUSDC and ${ethers.formatEther(qie > gasCost ? qie - gasCost : 0n)} QIE`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
