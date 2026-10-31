"""The loan note client (AL-66), against stand-ins for web3 and the contract so CI needs no chain.
The real contract is checked by test_chain_live.py when a local Hardhat node is running."""

import hashlib

import pytest
from web3.exceptions import ContractLogicError, Web3Exception
from web3.logs import DISCARD

from app import audit, loan_notes
from app.chain import ChainError, NotConfigured
from app.loan_notes import LoanNotes, NoteTerms, borrower_ref

SALT = "test-salt"
BORROWER = borrower_ref("borrower1", SALT)
TERMS = NoteTerms(principal_cents=27_000_000, apr_bps=425, term_months=360, loan_type="mortgage", borrower_ref=BORROWER)
TX = "ab" * 32
KEY = "0x" + "11" * 32
ADDRESS = "0x5FbDB2315678afecb367f032d93F642f64180aa3"


class Call:
    def __init__(self, contract, name, args):
        self.contract, self.name, self.args = contract, name, args

    def call(self):
        if self.contract.read_error:
            raise self.contract.read_error
        if self.name == "tokenOfApplication":
            return self.contract.token
        return self.contract.note  # noteOf

    def build_transaction(self, params):
        self.contract.minted_with.append(self.args)
        if self.contract.revert:
            raise ContractLogicError(self.contract.revert)
        return {"to": "note", **params}


class Functions:
    def __init__(self, contract):
        self.contract = contract

    def mint(self, *args):
        return Call(self.contract, "mint", args)

    def tokenOfApplication(self, ref):
        return Call(self.contract, "tokenOfApplication", (ref,))

    def noteOf(self, token_id):
        return Call(self.contract, "noteOf", (token_id,))


class Events:
    def __init__(self, contract):
        self.contract = contract

    def NoteMinted(self):
        return self

    def process_receipt(self, receipt, errors=None):
        self.contract.errors_mode = errors
        return self.contract.receipt_events

    def get_logs(self, from_block, argument_filters):
        self.contract.logs_asked = argument_filters
        return self.contract.logs


class FakeContract:
    def __init__(self, token=0, note=None, logs=None):
        self.token, self.note, self.logs = token, note, logs or []
        self.revert = self.read_error = None
        self.minted_with, self.logs_asked = [], None
        self.receipt_events = [{"args": {"tokenId": 7}}]
        self.functions, self.events = Functions(self), Events(self)


class FakeEth:
    def __init__(self, status=1, fail=None):
        self.status, self.fail, self.sent = status, fail, []

    def get_transaction_count(self, address, block="latest"):
        self.counted = block
        return 3

    def send_raw_transaction(self, raw):
        if self.fail:
            raise self.fail
        self.sent.append(raw)
        return bytes.fromhex(TX)

    def wait_for_transaction_receipt(self, tx_hash, timeout):
        return {"status": self.status}


class FakeAccount:
    address = "0xMinter"

    def sign_transaction(self, tx):
        class Signed:
            raw_transaction = b"signed"

        return Signed()


def on_chain(terms=TERMS):
    """The tuple noteOf returns for a note minted with these terms."""
    return (b"\x01" * 32, bytes.fromhex(terms.borrower_ref), terms.principal_cents, terms.apr_bps, terms.term_months,
            loan_notes.LOAN_TYPES[terms.loan_type], 1, 1793368451, 0)


def notes(contract=None, status=1, fail=None) -> LoanNotes:
    client = object.__new__(LoanNotes)
    client.account, client.address = FakeAccount(), ADDRESS
    client.contract = contract or FakeContract()

    class W3:
        eth = FakeEth(status, fail)

    client.w3 = W3()
    return client


# ---- minting --------------------------------------------------------------------------------------------------------


def test_a_new_note_is_signed_sent_and_its_token_and_transaction_returned():
    client = notes()
    minted = client.mint("app-approved", TERMS)
    assert minted == loan_notes.Minted(token_id=7, tx_hash="0x" + TX, contract_address=ADDRESS, already_minted=False)
    assert client.w3.eth.sent == [b"signed"]


def test_the_chain_gets_the_terms_and_references_not_the_application_id_or_the_uid():
    client = notes()
    client.mint("app-approved", TERMS)
    ref, borrower, principal, apr, term, kind = client.contract.minted_with[0]
    assert ref.hex() == audit.application_ref("app-approved") and borrower.hex() == BORROWER
    assert (principal, apr, term, kind) == (27_000_000, 425, 360, 0)
    assert b"app-approved" not in ref and b"borrower1" not in borrower


def test_a_heloc_is_minted_as_the_second_loan_type():
    client = notes()
    client.mint("app-approved", NoteTerms(10_000_000, 400, 240, "heloc", BORROWER))
    assert client.contract.minted_with[0][5] == 1


def test_the_receipts_other_logs_are_ignored_instead_of_warned_about():
    client = notes()
    client.mint("app-approved", TERMS)
    assert client.contract.errors_mode is DISCARD


def test_the_nonce_counts_pending_transactions():
    client = notes()
    client.mint("app-approved", TERMS)
    assert client.w3.eth.counted == "pending"


def test_a_note_that_is_already_on_the_chain_is_returned_and_nothing_is_sent():
    contract = FakeContract(token=5, note=on_chain(), logs=[{"transactionHash": bytes.fromhex(TX)}])
    client = notes(contract)
    minted = client.mint("app-approved", TERMS)
    assert minted == loan_notes.Minted(token_id=5, tx_hash="0x" + TX, contract_address=ADDRESS, already_minted=True)
    assert client.w3.eth.sent == [] and contract.minted_with == []
    assert contract.logs_asked == {"applicationRef": bytes.fromhex(audit.application_ref("app-approved"))}


def test_a_note_on_the_chain_with_other_terms_is_an_error_not_a_silent_match():
    other = NoteTerms(TERMS.principal_cents + 100, TERMS.apr_bps, TERMS.term_months, "mortgage", BORROWER)
    contract = FakeContract(token=5, note=on_chain(other), logs=[{"transactionHash": bytes.fromhex(TX)}])
    with pytest.raises(ChainError, match="different terms"):
        notes(contract).mint("app-approved", TERMS)


def test_a_note_whose_minting_transaction_cannot_be_found_is_an_error():
    with pytest.raises(ChainError, match="transaction that minted it"):
        notes(FakeContract(token=5, note=on_chain())).mint("app-approved", TERMS)


def test_a_second_request_that_loses_the_race_gets_the_first_ones_note():
    contract = FakeContract(note=on_chain(), logs=[{"transactionHash": bytes.fromhex(TX)}])
    contract.revert = "execution reverted: AlreadyMinted(0x01, 5)"
    original = contract.functions.tokenOfApplication
    answers = iter([0, 5])  # nothing at the first look, the winner's token at the second
    contract.functions.tokenOfApplication = lambda ref: (setattr(contract, "token", next(answers)), original(ref))[1]
    minted = notes(contract).mint("app-approved", TERMS)
    assert minted.token_id == 5 and minted.already_minted


def test_a_revert_keeps_its_reason_cut_to_200_characters():
    contract = FakeContract()
    contract.revert = "execution reverted: AccessControlUnauthorizedAccount " + "x" * 500
    with pytest.raises(ChainError, match="refused the loan note: .*AccessControlUnauthorizedAccount") as e:
        notes(contract).mint("app-approved", TERMS)
    assert len(str(e.value)) < 300


def test_a_rejected_transaction_is_an_error():
    with pytest.raises(ChainError, match="rejected"):
        notes(status=0).mint("app-approved", TERMS)


def test_a_chain_that_cannot_be_reached_is_an_error_that_does_not_leak_the_wire_details():
    with pytest.raises(ChainError, match="could not be minted") as e:
        notes(fail=Web3Exception("http://secret-node: boom")).mint("app-approved", TERMS)
    assert "secret-node" not in str(e.value)


def test_a_chain_that_cannot_be_read_is_an_error():
    contract = FakeContract()
    contract.read_error = Web3Exception("http://secret-node: down")
    with pytest.raises(ChainError, match="could not be read") as e:
        notes(contract).mint("app-approved", TERMS)
    assert "secret-node" not in str(e.value)


def test_a_receipt_without_the_note_minted_event_is_an_error():
    contract = FakeContract()
    contract.receipt_events = []
    with pytest.raises(ChainError, match="token id could not be read"):
        notes(contract).mint("app-approved", TERMS)


# ---- the borrower reference -----------------------------------------------------------------------------------------


def test_the_borrower_reference_is_a_salted_sha256_of_the_uid():
    assert borrower_ref("borrower1", SALT) == hashlib.sha256(b"test-saltborrower1").hexdigest()
    assert borrower_ref("borrower1", "another-salt") != borrower_ref("borrower1", SALT)
    assert borrower_ref("borrower2", SALT) != borrower_ref("borrower1", SALT)


def test_without_a_salt_there_is_no_reference():
    with pytest.raises(NotConfigured, match="BORROWER_REF_SALT"):
        borrower_ref("borrower1", "")


# ---- settings -------------------------------------------------------------------------------------------------------


def test_no_key_means_not_configured():
    with pytest.raises(NotConfigured, match="CHAIN_MINTER_PRIVATE_KEY"):
        LoanNotes.from_env({})


def test_no_address_and_no_deployment_file_means_not_configured(monkeypatch, tmp_path):
    monkeypatch.setattr(loan_notes, "DEPLOYMENTS", tmp_path)
    with pytest.raises(NotConfigured, match="LOAN_NOTE_ADDRESS"):
        LoanNotes.from_env({"CHAIN_MINTER_PRIVATE_KEY": KEY})


def test_the_address_comes_from_the_setting_or_else_from_the_deployment_file(monkeypatch, tmp_path):
    (tmp_path / "localhost.json").write_text('{"LoanNote": {"address": "' + ADDRESS + '"}}')
    monkeypatch.setattr(loan_notes, "DEPLOYMENTS", tmp_path)
    assert LoanNotes.from_env({"CHAIN_MINTER_PRIVATE_KEY": KEY}).address == ADDRESS
    other = "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512"
    assert LoanNotes.from_env({"CHAIN_MINTER_PRIVATE_KEY": KEY, "LOAN_NOTE_ADDRESS": other}).address == other
