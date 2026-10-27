const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-toolbox/network-helpers");

// How al-core builds the references: a SHA-256 of the application id, and the SHA-256 of the canonical decision record.
// Here the record is a stand-in string; the real format is in al-core/SCHEMA.md and app/audit.py.
const applicationRef = (id) => ethers.sha256(ethers.toUtf8Bytes(id));
const recordHash = (text) => ethers.sha256(ethers.toUtf8Bytes(text));

const APP = applicationRef("app-funded");
const HASH = recordHash('{"applicationId":"app-funded","decision":"approved"}');

async function deploy() {
  const [admin, registrar, stranger] = await ethers.getSigners();
  const registry = await ethers.deployContract("AuditRegistry", [admin.address, registrar.address]);
  return { registry, admin, registrar, stranger };
}

async function deployAndStore() {
  const ctx = await deploy();
  await ctx.registry.connect(ctx.registrar).store(APP, HASH);
  return ctx;
}

describe("AuditRegistry", function () {
  describe("deployment", function () {
    it("gives the admin and the registrar their roles and nobody else", async function () {
      const { registry, admin, registrar, stranger } = await loadFixture(deploy);
      const ADMIN = await registry.DEFAULT_ADMIN_ROLE();
      const REGISTRAR = await registry.REGISTRAR_ROLE();
      expect(await registry.hasRole(ADMIN, admin.address)).to.equal(true);
      expect(await registry.hasRole(REGISTRAR, registrar.address)).to.equal(true);
      expect(await registry.hasRole(REGISTRAR, admin.address)).to.equal(false);
      expect(await registry.hasRole(REGISTRAR, stranger.address)).to.equal(false);
    });

    it("refuses a zero admin or registrar", async function () {
      const [a] = await ethers.getSigners();
      const factory = await ethers.getContractFactory("AuditRegistry");
      await expect(factory.deploy(ethers.ZeroAddress, a.address)).to.be.revertedWithCustomError(factory, "ZeroAddress").withArgs("admin");
      await expect(factory.deploy(a.address, ethers.ZeroAddress)).to.be.revertedWithCustomError(factory, "ZeroAddress").withArgs("registrar");
    });
  });

  describe("storing a hash", function () {
    it("stores the hash with the time and emits an event", async function () {
      const { registry, registrar } = await loadFixture(deploy);
      const tx = await registry.connect(registrar).store(APP, HASH);
      const block = await ethers.provider.getBlock(tx.blockNumber);
      await expect(tx).to.emit(registry, "HashStored").withArgs(APP, HASH, block.timestamp);
    });

    it("reads the hash and the time back", async function () {
      const { registry, registrar } = await loadFixture(deploy);
      const tx = await registry.connect(registrar).store(APP, HASH);
      const block = await ethers.provider.getBlock(tx.blockNumber);
      const [hash, storedAt] = await registry.recordOf(APP);
      expect(hash).to.equal(HASH);
      expect(storedAt).to.equal(block.timestamp);
    });

    it("keeps one hash per application", async function () {
      const { registry, registrar } = await loadFixture(deployAndStore);
      const other = applicationRef("app-closed");
      const otherHash = recordHash("another record");
      await registry.connect(registrar).store(other, otherHash);
      expect((await registry.recordOf(APP))[0]).to.equal(HASH);
      expect((await registry.recordOf(other))[0]).to.equal(otherHash);
    });
  });

  describe("a stored hash can't change", function () {
    it("refuses a second write for the same application", async function () {
      const { registry, registrar } = await loadFixture(deployAndStore);
      await expect(registry.connect(registrar).store(APP, recordHash("a different record")))
        .to.be.revertedWithCustomError(registry, "AlreadyStored")
        .withArgs(APP);
    });

    it("refuses the same hash again too, and the first record and time are untouched", async function () {
      const { registry, registrar } = await loadFixture(deployAndStore);
      const [, firstTime] = await registry.recordOf(APP);
      await time.increase(60);
      await expect(registry.connect(registrar).store(APP, HASH)).to.be.revertedWithCustomError(registry, "AlreadyStored");
      const [hash, storedAt] = await registry.recordOf(APP);
      expect(hash).to.equal(HASH);
      expect(storedAt).to.equal(firstTime);
    });

    it("has no function to update or delete a hash", async function () {
      const { registry } = await loadFixture(deploy);
      const names = registry.interface.fragments.filter((f) => f.type === "function").map((f) => f.name);
      expect(names).to.not.include.members(["update", "remove", "delete", "set", "overwrite"]);
    });
  });

  describe("who can write", function () {
    it("refuses a stranger", async function () {
      const { registry, stranger } = await loadFixture(deploy);
      await expect(registry.connect(stranger).store(APP, HASH)).to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount");
      await expect(registry.recordOf(APP)).to.be.revertedWithCustomError(registry, "UnknownApplication");
    });

    it("refuses the admin, who can only manage roles", async function () {
      const { registry, admin } = await loadFixture(deploy);
      await expect(registry.connect(admin).store(APP, HASH)).to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount");
    });

    it("lets the admin hand the registrar role to a new wallet and take it from the old one", async function () {
      const { registry, admin, registrar, stranger } = await loadFixture(deploy);
      const REGISTRAR = await registry.REGISTRAR_ROLE();
      await registry.connect(admin).grantRole(REGISTRAR, stranger.address);
      await registry.connect(admin).revokeRole(REGISTRAR, registrar.address);
      await expect(registry.connect(registrar).store(APP, HASH)).to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount");
      await registry.connect(stranger).store(APP, HASH);
      expect((await registry.recordOf(APP))[0]).to.equal(HASH);
    });

    it("doesn't let the registrar grant roles", async function () {
      const { registry, registrar, stranger } = await loadFixture(deploy);
      const REGISTRAR = await registry.REGISTRAR_ROLE();
      await expect(registry.connect(registrar).grantRole(REGISTRAR, stranger.address)).to.be.revertedWithCustomError(
        registry,
        "AccessControlUnauthorizedAccount",
      );
    });
  });

  describe("invalid input and unknown applications", function () {
    it("refuses an empty reference or an empty hash", async function () {
      const { registry, registrar } = await loadFixture(deploy);
      await expect(registry.connect(registrar).store(ethers.ZeroHash, HASH))
        .to.be.revertedWithCustomError(registry, "InvalidEntry")
        .withArgs("application reference is empty");
      await expect(registry.connect(registrar).store(APP, ethers.ZeroHash))
        .to.be.revertedWithCustomError(registry, "InvalidEntry")
        .withArgs("hash is empty");
    });

    it("reverts when reading an application with nothing stored", async function () {
      const { registry } = await loadFixture(deploy);
      await expect(registry.recordOf(APP)).to.be.revertedWithCustomError(registry, "UnknownApplication").withArgs(APP);
    });
  });
});
