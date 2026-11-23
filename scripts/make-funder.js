// Creates a new TEST wallet on this computer to run the mainnet tests, so your main QIE Wallet's
// key never has to leave the extension. The key is saved to funder-wallet.json (git-ignored) and
// is never printed. Send this wallet only what the tests need.
//   node scripts/make-funder.js
// Then load it into this PowerShell window without showing it:
//   $env:DEPLOYER_PRIVATE_KEY = (Get-Content funder-wallet.json | ConvertFrom-Json).privateKey
const fs = require("fs");
const path = require("path");
const { Wallet } = require("ethers");

const file = path.join(__dirname, "..", "funder-wallet.json");
if (fs.existsSync(file)) {
  console.log(`funder-wallet.json already exists; keeping it. Test wallet address: ${JSON.parse(fs.readFileSync(file, "utf8")).address}`);
  process.exit(0);
}
const w = Wallet.createRandom();
fs.writeFileSync(file, JSON.stringify({ address: w.address, privateKey: w.privateKey }, null, 2));
console.log(`Test wallet created: ${w.address}`);
console.log(`Its key is in funder-wallet.json on this computer only. Never share that file.`);
