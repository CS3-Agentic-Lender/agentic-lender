import json

import pytest

np = pytest.importorskip("numpy")
pd = pytest.importorskip("pandas")
pytest.importorskip("sklearn")
pytest.importorskip("joblib")
pytest.importorskip("scipy")

from ml import benchmark as b  # noqa: E402
from ml import v2_final as vf  # noqa: E402
from ml import v2_model as v2  # noqa: E402


# ---- the price range ------------------------------------------------------------------------

def test_range_uses_the_10th_and_90th_percentile_of_the_gap_in_each_estimate_band():
    est = np.repeat([100.0, 200.0, 300.0, 400.0], 11)          # four bands of eleven
    asking = est * (1 + np.tile(np.linspace(-0.5, 0.5, 11), 4))  # gaps -0.5 ... +0.5 in every band
    rng = vf.derive_range(asking, est)
    assert [round(x["low_gap"], 6) for x in rng["bands"]] == [-0.4] * 4
    assert [round(x["high_gap"], 6) for x in rng["bands"]] == [0.4] * 4
    assert [x["rows"] for x in rng["bands"]] == [11] * 4


def test_range_scales_the_estimate_and_picks_the_band_of_that_estimate():
    rng = {"edges": [100.0, 200.0, 300.0], "bands": [{"low_gap": -0.1, "high_gap": 0.2}, {"low_gap": -0.2, "high_gap": 0.3},
                                                    {"low_gap": -0.3, "high_gap": 0.4}, {"low_gap": -0.4, "high_gap": 0.5}]}
    low, high = vf.apply_range([50.0, 150.0, 1000.0], rng)
    assert low.tolist() == pytest.approx([45.0, 120.0, 600.0])
    assert high.tolist() == pytest.approx([60.0, 195.0, 1500.0])


def test_coverage_is_the_share_of_asking_prices_inside_the_range_and_edges_count():
    rng = {"edges": [1000.0, 2000.0, 3000.0], "bands": [{"low_gap": -0.1, "high_gap": 0.1}] * 4}
    est = np.full(4, 100.0)
    asking = np.array([90.0, 110.0, 111.0, 80.0])  # exactly on both edges is inside
    c = vf.coverage(asking, est, rng)
    assert c["overall"] == pytest.approx(0.5)
    assert c["median_width_share"] == pytest.approx(0.2)


def test_the_range_covers_about_80_percent_on_fresh_data_from_the_same_noise():
    r = np.random.default_rng(0)
    est_fit, est_new = r.uniform(100, 1000, 20000), r.uniform(100, 1000, 20000)
    noisy = lambda e: e * np.exp(r.normal(0, 0.3, len(e)))
    rng = vf.derive_range(noisy(est_fit), est_fit)
    assert vf.coverage(noisy(est_new), est_new, rng)["overall"] == pytest.approx(0.80, abs=0.02)


# ---- metrics ---------------------------------------------------------------------------------

def test_overall_adds_rmse_and_the_median_over_or_under_estimate():
    s = vf.overall([100.0, 200.0], [110.0, 180.0])
    assert s["rmse"] == pytest.approx(np.sqrt((100 + 400) / 2))
    assert s["median_signed_error"] == pytest.approx(np.median([0.10, -0.10]))
    assert s["mape"] == pytest.approx(10.0)


def test_roc_is_perfect_when_the_estimate_ranks_prices_exactly_and_half_when_it_is_noise():
    r = np.random.default_rng(1)
    dev = np.linspace(100, 1000, 1000)
    y = r.uniform(100, 1000, 2000)
    perfect = vf.roc_view(dev, y, y)
    assert all(v["auc"] == pytest.approx(1.0) for v in perfect.values())
    noise = vf.roc_view(dev, y, r.uniform(0, 1, len(y)))
    assert all(v["auc"] == pytest.approx(0.5, abs=0.05) for v in noise.values())
    assert perfect["p75"]["cutoff_eur"] == pytest.approx(np.percentile(dev, 75))  # cutoff comes from development prices
    assert len(perfect["p50"]["fpr"]) == len(perfect["p50"]["tpr"]) == 101


def test_band_confusion_counts_each_house_once_with_real_band_on_the_rows():
    y = np.array([50.0, 150.0, 250.0, 350.0, 350.0])
    p = np.array([60.0, 250.0, 250.0, 150.0, 350.0])
    m = np.array(vf.band_confusion(y, p, [100.0, 200.0, 300.0]))
    assert m.sum() == 5
    assert m[0, 0] == 1 and m[1, 2] == 1 and m[2, 2] == 1 and m[3, 1] == 1 and m[3, 3] == 1


# ---- the model object and the saved file -----------------------------------------------------------

def test_the_ensemble_is_the_geometric_mean_of_its_members():
    class Fixed:
        def __init__(self, v):
            self.v = v

        def fit(self, X, y):
            return self

        def predict(self, X):
            return np.full(len(X), self.v)

    m = v2.LogMeanEnsemble({"a": Fixed(100.0), "b": Fixed(400.0)}).fit(None, None)
    assert m.predict(range(3)).tolist() == pytest.approx([200.0] * 3)


def test_the_frozen_file_builds_three_members_with_tuple_settings():
    frozen = json.loads((vf.HERE / "reports" / "v2-frozen-model.json").read_text())
    model = v2.build(frozen, 42)
    assert list(model.members) == frozen["members"]
    assert model.members["mlp"].regressor.named_steps["model"].hidden_layer_sizes == (128,)


def synth(n, seed):
    rng = np.random.default_rng(seed)
    county = rng.choice(["Cork", "Dublin", "Leitrim"], n)
    rate = pd.Series(county).map({"Cork": 3000, "Dublin": 5000, "Leitrim": 1500}).to_numpy()
    area = rng.uniform(40, 300, n)
    X = pd.DataFrame({"county": county, "property_type": rng.choice(["Detached", "Semi-D"], n), "bedrooms": rng.integers(1, 6, n),
                      "floor_area_m2": area, "ber": rng.choice(["A", "B", "C", "Unknown"], n), "rkey": rng.choice(["T12", "D04", None], n)})
    return X, rate * area * rng.uniform(0.8, 1.3, n)


def ridge_model(frozen, seed):
    return v2.LogMeanEnsemble({"ridge": b.make_model("ridge", seed)})


def test_reload_check_passes_for_a_saved_model_and_fails_when_the_reloaded_one_differs(monkeypatch, tmp_path):
    X, y = synth(200, 1)
    model = ridge_model(None, 42).fit(X, y)
    ok = vf.reload_check(model, tmp_path / "m.joblib", X.head(20))
    assert ok["passed"] and ok["max_relative_difference"] == 0.0 and len(ok["sha256"]) == 64

    class Drifted:
        def predict(self, X):
            return model.predict(X) * (1 + 1e-6)

    monkeypatch.setattr(vf.joblib, "load", lambda path: Drifted())
    bad = vf.reload_check(model, tmp_path / "m2.joblib", X.head(20))
    assert not bad["passed"] and bad["max_relative_difference"] > vf.RELOAD_TOLERANCE


# ---- the whole flow on synthetic data (never the real test split) ------------------------------------

def run_main(monkeypatch, tmp_path):
    reports, art = tmp_path / "reports", tmp_path / "art"
    reports.mkdir()
    (reports / "final-test-results.json").write_text(json.dumps({"overall": {"mape": 26.97, "mdape": 19.2, "ppe10": 27.9, "mae": 139327.0, "r2": 0.624}}))
    Xd, yd = synth(300, 1)
    Xc, yc = synth(120, 2)
    df = pd.concat([Xd, Xc], ignore_index=True)
    df["fold"] = [i % 5 for i in range(300)] + [-1] * 120
    Xt, yt = synth(120, 3)
    monkeypatch.setattr(vf.ex, "load_with_extras", lambda seed, also=(): (df, np.concatenate([yd, yc])))
    monkeypatch.setattr(vf.v2, "build", ridge_model)
    monkeypatch.setattr(vf, "load_test", lambda seed: (Xt, yt, {"rows": 123, "no_area": 3}))
    monkeypatch.setattr(vf, "REFERENCE_ROWS", 20)
    monkeypatch.setattr("sys.argv", ["v2_final", "--reports", str(reports), "--artifacts", str(art)])
    vf.main()
    return reports, art


def test_the_threshold_is_written_from_development_rows_and_the_lock_stops_a_second_run(monkeypatch, tmp_path, capsys):
    reports, art = run_main(monkeypatch, tmp_path)
    th = json.loads((reports / "v2-threshold.json").read_text())
    assert th["rows"] == 300 and th["set_on"].startswith("out-of-fold")  # the 120 calibration rows never set it
    assert 0.08 <= th["oof_flag_rate"] <= 0.12  # about 10% by construction
    assert (reports / "v2-final-test-report.md").exists() and (art / "v2-pipeline.joblib").exists()
    res = json.loads((reports / "v2-final-test-results.json").read_text())
    assert res["test_rows"] == 120 and res["saved_model"]["passed"]
    with pytest.raises(SystemExit):
        vf.main()  # same argv: the lock is there
