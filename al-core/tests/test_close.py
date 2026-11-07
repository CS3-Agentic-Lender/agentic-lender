"""POST /core/applications/{id}/close against the same in-memory Firestore as the other API tests, with a stand-in for the chain."""

from datetime import datetime, timezone

import pytest
from fastapi import HTTPException

from app import close, mint
from app.chain import ChainError
from app.loan_notes import Closed
from tests.test_applications import LATER, TOKEN, client, fake, sign_in  # noqa: F401

CONTRACT = "0x5FbDB2315678afecb367f032d93F642f64180aa3"
MINT_TX = "0x" + "ab" * 32
CLOSE_TX = "0x" + "cd" * 32
CLOSED_AT = datetime(2026, 11, 6, 16, 0, 0, tzinfo=timezone.utc)
NOTE = {"tokenId": "12", "contractAddress": CONTRACT, "txHash": MINT_TX, "auditHash": "cd" * 32, "network": "localhost", "mintedAt": LATER}


class FakeNotes:
    """Closing is remembered like the real contract does: the first call sends a transaction, any later one only finds it."""

    network = "localhost"

    def __init__(self, calls, error=None):
        self.calls, self.error, self.sent, self.closed = calls, error, 0, False

    def close(self, application_id):
        self.calls.append(("close", application_id))
        if self.error:
            raise self.error
        already, self.closed = self.closed, True
        self.sent += 0 if already else 1
        return Closed(token_id=12, tx_hash=CLOSE_TX, closed_at=CLOSED_AT, contract_address=CONTRACT, already_closed=already)


@pytest.fixture
def funded(fake, monkeypatch):
    """A Funded application with its loan note, an underwriter signed in, and the chain replaced by a stand-in."""
    monkeypatch.setattr(close, "db", lambda: fake["db"])
    fake["db"].store["applications/app1"] = {
        "borrowerId": "borrower1", "brokerId": "broker1", "borrowerName": "Alice Byrne", "status": "Funded",
        "loanType": "mortgage", "loanAmountEur": 270000, "termYears": 30, "aprPct": 4.25, "loanNote": dict(NOTE),
        "statusHistory": [{"from": "Underwriter Approved", "to": "Funded", "actor": "mint", "actorId": "underwriter1"}],
    }
    fake["db"].versions["applications/app1"] = 1  # the fake only checks a stale write for a document it has a version of
    sign_in(fake, "underwriter1", "underwriter")
    fake["calls"] = []
    fake["notes"] = FakeNotes(fake["calls"])
    monkeypatch.setattr(close, "loan_notes", lambda: fake["notes"])
    return fake


def doc(fake):
    return fake["db"].store["applications/app1"]


def do_close(app_id="app1"):
    return client.post(f"/core/applications/{app_id}/close", headers=TOKEN)


# AC1: a Funded application is closed on the chain, then saved as Closed with the note's close time and transaction


def test_closing_a_funded_application_closes_the_note_and_saves_when_and_how(funded):
    r = do_close()
    assert r.status_code == 200 and r.json()["status"] == "Closed"
    assert funded["calls"] == [("close", "app1")]
    assert doc(funded)["status"] == "Closed"
    assert doc(funded)["loanNote"] == {**NOTE, "closedAt": CLOSED_AT, "closeTxHash": CLOSE_TX}
    assert r.json()["loan_note"] == {
        "token_id": "12", "contract_address": CONTRACT, "tx_hash": MINT_TX, "audit_hash": "cd" * 32, "network": "localhost",
        "minted_at": "2026-10-14T09:00:00.000Z", "closed_at": "2026-11-06T16:00:00.000Z", "close_tx_hash": CLOSE_TX,
    }


def test_the_rest_of_the_note_is_left_exactly_as_minted(funded):
    do_close()
    for field, value in NOTE.items():
        assert doc(funded)["loanNote"][field] == value


def test_the_move_is_logged_as_a_close_by_the_underwriter_who_asked(funded):
    do_close()
    entry = doc(funded)["statusHistory"][-1]
    assert (entry["from"], entry["to"], entry["actor"], entry["actorId"]) == ("Funded", "Closed", "underwriter", "underwriter1")
    assert len(doc(funded)["statusHistory"]) == 2


def test_the_closed_note_shows_on_a_later_read_by_the_borrower(funded):
    do_close()
    sign_in(funded, "borrower1", "borrower")
    body = client.get("/core/applications/app1", headers=TOKEN).json()
    assert body["status"] == "Closed" and body["loan_note"]["close_tx_hash"] == CLOSE_TX


def test_a_note_that_was_never_closed_reads_back_with_none(funded):
    sign_in(funded, "borrower1", "borrower")
    note = client.get("/core/applications/app1", headers=TOKEN).json()["loan_note"]
    assert note["closed_at"] is None and note["close_tx_hash"] is None


# AC2: a Declined application is closed with no chain call and no loan note


def test_closing_a_declined_application_touches_no_chain_and_adds_no_note(funded):
    doc(funded).update({"status": "Declined"})
    doc(funded).pop("loanNote")
    r = do_close()
    assert r.status_code == 200 and r.json()["status"] == "Closed" and r.json()["loan_note"] is None
    assert funded["calls"] == [] and "loanNote" not in doc(funded)
    entry = doc(funded)["statusHistory"][-1]
    assert (entry["from"], entry["to"], entry["actor"]) == ("Declined", "Closed", "underwriter")


def test_a_declined_application_closes_on_a_server_with_no_chain_settings(funded, monkeypatch):
    doc(funded).update({"status": "Declined"})
    doc(funded).pop("loanNote")

    def never():
        raise AssertionError("a declined application has no note, so the chain settings are not needed")

    monkeypatch.setattr(close, "loan_notes", never)
    assert do_close().status_code == 200


# AC3: any other status is 409, other roles are 403, no token is 401


@pytest.mark.parametrize("status", ["Draft", "Applied", "AI Deliberated", "Underwriter Approved"])
def test_closing_any_other_status_is_409_and_the_chain_is_not_touched(funded, status):
    doc(funded)["status"] = status
    before = dict(doc(funded))
    r = do_close()
    assert r.status_code == 409 and status in r.json()["error"]["message"]
    assert funded["calls"] == [] and doc(funded) == before


@pytest.mark.parametrize("uid,role", [("broker1", "broker"), ("borrower1", "borrower")])
def test_other_roles_get_403_and_nothing_happens(funded, uid, role):
    sign_in(funded, uid, role)
    before = dict(doc(funded))
    assert do_close().status_code == 403
    assert doc(funded) == before and funded["calls"] == []


def test_closing_needs_a_token():
    assert client.post("/core/applications/app1/close").status_code == 401


def test_an_unknown_application_is_404(funded):
    assert do_close("nope").status_code == 404


def test_a_funded_application_with_no_loan_note_is_409_and_the_chain_is_not_touched(funded):
    doc(funded).pop("loanNote")
    r = do_close()
    assert r.status_code == 409 and "no loan note" in r.json()["error"]["message"]
    assert funded["calls"] == [] and doc(funded)["status"] == "Funded"


# AC4: a failure leaves the application Funded; a close that reached the chain but not Firestore is finished, not repeated


def test_a_chain_that_refuses_the_close_is_502_and_nothing_is_saved(funded):
    funded["notes"].error = ChainError("the chain refused to close the loan note: AccessControlUnauthorizedAccount")
    before = dict(doc(funded))
    r = do_close()
    assert r.status_code == 502 and "AccessControlUnauthorizedAccount" in r.json()["error"]["message"]
    assert doc(funded) == before and doc(funded)["status"] == "Funded"


def test_a_failed_close_can_be_tried_again(funded):
    funded["notes"].error = ChainError("the chain could not be reached")
    assert do_close().status_code == 502
    funded["notes"].error = None
    r = do_close()
    assert r.status_code == 200 and doc(funded)["status"] == "Closed" and funded["notes"].sent == 1


def test_a_server_without_chain_settings_is_503_and_nothing_changes(funded, monkeypatch):
    monkeypatch.setattr(close, "loan_notes", mint.loan_notes)
    monkeypatch.delenv("CHAIN_MINTER_PRIVATE_KEY", raising=False)
    before = dict(doc(funded))
    r = do_close()
    assert r.status_code == 503 and "CHAIN_MINTER_PRIVATE_KEY" in r.json()["error"]["message"]
    assert doc(funded) == before and funded["calls"] == []


def test_a_close_that_reached_the_chain_but_not_firestore_is_finished_by_the_retry_without_a_second_transaction(funded, monkeypatch):
    real = close._update_if_unchanged
    attempts = []

    def fail_once(ref, changes, read_at):
        attempts.append(1)
        if len(attempts) == 1:
            raise HTTPException(500, "firestore went away")
        return real(ref, changes, read_at)

    monkeypatch.setattr(close, "_update_if_unchanged", fail_once)
    assert do_close().status_code == 500
    assert doc(funded)["status"] == "Funded" and "closeTxHash" not in doc(funded)["loanNote"]  # the chain closed it, Firestore did not hear

    r = do_close()
    assert r.status_code == 200 and doc(funded)["status"] == "Closed"
    assert funded["notes"].sent == 1  # the retry found the closed note; no second transaction was sent
    assert doc(funded)["loanNote"]["closeTxHash"] == CLOSE_TX and doc(funded)["loanNote"]["closedAt"] == CLOSED_AT
    assert len(doc(funded)["statusHistory"]) == 2


# AC5: closing again is safe


def test_closing_again_returns_the_same_result_and_sends_nothing(funded):
    first = do_close().json()
    funded["calls"].clear()
    again = do_close()
    assert again.status_code == 200 and again.json() == first
    assert funded["calls"] == [] and funded["notes"].sent == 1
    assert len(doc(funded)["statusHistory"]) == 2  # no second Closed entry


def test_closing_a_closed_declined_application_again_is_200_too(funded):
    doc(funded).update({"status": "Declined"})
    doc(funded).pop("loanNote")
    first = do_close().json()
    again = do_close()
    assert again.status_code == 200 and again.json() == first and funded["calls"] == []


def test_a_second_call_that_loses_the_race_returns_what_the_first_saved(funded):
    class Racing(FakeNotes):
        def close(self, application_id):
            closed = super().close(application_id)
            doc(funded).update({"status": "Closed"})  # the other request finished while this one waited
            doc(funded)["loanNote"].update({"closedAt": CLOSED_AT, "closeTxHash": CLOSE_TX})
            return closed

    funded["notes"] = Racing(funded["calls"])
    before_history = len(doc(funded)["statusHistory"])
    r = do_close()
    assert r.status_code == 200 and r.json()["status"] == "Closed" and r.json()["loan_note"]["close_tx_hash"] == CLOSE_TX
    assert len(doc(funded)["statusHistory"]) == before_history  # this call did not add a second Closed entry
