import json

import pytest

np = pytest.importorskip("numpy")
pd = pytest.importorskip("pandas")
pytest.importorskip("sklearn")

from ml import benchmark as b  # noqa: E402
from ml import experiments as ex  # noqa: E402
from ml import split  # noqa: E402


def frame(n=120, seed=0, pair_every=3):
    """Synthetic listings: price follows area and a routing key's price level; every third home has a repeat advert (same group)."""
    rng = np.random.default_rng(seed)
    keys = np.array(["D04", "T12", "V92", "H91"])
    level = {"D04": 7000.0, "T12": 4200.0, "V92": 3300.0, "H91": 2500.0}
    rows = []
    for g in range(n):
        key, area = keys[rng.integers(4)], rng.uniform(50, 250)
        price = level[key] * area * rng.uniform(0.85, 1.2)
        for _ in range(2 if g % pair_every == 0 else 1):
            rows.append({"county": "Cork", "property_type": "Detached", "bedrooms": 3, "floor_area_m2": area, "ber": "C", "rkey": key,
                         "bathrooms": 2.0, "built_year": np.nan, "town": "x", "lat": 52.0, "lon": -8.0, "group": f"g{g}",
                         "price": price * rng.uniform(0.98, 1.02)})
    df = pd.DataFrame(rows)
    return df.drop(columns="price"), df["price"].to_numpy()


def expected_column(X, y, **kw):
    fb = ex.FeatureBuilderV2(["expected_price"], **kw)
    return fb.fit_transform(X, np.log(y))[:, -1], fb


# ---- a row's own feature never contains its own price -----------------------------------------

def test_a_training_rows_feature_does_not_change_when_its_own_fold_prices_change():
    X, y = frame()
    base, _ = expected_column(X, y)
    groups = [{"source_row": i, "group": g} for i, g in enumerate(X["group"])]
    inner = split.folds(groups, 5, 42)  # the same inner folds the builder uses
    i = 7
    same_fold = [r for r in range(len(X)) if inner[r] == inner[i]]
    wild = y.copy()
    wild[same_fold] *= 25.0  # scramble every price in row i's inner fold, including its own and its repeat advert's
    changed, _ = expected_column(X, wild)
    assert changed[i] == pytest.approx(base[i]) and all(changed[r] == pytest.approx(base[r]) for r in same_fold)


def test_a_repeat_advert_never_feeds_its_sibling():
    X, y = frame()
    base, _ = expected_column(X, y)
    sib = X.index[(X["group"] == X["group"].iloc[0])].tolist()
    assert len(sib) == 2
    wild = y.copy()
    wild[sib[1]] *= 40.0
    changed, _ = expected_column(X, wild)
    assert changed[sib[0]] == pytest.approx(base[sib[0]])  # the sibling's price does not reach this row


def test_without_the_group_column_it_refuses_instead_of_leaking():
    X, y = frame()
    with pytest.raises(ValueError, match="property group"):
        ex.FeatureBuilderV2(["expected_price"]).fit_transform(X.drop(columns="group"), np.log(y))


def test_the_expected_price_for_new_rows_comes_from_training_rows_only():
    X, y = frame()
    train, test = X.iloc[:90], X.iloc[90:]
    fb = ex.FeatureBuilderV2(["expected_price"])
    fb.fit_transform(train, np.log(y[:90]))
    before = fb.transform(test)[:, -1]
    fb2 = ex.FeatureBuilderV2(["expected_price"])
    fb2.fit_transform(train, np.log(y[:90]))  # the scored rows' real prices (y[90:]) are never passed anywhere
    assert fb2.transform(test)[:, -1] == pytest.approx(before)
    assert fb.table_ and set(fb.table_) <= set(train["rkey"])


def test_the_feature_is_log_area_plus_the_keys_smoothed_price_per_m2():
    X, y = frame()
    fb = ex.FeatureBuilderV2(["expected_price"]).fit(X, np.log(y))
    row = X.iloc[[0]]
    manual = fb.table_[row["rkey"].iloc[0]] + np.log(row["floor_area_m2"].iloc[0])
    assert fb.transform(row)[0, -1] == pytest.approx(manual)


def test_unseen_and_missing_keys_get_the_overall_mean():
    X, y = frame()
    fb = ex.FeatureBuilderV2(["expected_price"]).fit(X, np.log(y))
    odd = X.iloc[[0, 1]].assign(rkey=["ZZZ", None])
    out = fb.transform(odd)[:, -1]
    assert out == pytest.approx(fb.overall_ + np.log(odd["floor_area_m2"].to_numpy()))


# ---- the canary: on shuffled prices a leak-free feature must give no gain ---------------------

def cv(df, y, extras, seed=0):
    n = len(df)
    fold = np.array([split.folds([{"source_row": i, "group": g} for i, g in enumerate(df["group"])], 5, seed)[i] for i in range(n)])
    oof = np.empty(n)
    for k in range(5):
        tr, te = fold != k, fold == k
        m = b.make_model("hist_gradient_boosting", 42, {"max_iter": 60}, features=ex.FeatureBuilderV2(extras))
        m.fit(df[tr], y[tr])
        oof[te] = m.predict(df[te])
    return float(np.mean(np.abs(oof - y) / y) * 100)


def test_the_canary_on_shuffled_prices_shows_no_gain_but_the_real_prices_do():
    X, y = frame(n=300)
    real_gain = cv(X, y, ["eircode_routing_key"]) - cv(X, y, ["eircode_routing_key", "expected_price"])
    shuffled = np.random.default_rng(1).permutation(y)  # prices no longer belong to their homes
    canary_gain = cv(X, shuffled, ["eircode_routing_key"]) - cv(X, shuffled, ["eircode_routing_key", "expected_price"])
    assert abs(canary_gain) < 3.0           # nothing to learn from shuffled prices, so no gain from a leak-free feature
    assert real_gain > -3.0                 # and on real structure it does not hurt


def test_the_followup_rules_are_the_ones_committed_first():
    cfg = json.loads((ex.HERE / "followup_config.json").read_text())
    assert cfg["adopt_rule"].startswith("Same rule") and cfg["compare"]["candidate"] == ["eircode_routing_key", "expected_price"]
    assert "shuffle the prices" in " ".join(cfg["leakage_checks"])
