// Builds the release package from an allowlist, runs the secret scan on exactly what will be
// shipped, and refuses to produce a ZIP if the scan fails.
//   node scripts/package-release.js            -> release/potloop-v9.3-release.zip + release/MANIFEST.txt
// Never included: node_modules, artifacts, cache, app/dist, .git, wallet files, .env files, nested
// archives, local state such as testnet-deployment.json.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const NAME = process.env.RELEASE_NAME || "potloop-v9.3-release";
const OUTDIR = path.join(ROOT, "release");
const STAGE = path.join(OUTDIR, NAME);
const INCLUDE = ["contracts", "test", "scripts", "app", "docs", "mainnet-runs", "evidence", "hardhat.config.js", "package.json", "package-lock.json", ".gitignore"];
const EXCLUDE_DIRS = new Set(["node_modules", "artifacts", "cache", "dist", "e2e-dist", ".git", "coverage", "typechain-types", "release"]);
const EXCLUDE_FILES = [/wallets?[^\\/]*\.json$/i, /(^|[\\/])\.env(\.(?!example$)[^\\/]*)?$/i, /\.(zip|tgz|tar|gz|7z|rar)$/i, /testnet-deployment\.json$/i, /app[\\/]e2e[\\/]deployment\.json$/i, /receipts-cache\.json$/i, /section-[a-z]+\.json$/i, /\.sync-[^\\/]*$/i, /(^|[\\/])_[^\\/]*\.js$/];

function copy(rel) {
  const src = path.join(ROOT, rel);
  if (!fs.existsSync(src)) return;
  const st = fs.statSync(src);
  if (st.isDirectory()) {
    if (EXCLUDE_DIRS.has(path.basename(rel))) return;
    for (const e of fs.readdirSync(src)) copy(path.join(rel, e));
    return;
  }
  if (EXCLUDE_FILES.some((r) => r.test(rel))) return;
  fs.mkdirSync(path.dirname(path.join(STAGE, rel)), { recursive: true });
  fs.copyFileSync(src, path.join(STAGE, rel));
}

fs.rmSync(STAGE, { recursive: true, force: true });
fs.mkdirSync(STAGE, { recursive: true });
for (const rel of INCLUDE) copy(rel);
for (const f of fs.readdirSync(ROOT)) if (/\.(md|csv)$/i.test(f)) copy(f);

// the scan runs on the staged copy, so it checks exactly what ships
try {
  execFileSync(process.execPath, [path.join(__dirname, "release-scan.js"), STAGE], { stdio: "inherit", env: { ...process.env, NODE_PATH: path.join(ROOT, "node_modules") } });
} catch {
  console.error("package-release: STOPPED. The secret scan failed; no archive was written.");
  process.exit(1);
}

const list = [];
(function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else list.push(p); } })(STAGE);
list.sort();
const manifest = list.map((p) => `${crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex")}  ${fs.statSync(p).size}  ${path.relative(STAGE, p).split(path.sep).join("/")}`);
fs.writeFileSync(path.join(OUTDIR, "MANIFEST.txt"), manifest.join("\n") + "\n");
const zip = path.join(OUTDIR, `${NAME}.zip`);
fs.rmSync(zip, { force: true });
execFileSync("zip", ["-qr", zip, NAME], { cwd: OUTDIR });
fs.writeFileSync(`${zip}.sha256`, `${crypto.createHash("sha256").update(fs.readFileSync(zip)).digest("hex")}  ${NAME}.zip\n`);
console.log(`package-release: ${list.length} files -> ${path.relative(ROOT, zip)} (${fs.statSync(zip).size} bytes); manifest in release/MANIFEST.txt`);
