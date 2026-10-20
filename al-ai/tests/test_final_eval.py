import json

import pytest

np = pytest.importorskip("numpy")
pd = pytest.importorskip("pandas")
pytest.importorskip("sklearn")
pytest.importorskip("joblib")

from ml import benchmark as b  # noqa: E402
from ml import final_eval as fe  # noqa: E402


# ---- the gap and the threshold -------------------------------------------------------------

def test_signed_gap_is_asking_over_estimate_minus_one():
    assert fe.gaps([110, 100, 90], [100, 100, 100]).tolist() == pytest.approx([0.10, 0.0, -0.10])


def test_threshold_is_the_90th_percentile_of_the_gaps():
    est = np.full(11, 100.0)
    asking = 100 * (1 + np.linspace(0, 0.5, 11))  # gaps 0, 5%, 10%, ... 50%
    assert fe.derive_threshold(asking, est) == pytest.approx(0.45)


def test_threshold_is_never_negative():
    est = np.full(10, 100.0)
    assert fe.derive_threshold(est * 0.7, est) == 0.0  # everything priced below the estimate


def test_equality_does_not_flag_and_a_price_below_the_estimate_never_flags():
    assert fe.gaps([125.0], [100.0]).tolist() == [0.25]  # exact in floating point, so this really is equality
    flags = fe.needs_review([125.0, 125.0000001, 80.0, 100.0], [100.0] * 4, 0.25)
    assert flags.tolist() == [False, True, False, False]


def test_the_unrounded_estimate_is_used():
    # rounded to the nearest 1,000 this estimate would be 300,000 and the gap would be exactly 0.2
    assert fe.needs_review([360_000.0], [299_700.0], 0.2).tolist() == [True]


# ---- the whole flow on synthetic data (never the real test split) ----------------------------

def synth(n, seed):
    rng = np.random.default_rng(seed)
    county = rng.choice(["Cork", "Dublin", "Leitrim"], n)
    rate = pd.Series(county).map({"Cork": 3000, "Dublin": 5000, "Leitrim": 1500}).to_numpy()
    area = rng.uniform(40, 300, n)
    X = pd.DataFrame({"county": county, "property_type": rng.choice(["Detached", "Semi-D"], n), "bedrooms": rng.integers(1, 6, n),
                      "floor_area_m2": area, "ber": rng.choice(["A", "B", "C", "Unknown"], n)})
    return {"X": X, "y": rate * area * rng.uniform(0.8, 1.3, n), "rows": n + 3, "no_area": 3}


def run_main(monkeypatch, tmp_path, test_seed=3):
    parts = {"development": synth(300, 1), "calibration": synth(120, 2), "test": synth(120, test_seed)}
    frozen = {"winner": "ridge", "params": {}, "cv_mape": 12.3}
    monkeypatch.setattr(fe, "load_partitions", lambda seed: parts)
    monkeypatch.setattr(fe, "frozen_model", lambda seed: (frozen, b.make_model("ridge", seed)))
    monkeypatch.setattr("sys.argv", ["final_eval", "--reports", str(tmp_path / "reports"), "--artifacts", str(tmp_path / "art")])
    fe.main()
    return tmp_path


def test_the_flow_writes_the_threshold_the_report_and_the_model(monkeypatch, tmp_path):
    run_main(monkeypatch, tmp_path)
    th = json.loads((tmp_path / "reports" / "threshold.json").read_text())
    assert th["calibration_rows"] == 120 and th["quantile"] == 0.9 and th["quantile_method"] == "linear" and th["threshold"] >= 0
    assert (tmp_path / "reports" / "final-test-report.md").exists() and (tmp_path / "art" / "valuation-pipeline.joblib").exists()
    res = json.loads((tmp_path / "reports" / "final-test-results.json").read_text())
    assert res["test_rows"] == 120 and res["threshold"] == th["threshold"] and 0 <= res["flag_rate"] <= 1


def test_the_test_split_cannot_change_the_threshold(monkeypatch, tmp_path):
    a = run_main(monkeypatch, tmp_path / "a", test_seed=3)
    c = run_main(monkeypatch, tmp_path / "b", test_seed=99)
    ta = json.loads((a / "reports" / "threshold.json").read_text())["threshold"]
    tc = json.loads((c / "reports" / "threshold.json").read_text())["threshold"]
    assert ta == tc


def test_the_final_test_cannot_be_scored_twice(monkeypatch, tmp_path):
    run_main(monkeypatch, tmp_path)
    with pytest.raises(SystemExit, match="already scored"):
        run_main(monkeypatch, tmp_path)


def test_only_single_frozen_models_are_supported(monkeypatch, tmp_path):
    reports = tmp_path / "reports"
    reports.mkdir()
    (reports / "frozen-model.json").write_text(json.dumps({"winner": "ensemble_mean", "params": None}))
    monkeypatch.setattr(fe, "HERE", tmp_path)
    with pytest.raises(NotImplementedError):
        fe.frozen_model(42)
