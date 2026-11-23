require("@nomicfoundation/hardhat-toolbox");

const PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY;
const accounts = PRIVATE_KEY ? [PRIVATE_KEY] : [];

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.39",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      // conservative target so the bytecode runs on QIE's EVM
      evmVersion: "paris",
    },
  },
  networks: {
    // HARDHAT_CHAIN_ID=1983 lets scripts/testnet-deploy.js be dry-run locally (it refuses other chains)
    // FORK_URL=<rpc> runs the in-process chain as a local copy of that network (read-only use of the
    // RPC: nothing is ever sent to it). Used by scripts/fork-production-check.js against QIE mainnet.
    hardhat: process.env.FORK_URL
      ? {
          chainId: Number(process.env.HARDHAT_CHAIN_ID || 1990),
          forking: { url: process.env.FORK_URL, ...(process.env.FORK_BLOCK ? { blockNumber: Number(process.env.FORK_BLOCK) } : {}) }, // FORK_BLOCK pins the copy (and lets Hardhat cache it on disk)
          // QIE publishes no hardfork history we could verify; this only lets the local copy run
          // past blocks. Our contracts are compiled for paris.
          chains: { 1990: { hardforkHistory: { london: 0 } } },
        }
      : { chainId: Number(process.env.HARDHAT_CHAIN_ID || 31337) },
    qieMainnet: {
      url: process.env.QIE_RPC || "https://rpc1mainnet.qie.digital", // QIE_RPC: another public QIE mainnet RPC when rpc1 is slow
      chainId: 1990,
      accounts,
    },
    // chain 1983 and this RPC are from earlier project notes and a third-party listing; QIE's own
    // docs could not be fetched and the RPC reset the connection from our build machine (see
    // DEPLOYMENT_READINESS_V9_2_1.md). Override with QIE_TESTNET_RPC if QIE publishes another.
    qieTestnet: {
      url: process.env.QIE_TESTNET_RPC || "https://rpc1testnet.qie.digital",
      chainId: 1983,
      accounts,
    },
  },
  // source verification on the QIE explorer (Blockscout; no real API key needed)
  etherscan: {
    apiKey: { qieMainnet: "blockscout" },
    customChains: [
      {
        network: "qieMainnet",
        chainId: 1990,
        urls: { apiURL: "https://mainnet.qie.digital/api", browserURL: "https://mainnet.qie.digital" },
      },
    ],
  },
  sourcify: { enabled: false },
};
