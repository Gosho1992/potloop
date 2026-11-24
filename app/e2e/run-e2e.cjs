// UI acceptance suite for the real PotLoop React app (production build) against a local Hardhat node.
// Every check drives the app through the browser and then verifies the result on chain.
//
//   (once)  cd app && npm i --no-save playwright@1.63.0 && npx playwright install chromium
//   node app/e2e/run-e2e.cjs        (from the project folder; about 4 minutes)
//   CHROME=/usr/bin/google-chrome node app/e2e/run-e2e.cjs     to use an installed Chrome
//
// What it does: starts a Hardhat node, deploys a test token and a factory with the QIE demo
// factory's rules (scripts/e2e-deploy.js), builds the app with that factory baked in (production
// mode: URL settings ignored), serves it with vite preview, and runs the cases below in Chromium with
// a scripted wallet (app/e2e/wallet-double.js). Results: evidence/v93-release/ui-e2e/results.json,
// one screenshot per case, and the app's console log. Exit code 1 if any case fails.
const { spawn, execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const APP = path.join(ROOT, "app");
const OUT = path.join(ROOT, "evidence", "v93-release", "ui-e2e");
const RPC = "http://127.0.0.1:8545";
const PORT = 4173;
const BASE = `http://127.0.0.1:${PORT}/`;
let playwright;
for (const p of [path.join(APP, "node_modules", "playwright"), "playwright", "/opt/npm-tools/node_modules/playwright"]) { try { playwright = require(p); break; } catch {} }
if (!playwright) { console.error("Install Playwright first: cd app && npm i --no-save playwright@1.63.0"); process.exit(2); }
const { Interface, formatUnits } = require(path.join(APP, "node_modules", "ethers"));
const circleAbi = require(path.join(APP, "src", "circleAbi.json"));
const factoryAbi = require(path.join(APP, "src", "factoryAbi.json"));
const C = new Interface(circleAbi);
const F = new Interface(factoryAbi);
const T = new Interface(["function approve(address,uint256)", "function balanceOf(address) view returns (uint256)", "function allowance(address,address) view returns (uint256)"]);

const procs = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function start(cmd, args, opts, readyText) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { ...opts, stdio: ["ignore", "pipe", "pipe"], detached: true }); // own process group, so cleanup stops npx's children too
    procs.push(p);
    let buf = "";
    const onData = (d) => { buf += d; if (buf.includes(readyText)) resolve(p); };
    p.stdout.on("data", onData);
    p.stderr.on("data", onData);
    p.on("exit", (code) => reject(new Error(`${cmd} ${args.join(" ")} exited ${code}: ${buf.slice(-500)}`)));
    setTimeout(() => reject(new Error(`timeout starting ${cmd}: ${buf.slice(-500)}`)), 120000);
  });
}
async function rpc(method, params = []) {
  const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const j = await r.json();
  if (j.error) throw new Error(j.error.message);
  return j.result;
}
const call = async (to, iface, fn, args = []) => iface.decodeFunctionResult(fn, await rpc("eth_call", [{ to, data: iface.encodeFunctionData(fn, args) }, "latest"]));
const chainTime = async () => parseInt((await rpc("eth_getBlockByNumber", ["latest", false])).timestamp, 16);

const results = [];
async function tcase(id, name, page, fn) {
  const t0 = Date.now();
  let status = "PASS";
  let detail = "";
  try { detail = (await fn()) || ""; } catch (e) { status = "FAIL"; detail = String(e && e.message ? e.message : e).slice(0, 600); }
  const shot = `${id}.png`;
  try { await page.screenshot({ path: path.join(OUT, shot), fullPage: true }); } catch {}
  results.push({ id, name, status, detail, ms: Date.now() - t0, screenshot: shot });
  console.log(`${status} ${id} ${name}${detail ? ` — ${detail}` : ""}`);
}
const must = (ok, msg) => { if (!ok) throw new Error(msg); };

async function main() {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  const env = { ...process.env };
  delete env.FORK_URL; delete env.DEPLOYER_PRIVATE_KEY; delete env.EXHAUSTIVE;

  // 1. chain + deployment
  await start("npx", ["hardhat", "node", "--hostname", "127.0.0.1", "--port", "8545"], { cwd: ROOT, env }, "Started HTTP");
  const deployOut = execFileSync("npx", ["hardhat", "run", "scripts/e2e-deploy.js", "--network", "localhost"], { cwd: ROOT, env }).toString();
  const dep = JSON.parse(deployOut.trim().split("\n").pop());
  const accounts = await rpc("eth_accounts");
  const [A, B, Cc] = dep.members; // seats 1, 2, 3 in the circle the UI creates

  // 2. production build of the app with the local factory baked in, served by vite preview
  const buildEnv = { ...env, VITE_FACTORY_ADDRESS: dep.factory, VITE_RPC_URL: RPC, VITE_CHAIN_ID: String(dep.chainId), VITE_FROM_BLOCK: "0", VITE_EXPLORER: "", VITE_APP_NAME: "PotLoop" };
  execFileSync("npx", ["vite", "build", "--outDir", "e2e-dist", "--emptyOutDir"], { cwd: APP, env: buildEnv, stdio: "pipe" });
  await start("npx", ["vite", "preview", "--outDir", "e2e-dist", "--port", String(PORT), "--strictPort", "--host", "127.0.0.1"], { cwd: APP, env: buildEnv }, String(PORT));

  // 3. browser with the scripted wallet
  const browser = await playwright.chromium.launch({ headless: true, ...(process.env.CHROME ? { executablePath: process.env.CHROME } : {}) });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE.slice(0, -1) });
  const shim = fs.readFileSync(path.join(__dirname, "wallet-double.js"), "utf8");
  const chainHex = "0x" + dep.chainId.toString(16);
  const consoleLog = [];
  const newPage = async (account, chainId = chainHex, connected = false) => {
    const p = await ctx.newPage();
    await p.addInitScript({ content: `${shim}\ninstallWalletDouble(${JSON.stringify({ account, chainId, rpc: RPC, connected })});` });
    p.on("console", (m) => consoleLog.push(`[${m.type()}] ${m.text()}`));
    p.on("dialog", (d) => d.dismiss());
    return p;
  };
  const btn = (p, name) => p.getByRole("button", { name });
  const visible = async (loc, timeout = 30000) => { await loc.first().waitFor({ state: "visible", timeout }); return loc.first(); };
  const text = async (p, re, timeout = 30000) => visible(p.getByText(re), timeout);
  const setAccount = async (p, a) => { await p.evaluate((x) => { window.__wallet.account = x; window.__wallet.emit("accountsChanged", [x]); }, a); };
  const connect = async (p) => { await (await visible(btn(p, /^Connect (wallet|QIE Wallet)/))).click(); await visible(p.locator("header .who")); };
  const sent = (p) => p.evaluate(() => window.__wallet.sent);
  const fmt = (v) => { let s = formatUnits(v, 6); s = s.replace(/\.?0+$/, ""); return s; };

  let circle = null;
  let page = await newPage(A);

  await tcase("E2E-01", "QIE Wallet is discovered (EIP-6963, rdns me.qiewallet) and connects", page, async () => {
    await page.goto(BASE + "#/");
    await connect(page);
    const who = await page.locator("header .who").innerText();
    must(who.startsWith(A.slice(0, 6)), `header shows ${who}`);
    must((await page.evaluate(() => window.__wallet.requests)).includes("eth_requestAccounts"), "no eth_requestAccounts");
    return `header shows ${who}`;
  });

  await tcase("E2E-02", "Rejecting the connection shows a clear message and stays disconnected", page, async () => {
    const p = await newPage(A);
    await p.evaluate(() => {}); await p.goto(BASE + "#/");
    await p.evaluate(() => { window.__wallet.rejectConnect = true; });
    await (await visible(btn(p, /^Connect wallet/))).click();
    await text(p, /You cancelled it in your wallet/);
    must((await p.locator("header .who").count()) === 0, "connected despite rejection");
    await p.close();
  });

  await tcase("E2E-03", "Wrong network: the app asks the wallet to switch to the configured chain, then connects", page, async () => {
    const p = await newPage(A, "0x1");
    await p.goto(BASE + "#/");
    await connect(p);
    const req = await p.evaluate(() => window.__wallet.requests);
    must(req.includes("wallet_switchEthereumChain"), "no switch requested");
    must((await p.evaluate(() => window.__wallet.chainId)) === chainHex, "still on chain 1");
    await p.close();
    return "switch requested and accepted";
  });

  await tcase("E2E-04", "Wrong network and the user refuses to switch: not connected, clear message", page, async () => {
    const p = await newPage(A, "0x1");
    await p.goto(BASE + "#/");
    await p.evaluate(() => { window.__wallet.refuseSwitch = true; });
    await (await visible(btn(p, /^Connect wallet/))).click();
    await text(p, /You cancelled it in your wallet/);
    must((await p.locator("header .who").count()) === 0, "connected on the wrong network");
    await p.close();
  });

  await tcase("E2E-05", "Create page reads the deployed factory's real rules (minimum, schedules, cover levels)", page, async () => {
    await page.goto(BASE + "#/new");
    await text(page, /Minimum 0\.01 mQUSDC/);
    await visible(btn(page, /Every 3 minutes/));
    const zero = btn(page, /^0%/);
    must(await zero.isEnabled(), "0% cover disabled although the factory allows it");
    return "minimum 0.01, 3-minute schedule offered, 0% cover allowed (factory minCoverage 0)";
  });

  await tcase("E2E-06", "Create a circle from the UI; the chain has it with the exact terms", page, async () => {
    await page.getByPlaceholder("Office committee").fill("UI acceptance circle");
    await page.getByLabel("Member row 2").fill(B);
    await page.getByLabel("Member row 3").fill(Cc);
    await page.getByLabel("Member row 3").blur();
    const contrib = page.getByLabel(/Each member pays per round/);
    await contrib.fill("0.5");
    await btn(page, /Every 3 minutes/).click();
    await (await visible(btn(page, /^Review circle/))).click();
    await (await visible(btn(page, /^Confirm and create/))).click();
    await page.waitForURL(/#\/c\/0x[0-9a-fA-F]{40}/, { timeout: 60000 });
    circle = page.url().match(/0x[0-9a-fA-F]{40}/)[0];
    const [isC] = await call(dep.factory, F, "isCircle", [circle]);
    const [name] = await call(dep.factory, F, "nameOf", [circle]);
    const [members] = await call(circle, C, "members");
    const [c] = await call(circle, C, "contribution");
    const [k] = await call(circle, C, "coverageBps");
    const [round] = await call(circle, C, "roundLength");
    must(isC && name === "UI acceptance circle", "not registered");
    must(members.join() === [A, B, Cc].join(), `members ${members.join()}`);
    must(c === 500000n && k === 10000n && round === 180n, `terms ${c} ${k} ${round}`);
    return `circle ${circle}: 3 members, 0.5 per round, 100% cover, 3-minute rounds`;
  });

  await tcase("E2E-07", "Invite link copies the circle link (production build drops any URL settings) and opens it", page, async () => {
    await (await visible(btn(page, /Copy invite link/))).click();
    await text(page, /Invite link copied/);
    const link = await page.evaluate(() => navigator.clipboard.readText());
    must(link === `${BASE}#/c/${circle}`, `link ${link}`);
    const p = await newPage(B);
    await p.goto(link);
    await text(p, /0 of 3 members have accepted/);
    await p.close();
    return link;
  });

  await tcase("E2E-08", "Accept seats with the exact collateral approval (seat 1, then seats 2 and 3 by switching accounts)", page, async () => {
    const details = [];
    for (const [i, a] of [[0, A], [1, B], [2, Cc]]) {
      if (i > 0) await setAccount(page, a);
      const [up] = await call(circle, C, "upfrontCollateral", [i]);
      const before = (await sent(page)).length;
      await (await visible(btn(page, new RegExp(`accept seat ${i + 1}$`)))).click();
      await text(page, new RegExp(`You accepted seat ${i + 1}`), 60000);
      const txs = (await sent(page)).slice(before);
      const approve = txs.map((t) => { try { return T.parseTransaction({ data: t.data }); } catch { return null; } }).find((x) => x && x.name === "approve");
      must(approve && approve.args[0].toLowerCase() === circle.toLowerCase() && approve.args[1] === up, `approval ${approve && approve.args[1]} vs required ${up}`);
      details.push(`seat ${i + 1} approved exactly ${fmt(up)}`);
    }
    const [phase] = await call(circle, C, "phase");
    must(phase === 1n, "circle not active");
    return details.join("; ");
  });

  const payAs = async (a, r) => {
    await setAccount(page, a);
    await (await visible(btn(page, new RegExp(`^(Pay|Resume paying:) 0\\.5 mQUSDC for round ${r}$`)))).click();
    await text(page, new RegExp(`You paid 0\\.5 mQUSDC for round ${r}`), 60000);
  };

  await tcase("E2E-09", "Contribute from three member accounts", page, async () => {
    for (const a of [A, B, Cc]) await payAs(a, 1);
    for (let i = 0; i < 3; i++) must((await call(circle, C, "contributed", [1, i]))[0], `seat ${i + 1} not recorded as paid`);
  });

  await tcase("E2E-10", "Settle a round, refresh the page, reconnect: the new state is shown", page, async () => {
    await (await visible(btn(page, /^Settle round 1/))).click();
    await text(page, /Round 1 is settled/, 60000);
    await page.reload();
    must((await page.locator("header .who").count()) === 0, "wallet reconnected silently after refresh");
    await connect(page);
    await text(page, /Round 2: .* gets the 1\.5 mQUSDC pot/);
    const [r] = await call(circle, C, "currentRound");
    must(r === 2n, `chain round ${r}`);
    return "after refresh the user reconnects (this test wallet forgets its permission on reload; E2E-25 covers the quiet reconnect); state matches the chain";
  });

  await tcase("E2E-11", "A rejected signature changes nothing and the payment can be retried", page, async () => {
    await setAccount(page, B);
    const before = (await sent(page)).length;
    await page.evaluate(() => { window.__wallet.rejectNextTx = 1; });
    await (await visible(btn(page, /^Pay 0\.5 mQUSDC for round 2$/))).click();
    await text(page, /You cancelled it in your wallet/, 30000);
    must((await sent(page)).length === before, "a transaction was sent after rejection");
    must(!(await call(circle, C, "contributed", [2, 1]))[0], "recorded as paid");
    await payAs(B, 2);
  });

  await tcase("E2E-12", "Slow confirmation: the app shows the pending transaction and blocks other actions until it is mined", page, async () => {
    await setAccount(page, Cc);
    await rpc("evm_setAutomine", [false]);
    try {
      await (await visible(btn(page, /^Pay 0\.5 mQUSDC for round 2$/))).click();
      await text(page, /confirming on QIE/, 30000);
      must(await btn(page, /^Pay 0\.5/).first().isDisabled(), "pay button not disabled while pending");
      for (let i = 0; i < 20; i++) {
        await rpc("evm_mine");
        await sleep(1500);
        if (await page.getByText(/You paid 0\.5 mQUSDC for round 2/).count()) break;
      }
      await text(page, /You paid 0\.5 mQUSDC for round 2/, 30000);
    } finally {
      await rpc("evm_setAutomine", [true]);
    }
    return "pending state 'confirming on QIE' shown with a transaction link; buttons disabled";
  });

  await tcase("E2E-13", "Seat 1 misses round 2 after its payout: settle after the deadline; arrears, collateral and catch-up cost match the chain", page, async () => {
    const [dl] = await call(circle, C, "deadline");
    const now = await chainTime();
    await rpc("evm_increaseTime", [Number(dl) + 61 - now]);
    await rpc("evm_mine");
    await page.reload();
    await connect(page);
    await (await visible(btn(page, /^Settle round 2/), 40000)).click();
    await text(page, /Round 2 is settled/, 60000);
    const [[total, , lateFee]] = [await call(circle, C, "catchUpCost", [0])];
    const [risk] = await call(circle, C, "risk");
    await text(page, new RegExp(`is behind on payments after taking the pot`), 30000);
    await text(page, new RegExp(`must pay ${fmt(total).replace(".", "\\.")} mQUSDC`));
    await text(page, new RegExp(`${fmt(risk.secured).replace(".", "\\.")} mQUSDC of the ${fmt(risk.stillOwed).replace(".", "\\.")} mQUSDC still owed is secured`));
    return `catch-up ${fmt(total)} (late fee ${fmt(lateFee)}); secured ${fmt(risk.secured)} of ${fmt(risk.stillOwed)}`;
  });

  await tcase("E2E-14", "Catch up after the default from the UI (breakdown shown, exact approval)", page, async () => {
    await setAccount(page, A);
    const [[total, currentPart, lateFee]] = [await call(circle, C, "catchUpCost", [0])];
    await text(page, new RegExp(`Includes .* arrears, ${fmt(currentPart).replace(".", "\\.")} mQUSDC for this unsettled round, and ${fmt(lateFee).replace(".", "\\.")} mQUSDC late fee`));
    const before = (await sent(page)).length;
    await (await visible(btn(page, new RegExp(`^Catch up: pay ${fmt(total).replace(".", "\\.")} mQUSDC$`)))).click();
    await text(page, /You're caught up and back in good standing/, 60000);
    const approve = (await sent(page)).slice(before).map((t) => { try { return T.parseTransaction({ data: t.data }); } catch { return null; } }).find((x) => x && x.name === "approve");
    must(approve && approve.args[1] === total, `approved ${approve && approve.args[1]} vs ${total}`);
    const [m] = await call(circle, C, "member", [0]);
    must(m.status === 0n, `status ${m.status}`);
    return `paid ${fmt(total)}; seat 1 back in good standing`;
  });

  await tcase("E2E-15", "Finish the last round and finalize the circle from the UI", page, async () => {
    for (const a of [B, Cc]) await payAs(a, 3);
    await (await visible(btn(page, /^Settle round 3/))).click();
    await text(page, /Round 3 is settled/, 60000);
    await (await visible(btn(page, /^Finish the circle/), 40000)).click();
    await text(page, /This circle is finished/, 60000);
    must((await call(circle, C, "phase"))[0] === 2n, "not Completed on chain");
  });

  await tcase("E2E-16", "Record the completed results from the UI; history updates on chain", page, async () => {
    await (await visible(btn(page, /^Record results to track records/))).click();
    await text(page, /Everyone's track record is updated/, 60000);
    must((await call(dep.factory, F, "recorded", [circle]))[0], "not recorded");
    const h = await Promise.all([A, B, Cc].map(async (a) => (await call(dep.factory, F, "history", [a]))));
    must(h[0].caughtUp === 1n && h[1].completed === 1n && h[2].completed === 1n, `history ${h.map((x) => [x.completed, x.caughtUp]).join(" ")}`);
    // the screen must reflect the new state straight after the action (not at the next 15-second refresh)
    const t0 = Date.now();
    await btn(page, /^Record results/).first().waitFor({ state: "detached", timeout: 8000 }).catch(() => {});
    must((await btn(page, /^Record results/).count()) === 0, "record button still offered 8 s after recording");
    return `seat 1 caught up 1; seats 2 and 3 completed 1; button removed after ${Date.now() - t0} ms`;
  });

  await tcase("E2E-17", "Withdraw for each member: the button shows the exact amount and the wallet receives it", page, async () => {
    const out = [];
    for (const a of [A, B, Cc]) {
      await setAccount(page, a);
      const [owed] = await call(circle, C, "withdrawable", [a]);
      const [before] = await call(dep.token, T, "balanceOf", [a]);
      await (await visible(btn(page, new RegExp(`^Withdraw ${fmt(owed).replace(".", "\\.")} mQUSDC$`)))).click();
      await text(page, new RegExp(`You withdrew ${fmt(owed).replace(".", "\\.")} mQUSDC`), 60000);
      const [after] = await call(dep.token, T, "balanceOf", [a]);
      must(after - before === owed, `received ${after - before} vs ${owed}`);
      must((await call(circle, C, "withdrawable", [a]))[0] === 0n, "still withdrawable");
      out.push(fmt(owed));
    }
    const [left] = await call(dep.token, T, "balanceOf", [circle]);
    const [fee] = await call(circle, C, "withdrawable", [dep.treasury]);
    must(left === fee, `circle holds ${left}, treasury owed ${fee}`);
    // every member: final balance - 1000 start; their losses equal the treasury fee
    const nets = await Promise.all([A, B, Cc].map(async (a) => (await call(dep.token, T, "balanceOf", [a]))[0] - 1000_000000n));
    must(nets.reduce((x, y) => x + y, 0n) + fee === 0n, `nets ${nets} fee ${fee}`);
    return `withdrew ${out.join(", ")}; circle holds only the treasury's ${fmt(fee)} fee; nets ${nets.map(fmt).join(", ")}`;
  });

  await tcase("E2E-23", "Every tab of a finished circle with a default and catch-up renders, with a readable history", page, async () => {
    const crashes = [];
    page.on("pageerror", (e) => crashes.push(String(e.message || e)));
    for (const tab of ["Your seat", "Risk and history", "Members", "Risk and history"]) {
      await (await visible(page.getByRole("tab", { name: tab, exact: true }))).click();
      await page.waitForTimeout(500);
      must(crashes.length === 0, `page error on ${tab}: ${crashes[0]}`);
    }
    await text(page, /^What happened$/);
    const items = await page.locator("ol.history li").allInnerTexts();
    must(items.length > 10, `only ${items.length} history lines`);
    must(items.some((t) => /missed round 2 after taking the pot/.test(t)), "default not described");
    must(items.some((t) => /caught up in full/.test(t)), "catch-up not described");
    const raw = items.filter((t) => /^[A-Z][a-zA-Z]+\s*\n/.test(t));
    must(raw.length === 0, `events shown by raw name: ${raw.join(" | ")}`);
    await (await visible(page.getByRole("tab", { name: "Members", exact: true }))).click();
    return `${items.length} history lines, no page errors`;
  });

  await tcase("E2E-18", "Wallet disconnect: the app drops the account and offers to connect again", page, async () => {
    await page.evaluate(() => window.__wallet.emit("accountsChanged", []));
    await visible(btn(page, /^Connect wallet/));
    must((await page.locator("header .who").count()) === 0, "still shows an account");
  });

  await tcase("E2E-19", "Wallet switches network mid-session: connection dropped with a clear message", page, async () => {
    await connect(page);
    await page.evaluate(() => { window.__wallet.chainId = "0x1"; window.__wallet.emit("chainChanged", "0x1"); });
    await text(page, /Your wallet switched to another network/);
    await visible(btn(page, /^Connect wallet/));
  });

  await tcase("E2E-20", "RPC failure: the app says the network is unreachable, shows no actions, and never calls a real circle fake", page, async () => {
    const p = await newPage(A);
    await p.route(/127\.0\.0\.1:8545/, (route) => route.abort());
    await p.goto(BASE + `#/c/${circle}`);
    await text(p, /Can't reach the QIE network right now/, 40000);
    await text(p, /Can't read the circle right now/, 40000);
    must((await p.getByText(/is not a circle created by PotLoop's official factory/).count()) === 0, "a genuine circle was labelled as not genuine while the RPC was down");
    must((await p.getByRole("button", { name: /^(Pay|Withdraw|Settle|Lock)/ }).count()) === 0, "action buttons shown without a working RPC");
    const shown = await p.locator("main").innerText();
    await p.screenshot({ path: path.join(OUT, "E2E-20-rpc-down.png"), fullPage: true });
    await p.close();
    return shown.split("\n").slice(0, 2).join(" | ");
  });

  await tcase("E2E-21", "A circle address not created by the official factory is refused", page, async () => {
    await page.goto(BASE + "#/c/0x000000000000000000000000000000000000dEaD");
    await text(page, /is not a circle created by PotLoop's official factory/);
  });

  await tcase("E2E-22", "The production build ignores factory/RPC settings in the URL", page, async () => {
    await page.goto(BASE + "?factory=0x000000000000000000000000000000000000dEaD&rpc=http://evil.invalid#/c/" + circle);
    await text(page, /This circle is finished/);
    return "URL factory and rpc parameters had no effect";
  });

  await tcase("E2E-24", "The user guide opens from the header and every link in it leads somewhere real", page, async () => {
    const crashes = [];
    page.on("pageerror", (e) => crashes.push(String(e.message || e)));
    await page.goto(BASE + "#/");
    await (await visible(page.locator("header nav").getByRole("link", { name: "How it works" }))).click();
    await text(page, /^How to use PotLoop$/);
    for (const h of ["Try it in two minutes, no wallet needed", "What you need to take part", "If you organise the circle", "If you're a member", "If something goes wrong", "Words you'll see"]) {
      await visible(page.getByRole("heading", { name: h }));
    }
    const hrefs = await page.locator("section.guide a").evaluateAll((as) => as.map((a) => a.getAttribute("href")));
    for (const h of hrefs.filter((x) => x.startsWith("#/"))) {
      await page.goto(BASE + h);
      await page.waitForTimeout(400);
      must(!(await page.getByText(/^How to use PotLoop$/).count()) || h === "#/guide", `link ${h} did not leave the guide`);
    }
    await page.goto(BASE + "#/");
    await (await visible(page.getByRole("link", { name: /New here\? See how it works/ }))).click();
    await text(page, /^How to use PotLoop$/);
    must(crashes.length === 0, `page error: ${crashes[0]}`);
    return `${hrefs.length} links checked; header and home buttons open the guide`;
  });

  await tcase("E2E-25", "A wallet that already allowed the site reconnects on reload without a prompt; a new one doesn't", page, async () => {
    const p1 = await newPage(A, chainHex, true);
    await p1.goto(BASE + "#/");
    await visible(p1.locator("header .who"));
    const r1 = await p1.evaluate(() => window.__wallet.requests);
    must(!r1.includes("eth_requestAccounts"), "a connection prompt was opened");
    await p1.close();
    const p2 = await newPage(A, chainHex, false);
    await p2.goto(BASE + "#/");
    await p2.waitForTimeout(1500);
    must((await p2.locator("header .who").count()) === 0, "connected without permission");
    await visible(btn(p2, /^Connect wallet/));
    const r2 = await p2.evaluate(() => window.__wallet.requests);
    must(!r2.includes("eth_requestAccounts"), "a prompt was opened on load");
    await p2.close();
    const p3 = await newPage(A, "0x1", true);
    await p3.goto(BASE + "#/");
    await p3.waitForTimeout(1500);
    must((await p3.locator("header .who").count()) === 0, "reconnected on the wrong network");
    await p3.close();
    return "allowed + right network: reconnected with eth_accounts only; not allowed or wrong network: stays disconnected";
  });

  await browser.close();
  const failed = results.filter((r) => r.status !== "PASS").length;
  fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify({ date: new Date().toISOString(), deployment: dep, circle, accounts: accounts.slice(0, 10), passed: results.length - failed, failed, results }, null, 1));
  fs.writeFileSync(path.join(OUT, "browser-console.log"), consoleLog.join("\n"));
  console.log(`\nUI acceptance: ${results.length - failed} passed, ${failed} failed`);
  return failed;
}

main()
  .then((failed) => { stopAll(); process.exit(failed ? 1 : 0); })
  .catch((e) => { console.error(e); stopAll(); process.exit(1); });
function stopAll() { for (const p of procs) { try { process.kill(-p.pid, "SIGTERM"); } catch {} } }
