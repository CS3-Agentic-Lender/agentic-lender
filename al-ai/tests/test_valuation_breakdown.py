"""The breakdown in the /ai/valuation response: baseline plus one euro piece per input, adding up to the estimate."""

import json
import re
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import auth, valuation_model
from app.main import app

client = TestClient(app)
AUTH = {"Authorization": "Bearer ok"}
FEATURES = {"county", "property_type", "bedrooms", "floor_area", "ber", "eircode_area"}
API_DOC = Path(__file__).resolve().parents[2] / "docs" / "api-design.md"


@pytest.fixture(autouse=True)
def signed_in(monkeypatch):
    monkeypatch.setattr(auth.fb_auth, "verify_id_token", lambda token, check_revoked: {"uid": "u1", "role": "borrower"})


def body(**changes):
    base = {"county": "Dublin", "floor_area_m2": 118, "bedrooms": 3, "property_type": "Semi-D", "ber": "C1", "eircode": "D24 AB12"}
    return {**base, **changes}


def post(payload):
    return client.post("/ai/valuation", json=payload, headers=AUTH)


def adds_up(j):
    return j["baseline_eur"] + sum(c["eur"] for c in j["contributions"])


# ---- the format ---------------------------------------------------------------------------

def test_the_response_has_a_baseline_and_one_piece_for_each_of_the_six_inputs():
    j = post(body()).json()
    assert isinstance(j["baseline_eur"], float)
    assert {c["feature"] for c in j["contributions"]} == FEATURES and len(j["contributions"]) == 6
    assert all(set(c) == {"feature", "value", "eur"} for c in j["contributions"])


def test_the_pieces_are_sorted_by_size_biggest_first():
    sizes = [abs(c["eur"]) for c in post(body()).json()["contributions"]]
    assert sizes == sorted(sizes, reverse=True)


def test_each_piece_shows_the_input_it_explains():
    values = {c["feature"]: c["value"] for c in post(body(ber="C1")).json()["contributions"]}
    assert values == {"county": "Dublin", "property_type": "Semi-D", "bedrooms": 3, "floor_area": 118, "ber": "C1", "eircode_area": "D24"}


def test_the_full_eircode_never_appears_in_the_breakdown():
    assert "AB12" not in post(body()).text


# ---- it adds up ------------------------------------------------------------------------------

@pytest.mark.parametrize("changes", [
    {}, {"county": "Cork", "eircode": "T12 AB12"}, {"ber": "A0"}, {"ber": "Unknown"}, {"floor_area_m2": 5}, {"eircode": "Z99 AB12"},
    {"property_type": "Apartment", "bedrooms": 1, "floor_area_m2": 45},
])
def test_baseline_plus_the_pieces_equals_the_estimate_within_one_euro(changes):
    j = post(body(**changes)).json()
    assert adds_up(j) == pytest.approx(j["estimate_eur"], abs=1)


def test_an_eircode_area_the_model_has_not_seen_still_gets_a_piece():
    pieces = {c["feature"]: c for c in post(body(eircode="Z99 AB12")).json()["contributions"]}
    assert pieces["eircode_area"]["value"] == "Z99"


def test_the_baseline_is_the_same_for_every_home():
    assert post(body()).json()["baseline_eur"] == post(body(county="Cork", eircode="T12 AB12")).json()["baseline_eur"]


# ---- the saved reference breakdown ----------------------------------------------------------------

def test_the_response_matches_the_breakdown_saved_with_the_model():
    saved = json.loads((valuation_model.MODEL_DIR / "reference-breakdown.json").read_text())
    assert len(saved["homes"]) >= 3
    for home in saved["homes"]:
        j = post(home["request"]).json()
        assert j["estimate_eur"] == pytest.approx(home["estimate_eur"], rel=1e-6, abs=saved["absolute_tolerance_eur"])
        assert j["baseline_eur"] == pytest.approx(home["baseline_eur"], rel=1e-6, abs=saved["absolute_tolerance_eur"])
        got = {c["feature"]: c["eur"] for c in j["contributions"]}
        want = {c["feature"]: c["eur"] for c in home["contributions"]}
        assert got == pytest.approx(want, rel=1e-6, abs=saved["absolute_tolerance_eur"])


def test_the_reference_breakdown_is_recorded_in_the_manifest():
    manifest = json.loads((valuation_model.MODEL_DIR / "manifest.json").read_text())
    assert manifest["reference_breakdown"]["file"] == "reference-breakdown.json"


# ---- the docs ---------------------------------------------------------------------------------

def test_the_breakdown_format_is_in_the_endpoint_docs_at_slash_docs():
    schema = client.get("/ai/openapi.json").json()["components"]["schemas"]
    assert {"baseline_eur", "contributions"} <= set(schema["ValuationResponse"]["properties"])
    assert {"feature", "value", "eur"} <= set(schema["Contribution"]["properties"])
    assert schema["Contribution"]["properties"]["eur"]["description"]


def example_in_the_api_design_doc() -> dict:
    text = API_DOC.read_text()
    after = text.split("`POST /ai/valuation`", 1)[1]
    return json.loads(re.search(r"```json\n(.*?)\n```", after, re.S).group(1))


def test_the_api_design_example_matches_the_real_response_format():
    example = example_in_the_api_design_doc()
    real = post(body()).json()
    assert set(example) == set(real)
    assert example["model_version"] == real["model_version"] == "v2"
    assert example["schema_version"] == real["schema_version"]
    assert {c["feature"] for c in example["contributions"]} == FEATURES
    assert all(set(c) == {"feature", "value", "eur"} for c in example["contributions"])


def test_the_api_design_example_adds_up_and_is_sorted():
    example = example_in_the_api_design_doc()
    assert adds_up(example) == pytest.approx(example["estimate_eur"], abs=1)
    sizes = [abs(c["eur"]) for c in example["contributions"]]
    assert sizes == sorted(sizes, reverse=True)
