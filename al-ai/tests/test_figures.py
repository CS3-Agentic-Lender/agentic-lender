import pytest

np = pytest.importorskip("numpy")
pytest.importorskip("matplotlib")

from ml import figures as fg  # noqa: E402

EDGES = [100.0, 200.0, 300.0]


def test_share_within_counts_errors_at_or_under_the_limit():
    y = np.array([100.0, 100.0, 100.0, 100.0])
    p = np.array([100.0, 110.0, 90.0, 150.0])  # errors 0, 10%, 10%, 50%
    assert fg.share_within(y, p, 0.10) == pytest.approx(0.75) and fg.share_within(y, p, 0.05) == pytest.approx(0.25)


def test_band_index_uses_the_three_cut_points():
    assert fg.band_index(np.array([50.0, 100.0, 150.0, 250.0, 999.0]), EDGES).tolist() == [0, 1, 1, 2, 3]


def test_confusion_rows_are_the_real_band_and_columns_the_chosen_one():
    y = np.array([50.0, 50.0, 150.0, 350.0])
    p = np.array([60.0, 160.0, 140.0, 120.0])  # bands: real 0,0,1,3 ; chosen 0,1,1,1
    m = fg.confusion(y, p, EDGES)
    assert m[0].tolist() == [1, 1, 0, 0] and m[1].tolist() == [0, 1, 0, 0] and m[3].tolist() == [0, 1, 0, 0] and m.sum() == 4


def test_a_perfect_model_puts_everything_on_the_diagonal():
    y = np.array([50.0, 150.0, 250.0, 350.0])
    m = fg.confusion(y, y, EDGES)
    assert np.trace(m) == m.sum()


def test_every_figure_is_written_with_a_takeaway(tmp_path):
    rng = np.random.default_rng(0)
    y = rng.uniform(80_000, 900_000, 400)
    p5, pe = y * rng.normal(1, 0.35, 400).clip(0.3), y * rng.normal(1, 0.2, 400).clip(0.3)
    edges = [float(np.percentile(y, q)) for q in (25, 50, 75)]
    seg = lambda p: {n: {"mape": 20.0 + i, "n": 100 - i} for i, n in enumerate(["Q1", "Q2", "Q3", "Q4"])}
    cty = lambda d: {c: {"mape": 25.0 - d + i, "n": 50 + i} for i, c in enumerate(["Cork", "Dublin", "Galway"])}
    folds = {"hist_gradient_boosting": [27, 26, 28, 27, 26], "catboost": [26, 26, 27, 26, 25]}
    better = {m: [v - 4 for v in f] for m, f in folds.items()}
    texts = [
        fg.bars(tmp_path, [("a", 22.0, 21.0, False, True), ("b", 26.0, 25.0, False, False), ("c", 20.0, 19.0, True, False)], (26.7, 26.1)),
        fg.folds(tmp_path, folds, better), fg.within(tmp_path, y, p5, pe), fg.density(tmp_path, y, p5, pe),
        fg.confusion_pair(tmp_path, y, p5, pe, edges), fg.segments(tmp_path, seg(p5), seg(pe), cty(0), cty(3)), fg.bias(tmp_path, y, p5, pe),
    ]
    assert len(list(tmp_path.glob("*.png"))) == 7 and all(isinstance(t, str) and len(t) > 30 for t in texts)


def test_the_folds_title_does_not_claim_every_fold_when_one_got_worse(tmp_path):
    folds = {"hist_gradient_boosting": [27, 26, 28, 27, 26], "catboost": [26, 26, 27, 26, 25]}
    worse = {m: [v - 4 for v in f] for m, f in folds.items()}
    worse["catboost"][2] = 28
    assert "does not lower the error in every fold" in fg.folds(tmp_path, folds, worse)
