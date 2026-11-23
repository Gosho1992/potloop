// Shared engine for scripts/mainnet-preflight.js and scripts/mainnet-test-runner.js.
// Safety rules built in:
//  - estimates every transaction's gas first and refuses to send it if it would break the budget
//    or leave the funder below the reserve;
//  - never retries a failed transaction: it stops and prints the hash so you can check it;
//  - never prints or writes private keys;
//  - compares every on-chain result with the parity-tested simulator, exactly, in base units.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { ethers, artifacts, network } = require("hardhat");

const QUSDC = "0x3F43DA82eC9A4f5285F10FaF1F26EcA7319E5DA5";
const MAINNET = 1990n;
const ROOT = path.join(__dirname, "..", "..");
const GAS_TABLE = path.join(__dirname, "gas-table.json");
const ERC20 = [
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address,uint256) returns (bool)",
  "function approve(address,uint256) returns (bool)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
];

const q = (v) => ethers.formatUnits(v, 6);
const qie = (v) => ethers.formatEther(v);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Compares on-chain runtime code with our compiled code, ignoring only immutable values. */
async function codeMatches(addr, fqn) {
  const onchain = (await ethers.provider.getCode(addr)).slice(2);
  const bi = await artifacts.getBuildInfo(fqn);
  const [src, name] = fqn.split(":");
  const dep = bi.output.contracts[src][name].evm.deployedBytecode;
  let mine = dep.object;
  if (onchain.length !== mine.length) return { ok: false, why: `length ${onchain.length / 2} vs ${mine.length / 2}` };
  const a = onchain.split("");
  const b = mine.split("");
  for (const refs of Object.values(dep.immutableReferences || {})) {
    for (const { start, length } of refs) for (let i = start * 2; i < (start + length) * 2; i++) a[i] = b[i] = "0";
  }
  return { ok: a.join("") === b.join(""), why: "bytes differ outside immutable values" };
}

/** Verifies a factory is genuinely ours and reads its rules. Throws with the reason if not. */
async function verifyFactory(addr) {
  const f = await ethers.getContractAt("CircleFactory", addr);
  const fc = await codeMatches(addr, "contracts/CircleFactory.sol:CircleFactory");
  if (!fc.ok) throw new Error(`Factory ${addr} is not this project's CircleFactory (${fc.why}).`);
  const r = await f.rules();
  if (r.version_ !== 92n) throw new Error(`Factory version ${r.version_}, expected 92.`);
  const dep = await f.deployer();
  const dc = await codeMatches(dep, "contracts/CircleDeployer.sol:CircleDeployer");
  if (!dc.ok) throw new Error(`Deployer ${dep} is not this project's CircleDeployer (${dc.why}).`);
  const d = await ethers.getContractAt("CircleDeployer", dep);
  if ((await d.factory()) !== addr) throw new Error("Deployer does not point back to the factory.");
  return { factory: f, rules: r, deployer: dep };
}

/** Gas table measured by the fork rehearsal: label -> gas used (the largest seen). */
function loadGasTable() {
  return fs.existsSync(GAS_TABLE) ? JSON.parse(fs.readFileSync(GAS_TABLE, "utf8")) : null;
}

/** The plan for one scenario: simulator expectations, funding per member, gas estimate. */
function planScenario(simulate, scenario, feeBps, gasTable) {
  const circles = scenario.circles.map((cfg) => {
    const sim = simulate({ n: cfg.n, c: cfg.c, k: cfg.k, feeBps, stopAt: cfg.stopAt, catchUpAt: cfg.catchUpAt, fromPayout: cfg.fromPayout });
    if (!sim.conserved) throw new Error(`${cfg.label}: simulator does not conserve money`);
    return { cfg, sim, fund: sim.members.map((m) => m.sentIn) };
  });
  // members are funded per circle and swept back after it, so the peak need is the largest circle
  const qusdcPeak = circles.reduce((mx, x) => {
    const t = x.fund.reduce((s, v) => s + v, 0n);
    return t > mx ? t : mx;
  }, 0n);
  let gas = null;
  if (gasTable) {
    gas = 0n;
    for (const label of [`scenario-${scenario.id}`]) if (gasTable[label]) gas += BigInt(gasTable[label]);
    if (gas === 0n) gas = null;
  }
  return { circles, qusdcPeak, gas };
}

function planHash(obj) {
  const s = JSON.stringify(obj, (_, v) => (typeof v === "bigint" ? v.toString() : v));
  return crypto.createHash("sha256").update(s).digest("hex").slice(0, 8);
}

/** Loads the member wallets from demo-wallets.json (live) or makes throwaway ones (fork). */
function memberWallets(count, live) {
  const file = path.join(ROOT, "demo-wallets.json");
  if (live) {
    if (!fs.existsSync(file)) throw new Error("demo-wallets.json not found. Run: node scripts/make-wallets.js 6");
    const list = JSON.parse(fs.readFileSync(file, "utf8"));
    if (list.length < count) throw new Error(`demo-wallets.json has ${list.length} wallets; ${count} needed. Delete it and run: node scripts/make-wallets.js 6`);
    return list.slice(0, count).map((w) => ({ name: w.name, wallet: new ethers.Wallet(w.privateKey, ethers.provider) }));
  }
  const names = ["Sipho", "Thandi", "Ayesha", "Bilal", "Naledi", "Farah"];
  return Array.from({ length: count }, (_, i) => ({ name: names[i], wallet: ethers.Wallet.createRandom().connect(ethers.provider) }));
}

/**
 * Sends transactions under a spending limit. Every call: estimate gas, price it, refuse if it
 * would exceed the budget or the funder's reserve, send, wait, record. On any failure it stops:
 * no retry, and if the transaction was broadcast its hash is reported so you can check it.
 */
class Ledger {
  constructor({ budgetWei, reserveWei, funder, live, report }) {
    Object.assign(this, { budgetWei, reserveWei, funder, live, report });
    this.spent = 0n;
    this.gasUsed = 0n;
    this.txs = [];
  }
  async send(label, signer, contract, method, args = [], value = 0n) {
    const c = contract.connect(signer);
    const overrides = value ? { value } : {};
    const est = method === "__transfer" ? 21000n : await c[method].estimateGas(...args, overrides);
    const price = (await ethers.provider.getFeeData()).gasPrice;
    const worst = ((est * 13n) / 10n) * price;
    if (this.spent + worst > this.budgetWei) throw new Error(`BUDGET STOP before "${label}": spent ${qie(this.spent)} + up to ${qie(worst)} QIE would exceed the ${qie(this.budgetWei)} QIE budget.`);
    const funderBal = await ethers.provider.getBalance(this.funder.address);
    if (signer.address === this.funder.address && funderBal - worst - value < this.reserveWei)
      throw new Error(`RESERVE STOP before "${label}": your wallet would drop below the ${qie(this.reserveWei)} QIE reserve.`);
    let tx;
    try {
      tx =
        method === "__transfer"
          ? await signer.sendTransaction({ to: args[0], value, gasLimit: 21000n })
          : await c[method](...args, { ...overrides, gasLimit: (est * 13n) / 10n });
    } catch (e) {
      throw new Error(`"${label}" was not sent (${e.shortMessage || e.message}). Nothing to check on the explorer.`);
    }
    let rc;
    try {
      rc = await tx.wait(1, this.live ? 180_000 : undefined);
    } catch (e) {
      throw new Error(`"${label}" was SENT as ${tx.hash} but did not confirm cleanly (${e.shortMessage || e.message}). Check it on the explorer before running anything again; it will not be retried.`);
    }
    if (rc.status !== 1) throw new Error(`"${label}" reverted on chain: ${tx.hash}`);
    const fee = rc.gasUsed * rc.gasPrice;
    this.spent += fee;
    this.gasUsed += rc.gasUsed;
    const events = [];
    for (const l of rc.logs) {
      try {
        const e = contract.interface.parseLog(l);
        if (e) events.push(`${e.name}(${e.args.map((a) => (typeof a === "bigint" ? a.toString() : String(a))).join(",")})`);
      } catch {}
    }
    const rec = { label, from: signer.address, hash: tx.hash, block: rc.blockNumber, gasEstimate: est.toString(), gasUsed: rc.gasUsed.toString(), gasPrice: rc.gasPrice.toString(), feeWei: fee.toString(), cumulativeWei: this.spent.toString(), events };
    this.txs.push(rec);
    this.report(`  ${label}: ${tx.hash} gas ${rc.gasUsed} (est ${est}) fee ${qie(fee)} QIE, total ${qie(this.spent)} QIE`);
    return rc;
  }
}

/** Full state snapshot in the simulator's shape, for exact comparison. */
async function snapshot(circle, n, members, treasury, feeBps, step, extra = {}) {
  const ms = [];
  for (let i = 0; i < n; i++) {
    const x = await circle.member(i);
    ms.push({
      status: Number(x.status),
      paidOut: x.paidOut,
      collateral: x.collateral,
      paidIn: x.paidIn,
      collateralUsed: x.collateralUsed,
      unpaidEntitlement: x.unpaidEntitlement,
      recordedLoss: x.recordedLoss,
      refundClaim: x.refundClaim,
      refundPaid: x.refundPaid,
      missedRounds: Number(x.missedRounds),
      penalty: await circle.penaltyPaid(i),
      withdrawable: await circle.withdrawable(members[i].wallet.address),
    });
  }
  return {
    step,
    round: Number(await circle.currentRound()),
    allRoundsSettled: await circle.allRoundsSettled(),
    freeReserve: await circle.freeReserve(),
    roundFund: await circle.roundFund(),
    treasury: feeBps > 0 ? await circle.withdrawable(treasury) : 0n,
    ...extra,
    members: ms,
  };
}

/** Approval code for one scenario run: changes if anything about the plan changes. */
function approvalCode({ id, chainId, factory, funder, memberAddrs, budgetWei, reserveWei, scenario }) {
  return `S${id}-${planHash({ id, chain: chainId.toString(), factory, funder, members: memberAddrs, budget: budgetWei, reserve: reserveWei, scenario })}`;
}

/** Approval code for the one factory deployment. */
function deployApprovalCode(p) {
  return `D-${planHash(p)}`;
}

const ser = (v) => JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x));

module.exports = { approvalCode, deployApprovalCode, QUSDC, MAINNET, ROOT, GAS_TABLE, ERC20, q, qie, sleep, codeMatches, verifyFactory, loadGasTable, planScenario, planHash, memberWallets, Ledger, snapshot, ser, ethers, network };
