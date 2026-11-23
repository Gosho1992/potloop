// Verifies a built release package from the outside:
//   node scripts/verify-release.js [release/potloop-v9.3-release.zip]
// 1. the archive's SHA-256 matches its .sha256 file
// 2. extracted into a fresh temporary folder, every file matches release/MANIFEST.txt (path, size, SHA-256),
//    with nothing missing and nothing extra
// 3. the 14 release documents and the required source and evidence files are present
// 4. no forbidden file is inside (wallet files, .env, node_modules, artifacts, archives)
// 5. the secret scan passes on the extracted copy
// Exit code 1 on any failure.
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const zip = path.resolve(process.argv[2] || path.join(ROOT, "release", "potloop-v9.3-release.zip"));
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");
const fails = [];
const ok = (cond, msg) => { console.log(`  ${cond ? "PASS" : "FAIL"} ${msg}`); if (!cond) fails.push(msg); };

const shaFile = `${zip}.sha256`;
ok(fs.existsSync(shaFile) && fs.readFileSync(shaFile, "utf8").split(/\s+/)[0] === sha(fs.readFileSync(zip)), "archive SHA-256 matches its .sha256 file");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "potloop-verify-"));
execFileSync("unzip", ["-q", zip, "-d", tmp]);
const [top] = fs.readdirSync(tmp);
const base = path.join(tmp, top);
const extracted = [];
(function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else extracted.push(path.relative(base, p).split(path.sep).join("/")); } })(base);

const manifest = fs.readFileSync(path.join(path.dirname(zip), "MANIFEST.txt"), "utf8").trim().split("\n").map((l) => { const [h, size, ...rest] = l.split(/\s+/); return { h, size: Number(size), p: rest.join(" ") }; });
const byPath = new Map(manifest.map((m) => [m.p, m]));
let mismatched = 0;
for (const p of extracted) {
  const m = byPath.get(p);
  const buf = fs.readFileSync(path.join(base, p));
  if (!m || m.size !== buf.length || m.h !== sha(buf)) mismatched++;
}
const missing = manifest.filter((m) => !extracted.includes(m.p)).length;
ok(mismatched === 0 && missing === 0 && extracted.length === manifest.length, `all ${extracted.length} extracted files match the manifest (path, size, SHA-256); ${missing} missing, ${mismatched} mismatched or extra`);

const DOCS = ["SECURITY_INCIDENT_AND_KEY_ROTATION.md", "SAFE_RELEASE_MANIFEST.md", "MAINNET_DEPLOYMENT_RECONCILIATION.md", "MAINNET_RUN_ATTEMPTS.csv", "MAINNET_CIRCLES.csv", "MAINNET_TRANSACTIONS.csv", "MAINNET_FINANCIAL_RECONCILIATION.md", "MAINNET_EVIDENCE_CORRECTIONS.md", "POTLOOP_UAT_PLAN.md", "UAT_TEST_CASES.csv", "UI_E2E_REPORT.md", "LOCAL_FORK_EDGE_CASE_REPORT.md", "PRODUCTION_FACTORY_RECOMMENDATION.md", "FINAL_RELEASE_READINESS.md"];
const missingDocs = DOCS.filter((d) => !extracted.includes(d));
ok(missingDocs.length === 0, `all 14 release documents present${missingDocs.length ? `; missing: ${missingDocs.join(", ")}` : ""}`);

const REQUIRED = ["contracts/SavingsCircle.sol", "contracts/CircleFactory.sol", "contracts/CircleDeployer.sol", "test/ReleaseAcceptance.test.js", "test/helpers.js", "scripts/release-scan.js", "scripts/package-release.js", "scripts/reconcile-mainnet.js", "scripts/build-mainnet-reports.js", "scripts/run-release-evidence.sh", "app/e2e/run-e2e.cjs", "app/src/chain.js", "app/.env.example", "hardhat.config.js", "package.json", "package-lock.json", "app/package-lock.json", "mainnet-runs/reconciliation/onchain.json", "mainnet-runs/reconciliation/token-flows.json", "mainnet-runs/reconciliation/fork-record.json", "evidence/v93-release/SUMMARY.txt", "evidence/v93-release/SOURCE_HASHES.txt", "evidence/v93-release/ui-e2e/results.json", "README.md"];
const missingReq = REQUIRED.filter((r) => !extracted.includes(r));
ok(missingReq.length === 0, `required source and evidence files present${missingReq.length ? `; missing: ${missingReq.join(", ")}` : ""}`);
const runs = extracted.filter((p) => /^mainnet-runs\/live-S\d-.*\.json$/.test(p)).length;
ok(runs === 7, `all 7 live mainnet run reports present (${runs})`);
const exhaustiveLogs = extracted.filter((p) => /^evidence\/v93-release\/11[a-e]?-exhaustive/.test(p)).length;
ok(exhaustiveLogs >= 5, `exhaustive suite logs present (${exhaustiveLogs})`);

const forbidden = extracted.filter((p) => /wallets?[^/]*\.json$/i.test(p) || /(^|\/)\.env(\.(?!example$)[^/]*)?$/i.test(p) || /(^|\/)(node_modules|artifacts|cache|dist|e2e-dist)\//.test(p) || /\.(zip|tgz|tar|gz|7z|rar)$/i.test(p));
ok(forbidden.length === 0, `no wallet files, .env files, node_modules, build output or archives${forbidden.length ? `: ${forbidden.join(", ")}` : ""}`);

let scan = "";
try { scan = execFileSync(process.execPath, [path.join(__dirname, "release-scan.js"), base], { env: { ...process.env, NODE_PATH: path.join(ROOT, "node_modules") } }).toString(); ok(true, `secret scan on the extracted copy: ${scan.trim().split("\n").pop()}`); }
catch (e) { ok(false, `secret scan on the extracted copy failed: ${String(e.stdout || e.message).slice(-400)}`); }
console.log(`  (${scan.trim().split("\n")[0] || ""})`);

fs.rmSync(tmp, { recursive: true, force: true });
console.log(fails.length ? `verify-release: ${fails.length} FAILED` : "verify-release: ALL PASS");
process.exit(fails.length ? 1 : 0);
