"""Set the v2 "price needs review" threshold and price range, fit and save the v2 model, then score the final test ONCE.

Every rule comes from v2_final_config.json, committed before this code. The v2 model trains on the development and the
calibration rows, so the threshold and the range come from out-of-fold predictions on the development rows (each house
predicted by a model that never saw it), never from the calibration rows. They are written to v2-threshold.json before
the final test split is predicted. A lock stops a second run.

    python ml/v2_final.py             # Mac is fine: one fit of three models and five out-of-fold fits
"""

import argparse
import csv
import hashlib
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import joblib
import numpy as np
import pandas as pd
from scipy.stats import spearmanr
from sklearn.metrics import roc_auc_score, roc_curve

from ml import benchmark as b
from ml import data_readiness as dr
from ml import experiments as ex
from ml import split
from ml import v2_model as v2
from ml.final_eval import QUANTILE_METHOD, derive_threshold, distribution, gaps, needs_review

HERE = Path(__file__).resolve().parent
CONFIG = json.loads((HERE / "v2_final_config.json").read_text())
LOCK_FILE = Path(CONFIG["final_exam"]["lock_file"]).name
RANGE_LOW, RANGE_HIGH = 10, 90  # the 80% range: 10th and 90th percentile of the gap within each estimate band
BAND_CUTS = (25, 50, 75)
ROC_CUTS = (50, 75, 90)
RELOAD_TOLERANCE = 1e-9
REFERENCE_ROWS = 200


# ---- the price range -----------------------------------------------------------------------

def derive_range(asking, estimate) -> dict:
    """Four bands at the quartiles of the estimates; in each band the 10th and 90th percentile of the gap g."""
    asking, estimate = np.asarray(asking, float), np.asarray(estimate, float)
    edges = [float(np.percentile(estimate, q, method=QUANTILE_METHOD)) for q in BAND_CUTS]
    band = np.digitize(estimate, edges)
    g = gaps(asking, estimate)
    out = []
    for k in range(len(edges) + 1):
        gk = g[band == k]
        out.append({"low_gap": float(np.percentile(gk, RANGE_LOW, method=QUANTILE_METHOD)),
                    "high_gap": float(np.percentile(gk, RANGE_HIGH, method=QUANTILE_METHOD)), "rows": int(len(gk))})
    return {"edges": edges, "bands": out}


def apply_range(estimate, rng: dict):
    """(low, high) euro range for each estimate: the estimate times (1 + the band's 10th and 90th percentile gap)."""
    estimate = np.asarray(estimate, float)
    band = np.digitize(estimate, rng["edges"])
    low = np.array([rng["bands"][k]["low_gap"] for k in band])
    high = np.array([rng["bands"][k]["high_gap"] for k in band])
    return estimate * (1 + low), estimate * (1 + high)


def coverage(asking, estimate, rng: dict) -> dict:
    """Share of asking prices inside their range, overall and per estimate band, and the median width as a share of the estimate."""
    asking, estimate = np.asarray(asking, float), np.asarray(estimate, float)
    low, high = apply_range(estimate, rng)
    inside = (asking >= low) & (asking <= high)
    band = np.digitize(estimate, rng["edges"])
    return {"overall": float(inside.mean()), "by_band": [float(inside[band == k].mean()) if (band == k).any() else None for k in range(len(rng["edges"]) + 1)],
            "rows_by_band": [int((band == k).sum()) for k in range(len(rng["edges"]) + 1)],
            "median_width_share": float(np.median((high - low) / estimate))}


# ---- metrics ---------------------------------------------------------------------------------

def overall(y, p) -> dict:
    s = b.scores(y, p)
    s["rmse"] = float(np.sqrt(np.mean((np.asarray(p, float) - np.asarray(y, float)) ** 2)))
    s["median_signed_error"] = float(np.median((np.asarray(p, float) - np.asarray(y, float)) / np.asarray(y, float)))
    return s


def roc_view(dev_prices, y_test, estimate) -> dict:
    """The estimate as a score for 'is the asking price above the development Nth percentile?'. Cutoffs from development prices only."""
    out = {}
    for q in ROC_CUTS:
        cut = float(np.percentile(dev_prices, q))
        label = np.asarray(y_test) > cut
        fpr, tpr, _ = roc_curve(label, estimate)
        out[f"p{q}"] = {"cutoff_eur": cut, "auc": float(roc_auc_score(label, estimate)), "positive_share": float(label.mean()),
                        "fpr": [float(v) for v in np.interp(np.linspace(0, 1, 101), fpr, fpr)],
                        "tpr": [float(v) for v in np.interp(np.linspace(0, 1, 101), fpr, tpr)]}
    return out


def band_confusion(y, p, edges) -> list:
    """Rows are the real price band, columns the band the model chose. Counts."""
    real, chosen = np.digitize(y, edges), np.digitize(p, edges)
    m = np.zeros((len(edges) + 1, len(edges) + 1), int)
    for a, c in zip(real, chosen):
        m[a, c] += 1
    return m.tolist()


# ---- data --------------------------------------------------------------------------------------

def load_test(seed: int):
    """Final-test rows with a floor area: the app inputs plus the Eircode routing key, and the asking price. Called once."""
    with dr.CSV_PATH.open(newline="", encoding="utf-8") as f:
        raw = list(csv.DictReader(f))
    kept, _, _ = dr.classify(raw)
    where = split.partition(kept, seed, tuple(b.CONFIG["shares"]))
    rows = [r for r in kept if where[r["source_row"]] == "test"]
    usable = [r for r in rows if r["floor_area_m2"] is not None]
    X = pd.DataFrame(usable)[["source_row", *b.FEATURE_COLUMNS]]
    X["rkey"] = [ex.routing_key(raw[r["source_row"] - 1]["Title"]) for r in usable]
    return X[v2.INPUT_COLUMNS], np.array([r["price_eur"] for r in usable], float), {"rows": len(rows), "no_area": len(rows) - len(usable)}


def out_of_fold(X, y, fold, frozen, seed):
    """Each development fold predicted by a model trained on the other four folds plus all calibration rows (fold -1)."""
    oof = np.full(len(y), np.nan)
    for k in range(5):
        model = v2.build(frozen, seed)
        model.fit(X[fold != k], y[fold != k])
        oof[fold == k] = model.predict(X[fold == k])
        print(f"  fold {k + 1}/5 done", flush=True)
    scored = fold >= 0
    return oof[scored], scored


def file_sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def reload_check(model, path: Path, X_reference) -> dict:
    """Save, reload, predict the fixed reference rows with both: the maximum relative difference must be within the tolerance."""
    joblib.dump(model, path, compress=3)
    loaded = joblib.load(path)  # a file this function has just written itself, not untrusted input
    a, c = model.predict(X_reference), loaded.predict(X_reference)
    worst = float(np.max(np.abs(a - c) / np.abs(a)))
    return {"reference_rows": int(len(X_reference)), "max_relative_difference": worst, "tolerance": RELOAD_TOLERANCE, "passed": worst <= RELOAD_TOLERANCE,
            "sha256": file_sha256(path), "bytes": path.stat().st_size}


# ---- the run -----------------------------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--reports", default=str(HERE / "reports"))
    ap.add_argument("--artifacts", default=str(HERE / "artifacts"))
    args = ap.parse_args()
    reports, artifacts = Path(args.reports), Path(args.artifacts)
    if (reports / LOCK_FILE).exists():
        sys.exit(f"The v2 final test was already scored ({reports / LOCK_FILE}). It is scored once; nothing may change after it.")
    reports.mkdir(parents=True, exist_ok=True)
    artifacts.mkdir(parents=True, exist_ok=True)
    seed = CONFIG["seed"]
    frozen = json.loads((HERE / CONFIG["model"]["file"]).read_text())

    df, y_all = ex.load_with_extras(seed, also=("calibration",))
    X_all, fold = df[v2.INPUT_COLUMNS], df["fold"].to_numpy()
    scored = fold >= 0
    print(f"{int(scored.sum()):,} development rows, {int((~scored).sum()):,} calibration rows used as training only", flush=True)

    # 1. the threshold and the range come from out-of-fold development predictions, never from the calibration rows
    t0 = time.perf_counter()
    oof, scored = out_of_fold(X_all, y_all, fold, frozen, seed)
    y_dev = y_all[scored]
    oof_cv = float(np.mean([b.scores(y_dev[fold[scored] == k], oof[fold[scored] == k])["mape"] for k in range(5)]))
    print(f"out-of-fold CV MAPE {oof_cv:.2f}% (frozen file says {frozen['cv_mape']:.2f}%), {time.perf_counter() - t0:.0f} s", flush=True)
    t = derive_threshold(y_dev, oof)
    rng = derive_range(y_dev, oof)
    threshold = {"threshold": t, "rule": "asking_price / estimate - 1 > threshold means price needs review", "gap": CONFIG["gap"], "quantile": 0.90,
                 "quantile_method": QUANTILE_METHOD, "set_on": "out-of-fold predictions on the development rows", "rows": int(len(y_dev)), "seed": seed,
                 "model": "v2 ensemble_mean", "oof_flag_rate": float(needs_review(y_dev, oof, t).mean()), "oof_cv_mape": oof_cv,
                 "oof_gap_distribution": distribution(gaps(y_dev, oof)), "price_range": {"target_coverage": 0.8, **rng},
                 "range_coverage_oof": coverage(y_dev, oof, rng)}
    (reports / "v2-threshold.json").write_text(json.dumps(threshold, indent=1, sort_keys=True))
    print(f"threshold {t:.4f}, range bands {[(round(x['low_gap'], 3), round(x['high_gap'], 3)) for x in rng['bands']]}", flush=True)

    # 2. fit the shipped model once on the 80%, save it, prove it reloads to the same predictions
    t0 = time.perf_counter()
    model = v2.build(frozen, seed).fit(X_all, y_all)
    fit_s = time.perf_counter() - t0
    ref_idx = np.random.default_rng(seed).choice(np.where(scored)[0], size=REFERENCE_ROWS, replace=False)
    reload = reload_check(model, artifacts / "v2-pipeline.joblib", X_all.iloc[ref_idx])
    print(f"fitted in {fit_s:.1f} s; reload max relative difference {reload['max_relative_difference']:.2e}", flush=True)
    if not reload["passed"]:
        sys.exit("The saved model does not reload to the same predictions; stopping before the final test is read.")

    # 3. the final test, once
    X_test, y_test, counts = load_test(seed)
    t0 = time.perf_counter()
    pred = model.predict(X_test)
    predict_s = time.perf_counter() - t0
    dev_bands = [float(np.percentile(y_dev, q)) for q in BAND_CUTS]
    flags = needs_review(y_test, pred, t)
    base = b.MedianPerM2Baseline().fit(X_all[scored][b.FEATURE_COLUMNS], y_dev)
    v1 = json.loads((reports / "final-test-results.json").read_text())
    result = {
        "overall": overall(y_test, pred), "test_rows": int(len(y_test)), "test_rows_without_area": counts["no_area"],
        "threshold": t, "flag_rate": float(flags.mean()), "gap_distribution": distribution(gaps(y_test, pred)),
        "range_coverage": coverage(y_test, pred, rng), "dev_price_bands": dev_bands,
        "price_band_confusion": band_confusion(y_test, pred, dev_bands),
        "roc": roc_view(y_dev, y_test, pred), "spearman": float(spearmanr(y_test, pred).statistic),
        "segments": b.segments(X_test, y_test, pred, dev_bands),
        "development_cv_mape": frozen["cv_mape"], "oof_cv_mape": oof_cv,
        "baseline_reference": b.scores(y_test, base.predict(X_test[b.FEATURE_COLUMNS])), "v1_reference": v1["overall"],
        "model": "v2 ensemble_mean", "members": frozen["members"], "fit_s": fit_s, "predict_ms_per_1000": predict_s / len(y_test) * 1e6, "saved_model": reload,
    }
    (reports / "v2-final-test-results.json").write_text(json.dumps(result, indent=1, sort_keys=True))
    np.savez_compressed(artifacts / "v2-final-arrays.npz", y_test=y_test, pred_test=pred, y_dev=y_dev, oof_dev=oof)
    (reports / LOCK_FILE).write_text(build_lock_report(result, threshold, len(y_dev)))
    print((reports / LOCK_FILE).read_text())


def pct(v, nd=1):
    return f"{100 * v:.{nd}f}%"


def build_lock_report(r, th, n_dev) -> str:
    o, base, v1 = r["overall"], r["baseline_reference"], r["v1_reference"]
    gap = "\n".join(f"| {p} | {pct(r['gap_distribution'][p])} | {pct(th['oof_gap_distribution'][p])} |" for p in r["gap_distribution"])
    delta = o["mape"] - r["development_cv_mape"]
    verdict = ("The test MAPE is more than 2 points above the development figure, so the selection on the development folds was optimistic."
               if delta > 2 else "The test MAPE is within 2 points of the development figure, so the development scores held up.")
    return "\n".join([
        "# v2 final test (scored once)", "",
        f"The frozen v2 model (average of {', '.join(r['members'])}) was fitted once on the development and calibration rows with a floor area. "
        f"The threshold and the price range were set from out-of-fold predictions on the {n_dev:,} development rows and written to `v2-threshold.json` "
        f"before the {r['test_rows']:,} final test rows were predicted. Rows without a floor area ({r['test_rows_without_area']:,}) cannot be predicted, because the app always sends an area.", "",
        "| | v2 | v1 (same test rows) | Baseline |", "|---|---|---|---|",
        f"| MAPE | **{o['mape']:.2f}%** | {v1['mape']:.2f}% | {base['mape']:.2f}% |", f"| MdAPE | {o['mdape']:.2f}% | {v1['mdape']:.2f}% | {base['mdape']:.2f}% |",
        f"| Within 10% | {o['ppe10']:.1f}% | {v1['ppe10']:.1f}% | {base['ppe10']:.1f}% |", f"| MAE | €{o['mae']:,.0f} | €{v1['mae']:,.0f} | €{base['mae']:,.0f} |",
        f"| R² | {o['r2']:.3f} | {v1['r2']:.3f} | {base['r2']:.3f} |", "",
        f"Development CV for v2 was {r['development_cv_mape']:.2f}%; the final test is {o['mape']:.2f}% ({delta:+.2f} points). {verdict}", "",
        "## Price needs review and the price range", "",
        f"Threshold **{pct(th['threshold'])}** (90th percentile of asking / estimate - 1 on the out-of-fold development predictions). The flag fired on **{pct(r['flag_rate'])}** of the test rows "
        f"(development: {pct(th['oof_flag_rate'])}). The 80% price range held **{pct(r['range_coverage']['overall'])}** of the asking prices (development: {pct(th['range_coverage_oof']['overall'])}).", "",
        "| Gap percentile | Final test | Development (out-of-fold) |", "|---|---|---|", gap, "",
        "## Nothing changes after this", "",
        "The model, features, threshold and range are frozen. Rerunning `v2_final.py` is refused while this report exists.", "",
    ])


if __name__ == "__main__":
    main()
