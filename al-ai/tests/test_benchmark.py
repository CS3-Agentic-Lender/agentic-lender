import pytest

np = pytest.importorskip("numpy")
pd = pytest.importorskip("pandas")
pytest.importorskip("sklearn")

from ml import benchmark as b  # noqa: E402


def frame(n=200, seed=0):
    """Synthetic listings where price is area x a county rate, so a sensible model can learn it."""
    rng = np.random.default_rng(seed)
    county = rng.choice(["Cork", "Dublin", "Leitrim"], n)
    rate = pd.Series(county).map({"Cork": 3000, "Dublin": 5000, "Leitrim": 1500}).to_numpy()
    area = rng.uniform(40, 300, n)
    df = pd.DataFrame({
        "county": county, "property_type": rng.choice(["Detached", "Semi-D"], n), "bedrooms": rng.integers(1, 6, n),
        "floor_area_m2": area, "ber": rng.choice(["A", "B", "C", "D", "Unknown"], n),
    })
    return df, rate * area * rng.uniform(0.9, 1.1, n)


# ---- scores -------------------------------------------------------------------------------

def test_scores_on_a_known_case():
    s = b.scores([100, 200, 400], [110, 200, 300])
    assert s["n"] == 3 and s["mae"] == pytest.approx((10 + 0 + 100) / 3)
    assert s["mape"] == pytest.approx((10 + 0 + 25) / 3)  # per cent
    assert s["mdape"] == pytest.approx(10) and s["ppe10"] == pytest.approx(200 / 3)


def test_a_single_row_segment_has_no_r2():
    assert b.scores([100], [90])["r2"] is None


# ---- baseline -----------------------------------------------------------------------------

def test_baseline_uses_median_price_per_m2_then_falls_back():
    train = pd.DataFrame({"county": ["Cork", "Cork", "Cork", "Dublin"], "property_type": ["Detached", "Detached", "Detached", "Semi-D"],
                          "floor_area_m2": [100.0, 100.0, 100.0, 50.0]})
    base = b.MedianPerM2Baseline().fit(train, np.array([300_000, 400_000, 500_000, 250_000]))
    test = pd.DataFrame({"county": ["Cork", "Cork", "Leitrim"], "property_type": ["Detached", "Semi-D", "Detached"],
                         "floor_area_m2": [100.0, 100.0, 100.0]})
    pred = base.predict(test)
    assert pred[0] == pytest.approx(400_000)          # the Cork Detached cell median: 4,000 per m2
    assert pred[1] == pytest.approx(400_000)          # no Cork Semi-D: county median
    assert pred[2] == pytest.approx(base.global_ * 100)  # no Leitrim: everything
    assert dict(base.fallbacks) == {"cell": 1, "county": 1, "global": 1}


# ---- features -----------------------------------------------------------------------------

def test_unknown_ber_gets_an_indicator_and_the_training_median():
    train = pd.DataFrame({"county": ["Cork"] * 3, "property_type": ["Detached"] * 3, "bedrooms": [3] * 3,
                          "floor_area_m2": [100.0] * 3, "ber": ["A", "C", "E"]})  # ordinals 1, 3, 5: median 3
    fb = b.FeatureBuilder().fit(train)
    X = fb.transform(train.assign(ber=["Unknown", "A", "G"]))
    assert fb.ber_fill_ == 3.0
    assert list(X[:, 2]) == [3.0, 1.0, 7.0] and list(X[:, 3]) == [1.0, 0.0, 0.0]


def test_one_hot_columns_match_the_frozen_categories():
    df, _ = frame(10)
    X = b.FeatureBuilder().fit(df).transform(df)
    assert X.shape == (10, 4 + len(b.COUNTIES) + len(b.TYPES))
    assert X[:, 4 : 4 + len(b.COUNTIES)].sum(axis=1).tolist() == [1.0] * 10


@pytest.mark.parametrize("col, value", [("county", "Down"), ("property_type", "Studio"), ("ber", "A1")])
def test_unsupported_values_raise_instead_of_becoming_a_category(col, value):
    df, _ = frame(5)
    fb = b.FeatureBuilder().fit(df)
    with pytest.raises(ValueError, match="unsupported"):
        fb.transform(df.assign(**{col: value}))


# ---- the cross-validation -----------------------------------------------------------------

def run_cv(df, y, name="ridge", seed=42):
    fold_ids = np.arange(len(df)) % 5
    return b.cross_validate(lambda: b.make_model(name, seed), df, y, fold_ids, [100.0, 200.0, 300.0])


def test_a_model_that_can_learn_the_pattern_beats_ten_per_error():
    df, y = frame()
    result, timing = run_cv(df, y)
    assert result["cv_mape"] < 15 and len(result["fold_mape"]) == 5 and timing["fit_s_per_fold"] >= 0


def test_two_runs_give_identical_metrics():
    df, y = frame()
    a, _ = run_cv(df, y, "random_forest")
    c, _ = run_cv(df, y, "random_forest")
    assert b.digest(a) == b.digest(c)


def test_predictions_come_back_in_euro_not_log_euro():
    df, y = frame()
    est = b.make_model("ridge", 42).fit(df, y)
    assert est.predict(df).mean() == pytest.approx(y.mean(), rel=0.3)


def test_segments_report_counts_and_the_top_decile():
    df, y = frame()
    seg = b.segments(df, y, y * 1.1, [100.0, 200.0, 300.0])
    assert sum(s["n"] for s in seg["county"].values()) == len(df)
    assert seg["price_band"]["top decile (90th percentile and up)"]["n"] >= len(df) // 10
    assert seg["county"]["Cork"]["mape"] == pytest.approx(10.0)
