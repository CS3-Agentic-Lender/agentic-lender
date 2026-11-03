"""The valuation result saved on the review document (AL-61). The real Firestore behaviour (the field mask that replaces the map
on a re-run) is shown against the emulator and recorded in the PR; these tests pin what is sent and when nothing is sent."""

import pytest
from fastapi.testclient import TestClient

from app import auth, valuation_explain, valuation_review
from app.main import app
from app.valuation_endpoint import ValuationResponse

client = TestClient(app)

MORTGAGE = dict(county="Dublin", property_type="Semi-D", bedrooms=3, floor_area_m2=118, ber="C1", eircode="D24 AB12", asking_price_eur=450_000)
HELOC = dict(
    county="Dublin", property_type="Semi-D", bedrooms=3, floor_area_m2=118, ber="C1", eircode="D24 AB12",
    loan_type="heloc", existing_mortgage_balance_eur=150_000, loan_amount_eur=40_000,
)


@pytest.fixture(autouse=True)
def signed_in(monkeypatch):
    monkeypatch.setattr(auth.fb_auth, "verify_id_token", lambda token, check_revoked: {"uid": "u1", "role": "borrower"})


def result(**request):
    """A real response from the endpoint, so the figures are the model's and not made up."""
    got = client.post("/ai/valuation", json=request, headers={"Authorization": "Bearer ok"})
    assert got.status_code == 200, got.text
    return ValuationResponse(**got.json())


class FakeDoc:
    def __init__(self, path, db):
        self.path, self.db = path, db

    def get(self):
        data = self.db.documents.get(self.path)
        return type("Snapshot", (), {"exists": data is not None, "to_dict": lambda self: data})()

    def collection(self, name):
        return FakeCollection(f"{self.path}/{name}", self.db)

    def set(self, data, merge=False):
        self.db.writes.append((self.path, data, merge))


class FakeCollection:
    def __init__(self, path, db):
        self.path, self.db = path, db

    def document(self, doc_id):
        return FakeDoc(f"{self.path}/{doc_id}", self.db)


class FakeDb:
    def __init__(self, documents=None):
        self.documents = {"applications/app-1": {"brokerId": "broker-1"}} if documents is None else documents
        self.writes = []

    def collection(self, name):
        return FakeCollection(name, self)


REVIEW = "applications/app-1/review/underwriting"


def test_a_mortgage_result_is_saved_on_the_review_document_with_the_agreed_names():
    db, response = FakeDb(), result(**MORTGAGE)
    detail = valuation_review.write_valuation(db, "app-1", response)

    [(path, data, merge)] = db.writes
    assert path == REVIEW and data["valuationDetail"] == detail
    assert data["applicationId"] == "app-1" and data["brokerId"] == "broker-1" and "updatedAt" in data
    assert detail["estimatedValueEur"] == response.estimate_eur and detail["displayEstimateEur"] == response.display_estimate_eur
    assert detail["askingPriceGap"] == response.asking_price_gap and detail["askingPriceGap"] is not None
    assert detail["priceNeedsReview"] is response.price_needs_review and detail["modelVersion"] == response.model_version
    assert detail["supportWarnings"] == response.support_warnings


def test_the_breakdown_is_saved_as_the_api_list_of_six_inputs_with_their_values():
    detail = valuation_review.write_valuation(FakeDb(), "app-1", result(**MORTGAGE))
    assert [piece["feature"] for piece in detail["contributions"]].count("eircode_area") == 1 and len(detail["contributions"]) == 6
    assert all(set(piece) == {"feature", "value", "eur"} for piece in detail["contributions"])
    assert detail["baselineEur"] + sum(piece["eur"] for piece in detail["contributions"]) == pytest.approx(detail["estimatedValueEur"], abs=0.1)


def test_the_mask_names_the_whole_valuation_map_and_none_of_the_other_review_fields():
    # This pins what is sent. That Firestore then replaces the map whole on a re-run is shown by docs/valuation-review-check/.
    db = FakeDb()
    valuation_review.write_valuation(db, "app-1", result(**MORTGAGE))
    [(_, _, merge)] = db.writes
    assert "valuationDetail" in merge  # named whole, so the old map is replaced and no stale key survives
    assert set(merge) == {"applicationId", "brokerId", "updatedAt", "valuationDetail"}  # riskTier, policyGate and dtiBreakdown are not in it


def test_a_heloc_has_no_asking_price_so_the_gap_and_the_flag_are_empty_but_present():
    detail = valuation_review.write_valuation(FakeDb(), "app-1", result(**HELOC))
    assert "askingPriceGap" in detail and detail["askingPriceGap"] is None
    assert "priceNeedsReview" in detail and detail["priceNeedsReview"] is None
    assert detail["estimatedValueEur"] > 0


def test_when_only_the_breakdown_failed_the_estimate_is_saved_and_the_breakdown_is_null_together(monkeypatch):
    def broken(*args, **kwargs):
        raise RuntimeError("explain failed")

    monkeypatch.setattr(valuation_explain, "explain_value", broken)
    detail = valuation_review.write_valuation(FakeDb(), "app-1", result(**MORTGAGE))
    assert detail["baselineEur"] is None and detail["contributions"] is None  # written as null, so an old breakdown is cleared
    assert detail["estimatedValueEur"] > 0 and any("breakdown" in warning for warning in detail["supportWarnings"])


def test_the_asking_price_is_only_read_never_written():
    db = FakeDb({"applications/app-1": {"brokerId": "broker-1", "property": {"askingPriceEur": 450_000}}})
    valuation_review.write_valuation(db, "app-1", result(**MORTGAGE))
    assert [path for path, _, _ in db.writes] == [REVIEW]  # nothing is written to the application itself


@pytest.mark.parametrize("documents", [{}, {"applications/app-1": {}}, {"applications/app-1": {"brokerId": ""}}])
def test_a_missing_application_or_broker_writes_nothing(documents):
    db = FakeDb(documents)
    with pytest.raises(ValueError, match="app-1"):
        valuation_review.write_valuation(db, "app-1", result(**MORTGAGE))
    assert db.writes == []


def test_the_model_version_saved_is_the_one_that_produced_the_result():
    newer = result(**MORTGAGE).model_copy(update={"model_version": "v3"})
    assert valuation_review.write_valuation(FakeDb(), "app-1", newer)["modelVersion"] == "v3"
