from ml.more_rows import decide


def arm(mape, folds, bias=0.0):
    return {"cv_mape": mape, "fold_mape": folds, "median_signed_error": bias}


A = {m: arm(22.0, [22.0] * 5) for m in ("hist_gradient_boosting", "catboost")}


def test_adopts_when_all_three_conditions_hold():
    c = {m: arm(21.0, [21.0] * 5, 0.01) for m in A}
    assert decide(A, c)["adopt"]


def test_one_model_short_of_the_gain_fails():
    c = {"hist_gradient_boosting": arm(21.0, [21.0] * 5), "catboost": arm(21.8, [21.8] * 5)}
    assert not decide(A, c)["adopt"]


def test_three_folds_is_not_enough():
    c = {m: arm(21.0, [21.0, 21.0, 21.0, 23.0, 23.0]) for m in A}
    assert not decide(A, c)["adopt"]


def test_winning_by_estimating_low_fails():
    c = {m: arm(21.0, [21.0] * 5, -0.04) for m in A}
    assert not decide(A, c)["adopt"]
