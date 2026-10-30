"""POST /core/applications/{id}/decision against the same in-memory Firestore as the other API tests."""

import pytest

from app import decision
from tests.test_applications import FULL_MORTGAGE, LATER, TOKEN, client, fake, sign_in, stored  # noqa: F401

DONE = {"outcome": "approved", "reason": "Low LTV and DTI within limits"}


@pytest.fixture
def signoff(fake, monkeypatch):
    """An application waiting for sign-off (AI Deliberated), with an underwriter signed in."""
    monkeypatch.setattr(decision, "db", lambda: fake["db"])
    fake["db"].store["applications/app1"] = {
        "borrowerId": "borrower1", "brokerId": "broker1", "borrowerName": "Alice Byrne",
        "status": "AI Deliberated", "loanType": "mortgage",
    }
    fake["db"].versions["applications/app1"] = 1  # the fake only checks a stale write for a document it has a version of
    sign_in(fake, "underwriter1", "underwriter")
    return fake


def decide(body, app_id="app1"):
    return client.post(f"/core/applications/{app_id}/decision", json=body, headers=TOKEN)


def doc(fake):
    return fake["db"].store["applications/app1"]


# AC1: a sign-off saves the decision, who, when and why, and moves the status


@pytest.mark.parametrize("outcome,status", [("approved", "Underwriter Approved"), ("declined", "Declined")])
def test_a_sign_off_saves_the_decision_and_moves_the_status(signoff, outcome, status):
    r = decide({"outcome": outcome, "reason": "Because"})
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == status
    assert body["decision"] == {
        "outcome": outcome, "underwriter_id": "underwriter1", "decided_at": "2026-10-14T09:00:00.000Z", "reason": "Because",
    }
    assert doc(signoff)["status"] == status
    assert doc(signoff)["decision"] == {"outcome": outcome, "underwriterId": "underwriter1", "decidedAt": LATER, "reason": "Because"}


def test_the_reason_is_optional_and_left_out_when_blank(signoff):
    assert decide({"outcome": "approved"}).json()["decision"]["reason"] is None
    assert "reason" not in doc(signoff)["decision"]
    signoff["db"].store["applications/app1"]["status"] = "AI Deliberated"
    signoff["db"].store["applications/app1"].pop("decision")
    assert decide({"outcome": "approved", "reason": "   "}).status_code == 200
    assert "reason" not in doc(signoff)["decision"]


def test_the_move_is_logged_with_who_made_it(signoff):
    decide(DONE)
    (entry,) = doc(signoff)["statusHistory"]
    assert (entry["from"], entry["to"], entry["actor"], entry["actorId"]) == (
        "AI Deliberated", "Underwriter Approved", "underwriter", "underwriter1")


def test_the_decision_shows_on_a_later_read(signoff):
    decide(DONE)
    sign_in(signoff, "borrower1", "borrower")
    body = client.get("/core/applications/app1", headers=TOKEN).json()
    assert body["decision"]["outcome"] == "approved" and body["status"] == "Underwriter Approved"


def test_an_undecided_application_has_a_null_decision(signoff):
    assert client.get("/core/applications/app1", headers=TOKEN).json()["decision"] is None


# AC2: only an underwriter


@pytest.mark.parametrize("uid,role", [("broker1", "broker"), ("borrower1", "borrower")])
def test_other_roles_get_403_and_nothing_changes(signoff, uid, role):
    sign_in(signoff, uid, role)
    before = dict(doc(signoff))
    assert decide(DONE).status_code == 403
    assert doc(signoff) == before


def test_a_decision_needs_a_token():
    assert client.post("/core/applications/app1/decision", json=DONE).status_code == 401


# AC3: only an AI Deliberated application can be signed off


@pytest.mark.parametrize("status", ["Draft", "Applied", "Underwriter Approved", "Declined", "Funded", "Closed"])
def test_signing_off_any_other_status_is_409(signoff, status):
    doc(signoff)["status"] = status
    before = dict(doc(signoff))
    r = decide({"outcome": "declined" if status == "Underwriter Approved" else "approved"})
    assert r.status_code == 409 and r.json()["error"]["code"] == "CONFLICT"
    assert status in r.json()["error"]["message"]
    assert doc(signoff) == before


def test_the_opposite_decision_after_one_is_recorded_is_409(signoff):
    decide({"outcome": "approved"})
    before = dict(doc(signoff))
    assert decide({"outcome": "declined"}).status_code == 409
    assert doc(signoff) == before


def test_repeating_the_same_decision_returns_it_unchanged(signoff):
    first = decide(DONE).json()
    before = dict(doc(signoff))
    again = decide(DONE)
    assert again.status_code == 200 and again.json() == first
    assert doc(signoff) == before
    assert len(doc(signoff)["statusHistory"]) == 1


def test_a_second_underwriter_repeating_it_changes_nothing(signoff):
    decide(DONE)
    sign_in(signoff, "underwriter2", "underwriter")
    r = decide({"outcome": "approved", "reason": "Different words"})
    assert r.status_code == 200 and r.json()["decision"]["underwriter_id"] == "underwriter1"
    assert doc(signoff)["decision"]["reason"] == "Low LTV and DTI within limits"


def test_a_decision_on_an_unknown_id_is_404(signoff):
    assert decide(DONE, "nope").status_code == 404


def test_a_decision_that_loses_a_race_is_409(signoff, monkeypatch):
    """If the application changes between the read and the write, Firestore refuses the write."""
    real = decision._update_if_unchanged
    versions = signoff["db"].versions

    def stale(ref, changes, read_at):
        versions["applications/app1"] = versions.get("applications/app1", 0) + 1
        return real(ref, changes, read_at)

    monkeypatch.setattr(decision, "_update_if_unchanged", stale)
    assert decide(DONE).status_code == 409
    assert doc(signoff)["status"] == "AI Deliberated"


# Input checks


@pytest.mark.parametrize("body", [{}, {"outcome": "maybe"}, {"outcome": "approved", "reason": "x" * 1001}, {"reason": "no outcome"}])
def test_bad_input_is_422_and_nothing_changes(signoff, body):
    before = dict(doc(signoff))
    r = decide(body)
    assert r.status_code == 422 and r.json()["error"]["code"] == "INVALID_FIELD"
    assert doc(signoff) == before


def test_the_status_and_decision_cannot_be_sent_in_the_body(signoff):
    r = decide({"outcome": "approved", "status": "Funded", "decision": {"underwriterId": "someone-else"}, "underwriter_id": "x"})
    assert r.status_code == 200
    assert doc(signoff)["status"] == "Underwriter Approved" and doc(signoff)["decision"]["underwriterId"] == "underwriter1"
