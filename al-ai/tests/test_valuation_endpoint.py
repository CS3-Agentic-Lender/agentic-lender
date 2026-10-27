"""POST /ai/valuation: the saved model behind an endpoint. Checks follow the acceptance criteria of the ticket."""

import json
import logging

import pytest
from fastapi.testclient import TestClient

from app import auth, valuation_model
from app.main import app

client = TestClient(app)
AUTH = {"Authorization": "Bearer ok"}
KEYS = {
    "estimate_eur", "display_estimate_eur", "basis", "support_warnings", "model_version", "schema_version",
    "asking_price_gap", "price_needs_review",
}


@pytest.fixture(autouse=True)
def signed_in(monkeypatch):
    monkeypatch.setattr(auth.fb_auth, "verify_id_token", lambda token, check_revoked: {"uid": "u1", "role": "borrower"})


def body(**changes):
    base = {"county": "Dublin", "floor_area_m2": 100, "bedrooms": 3, "property_type": "Terrace", "ber": "C1", "eircode": "D14 AB12"}
    return {**base, **changes}


def post(payload, headers=AUTH):
    return client.post("/ai/valuation", json=payload, headers=headers)


# ---- 1. the answer ----------------------------------------------------------------------------

def test_a_valid_request_returns_the_estimate_and_its_labels():
    r = post(body())
    assert r.status_code == 200
    j = r.json()
    assert set(j) == KEYS
    assert j["estimate_eur"] == pytest.approx(valuation_model.estimate_value("Dublin", "Terrace", 3, 100, "C1", "D14"))
    assert j["display_estimate_eur"] == round(j["estimate_eur"] / 1000) * 1000
    assert j["basis"] == "2024 asking-price estimate"
    assert j["model_version"] == "v2" and j["schema_version"] == "1"
    assert j["support_warnings"] == []
    assert j["asking_price_gap"] is None and j["price_needs_review"] is None


def test_it_needs_a_signed_in_user():
    assert post(body(), headers={}).status_code == 401


# ---- 2 and 3. the Eircode ---------------------------------------------------------------------

def test_the_routing_key_is_worked_out_from_the_eircode():
    assert post(body(eircode="D14 AB12")).json()["estimate_eur"] != post(body(eircode="V92 AB12")).json()["estimate_eur"]


@pytest.mark.parametrize("eircode", ["", "d14 ab12", "D14AB12", "12345", "D14 AB1"])
def test_an_empty_or_invalid_eircode_is_a_422_naming_the_field(eircode):
    r = post(body(eircode=eircode))
    assert r.status_code == 422 and r.json()["error"]["field"] == "eircode"


def test_a_missing_eircode_is_a_422_naming_the_field():
    payload = body()
    del payload["eircode"]
    r = post(payload)
    assert r.status_code == 422 and r.json()["error"]["field"] == "eircode"


def test_a_valid_eircode_whose_key_the_model_has_not_seen_is_valued_with_a_warning():
    assert "Z99" not in valuation_model.routing_keys()
    r = post(body(eircode="Z99 AB12"))
    assert r.status_code == 200
    assert any("Eircode" in w for w in r.json()["support_warnings"])


def test_a_key_the_model_knows_has_no_warning():
    key = sorted(valuation_model.routing_keys())[0]
    assert post(body(eircode=f"{key} AB12")).json()["support_warnings"] == []


# ---- 4. the asking price ----------------------------------------------------------------------

def test_an_asking_price_adds_the_signed_gap():
    estimate = post(body()).json()["estimate_eur"]
    j = post(body(asking_price_eur=estimate * 1.1)).json()
    assert j["asking_price_gap"] == pytest.approx(0.1, abs=1e-5)
    assert j["price_needs_review"] is False
    assert post(body(asking_price_eur=estimate * 0.8)).json()["asking_price_gap"] == pytest.approx(-0.2, abs=1e-5)


def test_the_review_flag_fires_only_strictly_above_the_calibrated_threshold():
    estimate = post(body()).json()["estimate_eur"]
    t = valuation_model.review_threshold()
    assert post(body(asking_price_eur=estimate * (1 + t + 0.01))).json()["price_needs_review"] is True
    assert post(body(asking_price_eur=estimate * (1 + t - 0.01))).json()["price_needs_review"] is False


@pytest.mark.parametrize("price", [0, -5, 1e12])
def test_a_bad_asking_price_is_a_422_naming_the_field(price):
    r = post(body(asking_price_eur=price))
    assert r.status_code == 422 and r.json()["error"]["field"] == "asking_price_eur"


# ---- 5. refused inputs ------------------------------------------------------------------------

@pytest.mark.parametrize("field,value", [
    ("county", "Antrim"), ("property_type", "Castle"), ("floor_area_m2", 0), ("floor_area_m2", -3),
    ("bedrooms", -1), ("bedrooms", 31), ("ber", "H9"),
])
def test_unsupported_or_invalid_values_are_a_422_naming_the_field(field, value):
    r = post(body(**{field: value}))
    assert r.status_code == 422 and r.json()["error"]["field"] == field


def test_a_stray_field_is_refused():
    assert post(body(role="underwriter")).status_code == 422


# ---- 6. BER and unusual sizes -----------------------------------------------------------------

def test_ber_a0_returns_an_estimate_with_a_warning():
    r = post(body(ber="A0"))
    assert r.status_code == 200
    assert any("A0" in w for w in r.json()["support_warnings"])


@pytest.mark.parametrize("ber", ["B3", "B", "Unknown"])
def test_old_new_and_unknown_ber_are_accepted(ber):
    assert post(body(ber=ber)).status_code == 200


@pytest.mark.parametrize("area", [5, 3000])
def test_a_size_outside_the_trained_range_is_a_warning_not_an_error(area):
    r = post(body(floor_area_m2=area))
    assert r.status_code == 200 and any("floor area" in w for w in r.json()["support_warnings"])


# ---- 7. the saved model -----------------------------------------------------------------------

def test_the_endpoint_reproduces_the_saved_reference_predictions():
    ref = json.loads((valuation_model.MODEL_DIR / "reference-predictions.json").read_text())
    checked = 0
    for home, expected in zip(ref["inputs"], ref["predictions_eur"]):
        if home["rkey"] is None:
            continue  # the endpoint always has an Eircode; the loader tests cover the no-key case
        r = post(body(county=home["county"], property_type=home["property_type"], bedrooms=home["bedrooms"],
                      floor_area_m2=home["floor_area_m2"], ber=home["ber"], eircode=f"{home['rkey']} AB12"))
        assert r.status_code == 200
        assert r.json()["estimate_eur"] == pytest.approx(expected, rel=ref["relative_tolerance"])
        checked += 1
    assert checked > 10


def test_a_model_that_cannot_load_is_a_503_never_a_guess(monkeypatch):
    def broken(*args, **kwargs):
        raise valuation_model.ValuationUnavailable("no model")
    monkeypatch.setattr(valuation_model, "estimate_value", broken)
    assert post(body()).status_code == 503


# ---- 8. the call log --------------------------------------------------------------------------

def test_each_call_is_logged_with_its_run_id(caplog):
    with caplog.at_level(logging.INFO, logger="al-ai.valuation"):
        r = post(body(run_id="run-42"))
    entry = json.loads(caplog.records[-1].getMessage())
    assert entry["call"] == "valuation_model" and entry["run_id"] == "run-42" and entry["outcome"] == "ok"
    assert entry["request_id"] == r.headers["X-Request-ID"]
    assert entry["estimate_eur"] == r.json()["estimate_eur"]


def test_the_log_keeps_the_routing_key_but_never_the_full_eircode(caplog):
    with caplog.at_level(logging.INFO, logger="al-ai.valuation"):
        post(body(eircode="D14 AB12"))
    line = caplog.records[-1].getMessage()
    assert json.loads(line)["inputs"]["routing_key"] == "D14"
    assert "AB12" not in line


def test_a_call_with_no_run_id_logs_none(caplog):
    with caplog.at_level(logging.INFO, logger="al-ai.valuation"):
        post(body())
    assert json.loads(caplog.records[-1].getMessage())["run_id"] is None
