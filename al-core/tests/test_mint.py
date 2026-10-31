"""POST /core/applications/{id}/mint against the same in-memory Firestore as the other API tests, with stand-ins for the chain."""

import hashlib

import pytest

from app import audit_store, mint
from app.audit import AuditRecordError
from app.audit_store import Anchored
from app.chain import ChainError, NotConfigured
from app.loan_notes import Minted
from tests.test_applications import LATER, TOKEN, client, fake, sign_in  # noqa: F401

SALT = "test-salt"
AUDIT_HASH = "cd" * 32
AUDIT_TX = "0x" + "ee" * 32
MINT_TX = "0x" + "ab" * 32
CONTRACT = "0x5FbDB2315678afecb367f032d93F642f64180aa3"


class FakeNotes:
    def __init__(self, calls, error=None):
        self.calls, self.error, self.terms = calls, error, []

    def mint(self, application_id, terms):
        self.calls.append("mint")
        self.terms.append((application_id, terms))
        if self.error:
            raise self.error
        return Minted(token_id=12, tx_hash=MINT_TX, contract_address=CONTRACT, already_minted=False)


@pytest.fixture
def approved(fake, monkeypatch):
    """An Underwriter Approved application with an underwriter signed in, and the chain replaced by stand-ins."""
    monkeypatch.setattr(mint, "db", lambda: fake["db"])
    monkeypatch.setenv("BORROWER_REF_SALT", SALT)
    fake["db"].store["applications/app1"] = {
        "borrowerId": "borrower1", "brokerId": "broker1", "borrowerName": "Alice Byrne", "status": "Underwriter Approved",
        "loanType": "mortgage", "loanAmountEur": 270000, "termYears": 30, "aprPct": 4.25,
        "decision": {"outcome": "approved", "underwriterId": "underwriter1", "decidedAt": LATER},
        "statusHistory": [{"from": "AI Deliberated", "to": "Underwriter Approved", "actor": "underwriter", "actorId": "underwriter1"}],
    }
    fake["db"].versions["applications/app1"] = 1  # the fake only checks a stale write for a document it has a version of
    sign_in(fake, "underwriter1", "underwriter")

    calls = []
    fake["calls"], fake["anchor_error"] = calls, None
    fake["notes"] = FakeNotes(calls)

    def anchor(application_id, registry):
        calls.append("anchor")
        if fake["anchor_error"]:
            raise fake["anchor_error"]
        return Anchored(record={}, audit_hash=AUDIT_HASH, tx_hash=AUDIT_TX, already_stored=False)

    monkeypatch.setattr(audit_store, "anchor", anchor)
    monkeypatch.setattr(mint, "audit_registry", lambda: object())
    monkeypatch.setattr(mint, "loan_notes", lambda: fake["notes"])
    return fake


def doc(fake):
    return fake["db"].store["applications/app1"]


def do_mint(app_id="app1"):
    return client.post(f"/core/applications/{app_id}/mint", headers=TOKEN)


# AC1: an Underwriter Approved application is minted with its terms, and the token and transaction are stored


def test_minting_saves_the_note_and_moves_the_application_to_funded(approved):
    r = do_mint()
    assert r.status_code == 201
    assert r.json()["status"] == "Funded"
    assert r.json()["loan_note"] == {
        "token_id": "12", "contract_address": CONTRACT, "tx_hash": MINT_TX, "audit_hash": AUDIT_HASH,
        "minted_at": "2026-10-14T09:00:00.000Z",
    }
    assert doc(approved)["status"] == "Funded"
    assert doc(approved)["loanNote"] == {
        "tokenId": "12", "contractAddress": CONTRACT, "txHash": MINT_TX, "auditHash": AUDIT_HASH, "mintedAt": LATER,
    }


def test_the_audit_hash_is_anchored_before_the_note_is_minted(approved):
    do_mint()
    assert approved["calls"] == ["anchor", "mint"]


def test_the_note_carries_the_principal_in_cents_the_rate_in_basis_points_and_the_term_in_months(approved):
    do_mint()
    ((application_id, terms),) = approved["notes"].terms
    assert application_id == "app1"
    assert (terms.principal_cents, terms.apr_bps, terms.term_months, terms.loan_type) == (27_000_000, 425, 360, "mortgage")


@pytest.mark.parametrize("apr,bps", [(4.25, 425), (3.99, 399), (4, 400), (0, 0), (4.005, 401)])
def test_the_rate_becomes_basis_points_without_float_slips(approved, apr, bps):
    doc(approved)["aprPct"] = apr
    do_mint()
    assert approved["notes"].terms[0][1].apr_bps == bps


def test_a_cents_amount_is_exact(approved):
    doc(approved)["loanAmountEur"] = 123456.78
    do_mint()
    assert approved["notes"].terms[0][1].principal_cents == 12_345_678


def test_a_heloc_is_minted_as_a_heloc(approved):
    doc(approved)["loanType"] = "heloc"
    do_mint()
    assert approved["notes"].terms[0][1].loan_type == "heloc"


def test_the_borrower_is_on_the_chain_only_as_a_salted_hash(approved):
    do_mint()
    expected = hashlib.sha256(b"test-saltborrower1").hexdigest()
    assert approved["notes"].terms[0][1].borrower_ref == expected
    assert "borrower1" not in expected


def test_the_rate_falls_back_to_the_benchmark_rate_in_the_dti_breakdown(approved):
    doc(approved).pop("aprPct")
    approved["db"].store["applications/app1/review/underwriting"] = {"dtiBreakdown": {"benchmarkRatePct": 3.75}}
    do_mint()
    assert approved["notes"].terms[0][1].apr_bps == 375


def test_a_rate_taken_from_the_dti_breakdown_is_saved_as_aprpct_in_the_same_write_as_the_note(approved):
    doc(approved).pop("aprPct")
    approved["db"].store["applications/app1/review/underwriting"] = {"dtiBreakdown": {"benchmarkRatePct": 3.75}}
    do_mint()
    assert doc(approved)["aprPct"] == 3.75 and doc(approved)["loanNote"]["tokenId"] == "12"
    sign_in(approved, "borrower1", "borrower")
    assert client.get("/core/applications/app1", headers=TOKEN).json()["loan_note"]["token_id"] == "12"


def test_the_saved_rate_is_the_one_on_the_note_not_an_unrounded_original(approved):
    doc(approved).pop("aprPct")
    approved["db"].store["applications/app1/review/underwriting"] = {"dtiBreakdown": {"benchmarkRatePct": 3.754}}
    do_mint()
    assert approved["notes"].terms[0][1].apr_bps == 375 and doc(approved)["aprPct"] == 3.75


def test_an_application_that_already_has_a_rate_keeps_it(approved):
    do_mint()
    assert doc(approved)["aprPct"] == 4.25


def test_a_failed_mint_does_not_save_a_rate(approved):
    doc(approved).pop("aprPct")
    approved["db"].store["applications/app1/review/underwriting"] = {"dtiBreakdown": {"benchmarkRatePct": 3.75}}
    approved["notes"].error = ChainError("the chain could not be reached")
    do_mint()
    assert "aprPct" not in doc(approved)


def test_the_move_is_logged_as_a_mint_by_the_underwriter_who_asked(approved):
    do_mint()
    entry = doc(approved)["statusHistory"][-1]
    assert (entry["from"], entry["to"], entry["actor"], entry["actorId"]) == ("Underwriter Approved", "Funded", "mint", "underwriter1")


def test_the_note_shows_on_a_later_read_by_the_borrower(approved):
    do_mint()
    sign_in(approved, "borrower1", "borrower")
    body = client.get("/core/applications/app1", headers=TOKEN).json()
    assert body["status"] == "Funded" and body["loan_note"]["token_id"] == "12"


def test_an_application_with_no_note_has_a_null_loan_note(approved):
    sign_in(approved, "borrower1", "borrower")
    assert client.get("/core/applications/app1", headers=TOKEN).json()["loan_note"] is None


# AC2: on a failure the status stays Underwriter Approved and the error is returned


def test_a_chain_that_refuses_the_mint_is_502_and_nothing_is_saved(approved):
    approved["notes"].error = ChainError("the chain refused the loan note: AccessControlUnauthorizedAccount")
    before = dict(doc(approved))
    r = do_mint()
    assert r.status_code == 502 and "AccessControlUnauthorizedAccount" in r.json()["error"]["message"]
    assert doc(approved) == before


def test_a_failed_mint_can_be_tried_again(approved):
    approved["notes"].error = ChainError("the chain could not be reached")
    assert do_mint().status_code == 502
    approved["notes"].error = None
    r = do_mint()
    assert r.status_code == 201 and doc(approved)["status"] == "Funded"


def test_a_chain_that_refuses_the_audit_hash_stops_before_minting(approved):
    approved["anchor_error"] = ChainError("the chain refused the audit hash: no role")
    r = do_mint()
    assert r.status_code == 502
    assert approved["calls"] == ["anchor"] and doc(approved)["status"] == "Underwriter Approved"


def test_an_application_with_no_complete_ai_run_is_409_and_the_chain_is_not_asked_to_mint(approved):
    approved["anchor_error"] = AuditRecordError("the application has no complete AI run")
    r = do_mint()
    assert r.status_code == 409 and "no complete AI run" in r.json()["error"]["message"]
    assert approved["calls"] == ["anchor"] and doc(approved)["status"] == "Underwriter Approved"


def test_a_server_without_chain_settings_is_503_and_nothing_changes(approved, monkeypatch):
    def not_set_up():
        raise mint.HTTPException(503, "The blockchain is not set up on this server: CHAIN_MINTER_PRIVATE_KEY is not set")

    monkeypatch.setattr(mint, "loan_notes", not_set_up)
    before = dict(doc(approved))
    r = do_mint()
    assert r.status_code == 503 and "CHAIN_MINTER_PRIVATE_KEY" in r.json()["error"]["message"]
    assert doc(approved) == before and approved["calls"] == []


def test_a_server_without_a_borrower_salt_is_503(approved, monkeypatch):
    monkeypatch.delenv("BORROWER_REF_SALT")
    r = do_mint()
    assert r.status_code == 503 and "BORROWER_REF_SALT" in r.json()["error"]["message"]
    assert approved["calls"] == []


# AC3: calling it twice doesn't mint twice


def test_calling_it_again_returns_the_same_note_and_mints_nothing(approved):
    first = do_mint().json()
    approved["calls"].clear()
    again = do_mint()
    assert again.status_code == 200 and again.json() == first
    assert approved["calls"] == []
    assert len(doc(approved)["statusHistory"]) == 2


def test_a_second_call_that_loses_the_race_returns_the_note_the_first_saved(approved):
    note = {"tokenId": "12", "contractAddress": CONTRACT, "txHash": MINT_TX, "auditHash": AUDIT_HASH, "mintedAt": LATER}

    class Racing(FakeNotes):
        def mint(self, application_id, terms):
            minted = super().mint(application_id, terms)
            doc(approved).update({"status": "Funded", "loanNote": note})  # the other request finished while this one waited
            return minted

    approved["notes"] = Racing(approved["calls"])
    r = do_mint()
    assert r.status_code == 200 and r.json()["loan_note"]["token_id"] == "12"
    assert len(doc(approved)["statusHistory"]) == 1  # this call did not add a second Funded entry


# AC4: only underwriters


@pytest.mark.parametrize("uid,role", [("broker1", "broker"), ("borrower1", "borrower")])
def test_other_roles_get_403_and_nothing_happens(approved, uid, role):
    sign_in(approved, uid, role)
    before = dict(doc(approved))
    assert do_mint().status_code == 403
    assert doc(approved) == before and approved["calls"] == []


def test_minting_needs_a_token():
    assert client.post("/core/applications/app1/mint").status_code == 401


# Only an Underwriter Approved application can be minted


@pytest.mark.parametrize("status", ["Draft", "Applied", "AI Deliberated", "Declined", "Closed"])
def test_minting_any_other_status_is_409_and_the_chain_is_not_touched(approved, status):
    doc(approved)["status"] = status
    r = do_mint()
    assert r.status_code == 409 and status in r.json()["error"]["message"]
    assert approved["calls"] == []


def test_an_unknown_application_is_404(approved):
    assert do_mint("nope").status_code == 404


# What a note needs: the chain is never asked for an application that couldn't make a valid one


@pytest.mark.parametrize("field", ["loanAmountEur", "termYears", "aprPct"])
def test_an_application_missing_a_term_of_the_note_is_409_and_the_chain_is_not_touched(approved, field):
    doc(approved).pop(field)
    r = do_mint()
    assert r.status_code == 409
    assert approved["calls"] == [] and doc(approved)["status"] == "Underwriter Approved"


def test_a_term_over_forty_years_is_409(approved):
    doc(approved)["termYears"] = 41
    assert do_mint().status_code == 409 and approved["calls"] == []


@pytest.mark.parametrize("apr", [-1, 100.5])
def test_a_rate_outside_zero_to_a_hundred_percent_is_409(approved, apr):
    doc(approved)["aprPct"] = apr
    assert do_mint().status_code == 409 and approved["calls"] == []
