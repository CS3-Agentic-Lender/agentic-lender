from ml import v2_tune as t


def r(mape, bias=0.0):
    return {"cv_mape": mape, "median_signed_error": bias}


def test_lowest_error_wins():
    out = t.choose_winner({"hist_gradient_boosting": r(21.5), "catboost": r(21.0), "mlp": r(21.9), "ensemble_mean": r(20.6)})
    assert out["winner"] == "ensemble_mean"


def test_exact_tie_goes_to_the_simplest():
    out = t.choose_winner({"hist_gradient_boosting": r(21.0), "catboost": r(21.0)})
    assert out["winner"] == "hist_gradient_boosting"


def test_leaning_low_is_excluded_even_if_best():
    out = t.choose_winner({"hist_gradient_boosting": r(22.0), "catboost": r(19.0, -0.05), "mlp": r(23.0), "ensemble_mean": r(21.5)})
    assert out["winner"] == "ensemble_mean" and out["excluded_for_bias"] == ["catboost"]


def test_everyone_biased_means_no_winner():
    assert t.choose_winner({"catboost": r(20.0, 0.05)})["winner"] is None


def test_any_gain_uses_the_tuned_settings():
    assert t.pick_settings("catboost", 21.29, 21.3) == "tuned"
    assert t.pick_settings("catboost", 21.3, 21.3) == "v1"


def test_draws_are_repeatable_and_per_model():
    a = t.sample_trials("catboost", 3, 42)
    assert a == t.sample_trials("catboost", 3, 42) and a != t.sample_trials("hist_gradient_boosting", 3, 42)
