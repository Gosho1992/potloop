// Swaps QIE for QUSDC directly on the QIEDEX swap contract (the same contract the QIEDEX website
// uses), for when the website's Swap button fails. If the wallet holds plain QIE rather than WQIE,
// it first wraps the missing amount into WQIE (1:1, the WQIE contract's deposit()).
//
//   Run 1 (shows the quote, sends nothing):
//     npx hardhat run scripts/swap-wqie-to-qusdc.js --network qieMainnet
//   Run 2 (after you have checked the quote):
//     $env:CONFIRM="yes"; npx hardhat run scripts/swap-wqie-to-qusdc.js --network qieMainnet
//
// Optional: $env:AMOUNT_WQIE="13.9" (default), $env:MAX_SLIPPAGE_PCT="2" (default).
// Your key stays in this PowerShell window (DEPLOYER_PRIVATE_KEY); it is never printed or saved.
const { ethers, network } = require("hardhat");

const ROUTER = "0x08cd2e72e156d8563b4351eb4065c262a9f553ef"; // QIEDEX router (factory 0x8E23…398C)
const WQIE = "0x0087904D95BEe9E5F24dc8852804b547981A9139";
const QUSDC = "0x3F43DA82eC9A4f5285F10FaF1F26EcA7319E5DA5";

async function main() {
  const { chainId } = await ethers.provider.getNetwork();
  if (network.name !== "qieMainnet" || chainId !== 1990n) throw new Error("Run with --network qieMainnet (chain 1990).");
  const [me] = await ethers.getSigners();
  if (!me) throw new Error("Set DEPLOYER_PRIVATE_KEY in this window first.");
  const router = new ethers.Contract(ROUTER, [
    "function WETH() view returns (address)",
    "function getAmountsOut(uint256,address[]) view returns (uint256[])",
    "function swapExactTokensForTokens(uint256,uint256,address[],address,uint256) returns (uint256[])",
  ], me);
  if ((await router.WETH()).toLowerCase() !== WQIE.toLowerCase()) throw new Error("Router check failed: it does not use WQIE. Stopping.");
  const erc = ["function balanceOf(address) view returns (uint256)", "function allowance(address,address) view returns (uint256)", "function approve(address,uint256) returns (bool)"];
  const wqie = new ethers.Contract(WQIE, [...erc, "function deposit() payable"], me);
  const qusdc = new ethers.Contract(QUSDC, erc, me);

  const amount = ethers.parseEther(process.env.AMOUNT_WQIE || "13.9");
  const slip = BigInt(Math.round(Number(process.env.MAX_SLIPPAGE_PCT || "2") * 100));
  const bal = await wqie.balanceOf(me.address);
  const toWrap = bal < amount ? amount - bal : 0n;
  const native = await ethers.provider.getBalance(me.address);
  if (toWrap > 0n && native < toWrap + ethers.parseEther("0.2")) throw new Error(`You have ${ethers.formatEther(bal)} WQIE and ${ethers.formatEther(native)} QIE: not enough to swap ${ethers.formatEther(amount)} and keep 0.2 QIE for gas.`);
  const [, out] = await router.getAmountsOut(amount, [WQIE, QUSDC]);
  const minOut = (out * (10000n - slip)) / 10000n;
  console.log(`Wallet ${me.address}`);
  console.log(`Swap ${ethers.formatEther(amount)} WQIE -> about ${ethers.formatUnits(out, 6)} QUSDC (you get at least ${ethers.formatUnits(minOut, 6)} or the swap cancels itself)`);
  if (toWrap > 0n) console.log(`First wraps ${ethers.formatEther(toWrap)} of your QIE into WQIE (1:1).`);
  console.log(`QIE in wallet: ${ethers.formatEther(native)}`);
  if (process.env.CONFIRM !== "yes") {
    console.log(`\nNothing sent. If this looks right, run:  $env:CONFIRM="yes"  and then the same command again.`);
    return;
  }
  if (toWrap > 0n) {
    const w = await wqie.deposit({ value: toWrap });
    console.log(`Wrap sent: ${w.hash}`);
    await w.wait();
  }
  if ((await wqie.allowance(me.address, ROUTER)) < amount) {
    const a = await wqie.approve(ROUTER, amount);
    console.log(`Approve sent: ${a.hash}`);
    await a.wait();
  }
  const before = await qusdc.balanceOf(me.address);
  const deadline = Math.floor(Date.now() / 1000) + 600;
  const tx = await router.swapExactTokensForTokens(amount, minOut, [WQIE, QUSDC], me.address, deadline);
  console.log(`Swap sent: ${tx.hash}  (https://mainnet.qie.digital/tx/${tx.hash})`);
  const rc = await tx.wait();
  if (rc.status !== 1) throw new Error("The swap reverted; nothing was exchanged.");
  const after = await qusdc.balanceOf(me.address);
  console.log(`Done. You received ${ethers.formatUnits(after - before, 6)} QUSDC. QUSDC balance now ${ethers.formatUnits(after, 6)}.`);
}

main().catch((e) => {
  console.error(e.shortMessage || e.message || e);
  process.exitCode = 1;
});
