// Deploys the loan note contract and saves its address where al-core can read it:
//   deployments/<network>.json  ->  { network, chainId, LoanNote: { address, admin, minter, holder }, deployedAt }
//
// Local:   npx hardhat node                        (window 1)
//          npx hardhat run scripts/deploy.js --network localhost
// The minter (al-core's wallet) is MINTER_ADDRESS from .env and the holder (the bank, which keeps every note) is
// HOLDER_ADDRESS. Each defaults to the deployer, which is fine for local work.
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

async function main() {
  const [deployer] = await ethers.getSigners();
  const minter = addressFromEnv("MINTER_ADDRESS", deployer.address);
  const holder = addressFromEnv("HOLDER_ADDRESS", deployer.address);

  const LoanNote = await ethers.getContractFactory("LoanNote");
  const loanNote = await LoanNote.deploy(deployer.address, minter, holder);
  await loanNote.waitForDeployment();

  const { chainId } = await ethers.provider.getNetwork();
  const record = {
    network: network.name,
    chainId: Number(chainId),
    LoanNote: { address: await loanNote.getAddress(), admin: deployer.address, minter, holder },
    deployedAt: new Date().toISOString(),
  };

  const dir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${network.name}.json`);
  fs.writeFileSync(file, JSON.stringify(record, null, 2) + "\n");

  console.log(`LoanNote deployed to ${record.LoanNote.address} on ${network.name} (chain ${record.chainId})`);
  console.log(`Minter: ${minter}`);
  console.log(`Holder: ${holder}`);
  console.log(`Saved to ${path.relative(process.cwd(), file)}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
