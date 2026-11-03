"""GET /core/applications/{id}/audit-pack against the same in-memory Firestore as the other API tests (AL-161)."""

import copy

import pytest

from app import audit, audit_pack
from app.chain import ChainError
from tests.test_applications import LATER, TOKEN, client, fake, sign_in  # noqa: F401
from tests.test_audit_record import FUNDED, funded_inputs

MINT_TX = "0x" + "ab" * 32
AUDIT_TX = "0x" + "ee" * 32
VALUATION = {"baselineEur": 250000, "contributions": {"floorAreaSqm": 41000, "berRating": -6000}, "estimatedValueEur": 285000}
AFFORDABILITY = {"dtiPct": 24.6, "stressedDtiPct": 31.2, "dtiBand": "Comfortable", "surplusBand": "Comfortable"}
GATE = {"original": "Approve", "effective": "Approve", "conditions": [], "breaches": [], "changed": False}


class FakeRegistry:
    def __init__(self, stored=None, error=None):
        self.stored, self.error = stored, error

    def record_of(self, application_id):
        if self.error:
            raise self.error
        return self.stored


@pytest.fixture
def world(fake, monkeypatch):
    """app-funded as the seed has it, built from the shared vector's own documents, with an underwriter signed in."""
    monkeypatch.setattr(audit_pack, "db", lambda: fake["db"])
    monkeypatch.setattr(audit_pack, "_registry", lambda: None)  # no chain here; the live check is in test_chain_live.py
    application, _run, calls = funded_inputs()
    store = fake["db"].store
    store["applications/app-funded"] = {
        **application, "borrowerId": "borrower1", "brokerId": "broker1", "borrowerName": "Alice Byrne", "status": "Funded",
        "auditTxHash": AUDIT_TX,
        "loanNote": {"tokenId": "7", "contractAddress": "0x" + "11" * 20, "txHash": MINT_TX, "auditHash": FUNDED["hash"], "mintedAt": LATER},
    }
    store["applications/app-funded/audit/record"] = {**FUNDED["record"], "auditHash": FUNDED["hash"]}
    for call_id, doc in calls:
        store[f"ai_calls/{call_id}"] = doc
    store["applications/app-funded/review/underwriting"] = {
        "valuationDetail": VALUATION, "dtiBreakdown": AFFORDABILITY, "policyGate": GATE, "updatedAt": LATER,
    }
    sign_in(fake, "underwriter1", "underwriter")
    return fake


def pack(app_id="app-funded"):
    return client.get(f"/core/applications/{app_id}/audit-pack", headers=TOKEN)


def stored(world, path):
    return world["db"].store[path]


# AC1: the pack holds the canonical record and everything behind the decision


def test_the_pack_holds_the_stored_record_and_its_hash(world):
    r = pack()
    assert r.status_code == 200
    body = r.json()
    assert body["application_id"] == "app-funded" and body["audit_hash"] == FUNDED["hash"]
    assert body["record"] == FUNDED["record"]  # exactly as hashed: no auditHash of its own, camelCase keys
    assert "auditHash" not in body["record"]


def test_a_reader_can_hash_the_record_as_returned_and_get_the_audit_hash(world):
    body = pack().json()
    assert audit.audit_hash(body["record"]) == body["audit_hash"]


def test_the_pack_holds_the_application_summary_and_the_decision(world):
    application = pack().json()["application"]
    assert application["id"] == "app-funded" and application["status"] == "Funded" and application["borrower_name"] == "Alice Byrne"
    assert application["decision"]["outcome"] == "approved" and application["decision"]["underwriter_id"] == FUNDED["record"]["underwriterId"]
    assert application["decision"]["reason"] == "Strong affordability"  # the underwriter's justification


def test_the_pack_holds_the_valuation_the_affordability_figures_and_what_the_gate_said(world):
    body = pack().json()
    assert body["valuation"] == VALUATION and body["affordability"] == AFFORDABILITY and body["policy_gate"] == GATE


def test_the_pack_lists_every_agent_call_the_record_lists_with_what_each_said(world):
    calls = pack().json()["agent_calls"]
    assert [c["id"] for c in calls] == [entry["id"] for entry in FUNDED["record"]["aiCalls"]]
    assert all(c["matches"] and c["agent"] and c["output"] and c["created_at"] for c in calls)
    assert {c["agent"] for c in calls} >= {"affordability", "valuation"}


def test_the_pack_holds_the_mint_and_the_audit_hash_transactions(world):
    body = pack().json()
    assert body["application"]["loan_note"]["tx_hash"] == MINT_TX and body["application"]["loan_note"]["token_id"] == "7"
    assert body["audit_tx_hash"] == AUDIT_TX


def test_the_credit_memo_is_in_the_record(world):
    assert pack().json()["record"]["creditMemo"] == FUNDED["record"]["creditMemo"]


def test_without_a_review_document_the_pack_still_comes_with_those_parts_empty(world):
    del world["db"].store["applications/app-funded/review/underwriting"]
    body = pack().json()
    assert (body["valuation"], body["affordability"], body["policy_gate"]) == (None, None, None)
    assert body["verification"]["verified"] is True


# AC2: the hash of the record equals the hash stored, in the loan note and (when a chain is set up) on the chain


def test_the_hashes_agree_for_an_untouched_record(world):
    v = pack().json()["verification"]
    assert v == {
        "computed_hash": FUNDED["hash"], "stored_hash": FUNDED["hash"], "loan_note_hash": FUNDED["hash"],
        "on_chain_hash": None, "on_chain_checked": False, "calls_match": True, "verified": True,
    }


def test_when_the_registry_holds_the_same_hash_the_pack_says_so(world, monkeypatch):
    monkeypatch.setattr(audit_pack, "_registry", lambda: FakeRegistry((FUNDED["hash"], 1793368451)))
    v = pack().json()["verification"]
    assert v["on_chain_checked"] is True and v["on_chain_hash"] == FUNDED["hash"] and v["verified"] is True


def test_a_registry_with_another_hash_is_not_verified(world, monkeypatch):
    monkeypatch.setattr(audit_pack, "_registry", lambda: FakeRegistry(("ff" * 32, 1793368451)))
    v = pack().json()["verification"]
    assert v["on_chain_checked"] is True and v["verified"] is False


def test_a_registry_that_holds_nothing_is_not_verified(world, monkeypatch):
    monkeypatch.setattr(audit_pack, "_registry", lambda: FakeRegistry(None))
    v = pack().json()["verification"]
    assert v["on_chain_checked"] is True and v["on_chain_hash"] is None and v["verified"] is False


def test_a_chain_that_cannot_be_reached_leaves_the_pack_available_but_unchecked_there(world, monkeypatch):
    monkeypatch.setattr(audit_pack, "_registry", lambda: FakeRegistry(error=ChainError("the chain could not be read")))
    r = pack()
    assert r.status_code == 200
    assert r.json()["verification"]["on_chain_checked"] is False and r.json()["verification"]["on_chain_hash"] is None


def test_a_record_changed_after_it_was_hashed_is_not_verified(world):
    stored(world, "applications/app-funded/audit/record")["creditMemo"] = "A different memo"
    v = pack().json()["verification"]
    assert v["computed_hash"] != v["stored_hash"] and v["verified"] is False


def test_a_loan_note_with_another_hash_is_not_verified(world):
    stored(world, "applications/app-funded")["loanNote"]["auditHash"] = "00" * 32
    assert pack().json()["verification"]["verified"] is False


def test_a_call_changed_after_it_was_hashed_is_flagged_and_the_pack_is_not_verified(world):
    first = FUNDED["record"]["aiCalls"][0]["id"]
    stored(world, f"ai_calls/{first}")["output"] = "Changed afterwards"
    body = pack().json()
    assert [c["matches"] for c in body["agent_calls"]].count(False) == 1
    assert body["verification"]["calls_match"] is False and body["verification"]["verified"] is False


def test_a_call_that_is_gone_is_flagged(world):
    gone = FUNDED["record"]["aiCalls"][0]["id"]
    del world["db"].store[f"ai_calls/{gone}"]
    call = next(c for c in pack().json()["agent_calls"] if c["id"] == gone)
    assert call["matches"] is False and call["agent"] is None and call["sha256"] == FUNDED["record"]["aiCalls"][0]["sha256"]


# AC3: only underwriters and the application's own broker


def test_the_assigned_broker_can_fetch_it(world):
    sign_in(world, "broker1", "broker")
    assert pack().status_code == 200


def test_another_brokers_application_is_404_like_a_missing_one(world):
    sign_in(world, "broker2", "broker")
    r = pack()
    assert r.status_code == 404
    assert r.json()["error"]["message"] == pack("nope").json()["error"]["message"]


@pytest.mark.parametrize("uid", ["borrower1", "borrower2"])
def test_a_borrower_gets_403_even_for_their_own_application(world, uid):
    sign_in(world, uid, "borrower")
    assert pack().status_code == 403


def test_the_pack_needs_a_token():
    assert client.get("/core/applications/app-funded/audit-pack").status_code == 401


def test_an_unknown_application_is_404(world):
    assert pack("nope").status_code == 404


# Available once the loan note is minted


@pytest.mark.parametrize("status", ["Applied", "AI Deliberated", "Underwriter Approved", "Declined"])
def test_before_the_loan_note_there_is_no_pack_and_it_says_why(world, status):
    store = world["db"].store
    store["applications/app-funded"].pop("loanNote")
    store["applications/app-funded"]["status"] = status
    del store["applications/app-funded/audit/record"]
    r = pack()
    assert r.status_code == 409 and status in r.json()["error"]["message"]


def test_a_note_without_its_record_is_409_not_a_pack_with_holes(world):
    del world["db"].store["applications/app-funded/audit/record"]
    assert pack().status_code == 409


def test_reading_the_pack_changes_nothing(world):
    before = copy.deepcopy(world["db"].store)
    pack()
    assert world["db"].store == before
