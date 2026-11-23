// PotLoop keeper: keeps circles moving and reminds members to pay.
// - settles a round as soon as the contract allows it (everyone paid, or time is up)
// - finishes a circle once the cure window is over
// - writes finished circles into everyone's track record
// - optional: posts reminders to a Telegram chat before a payment window closes
//
// Usage (PowerShell), in the project folder; leave the window open:
//   $env:DEPLOYER_PRIVATE_KEY="0x..."     # a wallet with a little QIE for gas (any wallet works)
//   $env:FACTORY="0x..."
//   $env:TELEGRAM_BOT_TOKEN="..."; $env:TELEGRAM_CHAT_ID="..."   # optional
//   npx hardhat run scripts/keeper.js --network qieMainnet
const { ethers } = require("hardhat");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const EVERY = Number(process.env.KEEPER_SECONDS || 30) * 1000;
const PAGE_SIZE = 100;
const reminded = new Set();

async function telegram(text) {
  const { TELEGRAM_BOT_TOKEN: tok, TELEGRAM_CHAT_ID: chat } = process.env;
  if (!tok || !chat) return;
  try {
    await fetch(`https://api.telegram.org/bot${tok}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chat, text, disable_web_page_preview: true }),
    });
  } catch (e) {
    console.log("telegram failed:", e.message);
  }
}

async function tryTx(label, fn) {
  try {
    await fn.staticCall();
  } catch {
    return false; // not allowed yet: nothing to do
  }
  const tx = await fn();
  await tx.wait();
  console.log(`${new Date().toISOString()} ${label} (${tx.hash})`);
  return true;
}

async function tick(factory, me) {
  const count = Number(await factory.circleCount());
  const now = (await ethers.provider.getBlock("latest")).timestamp;
  // Walk every page so older circles continue to progress as the factory grows.
  for (let offset = 0; offset < count; offset += PAGE_SIZE) {
    const list = await factory.circlesPage(offset, PAGE_SIZE);
    for (const addr of list) {
    const c = (await ethers.getContractAt("SavingsCircle", addr)).connect(me);
    const phase = Number(await c.phase());
    const name = await factory.nameOf(addr);
    if (phase === 1) {
      if (await c.allRoundsSettled()) {
        await tryTx(`finished "${name}"`, c.finalize);
        continue;
      }
      const r = await c.currentRound();
      await tryTx(`settled round ${r} of "${name}"`, c.settle);
      // reminder when two thirds of the round have passed
      const start = Number(await c.roundStart());
      const len = Number(await c.roundLength());
      const key = `${addr}-${r}`;
      if (!reminded.has(key) && now > start + (2 * len) / 3) {
        const members = await c.members();
        const unpaid = [];
        for (let i = 0; i < members.length; i++) {
          const m = await c.member(i);
          if (Number(m.status) !== 1 && !(await c.contributed(r, i))) unpaid.push(`seat ${i + 1} (${members[i].slice(0, 6)}…${members[i].slice(-4)})`);
        }
        if (unpaid.length) await telegram(`PotLoop "${name}": round ${r} closes soon. Still to pay: ${unpaid.join(", ")}.`);
        reminded.add(key);
      }
    } else if (phase === 2 && !(await factory.recorded(addr))) {
      const rec = (...a) => factory.connect(me).recordCircle(addr, ...a);
      rec.staticCall = () => factory.connect(me).recordCircle.staticCall(addr);
      await tryTx(`recorded results of "${name}"`, rec);
    }
    }
  }
}

async function main() {
  const [me] = await ethers.getSigners();
  const factory = await ethers.getContractAt("CircleFactory", process.env.FACTORY || "");
  console.log(`Keeper running for factory ${await factory.getAddress()} as ${me.address}. Ctrl+C to stop.`);
  for (;;) {
    try {
      await tick(factory, me);
    } catch (e) {
      console.log("tick failed:", e.shortMessage || e.message);
    }
    await sleep(EVERY);
  }
}

main();
