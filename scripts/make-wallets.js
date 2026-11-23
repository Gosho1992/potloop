// Creates demo member wallets on YOUR computer and saves them to demo-wallets.json
// (that file is git-ignored; never share it or commit it).
//   node scripts/make-wallets.js 4
const fs = require("fs");
const path = require("path");
const { Wallet } = require("ethers");

const n = Number(process.argv[2] || 4);
const file = path.join(__dirname, "..", "demo-wallets.json");
if (fs.existsSync(file)) {
  console.log(`demo-wallets.json already exists; keeping it. Addresses:`);
  for (const w of JSON.parse(fs.readFileSync(file, "utf8"))) console.log(`  ${w.name}: ${w.address}`);
  process.exit(0);
}
const names = ["Sipho", "Thandi", "Ayesha", "Bilal", "Naledi", "Farah", "Kofi", "Mei"];
const out = [];
for (let i = 0; i < n; i++) {
  const w = Wallet.createRandom();
  out.push({ name: names[i] || `Member ${i + 1}`, address: w.address, privateKey: w.privateKey });
}
fs.writeFileSync(file, JSON.stringify(out, null, 2));
console.log(`Saved ${n} demo wallets to demo-wallets.json (keep it private):`);
for (const w of out) console.log(`  ${w.name}: ${w.address}`);
