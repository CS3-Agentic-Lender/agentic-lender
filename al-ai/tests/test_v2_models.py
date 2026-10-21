import json

import pytest

np = pytest.importorskip("numpy")
pd = pytest.importorskip("pandas")
pytest.importorskip("sklearn")

from ml import v2_models as vm  # noqa: E402


def frame(n=200, seed=0):
    rng = np.random.default_rng(seed)
    keys = np.array(["D04", "T12", "V92", "H91", "P31", "K32"])
    level = {"D04": 7000.0, "T12": 4200.0, "V92": 3300.0, "H91": 2500.0, "P31": 3000.0, "K32": 2200.0}
    rows = []
    for g in range(n):
        key, area = keys[rng.integers(6)], rng.uniform(50, 250)
        for _ in range(2 if g % 4 == 0 else 1):
            rows.append({"county": ["Cork", "Dublin", "Galway"][rng.integers(3)], "property_type": "Detached", "bedrooms": 3, "floor_area_m2": area, "ber": "C",
                         "rkey": key, "bathrooms": 2.0, "built_year": np.nan, "town": "x", "lat": 52.0, "lon": -8.0, "group": f"g{g}",
                         "price": level[key] * area * rng.uniform(0.9, 1.15)})
    df = pd.DataFrame(rows)
    return df.drop(columns="price"), df["price"].to_numpy()


class Recorder:
    """A stand-in model that records the rows it was trained on and predicts a constant."""
    seen = []

    def __init__(self, value=100.0):
        self.value = value

    def fit(self, X, y):
        Recorder.seen.append(X.index.to_list())
        return self

    def predict(self, X):
        return np.full(len(X), self.value)


# ---- bagging ----------------------------------------------------------------------------------

def test_bagging_averages_in_log_price():
    X, y = frame(40)
    bag = vm.BaggedModel(lambda i: Recorder([100.0, 400.0][i]), n=2, bootstrap=False).fit(X, y)
    assert bag.predict(X)[0] == pytest.approx(200.0)  # geometric mean of 100 and 400


def test_bootstrap_resamples_whole_property_groups():
    X, y = frame(60)
    Recorder.seen = []
    vm.BaggedModel(lambda i: Recorder(), n=3, bootstrap=True, seed=1).fit(X, y)
    rows_of = X.groupby("group").size().to_dict()
    for idx in Recorder.seen:
        counts = pd.Series(X["group"].to_numpy()[idx]).value_counts()
        for g, c in counts.items():
            assert c % rows_of[g] == 0  # a repeat advert is never taken without its sibling


def test_bootstrap_members_differ_but_seed_bagging_without_bootstrap_uses_all_rows():
    X, y = frame(60)
    Recorder.seen = []
    vm.BaggedModel(lambda i: Recorder(), n=2, bootstrap=True, seed=1).fit(X, y)
    assert Recorder.seen[0] != Recorder.seen[1]
    Recorder.seen = []
    vm.BaggedModel(lambda i: Recorder(), n=2, bootstrap=False).fit(X, y)
    assert all(len(s) == len(X) for s in Recorder.seen)


# ---- GPBoost ---------------------------------------------------------------------------------

def test_gpboost_fits_and_predicts_unseen_keys():
    pytest.importorskip("gpboost")
    X, y = frame(160)
    cut = int(len(X) * 0.8)
    model = vm.GPBoostModel(vm.CONFIG["variants"]["gpboost"]["settings"] | {"max_rounds": 60}).fit(X.iloc[:cut], y[:cut])
    test = X.iloc[cut:].assign(rkey="ZZZ")  # a routing key never seen in training
    assert len(test) > 0
    pred = model.predict(test)
    assert model.rounds_ >= 1 and np.isfinite(pred).all() and (pred > 0).all()


def test_gpboost_learns_the_area_price_level_from_the_random_effect():
    pytest.importorskip("gpboost")
    X, y = frame(240)
    cut = int(len(X) * 0.8)
    train, test = slice(0, cut), slice(cut, None)
    assert len(X.iloc[test]) > 0
    model = vm.GPBoostModel(vm.CONFIG["variants"]["gpboost"]["settings"] | {"max_rounds": 120}).fit(X.iloc[train], y[train])
    mape = float(np.mean(np.abs(model.predict(X.iloc[test]) - y[test]) / y[test]) * 100)
    assert mape < 20  # synthetic prices follow area x a key level, so a model with a key effect gets close


# ---- TabPFN guard ----------------------------------------------------------------------------

def test_tabpfn_refuses_to_run_without_the_owners_agreement(monkeypatch):
    monkeypatch.delenv("ALLOW_TABPFN_DOWNLOAD", raising=False)
    with pytest.raises(PermissionError, match="owner has agreed"):
        vm.TabPFNModel()


def test_tabpfn_can_be_constructed_once_agreed_but_downloads_nothing_until_fit(monkeypatch):
    monkeypatch.setenv("ALLOW_TABPFN_DOWNLOAD", "1")
    assert vm.TabPFNModel().seed == 42


# ---- the shortlist rule ---------------------------------------------------------------------

REF = {"cv_mape": 21.78, "fold_mape": [20.0, 22.0, 22.0, 23.0, 22.0], "ppe10": 35.9, "median_signed_error": 0.01}


def cand(mape, folds=None, ppe10=36.0, bias=0.0):
    return {"cv_mape": mape, "fold_mape": folds or [v - (21.78 - mape) for v in REF["fold_mape"]], "ppe10": ppe10, "median_signed_error": bias}


def test_a_clear_honest_gain_enters_the_shortlist():
    assert vm.shortlist_verdict(cand(21.0), REF)["shortlist"] is True


@pytest.mark.parametrize("c, failing", [
    (cand(21.4), "gain_at_least_0_5"),                           # only 0.38 better
    (cand(21.0, folds=[19.0, 21.0, 21.0, 24.0, 21.0]), "lower_in_all_five_folds"),
    (cand(21.0, bias=-0.04), "no_low_estimating"),               # wins by estimating 4% low
    (cand(21.0, ppe10=33.0), "within10_not_worse"),
])
def test_each_condition_can_block_the_shortlist(c, failing):
    v = vm.shortlist_verdict(c, REF)
    assert v["shortlist"] is False and v["checks"][failing] is False


def test_the_committed_rule_matches_the_code():
    assert "0.5 points below the best single reference" in vm.CONFIG["shortlist_rule"]["rule"]
    assert vm.CONFIG["references"]["catboost"] == 21.78 and json.dumps(sorted(vm.BAG_SIZES.items())) == json.dumps([["catboost", 10], ["hist_gradient_boosting", 10], ["mlp", 5]])


# ---- helpers ---------------------------------------------------------------------------------

def test_rare_key_mape_counts_only_homes_with_few_training_examples():
    X = pd.DataFrame({"rkey": ["A"] * 12 + ["B"] * 2 + [None] * 12})
    y = np.full(len(X), 100.0)
    oof = np.full(len(X), 110.0)
    fold_ids = np.array([0] * 7 + [1] * 7 + [2] * 6 + [3] * 3 + [4] * 3)
    out = vm.rare_key_mape(X, y, oof, fold_ids, below=10)
    assert out["rows"] >= 2 and out["mape"] == pytest.approx(10.0)
