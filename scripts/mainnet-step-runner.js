// Resumable version of scripts/mainnet-test-runner.js for environments where a command may only
// run for a few minutes. Same scenarios, same checks, same safety rules (approval code, budget,
// reserve, no blind retries). Progress is saved after every step to
// mainnet-runs/state-S<n>.json; running the same command again continues exactly where it stopped.
// A transaction that was sent but not yet confirmed when the run stopped is waited for, never re-sent.
//
//   $env:FACTORY / SCENARIO / APPROVE / DEPLOYER_PRIVATE_KEY as for the test runner, then repeat:
//   npx hardhat run scripts/mainnet-step-runner.js --network qieMainnet
//   until it prints "SCENARIO COMPLETE". Optional: STEP_SECONDS (default 120) per invocation.
//   ADOPT_LOG=<log of an interrupted mainnet-test-runner run> continues that run instead of starting over.
const fs = require("fs");
const path = require("path");
const H = require("./mainnet/harness");
const { scenarios, MAX_MEMBERS } = require("./mainnet/scenarios");
const { ethers, network, q, qie } = H;

const T0 = Date.now();
const STEP_MS = Number(process.env.STEP_SECONDS || 120) * 1000;
const timeLeft = () => STEP_MS - (Date.now() - T0);
const log = (s) => console.log(s);
const J = (v) => JSON.parse(H.ser(v));

function buildActions(scenario) {
  const acts = [];
  for (const [ci, cfg] of scenario.circles.entries()) {
    const a = (kind, extra = {}) => acts.push({ ci, kind, ...extra });
    a("checkClean");
    for (let i = 0; i < cfg.n; i++) {
      a("fundQ", { i });
      a("fundGas", { i });
    }
    a("recordStart");
    a("create");
    for (let i = 0; i < cfg.n; i++) {
      a("approveCol", { i });
      a("accept", { i });
    }
    for (let r = 1; r <= cfg.n; r++) {
      for (let i = 0; i < cfg.n; i++) if (cfg.catchUpAt[i] === r) { a("approveCU", { i, r }); a("catchUp", { i, r }); }
      const payers = [];
      for (let i = 0; i < cfg.n; i++) {
        const stopped = cfg.stopAt[i] && r >= cfg.stopAt[i] && !(cfg.catchUpAt[i] && r >= cfg.catchUpAt[i]);
        if (!stopped) payers.push(i);
      }
      if (cfg.batch) a("payBatch", { r, payers });
      else for (const i of payers) { a("approvePay", { i, r }); a("pay", { i, r }); }
      a("compareContributed", { r });
      a("settle", { r });
    }
    for (let i = 0; i < cfg.n; i++) if (cfg.catchUpAt[i] > cfg.n) { a("approveCU", { i, r: cfg.n + 1 }); a("catchUp", { i, r: cfg.n + 1 }); }
    a("finalize");
    // optional (RECORD_HISTORY=1): write the finished circle into the factory's history before anyone
    // withdraws, and prove that recording moves no money. Off by default; it changes the approval code.
    if (process.env.RECORD_HISTORY === "1") a("recordHistory");
    for (let i = 0; i < cfg.n; i++) a("withdraw", { i });
    a("afterWithdraw");
    a("treasuryWithdraw");
    a("finalChecks");
    for (let i = 0; i < cfg.n; i++) { a("sweepQ", { i }); a("sweepGas", { i }); }
  }
  if (scenario.compareNets) acts.push({ ci: -1, kind: "compareNets" });
  acts.push({ ci: -1, kind: "report" });
  return acts;
}

function label(act, cfg, names) {
  const nm = act.i !== undefined ? names[act.i] : "";
  return {
    fundQ: `fund ${nm} QUSDC`, fundGas: `fund ${nm} gas`, create: `create ${cfg?.label}`,
    approveCol: `${nm} approves collateral`, accept: `${nm} accepts seat ${act.i + 1}`,
    approveCU: `${nm} approves catch-up`, catchUp: `${nm} catches up`,
    approvePay: `${nm} approves round ${act.r}`, pay: `${nm} pays round ${act.r}`,
    settle: `settle round ${act.r}`, finalize: `finalize ${cfg?.label}`, withdraw: `${nm} withdraws`,
    treasuryWithdraw: "treasury withdraws the fee", sweepQ: `${nm} returns QUSDC`, sweepGas: `${nm} returns gas`,
  }[act.kind] || act.kind;
}

async function writeReport(st, id, scenario, error, ctx) {
  const { ethers: E } = require("hardhat");
  const { chainId, code, factory, funder, token, csvRoot } = ctx;
  const all = st.circles.flatMap((c) => c.checks);
  const passed = all.filter((k) => k.ok).length;
  const failed = all.filter((k) => !k.ok).length + (error ? 1 : 0);
  const outcome = failed ? "FAIL" : "PASS";
  const at = new Date().toISOString();
  const report = {
    mode: "live", chainId: chainId.toString(), scenario: id, title: scenario.title, approval: code, factory: await factory.getAddress(), deployer: await factory.deployer(), funder: funder.address, outcome, error, passed, failed,
    gasUsed: st.gasUsed, feesWei: st.spent, funder_qie_before: st.funderQieBefore, funder_qie_after: (await E.provider.getBalance(funder.address)).toString(), funder_qusdc_before: st.funderQusdcBefore, funder_qusdc_after: (await token.balanceOf(funder.address)).toString(),
    circles: st.circles.map((c, k) => ({ label: c.label, circle: c.address, config: { n: scenario.circles[k].n, contribution: scenario.circles[k].c.toString(), coverBps: scenario.circles[k].k, fromPayout: scenario.circles[k].fromPayout, stopAt: scenario.circles[k].stopAt, catchUpAt: scenario.circles[k].catchUpAt, round: scenario.circles[k].round, grace: scenario.circles[k].grace, batch: !!scenario.circles[k].batch }, checks: c.checks })),
    transactions: st.txs, startedAt: st.startedAt, adoptedFrom: st.adoptedFrom || null, continuedFrom: st.continuedFrom || null, at,
  };
  fs.writeFileSync(path.join(csvRoot, "mainnet-runs", `live-S${id}-${at.replace(/[:.]/g, "-")}.json`), H.ser(report).replace(/,"/g, ',\n "') + "\n");
  for (const c of report.circles) {
    const cp = c.checks.filter((k) => k.ok).length;
    fs.appendFileSync(path.join(csvRoot, "mainnet-runs", "runner-log.csv"), [at, "live", chainId, id, c.label, c.circle, c.config.n, q(BigInt(c.config.contribution)), c.config.coverBps / 100, c.config.fromPayout ? "from-pot" : "upfront", st.txs.length, st.gasUsed, qie(BigInt(st.spent)), cp, c.checks.length - cp + (error ? 1 : 0), outcome].join(",") + "\n");
  }
  console.log(`\nScenario ${id}: ${outcome}. ${passed} checks passed, ${failed} failed. ${st.txs.length} transactions, gas ${st.gasUsed}, fees ${qie(BigInt(st.spent))} QIE.${error ? " " + error : ""}`);
  if (failed) process.exitCode = 1;
}

async function main() {
  const { simulate } = await import(path.join(H.ROOT, "app/src/sim.js"));
  const { chainId } = await ethers.provider.getNetwork();
  if (network.name !== "qieMainnet" || chainId !== H.MAINNET) throw new Error("Runs only with --network qieMainnet (chain 1990).");
  const id = Number(process.env.SCENARIO);
  if (!scenarios[id]) throw new Error("SCENARIO must be 1 to 5");
  const [funder] = await ethers.getSigners();
  const { factory, rules } = await H.verifyFactory(process.env.FACTORY);
  if (rules.token_ !== H.QUSDC) throw new Error("Factory token is not QUSDC");
  const feeBps = Number(rules.feeBps_);
  const treasury = rules.treasury_;
  const token = new ethers.Contract(H.QUSDC, [...H.ERC20, "function allowance(address,address) view returns (uint256)"], ethers.provider);
  const budgetWei = ethers.parseEther(process.env.BUDGET_QIE || "0.05");
  const reserveWei = ethers.parseEther(process.env.RESERVE_QIE || "0.02");
  const memberGas = ethers.parseEther(process.env.MEMBER_GAS_QIE || "0.003");
  const scenario = { id, ...scenarios[id] };
  const maxN = Math.max(...scenario.circles.map((c) => c.n));
  const members = H.memberWallets(MAX_MEMBERS, true);
  const names = members.map((m) => m.name);
  const code = H.approvalCode({ id, chainId, factory: await factory.getAddress(), funder: funder.address, memberAddrs: members.slice(0, maxN).map((m) => m.wallet.address), budgetWei, reserveWei, scenario: process.env.RECORD_HISTORY === "1" ? { ...scenarios[id], recordHistory: true } : scenarios[id] });
  if (process.env.APPROVE !== code) throw new Error(`Not approved. This plan's approval code is ${code}.`);

  const rctx = { chainId, code, factory, funder, token, csvRoot: H.ROOT };
  const plan = H.planScenario(simulate, scenario, feeBps, null);
  const acts = buildActions(scenario);
  fs.mkdirSync(path.join(H.ROOT, "mainnet-runs"), { recursive: true });
  const stateFile = path.join(H.ROOT, "mainnet-runs", `state-S${id}.json`);
  let st;
  if (fs.existsSync(stateFile)) st = JSON.parse(fs.readFileSync(stateFile, "utf8"));
  else {
    st = { id, code, startedAt: new Date().toISOString(), next: 0, pending: null, spent: "0", gasUsed: "0", txs: [], circles: scenario.circles.map((c) => ({ label: c.label, address: null, simIndex: 0, checks: [], startBal: null, earlier: [], earlierBefore: [] })), funderQieBefore: (await ethers.provider.getBalance(funder.address)).toString(), funderQusdcBefore: (await token.balanceOf(funder.address)).toString() };
    if (scenario.continues) {
      // finish the circle of a scenario that stopped on a refused transaction, as it now stands
      const oldFile = path.join(H.ROOT, "mainnet-runs", `state-S${scenario.continues}.json`);
      const old = JSON.parse(fs.readFileSync(oldFile, "utf8"));
      if (!old.failedAt) throw new Error(`Scenario ${scenario.continues} did not stop on a refused transaction`);
      const oldScenario = { id: scenario.continues, ...scenarios[scenario.continues] };
      const oldCode = old.code;
      await writeReport(old, scenario.continues, oldScenario, `Stopped: "${old.failedAt.label}" was refused by the contract (${old.failedAt.hash}); it was sent after the round's deadline because one-after-another transactions took longer than the 60 s round.`, { ...rctx, code: oldCode });
      process.exitCode = 0;
      fs.renameSync(oldFile, oldFile.replace(".json", `-stopped-${Date.now()}.json`));
      const failRound = buildActions(oldScenario)[old.failedAt.next].r;
      Object.assign(st, { txs: old.txs, spent: old.spent, gasUsed: old.gasUsed, funderQieBefore: old.funderQieBefore, funderQusdcBefore: old.funderQusdcBefore, continuedFrom: `S${scenario.continues} (${old.failedAt.hash})` });
      st.circles[0] = { ...old.circles[0], label: scenario.circles[0].label };
      st.next = acts.findIndex((x) => x.kind === "compareContributed" && x.r === failRound);
      log(`Continuing S${scenario.continues}'s circle ${st.circles[0].address} at step ${st.next} (state after round ${failRound}'s payments).`);
    } else if (process.env.ADOPT_LOG) {
      // continue an interrupted mainnet-test-runner run: every step in its log is already done
      const lines = fs.readFileSync(process.env.ADOPT_LOG, "utf8").split("\n");
      const sent = lines.map((l) => l.match(/^  (.+?): (0x[0-9a-f]{64}) gas/)).filter(Boolean).map((m) => ({ label: m[1], hash: m[2] }));
      const circleLine = lines.find((l) => /^  circle 0x/.test(l));
      st.circles[0].address = circleLine.trim().split(" ")[1];
      st.circles[0].checks = lines.filter((l) => /^  (PASS|FAIL) /.test(l)).map((l) => ({ name: l.trim().replace(/^(PASS|FAIL) /, ""), ok: l.includes("PASS") }));
      for (const s of sent) {
        const rc = await ethers.provider.getTransactionReceipt(s.hash);
        if (!rc || rc.status !== 1) throw new Error(`Adopted transaction ${s.hash} is not confirmed successfully`);
        const fee = rc.gasUsed * rc.gasPrice;
        st.spent = (BigInt(st.spent) + fee).toString();
        st.gasUsed = (BigInt(st.gasUsed) + rc.gasUsed).toString();
        st.txs.push({ label: s.label, from: rc.from, hash: s.hash, block: rc.blockNumber, gasEstimate: null, gasUsed: rc.gasUsed.toString(), gasPrice: rc.gasPrice.toString(), feeWei: fee.toString(), cumulativeWei: st.spent, events: [], adopted: true });
      }
      // find where to continue: right after the action of the last adopted transaction
      const cfg = scenario.circles[0];
      const norm = (x) => x.replace(/ [0-9.]+/g, "");
      let k = 0;
      let compares = 0;
      for (const s of sent) {
        while (k < acts.length && norm(label(acts[k], cfg, names)) !== norm(s.label)) {
          if (acts[k].kind === "compareContributed") compares++;
          k++;
        }
        if (k >= acts.length) throw new Error(`Could not place adopted step "${s.label}"`);
        if (["settle", "catchUp", "finalize"].includes(acts[k].kind)) compares++;
        k++;
      }
      st.next = k;
      st.circles[0].simIndex = compares;
      // the members started from zero and were funded exactly the planned amounts
      st.circles[0].startBal = plan.circles[0].fund.map(String);
      st.adoptedFrom = path.basename(process.env.ADOPT_LOG);
      log(`Adopted ${sent.length} confirmed transactions from ${st.adoptedFrom}; continuing at step ${k} (${acts[k].kind}), ${compares} state comparisons already done.`);
    }
    fs.writeFileSync(stateFile, H.ser(st));
  }
  const save = () => fs.writeFileSync(stateFile, H.ser(st));

  // one transaction, resumable: a pending hash from an earlier invocation is waited for, not re-sent
  async function sendTx(act, lbl, signer, contract, method, args = [], value = 0n) {
    let hash = st.pending && st.pending.next === st.next ? st.pending.hash : null;
    let est = null;
    if (!hash) {
      est = method === "__transfer" ? 21000n : await contract.connect(signer)[method].estimateGas(...args, value ? { value } : {});
      const price = (await ethers.provider.getFeeData()).gasPrice;
      const worst = ((est * 13n) / 10n) * price;
      if (BigInt(st.spent) + worst > budgetWei) throw new Error(`BUDGET STOP before "${lbl}"`);
      if (signer.address === funder.address && (await ethers.provider.getBalance(funder.address)) - worst - value < reserveWei) throw new Error(`RESERVE STOP before "${lbl}"`);
      let tx;
      try {
        tx = method === "__transfer" ? await signer.sendTransaction({ to: args[0], value, gasLimit: 21000n }) : await contract.connect(signer)[method](...args, { ...(value ? { value } : {}), gasLimit: (est * 13n) / 10n });
      } catch (e) {
        throw new Error(`"${lbl}" was not sent (${e.shortMessage || e.message}).`);
      }
      hash = tx.hash;
      st.pending = { next: st.next, hash, label: lbl, est: est.toString() };
      save();
    } else log(`  resuming: waiting for ${lbl} ${hash}`);
    let rc = null;
    for (const until = Date.now() + Math.max(20000, timeLeft()); !rc && Date.now() < until; ) {
      rc = await ethers.provider.getTransactionReceipt(hash);
      if (!rc) await H.sleep(2000);
    }
    if (!rc) throw new Error(`"${lbl}" ${hash} not confirmed yet; run again to keep waiting (it will not be re-sent).`);
    const fee = rc.gasUsed * rc.gasPrice;
    if (rc.status !== 1) {
      st.spent = (BigInt(st.spent) + fee).toString();
      st.gasUsed = (BigInt(st.gasUsed) + rc.gasUsed).toString();
      st.txs.push({ label: lbl, from: rc.from, hash, block: rc.blockNumber, gasEstimate: st.pending.est, gasUsed: rc.gasUsed.toString(), gasPrice: rc.gasPrice.toString(), feeWei: fee.toString(), cumulativeWei: st.spent, status: "reverted", events: [] });
      st.pending = null;
      st.failedAt = { next: st.next, label: lbl, hash };
      save();
      throw new Error(`"${lbl}" reverted: ${hash}`);
    }
    st.spent = (BigInt(st.spent) + fee).toString();
    st.gasUsed = (BigInt(st.gasUsed) + rc.gasUsed).toString();
    const events = [];
    for (const l of rc.logs) {
      try {
        const e = contract.interface.parseLog(l);
        if (e) events.push(`${e.name}(${e.args.map((x) => (typeof x === "bigint" ? x.toString() : String(x))).join(",")})`);
      } catch {}
    }
    st.txs.push({ label: lbl, from: rc.from, hash, block: rc.blockNumber, gasEstimate: st.pending.est, gasUsed: rc.gasUsed.toString(), gasPrice: rc.gasPrice.toString(), feeWei: fee.toString(), cumulativeWei: st.spent, events });
    st.pending = null;
    log(`  ${lbl}: ${hash} gas ${rc.gasUsed} fee ${qie(fee)} QIE, total ${qie(BigInt(st.spent))} QIE`);
    return rc;
  }

  // several transactions from different wallets, sent without waiting for each other; resumable
  async function sendMany(items) {
    st.batch = st.batch && st.batch.next === st.next ? st.batch : { next: st.next, hashes: {} };
    for (const it of items) {
      if (st.batch.hashes[it.key]) continue;
      const est = await it.contract.connect(it.signer)[it.method].estimateGas(...it.args);
      const price = (await ethers.provider.getFeeData()).gasPrice;
      if (BigInt(st.spent) + ((est * 13n) / 10n) * price * BigInt(items.length) > budgetWei) throw new Error(`BUDGET STOP before "${it.lbl}"`);
      let tx;
      try { tx = await it.contract.connect(it.signer)[it.method](...it.args, { gasLimit: (est * 13n) / 10n }); } catch (e) { save(); throw new Error(`"${it.lbl}" was not sent (${e.shortMessage || e.message}).`); }
      st.batch.hashes[it.key] = { hash: tx.hash, lbl: it.lbl, est: est.toString(), contract: it.contract === token ? "token" : "circle" };
      save();
    }
    for (const it of items) {
      const b = st.batch.hashes[it.key];
      if (b.done) continue;
      let rc = null;
      for (const until = Date.now() + Math.max(20000, timeLeft()); !rc && Date.now() < until; ) {
        rc = await ethers.provider.getTransactionReceipt(b.hash);
        if (!rc) await H.sleep(2000);
      }
      if (!rc) throw new Error(`"${b.lbl}" ${b.hash} not confirmed yet; run again to keep waiting (it will not be re-sent).`);
      const fee = rc.gasUsed * rc.gasPrice;
      st.spent = (BigInt(st.spent) + fee).toString();
      st.gasUsed = (BigInt(st.gasUsed) + rc.gasUsed).toString();
      st.txs.push({ label: b.lbl, from: rc.from, hash: b.hash, block: rc.blockNumber, gasEstimate: b.est, gasUsed: rc.gasUsed.toString(), gasPrice: rc.gasPrice.toString(), feeWei: fee.toString(), cumulativeWei: st.spent, status: rc.status === 1 ? "ok" : "reverted", parallel: true, events: [] });
      b.done = true;
      save();
      if (rc.status !== 1) throw new Error(`"${b.lbl}" reverted: ${b.hash}`);
      log(`  ${b.lbl}: ${b.hash} gas ${rc.gasUsed} fee ${qie(fee)} QIE, total ${qie(BigInt(st.spent))} QIE (parallel)`);
    }
    st.batch = null;
  }

  const waitOk = async (ts) => {
    const now = (await ethers.provider.getBlock("latest")).timestamp;
    if (now >= ts) return true;
    if ((ts - now) * 1000 + 15000 > timeLeft()) return false;
    while ((await ethers.provider.getBlock("latest")).timestamp < ts) await H.sleep(4000);
    return true;
  };

  while (st.next < acts.length) {
    const nextKind = acts[st.next].kind;
    const roundStarts = nextKind === "settle" && acts[st.next].r < (scenario.circles[acts[st.next].ci] || {}).n;
    if (timeLeft() < 25000 || (roundStarts && timeLeft() < 80000)) {
      save();
      log(`CONTINUE: paused before step ${st.next} of ${acts.length} (${acts[st.next].kind}). Run the same command again.`);
      return;
    }
    const act = acts[st.next];
    const cfg = scenario.circles[act.ci];
    const C = st.circles[act.ci];
    const pc = plan.circles[act.ci];
    const m = act.i !== undefined ? members[act.i] : null;
    const circle = C && C.address ? await ethers.getContractAt("SavingsCircle", C.address) : null;
    const check = (name, ok, detail = "") => {
      C.checks.push({ name, ok, detail });
      log(`  ${ok ? "PASS" : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
    };
    const compare = async (step, extra = {}) => {
      const chain = await H.snapshot(circle, cfg.n, members, treasury, feeBps, step, extra);
      const want = pc.sim.trace[C.simIndex];
      C.simIndex++;
      if (!(want && H.ser(want) === H.ser(chain))) check(`state after ${step} (round ${chain.round}) matches the simulator`, false, `expected ${H.ser(want)} got ${H.ser(chain)}`.slice(0, 400));
    };
    const lbl = label(act, cfg, names);
    switch (act.kind) {
      case "checkClean": {
        log(`\n${cfg.label}: ${cfg.n} members, ${q(cfg.c)} QUSDC per round, ${cfg.k / 100}% cover, collateral ${cfg.fromPayout ? "from the pot" : "up front"}`);
        for (let i = 0; i < cfg.n; i++) if ((await token.balanceOf(members[i].wallet.address)) !== 0n) throw new Error(`${names[i]} already holds QUSDC; sweep first.`);
        C.earlier = [...(await factory.circlesPage(0, 100))];
        C.earlierBefore = (await Promise.all(C.earlier.map((a) => token.balanceOf(a)))).map(String);
        break;
      }
      case "fundQ": if (pc.fund[act.i] > 0n) await sendTx(act, `fund ${m.name} ${q(pc.fund[act.i])} QUSDC`, funder, token, "transfer", [m.wallet.address, pc.fund[act.i]]); break;
      case "fundGas": await sendTx(act, lbl, funder, funder, "__transfer", [m.wallet.address], memberGas); break;
      case "recordStart": C.startBal = (await Promise.all(members.slice(0, cfg.n).map((x) => token.balanceOf(x.wallet.address)))).map(String); break;
      case "create": {
        const rc = await sendTx(act, lbl, funder, factory, "createCircle", [`PotLoop test ${cfg.label} ${new Date().toISOString().slice(0, 16)}`, members.slice(0, cfg.n).map((x) => x.wallet.address), cfg.c, cfg.k, cfg.round, cfg.grace, cfg.join, cfg.fromPayout]);
        const ev = rc.logs.map((l) => { try { return factory.interface.parseLog(l); } catch { return null; } }).find((e) => e && e.name === "CircleCreated");
        C.address = ev.args.circle;
        log(`  circle ${C.address}`);
        check("factory registered the new circle", await factory.isCircle(C.address));
        check("circle is new (not one of the earlier circles)", !C.earlier.includes(C.address));
        break;
      }
      case "approveCol": { const up = await circle.upfrontCollateral(act.i); if (up > 0n) await sendTx(act, `${m.name} approves ${q(up)} collateral`, m.wallet, token, "approve", [C.address, up]); break; }
      case "accept": if (!(await circle.member(act.i)).accepted) await sendTx(act, lbl, m.wallet, circle, "accept"); break;
      case "approveCU": if ((await circle.member(act.i)).status === 2n) { const [t] = await circle.catchUpCost(act.i); if ((await token.allowance(m.wallet.address, C.address)) < t) await sendTx(act, `${m.name} approves catch-up ${q(t)}`, m.wallet, token, "approve", [C.address, t]); } break;
      case "catchUp": {
        if ((await circle.member(act.i)).status !== 2n) break;
        const [total, currentPart, lateFee] = await circle.catchUpCost(act.i);
        await sendTx(act, lbl, m.wallet, circle, "catchUp");
        await compare("catchUp", { member: act.i, cost: { total, currentPart, lateFee } });
        break;
      }
      case "approvePay": if (!(await circle.contributed(act.r, act.i)) && (await circle.member(act.i)).status !== 1n) await sendTx(act, lbl, m.wallet, token, "approve", [C.address, cfg.c]); break;
      case "pay": if (!(await circle.contributed(act.r, act.i)) && (await circle.member(act.i)).status !== 1n) await sendTx(act, lbl, m.wallet, circle, "contribute"); break;
      case "payBatch": {
        // every payer's approval, then every payer's payment, each phase sent in parallel (different wallets)
        const payers = [];
        for (const i of act.payers) if (!(await circle.contributed(act.r, i)) && (await circle.member(i)).status !== 1n) payers.push(i);
        const lacking = [];
        for (const i of payers) if ((await token.allowance(members[i].wallet.address, C.address)) < cfg.c) lacking.push(i);
        await sendMany(lacking.map((i) => ({ key: `a${act.r}-${i}`, lbl: `${names[i]} approves round ${act.r}`, signer: members[i].wallet, contract: token, method: "approve", args: [C.address, cfg.c] })));
        await sendMany(payers.map((i) => ({ key: `p${act.r}-${i}`, lbl: `${names[i]} pays round ${act.r}`, signer: members[i].wallet, contract: circle, method: "contribute", args: [] })));
        break;
      }
      case "compareContributed": await compare("contributed"); break;
      case "settle": {
        let allPaid = true;
        for (let i = 0; i < cfg.n; i++) if ((await circle.member(i)).status !== 1n && !(await circle.contributed(act.r, i))) allPaid = false;
        if (!allPaid && !(await waitOk(Number(await circle.deadline()) + cfg.grace + 1))) { save(); log(`CONTINUE: waiting for round ${act.r}'s deadline. Run again.`); return; }
        await sendTx(act, lbl, funder, circle, "settle");
        await compare("settle");
        break;
      }
      case "finalize": {
        if (!(await waitOk(Number(await circle.finalizeAfter()) + 1))) { save(); log("CONTINUE: waiting for the cure window to end. Run again."); return; }
        await sendTx(act, lbl, funder, circle, "finalize");
        await compare("finalize");
        check("every state change matched the simulator exactly (base units)", C.checks.every((k) => k.ok || !k.name.startsWith("state after")) && C.simIndex === pc.sim.trace.length);
        break;
      }
      case "recordHistory": {
        // expected outcome per seat from the scenario itself: 2 = left before their turn, 1 = caught up, 3 = walked away, 0 = completed
        const expectOutcome = (i) => (!cfg.stopAt[i] ? 0n : cfg.stopAt[i] <= i + 1 ? 2n : cfg.catchUpAt[i] ? 1n : 3n);
        const pot = BigInt(cfg.n) * cfg.c;
        const addrs = members.slice(0, cfg.n).map((x) => x.wallet.address);
        if (!C.histBefore) {
          C.histBefore = (await Promise.all(addrs.map((a) => factory.history(a)))).map((h) => [h.completed, h.caughtUp, h.leftEarly, h.walkedAway, h.volume].map(String));
          C.moneyBefore = (await Promise.all(addrs.map(async (a) => [await circle.withdrawable(a), await token.balanceOf(a)]))).map((x) => x.map(String));
          save();
        }
        await sendTx(act, `record ${cfg.label} results`, funder, factory, "recordCircle", [C.address]);
        check("factory marks the circle as recorded", await factory.recorded(C.address));
        for (let i = 0; i < cfg.n; i++) {
          const h = await factory.history(addrs[i]);
          const want = C.histBefore[i].map(BigInt);
          want[Number(expectOutcome(i))] += 1n;
          if (expectOutcome(i) <= 1n) want[4] += pot;
          const got = [h.completed, h.caughtUp, h.leftEarly, h.walkedAway, h.volume];
          check(`${names[i]}: history moved by exactly one ${["completed", "caught up", "left early", "walked away"][Number(expectOutcome(i))]}${expectOutcome(i) <= 1n ? ` and ${q(pot)} QUSDC volume` : ""}`, got.every((v, j) => v === want[j]) && (await circle.outcomeOf(i)) === expectOutcome(i));
        }
        let again = false;
        try { await factory.connect(funder).recordCircle.staticCall(C.address); } catch (e) { again = factory.interface.parseError(e.data || "0x")?.name === "AlreadyRecorded"; }
        check("recording the same circle again reverts with AlreadyRecorded", again);
        const after = (await Promise.all(addrs.map(async (a) => [await circle.withdrawable(a), await token.balanceOf(a)]))).map((x) => x.map(String));
        check("recording changed no entitlement and no wallet balance", JSON.stringify(after) === JSON.stringify(C.moneyBefore));
        break;
      }
      case "withdraw": if ((await circle.withdrawable(m.wallet.address)) > 0n) await sendTx(act, lbl, m.wallet, circle, "withdraw"); break;
      case "afterWithdraw": {
        let twice = true;
        for (let i = 0; i < cfg.n; i++) {
          try { await circle.connect(members[i].wallet).withdraw.staticCall(); twice = false; } catch (e) { if (circle.interface.parseError(e.data || "0x")?.name !== "NothingToWithdraw") twice = false; }
        }
        check("no member can withdraw a second time (reverts with NothingToWithdraw)", twice);
        C.treasuryOwed = (feeBps > 0 ? await circle.withdrawable(treasury) : 0n).toString();
        check("treasury fee equals the simulator's", BigInt(C.treasuryOwed) === pc.sim.treasury, `${q(BigInt(C.treasuryOwed))} QUSDC`);
        break;
      }
      case "treasuryWithdraw": {
        const owed = await circle.withdrawable(treasury);
        if (owed > 0n && treasury === funder.address) {
          const before = await token.balanceOf(treasury);
          await sendTx(act, lbl, funder, circle, "withdraw");
          C.treasuryGot = ((await token.balanceOf(treasury)) - before).toString();
        } else if (C.treasuryGot === undefined) C.treasuryGot = "0";
        break;
      }
      case "finalChecks": {
        for (let i = 0; i < cfg.n; i++) {
          const delta = (await token.balanceOf(members[i].wallet.address)) - BigInt(C.startBal[i]);
          check(`${names[i]}: wallet change equals the simulator's net`, delta === pc.sim.members[i].net, `${q(delta)} QUSDC`);
        }
        check("treasury received exactly the fee", BigInt(C.treasuryGot) === pc.sim.treasury, `${q(BigInt(C.treasuryGot))} QUSDC`);
        const left = await token.balanceOf(C.address);
        check("circle holds nothing after everyone withdrew", left === 0n, `${q(left)} QUSDC left`);
        const after = await Promise.all(C.earlier.map((a) => token.balanceOf(a)));
        check("every other circle's balance is unchanged", C.earlier.every((_, j) => after[j] === BigInt(C.earlierBefore[j])), `${C.earlier.length} earlier circles`);
        break;
      }
      case "sweepQ": { const b = await token.balanceOf(m.wallet.address); if (b > 0n) await sendTx(act, `${m.name} returns ${q(b)} QUSDC`, m.wallet, token, "transfer", [funder.address, b]); break; }
      case "sweepGas": {
        const price = (await ethers.provider.getFeeData()).gasPrice;
        const keep = 21000n * price * 2n;
        const g = await ethers.provider.getBalance(m.wallet.address);
        if (g > keep) await sendTx(act, lbl, m.wallet, m.wallet, "__transfer", [funder.address], g - keep);
        break;
      }
      case "compareNets": {
        const [a, b] = scenario.compareNets.map((l) => scenario.circles.findIndex((c) => c.label === l));
        const same = H.ser(plan.circles[a].sim.members.map((x) => x.net)) === H.ser(plan.circles[b].sim.members.map((x) => x.net));
        // the on-chain nets were each checked against these simulator nets in finalChecks
        const onchainOk = st.circles[a].checks.concat(st.circles[b].checks).filter((k) => k.name.includes("wallet change")).every((k) => k.ok);
        st.circles[b].checks.push({ name: `${scenario.compareNets[0]} and ${scenario.compareNets[1]}: every member's net result is identical on chain`, ok: same && onchainOk });
        log(`  ${same && onchainOk ? "PASS" : "FAIL"} ${scenario.compareNets.join(" and ")}: every member's net result is identical on chain`);
        break;
      }
      case "report": await writeReport(st, id, scenario, null, rctx); break;
    }
    st.next++;
    save();
  }
  fs.renameSync(stateFile, stateFile.replace(".json", `-done-${Date.now()}.json`));
  log("SCENARIO COMPLETE");
}

main().catch((e) => {
  console.error(`STOPPED: ${e.message || e}`);
  process.exitCode = 1;
});
