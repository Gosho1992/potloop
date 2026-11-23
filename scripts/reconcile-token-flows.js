// READ-ONLY: every QUSDC Transfer log that touches a test circle or a test wallet, from QIE mainnet.
// Gives an independent money trail for scripts/build-mainnet-reports.js (it does not use the
// runner's own records). Run with DEPLOYER_PRIVATE_KEY unset:
//   npx hardhat run scripts/reconcile-token-flows.js --network qieMainnet
const fs = require("fs");
const path = require("path");
const { ethers } = require("hardhat");
const H = require("./mainnet/harness");

const OUT = path.join(H.ROOT, "mainnet-runs", "reconciliation");
const TRANSFER = ethers.id("Transfer(address,address,uint256)");

async function main() {
  if (process.env.DEPLOYER_PRIVATE_KEY) throw new Error("Unset DEPLOYER_PRIVATE_KEY: read-only script.");
  const on = JSON.parse(fs.readFileSync(path.join(OUT, "onchain.json"), "utf8"));
  const p = ethers.provider;
  const token = on.factory.token;
  const watch = [...new Set([...on.circles.map((c) => c.address), ...on.wallets.map((w) => w.address)].map((a) => a.toLowerCase()))];
  // the test wallet's first QUSDC arrived by the swap shortly before the deployment; start well before
  const from = Number(process.env.FROM_BLOCK || on.deployment.block - 20000);
  const to = await p.getBlockNumber();
  const STEP = Number(process.env.LOG_STEP || 5000);
  const seen = new Map();
  const pad = (a) => ethers.zeroPadValue(a, 32);
  for (let b = from; b <= to; b += STEP) {
    const e = Math.min(b + STEP - 1, to);
    for (const side of [1, 2]) {
      const topics = side === 1 ? [TRANSFER, watch.map(pad)] : [TRANSFER, null, watch.map(pad)];
      const logs = await p.getLogs({ address: token, topics, fromBlock: b, toBlock: e });
      for (const l of logs) {
        const k = `${l.transactionHash}:${l.index}`;
        if (!seen.has(k)) seen.set(k, { tx: l.transactionHash, logIndex: l.index, block: l.blockNumber, from: ethers.getAddress(ethers.dataSlice(l.topics[1], 12)), to: ethers.getAddress(ethers.dataSlice(l.topics[2], 12)), amount: BigInt(l.data).toString() });
      }
    }
  }
  const flows = [...seen.values()].sort((x, y) => x.block - y.block || x.logIndex - y.logIndex);
  fs.writeFileSync(path.join(OUT, "token-flows.json"), JSON.stringify({ token, fromBlock: from, toBlock: to, watched: watch, transfers: flows }, null, 1));
  console.log(`${flows.length} QUSDC transfers between blocks ${from} and ${to}`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
