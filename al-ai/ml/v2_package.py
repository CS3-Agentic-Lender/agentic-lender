"""Package the evaluated v2 model for the valuation endpoint: the model file, reference predictions, a background sample,
a manifest and the model card, in a folder that git does not ignore (models/valuation/).

The model file is the byte-for-byte file v2_final.py saved and evaluated: this script only copies it and checks the
SHA-256 against the final-test results. Nothing is refitted. The reference inputs are made up (not listings) and the
background sample holds inputs only (no price, title, address or coordinates, area rounded to 5 m2).

    python ml/v2_package.py
"""

import argparse
import csv
import importlib.metadata as md
import json
import platform
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import joblib
import numpy as np
import pandas as pd

from ml import benchmark as b
from ml import data_readiness as dr
from ml import experiments as ex
from ml import v2_model as v2
from ml.v2_final import file_sha256

HERE = Path(__file__).resolve().parent
OUT = HERE.parent / "models" / "valuation"
SEED = 42
BACKGROUND_ROWS = 100
REFERENCE_TOLERANCE = 1e-6  # relative; the same machine reloads to 0, other chips differ by floating-point noise
MODEL_FILE = "valuation-v2.joblib"
PACKAGES = ["scikit-learn", "numpy", "pandas", "scipy", "catboost", "joblib"]


def reference_inputs(keys: list, seed: int = SEED, per_county: int = 2) -> pd.DataFrame:
    """Made-up homes spread over every county, type and BER band, with and without a routing key. Not taken from any listing."""
    rng = np.random.default_rng(seed)
    rows = []
    for county in b.COUNTIES:
        for _ in range(per_county):
            ptype = str(rng.choice(b.TYPES))
            small = ptype in ("Apartment", "Duplex", "Townhouse")
            area = float(rng.integers(40, 110) if small else rng.integers(70, 280))
            rows.append({"county": county, "property_type": ptype, "bedrooms": int(rng.integers(1, 4) if small else rng.integers(2, 6)),
                         "floor_area_m2": area, "ber": str(rng.choice([*"ABCDEFG", dr.BER_UNKNOWN])),
                         "rkey": str(rng.choice(keys)) if rng.random() < 0.8 else None})
    return pd.DataFrame(rows)[v2.INPUT_COLUMNS]


def background_sample(X: pd.DataFrame, seed: int = SEED, n: int = BACKGROUND_ROWS) -> pd.DataFrame:
    """A fixed random sample of training inputs for the explanation work. Inputs only, floor area rounded to the nearest 5 m2."""
    sample = X.sample(n=n, random_state=seed).reset_index(drop=True)[v2.INPUT_COLUMNS].copy()
    sample["floor_area_m2"] = (sample["floor_area_m2"] / 5).round() * 5
    return sample


def versions() -> dict:
    return {"python": platform.python_version(), **{p: md.version(p) for p in PACKAGES}}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--reports", default=str(HERE / "reports"))
    ap.add_argument("--artifacts", default=str(HERE / "artifacts"))
    ap.add_argument("--out", default=str(OUT))
    args = ap.parse_args()
    reports, artifacts, out = Path(args.reports), Path(args.artifacts), Path(args.out)
    results = json.loads((reports / "v2-final-test-results.json").read_text())
    expected = results["saved_model"]["sha256"]
    source = artifacts / "v2-pipeline.joblib"
    if file_sha256(source) != expected:
        sys.exit(f"{source} is not the model that was evaluated (SHA-256 differs from v2-final-test-results.json). Not packaging it.")
    out.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source, out / MODEL_FILE)
    assert file_sha256(out / MODEL_FILE) == expected

    model = joblib.load(out / MODEL_FILE)  # the file just copied from this project's own saved model
    cat = model.members["catboost"].regressor_.named_steps["features"]
    keys = list(cat.keys_)
    ref_X = reference_inputs(keys)
    ref = {"what": "Made-up homes, not listings. Predictions of the saved model; a reload must reproduce them within the tolerance.",
           "relative_tolerance": REFERENCE_TOLERANCE, "inputs": json.loads(ref_X.to_json(orient="records")),
           "predictions_eur": [float(v) for v in model.predict(ref_X)]}
    (out / "reference-predictions.json").write_text(json.dumps(ref, indent=1))

    df, _ = ex.load_with_extras(SEED, also=("calibration",))
    bg = background_sample(df[v2.INPUT_COLUMNS])
    bg.to_csv(out / "background-sample.csv", index=False, quoting=csv.QUOTE_MINIMAL)

    threshold = json.loads((reports / "v2-threshold.json").read_text())
    manifest = {"model_file": MODEL_FILE, "sha256": expected, "bytes": (out / MODEL_FILE).stat().st_size, "model": "v2 ensemble_mean (log-price geometric mean of three pipelines)",
                "members": results["members"], "seed": SEED, "input_columns": v2.INPUT_COLUMNS, "background_sample": {"file": "background-sample.csv", "rows": BACKGROUND_ROWS, "seed": SEED, "area_rounded_to_m2": 5},
                "reference_predictions": {"file": "reference-predictions.json", "rows": len(ref_X), "relative_tolerance": REFERENCE_TOLERANCE},
                "source_csv_sha256": dr.sha256(dr.CSV_PATH), "threshold": threshold["threshold"], "dependency_versions": versions(),
                "routing_keys_kept": len(keys)}
    (out / "manifest.json").write_text(json.dumps(manifest, indent=1))
    (out / "MODEL_CARD.md").write_text(model_card(results, threshold, manifest, keys))
    print("packaged", out, sorted(p.name for p in out.iterdir()))


def pct(v, nd=1):
    return f"{100 * v:.{nd}f}%"


def model_card(r, th, m, keys) -> str:
    o, v1, base = r["overall"], r["v1_reference"], r["baseline_reference"]
    cov = r["range_coverage"]
    rng = th["price_range"]
    ranges = [f"| {name} | {pct(bd['low_gap'], 0)} to {pct(bd['high_gap'], 0)} |" for name, bd in zip(
        [f"estimate under €{rng['edges'][0] / 1000:,.0f}k", f"€{rng['edges'][0] / 1000:,.0f}k to €{rng['edges'][1] / 1000:,.0f}k",
         f"€{rng['edges'][1] / 1000:,.0f}k to €{rng['edges'][2] / 1000:,.0f}k", f"estimate over €{rng['edges'][2] / 1000:,.0f}k"], rng["bands"])]
    v = m["dependency_versions"]
    return "\n".join([
        "# Model card: property valuation v2", "",
        "Ticket AL-121 (save the inference pipeline and write the model card), under the valuation model story AL-24. Owner: Nic (al-ai).", "",
        "## What it is", "",
        "A regression model that estimates the **2024 asking price** of an Irish home from the five things the application form already collects, plus the Eircode routing key. "
        "It also supplies an 80% price range and a \"price needs review\" flag (below). It estimates what sellers ask, not what homes sell for, and says nothing about later years.", "",
        f"- **Model:** the equal-weight average, in log price (the geometric mean of the euro estimates), of three pipelines: {', '.join(r['members'])}, each with the settings chosen by tuning (`ml/reports/v2-frozen-model.json`).",
        "- **Target transform:** each pipeline predicts log(price) and converts back to euro with exp. The inverse transform is inside the saved file.",
        f"- **File:** `models/valuation/{m['model_file']}`, {m['bytes'] / 1e6:.2f} MB, SHA-256 `{m['sha256']}`. This is exactly the file that was evaluated on the final test; it was not refitted afterwards.",
        f"- **Seed:** {m['seed']}.", "",
        "## Inputs", "",
        "The saved file takes one row per home with exactly these columns:", "",
        "| Column | Meaning | Allowed values |", "|---|---|---|",
        f"| `county` | Republic of Ireland county | {', '.join(b.COUNTIES)} |",
        f"| `property_type` | Type of home | {', '.join(b.TYPES)} |",
        "| `bedrooms` | Number of bedrooms | whole number |",
        "| `floor_area_m2` | Floor area | 15 to 1,000 m² (outside this the model was never shown data) |",
        "| `ber` | Energy rating band | A to G, or `Unknown`. Old subgrades (A1 to E3) must be turned into their band first with `ml.data_readiness.ber_band`; anything unrecognised becomes `Unknown` |",
        f"| `rkey` | Eircode routing key, the first three characters (for example `D14`), from the application form's Eircode | one of {len(keys)} keys seen often enough in training, otherwise `Other`; missing is `Unknown` |", "",
        f"Routing keys the model knows ({len(keys)}): {', '.join(sorted(keys))}.", "",
        "## Data", "",
        f"- **Source:** Daft.ie Ireland House Properties 2024 (Kaggle `adnankhalid007/ireland-house-properties-dataset-2024`), file `daft_housing_data.csv`, SHA-256 `{m['source_csv_sha256']}`. The raw file is not in git.",
        "- **Rows:** 14,289 in the file, 10,081 kept after the rules in `ml/reports/data-readiness.md` (every dropped row has one recorded reason), 8,149 of them with a floor area. The application always sends an area, so only those rows are used.",
        f"- **Split:** 60% development / 20% calibration / 20% final test, by property group so repeat adverts never cross. Of the rows with an area: development 4,882, calibration 1,637, final test {r['test_rows']:,}.",
        "- **Trained on:** the development and calibration rows (6,519). The final test was never used for training, tuning or choosing the threshold.",
        "- **Eircode routing key:** read from the end of each listing title for training (found for about 95% of rows).", "",
        "## How it was chosen and tested", "",
        "Seven models and a baseline were compared on five group folds inside the development split; the three best were tuned with 50 random trials each and averaged. "
        "Every rule (what counts as a win, how ties break, what to report) was committed before the run it governs (`ml/*_config.json`). "
        "The final test was scored once, with a lock file that stops a second run. Full report with figures: `ml/reports/v2-model-report.md`.", "",
        "## Metrics (final test, once)", "",
        f"{r['test_rows']:,} homes the model never saw.", "",
        "| Metric | v2 | v1 | Baseline (median price per m²) |", "|---|---|---|---|",
        f"| MAPE (average miss) | **{o['mape']:.2f}%** | {v1['mape']:.2f}% | {base['mape']:.2f}% |", f"| MdAPE (typical miss) | {o['mdape']:.2f}% | {v1['mdape']:.2f}% | {base['mdape']:.2f}% |",
        f"| Within 10% of the asking price | {o['ppe10']:.1f}% | {v1['ppe10']:.1f}% | {base['ppe10']:.1f}% |", f"| MAE | €{o['mae']:,.0f} | €{v1['mae']:,.0f} | €{base['mae']:,.0f} |",
        f"| R² | {o['r2']:.3f} | {v1['r2']:.3f} | {base['r2']:.3f} |", "",
        f"RMSE €{o['rmse']:,.0f}; Spearman {r['spearman']:.3f}; AUC for \"asking price above the median / top quarter / top tenth\" "
        f"{r['roc']['p50']['auc']:.3f} / {r['roc']['p75']['auc']:.3f} / {r['roc']['p90']['auc']:.3f}. Development CV MAPE was {r['development_cv_mape']:.2f}%.", "",
        "## \"Price needs review\" and the price range", "",
        f"- **Gap:** `g = asking price / estimate − 1`, from the unrounded estimate.",
        f"- **Threshold:** **{pct(th['threshold'])}**. The flag fires when `g` is strictly above it. It is the 90th percentile (numpy linear method) of `g` on the {th['rows']:,} development rows, "
        "predicted out-of-fold: each home by a model that never saw it. It is **not** set on the calibration rows, because the v2 model trains on them and the gaps there would be too small. "
        f"On the final test it flagged {pct(r['flag_rate'])} of homes (development {pct(th['oof_flag_rate'])}).",
        f"- **80% price range:** the estimate times (1 + the 10th percentile gap) to (1 + the 90th percentile gap), by estimate band, from the same out-of-fold predictions. "
        f"It held {pct(cov['overall'])} of final-test asking prices.", "",
        "| Estimate band | Gap range (low to high) |", "|---|---|", *ranges, "",
        "The flag is a heuristic from historical asking-price gaps. It is not proof that a home is overpriced.", "",
        "## Background sample", "",
        f"`background-sample.csv`: {m['background_sample']['rows']} training homes drawn with seed {m['background_sample']['seed']}, **inputs only** (no price, title, address or coordinates; floor area rounded to "
        f"{m['background_sample']['area_rounded_to_m2']} m²). It is the fixed background for the explanation work later.", "",
        "## Check that a reload gives the same answers", "",
        f"`reference-predictions.json` holds {m['reference_predictions']['rows']} made-up homes (not listings) and the saved model's predictions for them. A reload must reproduce them within a relative "
        f"tolerance of {m['reference_predictions']['relative_tolerance']:g} (the same machine gives exactly 0). `tests/test_valuation_model.py` does this check and also checks the file's SHA-256 against `manifest.json`.", "",
        "## Loading it", "",
        "```python\nimport joblib\nmodel = joblib.load('models/valuation/valuation-v2.joblib')   # check the SHA-256 in manifest.json first\n"
        "model.predict(inputs_dataframe)                                # euro estimates, one per row\n```", "",
        "The file is a pickle (joblib). **Only load it from this repository after checking its SHA-256.** It must be loaded with the versions below; other versions may refuse to load or "
        "predict slightly differently.", "",
        "| Package | Version it was saved with |", "|---|---|", *[f"| {k} | {val} |" for k, val in v.items()], "",
        "## Limits", "",
        "- **2024 asking prices, not sale prices.** It says nothing about 2027.",
        f"- **Typical error is real:** an average miss of {o['mape']:.0f}% and a typical miss of {o['mdape']:.0f}%. Show the estimate with its range, never alone.",
        "- **Weaker for the cheapest homes and in some rural counties** (the county table is in the report); the application should say estimates may be off depending on the county.",
        "- **Biased high a little:** the median estimate is about 1% above the asking price, more for the dearest tenth of estimates.",
        "- **Odd listings exist in the data** (a 209 m² detached house asking €80,000); no input can explain them.",
        "- **Unusual homes** (area over 300 m², 8 or more bedrooms, a county or routing key with little training data) are outside what the test sample can vouch for.",
        "- **The routing key** is required for the full accuracy; with it missing the model falls back on the other inputs.", "",
        "## Where things are", "",
        "- Report and figures: `ml/reports/v2-model-report.md`, `ml/reports/figures-v2-final/`",
        "- Rules committed before each run: `ml/v2_tuning_config.json`, `ml/v2_final_config.json`",
        "- Results: `ml/reports/v2-final-test-results.json`, `v2-threshold.json`, `v2-tuning-results.json`",
        "- Rebuild this folder: `python ml/v2_final.py` (once, locked) then `python ml/v2_package.py`", "",
    ])


if __name__ == "__main__":
    main()
