// ONE-transaction mainnet test of CircleFactory.recordCircle() on an already-completed circle.
// Default is a DRY RUN: read-only, no key needed. It prints the expected history changes, the gas
// estimate and the approval code. Nothing is sent unless every one of these is true:
//   --network qieMainnet, MODE=live, DEPLOYER_PRIVATE_KEY set in this window, APPROVE=<printed code>.
//
//   Dry run:  $env:CIRCLE="0xe7461b1505f74663707786C3fc22bCBB8aaAc804"
//             npx hardhat run scripts/mainnet-record-history.js --network qieMainnet
//   Live:     (only after the owner approves the printed plan in writing)
//             $env:MODE="live"; $env:APPROVE="R-xxxxxxxx"; npx hardhat run scripts/mainnet-record-history.js --network qieMainnet
const { ethers, network } = require("hardhat");
const H = require("./mainnet/harness");

const FACTORY = process.env.FACTORY || "0xD099c7361157Ec20a9Ac145aF4B66Af553AeDae4";
const CIRCLE = process.env.CIRCLE || "0xe7461b1505f74663707786C3fc22bCBB8aaAc804"; // S4: one caught up, four completed
const NAMES = ["completed", "caught up", "left early", "walked away"];

async function main() {
  const { chainId } = await ethers.provider.getNetwork();
  if (network.name !== "qieMainnet" || chainId !== 1990n) throw new Error("Run with --network qieMainnet (chain 1990). A dry run sends nothing.");
  const live = process.env.MODE === "live";
  const factory = await ethers.getContractAt("CircleFactory", FACTORY);
  const circle = await ethers.getContractAt("SavingsCircle", CIRCLE);
  if (!(await factory.isCircle(CIRCLE))) throw new Error("Not a circle of this factory.");
  if ((await circle.phase()) !== 2n) throw new Error("The circle is not Completed.");
  if (await factory.recorded(CIRCLE)) throw new Error("Already recorded: nothing to test.");
  const ms = await circle.members();
  const pot = (await circle.size()) * (await circle.contribution());
  const token = new ethers.Contract(await circle.token(), H.ERC20, ethers.provider);
  const plan = [];
  for (let i = 0; i < ms.length; i++) {
    const o = Number(await circle.outcomeOf(i));
    const h = await factory.history(ms[i]);
    plan.push({ seat: i + 1, member: ms[i], outcome: NAMES[o], before: [h.completed, h.caughtUp, h.leftEarly, h.walkedAway, h.volume].map(String), volumeAdded: o <= 1 ? pot.toString() : "0" });
  }
  const from = live ? (await ethers.getSigners())[0]?.address : process.env.FROM || "0x7145be20923340bbea3469c3804b384b93356910";
  const gas = await factory.recordCircle.estimateGas(CIRCLE, { from });
  const price = (await ethers.provider.getFeeData()).gasPrice;
  const code = `R-${H.planHash({ chain: "1990", factory: FACTORY, circle: CIRCLE, from, plan: plan.map((p) => [p.member, p.outcome, p.before]) })}`;
  console.log(`recordCircle(${CIRCLE}) on factory ${FACTORY}`);
  for (const p of plan) console.log(`  seat ${p.seat} ${p.member}: +1 ${p.outcome}${p.volumeAdded !== "0" ? `, volume +${ethers.formatUnits(p.volumeAdded, 6)} QUSDC` : ""}`);
  console.log(`  sender ${from}; gas estimate ${gas}; at ${ethers.formatUnits(price, "gwei")} gwei about ${ethers.formatEther(gas * price)} QIE (limit sent: ${(gas * 13n) / 10n})`);
  console.log(`  moves no QUSDC; every withdrawable and wallet balance must be unchanged afterwards`);
  console.log(`  approval code for exactly this plan: ${code}`);
  if (!live) { console.log("DRY RUN: nothing was sent."); return; }

  if (process.env.APPROVE !== code) throw new Error(`Not approved. This plan's approval code is ${code}.`);
  const [signer] = await ethers.getSigners();
  if (!signer) throw new Error("Live mode needs DEPLOYER_PRIVATE_KEY in this window.");
  const money = async () => (await Promise.all(ms.map(async (m) => [await circle.withdrawable(m), await token.balanceOf(m)]))).map(String).join();
  const before = await money();
  const tx = await factory.connect(signer).recordCircle(CIRCLE, { gasLimit: (gas * 13n) / 10n });
  console.log(`sent ${tx.hash}`);
  const rc = await tx.wait();
  const ok = [];
  ok.push(["status 1", rc.status === 1]);
  ok.push(["recorded() is true", await factory.recorded(CIRCLE)]);
  for (const p of plan) {
    const h = await factory.history(p.member);
    const want = p.before.map(BigInt);
    want[NAMES.indexOf(p.outcome)] += 1n;
    want[4] += BigInt(p.volumeAdded);
    ok.push([`seat ${p.seat} history`, [h.completed, h.caughtUp, h.leftEarly, h.walkedAway, h.volume].every((v, j) => v === want[j])]);
  }
  let again = false;
  try { await factory.connect(signer).recordCircle.staticCall(CIRCLE); } catch (e) { again = factory.interface.parseError(e.data || "0x")?.name === "AlreadyRecorded"; }
  ok.push(["second recording reverts with AlreadyRecorded (simulated, not sent)", again]);
  ok.push(["no entitlement or wallet balance changed", (await money()) === before]);
  for (const [n, v] of ok) console.log(`  ${v ? "PASS" : "FAIL"} ${n}`);
  console.log(`gas used ${rc.gasUsed}, fee ${ethers.formatEther(rc.gasUsed * rc.gasPrice)} QIE`);
  if (ok.some(([, v]) => !v)) process.exitCode = 1;
}

main().catch((e) => { console.error(e.message || e); process.exitCode = 1; });
