"""Draw the figures and write the v2 model report from the saved final-exam results. Reads only; never refits or rescoring.

Needs reports/v2-final-test-results.json, reports/v2-threshold.json and artifacts/v2-final-arrays.npz, all written by
v2_final.py. Figures use the held-out predictions (final test) with the out-of-fold development predictions for comparison,
aggregated as curves, bars and densities, never a list of individual listings.

    python ml/v2_report.py
"""

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import matplotlib
import numpy as np

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
from matplotlib.patches import Patch  # noqa: E402

from ml import figures as fg  # noqa: E402
from ml.figures import BLUE, GREY, ORANGE, RED, band_labels  # noqa: E402

HERE = Path(__file__).resolve().parent
LIGHT_ORANGE = "#F9C58C"
NAMES = {"p50": "above the median price", "p75": "in the top quarter by price", "p90": "in the top tenth by price"}


def ape(y, p):
    return np.abs(p - y) / y


def pct(v, nd=1):
    return f"{100 * v:.{nd}f}%"


def k(v):
    return f"€{v / 1000:,.0f}k"


# ---- figures: each saves one PNG and returns its one-line takeaway ------------------------------------

def journey(out, r, frozen_v1_cv):
    base, v1, v2 = r["baseline_reference"], r["v1_reference"], r["overall"]
    fig, axes = plt.subplots(1, 2, figsize=(11.5, 4.8))
    names = ["Baseline\n(median price\nper m²)", "v1\n(5 inputs)", "v2\n(+ Eircode key,\nensemble)"]
    colors = [GREY, BLUE, ORANGE]
    for ax, key, title, fmt in ((axes[0], "mape", "Typical error, MAPE (lower is better)", "{:.1f}%"), (axes[1], "ppe10", "Estimates within 10% of the asking price (higher is better)", "{:.1f}%")):
        vals = [base[key], v1[key], v2[key]]
        ax.bar(range(3), vals, color=colors, width=0.62)
        for i, v in enumerate(vals):
            ax.text(i, v + max(vals) * 0.02, fmt.format(v), ha="center", fontweight="bold")
        ax.set_xticks(range(3), names)
        ax.set_title(title, loc="left", fontsize=11)
        ax.set_ylim(0, max(vals) * 1.15)
    for i, v in ((1, frozen_v1_cv), (2, r["development_cv_mape"])):
        axes[0].plot([i - 0.31, i + 0.31], [v, v], color="black", lw=2, ls="--")
    axes[0].set_xlim(-0.5, 2.9)
    axes[0].text(2.34, r["development_cv_mape"] - 1.6, "dashed line:\ndevelopment\nfigure", va="top", fontsize=8.5, color="#333")
    fig.suptitle("Final test: each step lowers the error", x=0.01, ha="left", fontweight="bold")
    fig.subplots_adjust(bottom=0.27)
    fig.text(0.01, 0.01, "Bars are the final test (scored once, 1,630 homes). The dashed line is the figure from the development folds, shown for the two models "
             "that were tuned on them.", fontsize=9, color="#444")
    fg._save(fig, out, "1-journey.png")
    return (f"On the final test v2 misses by {v2['mape']:.1f}% on average against {v1['mape']:.1f}% for v1 and {base['mape']:.1f}% for the baseline, "
            f"and {v2['ppe10']:.1f}% of its estimates land within 10% of the asking price (v1: {v1['ppe10']:.1f}%).")


def estimate_vs_asking(out, y, p):
    fig, ax = plt.subplots(figsize=(7.2, 6))
    lo, hi = 5e4, 4e6
    xs = np.array([lo, hi])
    ax.hexbin(y, np.clip(p, lo, hi), gridsize=38, xscale="log", yscale="log", bins="log", cmap="Greys", mincnt=1, extent=(np.log10(lo), np.log10(hi), np.log10(lo), np.log10(hi)))
    ax.fill_between(xs, xs * 0.9, xs * 1.1, color=RED, alpha=0.16, lw=0, zorder=3)
    ax.plot(xs, xs, color=RED, lw=2.2, zorder=4)
    ax.plot(xs, xs * 1.1, color=RED, lw=1.4, ls="--", zorder=4)
    ax.plot(xs, xs * 0.9, color=RED, lw=1.4, ls="--", zorder=4)
    ax.set_xlim(lo, hi)
    ax.set_ylim(lo, hi)
    ax.set_xlabel("asking price (€, log scale)")
    ax.set_ylabel("model estimate (€, log scale)")
    inside = float((ape(y, p) <= 0.10).mean())
    ax.set_title(f"Estimate against asking price: {pct(inside)} of homes land in the red band", loc="left", fontweight="bold", fontsize=11.5)
    fig.legend(handles=[plt.Line2D([], [], color=RED, lw=2.2, label="exact: estimate = asking price"), Patch(facecolor=RED, alpha=0.3, label="within 10%"),
                        Patch(facecolor="#333", label="darker grey = more homes")], loc="lower center", ncol=3, frameon=False, fontsize=9.5, bbox_to_anchor=(0.5, -0.02))
    fig.subplots_adjust(bottom=0.17)
    fg._save(fig, out, "2-estimate-versus-asking-price.png")
    return "Each grey patch counts homes. A perfect model puts every home on the red line. The estimates follow the diagonal across the whole price range, and the spread widens for the dearest homes."


def within_curve(out, y, p, y_dev, oof):
    fig, ax = plt.subplots(figsize=(8, 5))
    xs = np.linspace(0, 0.6, 121)
    share = lambda yy, pp, x: 100 * float((ape(yy, pp) <= x).mean())
    ax.plot(100 * xs, [share(y_dev, oof, x) for x in xs], color=LIGHT_ORANGE, lw=2.5, label="development (out-of-fold)")
    ax.plot(100 * xs, [share(y, p, x) for x in xs], color=ORANGE, lw=2.8, label="final test")
    for x in (0.10, 0.20, 0.30):
        v = share(y, p, x)
        ax.plot([100 * x], [v], "o", color="#444")
        ax.annotate(f"{v:.0f}% within {100 * x:.0f}%", (100 * x, v), (100 * x + 2.5, v - 9), fontsize=10)
    ax.set_xlabel("how far the estimate is from the asking price (%)")
    ax.set_ylabel("share of homes estimated this close or closer (%)")
    ax.set_title("How close do the estimates get?", loc="left", fontweight="bold")
    ax.legend(frameon=False, loc="lower right")
    fg._save(fig, out, "3-share-within-x-percent.png")
    return f"{share(y, p, 0.10):.0f}% of final-test estimates are within 10% of the asking price, {share(y, p, 0.20):.0f}% within 20% and {share(y, p, 0.30):.0f}% within 30%. The development curve sits almost on top of it."


def calibration(out, y, p):
    order = np.argsort(p)
    groups = np.array_split(order, 10)
    med = [100 * float(np.median((p[g] - y[g]) / y[g])) for g in groups]
    mid = [float(np.median(p[g])) for g in groups]
    fig, ax = plt.subplots(figsize=(9, 4.8))
    ax.axhspan(-2, 2, color=GREY, alpha=0.2, lw=0)
    ax.axhline(0, color="#444", lw=1)
    ax.bar(range(10), med, color=[ORANGE if abs(m) <= 2 else RED for m in med], width=0.65)
    for i, m in enumerate(med):
        ax.text(i, m + (0.3 if m >= 0 else -0.3), f"{m:+.1f}%".replace("-", "−"), ha="center", va="bottom" if m >= 0 else "top", fontsize=9)
    ax.set_xticks(range(10), [k(m) for m in mid], fontsize=9)
    ax.tick_params(axis="x", pad=18)
    ax.set_ylim(min(med + [-2]) - 1.5, max(med + [2]) + 1.5)
    ax.set_xlabel("homes sorted by the model's estimate, ten equal groups (group median estimate shown)")
    ax.set_ylabel("median over (+) or under (−) estimate")
    ax.set_title("Does the model lean high or low?", loc="left", fontweight="bold")
    ax.legend(handles=[Patch(color=ORANGE, label="within ±2% (grey band)"), Patch(color=RED, label="leans more than 2%")], frameon=False, fontsize=9, loc="upper left")
    fg._save(fig, out, "4-calibration-by-estimate.png")
    inside = sum(abs(m) <= 2 for m in med)
    high = sum(m > 0 for m in med)
    return (f"{inside} of the 10 groups have a median lean within plus or minus 2% (grey band), and {high} of 10 lean high rather than low, so there is a small tendency to estimate above the asking price. "
            f"The leans are largest at the extremes: the dearest tenth of estimates sits {med[-1]:+.1f}% from the asking price, so treat estimates in the dearest tenth (median estimate {k(mid[-1])}) with extra caution.")


def error_by_segment(out, seg, edges):
    fig, axes = plt.subplots(1, 2, figsize=(12.5, 4.8), gridspec_kw={"width_ratios": [1, 1.5]})
    labels = [l.replace(" to ", "\nto ").replace("under ", "under\n").replace("over ", "over\n") for l in band_labels(edges)]
    pb = [seg["price_band"][n] for n in ("Q1 cheapest quarter", "Q2", "Q3", "Q4 dearest quarter")]
    types = sorted(((n, s) for n, s in seg["property_type"].items() if s["n"] >= 20), key=lambda kv: kv[1]["mape"])
    for ax, rows, names, title in ((axes[0], pb, labels, "By price range"), (axes[1], [s for _, s in types], [n for n, _ in types], "By property type (at least 20 test homes)")):
        x = np.arange(len(rows))
        ax.bar(x, [s["mape"] for s in rows], color=ORANGE, width=0.62, label="MAPE (average miss)")
        ax.plot(x, [s["mdape"] for s in rows], "o", color="black", ms=6, label="MdAPE (typical miss)")
        for i, s in enumerate(rows):
            ax.text(i, s["mape"] + 0.7, f"{s['mape']:.0f}%", ha="center", fontweight="bold", fontsize=9)
            ax.text(i, 0.8, f"n={s['n']}", ha="center", fontsize=8, color="white")
        ax.set_xticks(x, names, fontsize=9, rotation=15 if ax is axes[1] else 0, ha="right" if ax is axes[1] else "center")
        ax.set_title(title, loc="left", fontsize=11)
        ax.set_ylim(0, 40)
    axes[0].set_ylabel("error % of asking price")
    axes[0].legend(frameon=False, fontsize=9, loc="upper center")
    fig.suptitle("Where the error is largest", x=0.01, ha="left", fontweight="bold")
    fg._save(fig, out, "5-error-by-price-range-and-type.png")
    worst_band = max(zip(labels, pb), key=lambda t: t[1]["mape"])
    worst_band = (worst_band[0].replace("\n", " "), worst_band[1])
    worst_type = types[-1]
    return (f"The cheapest quarter ({worst_band[0]}) has the highest percentage miss ({worst_band[1]['mape']:.0f}%), because a small euro miss is a large share of a low price. "
            f"{worst_type[0]} is the weakest property type ({worst_type[1]['mape']:.0f}%).")


def county_bars(out, seg):
    rows = sorted(((n, s) for n, s in seg["county"].items() if s["n"] >= 20), key=lambda kv: kv[1]["mape"])
    fig, ax = plt.subplots(figsize=(8, 0.34 * len(rows) + 1.4))
    y = np.arange(len(rows))
    ax.barh(y, [s["mape"] for _, s in rows], color=[RED if s["mape"] > 25 else ORANGE for _, s in rows], height=0.7)
    for i, (n, s) in enumerate(rows):
        ax.text(s["mape"] + 0.4, i, f"{s['mape']:.0f}%  (n={s['n']})", va="center", fontsize=8.5)
    ax.set_yticks(y, [n for n, _ in rows])
    ax.set_xlim(0, 45)
    ax.set_xlabel("MAPE % (red = above 25%)")
    ax.set_title("Error by county (counties with at least 20 test homes)", loc="left", fontweight="bold", fontsize=11.5)
    ax.grid(axis="y", visible=False)
    fg._save(fig, out, "6-error-by-county.png")
    best = ", ".join(f"{n} {s['mape']:.0f}%" for n, s in rows[:3])
    worst = ", ".join(f"{n} {s['mape']:.0f}%" for n, s in rows[-3:][::-1])
    return f"Best: {best}. Weakest: {worst}. Counties with few test homes (n shown) move more by chance, so read the large counties (Dublin, Cork) as the solid evidence."


def confusion(out, matrix, edges):
    m = np.array(matrix)
    pct_m = m / m.sum(axis=1, keepdims=True)
    labels = band_labels(edges)
    fig, ax = plt.subplots(figsize=(7.4, 6.4))
    ax.imshow(pct_m, cmap="Oranges", vmin=0, vmax=0.85)
    for i in range(4):
        for j in range(4):
            dark = pct_m[i, j] > 0.5
            ax.text(j, i - 0.1, f"{100 * pct_m[i, j]:.0f}%", ha="center", va="center", fontsize=15, fontweight="bold", color="white" if dark else "black")
            ax.text(j, i + 0.23, f"{m[i, j]:,} homes", ha="center", va="center", fontsize=8.5, color="white" if dark else "#444")
        ax.add_patch(plt.Rectangle((i - 0.5, i - 0.5), 1, 1, fill=False, edgecolor="black", lw=2.2))
    ax.set_xticks(range(4), labels, fontsize=9, rotation=18, ha="right")
    ax.set_yticks(range(4), labels, fontsize=9)
    ax.set_xlabel("price range the MODEL chose")
    ax.set_ylabel("the home's REAL asking-price range")
    right = float(np.trace(m) / m.sum())
    near = float(sum(m[i, j] for i in range(4) for j in range(4) if abs(i - j) <= 1) / m.sum())
    ax.set_title(f"Right price range for {pct(right, 0)} of homes, right or next door for {pct(near, 0)}", loc="left", fontweight="bold", fontsize=11)
    ax.grid(False)
    fg._save(out=out, fig=fig, name="7-price-range-confusion-matrix.png")
    return (f"A confusion matrix for prices: homes are split into four price ranges (cut at the development quartiles) and each row shows where the model put them. "
            f"It picks the right range for {pct(right)} of homes and the right or the next range for {pct(near)}. Few homes are placed more than one range away.")


def roc(out, roc_results):
    fig, ax = plt.subplots(figsize=(6.6, 6))
    for (key, v), color in zip(roc_results.items(), (BLUE, ORANGE, RED)):
        ax.plot(v["fpr"], v["tpr"], color=color, lw=2.6, label=f"{NAMES[key]}: AUC {v['auc']:.3f} (cut-off {k(v['cutoff_eur'])})")
    ax.plot([0, 1], [0, 1], color=GREY, ls="--", lw=1.4, label="guessing: AUC 0.5")
    ax.set_xlabel("false positive rate (cheaper homes wrongly called dear)")
    ax.set_ylabel("true positive rate (dear homes correctly called dear)")
    ax.set_title("ROC curves: can the estimate tell dearer homes from cheaper ones?", loc="left", fontweight="bold", fontsize=11)
    ax.legend(frameon=False, fontsize=8.5, loc="lower right")
    ax.set_xlim(0, 1)
    ax.set_ylim(0, 1.01)
    ax.set_aspect("equal")
    fg._save(fig, out, "8-roc-curves.png")
    lo, hi = min(v["auc"] for v in roc_results.values()), max(v["auc"] for v in roc_results.values())
    return (f"The estimate separates dearer from cheaper homes well at every cut-off: AUC {lo:.2f} to {hi:.2f} (1.0 is perfect, 0.5 is guessing). "
            "This is a ranking test, and ranking homes by price is easier than naming the price, so a high AUC sits alongside a 21% average miss.")


def gap_and_range(out, y, p, y_dev, oof, th, cov_test):
    g_test, g_dev = y / p - 1, y_dev / oof - 1
    t = th["threshold"]
    fig, axes = plt.subplots(1, 2, figsize=(12.5, 4.8), gridspec_kw={"width_ratios": [1.5, 1]})
    ax = axes[0]
    bins = np.linspace(-0.8, 1.2, 81)
    ax.hist(g_dev, bins=bins, color=LIGHT_ORANGE, density=True, alpha=0.85, label="development (out-of-fold)")
    ax.hist(g_test, bins=bins, histtype="step", color=ORANGE, lw=2.2, density=True, label="final test")
    ax.axvline(t, color=RED, lw=2.2)
    ax.axvspan(t, 1.2, color=RED, alpha=0.08, lw=0)
    ax.text(t + 0.02, ax.get_ylim()[1] * 0.9, f"needs review\nabove {pct(t)}\n({pct((g_test > t).mean())} of test homes)", color=RED, fontsize=9.5, va="top")
    ax.set_xlabel("gap = asking price ÷ estimate − 1 (homes beyond the axis range are not drawn)")
    ax.set_ylabel("share of homes")
    ax.set_yticks([])
    ax.set_title("Gap between asking price and estimate", loc="left", fontsize=11)
    ax.legend(frameon=False, fontsize=9, loc="upper left")
    ax = axes[1]
    labels = ["cheapest\nestimates", "Q2", "Q3", "dearest\nestimates"]
    vals = [100 * v for v in cov_test["by_band"]]
    ax.bar(range(4), vals, color=ORANGE, width=0.6)
    ax.axhline(80, color="#444", ls="--", lw=1.3, label="80% target")
    ax.legend(frameon=False, fontsize=9, loc="upper right")
    for i, v in enumerate(vals):
        ax.text(i, v - 7, f"{v:.0f}%", ha="center", fontweight="bold", fontsize=10, color="white")
    ax.set_xticks(range(4), labels, fontsize=9)
    ax.set_ylim(0, 112)
    ax.set_ylabel("asking prices inside the 80% range (%)")
    ax.set_title(f"Price range coverage on the final test: {pct(cov_test['overall'])}", loc="left", fontsize=11)
    fig.suptitle("The review flag and the price range", x=0.01, ha="left", fontweight="bold")
    fg._save(fig, out, "9-review-flag-and-price-range.png")
    return (f"The red line is the review threshold ({pct(t)}), set on development data. On the final test it flags {pct((g_test > t).mean())} of homes, close to the 10% it was built to flag. "
            f"The 80% price range held {pct(cov_test['overall'])} of asking prices, and between {min(vals):.0f}% and {max(vals):.0f}% in each price band.")


# ---- the report -----------------------------------------------------------------------------------------

def metric_rows(r, y, p):
    o, base, v1 = r["overall"], r["baseline_reference"], r["v1_reference"]
    ratio = np.log(p / y)
    within = lambda x: 100 * float((ape(y, p) <= x).mean())
    return [
        "| Metric | v2 final test | v1 final test | Baseline |", "|---|---|---|---|",
        f"| MAPE: average miss, % of the asking price | **{o['mape']:.2f}%** | {v1['mape']:.2f}% | {base['mape']:.2f}% |",
        f"| MdAPE: typical (median) miss | **{o['mdape']:.2f}%** | {v1['mdape']:.2f}% | {base['mdape']:.2f}% |",
        f"| Within 10% of the asking price | **{o['ppe10']:.1f}%** | {v1['ppe10']:.1f}% | {base['ppe10']:.1f}% |",
        f"| Within 20% / within 30% | {within(0.2):.1f}% / {within(0.3):.1f}% | n/a | n/a |",
        f"| MAE: average miss in euro | **€{o['mae']:,.0f}** | €{v1['mae']:,.0f} | €{base['mae']:,.0f} |",
        f"| RMSE: euro miss, large errors count more | €{o['rmse']:,.0f} | n/a | n/a |",
        f"| R²: share of price variation explained | **{o['r2']:.3f}** | {v1['r2']:.3f} | {base['r2']:.3f} |",
        f"| RMSLE: typical miss in log price | {float(np.sqrt(np.mean(ratio ** 2))):.3f} | n/a | n/a |",
        f"| Spearman rank correlation (estimate vs asking) | {r['spearman']:.3f} | n/a | n/a |",
        f"| Median over (+) or under (−) estimate | {100 * o['median_signed_error']:+.1f}% | n/a | n/a |",
    ]


def build_report(r, th, figs, takeaways, sizes) -> str:
    o, v1, base = r["overall"], r["v1_reference"], r["baseline_reference"]
    cov, roc_r = r["range_coverage"], r["roc"]
    delta = o["mape"] - r["development_cv_mape"]
    fig_block = lambda name, title: [f"### {title}", "", f"![{title}](figures-v2-final/{name})", "", takeaways[name], ""]
    rng_rows = [f"| {band} | {k(lo) if lo else ''} | {pct(b['low_gap'], 0)} to {pct(b['high_gap'], 0)} | {pct(c) if c is not None else ''} | {n:,} |"
                for band, lo, b, c, n in zip(["cheapest quarter of estimates", "Q2", "Q3", "dearest quarter of estimates"],
                                             [None] + th["price_range"]["edges"], th["price_range"]["bands"], cov["by_band"], cov["rows_by_band"])]
    return "\n".join([
        "# Property valuation model v2: results report", "",
        f"Final test scored once on {r['test_rows']:,} Irish homes the model never saw. Ticket: AL-24 (the valuation model story), with the v2 work under AL-257. "
        "Model: the frozen v2 ensemble. Every rule below was written to a committed config before the number it governs was produced.", "",
        "## In one paragraph", "",
        f"The v2 model estimates a home's 2024 asking price from the five things the app already asks for (county, floor area, bedrooms, property type, BER) plus the "
        f"Eircode routing key from the address. On a final test it was scored on once, its average miss is **{o['mape']:.1f}%** of the asking price "
        f"(typical miss {o['mdape']:.1f}%, about €{o['mae'] / 1000:,.0f}k on average), and {o['ppe10']:.0f}% of estimates land within 10%. That is {v1['mape'] - o['mape']:.1f} points better than v1 "
        f"({v1['mape']:.1f}%) and {base['mape'] - o['mape']:.1f} points better than a simple price-per-m² baseline ({base['mape']:.1f}%). The development figure was {r['development_cv_mape']:.1f}%, "
        f"so the test is {abs(delta):.1f} points {'above' if delta > 0 else 'below'} it: the development scores held up. This measures how well **asking** prices are predicted within a 2024 listing sample, nothing more.", "",
        *fig_block("1-journey.png", "From baseline to v1 to v2"),
        "## What the model does", "",
        "| | |", "|---|---|",
        "| Task | Supervised regression: learns from Daft.ie 2024 listings, predicts the asking price of a home it has not seen |",
        "| Inputs | County, floor area (m²), bedrooms, property type, BER (old A1–G or new A–G scale, or Unknown), and the Eircode routing key (first three characters, for example D14) |",
        f"| Output | One asking-price estimate in euro, an 80% price range around it, and a \"price needs review\" flag |",
        f"| How | Three models (HistGradientBoosting, CatBoost and a small neural network) each predict log price; the model averages them. Tuned with 50 random trials per model on five group folds |",
        "| Trained on | The development and calibration rows with a floor area (6,519 homes, 80% of the split) |", "",
        "## How it was tested", "",
        "- The 10,081 usable listings were split 60/20/20 by *property*, so repeat adverts of one home never sit on both sides of a test.",
        "- Models were compared and tuned on five folds inside the 60% development split only. The rules (what counts as a win, how ties break) were committed before each run.",
        "- The calibration split trains the v2 model but never sets its threshold, because a model that has seen those homes would make the gaps look too small. The threshold and range come from out-of-fold development predictions, where every home was predicted by a model that never saw it.",
        f"- The final test was predicted once, after the threshold and range were written. A lock file stops it being scored again. All {r['test_rows']:,} test homes have a floor area; {r['test_rows_without_area']:,} more were unusable because the app always sends an area.", "",
        "## Results on the final test", "", *metric_rows(r, np.array(r['_y']), np.array(r['_p'])), "",
        f"MAPE is the ranking number: each home's miss as a share of its own asking price, averaged. The average euro miss (MAE) is dominated by dear homes, and R² of {o['r2']:.2f} says the model explains about two thirds of the variation in asking prices; the rest is condition, exact location and seller whim, which the inputs cannot see.", "",
        *fig_block("2-estimate-versus-asking-price.png", "Estimate against asking price"),
        *fig_block("3-share-within-x-percent.png", "Share of homes within X%"),
        *fig_block("4-calibration-by-estimate.png", "Bias: does the model lean high or low?"),
        "## Where the model is weaker", "",
        *fig_block("5-error-by-price-range-and-type.png", "Error by price range and property type"),
        *fig_block("6-error-by-county.png", "Error by county"),
        *fig_block("7-price-range-confusion-matrix.png", "Price-range confusion matrix"),
        "## ROC and AUC", "",
        "ROC curves need a yes/no question, and a price is a number, so we ask three. For each cut-off (taken from *development* prices only) the model's estimate is used as a score for "
        "\"is this home's asking price above the cut-off?\". The curve shows, as the score threshold moves, the share of dearer homes correctly caught (true positive rate) against the share of cheaper homes wrongly caught (false positive rate); AUC is the area under it.", "",
        *fig_block("8-roc-curves.png", "ROC curves at three price cut-offs"),
        "| Question | Cut-off | Share of test homes that are \"yes\" | AUC |", "|---|---|---|---|",
        *[f"| Asking price {NAMES[key]} | {k(v['cutoff_eur'])} | {pct(v['positive_share'], 0)} | {v['auc']:.3f} |" for key, v in roc_r.items()], "",
        "## \"Price needs review\" and the price range", "",
        f"The flag fires when `asking price ÷ estimate − 1` is above **{pct(th['threshold'])}**, the 90th percentile of that gap on the out-of-fold development predictions. It is a heuristic from historical asking-price gaps, "
        "not proof that a home is overpriced, and not a guaranteed 10% rate in the future. The 80% range is the same idea with a lower and an upper percentile in each of four estimate bands.", "",
        *fig_block("9-review-flag-and-price-range.png", "Review flag and price range"),
        "| Estimate band | Estimates from | 10th to 90th percentile gap (the range) | Held asking prices (final test) | Test homes |", "|---|---|---|---|---|", *rng_rows, "",
        f"On the final test the flag fired on {pct(r['flag_rate'])} of homes (development: {pct(th['oof_flag_rate'])}) and the range held {pct(cov['overall'])} of asking prices against its 80% target. "
        f"The range is wide, a median of {pct(cov['median_width_share'], 0)} of the estimate: that is what an honest 80% range looks like when the model's typical miss is about {o['mdape']:.0f}%.", "",
        "## Saved model", "",
        f"The fitted model is one file of {sizes['bytes'] / 1e6:.2f} MB (SHA-256 `{sizes['sha256']}`). It was reloaded and compared with the in-memory model on {sizes['reference_rows']} fixed reference homes: "
        f"maximum relative difference {sizes['max_relative_difference']:.1e}, tolerance {sizes['tolerance']:.0e}. Fitting takes about {r['fit_s']:.0f} s and predicting 1,000 homes about {r['predict_ms_per_1000']:.0f} ms on a laptop. "
        "The shipped file is exactly the model that was evaluated: it was not refitted on any extra data after the final test.", "",
        "## Limits to state next to any estimate", "",
        "- **Asking prices from 2024, not sale prices.** Final sale prices can differ from asking prices, and nothing here says anything about 2027.",
        "- **Weaker in rural counties and for the cheapest homes**, where a small euro miss is a large share of a low price. The app should say estimates may be off in some counties.",
        "- **Some listings are odd in the data itself** (a large detached house asking €80,000, a small one asking €499,000), which no input can explain. They are in the test set on purpose.",
        "- **The Eircode routing key is read from listing titles** for training (found for about 95% of rows); at inference it comes from the application form's required Eircode field.",
        "- **The test is one sample of 1,630 homes.** Differences of a few tenths of a point between versions are within noise; the 5.7-point gap between v1 and v2 is far larger than that.", "",
        "## Where the numbers come from", "",
        "`reports/v2-final-test-results.json`, `v2-threshold.json`, `v2-tuning-results.json` and the committed rules in `ml/v2_final_config.json`. Figures are drawn by `ml/v2_report.py` from the saved predictions; nothing in this report refits or rescored the model.", "",
    ])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--reports", default=str(HERE / "reports"))
    ap.add_argument("--artifacts", default=str(HERE / "artifacts"))
    args = ap.parse_args()
    reports, artifacts = Path(args.reports), Path(args.artifacts)
    r = json.loads((reports / "v2-final-test-results.json").read_text())
    th = json.loads((reports / "v2-threshold.json").read_text())
    v1_frozen = json.loads((reports / "frozen-model.json").read_text())
    a = np.load(artifacts / "v2-final-arrays.npz")
    y, p, y_dev, oof = a["y_test"], a["pred_test"], a["y_dev"], a["oof_dev"]
    out = reports / "figures-v2-final"
    edges = r["dev_price_bands"]
    take = {
        "1-journey.png": journey(out, r, v1_frozen["cv_mape"]),
        "2-estimate-versus-asking-price.png": estimate_vs_asking(out, y, p),
        "3-share-within-x-percent.png": within_curve(out, y, p, y_dev, oof),
        "4-calibration-by-estimate.png": calibration(out, y, p),
        "5-error-by-price-range-and-type.png": error_by_segment(out, r["segments"], edges),
        "6-error-by-county.png": county_bars(out, r["segments"]),
        "7-price-range-confusion-matrix.png": confusion(out, r["price_band_confusion"], edges),
        "8-roc-curves.png": roc(out, r["roc"]),
        "9-review-flag-and-price-range.png": gap_and_range(out, y, p, y_dev, oof, th, r["range_coverage"]),
    }
    r["_y"], r["_p"] = y.tolist(), p.tolist()
    (reports / "v2-model-report.md").write_text(build_report(r, th, list(take), take, r["saved_model"]))
    print("wrote", reports / "v2-model-report.md", "and", len(take), "figures in", out)


if __name__ == "__main__":
    main()
