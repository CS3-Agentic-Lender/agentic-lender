"""v2 model experiments: bagging, GPBoost and TabPFN, against the single-model references. Development folds only.

Rules come from v2_models_config.json, committed before this code. Calibration and the final test are not read, and the
frozen v1 model is untouched. These experiments choose the v2 shortlist; they do not freeze a winner.

    prun --pull ml/reports ml/v2_models.py
    ALLOW_TABPFN_DOWNLOAD=1 prun ... ml/v2_models.py --tabpfn     # only after the owner has agreed to the weights download
"""

import argparse
import json
import os
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import numpy as np
import pandas as pd

from ml import benchmark as b
from ml import experiments as ex
from ml import figures as fig
from ml import split

HERE = Path(__file__).resolve().parent
CONFIG = json.loads((HERE / "v2_models_config.json").read_text())
KEY = ["eircode_routing_key"]
BAG_SIZES = {"hist_gradient_boosting": 10, "catboost": 10, "mlp": 5}


class BaggedModel:
    """Average of several copies of one pipeline in log-price (the geometric mean of the euro predictions).

    Copies differ by random seed (CatBoost, MLP) or, for HistGradientBoosting which is deterministic, by training on a
    bootstrap resample of whole property groups, so repeat adverts never end up half in and half out."""

    def __init__(self, make, n: int, bootstrap: bool, seed: int = 42):
        self.make, self.n, self.bootstrap, self.seed = make, n, bootstrap, seed

    def fit(self, X, y):
        y = np.asarray(y, float)
        rows_of = {}
        for i, g in enumerate(X["group"].to_numpy()):
            rows_of.setdefault(g, []).append(i)
        groups = list(rows_of)
        rng = np.random.default_rng(self.seed)
        self.members_ = []
        for i in range(self.n):
            if self.bootstrap:
                picked = rng.choice(len(groups), size=len(groups), replace=True)
                idx = np.concatenate([rows_of[groups[j]] for j in picked])
            else:
                idx = np.arange(len(y))
            member = self.make(i)
            member.fit(X.iloc[idx], y[idx])
            self.members_.append(member)
        return self

    def predict(self, X):
        return np.exp(np.mean([np.log(m.predict(X)) for m in self.members_], axis=0))


class GPBoostModel:
    """Boosting on the five inputs plus crossed random effects for county and routing key (Gaussian, log price).
    The routing key is not a fixed input: its effect comes from the random effect, with rare keys pooled towards zero."""

    def __init__(self, settings: dict, inner_folds: int = 5, seed: int = 42):
        self.settings, self.inner_folds, self.seed = dict(settings), inner_folds, seed

    def _fixed(self, X):
        full = self.fb_.transform(X)
        return np.hstack([full[:, :4], full[:, 4 + len(b.COUNTIES):]])  # area, bedrooms, BER, unknown flag, property type (county is a random effect)

    @staticmethod
    def _groups(X):
        return pd.DataFrame({"county": X["county"].to_numpy(), "key": X["rkey"].fillna("Unknown").to_numpy()})

    def fit(self, X, y):
        import gpboost as gpb
        ylog = np.log(np.asarray(y, float))
        self.fb_ = b.FeatureBuilder().fit(X, ylog)
        F, G = self._fixed(X), self._groups(X)
        s = self.settings
        params = {k: s[k] for k in ("learning_rate", "num_leaves", "min_data_in_leaf", "max_depth")} | {"verbose": -1, "seed": self.seed}
        rows = [{"source_row": i, "group": g} for i, g in enumerate(X["group"])]
        fold_of = split.folds(rows, self.inner_folds, self.seed)
        inner = np.array([fold_of[i] for i in range(len(X))])
        folds = [(np.where(inner != k)[0], np.where(inner == k)[0]) for k in range(self.inner_folds)]
        cv = gpb.cv(params=params, train_set=gpb.Dataset(F, ylog), gp_model=gpb.GPModel(group_data=G, likelihood="gaussian"), num_boost_round=s["max_rounds"],
                    folds=folds, early_stopping_rounds=s["early_stopping_rounds"], metric="l2", seed=self.seed)
        self.rounds_ = max(1, len(cv["l2-mean"]))
        self.bst_ = gpb.train(params=params, train_set=gpb.Dataset(F, ylog), gp_model=gpb.GPModel(group_data=G, likelihood="gaussian"), num_boost_round=self.rounds_)
        return self

    def predict(self, X):
        pred = self.bst_.predict(data=self._fixed(X), group_data_pred=self._groups(X), predict_var=False, pred_latent=False)
        return np.exp(pred["response_mean"])


class TabPFNModel:
    """TabPFNRegressor on log price. Refuses to run unless ALLOW_TABPFN_DOWNLOAD=1, because it downloads gated model weights."""

    def __init__(self, seed: int = 42):
        if os.environ.get("ALLOW_TABPFN_DOWNLOAD") != "1":
            raise PermissionError("TabPFN downloads gated model weights. Set ALLOW_TABPFN_DOWNLOAD=1 only after the owner has agreed.")
        self.seed = seed

    def _matrix(self, X):
        known = [b.BER_ORDER.find(v) + 1 if v != "Unknown" else np.nan for v in X["ber"]]
        ber = np.where(np.isnan(known), self.ber_fill_, known)
        code = lambda col, table: np.array([table.get(v, -1) for v in X[col].fillna("Unknown")], float)
        return np.column_stack([X["floor_area_m2"], X["bedrooms"], ber, code("county", self.county_), code("property_type", self.type_), code("rkey", self.key_)])

    def fit(self, X, y):
        from tabpfn import TabPFNRegressor
        ordinals = [b.BER_ORDER.find(v) + 1 for v in X["ber"] if v != "Unknown"]
        self.ber_fill_ = float(np.median(ordinals)) if ordinals else 4.0
        index = lambda col: {v: i for i, v in enumerate(sorted(X[col].fillna("Unknown").unique()))}
        self.county_, self.type_, self.key_ = index("county"), index("property_type"), index("rkey")
        self.model_ = TabPFNRegressor(random_state=self.seed, categorical_features_indices=[3, 4, 5])
        self.model_.fit(self._matrix(X), np.log(np.asarray(y, float)))
        return self

    def predict(self, X):
        return np.exp(self.model_.predict(self._matrix(X)))


def shortlist_verdict(cand: dict, ref: dict) -> dict:
    """The committed rule: at least 0.5 points below the best single reference, lower in all five folds, a median over or
    under estimate within plus or minus 2%, and within-10% not worse."""
    rule = CONFIG["shortlist_rule"]
    gain = ref["cv_mape"] - cand["cv_mape"]
    folds = sum(c < r for c, r in zip(cand["fold_mape"], ref["fold_mape"]))
    bias = abs(cand["median_signed_error"])
    checks = {"gain_at_least_0_5": gain >= 0.5, "lower_in_all_five_folds": folds == 5, "no_low_estimating": bias <= 0.02, "within10_not_worse": cand["ppe10"] >= ref["ppe10"]}
    return {"shortlist": all(checks.values()), "gain_pp": gain, "folds_better": folds, "checks": checks, "rule": rule["rule"]}


def metrics(y, oof, fold_ids) -> dict:
    s = b.scores(y, oof)
    folds = [b.scores(y[fold_ids == k], oof[fold_ids == k])["mape"] for k in range(5)]
    signed = (oof - y) / y
    return {"cv_mape": float(np.mean(folds)), "fold_mape": folds, "mdape": s["mdape"], "ppe10": s["ppe10"], "mae": s["mae"], "r2": s["r2"],
            "median_signed_error": float(np.median(signed)), "mean_estimate_over_mean_asking": float(oof.mean() / y.mean())}


def cross_val(make, X, y, fold_ids):
    """Out-of-fold predictions on the shared folds, with the time each fit and predict took."""
    oof, fit_s, pred_s = np.empty(len(y)), [], []
    for k in range(5):
        tr, te = fold_ids != k, fold_ids == k
        m = make()
        t0 = time.perf_counter()
        m.fit(X[tr], y[tr])
        fit_s.append(time.perf_counter() - t0)
        t0 = time.perf_counter()
        oof[te] = m.predict(X[te])
        pred_s.append((time.perf_counter() - t0) / te.sum() * 1e6)  # ms per 1,000 predictions
    return oof, {"fit_s_per_fold": float(np.mean(fit_s)), "predict_ms_per_1000": float(np.mean(pred_s))}


def rare_key_mape(X, y, oof, fold_ids, below: int = 10) -> dict:
    """MAPE on scored homes whose routing key has fewer than `below` rows in that fold's training rows."""
    keys = X["rkey"].fillna("Unknown").to_numpy()
    mask = np.zeros(len(y), bool)
    for k in range(5):
        counts = pd.Series(keys[fold_ids != k]).value_counts()
        mask |= (fold_ids == k) & np.array([counts.get(v, 0) < below for v in keys])
    return {"rows": int(mask.sum()), "mape": float(np.mean(np.abs(oof[mask] - y[mask]) / y[mask]) * 100) if mask.any() else None}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(HERE / "reports"))
    ap.add_argument("--tabpfn", action="store_true")
    ap.add_argument("--only", default="")  # comma list of variant names, for a quick smoke test
    args = ap.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    seed = CONFIG["seed"]
    df, y = ex.load_with_extras(seed)
    X, fold_ids = df[b.FEATURE_COLUMNS + ex.EXTRA_COLUMNS], df["fold"].to_numpy()
    st = ex.model_settings()
    mlp = json.loads((HERE / "reports" / "tuning-results.json").read_text())["tuned"]["mlp"]["best_params"]
    st["mlp"] = {k: tuple(v) if isinstance(v, list) else v for k, v in mlp.items()}
    pipeline = lambda name, s: b.make_model(name, seed + s, st[name], features=ex.FeatureBuilderV2(KEY, seed=seed))

    plan = {"hist_gradient_boosting (single)": lambda: pipeline("hist_gradient_boosting", 0), "catboost (single)": lambda: pipeline("catboost", 0), "mlp (single)": lambda: pipeline("mlp", 0)}
    for name, n in BAG_SIZES.items():
        plan[f"{name} (bagged x{n})"] = (lambda nm=name, nn=n: BaggedModel(lambda i: pipeline(nm, i), nn, bootstrap=(nm == "hist_gradient_boosting"), seed=seed))
    plan["gpboost (county + routing-key random effects)"] = lambda: GPBoostModel(CONFIG["variants"]["gpboost"]["settings"], seed=seed)
    if args.tabpfn:
        plan["tabpfn"] = lambda: TabPFNModel(seed=seed)
    if args.only:
        plan = {k: v for k, v in plan.items() if any(o in k for o in args.only.split(","))}

    oofs, results, timings = {}, {}, {}
    for name, make in plan.items():
        print(f"running {name} ...", flush=True)
        try:
            oofs[name], timings[name] = cross_val(make, X, y, fold_ids)
        except (PermissionError, ImportError) as e:  # TabPFN without agreement or package: say so, keep going
            results[name] = {"not_run": str(e)}
            print(f"  not run: {e}", flush=True)
            continue
        results[name] = metrics(y, oofs[name], fold_ids)
        print(f"  CV MAPE {results[name]['cv_mape']:.2f}%  median over/under {100 * results[name]['median_signed_error']:+.1f}%", flush=True)

    def average(names):  # equal average in log-price of out-of-fold predictions
        return np.exp(np.mean([np.log(oofs[n]) for n in names], axis=0))

    for label, names in (("equal average of the three (single seeds)", [f"{m} (single)" for m in BAG_SIZES]),
                         ("equal average of the three (each bagged)", [f"{m} (bagged x{n})" for m, n in BAG_SIZES.items()])):
        if all(n in oofs for n in names):
            oofs[label] = average(names)
            results[label] = metrics(y, oofs[label], fold_ids)
            timings[label] = {"fit_s_per_fold": sum(timings[n]["fit_s_per_fold"] for n in names), "predict_ms_per_1000": sum(timings[n]["predict_ms_per_1000"] for n in names)}
            print(f"{label}: CV MAPE {results[label]['cv_mape']:.2f}%", flush=True)

    ref = results["catboost (single)"] if "catboost (single)" in results else None
    verdicts = {n: shortlist_verdict(r, ref) for n, r in results.items() if ref and "cv_mape" in r and n != "catboost (single)" and not n.endswith("(single)")}
    rare = {n: rare_key_mape(X, y, o, fold_ids) for n, o in oofs.items() if n in ("hist_gradient_boosting (single)", "catboost (single)") or "gpboost" in n}
    (out / "v2-models-results.json").write_text(json.dumps({"results": results, "timings": timings, "verdicts": verdicts, "rare_keys": rare}, indent=1, sort_keys=True, default=float))
    figs = make_figures(out / "figures-v2-models", y, X, oofs, results, verdicts) if ref else []
    (out / "v2-models-report.md").write_text(build_report(results, timings, verdicts, rare, figs, len(y)))
    print((out / "v2-models-report.md").read_text()[:2500])


def make_figures(out: Path, y, X, oofs, results, verdicts) -> list:
    """Bars for every variant, then the closest-to-shortlist variant against the best single model (CatBoost)."""
    ref = results["catboost (single)"]["cv_mape"]
    items = sorted(((n, r["cv_mape"], verdicts.get(n, {}).get("shortlist", False)) for n, r in results.items() if "cv_mape" in r), key=lambda t: t[1])
    captions = [("1-all-variants.png", "Error for every variant", fig.variant_bars(out, items, {"HistGradientBoosting single": results["hist_gradient_boosting (single)"]["cv_mape"], "CatBoost single (best reference)": ref}))]
    contenders = {n: v for n, v in verdicts.items() if n in oofs}
    if contenders:
        best = min(contenders, key=lambda n: results[n]["cv_mape"])
        fig.set_labels("CatBoost single (best reference)", best, "CatBoost single", best, "this variant")
        bands = [float(np.percentile(y, q)) for q in (25, 50, 75)]
        captions += [("2-share-of-estimates-within-x-percent.png", "How close do the estimates get?", fig.within(out, y, oofs["catboost (single)"], oofs[best])),
                     ("3-estimate-versus-asking-price.png", "Estimate versus asking price", fig.density(out, y, oofs["catboost (single)"], oofs[best])),
                     ("4-price-band-confusion-matrix.png", "Did the model pick the right price range? (confusion matrix)", fig.confusion_pair(out, y, oofs["catboost (single)"], oofs[best], bands)),
                     ("5-error-distribution.png", "Distribution of the error", fig.bias(out, y, oofs["catboost (single)"], oofs[best]))]
    return captions


def build_report(results, timings, verdicts, rare, figs, n) -> str:
    f = lambda v, nd=2: "-" if v is None else f"{v:.{nd}f}"
    rows = []
    for name, r in sorted(results.items(), key=lambda kv: kv[1].get("cv_mape", 99)):
        if "not_run" in r:
            rows.append(f"| {name} | not run | | | | | | | {r['not_run']} |")
            continue
        v = verdicts.get(name)
        mark = "**yes**" if v and v["shortlist"] else ("no" if v else "reference")
        t = timings.get(name, {})
        rows.append(f"| {name} | {f(r['cv_mape'])} | {f(r['mdape'])} | {f(r['ppe10'], 1)} | €{r['mae']:,.0f} | {f(r['r2'], 3)} | {100 * r['median_signed_error']:+.1f}% | {f(t.get('fit_s_per_fold'), 1)} / {f(t.get('predict_ms_per_1000'), 1)} | {mark} |")
    why = "\n".join(f"- **{n}**: gain {v['gain_pp']:+.2f} points vs CatBoost, lower in {v['folds_better']}/5 folds; " + ", ".join(f"{k.replace('_', ' ')} {'ok' if ok else 'FAILS'}" for k, ok in v["checks"].items()) for n, v in verdicts.items())
    rare_rows = "\n".join(f"| {n} | {r['rows']:,} | {f(r['mape'])} |" for n, r in rare.items())
    lines = [
        "# v2 model experiments: bagging, GPBoost and TabPFN", "",
        f"Development split only ({n:,} rows, the same five group folds), with the Eircode routing key. Calibration and the final test were not read and the frozen v1 model is unchanged. "
        "These experiments choose the v2 shortlist; the rule (committed first in `v2_models_config.json`) is at least 0.5 points better than the best single model (CatBoost), lower in all five folds, "
        "a median over or under estimate within ±2%, and within-10% not worse.", "",
        "## Results", "",
        "| Variant | CV MAPE % | MdAPE % | Within 10% | Average miss (MAE) | R² | Median over/under | Fit s per fold / predict ms per 1,000 | Shortlist? |",
        "|---|---|---|---|---|---|---|---|---|", *rows, "",
        "## Against the rule", "", why or "No variant could be tested against the rule.", "",
        "## Rare routing keys", "",
        "Scored homes whose routing key had fewer than 10 rows in that fold's training data, where pooling (random effects) is claimed to help:", "",
        "| Model | Homes | MAPE % |", "|---|---|---|", rare_rows, "",
        "HistGradientBoosting is bagged by bootstrapping whole property groups because it is deterministic (a different seed gives the same model); CatBoost and the MLP are bagged by seed.", "",
        "## Pictures", "",
        "Blue is the best single model (CatBoost), orange the variant that came closest to the shortlist. Out-of-fold predictions on the development split throughout.", "",
        *[line for i, (file, title, caption) in enumerate(figs, 1) for line in (f"### {i}. {title}", "", f"![{title}](figures-v2-models/{file})", "", caption, "")],
    ]
    return "\n".join(lines)


if __name__ == "__main__":
    main()
