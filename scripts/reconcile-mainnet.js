// READ-ONLY reconciliation of the QIE mainnet deployment and every recorded test transaction.
// Sends nothing and needs no key: run it with DEPLOYER_PRIVATE_KEY unset.
//   npx hardhat run scripts/reconcile-mainnet.js --network qieMainnet
// Writes mainnet-runs/reconciliation/onchain.json (raw facts) for scripts/build-mainnet-reports.js.
const fs = require("fs");
const path = require("path");
const { ethers, network } = require("hardhat");
const H = require("./mainnet/harness");

const FACTORY = process.env.FACTORY || "0xD099c7361157Ec20a9Ac145aF4B66Af553AeDae4";
const DEPLOY_BLOCK = Number(process.env.DEPLOY_BLOCK || 12109975);
const MAIN = "0x7145be20923340bbea3469c3804b384b93356910"; // the owner's main wallet (public address)
const RUNS = path.join(H.ROOT, "mainnet-runs");
const OUT = path.join(RUNS, "reconciliation");

// byte-for-byte match with this build, ignoring only the immutable values filled in at deployment
const cm = async (addr, fqn) => { const x = await H.codeMatches(addr, fqn); return x.ok ? "match" : `MISMATCH (${x.why})`; };

const sectionCache = {};
async function section(name, fn) {
  const f = path.join(OUT, `section-${name}.json`);
  if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, "utf8"));
  const v = await fn();
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(f, JSON.stringify(v));
  return v;
}

async function main() {
  if (process.env.DEPLOYER_PRIVATE_KEY) throw new Error("Unset DEPLOYER_PRIVATE_KEY: this script is read-only and must run without a key.");
  const p = ethers.provider;
  const net = await p.getNetwork();
  const out = { generatedAt: new Date().toISOString(), network: network.name, chainId: net.chainId.toString(), latestBlock: await p.getBlockNumber() };

  // ---- factory and deployer
  const factory = await ethers.getContractAt("CircleFactory", FACTORY);
  const r = await factory.rules();
  const deployer = await factory.deployer();
  const token = new ethers.Contract(r.token_, ["function decimals() view returns (uint8)", "function symbol() view returns (string)", "function name() view returns (string)", "function totalSupply() view returns (uint256)", "function balanceOf(address) view returns (uint256)"], p);
  out.factory = {
    address: FACTORY, deployer, deployerFactoryPointer: await (await ethers.getContractAt("CircleDeployer", deployer)).factory(),
    token: r.token_, tokenName: await token.name(), tokenSymbol: await token.symbol(), tokenDecimals: Number(await token.decimals()), tokenTotalSupply: (await token.totalSupply()).toString(),
    treasury: r.treasury_, feeBps: Number(r.feeBps_), minRoundLength: Number(r.minRoundLength_), minGrace: Number(r.minGrace_), minContribution: r.minContribution_.toString(), minCoverageBps: Number(r.minCoverageBps_), version: Number(r.version_),
    circleCount: Number(await factory.circleCount()),
  };
  out.bytecode = {
    factoryMatchesBuild: await cm(FACTORY, "contracts/CircleFactory.sol:CircleFactory"),
    deployerMatchesBuild: await cm(deployer, "contracts/CircleDeployer.sol:CircleDeployer"),
    factoryRuntimeBytes: ((await p.getCode(FACTORY)).length - 2) / 2,
    deployerRuntimeBytes: ((await p.getCode(deployer)).length - 2) / 2,
  };

  // ---- the factory's deployment transaction: the transaction in the recorded block that created it
  out.deployment = await section("deployment", async () => {
  const out = {};
  const blk = await p.getBlock(DEPLOY_BLOCK, false);
  out.deployment = { block: DEPLOY_BLOCK, blockTimestamp: blk.timestamp, blockHash: blk.hash, candidates: blk.transactions.length, tx: null };
  for (const h of blk.transactions) {
    const rc = await p.getTransactionReceipt(h);
    if (rc.contractAddress && rc.contractAddress.toLowerCase() === FACTORY.toLowerCase()) {
      const tx = await p.getTransaction(h);
      out.deployment.tx = { hash: h, from: rc.from, status: rc.status, gasUsed: rc.gasUsed.toString(), gasPrice: rc.gasPrice.toString(), feeWei: (rc.gasUsed * rc.gasPrice).toString(), nonce: tx.nonce, contractAddress: rc.contractAddress, logs: rc.logs.length };
    }
  }
  if (!out.deployment.tx) {
    // fallback: scan neighbouring blocks for the creating transaction
    for (let b = DEPLOY_BLOCK - 3; b <= DEPLOY_BLOCK + 3 && !out.deployment.tx; b++) {
      const bb = await p.getBlock(b, false);
      for (const h of bb.transactions) {
        const rc = await p.getTransactionReceipt(h);
        if (rc.contractAddress && rc.contractAddress.toLowerCase() === FACTORY.toLowerCase()) out.deployment.tx = { hash: h, block: b, from: rc.from, status: rc.status, gasUsed: rc.gasUsed.toString(), gasPrice: rc.gasPrice.toString(), feeWei: (rc.gasUsed * rc.gasPrice).toString() };
      }
    }
  }

  return out.deployment;
  });

  // ---- every circle the factory registered (oldest first)
  const page = [...(await factory.circlesPage(0, 100))].reverse();
  out.circles = await section("circles", () => Promise.all(page.map(async (a) => {
    const c = await ethers.getContractAt("SavingsCircle", a);
    const ms = await c.members();
    const mem = await Promise.all(ms.map(async (addr, i) => {
      const [m, outcome, wd, hist] = await Promise.all([c.member(i), c.outcomeOf(i), c.withdrawable(addr), factory.history(addr)]);
      return {
        slot: i + 1, address: addr, status: Number(m.status), paidOut: m.paidOut, collateral: m.collateral.toString(), paidIn: m.paidIn.toString(), collateralUsed: m.collateralUsed.toString(),
        unpaidEntitlement: m.unpaidEntitlement.toString(), recordedLoss: m.recordedLoss.toString(), refundClaim: m.refundClaim.toString(), refundPaid: m.refundPaid.toString(), missedRounds: Number(m.missedRounds),
        outcome: Number(outcome), withdrawable: wd.toString(), history: { completed: hist.completed.toString(), caughtUp: hist.caughtUp.toString(), leftEarly: hist.leftEarly.toString(), walkedAway: hist.walkedAway.toString(), volume: hist.volume.toString() },
      };
    }));
    const v = await Promise.all([factory.isCircle(a), factory.recorded(a), factory.nameOf(a), cm(a, "contracts/SavingsCircle.sol:SavingsCircle"), c.phase(), c.size(), c.contribution(), c.coverageBps(), c.collateralFromPayout(), c.roundLength(), c.grace(), c.feeBps(), c.treasury(), c.registry(), c.token(), c.currentRound(), c.allRoundsSettled(), c.freeReserve(), c.roundFund(), c.totalWithdrawable(), token.balanceOf(a), c.accountedBalance(), c.withdrawable(r.treasury_)]);
    const [isCircle, recorded, name, codeMatchesBuild, phase, size, contribution, coverageBps, collateralFromPayout, roundLength, grace, feeBps, treasury, registry, tok, currentRound, allRoundsSettled, freeReserve, roundFund, totalWithdrawable, tokenBalance, accountedBalance, treasuryWithdrawable] = v;
    return { address: a, isCircle, recorded, name, codeMatchesBuild, phase: Number(phase), size: Number(size), contribution: contribution.toString(), coverageBps: Number(coverageBps), collateralFromPayout, roundLength: Number(roundLength), grace: Number(grace), feeBps: Number(feeBps), treasury, registry, token: tok, currentRound: Number(currentRound), allRoundsSettled, freeReserve: freeReserve.toString(), roundFund: roundFund.toString(), totalWithdrawable: totalWithdrawable.toString(), tokenBalance: tokenBalance.toString(), accountedBalance: accountedBalance.toString(), treasuryWithdrawable: treasuryWithdrawable.toString(), members: mem };
  })));

  // ---- every transaction recorded in the live reports, plus the return of funds; one receipt per unique hash
  const files = fs.readdirSync(RUNS).filter((f) => /^live-S\d-.*\.json$/.test(f)).sort();
  const hashes = new Map();
  for (const f of files) {
    const rep = JSON.parse(fs.readFileSync(path.join(RUNS, f), "utf8"));
    for (const t of rep.transactions) if (!hashes.has(t.hash)) hashes.set(t.hash, { firstReport: f, scenario: rep.scenario, label: t.label });
  }
  const retLog = path.join(RUNS, "logs", "return-to-main.log");
  if (fs.existsSync(retLog)) for (const m of fs.readFileSync(retLog, "utf8").matchAll(/sent: (0x[0-9a-f]{64})/g)) hashes.set(m[1], { firstReport: "logs/return-to-main.log", scenario: "return", label: "return to main wallet" });
  // receipts are cached, so a slow RPC can be resumed; 8 requests at a time
  fs.mkdirSync(OUT, { recursive: true });
  const cacheFile = path.join(OUT, "receipts-cache.json");
  const cache = fs.existsSync(cacheFile) ? JSON.parse(fs.readFileSync(cacheFile, "utf8")) : {};
  const todo = [...hashes.keys()].filter((h) => !cache[h]);
  for (let k = 0; k < todo.length; k += 8) {
    await Promise.all(todo.slice(k, k + 8).map(async (h) => {
      const [tx, rc] = await Promise.all([p.getTransaction(h), p.getTransactionReceipt(h)]);
      if (!rc) return;
      const b = await p.getBlock(rc.blockNumber);
      cache[h] = { status: rc.status, block: rc.blockNumber, timestamp: b.timestamp, from: tx.from, to: tx.to, value: tx.value.toString(), nonce: tx.nonce, gasLimit: tx.gasLimit.toString(), gasUsed: rc.gasUsed.toString(), gasPrice: rc.gasPrice.toString(), feeWei: (rc.gasUsed * rc.gasPrice).toString(), logs: rc.logs.length };
    }));
    fs.writeFileSync(cacheFile, JSON.stringify(cache));
  }
  out.transactions = [...hashes].map(([h, meta]) => ({ hash: h, ...meta, found: !!cache[h], ...(cache[h] || {}) }));
  out.transactionsNotFound = out.transactions.filter((t) => !t.found).length;

  // ---- balances of every wallet used, now
  const demo = ["Sipho", "Thandi", "Ayesha", "Bilal", "Naledi", "Farah"];
  const firstMembers = out.circles.find((c) => c.size === 6).members.map((m) => m.address);
  out.wallets = [];
  for (const [role, a] of [["test funder / factory treasury / deployer", r.treasury_], ...firstMembers.map((a, i) => [`member ${demo[i]}`, a]), ["owner's main wallet (not a test wallet)", MAIN]]) {
    out.wallets.push({ role, address: a, qie: (await p.getBalance(a)).toString(), qusdc: (await token.balanceOf(a)).toString(), nonce: await p.getTransactionCount(a) });
  }

  // ---- QUSDC: is it a proxy, and does its code expose administrative functions? (read-only)
  const code = await p.getCode(r.token_);
  const slot = async (s) => ethers.dataSlice(await p.getStorage(r.token_, s), 12);
  const sels = {
    "owner()": "0x8da5cb5b", "paused()": "0x5c975abb", "pause()": "0x8456cb59", "unpause()": "0x3f4ba83a", "mint(address,uint256)": "0x40c10f19", "burn(uint256)": "0x42966c68", "burnFrom(address,uint256)": "0x79cc6790",
    "blacklist(address)": "0xf9f92be4", "isBlacklisted(address)": "0xfe575a87", "addBlackList(address)": "0x0ecb93c0", "freeze(address)": "0x8d1fdf2f", "upgradeTo(address)": "0x3659cfe6", "upgradeToAndCall(address,bytes)": "0x4f1ef286",
    "grantRole(bytes32,address)": "0x2f2ff15d", "hasRole(bytes32,address)": "0x91d14854", "transferOwnership(address)": "0xf2fde38b", "implementation()": "0x5c60da1b", "masterMinter()": "0x35d99f35",
  };
  const impl = await slot("0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc");
  const admin = await slot("0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103");
  const implCode = impl !== ethers.ZeroAddress ? await p.getCode(impl) : "0x";
  const scan = (c) => Object.entries(sels).filter(([, s]) => c.includes(s.slice(2))).map(([n]) => n);
  out.qusdc = { address: r.token_, codeBytes: (code.length - 2) / 2, eip1967Implementation: impl, eip1967Admin: admin, implementationCodeBytes: (implCode.length - 2) / 2, selectorsInCode: scan(code), selectorsInImplementation: scan(implCode) };
  for (const [n, s] of [["owner()", "0x8da5cb5b"], ["paused()", "0x5c975abb"]]) {
    try { out.qusdc[n] = ethers.AbiCoder.defaultAbiCoder().decode([n === "owner()" ? "address" : "bool"], await p.call({ to: r.token_, data: s }))[0].toString(); } catch { out.qusdc[n] = "call reverted or not present"; }
  }

  // ---- explorer source verification (Blockscout API), separate from the bytecode comparison above
  out.explorer = await section("explorer", async () => {
    const res = {};
    for (const a of [FACTORY, deployer, ...out.circles.map((c) => c.address), r.token_]) {
      try {
        const resp = await fetch(`https://mainnet.qie.digital/api/v2/smart-contracts/${a}`, { signal: AbortSignal.timeout(30000) });
        const j = resp.ok ? await resp.json() : null;
        res[a] = { http: resp.status, is_verified: j ? j.is_verified ?? null : null, is_fully_verified: j ? j.is_fully_verified ?? null : null, name: j ? j.name ?? null : null, compiler: j ? j.compiler_version ?? null : null, verified_twin: j ? j.verified_twin_address_hash ?? null : null };
      } catch (e) { res[a] = { error: e.name || String(e) }; }
    }
    return res;
  });

  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, "onchain.json"), JSON.stringify(out, null, 1));
  console.log(`chain ${out.chainId}, factory ${FACTORY}, ${out.circles.length} circles, ${out.transactions.length} unique transactions, deployment tx ${out.deployment.tx ? out.deployment.tx.hash : "NOT FOUND"}`);
  console.log(`bytecode: factory ${out.bytecode.factoryMatchesBuild}, deployer ${out.bytecode.deployerMatchesBuild}, circles ${out.circles.map((c) => c.codeMatchesBuild).join(",")}`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
