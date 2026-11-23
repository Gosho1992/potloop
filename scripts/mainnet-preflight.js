// Read-only check before any QIE mainnet test spending. Sends NO transactions.
//   Without a key (read-only):  $env:FUNDER="0xYourAddress"
//   npx hardhat run scripts/mainnet-preflight.js --network qieMainnet
// Optional: $env:FACTORY="0x..." (once deployed), $env:BUDGET_QIE, $env:RESERVE_QIE, $env:MEMBER_GAS_QIE
//
// Prints: chain and RPC, gas price, your QIE and QUSDC, the QUSDC token, the factory (verified byte
// by byte against this build) or the exact deployment estimate, the member wallets, the cost of each
// scenario (gas measured in the rehearsal x today's gas price), GO / NO-GO, and the approval codes.
// The deployment code is only printed with DEPLOYER_PRIVATE_KEY set, because it is tied to the deployer.
const fs = require("fs");
const path = require("path");
const H = require("./mainnet/harness");
const { scenarios, MAX_MEMBERS } = require("./mainnet/scenarios");
const { ethers, network, q, qie } = H;

async function main() {
  const t0 = Date.now();
  const { chainId } = await ethers.provider.getNetwork();
  if (network.name !== "qieMainnet" || chainId !== H.MAINNET) throw new Error("Run with --network qieMainnet (chain 1990).");
  const block = await ethers.provider.getBlock("latest");
  const price = (await ethers.provider.getFeeData()).gasPrice;
  const out = { at: new Date().toISOString(), chainId: chainId.toString(), block: block.number, gasPriceWei: price.toString(), blockers: [] };
  const blocker = (s) => {
    out.blockers.push(s);
    console.log(`  BLOCKER: ${s}`);
  };
  console.log(`QIE mainnet, chain ${chainId}, block ${block.number} (${new Date(block.timestamp * 1000).toISOString()}), RPC answered in ${Date.now() - t0} ms`);
  console.log(`Gas price ${ethers.formatUnits(price, "gwei")} gwei`);

  const [signer] = await ethers.getSigners();
  const funder = signer ? signer.address : process.env.FUNDER;
  if (!funder) throw new Error("Set FUNDER=<your public address> (read-only) or DEPLOYER_PRIVATE_KEY.");
  const token = new ethers.Contract(H.QUSDC, H.ERC20, ethers.provider);
  const [sym, dec] = [await token.symbol(), Number(await token.decimals())];
  if (sym !== "QUSDC" || dec !== 6) blocker(`token at ${H.QUSDC} is ${sym}/${dec}, expected QUSDC/6`);
  const qieBal = await ethers.provider.getBalance(funder);
  const qusdcBal = await token.balanceOf(funder);
  Object.assign(out, { funder, funderQie: qieBal.toString(), funderQusdc: qusdcBal.toString() });
  console.log(`Your wallet ${funder}: ${qie(qieBal)} QIE, ${q(qusdcBal)} QUSDC`);

  const gt = H.loadGasTable();
  if (!gt) throw new Error("scripts/mainnet/gas-table.json missing: run the fork rehearsal first.");
  const margin = (g) => (BigInt(g) * 13n) / 10n; // 30% over the rehearsal's measured gas
  const budgetWei = ethers.parseEther(process.env.BUDGET_QIE || "0.05");
  const reserveWei = ethers.parseEther(process.env.RESERVE_QIE || "0.02");
  const memberGas = ethers.parseEther(process.env.MEMBER_GAS_QIE || "0.003");

  // factory: verify, or price the deployment
  let factoryAddr = process.env.FACTORY || null;
  let deployCost = 0n;
  if (factoryAddr) {
    try {
      const { rules, deployer } = await H.verifyFactory(factoryAddr);
      const count = (await (await ethers.getContractAt("CircleFactory", factoryAddr)).circlesPage(0, 100)).length;
      console.log(`Factory ${factoryAddr}: code matches this build; deployer ${deployer} matches and points back; fee ${rules.feeBps_} bps; min round ${rules.minRoundLength_}s; min contribution ${q(rules.minContribution_)} QUSDC; min cover ${rules.minCoverageBps_} bps; ${count} circles so far`);
      if (rules.token_ !== H.QUSDC) blocker("factory token is not QUSDC");
      if (rules.minRoundLength_ > 60n || rules.minContribution_ > 50_000n || rules.minCoverageBps_ > 2000n) blocker("factory minimums are too high for the 5 scenarios (need 60 s rounds, 0.05 QUSDC, 20% cover)");
      out.factory = { address: factoryAddr, deployer, rules: rules.map(String) };
    } catch (e) {
      blocker(e.message);
    }
  } else {
    const params = [H.QUSDC, funder, 50, 60, 30, 10_000n, 0];
    let est = BigInt(gt.deployFactory);
    try {
      const f = await ethers.getContractFactory("CircleFactory");
      const tx = await f.getDeployTransaction(...params);
      est = await ethers.provider.estimateGas({ ...tx, from: funder });
    } catch {}
    deployCost = margin(est) * price;
    out.deployment = { params: params.map(String), gasEstimate: est.toString(), costWeiWithMargin: deployCost.toString() };
    console.log(`Factory: not deployed yet. One deployment (demo-mode minimums: 60 s rounds, 30 s grace, 0.01 QUSDC, 0% minimum cover, 0.5% fee to your wallet): ${est} gas, about ${qie(est * price)} QIE (${qie(deployCost)} with 30% margin)`);
    if (signer) {
      const code = H.deployApprovalCode({ chain: chainId.toString(), deployer: funder, token: H.QUSDC, treasury: funder, feeBps: 50, minRound: 60, minGrace: 30, minContribution: "10000", minCover: 0 });
      out.deployApproval = code;
      console.log(`  Deployment approval code: ${code}`);
    }
  }

  // member wallets
  const file = path.join(H.ROOT, "demo-wallets.json");
  let memberAddrs = [];
  if (!fs.existsSync(file)) blocker(`demo-wallets.json not found: run node scripts/make-wallets.js ${MAX_MEMBERS} on this computer`);
  else {
    const list = JSON.parse(fs.readFileSync(file, "utf8"));
    if (list.length < MAX_MEMBERS) blocker(`demo-wallets.json has ${list.length} wallets, ${MAX_MEMBERS} needed`);
    memberAddrs = list.map((w) => w.address);
    for (const w of list) {
      const b = await token.balanceOf(w.address);
      const g = await ethers.provider.getBalance(w.address);
      console.log(`  member ${w.name} ${w.address}: ${q(b)} QUSDC, ${qie(g)} QIE`);
      if (b > 0n) blocker(`${w.name} already holds QUSDC: run scripts/return-funds.js so no balance carries into a scenario`);
    }
  }

  // scenarios
  const { simulate } = await import(path.join(H.ROOT, "app/src/sim.js"));
  let total = 0n;
  let peak = 0n;
  out.scenarios = [];
  console.log(`\nScenario costs (gas measured in the rehearsal on a copy of mainnet, +30%, at today's price):`);
  for (const id of [1, 2, 3, 4, 5]) {
    const sc = { id, ...scenarios[id] };
    const plan = H.planScenario(simulate, sc, 50, gt);
    const cost = margin(gt[`scenario-${id}`]) * price;
    total += cost;
    if (plan.qusdcPeak > peak) peak = plan.qusdcPeak;
    const maxN = Math.max(...sc.circles.map((c) => c.n));
    const code = factoryAddr && memberAddrs.length >= maxN ? H.approvalCode({ id, chainId, factory: factoryAddr, funder, memberAddrs: memberAddrs.slice(0, maxN), budgetWei, reserveWei, scenario: scenarios[id] }) : "(after deployment and wallet setup)";
    const overBudget = cost + memberGas * BigInt(maxN) > budgetWei;
    if (overBudget) blocker(`scenario ${id} could cost up to ${qie(cost)} QIE plus ${qie(memberGas * BigInt(maxN))} QIE member gas float, above BUDGET_QIE ${qie(budgetWei)}`);
    out.scenarios.push({ id, title: sc.title, transactions: gt[`scenario-${id}-transactions`], gas: gt[`scenario-${id}`], costWeiWithMargin: cost.toString(), qusdcPeak: plan.qusdcPeak.toString(), approval: code });
    console.log(`  ${id}. ${sc.title}\n     ${gt[`scenario-${id}-transactions`]} transactions, ${gt[`scenario-${id}`]} gas, up to ${qie(cost)} QIE; needs ${q(plan.qusdcPeak)} QUSDC at once (returned at the end); approval ${code}`);
  }
  const float = memberGas * BigInt(MAX_MEMBERS);
  const needQie = deployCost + total + float + reserveWei;
  Object.assign(out, { totalScenarioCostWei: total.toString(), memberGasFloatWei: float.toString(), reserveWei: reserveWei.toString(), needQieWei: needQie.toString(), needQusdc: peak.toString() });
  console.log(`\nTotal: deployment ${qie(deployCost)} + five scenarios ${qie(total)} + member gas float ${qie(float)} (returned) + reserve ${qie(reserveWei)} = ${qie(needQie)} QIE`);
  console.log(`QUSDC: ${q(peak)} at once for the largest scenario; it comes back after each scenario (the 0.5% fee goes to your own wallet as treasury), so the net QUSDC cost is 0`);
  if (qieBal < needQie) blocker(`your wallet has ${qie(qieBal)} QIE; ${qie(needQie)} QIE needed for everything with margins`);
  if (qusdcBal < peak) blocker(`your wallet has ${q(qusdcBal)} QUSDC; ${q(peak)} QUSDC needed for the largest scenario`);
  console.log(out.blockers.length ? `\nNO-GO: ${out.blockers.length} blocker(s) above.` : `\nGO: nothing blocks the plan. Each step still needs its own approval code.`);
  fs.mkdirSync(path.join(H.ROOT, "mainnet-runs"), { recursive: true });
  fs.writeFileSync(path.join(H.ROOT, "mainnet-runs", `preflight-${out.at.replace(/[:.]/g, "-")}.json`), JSON.stringify(out, null, 2) + "\n");
}

main().catch((e) => {
  console.error(e.message || e);
  process.exitCode = 1;
});
