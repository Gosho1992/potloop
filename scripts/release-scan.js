// Pre-release secret scan. Exits 1 if anything that looks like signing material or a credential is
// found. It never prints a secret: only the file, the line number and which rule matched.
//   node scripts/release-scan.js [dir]          (default: the project folder)
// Rules:
//   1. forbidden files: wallet key files, .env files (not .env.example), key stores, PEM/key files,
//      nested archives (.zip/.tgz/.tar/.gz) that the scan cannot look inside
//   2. key-shaped fields: "privateKey"/"mnemonic"/"seed"/"secret" with a value, PRIVATE_KEY=<64 hex>,
//      PEM private-key blocks, common API-token prefixes
//   3. any 32-byte hex value whose secp256k1 address appears anywhere in the scanned files is a
//      private key of a wallet the project uses (transaction hashes never derive to a known address)
const fs = require("fs");
const path = require("path");
let computeAddress;
try { ({ computeAddress } = require("ethers")); } catch { computeAddress = null; }

const root = path.resolve(process.argv[2] || path.join(__dirname, ".."));
const SKIP_DIRS = new Set(["node_modules", ".git", "artifacts", "cache", "dist", "coverage", "typechain-types"]);
const FORBIDDEN = [
  [/(^|[\\/])[^\\/]*wallets?[^\\/]*\.json$/i, "wallet key file"],
  [/(^|[\\/])\.env(\.[^\\/]*)?$/i, ".env file"],
  [/(^|[\\/])(keystore|keystores)([\\/]|$)/i, "key store"],
  [/\.(pem|key|p12|pfx|keystore)$/i, "key file"],
  [/\.(zip|tgz|tar|gz|7z|rar)$/i, "nested archive (cannot be scanned)"],
  [/(^|[\\/])id_(rsa|ed25519|ecdsa)$/i, "SSH key"],
];
const ALLOWED = [/(^|[\\/])\.env\.example$/i];
const CONTENT = [
  [/"(privateKey|private_key|mnemonic|seed|seedPhrase|secret|apiKey)"\s*:\s*"[^"]{8,}"/i, "key-shaped JSON field"],
  [/PRIVATE_KEY\s*[=:]\s*["']?(0x)?[0-9a-fA-F]{64}\b/, "PRIVATE_KEY assignment with a 64-hex value"],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, "PEM private key"],
  [/\b(sk-[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{10,})\b/, "API token"],
];

const files = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const full = path.join(d, e.name);
    const isDir = e.isDirectory() || (e.isSymbolicLink() && fs.statSync(full, { throwIfNoEntry: false })?.isDirectory());
    if (isDir) { if (!SKIP_DIRS.has(e.name)) walk(full); continue; }
    if (!fs.statSync(full, { throwIfNoEntry: false })) continue; // broken link
    files.push(path.join(d, e.name));
  }
})(root);

const findings = [];
const addresses = new Set();
const hexes = new Map(); // hex -> first location
for (const f of files) {
  const rel = path.relative(root, f);
  if (!ALLOWED.some((r) => r.test(rel))) for (const [re, why] of FORBIDDEN) if (re.test(rel)) findings.push({ file: rel, line: "", rule: why });
  const st = fs.statSync(f);
  if (st.size > 20 * 1024 * 1024) continue;
  const buf = fs.readFileSync(f);
  if (buf.includes(0)) continue; // binary
  const lines = buf.toString("utf8").split("\n");
  lines.forEach((l, i) => {
    for (const [re, why] of CONTENT) if (re.test(l)) findings.push({ file: rel, line: i + 1, rule: why });
    for (const m of l.matchAll(/0x[0-9a-fA-F]{40}(?![0-9a-fA-F])/g)) addresses.add(m[0].toLowerCase());
    for (const m of l.matchAll(/(?<![0-9a-fA-F])(0x)?([0-9a-fA-F]{64})(?![0-9a-fA-F])/g)) if (!hexes.has(m[2].toLowerCase())) hexes.set(m[2].toLowerCase(), `${rel}:${i + 1}`);
  });
}
let derived = 0;
if (computeAddress) {
  for (const [h, where] of hexes) {
    try {
      const a = computeAddress("0x" + h).toLowerCase();
      derived++;
      if (addresses.has(a)) findings.push({ file: where.split(":")[0], line: where.split(":")[1], rule: `private key of an address used in this package (${a})` });
    } catch {}
  }
}

console.log(`release-scan: ${files.length} files, ${hexes.size} 32-byte hex values checked against ${addresses.size} addresses${computeAddress ? "" : " (ethers not found: key derivation check skipped)"}`);
if (findings.length) {
  for (const x of findings) console.log(`  FAIL ${x.file}${x.line ? ":" + x.line : ""}  ${x.rule}`);
  console.log(`release-scan: ${findings.length} finding(s). Nothing may be packaged until they are removed.`);
  process.exit(1);
}
if (!computeAddress) { console.log("release-scan: FAIL (install dependencies so the key-derivation check can run)"); process.exit(1); }
console.log("release-scan: PASS (no key material, credentials or nested archives)");
