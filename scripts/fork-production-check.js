// Production-configuration check on a LOCAL COPY of QIE mainnet. Nothing is sent to mainnet: the
// RPC is only read to build the copy, and every transaction happens on the in-process copy.
//   $env:FORK_URL="https://rpc1mainnet.qie.digital"; npx hardhat run scripts/fork-production-check.js
//
// Uses the real QUSDC contract (0x3F43...5DA5) and the exact production factory settings of
// scripts/deploy-factory.js (1-day minimum rounds, 12-hour grace, 1 QUSDC minimum, 0.5% fee, 100%
// minimum cover). Funds three test members from an existing QUSDC holder (impersonated on the copy
// only), then runs a full circle in from-pot mode: accept, contribute, a default after the payout,
// collateral paying, a catch-up, finalize and withdrawals. Every QUSDC movement is checked to land
// exactly, so a token that charged fees or blocked transfers would stop the script here.
const { ethers, network } = require("hardhat");

const QUSDC = "0x3F43DA82eC9A4f5285F10FaF1F26EcA7319E5DA5";
const TRANSFER = ethers.id("Transfer(address,address,uint256)");

async function main() {
  if (!process.env.FORK_URL) throw new Error("Set FORK_URL to a QIE mainnet RPC; this script only runs on a local copy.");
  if (network.name !== "hardhat") throw new Error("Run without --network: the in-process copy only.");
  await ethers.provider.send("evm_mine", []); // run on a local block, not the copied one
  const { chainId } = await ethers.provider.getNetwork();
  const forkBlock = (await ethers.provider.getBlockNumber()) - 1;
  const token = await ethers.getContractAt("MockUSD", QUSDC); // ERC-20 calls only
  console.log(`Local copy of chain ${chainId} at block ${forkBlock}; token ${await token.symbol()}, ${await token.decimals()} decimals`);

  // find a holder from recent Transfer logs (read-only)
  let holder = null;
  for (let to = forkBlock, step = 9000; to > forkBlock - 900000 && !holder; to -= step) {
    const logs = await ethers.provider.getLogs({ address: QUSDC, topics: [TRANSFER], fromBlock: to - step + 1, toBlock: to });
    const seen = [...new Set(logs.map((l) => ethers.getAddress("0x" + l.topics[2].slice(26))))];
    for (const a of seen) if ((await token.balanceOf(a)) >= 18_000_000n) { holder = a; break; }
  }
  if (!holder) throw new Error("No QUSDC holder with 18 QUSDC found in recent logs.");
  console.log(`Funding test members from holder ${holder} (impersonated on the local copy only)`);
  await ethers.provider.send("hardhat_impersonateAccount", [holder]);
  await ethers.provider.send("hardhat_setBalance", [holder, "0x56BC75E2D63100000"]);
  const whale = await ethers.getSigner(holder);

  const [deployer, a, b, c] = await ethers.getSigners();
  const members = [a, b, c];
  for (const m of members) {
    const before = await token.balanceOf(m.address);
    await (await token.connect(whale).transfer(m.address, 6_000_000n)).wait();
    if ((await token.balanceOf(m.address)) - before !== 6_000_000n) throw new Error("QUSDC transfer did not arrive exactly.");
  }

  // exact production settings (scripts/deploy-factory.js, MODE=production)
  const factory = await ethers.deployContract("CircleFactory", [QUSDC, deployer.address, 50, 86400, 43200, 1_000_000n, 10000]);
  const fr = await factory.deploymentTransaction().wait();
  console.log(`Factory deployed: gas ${fr.gasUsed}; deployer ${await factory.deployer()}; rules ${(await factory.rules()).join(", ")}`);
  await (await factory.createCircle("fork check", members.map((m) => m.address), 1_000_000n, 10000, 86400, 43200, 7 * 86400, true)).wait();
  const [addr] = await factory.circlesPage(0, 1);
  const circle = await ethers.getContractAt("SavingsCircle", addr);
  const expectBal = async (want) => {
    const have = await token.balanceOf(addr);
    if (have !== want) throw new Error(`circle holds ${have}, ledgers say ${want}`);
  };

  for (let i = 0; i < 3; i++) {
    const up = await circle.upfrontCollateral(i);
    await (await token.connect(members[i]).approve(addr, up)).wait();
    await (await circle.connect(members[i]).accept()).wait();
  }
  console.log(`All accepted; joined with ${await circle.upfrontCollateral(0)}, ${await circle.upfrontCollateral(1)}, ${await circle.upfrontCollateral(2)} base units`);
  const pay = async (m) => {
    await (await token.connect(m).approve(addr, 1_000_000n)).wait();
    await (await circle.connect(m).contribute()).wait();
  };
  const passRound = async () => {
    // past this round's deadline + grace (rounds follow a fixed schedule)
    const due = Number(await circle.deadline()) + 43200 + 1;
    const now = (await ethers.provider.getBlock("latest")).timestamp;
    if (now < due) await ethers.provider.send("evm_increaseTime", [due - now]);
    await ethers.provider.send("evm_mine", []);
  };
  // round 1: everyone pays; seat 1 gets the pot and has collateral held from it
  for (const m of members) await pay(m);
  await (await circle.settle()).wait();
  console.log(`Round 1: seat 1 collateral ${(await circle.member(0)).collateral} (seat amount ${await circle.collateralFor(0)}), withdrawable ${await circle.withdrawable(a.address)}`);
  // round 2: seat 1 stops; its collateral pays
  await pay(b);
  await pay(c);
  await passRound();
  await (await circle.settle()).wait();
  console.log(`Round 2: seat 1 behind, collateral left ${(await circle.member(0)).collateral}`);
  // round 3: seat 1 catches up, then everyone pays
  const [total] = await circle.catchUpCost(0);
  await (await token.connect(a).approve(addr, total)).wait();
  await (await circle.connect(a).catchUp()).wait();
  await pay(b);
  await pay(c);
  await (await circle.settle()).wait();
  console.log(`Round 3: seat 1 caught up (${total} base units), back in good standing: ${(await circle.member(0)).status === 0n}`);
  const fa = Number(await circle.finalizeAfter());
  const now = (await ethers.provider.getBlock("latest")).timestamp;
  if (now < fa) await ethers.provider.send("evm_increaseTime", [fa - now + 1]);
  await ethers.provider.send("evm_mine", []);
  await (await circle.finalize()).wait();
  for (const m of [...members]) if ((await circle.withdrawable(m.address)) > 0n) await (await circle.connect(m).withdraw()).wait();
  if ((await circle.withdrawable(deployer.address)) > 0n) await (await circle.connect(deployer).withdraw()).wait();
  await expectBal(0n);
  const nets = await Promise.all(members.map(async (m) => Number((await token.balanceOf(m.address)) - 6_000_000n) / 1e6));
  console.log(`Finalized; everyone withdrew; the circle holds 0 QUSDC. Member results (QUSDC): ${nets.join(", ")}; fee to treasury ${Number(await token.balanceOf(deployer.address)) / 1e6}`);
  console.log("Production-configuration check passed on the local copy of QIE mainnet.");
}

main().catch((e) => {
  console.error(e.message || e);
  process.exitCode = 1;
});
