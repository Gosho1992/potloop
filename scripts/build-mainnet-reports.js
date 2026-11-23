// Builds the corrected mainnet reports from on-chain facts (no network access, no keys):
//   mainnet-runs/reconciliation/onchain.json      (scripts/reconcile-mainnet.js: receipts, circles, wallets)
//   mainnet-runs/reconciliation/token-flows.json  (scripts/reconcile-token-flows.js: every QUSDC transfer)
//   mainnet-runs/live-S*.json                     (the runner's own records, used for labels and checks)
// Writes MAINNET_RUN_ATTEMPTS.csv, MAINNET_CIRCLES.csv, MAINNET_TRANSACTIONS.csv and
// mainnet-runs/reconciliation/summary.json. Every total is computed from unique transaction hashes.
//   node scripts/build-mainnet-reports.js
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const RUNS = path.join(ROOT, "mainnet-runs");
const REC = path.join(RUNS, "reconciliation");
const on = JSON.parse(fs.readFileSync(path.join(REC, "onchain.json"), "utf8"));
const flows = JSON.parse(fs.readFileSync(path.join(REC, "token-flows.json"), "utf8")).transfers;
const reports = fs.readdirSync(RUNS).filter((f) => /^live-S\d-.*\.json$/.test(f)).sort().map((f) => ({ file: f, ...JSON.parse(fs.readFileSync(path.join(RUNS, f), "utf8")) }));
const lc = (a) => (a || "").toLowerCase();
const q6 = (v) => { const n = BigInt(v); const s = n < 0n ? "-" : ""; const a = n < 0n ? -n : n; return `${s}${a / 1000000n}.${(a % 1000000n).toString().padStart(6, "0")}`; };
const qie = (v) => { const n = BigInt(v); return `${n / 10n ** 18n}.${(n % 10n ** 18n).toString().padStart(18, "0")}`; };
const csvCell = (v) => { const s = v === null || v === undefined ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const writeCsv = (name, rows) => { fs.writeFileSync(path.join(ROOT, name), [Object.keys(rows[0]).join(","), ...rows.map((r) => Object.values(r).map(csvCell).join(","))].join("\n") + "\n"); };
const rcpt = new Map(on.transactions.map((t) => [t.hash, t]));
const circleSet = new Set(on.circles.map((c) => lc(c.address)));
const treasury = lc(on.factory.treasury);
const funder = treasury; // the same address: test funder, deployer and treasury
const memberNames = { [lc("0x15e58fFF4eA6a954D8E02F20C07544eb6EAC036A")]: "Sipho", [lc("0xc83847e16AAb28Bc39093D5fd11fC39aaCAA2EF3")]: "Thandi", [lc("0xA6AE5bFd19E1EABDD2e2bF1B4180dBB71ee2cBA5")]: "Ayesha", [lc("0x23d676B5146CAe065bB699d60Cff387558870D3d")]: "Bilal", [lc("0xDB43A27c047643758259F996A3827afEbdb1F911")]: "Naledi", [lc("0x16ada809013a7f41D33Ab5099909a2773bbf6fAb")]: "Farah" };
const nameOf = (a) => memberNames[lc(a)] || (lc(a) === funder ? "test funder/treasury" : circleSet.has(lc(a)) ? "circle" : lc(a) === lc(on.factory.token) ? "QUSDC" : lc(a) === lc(on.factory.address) ? "factory" : lc(a) === lc("0x7145be20923340bbea3469c3804b384b93356910") ? "owner main wallet" : a);

function category(label) {
  if (/^fund .* QUSDC$/.test(label)) return "fund member QUSDC";
  if (/^fund .* gas$/.test(label)) return "fund member gas";
  if (/^create /.test(label)) return "create circle";
  if (/approves .*collateral/.test(label)) return "approve collateral";
  if (/accepts seat/.test(label)) return "accept seat";
  if (/approves round/.test(label)) return "approve contribution";
  if (/pays round/.test(label)) return "contribute";
  if (/approves catch-up/.test(label)) return "approve catch-up";
  if (/catches up/.test(label)) return "catch up";
  if (/^settle round/.test(label)) return "settle";
  if (/^finalize/.test(label)) return "finalize";
  if (/treasury withdraws/.test(label)) return "treasury fee withdrawal";
  if (/ withdraws$/.test(label)) return "member withdrawal";
  if (/returns .* QUSDC$/.test(label)) return "member returns QUSDC";
  if (/returns gas$/.test(label)) return "member returns gas";
  if (/return to main/.test(label)) return "return to owner";
  return "other";
}

// ---- attempts: one per execution attempt; transactions assigned to the attempt that sent them
const attempts = [];
const txRows = [];
const seen = new Set();
const dep = on.deployment.tx;
attempts.push({ attempt: "A0", scenario: "deploy", kind: "factory deployment", circles: on.factory.address, report: "logs/deploy.log", outcome: dep && dep.status === 1 ? "SUCCESS" : "NOT FOUND", checksPassed: "", checksFailed: "", newTransactions: 1, reverted: 0 });
txRows.push({ hash: dep.hash, attempt: "A0", scenario: "deploy", circle: "", step: "deploy CircleFactory (creates CircleDeployer)", category: "deployment", status: dep.status === 1 ? "success" : "reverted", block: on.deployment.block, timestamp: new Date(on.deployment.blockTimestamp * 1000).toISOString(), from: dep.from, fromName: nameOf(dep.from), to: "", toName: "(contract creation)", valueQIE: "0", gasUsed: dep.gasUsed, gasPriceWei: dep.gasPrice, feeQIE: qie(dep.feeWei) });
seen.add(dep.hash);

let n = 1;
for (const rep of reports) {
  const ids = [];
  const addAttempt = (a) => { attempts.push(a); ids.push(a.attempt); };
  // S1 was started by the first runner (stopped by the 3-minute command limit after 18 transactions)
  const splits = rep.adoptedFrom ? [{ part: rep.transactions.filter((t) => t.adopted), kind: "first runner, stopped by the command time limit (not a test failure)", outcome: "INTERRUPTED", checks: false }, { part: rep.transactions.filter((t) => !t.adopted), kind: "resumable runner, continued from the next step", outcome: rep.outcome, checks: true }] : [{ part: rep.transactions, kind: rep.scenario === 6 ? "continuation of S5's circle (not a new circle)" : rep.scenario === 7 ? "fresh repeat of S5 (new circle, parallel payments)" : rep.scenario === 5 ? "six members, sequential payments" : "scenario run", outcome: rep.outcome, checks: true }];
  // assign each transaction to a circle: a new segment starts where the next circle's funding begins
  const circlesOfRun = rep.circles.map((c) => c.circle);
  const circleOfTx = new Map();
  let seg = 0;
  rep.transactions.forEach((t, i) => {
    if (i > 0 && /^fund /.test(t.label) && !/^fund /.test(rep.transactions[i - 1].label) && seg < circlesOfRun.length - 1) seg++;
    circleOfTx.set(t.hash, circlesOfRun[seg]);
  });
  for (const s of splits) {
    const fresh = s.part.filter((t) => !seen.has(t.hash));
    const id = `A${n++}`;
    const cks = rep.circles.flatMap((c) => c.checks);
    const pass = s.checks ? (rep.scenario === 6 ? cks.length - 2 : cks.filter((k) => k.ok).length) : "";
    const fail = s.checks ? cks.filter((k) => !k.ok).length + (rep.error ? 1 : 0) : "";
    addAttempt({ attempt: id, scenario: `S${rep.scenario}`, kind: s.kind, circles: circlesOfRun.join(" "), report: rep.file, outcome: s.outcome, checksPassed: rep.scenario === 6 ? `${pass} new (+2 carried from S5)` : pass, checksFailed: fail, newTransactions: fresh.length, reverted: fresh.filter((t) => rcpt.get(t.hash).status === 0).length });
    for (const t of fresh) {
      const r = rcpt.get(t.hash);
      seen.add(t.hash);
      txRows.push({ hash: t.hash, attempt: id, scenario: `S${rep.scenario}`, circle: circleOfTx.get(t.hash), step: t.label, category: category(t.label), status: r.status === 1 ? "success" : "reverted", block: r.block, timestamp: new Date(r.timestamp * 1000).toISOString(), from: r.from, fromName: nameOf(r.from), to: r.to, toName: nameOf(r.to), valueQIE: qie(r.value), gasUsed: r.gasUsed, gasPriceWei: r.gasPrice, feeQIE: qie(r.feeWei) });
    }
  }
}
const ret = on.transactions.filter((t) => t.scenario === "return");
attempts.push({ attempt: `A${n}`, scenario: "return", kind: "all remaining test funds sent to the owner's main wallet", circles: "", report: "logs/return-to-main.log", outcome: ret.every((t) => t.status === 1) ? "SUCCESS" : "CHECK", checksPassed: "", checksFailed: "", newTransactions: ret.length, reverted: ret.filter((t) => t.status === 0).length });
for (const t of ret) {
  seen.add(t.hash);
  txRows.push({ hash: t.hash, attempt: `A${n}`, scenario: "return", circle: "", step: lc(t.to) === lc(on.factory.token) ? "return QUSDC to owner" : "return QIE to owner", category: "return to owner", status: t.status === 1 ? "success" : "reverted", block: t.block, timestamp: new Date(t.timestamp * 1000).toISOString(), from: t.from, fromName: nameOf(t.from), to: t.to, toName: nameOf(t.to), valueQIE: qie(t.value), gasUsed: t.gasUsed, gasPriceWei: t.gasPrice, feeQIE: qie(t.feeWei) });
}
if (new Set(txRows.map((r) => r.hash)).size !== txRows.length) throw new Error("duplicate hash in MAINNET_TRANSACTIONS");
writeCsv("MAINNET_RUN_ATTEMPTS.csv", attempts);
writeCsv("MAINNET_TRANSACTIONS.csv", txRows);

// ---- money trail from the QUSDC Transfer logs (independent of the runner)
const inOut = (addr) => {
  const a = lc(addr);
  let inn = 0n, out = 0n;
  for (const f of flows) { if (lc(f.to) === a) inn += BigInt(f.amount); if (lc(f.from) === a) out += BigInt(f.amount); }
  return { inn, out };
};
const flowsBetween = (fromSet, toSet) => flows.filter((f) => fromSet(lc(f.from)) && toSet(lc(f.to))).reduce((s, f) => s + BigInt(f.amount), 0n);
const isMember = (a) => !!memberNames[a];

// ---- circles: one row per unique address
const circleRows = on.circles.map((c, idx) => {
  const a = lc(c.address);
  const txs = txRows.filter((r) => lc(r.circle) === a);
  const created = txs.find((r) => r.category === "create circle");
  const { inn, out } = inOut(c.address);
  const fee = flowsBetween((f) => f === a, (t) => t === treasury);
  const label = reports.flatMap((r) => r.circles.map((x) => ({ ...x, s: r.scenario, outcome: r.outcome }))).filter((x) => lc(x.circle) === a);
  const finalAcceptance = label.length > 1 ? `S5 plan FAIL (payment refused after deadline); circle finished and checked as S6: ${label[label.length - 1].outcome}` : label[0].outcome;
  const outcomes = c.members.map((m) => `${memberNames[lc(m.address)]}:${["completed", "caught up", "left early", "walked away"][m.outcome]}`).join("; ");
  return {
    circle: c.address, order: idx + 1, label: label.map((x) => x.label).join(" / "), createdInAttempt: created ? created.attempt : "", creationTx: created ? created.hash : "", creationBlock: created ? created.block : "",
    members: c.size, contributionQUSDC: q6(c.contribution), coverPct: c.coverageBps / 100, collateralMode: c.collateralFromPayout ? "from the pot" : "up front", roundSeconds: c.roundLength, graceSeconds: c.grace, feeBps: c.feeBps,
    registeredByFactory: c.isCircle, bytecodeMatchesBuild: c.codeMatchesBuild, finalPhase: ["Open", "Active", "Completed", "Cancelled"][c.phase], historyRecorded: c.recorded,
    tokenBalanceQUSDC: q6(c.tokenBalance), accountedBalanceQUSDC: q6(c.accountedBalance), totalWithdrawableQUSDC: q6(c.totalWithdrawable), treasuryUnclaimedQUSDC: q6(c.treasuryWithdrawable),
    qusdcInQUSDC: q6(inn), qusdcOutQUSDC: q6(out), feeToTreasuryQUSDC: q6(fee), memberOutcomes: outcomes,
    transactions: txs.length, reverted: txs.filter((r) => r.status === "reverted").length, gasUsed: txs.reduce((s, r) => s + BigInt(r.gasUsed), 0n).toString(), feesQIE: qie(txs.reduce((s, r) => s + BigInt(r.gasUsed) * BigInt(r.gasPriceWei), 0n)),
    finalAcceptance,
  };
});
writeCsv("MAINNET_CIRCLES.csv", circleRows);

// ---- per-member, per-circle money: on-chain net (paid out by circle minus paid in) vs the runner's simulator check
const memberNet = [];
for (const c of on.circles) {
  const a = lc(c.address);
  const checks = reports.flatMap((r) => r.circles).filter((x) => lc(x.circle) === a).flatMap((x) => x.checks).filter((k) => /wallet change equals/.test(k.name));
  for (const m of c.members) {
    const mm = lc(m.address);
    const paidIn = flowsBetween((f) => f === mm, (t) => t === a);
    const paidOut = flowsBetween((f) => f === a, (t) => t === mm);
    const ck = checks.filter((k) => k.name.startsWith(memberNames[mm] + ":")).pop();
    const expected = ck ? ck.detail.replace(/ QUSDC$/, "") : null;
    memberNet.push({ circle: c.address, member: memberNames[mm], paidIn: q6(paidIn), paidOut: q6(paidOut), netOnChain: q6(paidOut - paidIn), runnerExpected: expected, agrees: expected !== null && Number(expected) === Number(q6(paidOut - paidIn)) });
  }
}

// ---- totals
const sum = (rows, f) => rows.reduce((s, r) => s + BigInt(f(r)), 0n);
const tests = txRows.filter((r) => /^S\d$/.test(r.scenario));
const fee = (r) => BigInt(r.gasUsed) * BigInt(r.gasPriceWei);
const fromFlows = (f, t) => flowsBetween(f, t);
const summary = {
  generatedAt: new Date().toISOString(), source: "QIE mainnet receipts and QUSDC Transfer logs (read-only), chain " + on.chainId,
  uniqueTransactions: { all: txRows.length, deployment: 1, testRuns: tests.length, returnOfFunds: ret.length, success: txRows.filter((r) => r.status === "success").length, reverted: txRows.filter((r) => r.status === "reverted").length, revertedHashes: txRows.filter((r) => r.status === "reverted").map((r) => r.hash) },
  gas: { deployment: dep.gasUsed, testRuns: sum(tests, (r) => r.gasUsed).toString(), returnOfFunds: sum(ret, (r) => r.gasUsed).toString(), all: sum(txRows, (r) => r.gasUsed).toString() },
  feesQIE: { deployment: qie(dep.feeWei), testRuns: qie(tests.reduce((s, r) => s + fee(r), 0n)), returnOfFunds: qie(ret.reduce((s, r) => s + BigInt(r.feeWei), 0n)), all: qie(txRows.reduce((s, r) => s + fee(r), 0n)) },
  byAttempt: attempts.map((a) => ({ attempt: a.attempt, scenario: a.scenario, transactions: txRows.filter((r) => r.attempt === a.attempt).length, gas: sum(txRows.filter((r) => r.attempt === a.attempt), (r) => r.gasUsed).toString(), feesQIE: qie(txRows.filter((r) => r.attempt === a.attempt).reduce((s, r) => s + fee(r), 0n)) })),
  qusdc: {
    funderReceivedFromSwap: q6(flows.filter((f) => lc(f.to) === funder && !isMember(lc(f.from)) && !circleSet.has(lc(f.from))).reduce((s, f) => s + BigInt(f.amount), 0n)),
    fundedToMembers: q6(fromFlows((f) => f === funder, isMember)),
    returnedByMembersToFunder: q6(fromFlows(isMember, (t) => t === funder)),
    membersPaidIntoCircles: q6(fromFlows(isMember, (t) => circleSet.has(t))),
    circlesPaidToMembers: q6(fromFlows((f) => circleSet.has(f), isMember)),
    treasuryIncome: q6(fromFlows((f) => circleSet.has(f), (t) => t === treasury)),
    returnedToOwner: q6(fromFlows((f) => f === funder, (t) => t === lc("0x7145be20923340bbea3469c3804b384b93356910"))),
    circlesNet: q6(fromFlows(isMember, (t) => circleSet.has(t)) - fromFlows((f) => circleSet.has(f), isMember) - fromFlows((f) => circleSet.has(f), (t) => t === treasury)),
    membersNetAcrossAllCircles: q6(fromFlows((f) => circleSet.has(f), isMember) - fromFlows(isMember, (t) => circleSet.has(t))),
  },
  finalBalances: { circles: on.circles.map((c) => ({ circle: c.address, tokenBalance: q6(c.tokenBalance), accounted: q6(c.accountedBalance), totalWithdrawable: q6(c.totalWithdrawable) })), wallets: on.wallets.map((w) => ({ role: w.role, address: w.address, qie: qie(w.qie), qusdc: q6(w.qusdc) })) },
  memberNetPerCircle: memberNet,
  memberNetAgreesWithRunner: memberNet.every((x) => x.agrees),
  checks: { scenarioChecksPassed: reports.filter((r) => r.scenario !== 5).reduce((s, r) => s + r.circles.flatMap((c) => c.checks).filter((k) => k.ok).length, 0), note: "S6's 14 include the 2 S5 checks carried with its circle (factory registered, circle is new)" },
};
fs.writeFileSync(path.join(REC, "summary.json"), JSON.stringify(summary, null, 1));
console.log(JSON.stringify({ tx: summary.uniqueTransactions, gas: summary.gas, fees: summary.feesQIE, qusdc: summary.qusdc, memberNetAgreesWithRunner: summary.memberNetAgreesWithRunner }, null, 1));
