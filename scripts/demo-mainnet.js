// Runs a real PotLoop circle on QIE mainnet with your wallet + 4 demo wallets.
// Story (the 2-minute PotLoop demo, all real transactions):
//   round 1  everyone pays; Sipho (seat 1) receives the pot
//   round 2  Sipho stops paying; his collateral pays what it can; Thandi is paid short and the
//            contract records what she is still owed
//   round 3  Sipho's collateral is used up; Ayesha is paid short too
//   round 4  Sipho catches up in full (collateral refilled + missed share + this round + 2% fee);
//            the money goes straight to Thandi and Ayesha, oldest debt first
//   round 5  normal; the circle finishes and everyone's track record is written
// His locked collateral pays his share, so the next recipient still gets the full pot.
//
// Before running:
//   1. node scripts/make-wallets.js 4          (creates demo-wallets.json on your PC)
//   2. Your wallet holds some QIE (gas) and QUSDC (about 1 QUSDC is plenty at the default size)
// Then (PowerShell):
//   $env:DEPLOYER_PRIVATE_KEY="0x..."          # your wallet; it becomes seat 5
//   $env:FACTORY="0x..."                        # from deploy-factory.js
//   npx hardhat run scripts/demo-mainnet.js --network qieMainnet
// Optional: $env:CONTRIBUTION="0.02"  $env:COVERAGE_BPS="2000" (low cover shows a shortfall)
//           $env:CATCH_UP_ROUND="4" ("0" = Sipho never catches up)  $env:NO_DEFAULT="1" (everyone pays)
//           $env:ROUND_SECONDS="120"  $env:GRACE_SECONDS="30"   $env:NAME="Demo circle"
//           $env:STOP_AFTER_ROUND="3"  (leave the circle running mid-way so the app shows a live round)
const fs = require("fs");
const path = require("path");
const { ethers } = require("hardhat");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const [me] = await ethers.getSigners();
  const file = path.join(__dirname, "..", "demo-wallets.json");
  if (!fs.existsSync(file)) throw new Error("Run: node scripts/make-wallets.js 4");
  const demo = JSON.parse(fs.readFileSync(file, "utf8")).slice(0, 4);
  const wallets = demo.map((d) => new ethers.Wallet(d.privateKey, ethers.provider));
  const names = [...demo.map((d) => d.name), "You"];
  const signers = [...wallets, me];
  const addrs = await Promise.all(signers.map((s) => s.getAddress()));

  const factory = await ethers.getContractAt("CircleFactory", process.env.FACTORY || "");
  const tokenAddr = await factory.token();
  const token = await ethers.getContractAt("@openzeppelin/contracts/token/ERC20/IERC20.sol:IERC20", tokenAddr);
  const dec = 6;
  const fmt = (x) => ethers.formatUnits(x, dec);
  const c = ethers.parseUnits(process.env.CONTRIBUTION || "0.02", dec);
  const k = Number(process.env.COVERAGE_BPS || 2000);
  const catchUpRound = Number(process.env.CATCH_UP_ROUND ?? 4);
  const round = Number(process.env.ROUND_SECONDS || 120);
  const grace = Number(process.env.GRACE_SECONDS || 30);
  const doDefault = process.env.NO_DEFAULT !== "1";
  const fromPot = process.env.COLLATERAL_FROM_POT !== "0"; // default: one-share bond to join, rest held from the pot
  const stopAfter = Number(process.env.STOP_AFTER_ROUND || 5);
  const n = 5;

  // what each seat needs: collateral + one contribution per round
  const later = (i) => Math.max(n - 1 - i, 1);
  // collateral + every payment, plus room for a full catch-up (arrears + 2% fee) for seat 1
  const need = (i) => (BigInt(later(i)) * c * BigInt(k) + 9999n) / 10000n + c * BigInt(n) + (i === 0 ? c * BigInt(n) : 0n);
  // what your wallet must provide: your own seat + whatever the demo wallets are missing
  let total = need(n - 1);
  for (let i = 0; i < 4; i++) {
    const bal = await token.balanceOf(wallets[i].address);
    if (bal < need(i)) total += need(i) - bal;
  }
  const myQusdc = await token.balanceOf(me.address);
  console.log(`Your wallet ${me.address}: ${ethers.formatEther(await ethers.provider.getBalance(me.address))} QIE, ${fmt(myQusdc)} QUSDC`);
  console.log(`This circle needs up to ${fmt(total)} more QUSDC from your wallet (it comes back at the end).`);
  if (myQusdc < total) throw new Error(`Not enough QUSDC. Lower CONTRIBUTION or swap more QIE to QUSDC.`);

  // 1. top up the demo wallets with gas and QUSDC
  const GAS = ethers.parseEther(process.env.GAS_QIE || "0.01");
  for (let i = 0; i < 4; i++) {
    const w = wallets[i];
    const qie = await ethers.provider.getBalance(w.address);
    if (qie < GAS) await (await me.sendTransaction({ to: w.address, value: GAS - qie })).wait();
    const bal = await token.balanceOf(w.address);
    if (bal < need(i)) await (await token.connect(me).transfer(w.address, need(i) - bal)).wait();
    console.log(`  funded ${names[i]} ${w.address}`);
  }

  // 2. create the circle
  const fromBlock = await ethers.provider.getBlockNumber();
  const name = process.env.NAME || "PotLoop demo circle";
  const tx = await factory.connect(me).createCircle(name, addrs, c, k, round, grace, 15 * 60, fromPot);
  // (round and grace must meet the factory's minimums: deploy the factory with MODE=demo for 2-minute rounds)
  const rc = await tx.wait();
  const ev = rc.logs.map((l) => { try { return factory.interface.parseLog(l); } catch { return null; } }).find((e) => e && e.name === "CircleCreated");
  const circleAddr = ev.args.circle;
  const circle = await ethers.getContractAt("SavingsCircle", circleAddr);
  console.log(`\nCircle "${name}" at ${circleAddr}`);

  // 3. everyone accepts their seat
  for (let i = 0; i < n; i++) {
    const col = await circle.upfrontCollateral(i);
    if (col > 0n) await (await token.connect(signers[i]).approve(circleAddr, col)).wait();
    await (await circle.connect(signers[i]).accept()).wait();
    const full = await circle.collateralFor(i);
    console.log(`  ${names[i]} took seat ${i + 1}, locked ${fmt(col)} QUSDC` + (full > col ? ` now (another ${fmt(full - col)} will be held from their pot)` : ""));
  }

  // 4. rounds
  for (let r = 1; r <= stopAfter; r++) {
    if (doDefault && catchUpRound && r === catchUpRound && (await circle.member(0)).status === 2n) {
      const [total, currentPart, lateFee] = await circle.catchUpCost(0);
      const [restore, uncovered] = await circle.arrearsOf(0);
      await (await token.connect(signers[0]).approve(circleAddr, total)).wait();
      const rc = await (await circle.connect(signers[0]).catchUp()).wait();
      console.log(`Round ${r}: ${names[0]} catches up: refills ${fmt(restore)} collateral, pays ${fmt(uncovered)} missed + ${fmt(currentPart)} this round + ${fmt(lateFee)} late fee`);
      for (const l of rc.logs) {
        let e; try { e = circle.interface.parseLog(l); } catch { continue; }
        if (e && e.name === "EntitlementRepaid") console.log(`  -> ${names[addrs.indexOf(e.args.recipient)]} repaid ${fmt(e.args.amount)} QUSDC they were owed`);
      }
    }
    const behindForGood = (i) => doDefault && i === 0 && r >= 2 && !(catchUpRound && r >= catchUpRound);
    const caughtUpNow = doDefault && catchUpRound && r === catchUpRound;
    const payers = [0, 1, 2, 3, 4].filter((i) => !behindForGood(i) && !(caughtUpNow && i === 0));
    for (const i of payers) {
      await (await token.connect(signers[i]).approve(circleAddr, c)).wait();
      await (await circle.connect(signers[i]).contribute()).wait();
    }
    console.log(`Round ${r}: paid by ${payers.map((i) => names[i]).join(", ")}`);
    if (r === stopAfter && stopAfter < n) break;
    // only wait if a member in good standing has not paid (a new default this round)
    let goodUnpaid = false;
    for (let i = 0; i < n; i++) {
      if ((await circle.member(i)).status !== 1n && !(await circle.contributed(r, i))) goodUnpaid = true;
    }
    if (goodUnpaid) {
      // wait (wall clock) until the payment window has closed; block times follow real time
      const due = Number(await circle.deadline()) + grace + 3;
      for (;;) {
        const chainNow = (await ethers.provider.getBlock("latest")).timestamp;
        const now = Math.max(Math.floor(Date.now() / 1000), chainNow);
        if (now > due) break;
        process.stdout.write(`  waiting ${due - now}s for the payment window to close...   \r`);
        await sleep(3000);
        if ((await ethers.provider.getNetwork()).chainId === 31337n) await ethers.provider.send("evm_mine", []);
      }
      console.log("");
    }
    // a block can lag the clock by a few seconds: retry while the chain says "too early"
    for (let tries = 0; ; tries++) {
      try {
        await circle.connect(me).settle.staticCall();
        break;
      } catch (e) {
        if (tries > 20) throw e;
        await sleep(3000);
        // local test chains only make blocks on demand
        if ((await ethers.provider.getNetwork()).chainId === 31337n) await ethers.provider.send("evm_mine", []);
      }
    }
    const st = await (await circle.connect(me).settle()).wait();
    const evs = st.logs.map((l) => { try { return circle.interface.parseLog(l); } catch { return null; } }).filter(Boolean);
    // print the pot line before the "held from the pot" line, whatever the event order
    evs.sort((a, b) => (a.name === "CollateralHeldFromPot") - (b.name === "CollateralHeldFromPot"));
    for (const e of evs) {
      if (e.name === "CollateralHeldFromPot") console.log(`  ${fmt(e.args.amount)} QUSDC of it held back as ${names[addrs.indexOf(e.args.member)]}'s collateral (returned at the end)`);
      if (e.name === "PotCredited") console.log(`  pot: ${names[addrs.indexOf(e.args.recipient)]} credited ${fmt(e.args.fromFund + e.args.fromReserve)} QUSDC (short ${fmt(e.args.unpaid)})`);
      if (e.name === "CollateralCovered") console.log(`  ${names[addrs.indexOf(e.args.member)]}'s collateral paid ${fmt(e.args.amount)} QUSDC`);
      if (e.name === "Defaulted") console.log(`  ${names[addrs.indexOf(e.args.member)]} missed this round`);
    }
  }

  if (stopAfter >= n) {
    // wait out the cure window if seat 1 is still behind
    const fa = Number(await circle.finalizeAfter());
    while (Math.max(Math.floor(Date.now() / 1000), (await ethers.provider.getBlock("latest")).timestamp) < fa + 2) {
      process.stdout.write(`  cure window: ${fa + 2 - Math.floor(Date.now() / 1000)}s left for members behind to catch up...   \r`);
      await sleep(3000);
      if ((await ethers.provider.getNetwork()).chainId === 31337n) await ethers.provider.send("evm_mine", []);
    }
    await (await circle.connect(me).finalize()).wait();
    await (await factory.connect(me).recordCircle(circleAddr)).wait();
    console.log("Results written to everyone's PotLoop track record.");
    for (let i = 0; i < n; i++) {
      if ((await circle.withdrawable(addrs[i])) > 0n) await (await circle.connect(signers[i]).withdraw()).wait();
    }
    console.log(`\nFinalized; everyone withdrew. Run scripts/return-funds.js to pull the demo wallets' money back.`);
  }

  const labels = addrs.map((a, i) => `${a}:${names[i]}`).join(",");
  console.log(`\nApp link (local dev):  http://localhost:5173/?from=${fromBlock}&labels=${labels}#/c/${circleAddr}`);
  const chain = (await ethers.provider.getNetwork()).chainId;
  const explorer = process.env.EXPLORER || (chain === 1990n ? "https://mainnet.qie.digital" : "");
  if (explorer) console.log(`Explorer: ${explorer}/address/${circleAddr}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
