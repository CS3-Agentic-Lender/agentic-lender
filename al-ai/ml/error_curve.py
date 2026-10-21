"""Error against valuation: how wrong is each model at different price levels, and does the estimate follow the asking price?

Reads out-of-fold predictions (development folds only). Calibration and the final test are not read.

    python ml/error_curve.py
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

from ml import benchmark as b
from ml import experiments as ex
from ml import figures as fig

HERE = Path(__file__).resolve().parent


def by_price(y, p, edges):
    """Average miss (%) and average estimate (euro) for the homes in each asking-price slice."""
    idx = np.clip(np.searchsorted(edges, y, side="right") - 1, 0, len(edges) - 2)
    miss = [100 * np.mean(np.abs(p[idx == i] - y[idx == i]) / y[idx == i]) for i in range(len(edges) - 1)]
    est = [np.mean(p[idx == i]) for i in range(len(edges) - 1)]
    mid = [np.mean(y[idx == i]) for i in range(len(edges) - 1)]
    return np.array(miss), np.array(est), np.array(mid)


def curves(y, preds: dict, out: Path, slices: int = 8) -> Path:
    """preds: label -> out-of-fold estimates. Left: average miss by price level. Right: average estimate against average asking price."""
    edges = np.quantile(y, np.linspace(0, 1, slices + 1))
    colours = [fig.BLUE, fig.ORANGE, "#54A24B", fig.GREY]
    f, (a, c) = plt.subplots(1, 2, figsize=(13, 5.2))
    for (label, p), col in zip(preds.items(), colours):
        miss, est, mid = by_price(y, p, edges)
        a.plot(mid / 1000, miss, marker="o", color=col, label=label)
        c.plot(mid / 1000, est / 1000, marker="o", color=col, label=label)
    lim = [0, np.max(mid) / 1000 * 1.05]
    c.plot(lim, lim, color=fig.RED, ls="--", lw=1.2, label="perfect guess")
    a.set_xlabel("Asking price (€ thousand, average of each slice)")
    a.set_ylabel("Average miss (% of the asking price)")
    a.set_title("How wrong, at each price level")
    c.set_xlabel("Asking price (€ thousand, average of each slice)")
    c.set_ylabel("Average estimate (€ thousand)")
    c.set_title("Does the estimate follow the price?")
    a.legend(frameon=False, loc="upper right")
    c.legend(frameon=False, loc="upper left")
    f.tight_layout()
    out.mkdir(parents=True, exist_ok=True)
    path = out / "error-and-valuation-by-price.png"
    f.savefig(path, dpi=150)
    plt.close(f)
    return path


def by_estimate(y, p, edges):
    """Slice by the ESTIMATE (what a user sees). Returns the average estimate, average asking price and median over/under (%) per slice."""
    idx = np.clip(np.searchsorted(edges, p, side="right") - 1, 0, len(edges) - 2)
    est = np.array([np.mean(p[idx == i]) for i in range(len(edges) - 1)])
    ask = np.array([np.mean(y[idx == i]) for i in range(len(edges) - 1)])
    lean = np.array([100 * np.median((p[idx == i] - y[idx == i]) / y[idx == i]) for i in range(len(edges) - 1)])
    return est, ask, lean


def calibration(y, preds: dict, out: Path, slices: int = 8) -> Path:
    """Slice homes by the estimate. Left: average asking price against the estimate. Right: does the model lean high or low in each slice?"""
    colours = [fig.BLUE, fig.ORANGE, "#54A24B", fig.GREY]
    f, (a, c) = plt.subplots(1, 2, figsize=(13, 5.2))
    top = 0
    for (label, p), col in zip(preds.items(), colours):
        est, ask, lean = by_estimate(y, p, np.quantile(p, np.linspace(0, 1, slices + 1)))
        a.plot(est / 1000, ask / 1000, marker="o", color=col, label=label)
        c.plot(est / 1000, lean, marker="o", color=col, label=label)
        top = max(top, est.max() / 1000)
    a.plot([0, top * 1.05], [0, top * 1.05], color=fig.RED, ls="--", lw=1.2, label="perfect")
    c.axhline(0, color=fig.RED, ls="--", lw=1.2, label="no lean")
    c.axhspan(-2, 2, color=fig.GREY, alpha=0.2)
    a.set_xlabel("What the model says (€ thousand, average of each slice)")
    a.set_ylabel("Average asking price of those homes (€ thousand)")
    a.set_title("When the model says X, what do homes ask?")
    c.set_xlabel("What the model says (€ thousand, average of each slice)")
    c.set_ylabel("Median over (+) or under (-) estimate (%)")
    c.set_title("Does it lean high or low? (grey = within 2%)")
    a.legend(frameon=False, loc="upper left")
    c.legend(frameon=False, loc="upper left")
    f.tight_layout()
    path = out / "calibration-by-estimate.png"
    f.savefig(path, dpi=150)
    plt.close(f)
    return path


def versions(out: Path) -> Path:
    """Every version side by side, from the committed result files (development folds): average miss and share within 10%."""
    import json
    rep = HERE / "reports"
    tun = json.loads((rep / "tuning-results.json").read_text())["results"]
    v2 = json.loads((rep / "v2-models-results.json").read_text())["results"]
    more = json.loads((rep / "more-rows-results.json").read_text())["arm_80"]
    pick = lambda r: (r["cv_mape"], r["ppe10"])
    base, v1 = tun["baseline"], tun["hist_gradient_boosting (tuned)"]
    rows = [("Dumb guess (median price per m\u00b2)", base["cv_mape"], base["pooled"]["ppe10"], fig.GREY),
            ("v1: HistGradientBoosting, 5 inputs", v1["cv_mape"], v1["pooled"]["ppe10"], fig.BLUE)]
    for label, key in [("v2: HistGradientBoosting + Eircode", "hist_gradient_boosting (single)"), ("v2: CatBoost + Eircode", "catboost (single)"),
                       ("v2: neural net + Eircode", "mlp (single)"), ("v2: GPBoost + Eircode", "gpboost (county + routing-key random effects)"),
                       ("v2: average of three models", "equal average of the three (single seeds)"),
                       ("v2: average of three, each run several times", "equal average of the three (each bagged)")]:
        rows.append((label, *pick(v2[key]), fig.ORANGE))
    rows += [("v2: HistGradientBoosting, 80% of data", *pick(more["hist_gradient_boosting"]), "#54A24B"), ("v2: CatBoost, 80% of data", *pick(more["catboost"]), "#54A24B")]
    f, (a, c) = plt.subplots(1, 2, figsize=(14, 5.6), sharey=True, gridspec_kw={"wspace": 0.05})
    ys = np.arange(len(rows))[::-1]
    for ax, i, title, unit, hi in [(a, 1, "Average miss (lower is better)", "%", 38), (c, 2, "Guesses within 10% of the price (higher is better)", " in 100", 48)]:
        vals = [r[i] for r in rows]
        ax.barh(ys, vals, color=[r[3] for r in rows], height=0.65)
        for y0, v in zip(ys, vals):
            ax.text(v + hi * 0.01, y0, f"{v:.1f}{'%' if i == 1 else ''}", va="center", fontsize=10)
        ax.set_xlim(0, hi)
        ax.set_title(title)
    a.set_yticks(ys)
    a.set_yticklabels([r[0] for r in rows])
    f.text(0.5, -0.01, "Grey: baseline. Blue: v1. Orange: v2 learning from 60% of the houses. Green: v2 learning from 80%. All scored on the same practice houses.", ha="center", fontsize=10)
    f.tight_layout()
    path = out / "all-versions.png"
    f.savefig(path, dpi=150, bbox_inches="tight")
    plt.close(f)
    return path


def main():
    seed = 42
    df, y = ex.load_with_extras(seed)
    X, fold = df[b.FEATURE_COLUMNS], df["fold"].to_numpy()
    bands = [float(np.percentile(y, q)) for q in (25, 50, 75)]
    frozen = ex.model_settings()["hist_gradient_boosting"]
    _, _, v1 = b.cross_validate(lambda: b.make_model("hist_gradient_boosting", seed, frozen), X, y, fold, bands, return_oof=True)
    saved = np.load(HERE.parent / "ml" / "artifacts" / "v2-oof.npz")
    preds = {"v1 (five inputs)": v1, "v2 single model (CatBoost)": saved["catboost (single)"], "v2 average of three models": saved["equal average of the three (single seeds)"]}
    print(curves(y, preds, HERE / "reports" / "figures-v2"))
    print(calibration(y, preds, HERE / "reports" / "figures-v2"))
    print(versions(HERE / "reports" / "figures-v2"))
    for k, p in preds.items():
        miss, _, mid = by_price(y, p, np.quantile(y, np.linspace(0, 1, 9)))
        print(k, [f"{m:.0f}%" for m in miss])


if __name__ == "__main__":
    main()
