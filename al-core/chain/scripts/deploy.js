// Deploys the loan note contract and the audit registry and saves their addresses where al-core can read them:
//   deployments/<network>.json  ->  { network, chainId, LoanNote: { address, admin, minter, holder },
//                                     AuditRegistry: { address, admin, registrar }, deployedAt, deployBlock }
//
// Local:   npx hardhat node                        (window 1)
//          npx hardhat run scripts/deploy.js --network localhost
// Amoy:    npm run deploy:amoy. It refuses to replace the committed deployments/amoy.json unless FORCE=1 is set.
// The minter (al-core's wallet) is MINTER_ADDRESS from .env and the holder (the bank, which keeps every note) is
// HOLDER_ADDRESS. Each defaults to the deployer, which is fine for local work. The registry's registrar is the same
// wallet as the minter: al-core has one wallet and uses it for both.
const fs = require("fs");
const path = require("path");
const { ethers, network } = require("hardhat");

// Use the address from .env if set, checking it is a real address first, otherwise the fallback.
function addressFromEnv(name, fallback) {
  const value = (process.env[name] || "").trim();
  if (!value) return fallback;
  try {
    return ethers.getAddress(value);
  } catch {
    throw new Error(`${name} in .env is not a valid address: "${value}"`);
  }
}

const DEPLOYMENTS = path.join(__dirname, "..", "deployments");
// The local chain starts empty on every restart, so its record is always rewritten. A public testnet's record is committed and
// al-core points at it, so a new deploy there must be asked for on purpose: otherwise trying the script out would point al-core
// at a fresh, empty pair of contracts.
const REWRITTEN_FREELY = ["localhost", "hardhat"];

function checkTheRecordMayBeReplaced(file) {
  if (REWRITTEN_FREELY.includes(network.name) || !fs.existsSync(file) || process.env.FORCE === "1") return;
  throw new Error(
    `${path.relative(process.cwd(), file)} already holds the contracts al-core uses on ${network.name}. ` +
      "Deploying again makes a new, empty pair. If that is what you want, run it with FORCE=1."
  );
}

async function main() {
  const file = path.join(DEPLOYMENTS, `${network.name}.json`);
  checkTheRecordMayBeReplaced(file); // before anything is sent, so a refused run spends no gas
  const [deployer] = await ethers.getSigners();
  const minter = addressFromEnv("MINTER_ADDRESS", deployer.address);
  const holder = addressFromEnv("HOLDER_ADDRESS", deployer.address);

  const LoanNote = await ethers.getContractFactory("LoanNote");
  const loanNote = await LoanNote.deploy(deployer.address, minter, holder);
  await loanNote.waitForDeployment();

  const AuditRegistry = await ethers.getContractFactory("AuditRegistry");
  const auditRegistry = await AuditRegistry.deploy(deployer.address, minter);
  await auditRegistry.waitForDeployment();

  const { chainId } = await ethers.provider.getNetwork();
  // The block the first contract was created in. al-core never looks for a past event before it, which keeps its log
  // lookups inside what a public RPC accepts (app/chain.py find_logs).
  const deployBlock = (await loanNote.deploymentTransaction().wait()).blockNumber;
  const record = {
    network: network.name,
    chainId: Number(chainId),
    LoanNote: { address: await loanNote.getAddress(), admin: deployer.address, minter, holder },
    AuditRegistry: { address: await auditRegistry.getAddress(), admin: deployer.address, registrar: minter },
    deployedAt: new Date().toISOString(),
    deployBlock,
  };

  fs.mkdirSync(DEPLOYMENTS, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(record, null, 2) + "\n");

  console.log(`LoanNote deployed to ${record.LoanNote.address} on ${network.name} (chain ${record.chainId})`);
  console.log(`AuditRegistry deployed to ${record.AuditRegistry.address}`);
  console.log(`Minter and registrar: ${minter}`);
  console.log(`Holder: ${holder}`);
  console.log(`Saved to ${path.relative(process.cwd(), file)}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
