// Prints the runtime and init-code size of every deployable contract, with the compiler settings.
//   npx hardhat run scripts/bytecode-sizes.js     (compile first)
// Limits: runtime 24,576 bytes (EIP-170); init code 49,152 bytes (EIP-3860, where the chain has it).
const { artifacts, config } = require("hardhat");

async function main() {
  const s = config.solidity.compilers[0];
  console.log(`solc ${s.version}, optimizer ${s.settings.optimizer.enabled ? `on, runs ${s.settings.optimizer.runs}` : "off"}, EVM target ${s.settings.evmVersion}, viaIR ${!!s.settings.viaIR}`);
  console.log("contract          runtime  spare(24,576)   init   spare(49,152)");
  for (const name of ["SavingsCircle", "CircleFactory", "CircleDeployer"]) {
    const a = await artifacts.readArtifact(name);
    const runtime = (a.deployedBytecode.length - 2) / 2;
    const init = (a.bytecode.length - 2) / 2;
    console.log(`${name.padEnd(16)} ${String(runtime).padStart(8)} ${String(24576 - runtime).padStart(14)} ${String(init).padStart(7)} ${String(49152 - init).padStart(14)}`);
  }
  console.log("CircleFactory's init code contains CircleDeployer's, which contains SavingsCircle's.");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
