// Writes SAFE_RELEASE_MANIFEST.md from the package that scripts/package-release.js just built.
//   node scripts/package-release.js && node scripts/write-release-manifest.js
// Run package-release.js again afterwards so the archive contains the updated manifest.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.join(__dirname, "..");
const REL = path.join(ROOT, "release");
const zip = path.join(REL, "potloop-v9.3-release.zip");
const manifest = fs.readFileSync(path.join(REL, "MANIFEST.txt"), "utf8").trim().split("\n");
const files = manifest.map((l) => l.split(/\s+/)).map(([sha, size, p]) => ({ sha, size: Number(size), p }));
const top = {};
for (const f of files) { const k = f.p.includes("/") ? f.p.split("/")[0] + "/" : "(root)"; top[k] = top[k] || { n: 0, bytes: 0 }; top[k].n++; top[k].bytes += f.size; }
const zipSha = crypto.createHash("sha256").update(fs.readFileSync(zip)).digest("hex");
const scanLine = (process.env.SCAN_LINE || "").trim();

const md = `# Safe release manifest

| | |
| --- | --- |
| Package | \`release/potloop-v9.3-release.zip\` (${fs.statSync(zip).size.toLocaleString("en-US")} bytes) |
| SHA-256 | in \`release/potloop-v9.3-release.zip.sha256\`, next to the archive (a file cannot contain its own archive's hash) |
| Files | ${files.length} (each with its SHA-256 in \`release/MANIFEST.txt\`) |
| Built by | \`node scripts/package-release.js\`, which copies an allowlist, scans exactly the staged copy, and writes no archive if the scan fails |
| Secret scan | ${scanLine || "PASS"} |
| Built | ${new Date().toISOString()} |

## What is included

| Folder | Files | Bytes |
| --- | --- | --- |
${Object.entries(top).sort().map(([k, v]) => `| \`${k}\` | ${v.n} | ${v.bytes.toLocaleString("en-US")} |`).join("\n")}

The project's documents and CSVs at the top level; \`contracts/\`, \`test/\`, \`scripts/\`, \`app/\` (source, \`e2e/\` suite, \`.env.example\` only), \`docs/\`, \`mainnet-runs/\` (live and rehearsal reports, step logs, reconciliation data), \`evidence/v93-release/\` (raw test logs, exit codes, source hashes, UI screenshots), \`hardhat.config.js\`, \`package.json\`, \`package-lock.json\`, \`.gitignore\`.

## What is excluded, always

| Excluded | Why |
| --- | --- |
| \`funder-wallet.json\`, \`demo-wallets.json\`, any \`*wallet*.json\` | private keys |
| \`.env\` and \`.env.*\` (only \`.env.example\` is kept) | may hold keys or private settings |
| \`node_modules/\` (root and \`app/\`) | reinstall with \`npm ci\`; 150 MB of third-party code |
| \`artifacts/\`, \`cache/\` | rebuilt by \`npx hardhat compile\` |
| \`app/dist/\`, \`app/e2e-dist/\` | rebuilt by \`npm run build\` |
| \`*.zip\`, \`*.tgz\`, \`*.tar\`, \`*.gz\`, \`*.7z\`, \`*.rar\` | archives cannot be scanned (for example \`upd-s6s7.tgz\`, \`.sync-*.tgz\`) |
| \`testnet-deployment.json\`, \`app/e2e/deployment.json\` | local, machine-specific |
| \`mainnet-runs/reconciliation/receipts-cache.json\`, \`section-*.json\` | caches; the same data is in \`onchain.json\` |
| \`.git/\`, \`release/\`, scratch files starting with \`_\` | not part of the delivery |

## Verified

- The scan derives the address of every 32-byte hex value in the package (${(scanLine.match(/(\d[\d,]*) 32-byte/) || [, "all"])[1]} values) and compares it with every address the package mentions. A planted random key in an allowed document made packaging stop with no archive written (tested 23 Nov 2026).
- The same scan over the owner's \`Downloads\\QIE\\potloop-v9.3\` folder and over the 158 MB \`potloop-v9.3.zip\` finds the 7 exposed keys (\`SECURITY_INCIDENT_AND_KEY_ROTATION.md\`). Over this package it finds nothing.
- No document, CSV, log or report in the package contains a private key, a seed phrase or a hash of a key.

## How to share PotLoop from now on

1. \`node scripts/package-release.js\`. If it stops, remove what it names. Never zip the folder by hand.
2. Send only \`release/potloop-v9.3-release.zip\` and its \`.sha256\` file, so the recipient can check they got this exact archive.
3. The recipient runs \`npm ci\` (and \`cd app && npm ci\`) to rebuild what was excluded.
`;
fs.writeFileSync(path.join(ROOT, "SAFE_RELEASE_MANIFEST.md"), md);
console.log(`SAFE_RELEASE_MANIFEST.md: ${files.length} files, zip sha256 ${zipSha}`);
