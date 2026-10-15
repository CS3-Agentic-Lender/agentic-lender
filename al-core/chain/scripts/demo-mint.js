// Mints one example loan note on the local chain and reads it back. For demos and checking a deploy.
//   npx hardhat run scripts/demo-mint.js --network localhost
// Needs scripts/deploy.js to have run first on the same network. Uses made-up references, no real data.
const fs = require("fs");
const path = require("path");
const { ethers, network } = require("hardhat");

async function main() {
  const file = path.join(__dirname, "..", "deployments", `${network.name}.json`);
  if (!fs.existsSync(file)) throw new Error(`No deployment for ${network.name}: run scripts/deploy.js first`);
  const { LoanNote } = JSON.parse(fs.readFileSync(file, "utf8"));

  const [minter] = await ethers.getSigners();
  const note = await ethers.getContractAt("LoanNote", LoanNote.address, minter);

  const appId = `demo-${Date.now()}`;
  const applicationRef = ethers.sha256(ethers.toUtf8Bytes(appId));
  const borrowerRef = ethers.sha256(ethers.toUtf8Bytes(`demo-salt:borrower1`));

  // EUR 270,000 mortgage at 4.25% over 30 years.
  const tx = await note.mint(applicationRef, borrowerRef, 27_000_000n, 425, 360, 0);
  const receipt = await tx.wait();
  const tokenId = await note.tokenOfApplication(applicationRef);
  const n = await note.noteOf(tokenId);

  console.log(`Minted loan note #${tokenId} in block ${receipt.blockNumber} (tx ${receipt.hash})`);
  console.log(`  application ref ${n.applicationRef}  (sha256 of "${appId}")`);
  console.log(`  borrower ref    ${n.borrowerRef}  (salted, no personal data)`);
  console.log(`  principal       EUR ${(Number(n.principalCents) / 100).toLocaleString("en-IE")}`);
  console.log(`  APR             ${Number(n.aprBps) / 100}%`);
  console.log(`  term            ${n.termMonths} months`);
  console.log(`  loan type       ${["mortgage", "HELOC"][Number(n.loanType)]}`);
  console.log(`  status          ${["none", "active", "closed"][Number(n.status)]}`);
  console.log(`  owner           ${await note.ownerOf(tokenId)}`);

  try {
    await note.mint(applicationRef, borrowerRef, 1n, 425, 360, 0);
  } catch (err) {
    console.log(`Second mint for the same application refused: ${err.shortMessage || err.message}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
