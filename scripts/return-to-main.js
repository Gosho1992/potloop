// At the end: sends everything from the test wallet (QUSDC, WQIE and QIE, keeping only the gas for
// these transfers) back to your main wallet. Run 1 shows what would be sent; run 2 sends it.
//   $env:MAIN="0x7145be20923340bbea3469c3804b384b93356910"
//   npx hardhat run scripts/return-to-main.js --network qieMainnet
//   $env:CONFIRM="yes"; npx hardhat run scripts/return-to-main.js --network qieMainnet
const { ethers, network } = require("hardhat");

const TOKENS = { QUSDC: ["0x3F43DA82eC9A4f5285F10FaF1F26EcA7319E5DA5", 6], WQIE: ["0x0087904D95BEe9E5F24dc8852804b547981A9139", 18] };

async function main() {
  const { chainId } = await ethers.provider.getNetwork();
  if (network.name !== "qieMainnet" || chainId !== 1990n) throw new Error("Run with --network qieMainnet (chain 1990).");
  const [me] = await ethers.getSigners();
  const main = process.env.MAIN;
  if (!main || !ethers.isAddress(main)) throw new Error("Set MAIN to your main wallet address.");
  if (main.toLowerCase() === me.address.toLowerCase()) throw new Error("MAIN is the test wallet itself.");
  const go = process.env.CONFIRM === "yes";
  console.log(`From test wallet ${me.address} to ${main}${go ? "" : " (preview: nothing is sent)"}`);
  for (const [name, [addr, dec]] of Object.entries(TOKENS)) {
    const t = new ethers.Contract(addr, ["function balanceOf(address) view returns (uint256)", "function transfer(address,uint256) returns (bool)"], me);
    const b = await t.balanceOf(me.address);
    if (b === 0n) continue;
    console.log(`  ${ethers.formatUnits(b, dec)} ${name}`);
    if (go) console.log(`    sent: ${(await (await t.transfer(main, b)).wait()).hash}`);
  }
  const price = (await ethers.provider.getFeeData()).gasPrice;
  const keep = 21000n * price * 3n;
  const q = await ethers.provider.getBalance(me.address);
  if (q > keep) {
    console.log(`  ${ethers.formatEther(q - keep)} QIE`);
    if (go) console.log(`    sent: ${(await (await me.sendTransaction({ to: main, value: q - keep, gasLimit: 21000n })).wait()).hash}`);
  }
  if (!go) console.log(`If that's right: $env:CONFIRM="yes" and run the same command again.`);
}

main().catch((e) => {
  console.error(e.shortMessage || e.message || e);
  process.exitCode = 1;
});
