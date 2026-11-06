"""Closing a loan note on the chain (AL-293), against stand-ins for web3 and the contract so CI needs no chain.
The real contract is checked by test_chain_live.py when a local Hardhat node is running."""

from datetime import datetime, timezone

import pytest
from web3.exceptions import ContractLogicError, Web3Exception

from app import audit, loan_notes
from app.chain import ChainError
from tests.test_loan_notes import ADDRESS, TX, notes, on_chain

CLOSED_TX = "cd" * 32
CLOSED_AT = 1793400000  # seconds, as the contract stores it


class CloseCall:
    def __init__(self, contract, name, args):
        self.contract, self.name, self.args = contract, name, args

    def call(self):
        if self.contract.read_error:
            raise self.contract.read_error
        if self.name == "tokenOfApplication":
            return self.contract.token
        return self.contract.note()  # noteOf

    def build_transaction(self, params):
        self.contract.closed_with.append(self.args)
        if self.contract.revert:
            raise ContractLogicError(self.contract.revert)
        self.contract.status, self.contract.closed_at = 2, CLOSED_AT  # as if mined
        return {"to": "note", **params}


class CloseFunctions:
    def __init__(self, contract):
        self.contract = contract

    def tokenOfApplication(self, ref):
        self.contract.asked_refs.append(ref)
        return CloseCall(self.contract, "tokenOfApplication", (ref,))

    def noteOf(self, token_id):
        return CloseCall(self.contract, "noteOf", (token_id,))

    def close(self, token_id):
        return CloseCall(self.contract, "close", (token_id,))


class CloseEvents:
    def __init__(self, contract):
        self.contract = contract

    def NoteClosed(self):
        return self

    def get_logs(self, from_block, argument_filters):
        self.contract.logs_asked = argument_filters
        return self.contract.logs


class CloseContract:
    """An Active note by default. Closing it flips the status and sets the time, like the real contract."""

    def __init__(self, token=5, status=1, closed_at=0, logs=None):
        self.token, self.status, self.closed_at, self.logs = token, status, closed_at, logs or []
        self.revert = self.read_error = None
        self.closed_with, self.logs_asked, self.asked_refs = [], None, []
        self.functions, self.events = CloseFunctions(self), CloseEvents(self)

    def note(self):
        base = list(on_chain())
        base[6], base[8] = self.status, self.closed_at
        return tuple(base)


def an_active_note(**kw):
    return notes(CloseContract(**kw))


def test_an_active_note_is_closed_with_one_transaction_and_its_time_and_hash_returned():
    client = an_active_note()
    closed = client.close("app-funded")
    assert closed == loan_notes.Closed(
        token_id=5, tx_hash="0x" + TX, closed_at=datetime.fromtimestamp(CLOSED_AT, tz=timezone.utc), contract_address=ADDRESS,
        already_closed=False,
    )
    assert client.w3.eth.sent == [b"signed"] and client.contract.closed_with == [(5,)]


def test_the_chain_is_asked_about_the_application_by_its_reference_not_its_id():
    client = an_active_note()
    client.close("app-funded")
    (ref,) = client.contract.asked_refs
    assert ref.hex() == audit.application_ref("app-funded") and b"app-funded" not in ref


def test_the_time_is_the_chains_own_so_a_retry_saves_the_same_value():
    first = an_active_note().close("app-funded")
    later = notes(CloseContract(status=2, closed_at=CLOSED_AT, logs=[{"transactionHash": bytes.fromhex(TX)}])).close("app-funded")
    assert first.closed_at == later.closed_at


def test_the_nonce_counts_pending_transactions():
    client = an_active_note()
    client.close("app-funded")
    assert client.w3.eth.counted == "pending"


def test_the_note_says_which_chain_it_is_on():
    client = an_active_note()
    client.network = "amoy"
    assert client.close("app-funded").network == "amoy"


def test_a_note_that_is_already_closed_is_returned_with_its_closing_transaction_and_nothing_is_sent():
    contract = CloseContract(status=2, closed_at=CLOSED_AT, logs=[{"transactionHash": bytes.fromhex(CLOSED_TX)}])
    client = notes(contract)
    closed = client.close("app-funded")
    assert closed.already_closed and closed.tx_hash == "0x" + CLOSED_TX and closed.token_id == 5
    assert client.w3.eth.sent == [] and contract.closed_with == []
    assert contract.logs_asked == {"tokenId": 5}


def test_an_application_with_no_note_on_the_chain_is_an_error_and_nothing_is_sent():
    client = notes(CloseContract(token=0))
    with pytest.raises(ChainError, match="no loan note on the chain"):
        client.close("app-funded")
    assert client.w3.eth.sent == []


def test_a_closed_note_whose_closing_transaction_cannot_be_found_is_an_error():
    with pytest.raises(ChainError, match="transaction that closed it"):
        notes(CloseContract(status=2, closed_at=CLOSED_AT)).close("app-funded")


def test_a_second_request_that_loses_the_race_gets_the_first_ones_close():
    contract = CloseContract(logs=[{"transactionHash": bytes.fromhex(CLOSED_TX)}])
    contract.revert = "execution reverted: NotActive(5)"
    real = contract.note
    reads = iter([1, 2, 2])  # active at the first look, closed by the winner when it is read again
    contract.note = lambda: (setattr(contract, "status", next(reads)), setattr(contract, "closed_at", CLOSED_AT), real())[2]
    closed = notes(contract).close("app-funded")
    assert closed.already_closed and closed.tx_hash == "0x" + CLOSED_TX


def test_a_revert_keeps_its_reason_cut_to_200_characters():
    contract = CloseContract()
    contract.revert = "execution reverted: AccessControlUnauthorizedAccount " + "x" * 500
    with pytest.raises(ChainError, match="refused to close the loan note: .*AccessControlUnauthorizedAccount") as e:
        notes(contract).close("app-funded")
    assert len(str(e.value)) < 300


def test_a_rejected_transaction_is_an_error():
    with pytest.raises(ChainError, match="rejected"):
        notes(CloseContract(), status=0).close("app-funded")


def test_a_chain_that_cannot_be_reached_is_an_error_that_does_not_leak_the_wire_details():
    with pytest.raises(ChainError, match="could not be closed") as e:
        notes(CloseContract(), fail=Web3Exception("http://secret-node: boom")).close("app-funded")
    assert "secret-node" not in str(e.value)


def test_a_chain_that_cannot_be_read_is_an_error():
    contract = CloseContract()
    contract.read_error = Web3Exception("http://secret-node: down")
    with pytest.raises(ChainError, match="could not be read") as e:
        notes(contract).close("app-funded")
    assert "secret-node" not in str(e.value)


