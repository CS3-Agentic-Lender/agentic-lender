import json
from pathlib import Path

import pytest

pytest.importorskip("numpy")
pytest.importorskip("pandas")
pytest.importorskip("sklearn")

from ml import tune  # noqa: E402

ORDER = tune.CONFIG["simplicity_order"]


def mape(**over):
    return {"baseline": 31.9, "hist_gradient_boosting": 26.8, "catboost": 26.3, "mlp": 27.2, "ensemble_mean": 26.0, **over}


# ---- the rules were written down first ------------------------------------------------------

def test_the_margin_and_tie_band_are_the_ones_agreed_before_tuning():
    assert tune.CONFIG["improvement_margin_mape_pp"] == 2.0 and tune.CONFIG["tie_band_mape_pp"] == 1.0
    assert tune.CONFIG["trials_per_model"] == 50 and len(tune.CONFIG["shortlist"]) == 3
    assert ORDER == ["hist_gradient_boosting", "catboost", "mlp", "ensemble_mean"]


# ---- the winner rule -------------------------------------------------------------------------

def test_nothing_beating_the_baseline_by_the_margin_ships_the_baseline():
    d = tune.choose_winner(mape(hist_gradient_boosting=30.5, catboost=30.4, mlp=31.0, ensemble_mean=30.0))
    assert d["winner"] == "baseline" and "margin" in d["reason"]


def test_beating_the_baseline_by_exactly_the_margin_is_enough():
    d = tune.choose_winner({"baseline": 31.9, "hist_gradient_boosting": 29.9, "catboost": 33.0, "mlp": 33.0, "ensemble_mean": 33.0})
    assert d["winner"] == "hist_gradient_boosting"


def test_a_clear_best_model_wins_outright():
    d = tune.choose_winner(mape(catboost=24.0, hist_gradient_boosting=26.8, mlp=27.2, ensemble_mean=25.5))
    assert d["winner"] == "catboost" and d["tied"] == ["catboost"]


def test_models_within_one_point_go_to_the_simplest():
    # catboost is best at 26.3, hist gradient boosting at 26.8 is within a point, so the simpler HGB wins
    d = tune.choose_winner(mape(ensemble_mean=27.0))
    assert d["winner"] == "hist_gradient_boosting" and "catboost" in d["tied"]


def test_the_ensemble_wins_only_by_more_than_the_tie_band():
    assert tune.choose_winner(mape(ensemble_mean=25.4))["winner"] == "catboost"  # 0.9 ahead of catboost: tied, simpler wins
    assert tune.choose_winner(mape(ensemble_mean=25.2))["winner"] == "ensemble_mean"  # 1.1 ahead of everything: clear


def test_the_edge_of_the_tie_band_counts_as_tied():
    d = tune.choose_winner(mape(catboost=25.8, hist_gradient_boosting=26.8, mlp=29.0, ensemble_mean=29.0))  # exactly 1.0 apart
    assert d["winner"] == "hist_gradient_boosting"


# ---- the search ------------------------------------------------------------------------------

def test_trials_are_reproducible_and_a_different_seed_differs():
    assert tune.sample_trials("catboost", 10, 42) == tune.sample_trials("catboost", 10, 42)
    assert tune.sample_trials("catboost", 10, 42) != tune.sample_trials("catboost", 10, 43)


def test_every_draw_stays_inside_its_declared_space():
    for model, space in tune.CONFIG["spaces"].items():
        for trial in tune.sample_trials(model, 200, 7):
            assert set(trial) == set(space)
            for name, value in trial.items():
                spec = space[name]
                if spec["type"] in ("int", "loguniform"):
                    assert spec["low"] <= value <= spec["high"]
                else:
                    assert list(value) in spec["values"]


def test_one_models_draws_do_not_change_when_another_is_added():
    a = tune.sample_trials("mlp", 5, 42)
    tune.sample_trials("catboost", 99, 42)
    assert tune.sample_trials("mlp", 5, 42) == a


def test_a_hidden_layer_choice_is_a_tuple_as_scikit_learn_wants():
    t = tune.sample_trials("mlp", 1, 42)[0]
    assert isinstance(t["hidden_layer_sizes"], tuple)


def test_overridden_params_reach_the_model():
    from ml import benchmark as b
    est = b.make_model("hist_gradient_boosting", 42, {"max_leaf_nodes": 17, "learning_rate": 0.05})
    inner = est.regressor.named_steps["model"]
    assert inner.max_leaf_nodes == 17 and inner.learning_rate == 0.05
    assert json.loads((Path(tune.HERE) / "tuning_config.json").read_text())["seed"] == 42
