// Local V9 member-commitment demo. It deploys a mock token and one four-seat
// circle, then prints the exact terms returned by SavingsCircle.seatTerms().
// Run: npx hardhat run scripts/demo-v9-terms.js
const { ethers } = require("hardhat");

async function main() {
  const signers = await ethers.getSigners();
  const members = signers.slice(1, 5);
  const token = await ethers.deployContract("MockUSD");
  const contribution = ethers.parseUnits("25", 6);
  const circle = await ethers.deployContract("SavingsCircle", [{
    members: members.map((m) => m.address),
    token: await token.getAddress(),
    contribution,
    coverageBps: 5000,
    roundLength: 7 * 86400,
    grace: 86400,
    joinWindow: 7 * 86400,
    organizer: signers[0].address,
    treasury: ethers.ZeroAddress,
    feeBps: 0,
    registry: ethers.ZeroAddress,
  }]);

  console.log(`V9 demo circle: ${await circle.getAddress()}`);
  console.log("Four members, 25 mQUSDC each week, 50% cover:");
  for (let i = 0; i < members.length; i++) {
    const q = await circle.seatTerms(i);
    console.log(
      `Seat ${i + 1}: locks ${ethers.formatUnits(q.requiredCollateral, 6)}, ` +
      `receives ${ethers.formatUnits(q.expectedPayout, 6)}, ` +
      `still owes ${ethers.formatUnits(q.remainingAfterPayout, 6)}, ` +
      `uncovered ${ethers.formatUnits(q.uncoveredAfterPayout, 6)} mQUSDC.`
    );
  }
  console.log("No transactions were sent to QIE mainnet; this script uses Hardhat's local network.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
