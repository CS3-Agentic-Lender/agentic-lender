import json

import pytest

np = pytest.importorskip("numpy")
pd = pytest.importorskip("pandas")
pytest.importorskip("sklearn")

from ml import experiments as ex  # noqa: E402


# ---- Eircode routing keys ---------------------------------------------------------------------

@pytest.mark.parametrize("title, key", [
    ("'Horizons', Banna East, Ardfert, Co. Kerry, V92HT65", "V92"),
    ("Ivella, Rectory Road, Enniscorthy, Co. Wexford, Y21WN30", "Y21"),
    ("Apt 5, The Quay, Dublin 6, D6W AF12", "D6W"),
    ("12 Main St, Cork, t12 x4k8", "T12"),
    ("Kilmehere, Shanagolden, Co Limerick", None),
    ("47 Willow Park Avenue, Glasnevin, Dublin 11, D11", None),
])
def test_routing_key_comes_from_the_eircode_at_the_end_of_the_title(title, key):
    assert ex.routing_key(title) == key


# ---- the feature builder -----------------------------------------------------------------------

def frame(n=40):
    rng = np.random.default_rng(0)
    return pd.DataFrame({
        "county": rng.choice(["Cork", "Dublin"], n), "property_type": "Detached", "bedrooms": rng.integers(1, 5, n),
        "floor_area_m2": rng.uniform(50, 200, n), "ber": "C",
        "rkey": rng.choice(["T12", "T23", "D04", None], n), "bathrooms": rng.integers(1, 4, n).astype(float),
        "built_year": rng.choice([1980.0, 2005.0, np.nan], n), "town": rng.choice(["cork-city", "bandon-cork"], n),
        "lat": rng.uniform(51, 54, n), "lon": rng.uniform(-9, -6, n),
    })


def test_with_no_extras_it_is_exactly_the_five_input_features():
    from ml import benchmark as b
    df = frame()
    assert (ex.FeatureBuilderV2().fit(df).transform(df) == b.FeatureBuilder().fit(df).transform(df)).all()


@pytest.mark.parametrize("extra, added", [("eircode_routing_key", 3 + 2), ("bathrooms", 1), ("construction_year", 2),
                                          ("town", 2 + 2), ("coordinates", 2)])
def test_each_extra_adds_the_columns_it_should(extra, added):
    df = frame()
    base = ex.FeatureBuilderV2().fit(df).transform(df).shape[1]
    # eircode: 3 keys (T12, T23, D04, each over the min count of 5 here) + Other + Unknown
    out = ex.FeatureBuilderV2([extra], min_count=5).fit(df).transform(df)
    assert out.shape[1] == base + added


def test_rare_keys_are_grouped_as_other_using_training_rows_only():
    train = frame(40)
    train.loc[0, "rkey"] = "Z99"  # one row: below the min count
    fb = ex.FeatureBuilderV2(["eircode_routing_key"], min_count=5).fit(train)
    assert "Z99" not in fb.keys_
    test = frame(5).assign(rkey=["Z99", "NEW", None, "T12", "T12"])  # unseen keys must not crash
    out = fb.transform(test)
    other, unknown = out[:, -2], out[:, -1]
    assert other[:2].tolist() == [1.0, 1.0] and unknown[2] == 1.0 and other[3] == 0.0


def test_a_missing_construction_year_gets_a_flag_and_the_training_median():
    train = frame()
    fb = ex.FeatureBuilderV2(["construction_year"]).fit(train)
    test = frame(3).assign(built_year=[np.nan, 1990.0, np.nan])
    out = fb.transform(test)[:, -2:]
    assert out[:, 1].tolist() == [1.0, 0.0, 1.0] and out[0, 0] == fb.built_fill_ and out[1, 0] == 1990.0


# ---- the rule for what is worth proposing --------------------------------------------------------

BOTH = {"hist_gradient_boosting": 1.2, "catboost": 1.4}
ALL5 = {"hist_gradient_boosting": 5, "catboost": 5}


def test_an_input_the_app_already_collects_needs_one_point_in_both_models_and_all_folds():
    assert ex.verdict(BOTH, ALL5, ["eircode_routing_key"])["worth_proposing"] is True
    assert ex.verdict({**BOTH, "catboost": 0.9}, ALL5, ["eircode_routing_key"])["worth_proposing"] is False
    assert ex.verdict(BOTH, {**ALL5, "catboost": 4}, ["eircode_routing_key"])["worth_proposing"] is False


def test_a_new_field_needs_two_points():
    assert ex.verdict(BOTH, ALL5, ["bathrooms"])["worth_proposing"] is False  # 1.2 is not enough for a new field
    assert ex.verdict({"hist_gradient_boosting": 2.0, "catboost": 2.5}, ALL5, ["bathrooms"])["worth_proposing"] is True


def test_a_combination_with_one_new_field_needs_the_new_field_threshold():
    assert ex.verdict(BOTH, ALL5, ["eircode_routing_key", "bathrooms"])["worth_proposing"] is False


def test_reference_only_additions_are_never_proposed():
    big = {"hist_gradient_boosting": 9.0, "catboost": 9.0}
    assert ex.verdict(big, ALL5, ["coordinates"])["worth_proposing"] is False
    assert ex.verdict(big, ALL5, ["eircode_routing_key", "town"])["worth_proposing"] is False


def test_the_rules_are_the_ones_committed_first():
    wr = ex.CONFIG["worth_proposing"]
    assert wr["threshold_if_the_app_already_collects_it_mape_pp"] == 1.0 and wr["threshold_if_it_needs_a_new_field_mape_pp"] == 2.0
    assert ex.CONFIG["additions"]["eircode_routing_key"]["app_collects_it_today"] is True
    assert json.dumps(ex.CONFIG["combinations"][0]) == '["eircode_routing_key"]'
