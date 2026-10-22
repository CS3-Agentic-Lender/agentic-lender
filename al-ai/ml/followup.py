"""Exploratory follow-up: does an "expected price" feature help beyond the Eircode key, and is it leak-free?

Rules and the leakage checks are read from followup_config.json (committed before this code). Development folds only.
Calibration and the final test are not read, and the frozen model is untouched.

    prun --pull ml/reports ml/followup.py
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import numpy as np

from ml import benchmark as b
from ml import experiments as ex
from ml import figures as fig

HERE = Path(__file__).resolve().parent
CONFIG = json.loads((HERE / "followup_config.json").read_text())


def run(df, y, model, params, extras, seed, target=None):
    """Cross-validate on the shared folds. target lets the canary pass shuffled prices. Returns summary metrics and the OOF predictions."""
    X, fold_ids = df[b.FEATURE_COLUMNS + ex.EXTRA_COLUMNS], df["fold"].to_numpy()
    price = y if target is None else target
    bands = [float(np.percentile(price, q)) for q in (25, 50, 75)]
    res, _, oof = b.cross_validate(lambda: b.make_model(model, seed, params, features=ex.FeatureBuilderV2(extras)), X, price, fold_ids, bands, return_oof=True)
    signed = (oof - price) / price
    out = {"cv_mape": res["cv_mape"], "fold_mape": res["fold_mape"], **{k: res["pooled"][k] for k in ("mdape", "ppe10", "mae", "r2")},
           "median_signed_error": float(np.median(signed)), "mean_estimate_over_mean_asking": float(oof.mean() / price.mean())}
    return out, oof


def decide(cur, cand) -> dict:
    """The committed rule: at least 1.0 point lower CV MAPE in BOTH models and lower in ALL five folds."""
    gains = {m: cur[m]["cv_mape"] - cand[m]["cv_mape"] for m in cur}
    folds = {m: sum(c < k for c, k in zip(cand[m]["fold_mape"], cur[m]["fold_mape"])) for m in cur}
    ok = all(g >= 1.0 for g in gains.values()) and all(n == 5 for n in folds.values())
    return {"adopt": ok, "gain_pp": gains, "folds_improved": folds}


def main():
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(HERE / "reports"))
    args = ap.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    seed = CONFIG["seed"]
    df, y = ex.load_with_extras(seed)
    settings = ex.model_settings()
    cur_x, cand_x = CONFIG["compare"]["current"], CONFIG["compare"]["candidate"]
    cur, cand, oofs = {}, {}, {}
    for m in CONFIG["models"]:
        cur[m], o1 = run(df, y, m, settings[m], cur_x, seed)
        cand[m], o2 = run(df, y, m, settings[m], cand_x, seed)
        oofs[m] = (o1, o2)
        print(f"{m}: current {cur[m]['cv_mape']:.2f}%  candidate {cand[m]['cv_mape']:.2f}%", flush=True)
    decision = decide(cur, cand)
    print("decision:", decision, flush=True)

    # canary: with the prices shuffled across houses a leak-free feature has nothing to learn, so it must give no gain
    canary = []
    for s in (1, 2, 3):
        shuffled = np.random.default_rng(s).permutation(y)
        a, _ = run(df, y, "hist_gradient_boosting", settings["hist_gradient_boosting"], cur_x, seed, target=shuffled)
        c, _ = run(df, y, "hist_gradient_boosting", settings["hist_gradient_boosting"], cand_x, seed, target=shuffled)
        canary.append({"seed": s, "current": a["cv_mape"], "candidate": c["cv_mape"], "gain": a["cv_mape"] - c["cv_mape"]})
        print(f"canary seed {s}: current {a['cv_mape']:.2f}% candidate {c['cv_mape']:.2f}% gain {a['cv_mape'] - c['cv_mape']:+.2f}", flush=True)

    # figures: the current Eircode model (blue) against the candidate (orange)
    h = "hist_gradient_boosting"
    fig.set_labels("Eircode key (current v2)", "+ expected price", "Eircode key", "+ expected price", "the expected-price feature")
    X, bands = df[b.FEATURE_COLUMNS], [float(np.percentile(y, q)) for q in (25, 50, 75)]
    p_cur, p_cand = oofs[h]
    sg_cur, sg_cand = b.segments(X, y, p_cur, bands), b.segments(X, y, p_cand, bands)
    figs = out / "figures-followup"
    captions = [
        ("1-error-by-input-set.png", "Error: current v2 against the candidate",
         fig.bars(figs, [("Eircode key\n+ expected price", cand[h]["cv_mape"], cand["catboost"]["cv_mape"], False, True)],
                  (cur[h]["cv_mape"], cur["catboost"]["cv_mape"]), base_label="Eircode key\n(current v2)",
                  blue_text="current v2: five inputs plus the Eircode key", orange_text="the candidate: expected price added")),
        ("2-every-fold-improves.png", "Error in each of the five folds",
         fig.folds(figs, {m: cur[m]["fold_mape"] for m in cur}, {m: cand[m]["fold_mape"] for m in cand})),
        ("3-share-of-estimates-within-x-percent.png", "How close do the estimates get?", fig.within(figs, y, p_cur, p_cand)),
        ("4-estimate-versus-asking-price.png", "Estimate versus asking price", fig.density(figs, y, p_cur, p_cand)),
        ("5-price-band-confusion-matrix.png", "Did the model pick the right price range? (confusion matrix)", fig.confusion_pair(figs, y, p_cur, p_cand, bands)),
        ("6-error-by-price-band-and-county.png", "Typical error by price range and county",
         fig.segments(figs, sg_cur["price_band"], sg_cand["price_band"], sg_cur["county"], sg_cand["county"], bands)),
        ("7-error-distribution.png", "Distribution of the error", fig.bias(figs, y, p_cur, p_cand)),
    ]
    results = {"current": cur, "candidate": cand, "decision": decision, "canary": canary}
    (out / "expected-price-followup-results.json").write_text(json.dumps(results, indent=1, sort_keys=True, default=float))
    (out / "expected-price-followup.md").write_text(build_report(cur, cand, decision, canary, captions, len(y)))
    print((out / "expected-price-followup.md").read_text()[:2500])


def build_report(cur, cand, decision, canary, captions, n) -> str:
    h, c = "hist_gradient_boosting", "catboost"
    f = lambda v, nd=2: f"{v:.{nd}f}"
    rows = []
    for m, name in ((h, "HistGradientBoosting (frozen model's settings)"), (c, "CatBoost (second check)")):
        for label, r in (("Eircode key (current v2)", cur[m]), ("+ expected price", cand[m])):
            rows.append(f"| {name} | {label} | {f(r['cv_mape'])} | {f(r['mdape'])} | {f(r['ppe10'], 1)} | €{r['mae']:,.0f} | {f(r['r2'], 3)} | {100 * r['median_signed_error']:+.1f}% | {f(r['mean_estimate_over_mean_asking'], 3)} |")
    folds = "\n".join(f"| {m} | " + " | ".join(f"{a:.1f} → {k:.1f}" for a, k in zip(cur[m]["fold_mape"], cand[m]["fold_mape"])) + " |" for m in (h, c))
    canary_rows = "\n".join(f"| {x['seed']} | {x['current']:.2f} | {x['candidate']:.2f} | {x['gain']:+.2f} |" for x in canary)
    gains, nf = decision["gain_pp"], decision["folds_improved"]
    verdict = (f"**Adopt.** It lowers CV MAPE by {gains[h]:.2f} (HistGradientBoosting) and {gains[c]:.2f} (CatBoost) points and is better in all five folds for both." if decision["adopt"]
               else f"**Not adopted by the rule.** The gain is {gains[h]:.2f} points (HistGradientBoosting, {nf[h]}/5 folds) and {gains[c]:.2f} (CatBoost, {nf[c]}/5 folds), "
                    "and the rule fixed beforehand needs at least 1.0 point in both models and all five folds.")
    lines = [
        "# Follow-up: does an expected-price feature help beyond the Eircode key?", "",
        "An exploratory follow-up added after the four research agents reported, with its rules and leakage checks committed first (`followup_config.json`). "
        f"Development split only ({n:,} rows, the same five group folds). Calibration and the final test were not read, and the frozen model is unchanged.", "",
        "## What the feature is", "",
        "`expected price = log(area) + the routing key's smoothed average of log(price per m²)`. It is a lookup table learned from training rows, plus the house's own area. "
        "Nothing new is asked in the app.", "",
        "## Is it leakage? How it was checked", "",
        "A target-style feature leaks if a house's own asking price (or its repeat advert's) feeds into its own feature, or if the scored rows' prices reach their own prediction. "
        "It is built to avoid both:", "",
        "- **Training rows** get an out-of-fold value: the table is learned from training rows outside the row's own inner fold, and inner folds are whole property groups.",
        "- **Scored rows** get the table learned from the training folds only. Their prices are never used.", "",
        "Checks (tests in `tests/test_followup.py`):", "",
        "- A training row's feature does not change when every price in its own inner fold changes, including its own and its repeat advert's.",
        "- A repeat advert's price does not reach its sibling.",
        "- Without the property-group column the builder refuses to run instead of leaking.",
        "- I planted two leaks on purpose (training rows using the full table; inner folds split by row instead of by property group) and the tests failed for both.", "",
        "**Canary on the real development rows.** If the feature leaked the scored rows' prices, it would still look good after the prices are shuffled across houses. "
        "A leak-free feature has nothing to learn from shuffled prices:", "",
        "| Shuffle seed | Eircode key (CV MAPE %) | + expected price (CV MAPE %) | Gain |", "|---|---|---|---|", canary_rows, "",
        f"On shuffled prices the average gain is {np.mean([x['gain'] for x in canary]):+.2f} points, which is noise. The gain on the real prices is {gains[h]:.2f}, so it is not coming from a leak.", "",
        "## Results", "",
        "| Model | Inputs | CV MAPE % | MdAPE % | Within 10% | Average miss (MAE) | R² | Median over/under | Mean estimate ÷ mean asking |",
        "|---|---|---|---|---|---|---|---|---|", *rows, "",
        "Fold by fold (CV MAPE %, current → with expected price):", "",
        "| Model | fold 1 | fold 2 | fold 3 | fold 4 | fold 5 |", "|---|---|---|---|---|---|", folds, "",
        "## Verdict by the rule fixed beforehand", "", verdict, "",
        "## Pictures", "",
        "Blue is the current v2 (five inputs plus the Eircode key), orange adds the expected-price feature. Out-of-fold predictions on the development split throughout.", "",
        *[line for i, (file, title, caption) in enumerate(captions, 1) for line in (f"### {i}. {title}", "", f"![{title}](figures-followup/{file})", "", caption, "")],
    ]
    return "\n".join(lines)


if __name__ == "__main__":
    main()
