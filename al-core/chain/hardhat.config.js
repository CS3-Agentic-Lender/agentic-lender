require("@nomicfoundation/hardhat-toolbox");

module.exports = {
  solidity: {
    version: "0.8.28",
    // OpenZeppelin 5.6 uses the mcopy opcode, so compile for Cancun (supported by Hardhat and Polygon Amoy).
    settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: "cancun" },
  },
};
