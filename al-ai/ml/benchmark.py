"""Baseline and candidate model benchmark with group-aware cross-validation, as laid out in the valuation plan.

Only the development partition (60%) is read here. Calibration and the final test stay untouched.
Every model sees the same five group folds, the same features and the same seed, so a second run gives the same numbers.

    uv run python ml/benchmark.py --models ridge,knn --out /tmp/bench   # quick local try
    prun --pull ml/reports ml/benchmark.py                              # the full run on the PC
"""

import argparse
import csv
import hashlib
import json
import platform
import sys
import time
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))  # so `from ml import ...` works when run as a script

import numpy as np
import pandas as pd
import sklearn
from sklearn.base import BaseEstimator, TransformerMixin
from sklearn.compose import ColumnTransformer, TransformedTargetRegressor
from sklearn.ensemble import HistGradientBoostingRegressor, RandomForestRegressor
from sklearn.linear_model import Ridge
from sklearn.metrics import r2_score
from sklearn.neighbors import KNeighborsRegressor
from sklearn.neural_network import MLPRegressor
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

from ml import data_readiness as dr
from ml import split

HERE = Path(__file__).resolve().parent
CONFIG = json.loads((HERE / "benchmark_config.json").read_text())
COUNTIES, TYPES = sorted(dr.REPUBLIC_COUNTIES), list(dr.SUPPORTED_TYPES)
BER_ORDER = "ABCDEFG"  # A is the best band; Unknown gets an indicator column and a training-median fill
FEATURE_COLUMNS = ["county", "property_type", "bedrooms", "floor_area_m2", "ber"]


class FeatureBuilder(BaseEstimator, TransformerMixin):
    """Five app inputs in, numbers out: area, bedrooms, ordered BER + unknown flag, one-hot county and type.
    Unsupported counties, types and BER values raise, so nothing is silently turned into a supported category."""

    def fit(self, X, y=None):
        known = [BER_ORDER.index(b) + 1 for b in X["ber"] if b != dr.BER_UNKNOWN]
        self.ber_fill_ = float(np.median(known)) if known else 4.0  # from training rows only
        return self

    def transform(self, X):
        for col, allowed in (("county", COUNTIES), ("property_type", TYPES), ("ber", [*BER_ORDER, dr.BER_UNKNOWN])):
            bad = set(X[col]) - set(allowed)
            if bad:
                raise ValueError(f"unsupported {col}: {sorted(bad)}")
        unknown = (X["ber"] == dr.BER_UNKNOWN).to_numpy()
        ber = np.where(unknown, self.ber_fill_, [BER_ORDER.find(b) + 1 for b in X["ber"]])
        num = np.column_stack([X["floor_area_m2"], X["bedrooms"], ber, unknown.astype(float)])
        one_hot = lambda col, cats: (X[col].to_numpy()[:, None] == np.array(cats)[None, :]).astype(float)
        return np.hstack([num, one_hot("county", COUNTIES), one_hot("property_type", TYPES)])


def make_model(name: str, seed: int, params: dict | None = None):
    """Default settings (or the given overrides), a fixed seed, and the target modelled as log(price) then back to euro."""
    scale = ColumnTransformer([("num", StandardScaler(), [0, 1, 2])], remainder="passthrough")  # area, bedrooms, BER
    if name == "ridge":
        est, scaled = Ridge(), True
    elif name == "knn":
        est, scaled = KNeighborsRegressor(), True
    elif name == "mlp":
        est, scaled = MLPRegressor(random_state=seed, max_iter=500), True
    elif name == "random_forest":
        est, scaled = RandomForestRegressor(random_state=seed, n_jobs=-1), False
    elif name == "hist_gradient_boosting":
        est, scaled = HistGradientBoostingRegressor(random_state=seed), False
    elif name == "xgboost":
        from xgboost import XGBRegressor
        est, scaled = XGBRegressor(random_state=seed, n_jobs=-1), False
    elif name == "catboost":
        from catboost import CatBoostRegressor
        est, scaled = CatBoostRegressor(random_seed=seed, verbose=0, allow_writing_files=False), False
    else:
        raise ValueError(f"unknown model {name}")
    if params:
        est.set_params(**params)
    steps = [("features", FeatureBuilder())] + ([("scale", scale)] if scaled else []) + [("model", est)]
    return TransformedTargetRegressor(Pipeline(steps), func=np.log, inverse_func=np.exp, check_inverse=False)


class MedianPerM2Baseline:
    """Training-fold median price per m2 for county and type, times area. Falls back to county, then to everything."""

    def fit(self, X, y):
        ppm = pd.Series(np.asarray(y) / X["floor_area_m2"].to_numpy(), index=X.index)
        self.cell_ = ppm.groupby([X["county"], X["property_type"]]).median().to_dict()
        self.county_ = ppm.groupby(X["county"]).median().to_dict()
        self.global_ = float(ppm.median())
        self.fallbacks = Counter()
        return self

    def predict(self, X):
        out = []
        for c, t, a in zip(X["county"], X["property_type"], X["floor_area_m2"]):
            if (c, t) in self.cell_:
                ppm, level = self.cell_[(c, t)], "cell"
            elif c in self.county_:
                ppm, level = self.county_[c], "county"
            else:
                ppm, level = self.global_, "global"
            self.fallbacks[level] += 1
            out.append(ppm * a)
        return np.array(out)


def scores(y, p) -> dict:
    """All errors are on the euro price. MAPE is the ranking number."""
    y, p = np.asarray(y, float), np.asarray(p, float)
    if len(y) == 0:
        return {"n": 0, "mape": None, "mdape": None, "ppe10": None, "mae": None, "r2": None}
    ape = np.abs(p - y) / y
    return {
        "n": int(len(y)), "mape": float(ape.mean() * 100), "mdape": float(np.median(ape) * 100),
        "ppe10": float((ape <= 0.10).mean() * 100), "mae": float(np.abs(p - y).mean()),
        "r2": float(r2_score(y, p)) if len(y) > 1 else None,
    }


def segments(df: pd.DataFrame, y, p, bands: list[float]) -> dict:
    """The same scores for slices of the out-of-fold predictions, with sample counts. Bands come from development prices."""
    out = {"county": {}, "property_type": {}, "price_band": {}}
    for col in ("county", "property_type"):
        for value, idx in df.groupby(col).indices.items():
            out[col][value] = scores(y[idx], p[idx])
    edges = [-np.inf, *bands, np.inf]
    for i, name in enumerate(["Q1 cheapest quarter", "Q2", "Q3", "Q4 dearest quarter"]):
        m = (y > edges[i]) & (y <= edges[i + 1])
        out["price_band"][name] = scores(y[m], p[m])
    top = y >= np.percentile(y, 90)
    out["price_band"]["top decile (90th percentile and up)"] = scores(y[top], p[top])
    return out


def cross_validate(make, X: pd.DataFrame, y: np.ndarray, fold_ids: np.ndarray, bands: list[float], return_oof=False):
    oof, fold_mape, fit_s, pred_s = np.empty(len(y)), [], [], []
    for k in sorted(set(fold_ids)):
        train, test = fold_ids != k, fold_ids == k
        est = make()
        t0 = time.perf_counter()
        est.fit(X[train], y[train])
        fit_s.append(time.perf_counter() - t0)
        t0 = time.perf_counter()
        oof[test] = est.predict(X[test])
        pred_s.append((time.perf_counter() - t0) / test.sum() * 1000 * 1000)  # ms per 1,000 predictions
        fold_mape.append(scores(y[test], oof[test])["mape"])
    result = {
        "cv_mape": float(np.mean(fold_mape)), "fold_mape": [float(m) for m in fold_mape],
        "fold_std": float(np.std(fold_mape, ddof=1)), "pooled": scores(y, oof),
        "segments": segments(X, y, oof, bands),
    }
    timing = {"fit_s_per_fold": float(np.mean(fit_s)), "predict_ms_per_1000": float(np.mean(pred_s))}
    return (result, timing, oof) if return_oof else (result, timing)


def load_development(seed: int):
    """Development rows only, with a complete floor area, plus their fold numbers. Also returns the full split summary."""
    with dr.CSV_PATH.open(newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    kept, _, _ = dr.classify(rows)
    where = split.partition(kept, seed, tuple(CONFIG["shares"]))
    assert split.leaked_groups(kept, where) == [], "a property group crosses partitions"
    dev = [r for r in kept if where[r["source_row"]] == "development" and r["floor_area_m2"] is not None]
    folds = split.folds(dev, CONFIG["folds"], seed)
    df = pd.DataFrame(dev)[["source_row", *FEATURE_COLUMNS]]
    df["fold"] = df["source_row"].map(folds)
    y = np.array([r["price_eur"] for r in dev], float)
    manifest = {
        "seed": seed, "shares": CONFIG["shares"], "source_sha256": dr.sha256(dr.CSV_PATH),
        "partition_rows": {p: sorted(r for r, w in where.items() if w == p) for p in split.PARTITIONS},
        "development_folds": {str(k): sorted(r for r, f in folds.items() if f == k) for k in range(CONFIG["folds"])},
    }
    return df, y, split.summary(kept, where), manifest, len(kept)


def _rounded(v, places=6):
    if isinstance(v, float):
        return round(v, places)
    if isinstance(v, dict):
        return {k: _rounded(x, places) for k, x in v.items()}
    if isinstance(v, list):
        return [_rounded(x, places) for x in v]
    return v


def digest(results: dict) -> str:
    """A hash of every metric (not the timings), so a second run can be compared at a glance. Multi-threaded models add
    last-digit float noise (about 1e-13) from summation order, so the metrics are rounded to 6 decimals first."""
    return hashlib.sha256(json.dumps(_rounded(results), sort_keys=True).encode()).hexdigest()[:16]


def fmt(v, nd=2):
    return "-" if v is None else f"{v:,.{nd}f}"


def segment_table(seg: dict) -> str:
    rows = [f"| {name} | {s['n']:,} | {fmt(s['mape'])} | {fmt(s['mdape'])} | {fmt(s['ppe10'], 1)} | {fmt(s['mae'], 0)} |"
            for name, s in seg.items()]
    return "\n".join(["| Segment | Rows | MAPE % | MdAPE % | Within 10% | MAE € |", "|---|---|---|---|---|---|", *rows])


def build_report(results, timings, split_info, n_kept, n_dev, bands, models, fallbacks) -> str:
    ranked = sorted(models, key=lambda m: results[m]["cv_mape"])
    best = next(m for m in ranked if m != "baseline")
    lb = [f"| {i} | {m} | {fmt(results[m]['cv_mape'])} | {fmt(results[m]['fold_std'])} | {fmt(results[m]['pooled']['mdape'])} "
          f"| {fmt(results[m]['pooled']['ppe10'], 1)} | {fmt(results[m]['pooled']['mae'], 0)} | {fmt(results[m]['pooled']['r2'], 3)} "
          f"| {fmt(timings[m]['fit_s_per_fold'], 1)} | {fmt(timings[m]['predict_ms_per_1000'], 1)} |"
          for i, m in enumerate(ranked, 1)]
    fb = Counter(fallbacks)
    fb_total = sum(fb.values())
    lines = [
        "# Baseline and candidate model benchmark", "",
        "Development partition only (60% of the kept rows). Calibration and the final test were not read. "
        "The target is the 2024 **asking** price, so these figures say how well asking prices can be predicted, not true value.", "",
        "## Setup", "",
        f"- Seed {CONFIG['seed']}, shares {CONFIG['shares']}, {CONFIG['folds']} group-aware folds shared by every model.",
        f"- {n_kept:,} kept rows split into {split_info['rows']['development']:,} development, {split_info['rows']['calibration']:,} "
        f"calibration and {split_info['rows']['test']:,} test. Counties missing from a partition: "
        f"{', '.join(split_info['counties_missing_from_a_partition']) or 'none'}.",
        f"- Complete-input benchmark: {n_dev:,} development rows with a known floor area. Price bands are the development "
        f"quartiles (€{bands[0]:,.0f}, €{bands[1]:,.0f}, €{bands[2]:,.0f}).",
        "- Inputs: county, property type, bedrooms, floor area, BER. The model learns log(price) and is scored in euro.",
        f"- Python {platform.python_version()}, numpy {np.__version__}, pandas {pd.__version__}, scikit-learn {sklearn.__version__}"
        + "".join(f", {n} {sys.modules[n].__version__}" for n in ("xgboost", "catboost") if n in sys.modules) + ".",
        f"- Metrics fingerprint `{digest(results)}` (all metrics, no timings): identical on a re-run with the same inputs (rounded to 6 decimals).", "",
        "## Leaderboard", "",
        "Ranked by CV MAPE (mean of the five fold MAPEs). Fold spread is the standard deviation across folds, "
        "which is not a significance test. The other columns pool every out-of-fold prediction.", "",
        "| Rank | Model | CV MAPE % | Fold spread | MdAPE % | Within 10% | MAE € | R² | Fit s/fold | Predict ms/1,000 |",
        "|---|---|---|---|---|---|---|---|---|---|", *lb, "",
        f"The baseline fell back to the county median for {fb['county']:,} of {fb_total:,} predictions "
        f"({100 * fb['county'] / fb_total:.1f}%) and to the global median for {fb['global']:,}.", "",
        f"## Where the best model ({best}) is weak", "",
        "### By property type", "", segment_table(results[best]["segments"]["property_type"]), "",
        "### By price band", "", segment_table(results[best]["segments"]["price_band"]), "",
        "### By county", "", segment_table(results[best]["segments"]["county"]), "",
        "## The baseline, for comparison", "",
        "### By property type", "", segment_table(results["baseline"]["segments"]["property_type"]), "",
        "### By price band", "", segment_table(results["baseline"]["segments"]["price_band"]), "",
    ]
    return "\n".join(lines)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--models", default=",".join(CONFIG["models"]))
    ap.add_argument("--out", default=str(HERE / "reports"))
    args = ap.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    seed = CONFIG["seed"]
    df, y, split_info, manifest, n_kept = load_development(seed)
    X, fold_ids = df[FEATURE_COLUMNS], df["fold"].to_numpy()
    bands = [float(np.percentile(y, q)) for q in (25, 50, 75)]
    results, timings, fallbacks = {}, {}, Counter()
    for name in ["baseline", *args.models.split(",")]:
        print(f"running {name} ...", flush=True)
        built = []

        def make(name=name):
            m = MedianPerM2Baseline() if name == "baseline" else make_model(name, seed)
            built.append(m)
            return m

        results[name], timings[name] = cross_validate(make, X, y, fold_ids, bands)
        if name == "baseline":
            for m in built:
                fallbacks.update(m.fallbacks)
        print(f"  CV MAPE {results[name]['cv_mape']:.2f}%", flush=True)
    models = list(results)
    (out / "benchmark-results.json").write_text(json.dumps({"results": results, "timings": timings}, indent=1, sort_keys=True))
    (out / "split-manifest.json").write_text(json.dumps(manifest))
    (out / "benchmark-report.md").write_text(build_report(results, timings, split_info, n_kept, len(df), bands, models, fallbacks))
    print((out / "benchmark-report.md").read_text()[:3000])


if __name__ == "__main__":
    main()
