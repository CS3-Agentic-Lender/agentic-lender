"""Set the "price needs review" threshold on the calibration split, then score the final test split ONCE.

The frozen model (frozen-model.json) is fitted on the development split only. The threshold comes from the calibration
split only. The final test is read last, scored once, and a lock stops it being scored again: nothing (model, feature or
threshold) may change after the final test has been run.

    prun --pull ml/reports --pull ml/artifacts ml/final_eval.py
"""

import argparse
import csv
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import joblib
import numpy as np
import pandas as pd

from ml import benchmark as b
from ml import data_readiness as dr
from ml import split

HERE = Path(__file__).resolve().parent
QUANTILE = 0.90
QUANTILE_METHOD = "linear"  # numpy's default, the same as the usual (type 7) sample quantile
GAP_PERCENTILES = [5, 10, 25, 50, 75, 90, 95]
LOCK_FILE = "final-test-report.md"


def gaps(asking, estimate) -> np.ndarray:
    """Signed gap g = asking price / estimate - 1, from the unrounded estimate. A price below the estimate is a negative gap."""
    return np.asarray(asking, float) / np.asarray(estimate, float) - 1


def derive_threshold(asking, estimate) -> float:
    """t = max(0, 90th percentile of g). Called with calibration data only."""
    return max(0.0, float(np.quantile(gaps(asking, estimate), QUANTILE, method=QUANTILE_METHOD)))


def needs_review(asking, estimate, t: float):
    """Price needs review when g is strictly above t. Equality does not trigger it."""
    return gaps(asking, estimate) > t


def distribution(g) -> dict:
    return {f"p{p}": float(np.percentile(g, p)) for p in GAP_PERCENTILES}


def load_partitions(seed: int) -> dict:
    """Rows with a floor area, per partition, as (features, price). The other rows cannot be predicted: the app always sends an area."""
    with dr.CSV_PATH.open(newline="", encoding="utf-8") as f:
        kept, _, _ = dr.classify(list(csv.DictReader(f)))
    where = split.partition(kept, seed, tuple(b.CONFIG["shares"]))
    out = {}
    for part in split.PARTITIONS:
        rows = [r for r in kept if where[r["source_row"]] == part]
        usable = [r for r in rows if r["floor_area_m2"] is not None]
        out[part] = {"X": pd.DataFrame(usable)[b.FEATURE_COLUMNS], "y": np.array([r["price_eur"] for r in usable], float),
                     "rows": len(rows), "no_area": len(rows) - len(usable)}
    return out


def frozen_model(seed: int):
    frozen = json.loads((HERE / "reports" / "frozen-model.json").read_text())
    if frozen["winner"] in ("baseline", "ensemble_mean"):
        raise NotImplementedError(f"final_eval handles single frozen models only, not {frozen['winner']}")
    params = {k: tuple(v) if isinstance(v, list) else v for k, v in (frozen["params"] or {}).items()}
    return frozen, b.make_model(frozen["winner"], seed, params)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--reports", default=str(HERE / "reports"))
    ap.add_argument("--artifacts", default=str(HERE / "artifacts"))
    args = ap.parse_args()
    reports, artifacts = Path(args.reports), Path(args.artifacts)
    if (reports / LOCK_FILE).exists():
        sys.exit(f"The final test was already scored ({reports / LOCK_FILE}). It is scored once; nothing may change after it.")
    reports.mkdir(parents=True, exist_ok=True)
    artifacts.mkdir(parents=True, exist_ok=True)
    seed = b.CONFIG["seed"]
    parts = load_partitions(seed)
    dev, cal, test = parts["development"], parts["calibration"], parts["test"]
    frozen, model = frozen_model(seed)

    # 1. fit on development only
    t0 = time.perf_counter()
    model.fit(dev["X"], dev["y"])
    fit_s = time.perf_counter() - t0
    joblib.dump(model, artifacts / "valuation-pipeline.joblib", compress=3)

    # 2. the threshold comes from calibration only, and is written down before the test split is predicted
    cal_pred = model.predict(cal["X"])
    t = derive_threshold(cal["y"], cal_pred)
    cal_gaps = gaps(cal["y"], cal_pred)
    threshold = {"threshold": t, "rule": "asking_price / estimate - 1 > threshold means price needs review",
                 "gap": "g = asking_price / estimate - 1, from the unrounded estimate", "quantile": QUANTILE,
                 "quantile_method": QUANTILE_METHOD, "calibration_rows": int(len(cal["y"])), "model": frozen["winner"],
                 "model_params": frozen["params"], "seed": seed, "calibration_flag_rate": float(needs_review(cal["y"], cal_pred, t).mean()),
                 "calibration_gap_distribution": distribution(cal_gaps)}
    (reports / "threshold.json").write_text(json.dumps(threshold, indent=1, sort_keys=True))
    print(f"threshold {t:.4f} from {len(cal['y'])} calibration rows", flush=True)

    # 3. the final test, once
    test_pred = model.predict(test["X"])
    dev_bands = [float(np.percentile(dev["y"], q)) for q in (25, 50, 75)]
    result = {
        "overall": b.scores(test["y"], test_pred), "threshold": t, "test_rows": int(len(test["y"])),
        "flag_rate": float(needs_review(test["y"], test_pred, t).mean()), "gap_distribution": distribution(gaps(test["y"], test_pred)),
        "segments": b.segments(test["X"], test["y"], test_pred, dev_bands), "model": frozen["winner"], "development_cv_mape": frozen["cv_mape"],
        "baseline_reference": None,
    }
    base = b.MedianPerM2Baseline().fit(dev["X"], dev["y"])  # reference only, fitted on development, nothing here changes
    result["baseline_reference"] = b.scores(test["y"], base.predict(test["X"]))
    (reports / "final-test-results.json").write_text(json.dumps(result, indent=1, sort_keys=True))
    (reports / LOCK_FILE).write_text(build_report(result, threshold, dev, cal, test, fit_s))
    print((reports / LOCK_FILE).read_text()[:2500])


def pct(v, nd=1):
    return f"{100 * v:.{nd}f}%"


def build_report(r, th, dev, cal, test, fit_s) -> str:
    o, base = r["overall"], r["baseline_reference"]
    weak = sorted(((n, s) for n, s in r["segments"]["county"].items() if s["n"] >= 20), key=lambda kv: -kv[1]["mape"])[:5]
    gap_rows = "\n".join(f"| {p} | {pct(r['gap_distribution'][p])} | {pct(th['calibration_gap_distribution'][p])} |" for p in r["gap_distribution"])
    lines = [
        "# Calibration threshold and final test", "",
        f"The frozen model ({r['model']}) was fitted once on the development split ({len(dev['y']):,} rows with a floor area, {fit_s:.1f} s). "
        f"The threshold was set on the calibration split ({th['calibration_rows']:,} rows) and written to `threshold.json` before the final test split "
        f"({r['test_rows']:,} rows) was predicted. The final test was scored once. Rows with no floor area ({test['no_area']:,} in the test split) cannot be "
        "predicted, because the app always sends an area.", "",
        "## The threshold", "",
        f"Signed gap `g = asking price / estimate - 1` (unrounded estimate), threshold `t = max(0, 90th percentile of g)` = **{pct(th['threshold'])}**, "
        f"from {th['calibration_rows']:,} calibration properties (quantile method: {th['quantile_method']}). "
        "At inference, `asking / estimate - 1 > t` means **price needs review**. Equality does not trigger it, and an asking price below the estimate is never a flag.", "",
        "## The final test (scored once)", "",
        "| | Frozen model | Baseline (reference) |", "|---|---|---|",
        f"| MAPE | **{o['mape']:.2f}%** | {base['mape']:.2f}% |", f"| MdAPE | {o['mdape']:.2f}% | {base['mdape']:.2f}% |",
        f"| Within 10% | {o['ppe10']:.1f}% | {base['ppe10']:.1f}% |", f"| MAE | €{o['mae']:,.0f} | €{base['mae']:,.0f} |",
        f"| R² | {o['r2']:.3f} | {base['r2']:.3f} |", "",
        f"On the development folds the same model scored {r['development_cv_mape']:.2f}% CV MAPE. The final test is the figure that was never chosen on, "
        "so it is the honest one. This measures how well asking prices are predicted within a 2024 listing sample, nothing more.", "",
        "## Price needs review", "",
        f"The flag fired on **{pct(r['flag_rate'])}** of the test properties (calibration: {pct(th['calibration_flag_rate'])}, about 10% by construction). "
        "This is a heuristic from historical asking-price gaps, not proof that a property is overpriced and not a guaranteed 10% rate in the future.", "",
        "| Gap percentile | Final test | Calibration |", "|---|---|---|", gap_rows, "",
        "## Weakest segments (final test)", "",
        "Counties with at least 20 test rows, worst MAPE first. Price bands are the development quartiles.", "",
        "| County | Rows | MAPE % | MdAPE % | Within 10% |", "|---|---|---|---|---|",
        *[f"| {n} | {s['n']} | {s['mape']:.1f} | {s['mdape']:.1f} | {s['ppe10']:.1f} |" for n, s in weak], "",
        b_table("Property type", r["segments"]["property_type"]), "", b_table("Price band", r["segments"]["price_band"]), "",
        "## Nothing changes after this", "",
        "The model, its features and the threshold are frozen. Rerunning this script is refused while this report exists. A different model or "
        "threshold would be a new version with its own evaluation.", "",
    ]
    return "\n".join(lines)


def b_table(title, seg) -> str:
    rows = [f"| {n} | {s['n']:,} | {s['mape']:.1f} | {s['mdape']:.1f} | {s['ppe10']:.1f} |" for n, s in seg.items()]
    return "\n".join([f"| {title} | Rows | MAPE % | MdAPE % | Within 10% |", "|---|---|---|---|---|", *rows])


if __name__ == "__main__":
    main()
