// Deploys the loan note contract and saves its address where al-core can read it:
//   deployments/<network>.json  ->  { network, chainId, LoanNote: { address, admin, minter }, deployedAt }
//
// Local:   npx hardhat node                        (window 1)
//          npx hardhat run scripts/deploy.js --network localhost
// The minter is MINTER_ADDRESS from .env if set, otherwise the deployer (fine for local work).
const fs = require("fs");
const path = require("path");
const { ethers, network } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  const minter = process.env.MINTER_ADDRESS || deployer.address;

  const LoanNote = await ethers.getContractFactory("LoanNote");
  const loanNote = await LoanNote.deploy(deployer.address, minter);
  await loanNote.waitForDeployment();

  const { chainId } = await ethers.provider.getNetwork();
  const record = {
    network: network.name,
    chainId: Number(chainId),
    LoanNote: { address: await loanNote.getAddress(), admin: deployer.address, minter },
    deployedAt: new Date().toISOString(),
  };

  const dir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${network.name}.json`);
  fs.writeFileSync(file, JSON.stringify(record, null, 2) + "\n");

  console.log(`LoanNote deployed to ${record.LoanNote.address} on ${network.name} (chain ${record.chainId})`);
  console.log(`Minter: ${minter}`);
  console.log(`Saved to ${path.relative(process.cwd(), file)}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
