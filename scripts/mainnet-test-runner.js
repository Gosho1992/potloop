// PotLoop acceptance scenarios on QIE.
//
// MODE=fork  (rehearsal, no real funds): runs on a local copy of QIE mainnet with the real QUSDC.
//   $env:FORK_URL="https://rpc1mainnet.qie.digital"; $env:MODE="fork"; $env:SCENARIO="all"
//   npx hardhat run scripts/mainnet-test-runner.js
//   Deploys a fresh factory on the copy, funds throwaway members from an existing QUSDC holder
//   (impersonated on the copy only) and records the gas of every step in scripts/mainnet/gas-table.json.
//
// MODE=live  (REAL QUSDC AND QIE on QIE mainnet; one scenario per run, only with your approval code):
//   $env:DEPLOYER_PRIVATE_KEY="..."    your funding wallet, typed in this window only
//   $env:FACTORY="0x..."               the one deployed factory (verified byte by byte first)
//   $env:SCENARIO="1"                  1 to 5
//   $env:APPROVE="S1-xxxxxxxx"         printed by scripts/mainnet-preflight.js for exactly this plan
//   $env:BUDGET_QIE="0.05"             stop before any transaction that would exceed this
//   $env:RESERVE_QIE="0.02"            never let your wallet drop below this
//   $env:MODE="live"; npx hardhat run scripts/mainnet-test-runner.js --network qieMainnet
//
// Every scenario creates NEW circle(s), funds the member wallets for that circle only, checks every
// state change against the parity-tested simulator exactly, withdraws everything, checks that no one
// can withdraw twice and that other circles are untouched, then sweeps the member wallets back to you.
// Reports: mainnet-runs/<mode>-S<n>-<time>.json and a row per circle in mainnet-runs/runner-log.csv (the corrected reports are built by scripts/build-mainnet-reports.js).
const fs = require("fs");
const path = require("path");
const H = require("./mainnet/harness");
const { scenarios, MAX_MEMBERS } = require("./mainnet/scenarios");
const { ethers, network, q, qie } = H;

const MODE = process.env.MODE || "fork";
const live = MODE === "live";
const log = (s) => console.log(s);

async function waitUntil(ts) {
  const now = async () => (await ethers.provider.getBlock("latest")).timestamp;
  if (!live) {
    const t = await now();
    if (t < ts) await ethers.provider.send("evm_increaseTime", [ts - t]);
    await ethers.provider.send("evm_mine", []);
    return;
  }
  let t = await now();
  if (t < ts) log(`  waiting ${ts - t}s for the chain clock (round timing is enforced by the contract)`);
  while (t < ts) {
    await H.sleep(5000);
    t = await now();
  }
}

async function fundFunderOnFork(funder, token, need) {
  const TRANSFER = ethers.id("Transfer(address,address,uint256)");
  const head = await ethers.provider.getBlockNumber();
  for (let to = head - 1, step = 9000; to > head - 900000; to -= step) {
    const logs = await ethers.provider.getLogs({ address: H.QUSDC, topics: [TRANSFER], fromBlock: to - step + 1, toBlock: to });
    for (const a of [...new Set(logs.map((l) => ethers.getAddress("0x" + l.topics[2].slice(26))))]) {
      if ((await token.balanceOf(a)) >= need) {
        await ethers.provider.send("hardhat_impersonateAccount", [a]);
        await ethers.provider.send("hardhat_setBalance", [a, "0x56BC75E2D63100000"]);
        await (await token.connect(await ethers.getSigner(a)).transfer(funder.address, need)).wait();
        return a;
      }
    }
  }
  throw new Error("No QUSDC holder found on the copy");
}

async function runCircle(ctx, cfg, sim, fund) {
  const { factory, token, funder, ledger, feeBps, treasury } = ctx;
  const checks = [];
  const check = (name, ok, detail = "") => {
    checks.push({ name, ok, detail });
    log(`  ${ok ? "PASS" : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
  };
  const members = H.memberWallets(cfg.n, live);
  log(`\n${cfg.label}: ${cfg.n} members, ${q(cfg.c)} QUSDC per round, ${cfg.k / 100}% cover, collateral ${cfg.fromPayout ? "from the pot" : "up front"}`);

  // start clean: no balances carried over from another circle
  for (const m of members) {
    const b = await token.balanceOf(m.wallet.address);
    if (b !== 0n) throw new Error(`${m.name} (${m.wallet.address}) already holds ${q(b)} QUSDC. Run scripts/return-funds.js first.`);
  }
  // independence: balances of every earlier circle of this factory, before
  const earlier = [...(await factory.circlesPage(0, 100))];
  const earlierBefore = await Promise.all(earlier.map((a) => token.balanceOf(a)));

  // fund members for this circle only: exactly what the simulator says each will send in, plus gas
  const memberGas = ethers.parseEther(process.env.MEMBER_GAS_QIE || "0.003");
  for (let i = 0; i < cfg.n; i++) {
    if (fund[i] > 0n) await ledger.send(`fund ${members[i].name} ${q(fund[i])} QUSDC`, funder, token, "transfer", [members[i].wallet.address, fund[i]]);
    await ledger.send(`fund ${members[i].name} gas`, funder, funder, "__transfer", [members[i].wallet.address], memberGas);
  }
  const startBal = await Promise.all(members.map((m) => token.balanceOf(m.wallet.address)));
  const treasuryStart = await token.balanceOf(treasury);

  const rc = await ledger.send(`create ${cfg.label}`, funder, factory, "createCircle", [
    `PotLoop test ${cfg.label} ${new Date().toISOString().slice(0, 16)}`,
    members.map((m) => m.wallet.address),
    cfg.c,
    cfg.k,
    cfg.round,
    cfg.grace,
    cfg.join,
    cfg.fromPayout,
  ]);
  const created = rc.logs.map((l) => { try { return factory.interface.parseLog(l); } catch { return null; } }).find((e) => e && e.name === "CircleCreated");
  const addr = created.args.circle;
  const circle = await ethers.getContractAt("SavingsCircle", addr);
  log(`  circle ${addr}`);
  check("factory registered the new circle", await factory.isCircle(addr));
  check("circle is new (not one of the earlier circles)", !earlier.includes(addr));

  const simQueue = sim.trace.slice();
  const compare = async (step, extra) => {
    const chain = await H.snapshot(circle, cfg.n, members, treasury, feeBps, step, extra);
    const want = simQueue.shift();
    const ok = want && H.ser(want) === H.ser(chain);
    if (!ok) check(`state after ${step} (round ${chain.round}) matches the simulator`, false, `expected ${H.ser(want)} got ${H.ser(chain)}`.slice(0, 400));
    return ok;
  };
  let stateOk = true;

  for (let i = 0; i < cfg.n; i++) {
    const up = await circle.upfrontCollateral(i);
    if (up > 0n) await ledger.send(`${members[i].name} approves ${q(up)} collateral`, members[i].wallet, token, "approve", [addr, up]);
    await ledger.send(`${members[i].name} accepts seat ${i + 1}`, members[i].wallet, circle, "accept");
  }
  const doCatchUp = async (i) => {
    const [total, currentPart, lateFee] = await circle.catchUpCost(i);
    await ledger.send(`${members[i].name} approves catch-up ${q(total)}`, members[i].wallet, token, "approve", [addr, total]);
    await ledger.send(`${members[i].name} catches up`, members[i].wallet, circle, "catchUp");
    stateOk = (await compare("catchUp", { member: i, cost: { total, currentPart, lateFee } })) && stateOk;
  };
  for (let r = 1; r <= cfg.n; r++) {
    for (let i = 0; i < cfg.n; i++) if (cfg.catchUpAt[i] === r && (await circle.member(i)).status === 2n) await doCatchUp(i);
    for (let i = 0; i < cfg.n; i++) {
      const stopped = cfg.stopAt[i] && r >= cfg.stopAt[i] && !(cfg.catchUpAt[i] && r >= cfg.catchUpAt[i]);
      if (stopped || (await circle.contributed(r, i)) || (await circle.member(i)).status === 1n) continue;
      await ledger.send(`${members[i].name} approves round ${r}`, members[i].wallet, token, "approve", [addr, cfg.c]);
      await ledger.send(`${members[i].name} pays round ${r}`, members[i].wallet, circle, "contribute");
    }
    stateOk = (await compare("contributed")) && stateOk;
    let allPaid = true;
    for (let i = 0; i < cfg.n; i++) if ((await circle.member(i)).status !== 1n && !(await circle.contributed(r, i))) allPaid = false;
    if (!allPaid) await waitUntil(Number(await circle.deadline()) + cfg.grace + 1);
    await ledger.send(`settle round ${r}`, funder, circle, "settle");
    stateOk = (await compare("settle")) && stateOk;
  }
  for (let i = 0; i < cfg.n; i++) if (cfg.catchUpAt[i] > cfg.n && (await circle.member(i)).status === 2n) await doCatchUp(i);
  await waitUntil(Number(await circle.finalizeAfter()) + 1);
  await ledger.send(`finalize ${cfg.label}`, funder, circle, "finalize");
  stateOk = (await compare("finalize")) && stateOk;
  check("every state change matched the simulator exactly (base units)", stateOk && simQueue.length === 0);

  // withdrawals, and nobody can withdraw twice
  for (let i = 0; i < cfg.n; i++) {
    if ((await circle.withdrawable(members[i].wallet.address)) > 0n) await ledger.send(`${members[i].name} withdraws`, members[i].wallet, circle, "withdraw");
  }
  // a second withdrawal must revert with NothingToWithdraw (simulated call: costs nothing)
  let twice = true;
  for (let i = 0; i < cfg.n; i++) {
    try {
      await circle.connect(members[i].wallet).withdraw.staticCall();
      twice = false; // it would have paid out again
    } catch (e) {
      const reason = circle.interface.parseError(e.data || "0x")?.name;
      if (reason !== "NothingToWithdraw") twice = false;
    }
  }
  check("no member can withdraw a second time (reverts with NothingToWithdraw)", twice);
  const treasuryOwed = feeBps > 0 ? await circle.withdrawable(treasury) : 0n;
  check("treasury fee equals the simulator's", treasuryOwed === sim.treasury, `${q(treasuryOwed)} QUSDC`);
  let treasuryGot = null;
  if (treasuryOwed > 0n && treasury === funder.address) {
    const before = await token.balanceOf(treasury);
    await ledger.send("treasury withdraws the fee", funder, circle, "withdraw");
    treasuryGot = (await token.balanceOf(treasury)) - before;
  }

  // money: exact, in base units
  for (let i = 0; i < cfg.n; i++) {
    const delta = (await token.balanceOf(members[i].wallet.address)) - startBal[i];
    check(`${members[i].name}: wallet change equals the simulator's net`, delta === sim.members[i].net, `${q(delta)} QUSDC`);
  }
  if (treasury === funder.address) {
    check("treasury received exactly the fee", (treasuryGot ?? 0n) === sim.treasury, `${q(treasuryGot ?? 0n)} QUSDC`);
  } else {
    check("treasury received exactly the fee", (await token.balanceOf(treasury)) - treasuryStart === 0n, "fee left in the circle for the treasury to withdraw");
  }
  const left = await token.balanceOf(addr);
  check("circle holds nothing after everyone withdrew", treasury === funder.address ? left === 0n : left === treasuryOwed, `${q(left)} QUSDC left`);
  const earlierAfter = await Promise.all(earlier.map((a) => token.balanceOf(a)));
  check("every other circle's balance is unchanged", earlier.every((_, j) => earlierAfter[j] === earlierBefore[j]), `${earlier.length} earlier circles`);

  // sweep the member wallets back
  for (const m of members) {
    const b = await token.balanceOf(m.wallet.address);
    if (b > 0n) await ledger.send(`${m.name} returns ${q(b)} QUSDC`, m.wallet, token, "transfer", [funder.address, b]);
    const price = (await ethers.provider.getFeeData()).gasPrice;
    const keep = 21000n * price * 2n;
    const g = await ethers.provider.getBalance(m.wallet.address);
    if (g > keep) await ledger.send(`${m.name} returns gas`, m.wallet, m.wallet, "__transfer", [funder.address], g - keep);
  }

  return {
    label: cfg.label,
    circle: addr,
    config: { n: cfg.n, contribution: cfg.c.toString(), coverBps: cfg.k, fromPayout: cfg.fromPayout, stopAt: cfg.stopAt, catchUpAt: cfg.catchUpAt, round: cfg.round, grace: cfg.grace },
    members: members.map((m, i) => ({ name: m.name, address: m.wallet.address, funded: fund[i].toString(), net: sim.members[i].net.toString(), collateralLocked: sim.members[i].collateralLocked.toString(), heldFromPot: sim.members[i].heldFromPot.toString() })),
    nets: sim.members.map((m) => m.net),
    checks,
  };
}

async function main() {
  const { simulate } = await import(path.join(H.ROOT, "app/src/sim.js"));
  const { chainId } = await ethers.provider.getNetwork();
  const ids = process.env.SCENARIO === "all" && !live ? [1, 2, 3, 4, 5] : [Number(process.env.SCENARIO || 1)];
  if (ids.some((i) => !scenarios[i])) throw new Error("SCENARIO must be 1 to 5 (or all, in fork mode)");
  const [funder] = await ethers.getSigners();
  if (!funder) throw new Error("Set DEPLOYER_PRIVATE_KEY in this window (live mode).");
  const token = new ethers.Contract(H.QUSDC, H.ERC20, ethers.provider);
  let factory, rules;

  if (live) {
    if (network.name !== "qieMainnet" || chainId !== H.MAINNET) throw new Error("Live mode runs only with --network qieMainnet (chain 1990).");
    if (!process.env.FACTORY) throw new Error("Set FACTORY to the deployed factory address.");
    ({ factory, rules } = await H.verifyFactory(process.env.FACTORY));
    if (rules.token_ !== H.QUSDC) throw new Error(`Factory token ${rules.token_} is not QUSDC.`);
  } else {
    if (!process.env.FORK_URL || network.name !== "hardhat") throw new Error("Fork mode needs FORK_URL and no --network.");
    await ethers.provider.send("evm_mine", []);
    const holder = await fundFunderOnFork(funder, token, 3_000_000n);
    log(`Rehearsal on a local copy of chain ${chainId} (nothing is sent to mainnet). Funder got 3 QUSDC from holder ${holder} on the copy.`);
    const f = await ethers.deployContract("CircleFactory", [H.QUSDC, funder.address, 50, 60, 30, 10_000n, 0]);
    const drc = await f.deploymentTransaction().wait();
    log(`Factory deployed on the copy: gas ${drc.gasUsed}`);
    ({ factory, rules } = await H.verifyFactory(await f.getAddress()));
    const gt = H.loadGasTable() || {};
    gt.deployFactory = drc.gasUsed.toString();
    fs.writeFileSync(H.GAS_TABLE, JSON.stringify(gt, null, 2) + "\n");
  }
  const feeBps = Number(rules.feeBps_);
  const budgetWei = ethers.parseEther(process.env.BUDGET_QIE || (live ? "0.05" : "100"));
  const reserveWei = ethers.parseEther(process.env.RESERVE_QIE || (live ? "0.02" : "0"));

  for (const id of ids) {
    const scenario = { id, ...scenarios[id] };
    const plan = H.planScenario(simulate, scenario, feeBps, H.loadGasTable());
    const members = H.memberWallets(MAX_MEMBERS, live).slice(0, Math.max(...scenario.circles.map((c) => c.n)));
    const code = H.approvalCode({ id, chainId, factory: await factory.getAddress(), funder: funder.address, memberAddrs: live ? members.map((m) => m.wallet.address) : "fork", budgetWei, reserveWei, scenario: scenarios[id] });
    if (live && process.env.APPROVE !== code) throw new Error(`Not approved. This exact plan's approval code is ${code}. Run scripts/mainnet-preflight.js, review it, then set APPROVE=${code}.`);
    log(`\n=== Scenario ${id}: ${scenario.title} (${MODE}) ===`);
    const funderQieBefore = await ethers.provider.getBalance(funder.address);
    const funderQusdcBefore = await token.balanceOf(funder.address);
    const ledger = new H.Ledger({ budgetWei, reserveWei, funder, live, report: log });
    const ctx = { factory, token, funder, ledger, feeBps, treasury: rules.treasury_ };
    const results = [];
    let error = null;
    try {
      for (const pc of plan.circles) results.push(await runCircle(ctx, pc.cfg, pc.sim, pc.fund));
      if (scenario.compareNets) {
        const [a, b] = scenario.compareNets.map((l) => results.find((r) => r.label === l));
        const same = H.ser(a.nets) === H.ser(b.nets);
        results[results.length - 1].checks.push({ name: `${a.label} and ${b.label}: every member's net result is identical`, ok: same });
        log(`  ${same ? "PASS" : "FAIL"} ${a.label} and ${b.label}: every member's net result is identical`);
        const ua = a.members.map((m) => q(BigInt(m.collateralLocked))).join(", ");
        const ub = b.members.map((m) => q(BigInt(m.collateralLocked))).join(", ");
        log(`  collateral locked to join: upfront [${ua}] vs from the pot [${ub}] QUSDC`);
      }
    } catch (e) {
      error = e.message;
      log(`\nSTOPPED: ${e.message}`);
    }
    const funderQieAfter = await ethers.provider.getBalance(funder.address);
    const funderQusdcAfter = await token.balanceOf(funder.address);
    const failed = results.flatMap((r) => r.checks).filter((c) => !c.ok).length;
    const passed = results.flatMap((r) => r.checks).filter((c) => c.ok).length;
    const outcome = error ? "STOPPED" : failed ? "FAIL" : "PASS";
    log(`\nScenario ${id}: ${outcome}. ${passed} checks passed, ${failed} failed. ${ledger.txs.length} transactions, gas ${ledger.gasUsed}, fees ${qie(ledger.spent)} QIE. Your wallet: QIE ${qie(funderQieBefore)} -> ${qie(funderQieAfter)}, QUSDC ${q(funderQusdcBefore)} -> ${q(funderQusdcAfter)}.`);

    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    fs.mkdirSync(path.join(H.ROOT, "mainnet-runs"), { recursive: true });
    const report = { mode: MODE, chainId: chainId.toString(), scenario: id, title: scenario.title, approval: live ? code : null, factory: await factory.getAddress(), deployer: await factory.deployer(), funder: funder.address, outcome, error, passed, failed, gasUsed: ledger.gasUsed.toString(), feesWei: ledger.spent.toString(), funder_qie_before: funderQieBefore.toString(), funder_qie_after: funderQieAfter.toString(), funder_qusdc_before: funderQusdcBefore.toString(), funder_qusdc_after: funderQusdcAfter.toString(), circles: results.map((r) => ({ ...r, nets: undefined })), transactions: ledger.txs, at: new Date().toISOString() };
    fs.writeFileSync(path.join(H.ROOT, "mainnet-runs", `${MODE}-S${id}-${stamp}.json`), H.ser(report).replace(/,"/g, ',\n "') + "\n");
    const csv = path.join(H.ROOT, "mainnet-runs", "runner-log.csv");
    if (!fs.existsSync(csv)) fs.writeFileSync(csv, "run_at_utc,mode,chain_id,scenario,circle_label,circle_address,members,contribution_qusdc,cover_pct,collateral_mode,transactions_in_scenario,gas_used_in_scenario,fees_qie_in_scenario,checks_passed,checks_failed,outcome\n");
    for (const r of results) {
      const cp = r.checks.filter((c) => c.ok).length;
      const cf = r.checks.length - cp;
      fs.appendFileSync(csv, [report.at, MODE, chainId, id, r.label, r.circle, r.config.n, q(BigInt(r.config.contribution)), r.config.coverBps / 100, r.config.fromPayout ? "from-pot" : "upfront", ledger.txs.length, ledger.gasUsed, qie(ledger.spent), cp, cf, outcome].join(",") + "\n");
    }
    if (!results.length) fs.appendFileSync(csv, [report.at, MODE, chainId, id, "", "", "", "", "", "", ledger.txs.length, ledger.gasUsed, qie(ledger.spent), 0, 0, outcome].join(",") + "\n");
    if (!live && !error) {
      const gt = H.loadGasTable() || {};
      gt[`scenario-${id}`] = String(Math.max(Number(gt[`scenario-${id}`] || 0), Number(ledger.gasUsed)));
      gt[`scenario-${id}-transactions`] = String(ledger.txs.length);
      gt[`scenario-${id}-qusdc-peak`] = plan.qusdcPeak.toString();
      fs.writeFileSync(H.GAS_TABLE, JSON.stringify(gt, null, 2) + "\n");
    }
    if (error || failed) process.exitCode = 1;
    if (error && live) break;
  }
}

main().catch((e) => {
  console.error(e.message || e);
  process.exitCode = 1;
});
