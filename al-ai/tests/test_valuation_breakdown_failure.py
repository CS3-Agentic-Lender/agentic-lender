"""If only the breakdown fails the borrower still gets the estimate. The two breakdown fields are then null together."""

import json
import logging
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import auth, valuation_explain, valuation_model
from app.main import app
from app.valuation_endpoint import Contribution, ValuationResponse

client = TestClient(app)
AUTH = {"Authorization": "Bearer ok"}
WARNING = "The breakdown of this estimate isn't available right now."  # the wording Ibrahima asked for: iOS shows it as it comes
REPO = Path(__file__).resolve().parents[2]


@pytest.fixture(autouse=True)
def signed_in(monkeypatch):
    monkeypatch.setattr(auth.fb_auth, "verify_id_token", lambda token, check_revoked: {"uid": "u1", "role": "borrower"})


def body(**changes):
    base = {"county": "Dublin", "floor_area_m2": 118, "bedrooms": 3, "property_type": "Semi-D", "ber": "C1", "eircode": "D24 AB12"}
    return {**base, **changes}


def post(payload):
    return client.post("/ai/valuation", json=payload, headers=AUTH)


def break_the_breakdown(monkeypatch, error=None):
    def broken(*args, **kwargs):
        raise error or valuation_model.ValuationUnavailable("the valuation could not be explained: RuntimeError")

    monkeypatch.setattr(valuation_explain, "explain_value", broken)


# ---- the estimate survives -------------------------------------------------------------------

@pytest.mark.parametrize("error", [None, RuntimeError("something odd inside the breakdown"), ValueError("bad value")])
def test_when_only_the_breakdown_fails_the_call_still_returns_the_estimate(monkeypatch, error):
    normal = post(body()).json()
    break_the_breakdown(monkeypatch, error)
    r = post(body())
    assert r.status_code == 200
    j = r.json()
    assert j["estimate_eur"] == normal["estimate_eur"] and j["display_estimate_eur"] == normal["display_estimate_eur"]
    assert j["basis"] == "2024 asking-price estimate" and j["model_version"] == normal["model_version"]


def test_the_two_breakdown_fields_are_present_but_null_together(monkeypatch):
    break_the_breakdown(monkeypatch)
    j = post(body()).json()
    assert "baseline_eur" in j and "contributions" in j  # null, not missing
    assert j["baseline_eur"] is None and j["contributions"] is None


def test_the_response_has_a_plain_english_warning_when_the_breakdown_is_missing(monkeypatch):
    break_the_breakdown(monkeypatch)
    assert WARNING in post(body()).json()["support_warnings"]


def test_the_breakdown_warning_comes_after_the_other_warnings_and_only_when_it_is_missing(monkeypatch):
    working = post(body(ber="A0")).json()["support_warnings"]
    assert WARNING not in working
    break_the_breakdown(monkeypatch)
    broken = post(body(ber="A0")).json()["support_warnings"]
    assert broken == [*working, WARNING]


def test_the_gap_and_review_flag_still_work_without_the_breakdown(monkeypatch):
    estimate = post(body()).json()["estimate_eur"]
    break_the_breakdown(monkeypatch)
    j = post(body(asking_price_eur=estimate * 1.5)).json()
    assert j["asking_price_gap"] == pytest.approx(0.5, abs=1e-5) and j["price_needs_review"] is True


# ---- the estimate itself failing is still a 503 -------------------------------------------------

def test_when_the_estimate_fails_the_call_is_still_a_503_and_no_breakdown_is_attempted(monkeypatch):
    tried = []
    monkeypatch.setattr(valuation_model, "estimate_value", lambda *a, **k: (_ for _ in ()).throw(valuation_model.ValuationUnavailable("no model")))
    monkeypatch.setattr(valuation_explain, "explain_value", lambda *a, **k: tried.append(1))
    assert post(body()).status_code == 503
    assert tried == []


# ---- never just one --------------------------------------------------------------------------------

def test_a_response_with_only_one_of_the_two_fields_cannot_be_built():
    base = dict(estimate_eur=1.0, display_estimate_eur=0, basis="2024 asking-price estimate", support_warnings=[], model_version="v2",
                schema_version="1", asking_price_gap=None, price_needs_review=None)
    piece = Contribution(feature="county", value="Dublin", eur=1.0)
    with pytest.raises(ValueError, match="together"):
        ValuationResponse(**base, baseline_eur=None, contributions=[piece])
    with pytest.raises(ValueError, match="together"):
        ValuationResponse(**base, baseline_eur=1.0, contributions=None)
    ValuationResponse(**base, baseline_eur=None, contributions=None)  # both null is fine
    ValuationResponse(**base, baseline_eur=1.0, contributions=[piece])  # both present is fine


@pytest.mark.parametrize("break_it", [False, True])
def test_whatever_happens_the_two_fields_are_never_null_apart(monkeypatch, break_it):
    if break_it:
        break_the_breakdown(monkeypatch)
    j = post(body()).json()
    assert (j["baseline_eur"] is None) == (j["contributions"] is None)


# ---- the log says why --------------------------------------------------------------------------------

def test_the_call_is_logged_as_ok_with_the_reason_the_breakdown_failed(monkeypatch, caplog):
    break_the_breakdown(monkeypatch, RuntimeError("model blew up"))
    with caplog.at_level(logging.INFO, logger="al-ai.valuation"):
        r = post(body(run_id="run-7"))
    entry = json.loads(caplog.records[-1].getMessage())
    assert entry["outcome"] == "ok" and entry["run_id"] == "run-7" and entry["estimate_eur"] == r.json()["estimate_eur"]
    assert "RuntimeError" in entry["breakdown_error"] and "model blew up" in entry["breakdown_error"]
    assert "AB12" not in caplog.text  # the full Eircode is still never logged


def test_a_working_call_has_no_breakdown_error_in_its_log(caplog):
    with caplog.at_level(logging.INFO, logger="al-ai.valuation"):
        post(body())
    assert "breakdown_error" not in json.loads(caplog.records[-1].getMessage())


# ---- the docs ----------------------------------------------------------------------------------------

def test_the_endpoint_docs_at_slash_docs_show_both_fields_as_nullable():
    props = client.get("/ai/openapi.json").json()["components"]["schemas"]["ValuationResponse"]["properties"]
    for name in ("baseline_eur", "contributions"):
        assert any(option.get("type") == "null" for option in props[name]["anyOf"]), name
        assert "null" in props[name]["description"].lower() and "together" in props[name]["description"].lower()


def test_the_api_design_doc_and_the_model_card_say_the_fields_can_be_null_together():
    doc = (REPO / "docs" / "api-design.md").read_text()
    card = (REPO / "al-ai" / "models" / "valuation" / "MODEL_CARD.md").read_text()
    for text in (doc, card):
        assert "both null" in text and WARNING in text
