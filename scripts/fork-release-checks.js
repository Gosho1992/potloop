// Release checks on a LOCAL COPY of QIE mainnet. Nothing is sent to mainnet: the RPC is only read
// to build the copy, and every transaction happens in-process. No key is used (accounts are the
// local test accounts, and existing addresses are impersonated on the copy only).
//   FORK_URL=https://rpc3mainnet.qie.digital FORK_BLOCK=<n> PART=record  npx hardhat run scripts/fork-release-checks.js
//   PART=record   recordCircle() on each of the 7 real completed circles: events, history, AlreadyRecorded,
//                 money unchanged, gas per recording
//   PART=twelve   a 12-member, 0%-cover circle on the REAL deployed factory with the real QUSDC
//   PART=upfront  default and recovery in upfront-collateral mode (20% cover) on the real factory
// Results: mainnet-runs/reconciliation/fork-<part>.json
const fs = require("fs");
const path = require("path");
const { ethers, network } = require("hardhat");

const FACTORY = "0xD099c7361157Ec20a9Ac145aF4B66Af553AeDae4";
const QUSDC = "0x3F43DA82eC9A4f5285F10FaF1F26EcA7319E5DA5";
const VAULT = "0xdc20f1fee9e03184ddabcce96f01e3c570e43d45"; // holds QUSDC's VAULT_ROLE (may mint) — impersonated on the copy only
const OUT = path.join(__dirname, "..", "mainnet-runs", "reconciliation");
const results = { part: process.env.PART, checks: [], notes: [] };
const check = (name, ok, detail = "") => { results.checks.push({ name, ok: !!ok, detail }); console.log(`  ${ok ? "PASS" : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`); };

async function impersonate(a) {
  await ethers.provider.send("hardhat_impersonateAccount", [a]);
  await ethers.provider.send("hardhat_setBalance", [a, "0x56BC75E2D63100000"]);
  return ethers.getSigner(a);
}
const advance = async (s) => { await ethers.provider.send("evm_increaseTime", [s]); await ethers.provider.send("evm_mine", []); };

async function independentLedger(circle, token, members, treasury) {
  const addr = await circle.getAddress();
  const n = Number(await circle.size());
  let col = 0n;
  for (let i = 0; i < n; i++) col += (await circle.member(i)).collateral;
  let credits = 0n;
  for (const a of new Set([...members, treasury])) credits += await circle.withdrawable(a);
  const rebuilt = col + (await circle.freeReserve()) + (await circle.roundFund()) + credits;
  return rebuilt === (await token.balanceOf(addr)) && credits === (await circle.totalWithdrawable());
}

async function runCircle({ label, n, c, k, fromPayout, stopAt = [], catchUpAt = [] }) {
  const factory = await ethers.getContractAt("CircleFactory", FACTORY);
  const token = await ethers.getContractAt("MockUSD", QUSDC); // ERC-20 calls only
  const vault = await impersonate(VAULT);
  const qusdc = new ethers.Contract(QUSDC, ["function mint(address,uint256)"], vault);
  const signers = (await ethers.getSigners()).slice(1, 1 + n);
  for (const s of signers) await (await qusdc.mint(s.address, c * BigInt(n) * 3n + 1_000_000n)).wait();
  const start = await Promise.all(signers.map((s) => token.balanceOf(s.address)));
  const rules = await factory.rules();
  const treasury = rules.treasury_;
  const tStart = await token.balanceOf(treasury);
  const before = await factory.circleCount();
  await (await factory.createCircle(`fork ${label}`.slice(0, 64), signers.map((s) => s.address), c, k, 60, 30, 900, fromPayout)).wait();
  const [addr] = await factory.circlesPage(0, 1);
  const circle = await ethers.getContractAt("SavingsCircle", addr);
  check(`${label}: created on the real factory (circle #${Number(before) + 1})`, (await factory.isCircle(addr)) && (await factory.circleCount()) === before + 1n);
  let ledgerOk = true;
  const L = async () => { ledgerOk = (await independentLedger(circle, token, signers.map((s) => s.address), treasury)) && ledgerOk; };
  for (let i = 0; i < n; i++) {
    const up = await circle.upfrontCollateral(i);
    if (up > 0n) await (await token.connect(signers[i]).approve(addr, up)).wait();
    await (await circle.connect(signers[i]).accept()).wait();
    await L();
  }
  for (let r = 1; r <= n; r++) {
    for (let i = 0; i < n; i++) if (catchUpAt[i] === r && (await circle.member(i)).status === 2n) {
      const [t] = await circle.catchUpCost(i);
      await (await token.connect(signers[i]).approve(addr, t)).wait();
      await (await circle.connect(signers[i]).catchUp()).wait();
      await L();
    }
    for (let i = 0; i < n; i++) {
      const stopped = stopAt[i] && r >= stopAt[i] && !(catchUpAt[i] && r >= catchUpAt[i]);
      if (stopped || (await circle.contributed(r, i)) || (await circle.member(i)).status === 1n) continue;
      await (await token.connect(signers[i]).approve(addr, c)).wait();
      await (await circle.connect(signers[i]).contribute()).wait();
    }
    await L();
    let all = true;
    for (let i = 0; i < n; i++) if ((await circle.member(i)).status !== 1n && !(await circle.contributed(r, i))) all = false;
    if (!all) {
      const due = Number(await circle.deadline()) + Number(await circle.grace()) + 1;
      const t = (await ethers.provider.getBlock("latest")).timestamp;
      if (t < due) await advance(due - t);
    }
    await (await circle.settle()).wait();
    await L();
  }
  const fa = Number(await circle.finalizeAfter());
  const now = (await ethers.provider.getBlock("latest")).timestamp;
  if (now < fa) await advance(fa - now + 1);
  await (await circle.finalize()).wait();
  await L();
  for (const s of signers) if ((await circle.withdrawable(s.address)) > 0n) await (await circle.connect(s).withdraw()).wait();
  const tr = await impersonate(treasury);
  if ((await circle.withdrawable(treasury)) > 0n) await (await circle.connect(tr).withdraw()).wait();
  await L();
  check(`${label}: independent ledger equals the QUSDC balance after every step`, ledgerOk);
  check(`${label}: circle ends holding 0 QUSDC`, (await token.balanceOf(addr)) === 0n);
  const nets = await Promise.all(signers.map(async (s, i) => (await token.balanceOf(s.address)) - start[i]));
  const fee = (await token.balanceOf(treasury)) - tStart;
  check(`${label}: members' losses equal the treasury's fee (no QUSDC created or lost)`, nets.reduce((a, b) => a + b, 0n) + fee === 0n, `fee ${ethers.formatUnits(fee, 6)} QUSDC`);
  const outcomes = await Promise.all(signers.map((_, i) => circle.outcomeOf(i)));
  await (await factory.recordCircle(addr)).wait();
  check(`${label}: results recorded`, await factory.recorded(addr), `outcomes ${outcomes.join(",")}`);
  return { label, circle: addr, nets: nets.map(String), fee: fee.toString(), outcomes: outcomes.map(Number) };
}

async function main() {
  if (!process.env.FORK_URL || network.name !== "hardhat") throw new Error("Local copy only: set FORK_URL and run without --network.");
  await ethers.provider.send("evm_mine", []); // run on a local block, not the copied one
  const { chainId } = await ethers.provider.getNetwork();
  results.chainId = Number(chainId);
  results.forkBlock = (await ethers.provider.getBlockNumber()) - 1;
  console.log(`local copy of chain ${chainId} at block ${results.forkBlock}`);
  const factory = await ethers.getContractAt("CircleFactory", FACTORY);
  const part = process.env.PART;

  if (part === "record") {
    const caller = await impersonate("0x000000000000000000000000000000000000dEaD"); // anyone may record
    const circles = [...(await factory.circlesPage(0, 100))].reverse();
    const token = await ethers.getContractAt("MockUSD", QUSDC);
    results.recordings = [];
    const expectHist = new Map();
    for (const a of circles) {
      const c = await ethers.getContractAt("SavingsCircle", a);
      const ms = await c.members();
      const pot = (await c.size()) * (await c.contribution());
      const outcomes = await Promise.all(ms.map((_, i) => c.outcomeOf(i)));
      const moneyBefore = await Promise.all(ms.map(async (m) => [await c.withdrawable(m), await token.balanceOf(m)]));
      const balBefore = await token.balanceOf(a);
      const histBefore = await Promise.all(ms.map((m) => factory.history(m)));
      for (const [i, m] of ms.entries()) if (!expectHist.has(m)) expectHist.set(m, [histBefore[i].completed, histBefore[i].caughtUp, histBefore[i].leftEarly, histBefore[i].walkedAway, histBefore[i].volume]);
      const est = await factory.connect(caller).recordCircle.estimateGas(a);
      const rc = await (await factory.connect(caller).recordCircle(a)).wait();
      const ev = rc.logs.map((l) => { try { return factory.interface.parseLog(l); } catch { return null; } }).filter((e) => e && e.name === "ResultRecorded");
      check(`record ${a.slice(0, 10)}: one ResultRecorded per member with the circle's outcome`, ev.length === ms.length && ev.every((e, i) => e.args.member === ms[i] && BigInt(e.args.outcome) === outcomes[i]), `outcomes ${outcomes.join(",")}`);
      check(`record ${a.slice(0, 10)}: recorded() is true`, await factory.recorded(a));
      for (const [i, m] of ms.entries()) {
        const e = expectHist.get(m);
        e[Number(outcomes[i])] += 1n;
        if (outcomes[i] <= 1n) e[4] += pot;
      }
      let second = false;
      try { await factory.connect(caller).recordCircle.staticCall(a); } catch (err) { second = factory.interface.parseError(err.data || "0x")?.name === "AlreadyRecorded"; }
      check(`record ${a.slice(0, 10)}: a second recording reverts with AlreadyRecorded`, second);
      const moneyAfter = await Promise.all(ms.map(async (m) => [await c.withdrawable(m), await token.balanceOf(m)]));
      check(`record ${a.slice(0, 10)}: no entitlement, wallet or circle balance changed`, JSON.stringify(moneyAfter.map(String)) === JSON.stringify(moneyBefore.map(String)) && (await token.balanceOf(a)) === balBefore);
      results.recordings.push({ circle: a, members: ms.length, outcomes: outcomes.map(Number), gasEstimate: est.toString(), gasUsed: rc.gasUsed.toString() });
      console.log(`  gas: estimate ${est}, used ${rc.gasUsed}`);
    }
    // cumulative history across all seven circles (the same six wallets)
    for (const [m, e] of expectHist) {
      const h = await factory.history(m);
      check(`history of ${m.slice(0, 10)} after all 7 recordings`, [h.completed, h.caughtUp, h.leftEarly, h.walkedAway, h.volume].every((v, i) => v === e[i]), `completed ${h.completed}, caught up ${h.caughtUp}, left early ${h.leftEarly}, walked away ${h.walkedAway}, volume ${ethers.formatUnits(h.volume, 6)}`);
    }
  } else if (part === "twelve") {
    results.circle = await runCircle({ label: "12 members, 0% cover, from the pot", n: 12, c: 10_000n, k: 0, fromPayout: true });
  } else if (part === "upfront") {
    results.circle = await runCircle({ label: "5 members, 20% cover, upfront: seat 1 defaults after payout and catches up", n: 5, c: 20_000n, k: 2000, fromPayout: false, stopAt: [2], catchUpAt: [4] });
    results.circle2 = await runCircle({ label: "4 members, 0% cover, upfront: seat 1 walks away (uncovered loss)", n: 4, c: 20_000n, k: 0, fromPayout: false, stopAt: [2] });
  } else throw new Error("PART must be record, twelve or upfront");

  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, `fork-${part}.json`), JSON.stringify(results, null, 1));
  const failed = results.checks.filter((x) => !x.ok).length;
  console.log(`${part}: ${results.checks.length - failed} passed, ${failed} failed`);
  if (failed) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
