"""Would extra inputs make the valuation clearly more accurate? Measured on the development folds only.

Every rule (which inputs, which models, what counts as worth proposing) is read from experiments_config.json, which was
committed before this code was written. Calibration and the final test are not read, and the frozen model is untouched.

    prun --pull ml/reports ml/experiments.py
"""

import csv
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import numpy as np
import pandas as pd

from ml import benchmark as b
from ml import data_readiness as dr
from ml import figures as fig
from ml import split

HERE = Path(__file__).resolve().parent
CONFIG = json.loads((HERE / "experiments_config.json").read_text())
EXTRA_COLUMNS = ["rkey", "bathrooms", "built_year", "town", "lat", "lon", "group"]

# Eircode routing keys: a letter and two digits (D14, V92) or D6W, from the allowed letters.
EIRCODE = re.compile(r"\b([ACDEFHKNPRTVWXY]\d{2}|D6W)\s?[0-9ACDEFHKNPRTVWXY]{4}\b", re.I)


def routing_key(title: str) -> str | None:
    """The first three characters of the Eircode at the end of a listing title, or None if there isn't one."""
    m = EIRCODE.search(title[-14:]) or EIRCODE.search(title)
    return m.group(1).upper() if m else None


class FeatureBuilderV2(b.FeatureBuilder):
    """The five inputs plus any of the extras. Frequent categories and fill values are learned from training rows only.

    "expected_price" is log(area) plus the routing key's smoothed mean log(price per m2), a lookup table learned from the
    training rows. For the training rows themselves it is computed out-of-fold over whole property groups (see fit_transform),
    so a row's own price, and its repeat adverts' prices, can never feed its own feature."""

    def __init__(self, extras=(), min_count=10, smoothing=10.0, inner_folds=5, seed=42):
        self.extras = tuple(extras)
        self.min_count = min_count
        self.smoothing = smoothing
        self.inner_folds = inner_folds
        self.seed = seed

    @staticmethod
    def _keys(X) -> np.ndarray:
        return X["rkey"].fillna("Unknown").to_numpy(dtype=object)

    def _table(self, X, y, rows):
        """Smoothed mean of log(price per m2) per routing key, from the given rows only: (table, overall mean)."""
        t = np.asarray(y, float)[rows] - np.log(X["floor_area_m2"].to_numpy(float)[rows])
        overall = float(t.mean())
        s = {}
        for k, v in zip(self._keys(X)[rows], t):
            tot, n = s.get(k, (0.0, 0))
            s[k] = (tot + v, n + 1)
        return {k: (tot + self.smoothing * overall) / (n + self.smoothing) for k, (tot, n) in s.items()}, overall

    def _expected(self, X, table, overall) -> np.ndarray:
        ppm = np.array([table.get(k, overall) for k in self._keys(X)])
        return ppm + np.log(X["floor_area_m2"].to_numpy(float))

    def fit(self, X, y=None):
        super().fit(X, y)
        frequent = lambda col: sorted(k for k, n in X[col].value_counts().items() if n >= self.min_count)
        self.keys_ = frequent("rkey") if "eircode_routing_key" in self.extras else []
        self.towns_ = frequent("town") if "town" in self.extras else []
        # fill values only for the extras asked for, so a model that uses just the Eircode key needs no other column at inference
        med = lambda col, extra: float(np.nanmedian(X[col])) if extra in self.extras and X[col].notna().any() else 0.0
        self.built_fill_, self.lat_fill_, self.lon_fill_ = med("built_year", "construction_year"), med("lat", "coordinates"), med("lon", "coordinates")
        if "expected_price" in self.extras:
            self.table_, self.overall_ = self._table(X, y, np.arange(len(X)))  # learned from every training row, used for rows scored later
        return self

    def fit_transform(self, X, y=None, **fit_params):
        """Training rows get an out-of-fold expected price, never the full-table one that includes their own price."""
        self.fit(X, y)
        expected = None
        if "expected_price" in self.extras:
            if "group" not in X:
                raise ValueError("expected_price needs the property group of each training row, so a row's own price cannot leak into its feature")
            groups = [{"source_row": i, "group": g} for i, g in enumerate(X["group"])]
            fold_of = split.folds(groups, self.inner_folds, self.seed)
            inner = np.array([fold_of[i] for i in range(len(X))])
            expected = np.empty(len(X))
            for k in range(self.inner_folds):
                hold = inner == k
                table, overall = self._table(X, y, np.where(~hold)[0])
                expected[hold] = self._expected(X[hold], table, overall)
        return self._build(X, expected)

    @staticmethod
    def _category(values: pd.Series, keep: list) -> np.ndarray:
        """One column per kept category, then Other (seen but rare or new) and Unknown (missing)."""
        v = values.to_numpy(dtype=object)
        cols = [(v == k) for k in keep]
        missing = pd.isna(values).to_numpy()
        cols += [~missing & ~np.isin(v, keep), missing]
        return np.column_stack(cols).astype(float)

    def transform(self, X):
        expected = self._expected(X, self.table_, self.overall_) if "expected_price" in self.extras else None
        return self._build(X, expected)

    def _build(self, X, expected):
        parts = [super().transform(X)]
        if "eircode_routing_key" in self.extras:
            parts.append(self._category(X["rkey"], self.keys_))
        if "bathrooms" in self.extras:
            parts.append(X[["bathrooms"]].to_numpy(float))
        if "construction_year" in self.extras:
            year = X["built_year"].to_numpy(float)
            parts.append(np.column_stack([np.where(np.isnan(year), self.built_fill_, year), np.isnan(year).astype(float)]))
        if "town" in self.extras:
            parts.append(self._category(X["town"], self.towns_))
        if "coordinates" in self.extras:
            parts.append(np.column_stack([X["lat"].fillna(self.lat_fill_), X["lon"].fillna(self.lon_fill_)]))
        if expected is not None:
            parts.append(expected[:, None])
        return np.hstack(parts)


def load_with_extras(seed: int, also: tuple = ()):
    """The same development rows and folds as the frozen model, plus the extra columns read from the raw file by source row."""
    df, y, _, _, _ = b.load_development(seed, also)
    with dr.CSV_PATH.open(newline="", encoding="utf-8") as f:
        raw = list(csv.DictReader(f))
    rows = [raw[i - 1] for i in df["source_row"]]  # source_row is the 1-based data row number
    num = lambda s: float(s) if re.fullmatch(r"\d+(\.\d+)?", s.strip()) else np.nan
    year = lambda s: float(s) if re.fullmatch(r"(18|19|20)\d{2}", s.strip()) else np.nan
    signed = lambda s: float(s) if re.fullmatch(r"-?\d+(\.\d+)?", s.strip()) else np.nan
    df = df.copy()
    df["rkey"] = [routing_key(r["Title"]) for r in rows]
    df["bathrooms"] = [num(r["Number of Bathrooms"]) for r in rows]
    df["built_year"] = [year(r["Date of Construction"]) for r in rows]
    df["town"] = [r["Area"].strip() or None for r in rows]
    with dr.CSV_PATH.open(newline="", encoding="utf-8") as f:
        kept, _, _ = dr.classify(list(csv.DictReader(f)))
    group_of = {r["source_row"]: r["group"] for r in kept}
    df["group"] = [group_of[i] for i in df["source_row"]]  # repeat adverts of one property share a group
    df["lat"] = [signed(r["Latitude"]) for r in rows]
    df["lon"] = [signed(r["Longitude"]) for r in rows]
    return df, y


def verdict(gain_by_model: dict, folds_by_model: dict, combo: list) -> dict:
    """Is this addition worth proposing? Rules from the config: both models, all five folds, and a threshold that depends on
    whether the app already collects every input in the combination. Reference-only additions are never proposed."""
    adds = CONFIG["additions"]
    if any(adds[c].get("reference_only") for c in combo):
        return {"worth_proposing": False, "reason": "reference only: shows how much more there is to gain, never proposed"}
    wr = CONFIG["worth_proposing"]
    free = all(adds[c]["app_collects_it_today"] for c in combo)
    need = wr["threshold_if_the_app_already_collects_it_mape_pp"] if free else wr["threshold_if_it_needs_a_new_field_mape_pp"]
    weak = [m for m, g in gain_by_model.items() if g < need]
    uneven = [m for m, n in folds_by_model.items() if n < 5]
    ok = not weak and not uneven
    why = (f"gain of at least {need} point(s) in both models and in all five folds" if ok else
           f"needs {need} point(s) in both models and all five folds; " +
           (f"too small for {', '.join(weak)}" if weak else "") + ("; " if weak and uneven else "") +
           (f"not better in every fold for {', '.join(uneven)}" if uneven else ""))
    return {"worth_proposing": ok, "reason": why, "needs_new_field": not free, "threshold_pp": need}


def new_fields(combo) -> int:
    """How many inputs in this combination would need a new field in the app."""
    return sum(not CONFIG["additions"][c]["app_collects_it_today"] for c in combo)


def recommend(rows):
    """Of the combinations that pass the rule, the one asking the app for the fewest new fields, then the most accurate.
    (The committed rule compares each combination with the five inputs, so a combination can pass because another input in it
    does all the work. Asking for the fewest new fields avoids recommending a field that adds almost nothing.)"""
    passed = [r for r in rows if r[5]["worth_proposing"]]
    return min(passed, key=lambda r: (new_fields(r[0]), r[2]["hist_gradient_boosting"]["cv_mape"])) if passed else None


def model_settings():
    frozen = json.loads((HERE / "reports" / "frozen-model.json").read_text())
    tuned = json.loads((HERE / "reports" / "tuning-results.json").read_text())["tuned"]
    fix = lambda p: {k: tuple(v) if isinstance(v, list) else v for k, v in p.items()}
    return {"hist_gradient_boosting": fix(frozen["params"]), "catboost": fix(tuned["catboost"]["best_params"])}


def run_experiment(df, y, model, params, extras, seed, keep_oof=False):
    X, fold_ids = df[b.FEATURE_COLUMNS + EXTRA_COLUMNS], df["fold"].to_numpy()
    bands = [float(np.percentile(y, q)) for q in (25, 50, 75)]
    make = lambda: b.make_model(model, seed, params, features=FeatureBuilderV2(extras))
    res, _, oof = b.cross_validate(make, X, y, fold_ids, bands, return_oof=True)
    summary = {"cv_mape": res["cv_mape"], "fold_mape": res["fold_mape"], "fold_std": res["fold_std"], **{k: res["pooled"][k] for k in ("mdape", "ppe10", "mae", "r2")}}
    return (summary, oof) if keep_oof else summary


def main():
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(HERE / "reports"))
    ap.add_argument("--only", default="")  # a comma list of combination indexes, for a quick smoke test
    args = ap.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    seed = CONFIG["seed"]
    df, y = load_with_extras(seed)
    settings = model_settings()
    combos = CONFIG["combinations"]
    if args.only:
        combos = [combos[int(i)] for i in args.only.split(",")]
    results = {"five_inputs": {}}
    oofs = {}  # out-of-fold predictions of the frozen model (HistGradientBoosting), for the figures
    for m, p in settings.items():
        results["five_inputs"][m], o = run_experiment(df, y, m, p, [], seed, keep_oof=True)
        if m == "hist_gradient_boosting":
            oofs["five_inputs"] = o
    for m, r in results["five_inputs"].items():
        print(f"five inputs / {m}: CV MAPE {r['cv_mape']:.2f}%", flush=True)
    rows = []
    for combo in combos:
        name = " + ".join(combo)
        res = {}
        for m, p in settings.items():
            res[m], o = run_experiment(df, y, m, p, combo, seed, keep_oof=True)
            if m == "hist_gradient_boosting":
                oofs[name] = o
        gains = {m: results["five_inputs"][m]["cv_mape"] - r["cv_mape"] for m, r in res.items()}
        folds = {m: sum(e < f for e, f in zip(r["fold_mape"], results["five_inputs"][m]["fold_mape"])) for m, r in res.items()}
        v = verdict(gains, folds, combo)
        results[name] = {"models": res, "gain_pp": gains, "folds_improved": folds, "verdict": v}
        rows.append((combo, name, res, gains, folds, v))
        print(f"+ {name}: " + ", ".join(f"{m} {r['cv_mape']:.2f}% (gain {gains[m]:+.2f})" for m, r in res.items()) + f" -> {v['reason']}", flush=True)
    meta = {"rows": int(len(y)), "eircode_found": float(df["rkey"].notna().mean()), "bathrooms_found": float(df["bathrooms"].notna().mean()),
            "construction_year_found": float(df["built_year"].notna().mean())}
    (out / "extra-inputs-results.json").write_text(json.dumps({"results": results, "meta": meta}, indent=1, sort_keys=True, default=float))
    figures = make_figures(out / "figures", df, y, results, rows, oofs)
    (out / "extra-inputs-report.md").write_text(build_report(results["five_inputs"], rows, meta, figures))
    print((out / "extra-inputs-report.md").read_text()[:3000])


LABELS = {"eircode_routing_key": "Eircode key", "bathrooms": "bathrooms", "construction_year": "build year", "town": "town", "coordinates": "coordinates"}


def short_label(combo) -> str:
    """A short x-axis label for a set of added inputs, stacked on separate lines so neighbours never overlap."""
    return "all 5 extras" if len(combo) == len(LABELS) else "\n+ ".join(LABELS[c] for c in combo)


def make_figures(out: Path, df, y, results, rows, oofs) -> list:
    """Saves the PNGs and returns (file, title, takeaway) for each. Uses the recommended set, or the Eircode key if none passes."""
    h = "hist_gradient_boosting"
    pick = recommend(rows)
    name = pick[1] if pick else "eircode_routing_key"
    p5, pe = oofs["five_inputs"], oofs[name]
    X, bands = df[b.FEATURE_COLUMNS], [float(np.percentile(y, q)) for q in (25, 50, 75)]
    seg5, sege = b.segments(X, y, p5, bands), b.segments(X, y, pe, bands)
    base = (results["five_inputs"][h]["cv_mape"], results["five_inputs"]["catboost"]["cv_mape"])
    bar_rows = [(short_label(combo), res[h]["cv_mape"], res["catboost"]["cv_mape"],
                 any(CONFIG["additions"][c].get("reference_only") for c in combo), nm == name)
                for combo, nm, res, *_ in rows]
    return [
        ("1-error-by-input-set.png", "Error for each set of inputs", fig.bars(out, bar_rows, base)),
        ("2-every-fold-improves.png", "Error in each of the five folds",
         fig.folds(out, {m: results["five_inputs"][m]["fold_mape"] for m in results["five_inputs"]}, {m: results[name]["models"][m]["fold_mape"] for m in results["five_inputs"]})),
        ("3-share-of-estimates-within-x-percent.png", "How close do the estimates get?", fig.within(out, y, p5, pe)),
        ("4-estimate-versus-asking-price.png", "Estimate versus asking price", fig.density(out, y, p5, pe)),
        ("5-price-band-confusion-matrix.png", "Did the model pick the right price range? (confusion matrix)", fig.confusion_pair(out, y, p5, pe, bands)),
        ("6-error-by-price-band-and-county.png", "Typical error by price range and county",
         fig.segments(out, seg5["price_band"], sege["price_band"], seg5["county"], sege["county"], bands)),
        ("7-error-distribution.png", "Distribution of the error", fig.bias(out, y, p5, pe)),
    ]


def build_report(base, rows, meta, figures=()) -> str:
    h, c = "hist_gradient_boosting", "catboost"
    f = lambda v, nd=2: f"{v:.{nd}f}"
    adds = CONFIG["additions"]
    table = []
    for combo, name, res, gains, folds, v in rows:
        free = "yes" if all(adds[x]["app_collects_it_today"] for x in combo) else "no"
        mark = "**proposed**" if v["worth_proposing"] else ("reference" if any(adds[x].get("reference_only") for x in combo) else "no")
        table.append(f"| {name} | {free} | {f(res[h]['cv_mape'])} | {gains[h]:+.2f} | {folds[h]}/5 | {f(res[c]['cv_mape'])} | {gains[c]:+.2f} | {folds[c]}/5 | {mark} |")
    best = recommend(rows)
    by_name = {r[1]: r for r in rows}
    on_top = []
    for combo, name, res, gains, folds, v in rows:  # what each extra adds on top of the Eircode key, which does most of the work
        if combo[0] == "eircode_routing_key" and len(combo) > 1:
            solo = by_name["eircode_routing_key"][2]
            d_h, d_c = res[h]["cv_mape"] - solo[h]["cv_mape"], res[c]["cv_mape"] - solo[c]["cv_mape"]
            on_top.append(f"- Adding {' + '.join(combo[1:])} on top of the Eircode key changes CV MAPE by {d_h:+.2f} points "
                          f"(HistGradientBoosting) and {d_c:+.2f} (CatBoost). Negative means more accurate.")
    lines = [
        "# Would extra inputs make the valuation clearly more accurate?", "",
        f"Development split only ({meta['rows']:,} rows, the same five group folds as the frozen model). Calibration and the final test were not read, "
        "and the frozen model and its final test are unchanged. The rules for what counts as worth proposing were committed before any of this ran "
        "(`experiments_config.json`).", "",
        f"The five-input model scores **{f(base[h]['cv_mape'])}%** CV MAPE (HistGradientBoosting, the frozen model's settings) and "
        f"**{f(base[c]['cv_mape'])}%** (CatBoost, the second-best, as a check that a gain is not specific to one model).", "",
        "## Results", "",
        "Gain is the drop in CV MAPE in points (positive is better) compared with the five inputs. Folds is how many of the five folds improved.", "",
        "| Added input(s) | App collects it today | HGB CV MAPE % | Gain | Folds | CatBoost CV MAPE % | Gain | Folds | Verdict |",
        "|---|---|---|---|---|---|---|---|---|", *table, "",
        "**Rule for proposing (fixed beforehand):** an input the app already collects needs a gain of at least "
        f"{CONFIG['worth_proposing']['threshold_if_the_app_already_collects_it_mape_pp']} point in both models and in all five folds. "
        f"A new form field needs {CONFIG['worth_proposing']['threshold_if_it_needs_a_new_field_mape_pp']} points. Town and coordinates are upper-bound references only.", "",
        "## Pictures", "",
        "All figures use out-of-fold predictions on the development split: every point is a prediction for a house the model was not trained on. "
        "Blue is the five inputs the model uses today, orange the proposed extra input.", "",
        *[line for i, (file, title, caption) in enumerate(figures, 1) for line in (f"### {i}. {title}", "", f"![{title}](figures/{file})", "", caption, "")],
        "## What the Eircode key does and what the rest adds", "", *on_top, "",
        "**A note on the rule.** The proposal rule was committed before these results, and it compares each combination with the five inputs. "
        "That let combinations containing bathrooms pass only because the Eircode key does the work, which is not what the rule was for. After seeing this, "
        "the recommendation step was changed to take the smallest set that passes (fewest new fields first). The pass or fail thresholds were not changed.", "",
        "## Coverage in the data", "",
        f"The Eircode routing key was found for {100 * meta['eircode_found']:.1f}% of the development rows, bathrooms for {100 * meta['bathrooms_found']:.1f}% and the construction year for "
        f"{100 * meta['construction_year_found']:.1f}%. A missing value gets its own Unknown category (or a missing flag), so the model also works when an input is absent.", "",
        "## Recommendation", "",
    ]
    if best:
        combo, name, res, gains, folds, v = best
        lines += [f"**Propose adding: {name}.** It lowers CV MAPE from {f(base[h]['cv_mape'])}% to {f(res[h]['cv_mape'])}% for HistGradientBoosting "
                  f"({gains[h]:+.2f} points) and from {f(base[c]['cv_mape'])}% to {f(res[c]['cv_mape'])}% for CatBoost ({gains[c]:+.2f}), better in every fold for both. "
                  f"Within 10% of the asking price goes from {f(base[h]['ppe10'], 1)}% to {f(res[h]['ppe10'], 1)}% and the average miss from €{base[h]['mae']:,.0f} to €{res[h]['mae']:,.0f}."]
        lines += ["", "A v2 model with the extra input would be a new version with its own tuning and its own final test, because nothing may change after the final test."]
    else:
        lines += ["**No change is worth proposing on these numbers.** No addition met the rule that was fixed beforehand."]
    lines += ["", "Gains are on development folds, so they are slightly optimistic until a v2 is scored once on the untouched final test. "
              "The data is 2024 asking prices, so these are gains in predicting asking prices.", ""]
    return "\n".join(lines)


if __name__ == "__main__":
    main()
