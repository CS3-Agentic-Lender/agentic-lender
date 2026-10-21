const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-toolbox/network-helpers");

// How al-core builds the two references, so nothing personal reaches the chain:
// the application ref is a SHA-256 of the application id, the borrower ref a salted SHA-256 of the uid.
const SALT = "test-salt-only";
const applicationRef = (id) => ethers.sha256(ethers.toUtf8Bytes(id));
const borrowerRef = (uid) => ethers.sha256(ethers.toUtf8Bytes(`${SALT}:${uid}`));

const MORTGAGE = 0;
const HELOC = 1;
const ACTIVE = 1;
const CLOSED = 2;

// A EUR 270,000 mortgage at 4.25% over 30 years.
const LOAN = {
  app: applicationRef("app-funded"),
  borrower: borrowerRef("borrower1"),
  principalCents: 27_000_000n,
  aprBps: 425,
  termMonths: 360,
  loanType: MORTGAGE,
};

async function deploy() {
  const [admin, minter, stranger, bank] = await ethers.getSigners();
  const note = await ethers.deployContract("LoanNote", [admin.address, minter.address, bank.address]);
  return { note, admin, minter, stranger, bank };
}

async function deployAndMint() {
  const ctx = await deploy();
  const { note, minter } = ctx;
  await note.connect(minter).mint(LOAN.app, LOAN.borrower, LOAN.principalCents, LOAN.aprBps, LOAN.termMonths, LOAN.loanType);
  return ctx;
}

const mint = (note, signer, loan = LOAN) =>
  note.connect(signer).mint(loan.app, loan.borrower, loan.principalCents, loan.aprBps, loan.termMonths, loan.loanType);

describe("LoanNote", function () {
  describe("deployment", function () {
    it("is an ERC-721 called AL Loan Note", async function () {
      const { note } = await loadFixture(deploy);
      expect(await note.name()).to.equal("AL Loan Note");
      expect(await note.symbol()).to.equal("ALLN");
      expect(await note.supportsInterface("0x80ac58cd")).to.equal(true); // ERC-721
      expect(await note.supportsInterface("0x7965db0b")).to.equal(true); // AccessControl
    });

    it("gives the admin and minter roles to the accounts passed in", async function () {
      const { note, admin, minter, stranger } = await loadFixture(deploy);
      expect(await note.hasRole(await note.DEFAULT_ADMIN_ROLE(), admin.address)).to.equal(true);
      expect(await note.hasRole(await note.MINTER_ROLE(), minter.address)).to.equal(true);
      expect(await note.hasRole(await note.MINTER_ROLE(), stranger.address)).to.equal(false);
    });

    it("records the bank as the holder", async function () {
      const { note, bank } = await loadFixture(deploy);
      expect(await note.holder()).to.equal(bank.address);
    });

    for (const [role, index] of [["admin", 0], ["minter", 1], ["holder", 2]]) {
      it(`refuses a zero ${role} address`, async function () {
        const [a, b, c] = await ethers.getSigners();
        const args = [a.address, b.address, c.address];
        args[index] = ethers.ZeroAddress;
        const factory = await ethers.getContractFactory("LoanNote");
        await expect(factory.deploy(...args)).to.be.revertedWithCustomError(factory, "ZeroAddress").withArgs(role);
      });
    }
  });

  describe("minting", function () {
    it("the minter mints a note and every field reads back", async function () {
      const { note, minter } = await loadFixture(deploy);
      await mint(note, minter);
      const stored = await note.noteOf(1);
      expect(stored.applicationRef).to.equal(LOAN.app);
      expect(stored.borrowerRef).to.equal(LOAN.borrower);
      expect(stored.principalCents).to.equal(LOAN.principalCents);
      expect(stored.aprBps).to.equal(LOAN.aprBps);
      expect(stored.termMonths).to.equal(LOAN.termMonths);
      expect(stored.loanType).to.equal(MORTGAGE);
      expect(stored.status).to.equal(ACTIVE);
      expect(stored.mintedAt).to.be.greaterThan(0n);
      expect(stored.closedAt).to.equal(0n);
    });

    it("the note is held by the bank, not the minter, and linked to its application", async function () {
      const { note, minter, bank } = await loadFixture(deployAndMint);
      expect(await note.ownerOf(1)).to.equal(bank.address);
      expect(await note.balanceOf(bank.address)).to.equal(1n);
      expect(await note.balanceOf(minter.address)).to.equal(0n);
      expect(await note.tokenOfApplication(LOAN.app)).to.equal(1n);
    });

    it("emits NoteMinted with the loan terms", async function () {
      const { note, minter } = await loadFixture(deploy);
      await expect(mint(note, minter))
        .to.emit(note, "NoteMinted")
        .withArgs(1n, LOAN.app, LOAN.borrower, LOAN.principalCents, LOAN.aprBps, LOAN.termMonths, MORTGAGE);
    });

    it("stores a HELOC as loan type 1", async function () {
      const { note, minter } = await loadFixture(deploy);
      await mint(note, minter, { ...LOAN, app: applicationRef("app-approved"), loanType: HELOC });
      expect((await note.noteOf(1)).loanType).to.equal(HELOC);
    });

    it("numbers notes from 1 upwards", async function () {
      const { note, minter, bank } = await loadFixture(deployAndMint);
      await mint(note, minter, { ...LOAN, app: applicationRef("app-second") });
      expect(await note.tokenOfApplication(applicationRef("app-second"))).to.equal(2n);
      expect(await note.ownerOf(2)).to.equal(bank.address);
    });

    it("refuses a mint from any account without the minter role", async function () {
      const { note, admin, stranger } = await loadFixture(deploy);
      for (const signer of [stranger, admin]) {
        await expect(mint(note, signer)).to.be.revertedWithCustomError(note, "AccessControlUnauthorizedAccount");
      }
      expect(await note.tokenOfApplication(LOAN.app)).to.equal(0n);
    });

    it("refuses a second mint for the same application", async function () {
      const { note, minter } = await loadFixture(deployAndMint);
      await expect(mint(note, minter, { ...LOAN, principalCents: 1n }))
        .to.be.revertedWithCustomError(note, "AlreadyMinted")
        .withArgs(LOAN.app, 1n);
      expect((await note.noteOf(1)).principalCents).to.equal(LOAN.principalCents);
    });

    const invalid = [
      ["an empty application reference", { app: ethers.ZeroHash }, "application reference is empty"],
      ["an empty borrower reference", { borrower: ethers.ZeroHash }, "borrower reference is empty"],
      ["a zero principal", { principalCents: 0n }, "principal must be above zero"],
      ["an APR above 100%", { aprBps: 10_001 }, "APR is above 100%"],
      ["a zero term", { termMonths: 0 }, "term must be 1 to 480 months"],
      ["a term over 40 years", { termMonths: 481 }, "term must be 1 to 480 months"],
    ];
    for (const [label, change, reason] of invalid) {
      it(`refuses ${label}`, async function () {
        const { note, minter } = await loadFixture(deploy);
        await expect(mint(note, minter, { ...LOAN, ...change }))
          .to.be.revertedWithCustomError(note, "InvalidNote")
          .withArgs(reason);
      });
    }

    it("refuses an unknown loan type", async function () {
      const { note, minter } = await loadFixture(deploy);
      await expect(mint(note, minter, { ...LOAN, loanType: 2 })).to.be.reverted;
    });

    it("accepts the edge values: 0% APR, 100% APR, 1 and 480 months", async function () {
      const { note, minter } = await loadFixture(deploy);
      const edges = [{ aprBps: 0 }, { aprBps: 10_000 }, { termMonths: 1 }, { termMonths: 480 }];
      for (const [i, change] of edges.entries()) {
        await mint(note, minter, { ...LOAN, ...change, app: applicationRef(`edge-${i}`) });
      }
      expect(await note.tokenOfApplication(applicationRef("edge-3"))).to.equal(4n);
    });
  });

  describe("closing", function () {
    it("the minter closes an active note", async function () {
      const { note, minter } = await loadFixture(deployAndMint);
      await expect(note.connect(minter).close(1)).to.emit(note, "NoteClosed").withArgs(1n, LOAN.app);
      const stored = await note.noteOf(1);
      expect(stored.status).to.equal(CLOSED);
      expect(stored.closedAt).to.be.greaterThanOrEqual(stored.mintedAt);
    });

    it("a closed note can't be closed again or reopened by minting", async function () {
      const { note, minter } = await loadFixture(deployAndMint);
      await note.connect(minter).close(1);
      await expect(note.connect(minter).close(1)).to.be.revertedWithCustomError(note, "NotActive").withArgs(1n);
      await expect(mint(note, minter)).to.be.revertedWithCustomError(note, "AlreadyMinted");
    });

    it("can't close a note that doesn't exist", async function () {
      const { note, minter } = await loadFixture(deploy);
      await expect(note.connect(minter).close(7)).to.be.revertedWithCustomError(note, "UnknownNote").withArgs(7n);
    });

    it("refuses a close from any account without the minter role", async function () {
      const { note, stranger } = await loadFixture(deployAndMint);
      await expect(note.connect(stranger).close(1)).to.be.revertedWithCustomError(
        note,
        "AccessControlUnauthorizedAccount",
      );
      expect((await note.noteOf(1)).status).to.equal(ACTIVE);
    });
  });

  describe("transfers", function () {
    it("the holder can't transfer an active note", async function () {
      const { note, bank, stranger } = await loadFixture(deployAndMint);
      await expect(note.connect(bank).transferFrom(bank.address, stranger.address, 1))
        .to.be.revertedWithCustomError(note, "NotTransferable")
        .withArgs(1n);
      await expect(
        note.connect(bank)["safeTransferFrom(address,address,uint256)"](bank.address, stranger.address, 1),
      ).to.be.revertedWithCustomError(note, "NotTransferable");
      expect(await note.ownerOf(1)).to.equal(bank.address);
    });

    it("the holder can't transfer a closed note", async function () {
      const { note, minter, bank, stranger } = await loadFixture(deployAndMint);
      await note.connect(minter).close(1);
      await expect(note.connect(bank).transferFrom(bank.address, stranger.address, 1))
        .to.be.revertedWithCustomError(note, "NotTransferable")
        .withArgs(1n);
      expect(await note.ownerOf(1)).to.equal(bank.address);
    });

    it("an approved account can't move a note either", async function () {
      const { note, bank, stranger } = await loadFixture(deployAndMint);
      await note.connect(bank).approve(stranger.address, 1);
      await expect(note.connect(stranger).transferFrom(bank.address, stranger.address, 1))
        .to.be.revertedWithCustomError(note, "NotTransferable")
        .withArgs(1n);
    });
  });

  describe("reading and roles", function () {
    it("reading a note that doesn't exist reverts", async function () {
      const { note } = await loadFixture(deploy);
      await expect(note.noteOf(1)).to.be.revertedWithCustomError(note, "UnknownNote").withArgs(1n);
    });

    it("an unminted application has token 0", async function () {
      const { note } = await loadFixture(deploy);
      expect(await note.tokenOfApplication(applicationRef("never-minted"))).to.equal(0n);
    });

    it("the admin can hand the minter role to a new al-core wallet, and others can't", async function () {
      const { note, admin, minter, stranger, bank } = await loadFixture(deployAndMint);
      const role = await note.MINTER_ROLE();
      await expect(note.connect(stranger).grantRole(role, stranger.address)).to.be.revertedWithCustomError(
        note,
        "AccessControlUnauthorizedAccount",
      );
      await note.connect(admin).grantRole(role, stranger.address);
      await note.connect(admin).revokeRole(role, minter.address);
      await mint(note, stranger, { ...LOAN, app: applicationRef("after-rotation") });
      await expect(mint(note, minter, { ...LOAN, app: applicationRef("other") })).to.be.revertedWithCustomError(
        note,
        "AccessControlUnauthorizedAccount",
      );
      // Notes minted before and after the change both stay with the bank.
      expect(await note.ownerOf(1)).to.equal(bank.address);
      expect(await note.ownerOf(2)).to.equal(bank.address);
    });

    it("the borrower reference doesn't reveal the uid and changes with the salt", async function () {
      expect(borrowerRef("borrower1")).to.not.equal(ethers.sha256(ethers.toUtf8Bytes("borrower1")));
      expect(borrowerRef("borrower1")).to.not.equal(borrowerRef("borrower2"));
      expect(borrowerRef("borrower1")).to.match(/^0x[0-9a-f]{64}$/);
    });
  });
});
