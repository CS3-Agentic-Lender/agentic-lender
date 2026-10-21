"""Tune the v2 models on the 80% training rows, add the equal-average ensemble, and freeze the v2 winner.

Every rule (spaces, reference rule, tie band, simplicity order, bias check) is read from v2_tuning_config.json,
committed before this code. Only the development folds are scored. Calibration rows are training rows only and the final
test is not read.

    python ml/v2_tune.py              # full run, Mac is fine
    python ml/v2_tune.py --trials 2   # quick smoke test (writes nothing unless --out is given)
"""

import argparse
import json
import random
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import numpy as np

from ml import benchmark as b
from ml import experiments as ex
from ml.tune import draw

HERE = Path(__file__).resolve().parent
CONFIG = json.loads((HERE / "v2_tuning_config.json").read_text())
KEY = ["eircode_routing_key"]


def sample_trials(model: str, n: int, seed: int) -> list[dict]:
    rng = random.Random(f"v2|{seed}|{model}")  # per-model stream
    return [draw(CONFIG["spaces"][model], rng) for _ in range(n)]


def cv(df, y, model, params, seed):
    """Score the development folds; each fold trains on the other development folds plus all calibration rows (fold -1)."""
    X, fold = df[b.FEATURE_COLUMNS + ex.EXTRA_COLUMNS], df["fold"].to_numpy()
    oof, fold_mape, fit_s, scored = np.full(len(y), np.nan), [], [], fold >= 0
    for k in range(5):
        est = b.make_model(model, seed, params, features=ex.FeatureBuilderV2(KEY))
        t0 = time.perf_counter()
        est.fit(X[fold != k], y[fold != k])
        fit_s.append(time.perf_counter() - t0)
        oof[fold == k] = est.predict(X[fold == k])
        fold_mape.append(b.scores(y[fold == k], oof[fold == k])["mape"])
    return summarise(y[scored], oof[scored], fold_mape, fit_s), oof[scored]


def summarise(y, oof, fold_mape, fit_s=None):
    s = b.scores(y, oof)
    return {"cv_mape": float(np.mean(fold_mape)), "fold_mape": [float(m) for m in fold_mape], "fold_std": float(np.std(fold_mape, ddof=1)),
            **{k: s[k] for k in ("mdape", "ppe10", "mae", "r2")}, "median_signed_error": float(np.median((oof - y) / y)),
            "fit_s_per_fold": float(np.mean(fit_s)) if fit_s else None}


def pick_settings(model, tuned_mape, reference_mape):
    """Keep the v1 settings unless tuning beat them by at least min_gain_pp (0: any gain)."""
    return "tuned" if reference_mape - tuned_mape > CONFIG["reference"]["min_gain_pp"] else "v1"


def choose_winner(results: dict) -> dict:
    """results: contender -> {cv_mape, median_signed_error}. Exclude low/high estimators, tie within the band, simplest wins."""
    w = CONFIG["winner_rule"]
    ok = {k: v for k, v in results.items() if abs(v["median_signed_error"]) <= 0.02}
    if not ok:
        return {"winner": None, "reason": "every contender leans more than 2% high or low", "tied": []}
    best = min(ok, key=lambda k: ok[k]["cv_mape"])
    tied = [k for k in ok if ok[k]["cv_mape"] - ok[best]["cv_mape"] <= w["tie_band_mape_pp"]]
    winner = min(tied, key=w["simplicity_order"].index)
    return {"winner": winner, "tied": sorted(tied, key=w["simplicity_order"].index), "excluded_for_bias": sorted(set(results) - set(ok)),
            "reason": f"{winner} is the simplest of {len(tied)} contender(s) within {w['tie_band_mape_pp']} point(s) of the best ({best}, {ok[best]['cv_mape']:.2f}%)"}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--trials", type=int, default=CONFIG["trials_per_model"])
    ap.add_argument("--out", default=None)
    args = ap.parse_args()
    out = Path(args.out) if args.out else (HERE / "reports" if args.trials == CONFIG["trials_per_model"] else None)
    seed = CONFIG["seed"]
    df, y = ex.load_with_extras(seed, also=("calibration",))
    base = ex.model_settings()
    scored = df["fold"].to_numpy() >= 0
    chosen, oofs, tuned, final = {}, {}, {}, {}
    for m in CONFIG["models"]:
        v1 = base.get(m) or json.loads((HERE / "reports" / "tuning-results.json").read_text())["tuned"][m]["best_params"]
        v1 = {k: tuple(v) if isinstance(v, list) else v for k, v in v1.items()}
        ref = CONFIG["reference"].get(m)
        ref_res, ref_oof = cv(df, y, m, v1, seed)
        ref = ref_res["cv_mape"]  # re-measured, so every number is on the same rows
        print(f"{m}: v1 settings {ref:.2f}%", flush=True)
        best, trials = None, []
        for i, p in enumerate(sample_trials(m, args.trials, seed), 1):
            res, oof = cv(df, y, m, p, seed)
            trials.append({"trial": i, "params": {k: list(v) if isinstance(v, tuple) else v for k, v in p.items()}, "cv_mape": res["cv_mape"]})
            if best is None or res["cv_mape"] < best[0]["cv_mape"]:
                best = (res, oof, p, i)
            print(f"  {m} trial {i}/{args.trials}: {res['cv_mape']:.2f}%", flush=True)
        use = pick_settings(m, best[0]["cv_mape"], ref)
        chosen[m] = {"settings": "tuned" if use == "tuned" else "v1", "params": best[2] if use == "tuned" else v1, "trial": best[3], "tuned_cv_mape": best[0]["cv_mape"], "v1_cv_mape": ref}
        final[m], oofs[m] = (best[0], best[1]) if use == "tuned" else (ref_res, ref_oof)
        tuned[m] = trials
    # equal-weight average in log-price from the chosen models' out-of-fold predictions
    mean = np.exp(np.mean([np.log(oofs[m]) for m in CONFIG["models"]], axis=0))
    fold = df["fold"].to_numpy()[scored]
    final["ensemble_mean"] = summarise(y[scored], mean, [b.scores(y[scored][fold == k], mean[fold == k])["mape"] for k in range(5)])
    decision = choose_winner(final)
    print("winner:", decision, flush=True)
    jp = lambda p: {k: list(v) if isinstance(v, tuple) else v for k, v in p.items()}
    frozen = {"winner": decision["winner"], "reason": decision["reason"], "seed": seed, "training_rows": "development + calibration (80%)",
              "inputs": "five inputs + Eircode routing key", "cv_mape": final[decision["winner"]]["cv_mape"] if decision["winner"] else None,
              "members": CONFIG["models"] if decision["winner"] == "ensemble_mean" else [decision["winner"]],
              "params": {m: jp(chosen[m]["params"]) for m in (CONFIG["models"] if decision["winner"] == "ensemble_mean" else [decision["winner"]])}}
    if out:
        out.mkdir(parents=True, exist_ok=True)
        (out / "v2-tuning-results.json").write_text(json.dumps({"final": final, "chosen": {m: {**c, "params": jp(c["params"])} for m, c in chosen.items()}, "trials": tuned, "decision": decision}, indent=1, sort_keys=True, default=float))
        (out / "v2-frozen-model.json").write_text(json.dumps(frozen, indent=1, sort_keys=True, default=float))
        (out / "v2-tuning-report.md").write_text(build_report(final, chosen, decision))
        print((out / "v2-tuning-report.md").read_text())


def build_report(final, chosen, decision) -> str:
    f = lambda v, nd=2: f"{v:.{nd}f}"
    rows = [f"| {k} | {f(v['cv_mape'])} | {f(v['mdape'])} | {f(v['ppe10'], 1)} | €{v['mae']:,.0f} | {f(v['r2'], 3)} | {100 * v['median_signed_error']:+.1f}% | {f(v['fold_std'])} |" for k, v in final.items()]
    sets = [f"| {m} | {f(c['v1_cv_mape'])} | {f(c['tuned_cv_mape'])} | {f(c['v1_cv_mape'] - c['tuned_cv_mape'])} | {c['settings']} |" for m, c in chosen.items()]
    return "\n".join([
        "# v2 tuning on the 80% training rows", "",
        "Scored on the 4,882 development rows in the same five group folds; calibration rows were training rows only and the final test was not read. "
        "Rules are in `v2_tuning_config.json`, committed before this ran.", "",
        f"## Winner: {decision['winner']}", "", decision["reason"] + ".", "",
        "## Did tuning beat the v1 settings?", "", "A tuned model replaces the v1 settings if it has a lower CV MAPE.", "",
        "| Model | v1 settings CV MAPE % | Best of the trials % | Gain | Settings used |", "|---|---|---|---|---|", *sets, "",
        "## All contenders (with the settings used)", "",
        "| Contender | CV MAPE % | MdAPE % | Within 10% | Average miss | R² | Median over/under | Fold spread |", "|---|---|---|---|---|---|---|---|", *rows, "",
        "Each tuned figure is the best of its trials scored on the same folds that chose it, so it is slightly optimistic. The final test gives the honest figure.", "",
    ])


if __name__ == "__main__":
    main()
