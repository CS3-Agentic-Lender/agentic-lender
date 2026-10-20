"""Tune the shortlisted models, add the equal-average ensemble, and freeze the winner on development data only.

Every rule (margin, tie band, shortlist, search spaces, simplicity order) is read from tuning_config.json, which was
committed before this code was written. Calibration and the final test are not read.

    prun --pull ml/reports ml/tune.py          # the full run on the PC
"""

import argparse
import json
import math
import random
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import numpy as np

from ml import benchmark as b

HERE = Path(__file__).resolve().parent
CONFIG = json.loads((HERE / "tuning_config.json").read_text())


def draw(space: dict, rng: random.Random) -> dict:
    """One random draw from a search space. Lists become tuples where scikit-learn wants them (hidden_layer_sizes)."""
    out = {}
    for name, spec in space.items():
        kind = spec["type"]
        if kind == "int":
            out[name] = rng.randint(spec["low"], spec["high"])
        elif kind == "loguniform":
            out[name] = float(math.exp(rng.uniform(math.log(spec["low"]), math.log(spec["high"]))))
        elif kind == "choice":
            out[name] = tuple(rng.choice(spec["values"]))
        else:
            raise ValueError(f"unknown space type {kind}")
    return out


def sample_trials(model: str, n: int, seed: int) -> list[dict]:
    rng = random.Random(f"{seed}|{model}")  # per-model stream, so adding a model never changes another's draws
    return [draw(CONFIG["spaces"][model], rng) for _ in range(n)]


def choose_winner(mape: dict, baseline: str = "baseline") -> dict:
    """Pick the winner from CV MAPE alone, by the rules in the config.

    mape: contender -> CV MAPE. Anything within the tie band of the best is tied and the simplest (config order) wins.
    The ensemble must beat the best single model by more than the tie band, which the same rule gives (it is last in the order).
    If no contender beats the baseline by the margin, the baseline ships."""
    margin, band, order = CONFIG["improvement_margin_mape_pp"], CONFIG["tie_band_mape_pp"], CONFIG["simplicity_order"]
    contenders = {k: v for k, v in mape.items() if k != baseline}
    best = min(contenders, key=contenders.get)
    if mape[baseline] - contenders[best] < margin:
        return {"winner": baseline, "reason": f"nothing beat the baseline ({mape[baseline]:.2f}%) by the {margin} point margin; "
                                              f"the best was {best} at {contenders[best]:.2f}%", "tied": []}
    tied = [k for k in contenders if contenders[k] - contenders[best] <= band]
    winner = min(tied, key=order.index)
    why = f"{winner} is the simplest of {len(tied)} contender(s) within {band} point(s) of the best ({best}, {contenders[best]:.2f}%)"
    return {"winner": winner, "reason": why, "tied": sorted(tied, key=order.index)}


def tune_model(model, X, y, fold_ids, bands, seed, n_trials):
    """Random search. Returns every trial's summary, the compute time, and the best trial's full result and OOF predictions."""
    trials, best, t_start = [], None, time.perf_counter()
    for i, params in enumerate(sample_trials(model, n_trials, seed), 1):
        t0 = time.perf_counter()
        res, _, oof = b.cross_validate(lambda p=params: b.make_model(model, seed, p), X, y, fold_ids, bands, return_oof=True)
        trials.append({"trial": i, "params": {k: list(v) if isinstance(v, tuple) else v for k, v in params.items()},
                       "cv_mape": res["cv_mape"], "fold_std": res["fold_std"], "seconds": time.perf_counter() - t0})
        if best is None or res["cv_mape"] < best[0]["cv_mape"]:
            best = (res, oof, trials[-1])
        print(f"  {model} trial {i}/{n_trials}: CV MAPE {res['cv_mape']:.2f}%", flush=True)
    return trials, time.perf_counter() - t_start, best


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--trials", type=int, default=CONFIG["trials_per_model"])  # fewer only for a quick smoke test
    ap.add_argument("--out", default=str(HERE / "reports"))
    args = ap.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    seed = CONFIG["seed"]
    df, y, split_info, manifest, n_kept = b.load_development(seed)
    X, fold_ids = df[b.FEATURE_COLUMNS], df["fold"].to_numpy()
    bands = [float(np.percentile(y, q)) for q in (25, 50, 75)]

    base, _ = b.cross_validate(lambda: b.MedianPerM2Baseline(), X, y, fold_ids, bands)
    results = {"baseline": base}
    oofs, tuned, defaults, compute = {}, {}, {}, {}
    for model in CONFIG["shortlist"]:
        print(f"{model}: defaults", flush=True)
        defaults[model], _ = b.cross_validate(lambda m=model: b.make_model(m, seed), X, y, fold_ids, bands)
        print(f"{model}: {args.trials} random trials", flush=True)
        trials, secs, (best_res, best_oof, best_trial) = tune_model(model, X, y, fold_ids, bands, seed, args.trials)
        compute[model] = {"trials": len(trials), "seconds": secs}
        tuned[model] = {"best_params": best_trial["params"], "best_trial": best_trial["trial"], "trials": trials}
        oofs[model] = best_oof
        results[f"{model} (tuned)"] = best_res
        results[f"{model} (defaults)"] = defaults[model]

    # equal-weight average of the three tuned models in log-price, from out-of-fold predictions: nothing is fitted
    mean_oof = np.exp(np.mean([np.log(oofs[m]) for m in CONFIG["shortlist"]], axis=0))
    fold_mape = [b.scores(y[fold_ids == k], mean_oof[fold_ids == k])["mape"] for k in sorted(set(fold_ids))]
    results["ensemble_mean"] = {"cv_mape": float(np.mean(fold_mape)), "fold_mape": fold_mape, "fold_std": float(np.std(fold_mape, ddof=1)),
                                "pooled": b.scores(y, mean_oof), "segments": b.segments(X, y, mean_oof, bands)}

    contender_mape = {"baseline": results["baseline"]["cv_mape"], "ensemble_mean": results["ensemble_mean"]["cv_mape"],
                      **{m: results[f"{m} (tuned)"]["cv_mape"] for m in CONFIG["shortlist"]}}
    decision = choose_winner(contender_mape)
    frozen = {"winner": decision["winner"], "reason": decision["reason"], "seed": seed,
              "margin_mape_pp": CONFIG["improvement_margin_mape_pp"], "tie_band_mape_pp": CONFIG["tie_band_mape_pp"],
              "params": tuned.get(decision["winner"], {}).get("best_params"),
              "members": CONFIG["shortlist"] if decision["winner"] == "ensemble_mean" else None,
              "member_params": {m: tuned[m]["best_params"] for m in CONFIG["shortlist"]} if decision["winner"] == "ensemble_mean" else None,
              "cv_mape": contender_mape[decision["winner"]], "baseline_cv_mape": contender_mape["baseline"]}
    (out / "tuning-results.json").write_text(json.dumps({"results": results, "tuned": tuned, "compute": compute, "decision": decision}, indent=1, sort_keys=True))
    (out / "frozen-model.json").write_text(json.dumps(frozen, indent=1, sort_keys=True))
    (out / "tuning-report.md").write_text(build_report(results, tuned, compute, decision, contender_mape, len(df)))
    print((out / "tuning-report.md").read_text()[:2500])


def build_report(results, tuned, compute, decision, contender_mape, n_dev) -> str:
    f = lambda v, nd=2: b.fmt(v, nd)
    rows = []
    for m in CONFIG["shortlist"]:
        d, t = results[f"{m} (defaults)"], results[f"{m} (tuned)"]
        rows.append(f"| {m} | {f(d['cv_mape'])} | {f(t['cv_mape'])} | {f(d['cv_mape'] - t['cv_mape'])} | {f(t['fold_std'])} | {f(t['pooled']['mdape'])} "
                    f"| {f(t['pooled']['ppe10'], 1)} | {f(t['pooled']['mae'], 0)} | {compute[m]['trials']} | {compute[m]['seconds']:.0f} s |")
    e = results["ensemble_mean"]
    rows.append(f"| ensemble_mean (equal average of the three tuned) | - | {f(e['cv_mape'])} | - | {f(e['fold_std'])} | {f(e['pooled']['mdape'])} "
                f"| {f(e['pooled']['ppe10'], 1)} | {f(e['pooled']['mae'], 0)} | - | - |")
    base = results["baseline"]
    params = "\n".join(f"- **{m}** (trial {tuned[m]['best_trial']}): `{json.dumps(tuned[m]['best_params'])}`" for m in CONFIG["shortlist"])
    total_trials, total_s = sum(c["trials"] for c in compute.values()), sum(c["seconds"] for c in compute.values())
    return "\n".join([
        "# Tuning and freezing the winner", "",
        f"Development data only ({n_dev:,} rows with a floor area, the same five group folds as the benchmark). Calibration and the final test were not read. "
        "The margin, tie rule, shortlist and search spaces were committed in `tuning_config.json` before any tuning ran.", "",
        "## Decision", "",
        f"**Winner: {decision['winner']}.** {decision['reason']}.", "",
        f"Rules (fixed beforehand): a model must beat the baseline ({f(base['cv_mape'])}% CV MAPE) by {CONFIG['improvement_margin_mape_pp']} points; "
        f"anything within {CONFIG['tie_band_mape_pp']} point of the best is tied and the simplest wins, in the order "
        f"{' < '.join(CONFIG['simplicity_order'])}.", "",
        "## Default versus tuned", "",
        "| Model | Defaults CV MAPE % | Tuned CV MAPE % | Gain (points) | Fold spread | MdAPE % | Within 10% | MAE € | Trials | Compute |",
        "|---|---|---|---|---|---|---|---|---|---|", *rows,
        f"| baseline | {f(base['cv_mape'])} | - | - | {f(base['fold_std'])} | {f(base['pooled']['mdape'])} | {f(base['pooled']['ppe10'], 1)} | {f(base['pooled']['mae'], 0)} | - | - |", "",
        f"{total_trials} trials ran in total ({total_trials * 5} model fits) in {total_s / 60:.1f} minutes of compute. "
        "A random search with this budget is not a guarantee of the best settings.", "",
        "**A caution on the tuned numbers.** Each tuned model is the best of its 50 trials, scored on the same folds that chose it, so its CV MAPE "
        "is slightly optimistic. The final test, which no trial has touched, gives the honest figure.", "",
        "## Best settings found", "", params, "",
        "## The ensemble", "",
        "An equal-weight average of the three tuned models' predictions in log-price, taken from their out-of-fold predictions (nothing fitted). "
        "It is an addition to the written plan, which lists seven single models. It ships three models instead of one and needs CatBoost in the app, "
        f"so it only wins by beating the best single model by more than {CONFIG['tie_band_mape_pp']} point.", "",
    ])


if __name__ == "__main__":
    main()
