"""The audit registry on the chain: write an application's audit hash once, and read it back.

Only a SHA-256 reference of the application id and the SHA-256 audit hash go on-chain (app/audit.py), so no personal data does.
The registry accepts one hash per application and refuses a second, so calling `store` again with the same hash is safe (it
returns the hash that is already there) and with a different hash is an error. The signing wallet is a server-held testnet
key read from the environment, never from a file in the repo. Settings (names are in .env.example):

    CHAIN_RPC_URL                  default http://127.0.0.1:8545 (the local Hardhat node)
    CHAIN_REGISTRAR_PRIVATE_KEY    the registrar wallet's key, a testnet wallet only
    AUDIT_REGISTRY_ADDRESS         the deployed AuditRegistry; if unset, chain/deployments/<CHAIN_NETWORK>.json is used
    CHAIN_NETWORK                  default localhost
"""

import json
import os
from dataclasses import dataclass
from pathlib import Path

from web3 import Web3
from web3.exceptions import ContractLogicError, Web3Exception

from app.audit import application_ref

DEPLOYMENTS = Path(__file__).resolve().parent.parent / "chain" / "deployments"
DEFAULT_RPC_URL = "http://127.0.0.1:8545"
RECEIPT_TIMEOUT_S = 60

# Only the two functions al-core uses.
ABI = [
    {
        "type": "function", "name": "store", "stateMutability": "nonpayable", "outputs": [],
        "inputs": [{"name": "applicationRef", "type": "bytes32"}, {"name": "hash", "type": "bytes32"}],
    },
    {
        "type": "function", "name": "recordOf", "stateMutability": "view",
        "inputs": [{"name": "applicationRef", "type": "bytes32"}],
        "outputs": [{"name": "hash", "type": "bytes32"}, {"name": "storedAt", "type": "uint64"}],
    },
]


class ChainError(Exception):
    """The chain could not be reached or refused the write."""


class NotConfigured(ChainError):
    """A setting the registry needs is missing."""


@dataclass(frozen=True)
class Stored:
    tx_hash: str | None  # None when the same hash was already stored, so nothing was sent
    already_stored: bool


def _bytes32(hex_text: str) -> bytes:
    try:
        raw = bytes.fromhex(hex_text.removeprefix("0x"))
    except ValueError:
        raise ChainError("a hash must be hexadecimal") from None
    if len(raw) != 32:
        raise ChainError("a hash must be 32 bytes (64 hex characters)")
    return raw


class AuditRegistry:
    def __init__(self, w3: Web3, address: str, private_key: str):
        self.w3 = w3
        self.account = w3.eth.account.from_key(private_key)
        self.contract = w3.eth.contract(address=Web3.to_checksum_address(address), abi=ABI)

    @classmethod
    def from_env(cls, env: dict | None = None) -> "AuditRegistry":
        env = os.environ if env is None else env
        key = env.get("CHAIN_REGISTRAR_PRIVATE_KEY", "")
        if not key:
            raise NotConfigured("CHAIN_REGISTRAR_PRIVATE_KEY is not set")
        address = env.get("AUDIT_REGISTRY_ADDRESS", "")
        if not address:
            network = env.get("CHAIN_NETWORK", "localhost")
            path = DEPLOYMENTS / f"{network}.json"
            try:
                address = json.loads(path.read_text())["AuditRegistry"]["address"]
            except (OSError, KeyError, ValueError):
                raise NotConfigured(f"AUDIT_REGISTRY_ADDRESS is not set and {path.name} has no AuditRegistry address") from None
        w3 = Web3(Web3.HTTPProvider(env.get("CHAIN_RPC_URL", DEFAULT_RPC_URL), request_kwargs={"timeout": 15}))
        return cls(w3, address, key)

    def record_of(self, application_id: str) -> tuple[str, int] | None:
        """The stored (audit hash, stored-at time) for an application, or None if nothing is stored."""
        ref = bytes.fromhex(application_ref(application_id))
        try:
            stored_hash, stored_at = self.contract.functions.recordOf(ref).call()
        except ContractLogicError:
            return None  # UnknownApplication
        except (Web3Exception, OSError) as exc:
            raise ChainError(f"the chain could not be read: {type(exc).__name__}") from None
        return stored_hash.hex(), stored_at

    def store(self, application_id: str, audit_hash: str) -> Stored:
        """Write the audit hash for an application. The same hash again is safe; a different one is an error."""
        value = _bytes32(audit_hash)
        existing = self.record_of(application_id)
        if existing is not None:
            if existing[0] == value.hex():
                return Stored(tx_hash=None, already_stored=True)
            raise ChainError("a different audit hash is already stored for this application")

        ref = bytes.fromhex(application_ref(application_id))
        try:
            tx = self.contract.functions.store(ref, value).build_transaction(
                {"from": self.account.address, "nonce": self.w3.eth.get_transaction_count(self.account.address)}
            )
            signed = self.account.sign_transaction(tx)
            tx_hash = self.w3.eth.send_raw_transaction(signed.raw_transaction)
            receipt = self.w3.eth.wait_for_transaction_receipt(tx_hash, timeout=RECEIPT_TIMEOUT_S)
        except (Web3Exception, OSError) as exc:
            raise ChainError(f"the audit hash could not be stored: {type(exc).__name__}") from None
        if receipt["status"] != 1:
            raise ChainError("the chain rejected the audit hash")
        return Stored(tx_hash="0x" + tx_hash.hex().removeprefix("0x"), already_stored=False)
