require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

// Testnet settings come from .env (see .env.example). They are only used with --network amoy.
const { AMOY_RPC_URL, DEPLOYER_PRIVATE_KEY } = process.env;

module.exports = {
  solidity: {
    version: "0.8.28",
    // OpenZeppelin 5.6 uses the mcopy opcode, so compile for Cancun (supported by Hardhat and Polygon Amoy).
    settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: "cancun" },
  },
  networks: {
    // `npx hardhat node` serves this on http://127.0.0.1:8545 with 20 funded test accounts.
    localhost: { url: "http://127.0.0.1:8545" },
    ...(AMOY_RPC_URL && DEPLOYER_PRIVATE_KEY
      ? { amoy: { url: AMOY_RPC_URL, accounts: [DEPLOYER_PRIVATE_KEY], chainId: 80002 } }
      : {}),
  },
};
