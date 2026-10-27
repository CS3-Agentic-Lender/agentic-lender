"""Exact Shapley contributions in euro: one per input, adding up to the estimate."""

import json
import os

import numpy as np
import pandas as pd
import pytest

from app import valuation_explain as ve
from app import valuation_model as vm
from ml import data_readiness as dr


class Toy:
    """A stand-in model: predict() reads a DataFrame and returns euro, like the saved pipeline."""

    def __init__(self, fn):
        self.fn = fn

    def predict(self, X):
        return np.array([self.fn(r) for r in X.to_dict("records")], float)


# ---- the maths, on models whose answers can be worked out by hand ---------------------------------

def test_a_linear_model_gives_each_input_its_own_step_away_from_the_background_average():
    model = Toy(lambda r: 10 + 3 * r["a"] + 5 * r["b"] - 2 * r["c"])
    background = pd.DataFrame({"a": [0.0, 2.0], "b": [1.0, 3.0], "c": [4.0, 0.0]})
    home = {"a": 4.0, "b": 2.0, "c": 1.0}
    out = ve.shapley(model, ["a", "b", "c"], home, background)
    assert out.baseline == pytest.approx(10 + 3 * 1 + 5 * 2 - 2 * 2)
    assert out.contributions["a"] == pytest.approx(3 * (4 - 1))
    assert out.contributions["b"] == pytest.approx(5 * (2 - 2))
    assert out.contributions["c"] == pytest.approx(-2 * (1 - 2))


def test_two_inputs_that_interact_share_the_credit_equally():
    model = Toy(lambda r: r["a"] * r["b"])
    background = pd.DataFrame({"a": [1.0], "b": [2.0]})
    out = ve.shapley(model, ["a", "b"], {"a": 3.0, "b": 5.0}, background)
    # v(none)=2, v(a)=6, v(b)=5, v(both)=15
    assert out.baseline == pytest.approx(2)
    assert out.contributions["a"] == pytest.approx(0.5 * ((6 - 2) + (15 - 5)))
    assert out.contributions["b"] == pytest.approx(0.5 * ((5 - 2) + (15 - 6)))


def test_an_input_the_model_ignores_gets_exactly_zero():
    model = Toy(lambda r: 7 * r["a"])
    background = pd.DataFrame({"a": [1.0, 2.0], "b": [9.0, 8.0]})
    assert ve.shapley(model, ["a", "b"], {"a": 5.0, "b": 0.0}, background).contributions["b"] == 0


def test_baseline_plus_contributions_is_the_model_answer_for_the_home():
    model = Toy(lambda r: r["a"] ** 2 + r["a"] * r["b"] + np.sin(r["c"]))
    background = pd.DataFrame({"a": [0.0, 1.0, 2.0], "b": [1.0, 5.0, 2.0], "c": [0.0, 1.0, 2.0]})
    home = {"a": 3.0, "b": 4.0, "c": 5.0}
    out = ve.shapley(model, ["a", "b", "c"], home, background)
    assert out.baseline + sum(out.contributions.values()) == pytest.approx(model.predict(pd.DataFrame([home]))[0])


def test_many_homes_at_once_match_one_at_a_time():
    model = Toy(lambda r: r["a"] * r["b"] + r["c"])
    background = pd.DataFrame({"a": [0.0, 1.0], "b": [1.0, 2.0], "c": [3.0, 1.0]})
    homes = pd.DataFrame({"a": [1.0, 4.0], "b": [2.0, 0.0], "c": [5.0, 6.0]})
    batch = ve.shapley_many(model, ["a", "b", "c"], homes, background)
    for i, home in enumerate(homes.to_dict("records")):
        one = ve.shapley(model, ["a", "b", "c"], home, background)
        assert batch.baseline == pytest.approx(one.baseline)
        assert batch.contributions.loc[i].to_dict() == pytest.approx(one.contributions)


def test_more_than_ten_inputs_are_refused_because_the_count_doubles_with_each_one():
    cols = [f"x{i}" for i in range(11)]
    with pytest.raises(ValueError):
        ve.shapley(Toy(lambda r: 0.0), cols, dict.fromkeys(cols, 0.0), pd.DataFrame([dict.fromkeys(cols, 0.0)]))


# ---- the saved model ---------------------------------------------------------------------------

HOMES = [
    ("Dublin", "Terrace", 3, 100.0, "C", "D14"),
    ("Cork", "Semi-D", 4, 140.0, "B", "T12"),
    ("Galway", "Apartment", 2, 70.0, "Unknown", None),
    ("Kerry", "Detached", 5, 260.0, "E", "Z99"),
]


@pytest.mark.parametrize("home", HOMES)
def test_the_saved_model_contributions_add_up_to_the_estimate_within_one_euro(home):
    out = ve.explain_value(*home)
    assert out.baseline + sum(out.contributions.values()) == pytest.approx(vm.estimate_value(*home), abs=1)  # abs=1: within EUR 1
    assert out.estimate == pytest.approx(vm.estimate_value(*home))


def test_contributions_come_back_one_per_input_not_one_per_encoded_column():
    out = ve.explain_value(*HOMES[0])
    assert set(out.contributions) == {"county", "property_type", "bedrooms", "floor_area_m2", "ber", "rkey"}


def test_a_bigger_home_gets_a_bigger_floor_area_contribution():
    small = ve.explain_value("Dublin", "Terrace", 3, 60.0, "C", "D14").contributions["floor_area_m2"]
    big = ve.explain_value("Dublin", "Terrace", 3, 200.0, "C", "D14").contributions["floor_area_m2"]
    assert big > small


def test_the_background_sample_is_saved_with_the_model_and_in_the_model_card():
    manifest = json.loads((vm.MODEL_DIR / "manifest.json").read_text())
    sample = pd.read_csv(vm.MODEL_DIR / manifest["background_sample"]["file"])
    assert len(sample) == manifest["background_sample"]["rows"] == 100
    assert list(sample.columns) == manifest["input_columns"]
    card = (vm.MODEL_DIR / "MODEL_CARD.md").read_text()
    assert "background-sample.csv" in card and "seed 42" in card


# ---- every property in the final test split (needs the raw dataset, which is not in git) -------------

@pytest.mark.skipif(not dr.CSV_PATH.exists(), reason="raw dataset not downloaded")
@pytest.mark.skipif(not os.getenv("AL_FULL_TEST_SPLIT"), reason="takes about 6 minutes: run with AL_FULL_TEST_SPLIT=1")
def test_contributions_add_up_to_the_estimate_for_every_property_in_the_final_test_split():
    from ml import v2_final

    X, _, _ = v2_final.load_test(v2_final.CONFIG["seed"])
    model, columns = vm._load()
    homes = X[columns].copy()
    homes["ber"] = [dr.ber_band(b) for b in homes["ber"]]
    out = ve.shapley_many(model, columns, homes, ve.background())
    gap = (out.baseline + out.contributions.sum(axis=1)) - model.predict(homes)
    assert len(homes) > 100
    assert gap.abs().max() < 1
