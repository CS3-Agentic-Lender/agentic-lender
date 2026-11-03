"""The loan note contract on the chain: mint an application's note once, and find it again if a mint was cut short.

The note holds the loan's principal (euro cents), APR (basis points), term (months) and type, plus two references that carry no
personal data: the SHA-256 of the application id (app/audit.py, the same one the audit registry uses) and a salted SHA-256 of the
borrower's uid. The contract refuses a second note for the same application, so `mint` first looks for one and hands it back
if it exists: a mint that reached the chain but never reached Firestore is picked up by the retry, never repeated.
The signing wallet is a server-held testnet key from the environment. Settings (names are in .env.example):

    CHAIN_RPC_URL               default http://127.0.0.1:8545 (the local Hardhat node)
    CHAIN_MINTER_PRIVATE_KEY    the wallet holding the contract's MINTER_ROLE, a testnet wallet only
    LOAN_NOTE_ADDRESS           the deployed LoanNote; if unset, chain/deployments/<CHAIN_NETWORK>.json is used
    CHAIN_NETWORK               default localhost
    BORROWER_REF_SALT           the secret mixed into the borrower reference; it never leaves al-core
"""

import hashlib
import json
import os
from dataclasses import dataclass

from web3 import Web3
from web3.exceptions import ContractLogicError, Web3Exception
from web3.logs import DISCARD

from app.audit import application_ref
from app.chain import DEFAULT_RPC_URL, DEPLOYMENTS, RECEIPT_TIMEOUT_S, ChainError, NotConfigured

LOAN_TYPES = {"mortgage": 0, "heloc": 1}  # the contract's LoanType enum

_NOTE = [
    {"name": "applicationRef", "type": "bytes32"}, {"name": "borrowerRef", "type": "bytes32"},
    {"name": "principalCents", "type": "uint256"}, {"name": "aprBps", "type": "uint16"},
    {"name": "termMonths", "type": "uint16"}, {"name": "loanType", "type": "uint8"},
    {"name": "status", "type": "uint8"}, {"name": "mintedAt", "type": "uint64"}, {"name": "closedAt", "type": "uint64"},
]

# Only what al-core uses.
ABI = [
    {
        "type": "function", "name": "mint", "stateMutability": "nonpayable",
        "inputs": [
            {"name": "applicationRef", "type": "bytes32"}, {"name": "borrowerRef", "type": "bytes32"},
            {"name": "principalCents", "type": "uint256"}, {"name": "aprBps", "type": "uint16"},
            {"name": "termMonths", "type": "uint16"}, {"name": "loanType", "type": "uint8"},
        ],
        "outputs": [{"name": "tokenId", "type": "uint256"}],
    },
    {
        "type": "function", "name": "tokenOfApplication", "stateMutability": "view",
        "inputs": [{"name": "applicationRef", "type": "bytes32"}], "outputs": [{"name": "", "type": "uint256"}],
    },
    {
        "type": "function", "name": "noteOf", "stateMutability": "view",
        "inputs": [{"name": "tokenId", "type": "uint256"}],
        "outputs": [{"name": "", "type": "tuple", "components": _NOTE}],
    },
    {
        "type": "event", "name": "NoteMinted", "anonymous": False,
        "inputs": [
            {"name": "tokenId", "type": "uint256", "indexed": True},
            {"name": "applicationRef", "type": "bytes32", "indexed": True},
            {"name": "borrowerRef", "type": "bytes32", "indexed": False},
            {"name": "principalCents", "type": "uint256", "indexed": False},
            {"name": "aprBps", "type": "uint16", "indexed": False},
            {"name": "termMonths", "type": "uint16", "indexed": False},
            {"name": "loanType", "type": "uint8", "indexed": False},
        ],
    },
]


@dataclass(frozen=True)
class NoteTerms:
    principal_cents: int
    apr_bps: int
    term_months: int
    loan_type: str  # "mortgage" or "heloc"
    borrower_ref: str  # 64 hex characters


@dataclass(frozen=True)
class Minted:
    token_id: int
    tx_hash: str
    contract_address: str
    already_minted: bool  # True when the note was already on the chain and this call only found it


def borrower_ref(uid: str, salt: str) -> str:
    """The borrower's reference on the chain: a salted SHA-256 of their uid, so the uid can't be read back from the note."""
    if not salt:
        raise NotConfigured("BORROWER_REF_SALT is not set")
    return hashlib.sha256((salt + uid).encode("utf-8")).hexdigest()


class LoanNotes:
    def __init__(self, w3: Web3, address: str, private_key: str):
        self.w3 = w3
        self.account = w3.eth.account.from_key(private_key)
        self.address = Web3.to_checksum_address(address)
        self.contract = w3.eth.contract(address=self.address, abi=ABI)

    @classmethod
    def from_env(cls, env: dict | None = None) -> "LoanNotes":
        env = os.environ if env is None else env
        key = env.get("CHAIN_MINTER_PRIVATE_KEY", "")
        if not key:
            raise NotConfigured("CHAIN_MINTER_PRIVATE_KEY is not set")
        address = env.get("LOAN_NOTE_ADDRESS", "")
        if not address:
            network = env.get("CHAIN_NETWORK", "localhost")
            path = DEPLOYMENTS / f"{network}.json"
            try:
                address = json.loads(path.read_text())["LoanNote"]["address"]
            except (OSError, KeyError, ValueError):
                raise NotConfigured(f"LOAN_NOTE_ADDRESS is not set and {path.name} has no LoanNote address") from None
        w3 = Web3(Web3.HTTPProvider(env.get("CHAIN_RPC_URL", DEFAULT_RPC_URL), request_kwargs={"timeout": 15}))
        return cls(w3, address, key)

    def mint(self, application_id: str, terms: NoteTerms) -> Minted:
        """Mint the application's note, or return the one that is already there. A note with other terms is an error."""
        ref = bytes.fromhex(application_ref(application_id))
        existing = self._token_of(ref)
        if existing:
            return self._found(ref, existing, terms)

        args = (
            ref, bytes.fromhex(terms.borrower_ref), terms.principal_cents, terms.apr_bps, terms.term_months,
            LOAN_TYPES[terms.loan_type],
        )
        try:
            tx = self.contract.functions.mint(*args).build_transaction(
                # "pending" counts transactions still waiting to be mined, so two writes close together get different nonces
                {"from": self.account.address, "nonce": self.w3.eth.get_transaction_count(self.account.address, "pending")}
            )
            signed = self.account.sign_transaction(tx)
            tx_hash = self.w3.eth.send_raw_transaction(signed.raw_transaction)
            receipt = self.w3.eth.wait_for_transaction_receipt(tx_hash, timeout=RECEIPT_TIMEOUT_S)
        except ContractLogicError as exc:
            reason = str(getattr(exc, "message", None) or exc)[:200]
            if "AlreadyMinted" in reason:  # another request minted it between the check above and this send
                return self._found(ref, self._token_of(ref), terms)
            raise ChainError(f"the chain refused the loan note: {reason}") from None
        except (Web3Exception, OSError) as exc:
            raise ChainError(f"the loan note could not be minted: {type(exc).__name__}") from None
        if receipt["status"] != 1:
            raise ChainError("the chain rejected the loan note")
        try:
            # The receipt also has the ERC-721 Transfer log, which this ABI doesn't describe, so only NoteMinted is read.
            (event,) = self.contract.events.NoteMinted().process_receipt(receipt, errors=DISCARD)
        except (ValueError, Web3Exception):
            raise ChainError("the loan note was minted but its token id could not be read from the receipt") from None
        return Minted(int(event["args"]["tokenId"]), "0x" + tx_hash.hex().removeprefix("0x"), self.address, already_minted=False)

    def _token_of(self, ref: bytes) -> int:
        try:
            return int(self.contract.functions.tokenOfApplication(ref).call())
        except (ContractLogicError, Web3Exception, OSError) as exc:
            raise ChainError(f"the chain could not be read: {type(exc).__name__}") from None

    def _found(self, ref: bytes, token_id: int, terms: NoteTerms) -> Minted:
        """The note already on the chain for this application, after checking it is the one these terms describe."""
        try:
            note = self.contract.functions.noteOf(token_id).call()
            events = self.contract.events.NoteMinted().get_logs(from_block=0, argument_filters={"applicationRef": ref})
        except (ContractLogicError, Web3Exception, OSError) as exc:
            raise ChainError(f"the chain could not be read: {type(exc).__name__}") from None
        on_chain = (note[2], note[3], note[4], note[5], bytes(note[1]).hex())
        wanted = (terms.principal_cents, terms.apr_bps, terms.term_months, LOAN_TYPES[terms.loan_type], terms.borrower_ref)
        if on_chain != wanted:
            raise ChainError("a loan note with different terms already exists for this application")
        if not events:
            raise ChainError("the loan note exists but the transaction that minted it could not be found")
        return Minted(token_id, "0x" + events[0]["transactionHash"].hex().removeprefix("0x"), self.address, already_minted=True)
