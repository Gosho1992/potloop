// Mutation check for the simulator parity test and the rule checks in test/circleRunner.js.
// Simulator mutations copy app/src/sim.js with one deliberate accounting error and run
// test/Sim.parity.test.js against the copy (SIM_PATH): parity must FAIL.
// Shared mutations put the SAME error into the contract AND the simulator, in a temporary copy of
// the project. Parity cannot see a shared error; the independent rule checks (R1–R3) must FAIL.
// A mutation the tests do not catch is reported as "SURVIVED" and the script exits with code 1.
//
//   node scripts/mutation-sim.mjs            (about 1 minute per mutation)
//   PARITY_RUNS=40 node scripts/mutation-sim.mjs
import { readFileSync, writeFileSync, mkdtempSync, cpSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const root = new URL("..", import.meta.url).pathname;
const src = readFileSync(new URL("../app/src/sim.js", import.meta.url), "utf8");
const sol = readFileSync(new URL("../contracts/SavingsCircle.sol", import.meta.url), "utf8");
const mutations = [
  ["late fee 3% instead of 2%", "export const LATE_FEE_BPS = 200n;", "export const LATE_FEE_BPS = 300n;"],
  ["collateral rounds down instead of up", "return (later * BigInt(c) * BigInt(k) + 9999n) / 10000n;", "return (later * BigInt(c) * BigInt(k)) / 10000n;"],
  ["leaving early costs half a share", "const penalty = claim < c ? claim : c;", "const penalty = claim < c ? claim : c / 2n;"],
  ["service fee rounds up", "const f = (gross * fee) / 10000n;", "const f = (gross * fee + 9999n) / 10000n;"],
  ["held-from-pot target is the next seat's collateral", "const target = collateralFor(n, c, k, i);", "const target = collateralFor(n, c, k, Math.min(i + 1, n - 1));"],
  ["held-from-pot target set by the round the money arrives in (the v9.2 rule)", "if (fromPayout && stillOwesAPayment(i, r)) {\n      const target = collateralFor(n, c, k, i);", "if (fromPayout && r < n) {\n      const target = (BigInt(n - r) * c * BigInt(k) + 9999n) / 10000n;"],
  ["newest debts repaid first", "for (let i = 0; i < n && freeReserve > 0n; i++) {", "for (let i = n - 1; i >= 0 && freeReserve > 0n; i--) {"],
  ["no netting at finalize", "const netted = ent < owes ? ent : owes;", "const netted = 0n;"],
  ["collateral pays everything at once", "const take = x.collateral < c ? x.collateral : c;", "const take = x.collateral;"],
  ["catch-up skips an expired unsettled round", "const currentPart = !allRoundsSettled && !contributed.has(`${currentRound}:${i}`) ? c : 0n;", "const currentPart = 0n;"],
  ["leftover reserve loses its remainder unit", "const extra = rem > 0n ? 1n : 0n;", "const extra = 0n;"],
  ["catch-up sends only half of the uncovered part to the reserve", "freeReserve += uncovered + lateFee;", "freeReserve += uncovered / 2n + lateFee;"],
];

// [name, simulator from, to, contract from, to]: the same error in both
const shared = [
  [
    "contract AND simulator: target set by the round the money arrives in (the v9.2 rule)",
    "if (fromPayout && stillOwesAPayment(i, r)) {\n      const target = collateralFor(n, c, k, i);",
    "if (fromPayout && r < n) {\n      const target = (BigInt(n - r) * c * BigInt(k) + 9999n) / 10000n;",
    "if (collateralFromPayout && !allRoundsSettled && !(r == size && contributed[r][i])) {\n            Member storage mem = _m[i];\n            uint256 target = collateralFor(i);",
    "if (collateralFromPayout && r < size) {\n            Member storage mem = _m[i];\n            uint256 target = ((size - r) * contribution * coverageBps + 9999) / 10000;",
  ],
  [
    "contract AND simulator: repayments never top collateral up",
    "if (fromPayout && stillOwesAPayment(i, r)) {",
    "if (fromPayout && stillOwesAPayment(i, r) && x0(i)) {",
    "if (collateralFromPayout && !allRoundsSettled && !(r == size && contributed[r][i])) {",
    "if (collateralFromPayout && !allRoundsSettled && !(r == size && contributed[r][i]) && r == i + 1) {",
  ],
  [
    "contract AND simulator: service fee rounds up (hits every original payout)",
    "const f = (gross * fee) / 10000n;",
    "const f = (gross * fee + 9999n) / 10000n;",
    "uint256 fee = (gross * feeBps) / 10000;",
    "uint256 fee = (gross * feeBps + 9999) / 10000;",
  ],
];

const dir = mkdtempSync(join(tmpdir(), "potloop-mut-"));
let survived = 0;
for (const [name, from, to] of mutations) {
  if (src.split(from).length !== 2) {
    console.log(`SKIPPED (pattern not found exactly once): ${name}`);
    survived++;
    continue;
  }
  const file = join(dir, `sim-${mutations.findIndex((m) => m[0] === name)}.js`);
  writeFileSync(file, src.replace(from, to));
  const r = spawnSync("npx", ["hardhat", "test", "test/Sim.parity.test.js", "--bail"], {
    env: { ...process.env, SIM_PATH: file, PARITY_RUNS: process.env.PARITY_RUNS || "40" },
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  const caught = r.status !== 0;
  if (!caught) survived++;
  const why = (r.stdout.match(/AssertionError: ([^\n]*)/) || [])[1] || "";
  console.log(`${caught ? "CAUGHT  " : "SURVIVED"}  ${name}${caught && why ? `  -> ${why.slice(0, 110)}` : ""}`);
}
for (const [name, sf, st, cf, ct] of shared) {
  let ssrc = src;
  if (name.includes("never top")) ssrc = src.replace("const payOut = (i, gross, r) => {", "const x0 = (i) => currentRound === i + 1;\n  const payOut = (i, gross, r) => {");
  if (ssrc.split(sf).length !== 2 || sol.split(cf).length !== 2) {
    console.log(`SKIPPED (pattern not found exactly once): ${name}`);
    survived++;
    continue;
  }
  // a throwaway copy of the project with the mutated contract and simulator
  const proj = mkdtempSync(join(tmpdir(), "potloop-shared-"));
  for (const d of ["contracts", "test", "app/src"]) cpSync(join(root, d), join(proj, d), { recursive: true });
  for (const f of ["hardhat.config.js", "package.json"]) cpSync(join(root, f), join(proj, f));
  symlinkSync(join(root, "node_modules"), join(proj, "node_modules"));
  writeFileSync(join(proj, "app/src/sim.js"), ssrc.replace(sf, st));
  writeFileSync(join(proj, "contracts/SavingsCircle.sol"), sol.replace(cf, ct));
  const r = spawnSync("npx", ["hardhat", "test", "test/Sim.parity.test.js", "--bail"], {
    cwd: proj,
    env: { ...process.env, SIM_PATH: "", PARITY_RUNS: process.env.PARITY_RUNS || "40" },
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  const caught = r.status !== 0;
  if (!caught) survived++;
  const why = (r.stdout.match(/AssertionError: ([^\n]*)/) || [])[1] || (r.stderr || "").split("\n")[0];
  console.log(`${caught ? "CAUGHT  " : "SURVIVED"}  ${name}${caught && why ? `  -> ${why.slice(0, 120)}` : ""}`);
}
const total = mutations.length + shared.length;
console.log(`\n${total - survived}/${total} mutations caught`);
process.exit(survived ? 1 : 0);
