"""The committed valuation model package (models/valuation/): the file is the one that was evaluated, it reloads to the same
predictions, and the folder holds only safe artifacts."""

import hashlib
import json
from pathlib import Path

import pytest

PKG = Path(__file__).resolve().parent.parent / "models" / "valuation"
MANIFEST = json.loads((PKG / "manifest.json").read_text())


def test_the_model_file_matches_the_sha256_in_the_manifest():
    assert hashlib.sha256((PKG / MANIFEST["model_file"]).read_bytes()).hexdigest() == MANIFEST["sha256"]


def test_the_model_file_is_the_one_the_final_test_scored():
    results = json.loads((PKG.parent.parent / "ml" / "reports" / "v2-final-test-results.json").read_text())
    assert results["saved_model"]["sha256"] == MANIFEST["sha256"]


def test_a_reload_reproduces_the_saved_reference_predictions():
    np = pytest.importorskip("numpy")
    pd = pytest.importorskip("pandas")
    pytest.importorskip("sklearn")
    pytest.importorskip("catboost")
    joblib = pytest.importorskip("joblib")
    ref = json.loads((PKG / "reference-predictions.json").read_text())
    model = joblib.load(PKG / MANIFEST["model_file"])  # the committed file, after its SHA-256 was checked above
    X = pd.DataFrame(ref["inputs"])[MANIFEST["input_columns"]]
    got = model.predict(X)
    assert np.max(np.abs(got - np.array(ref["predictions_eur"])) / np.array(ref["predictions_eur"])) <= ref["relative_tolerance"]
    assert len(got) == MANIFEST["reference_predictions"]["rows"] and np.isfinite(got).all()


def test_the_package_holds_inputs_only_with_no_prices_or_listing_text():
    import csv
    with (PKG / "background-sample.csv").open(newline="") as f:
        rows = list(csv.DictReader(f))
    assert len(rows) == MANIFEST["background_sample"]["rows"] == 100
    assert list(rows[0]) == MANIFEST["input_columns"]  # county, property_type, bedrooms, floor_area_m2, ber, rkey: nothing else
    assert all(float(r["floor_area_m2"]) % 5 == 0 for r in rows)
    ref = json.loads((PKG / "reference-predictions.json").read_text())
    assert set(ref["inputs"][0]) == set(MANIFEST["input_columns"])


def test_the_model_card_states_the_checksum_threshold_and_limits():
    card = (PKG / "MODEL_CARD.md").read_text()
    assert MANIFEST["sha256"] in card and f"{100 * MANIFEST['threshold']:.1f}%" in card
    for section in ("## Inputs", "## Data", "## Metrics", "## Background sample", "## Limits"):
        assert section in card
