"""Does training on development + calibration rows (about 80%) beat development only (about 60%)?

Rules come from more_rows_config.json, committed before this code. The same development rows are scored in both arms;
calibration rows are only ever training rows here, and the final test is not read.

    python ml/more_rows.py            # the Mac is fine: only CatBoost and HistGradientBoosting
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import numpy as np

from ml import benchmark as b
from ml import experiments as ex

HERE = Path(__file__).resolve().parent
CONFIG = json.loads((HERE / "more_rows_config.json").read_text())


def run(df, y, model, params, seed, extra_training: bool):
    """Score each development fold; train on the other development folds, plus the calibration rows if extra_training."""
    X, fold = df[b.FEATURE_COLUMNS + ex.EXTRA_COLUMNS], df["fold"].to_numpy()
    oof, fold_mape, scored = np.full(len(y), np.nan), [], fold >= 0
    for k in range(5):
        train = (fold != k) if extra_training else (fold != k) & scored
        test = fold == k
        est = b.make_model(model, seed, params, features=ex.FeatureBuilderV2(["eircode_routing_key"]))
        est.fit(X[train], y[train])
        oof[test] = est.predict(X[test])
        fold_mape.append(b.scores(y[test], oof[test])["mape"])
    s = b.scores(y[scored], oof[scored])
    signed = (oof[scored] - y[scored]) / y[scored]
    return {"cv_mape": float(np.mean(fold_mape)), "fold_mape": [float(m) for m in fold_mape], "train_rows_per_fold": int(((fold != 0) if extra_training else (fold > 0)).sum()),
            **{k: s[k] for k in ("mdape", "ppe10", "mae", "r2")}, "median_signed_error": float(np.median(signed))}


def decide(a, c) -> dict:
    """The committed rule: >= 0.3 points better in both models, better in >= 4 of 5 folds, median over/under within +-2%."""
    gain = {m: a[m]["cv_mape"] - c[m]["cv_mape"] for m in a}
    folds = {m: sum(x < y for x, y in zip(c[m]["fold_mape"], a[m]["fold_mape"])) for m in a}
    bias = {m: c[m]["median_signed_error"] for m in a}
    ok = all(g >= 0.3 for g in gain.values()) and all(n >= 4 for n in folds.values()) and all(abs(v) <= 0.02 for v in bias.values())
    return {"adopt": ok, "gain_pp": gain, "folds_improved": folds, "median_signed_error": bias}


def main():
    seed = CONFIG["seed"]
    df, y = ex.load_with_extras(seed, also=("calibration",))
    settings = ex.model_settings()
    arm_a, arm_b = {}, {}
    for m in CONFIG["models"]:
        arm_a[m] = run(df, y, m, settings[m], seed, False)
        arm_b[m] = run(df, y, m, settings[m], seed, True)
        print(f"{m}: 60% {arm_a[m]['cv_mape']:.2f}%  80% {arm_b[m]['cv_mape']:.2f}%  (train rows {arm_a[m]['train_rows_per_fold']} -> {arm_b[m]['train_rows_per_fold']})", flush=True)
    decision = decide(arm_a, arm_b)
    print("decision:", decision)
    out = HERE / "reports"
    (out / "more-rows-results.json").write_text(json.dumps({"arm_60": arm_a, "arm_80": arm_b, "decision": decision}, indent=1, sort_keys=True, default=float))


if __name__ == "__main__":
    main()
