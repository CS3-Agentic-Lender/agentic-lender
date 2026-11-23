// Verifies the source of both deployed contracts on the block explorer, from deployments/<network>.json (written by deploy.js):
//   npm run verify:amoy        (needs ETHERSCAN_API_KEY in .env)
// The constructor arguments are the same ones deploy.js used, read back from that file, so the explorer can match the bytecode.
const fs = require("fs");
const path = require("path");
const { run, network } = require("hardhat");

async function verify(name, address, constructorArguments) {
  try {
    await run("verify:verify", { address, constructorArguments });
    console.log(`${name} at ${address} is verified.`);
  } catch (err) {
    // Re-running after a success is fine: the explorer says the source is already verified.
    if (/already verified/i.test(err.message)) {
      console.log(`${name} at ${address} was already verified.`);
      return;
    }
    throw err;
  }
}

async function main() {
  if (!process.env.ETHERSCAN_API_KEY) throw new Error("ETHERSCAN_API_KEY is not set in .env");
  const file = path.join(__dirname, "..", "deployments", `${network.name}.json`);
  if (!fs.existsSync(file)) throw new Error(`No deployment record for ${network.name}: run the deploy first (${path.relative(process.cwd(), file)})`);
  const { LoanNote, AuditRegistry } = JSON.parse(fs.readFileSync(file, "utf8"));

  await verify("LoanNote", LoanNote.address, [LoanNote.admin, LoanNote.minter, LoanNote.holder]);
  await verify("AuditRegistry", AuditRegistry.address, [AuditRegistry.admin, AuditRegistry.registrar]);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
