"""Pictures for the extra-inputs report: five inputs (blue) against five inputs plus the Eircode routing key (orange).

Every figure uses out-of-fold predictions on the development split, so each point is a prediction for a house the model
was not trained on. Plots are aggregated (bars, curves, density), never a list of individual listings.
Each function saves one PNG and returns the one-line takeaway shown under it in the report.
"""

from pathlib import Path

import matplotlib
import matplotlib.ticker

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
from matplotlib.patches import Patch, Rectangle  # noqa: E402

BLUE, ORANGE, GREY, RED = "#4C78A8", "#F58518", "#9AA0A6", "#D62728"
# What the blue and the orange series are called. set_labels() changes them for a different comparison.
A_LONG, B_LONG, A_SHORT, B_SHORT, B_NAME = "5 inputs (today)", "+ Eircode routing key", "5 inputs", "+ Eircode key", "the Eircode key"


def set_labels(a_long: str, b_long: str, a_short: str, b_short: str, b_name: str) -> None:
    global A_LONG, B_LONG, A_SHORT, B_SHORT, B_NAME
    A_LONG, B_LONG, A_SHORT, B_SHORT, B_NAME = a_long, b_long, a_short, b_short, b_name
plt.rcParams.update({"font.size": 11, "axes.titlesize": 12, "axes.labelsize": 11, "axes.spines.top": False, "axes.spines.right": False,
                     "axes.grid": True, "grid.alpha": 0.25, "figure.dpi": 100})


def ape(y, p) -> np.ndarray:
    return np.abs(np.asarray(p, float) - y) / y


def share_within(y, p, x: float) -> float:
    """Share of estimates whose error is at most x (0.10 means within 10% of the asking price)."""
    return float((ape(y, p) <= x).mean())


def band_index(values, edges) -> np.ndarray:
    return np.digitize(values, edges)  # 0..3 for three cut points


def band_labels(edges) -> list:
    """Price ranges in euro, for example 'under €270k'."""
    k = [f"€{e / 1000:,.0f}k" for e in edges]
    return [f"under {k[0]}", f"{k[0]} to {k[1]}", f"{k[1]} to {k[2]}", f"over {k[2]}"]


def confusion(y, p, edges) -> np.ndarray:
    """Rows are the home's real price band, columns the band the model put it in."""
    m = np.zeros((len(edges) + 1, len(edges) + 1))
    for a, c in zip(band_index(y, edges), band_index(p, edges)):
        m[a, c] += 1
    return m


def _save(fig, out: Path, name: str) -> None:
    out.mkdir(parents=True, exist_ok=True)
    fig.savefig(out / name, dpi=150, bbox_inches="tight", facecolor="white")
    plt.close(fig)


def bars(out: Path, rows: list, five: tuple, base_label: str = "5 inputs\n(today)", blue_text: str = "5 inputs today, or another input the app could collect",
         orange_text: str = "the proposed input") -> str:
    """rows: (label, HGB CV MAPE, CatBoost CV MAPE, reference_only, highlight). One bar pair per set of inputs. five is the (HGB, CatBoost) baseline."""
    fig, ax = plt.subplots(figsize=(11.5, 6.2))
    labels = [base_label] + [r[0] for r in rows]
    h, c = [five[0]] + [r[1] for r in rows], [five[1]] + [r[2] for r in rows]
    ref, hot = [False] + [r[3] for r in rows], [False] + [r[4] for r in rows]
    for i, (hv, cv, is_ref, is_hot) in enumerate(zip(h, c, ref, hot)):
        color = ORANGE if is_hot else (GREY if is_ref else BLUE)
        hatch = {"hatch": "//"} if is_ref else {}
        ax.bar(i - 0.2, hv, 0.38, color=color, edgecolor="white", **hatch)
        ax.bar(i + 0.2, cv, 0.38, color=color, edgecolor="white", alpha=0.55, **hatch)
        ax.text(i - 0.2, hv + 0.3, f"{hv:.1f}", ha="center", fontsize=9)
        ax.text(i + 0.2, cv + 0.3, f"{cv:.1f}", ha="center", fontsize=9)
    ax.axhline(h[0], color=BLUE, ls="--", lw=1)
    ax.set_xticks(range(len(labels)), labels, fontsize=9.5)
    ax.set_ylabel("typical error, CV MAPE % (lower is better)")
    ax.set_ylim(0, max(h + c) + 3)
    ax.set_title("Error for each set of inputs", loc="left", fontweight="bold")
    ax.legend(handles=[Patch(color=BLUE, label=blue_text), Patch(color=ORANGE, label=orange_text),
                       Patch(facecolor=GREY, hatch="//", edgecolor="white", label="reference only: not collectable in the app"),
                       Patch(facecolor="#333", label="darker bar = HistGradientBoosting (the frozen model)"),
                       Patch(facecolor="#333", alpha=0.45, label="lighter bar = CatBoost (second check)")],
              loc="upper center", bbox_to_anchor=(0.5, -0.16), ncol=2, frameon=False, fontsize=9)
    _save(fig, out, "1-error-by-input-set.png")
    best = int(np.argmin(h[1:])) + 1 if any(hot) else 1
    best = max((i for i in range(1, len(h)) if hot[i]), default=best)
    return (f"{labels[best].replace(chr(10), ' ')} moves CV MAPE from {h[0]:.2f}% to {h[best]:.2f}% (HistGradientBoosting) and from {c[0]:.2f}% to {c[best]:.2f}% (CatBoost). "
            "Orange is the proposed input, blue the other app-collectable inputs, and hatched grey the reference-only ones (town and coordinates), which show how much more there is to gain.")


def folds(out: Path, five: dict, eircode: dict) -> str:
    """five and eircode map a model name to its five per-fold MAPEs. Bars, not lines: the folds have no order."""
    fig, axes = plt.subplots(1, 2, figsize=(11, 4.4), sharey=True)
    k = np.arange(5)
    for ax, model, title in ((axes[0], "hist_gradient_boosting", "HistGradientBoosting (the frozen model)"), (axes[1], "catboost", "CatBoost (second check)")):
        ax.bar(k - 0.2, five[model], 0.38, color=BLUE, label=A_SHORT)
        ax.bar(k + 0.2, eircode[model], 0.38, color=ORANGE, label=B_SHORT)
        for i in k:
            ax.text(i - 0.2, five[model][i] + 0.3, f"{five[model][i]:.1f}", ha="center", fontsize=8)
            ax.text(i + 0.2, eircode[model][i] + 0.3, f"{eircode[model][i]:.1f}", ha="center", fontsize=8)
        ax.set_xticks(k, [f"fold {i + 1}" for i in k])
        ax.set_title(title, loc="left", fontsize=11)
    axes[0].set_ylabel("typical error, MAPE % (lower is better)")
    fig.legend(handles=[Patch(color=BLUE, label=A_LONG), Patch(color=ORANGE, label=B_LONG)], loc="upper right", ncol=2, frameon=False, fontsize=10)
    fig.subplots_adjust(top=0.82)
    worst = min(f - e for m in five for f, e in zip(five[m], eircode[m]))
    every = worst > 0
    fig.suptitle("Error in each of the five folds" + (f": {B_NAME} is better in every fold" if every else ": mixed"), x=0.01, ha="left", fontweight="bold")
    fig.text(0.01, -0.02, "Each fold is a random fifth of the houses that was held out while the model trained on the other four fifths. "
             "The folds have no order, so a fold being higher or lower than its neighbour means nothing.", fontsize=9, color="#444", ha="left")
    _save(fig, out, "2-every-fold-improves.png")
    return (f"{B_NAME.capitalize()} lowers the error in all five folds for both models. The smallest single-fold gain is {worst:.2f} points, so this is not one lucky fold." if every else
            f"{B_NAME.capitalize()} does not lower the error in every fold: the worst fold changes by {worst:+.2f} points.")


def within(out: Path, y, p5, pe) -> str:
    fig, ax = plt.subplots(figsize=(8, 5))
    xs = np.linspace(0, 0.6, 121)
    for p, color, label in ((p5, BLUE, A_LONG), (pe, ORANGE, B_LONG)):
        ax.plot(100 * xs, [100 * share_within(y, p, x) for x in xs], color=color, lw=2.5, label=label)
    a, b = 100 * share_within(y, p5, 0.10), 100 * share_within(y, pe, 0.10)
    ax.axvline(10, color="#444", ls="--", lw=1.2)
    ax.plot([10, 10], [a, b], "o", color="#444")
    ax.annotate(f"within 10% of the asking price:\n{a:.1f}% for {A_SHORT}\n{b:.1f}% for {B_SHORT}", (10, b), (24, 18), arrowprops={"arrowstyle": "->", "color": "#444"}, fontsize=10)
    ax.set_xlabel("how far the estimate is from the asking price (%)")
    ax.set_ylabel("share of houses estimated this close or closer (%)")
    ax.set_title("How close do the estimates get to the asking price?", loc="left", fontweight="bold")
    ax.legend(frameon=False, loc="lower right")
    _save(fig, out, "3-share-of-estimates-within-x-percent.png")
    r = lambda x: (100 * share_within(y, p5, x), 100 * share_within(y, pe, x))
    return (f"Within 10% of the asking price: {r(0.10)[0]:.1f}% to {r(0.10)[1]:.1f}%. Within 20%: {r(0.20)[0]:.1f}% to {r(0.20)[1]:.1f}%. "
            f"Within 30%: {r(0.30)[0]:.1f}% to {r(0.30)[1]:.1f}%.")


def density(out: Path, y, p5, pe) -> str:
    fig, axes = plt.subplots(1, 2, figsize=(11.5, 5.4), sharex=True, sharey=True)
    lo, hi = 5e4, 4e6
    xs = np.array([lo, hi])
    for ax, p, title in ((axes[0], p5, A_LONG), (axes[1], pe, B_LONG)):
        ax.hexbin(y, np.clip(p, lo, hi), gridsize=38, xscale="log", yscale="log", bins="log", cmap="Greys", mincnt=1,
                  extent=(np.log10(lo), np.log10(hi), np.log10(lo), np.log10(hi)))
        ax.fill_between(xs, xs * 0.9, xs * 1.1, color=RED, alpha=0.16, lw=0, zorder=3)
        ax.plot(xs, xs, color=RED, lw=2.2, zorder=4)
        ax.plot(xs, xs * 1.1, color=RED, lw=1.6, ls="--", zorder=4)
        ax.plot(xs, xs * 0.9, color=RED, lw=1.6, ls="--", zorder=4)
        ax.set_xlim(lo, hi)
        ax.set_ylim(lo, hi)
        ax.set_title(f"{title}\n{100 * share_within(y, p, 0.10):.1f}% of houses fall inside the red band", fontsize=11, loc="left")
        ax.set_xlabel("asking price (€, log scale)")
    axes[0].set_ylabel("model estimate (€, log scale)")
    fig.legend(handles=[plt.Line2D([], [], color=RED, lw=2.2, label="exact: estimate = asking price"),
                        Patch(facecolor=RED, alpha=0.3, label="within 10% of the asking price"),
                        Patch(facecolor="#333", label="grey patches count houses: darker = more houses")],
               loc="lower center", ncol=3, frameon=False, bbox_to_anchor=(0.5, -0.03), fontsize=10)
    fig.suptitle("Estimate versus asking price: how many houses land in the red band?", x=0.01, y=1.0, ha="left", fontweight="bold")
    fig.subplots_adjust(top=0.80, bottom=0.17, wspace=0.08)
    _save(fig, out, "4-estimate-versus-asking-price.png")
    return "Each grey patch counts houses (darker is more). A perfect model would put every house on the red line, and the shaded band is within 10%. The share inside the band is in each panel title."


def confusion_pair(out: Path, y, p5, pe, edges) -> str:
    labels = band_labels(edges)
    fig, axes = plt.subplots(1, 2, figsize=(13, 6.6))
    fig.subplots_adjust(wspace=0.55, bottom=0.26, top=0.86)
    stats = []
    for ax, p, title in ((axes[0], p5, A_LONG), (axes[1], pe, B_LONG)):
        m = confusion(y, p, edges)
        pct = m / m.sum(axis=1, keepdims=True)
        ax.imshow(pct, cmap="Blues", vmin=0, vmax=0.85)
        for i in range(4):
            for j in range(4):
                dark = pct[i, j] > 0.45
                ax.text(j, i - 0.08, f"{100 * pct[i, j]:.0f}%", ha="center", va="center", fontsize=14, fontweight="bold", color="white" if dark else "black")
                ax.text(j, i + 0.22, f"{int(m[i, j]):,} houses", ha="center", va="center", fontsize=8, color="white" if dark else "#444")
            ax.add_patch(Rectangle((i - 0.5, i - 0.5), 1, 1, fill=False, edgecolor="black", lw=2.2))
        right = float(np.trace(m) / m.sum())
        near = float((np.abs(band_index(y, edges) - band_index(p, edges)) <= 1).mean())
        stats.append((right, near))
        ax.set_xticks(range(4), labels, fontsize=9, rotation=20, ha="right")
        ax.set_yticks(range(4), labels, fontsize=9)
        ax.set_xlabel("price range the MODEL chose")
        ax.set_title(f"{title}: right range for {100 * right:.0f}% of houses", fontsize=11, loc="left")
        ax.grid(False)
    axes[0].set_ylabel("the house's REAL asking-price range")
    fig.suptitle("Did the model put each house in the right price range?", x=0.01, y=0.97, ha="left", fontweight="bold", fontsize=14)
    fig.text(0.01, 0.01, "How to read it: each row is the houses whose real asking price is in that range, and the cells show where the model put them (each row adds to 100%). "
             "The outlined diagonal is the right range. Bigger numbers on the diagonal are better.", fontsize=9.5, color="#333", ha="left", va="bottom", wrap=True)
    _save(fig, out, "5-price-band-confusion-matrix.png")
    (r5, n5), (re, ne) = stats
    return (f"This is the regression version of a confusion matrix: houses are split into four price ranges ({', '.join(labels)}), cut at the quartiles of the development prices, and each row shows where the model placed them. "
            f"Right range: {100 * r5:.1f}% to {100 * re:.1f}%. Right range or the one next to it: {100 * n5:.1f}% to {100 * ne:.1f}%.")


def segments(out: Path, band5: dict, bande: dict, county5: dict, countye: dict, edges, top: int = 8) -> str:
    labels = band_labels(edges)
    fig, axes = plt.subplots(1, 2, figsize=(13, 5), gridspec_kw={"width_ratios": [1, 1.6]})
    names = list(band5)[:4]
    x = np.arange(len(names))
    for dx, d, color, label in ((-0.2, band5, BLUE, A_SHORT), (0.2, bande, ORANGE, B_SHORT)):
        vals = [d[n]["mape"] for n in names]
        axes[0].bar(x + dx, vals, 0.38, color=color, label=label)
        for xi, v in zip(x, vals):
            axes[0].text(xi + dx, v + 0.4, f"{v:.0f}", ha="center", fontsize=9)
    axes[0].set_xticks(x, [lab.replace(" to ", "\nto ") for lab in labels], fontsize=9)
    axes[0].set_ylabel("typical error, MAPE % (lower is better)")
    axes[0].set_xlabel("the house's asking price")
    axes[0].set_title("By price range", loc="left", fontsize=11)
    axes[0].legend(frameon=False, fontsize=9)
    counties = sorted(county5, key=lambda c: -county5[c]["n"])[:top]
    x = np.arange(len(counties))
    for dx, d, color in ((-0.2, county5, BLUE), (0.2, countye, ORANGE)):
        vals = [d[c]["mape"] for c in counties]
        axes[1].bar(x + dx, vals, 0.38, color=color)
        for xi, v in zip(x, vals):
            axes[1].text(xi + dx, v + 0.4, f"{v:.0f}", ha="center", fontsize=9)
    axes[1].set_xticks(x, [f"{c}\nn={county5[c]['n']:,}" for c in counties], fontsize=9)
    axes[1].set_xlabel("county, and how many houses it has")
    axes[1].set_title(f"By county (the {top} with most listings)", loc="left", fontsize=11)
    fig.suptitle("Typical error by price range and by county", x=0.01, ha="left", fontweight="bold", fontsize=14)
    _save(fig, out, "6-error-by-price-band-and-county.png")
    best = max(counties, key=lambda c: county5[c]["mape"] - countye[c]["mape"])
    bands_better = sum(bande[n]["mape"] < band5[n]["mape"] for n in names)
    counties_better = sum(countye[c]["mape"] < county5[c]["mape"] for c in counties)
    return (f"The error is lower in {bands_better} of {len(names)} price ranges and in {counties_better} of the {len(counties)} biggest counties. "
            f"The biggest county gain is {best} ({county5[best]['mape']:.1f}% to {countye[best]['mape']:.1f}%).")


def bias(out: Path, y, p5, pe) -> str:
    fig, ax = plt.subplots(figsize=(8.5, 4.8))
    bins = np.linspace(-0.8, 1.2, 41)
    for p, color, label in ((p5, BLUE, A_SHORT), (pe, ORANGE, B_SHORT)):
        err = np.clip((np.asarray(p) - y) / y, -0.8, 1.2)
        ax.hist(err, bins=bins, histtype="step", lw=2.5, color=color, label=f"{label} (median {100 * np.median((np.asarray(p) - y) / y):+.1f}%)")
    ax.axvline(0, color="#222", lw=1.2)
    ax.xaxis.set_major_formatter(matplotlib.ticker.PercentFormatter(1.0, decimals=0))
    ax.set_xlabel("estimate minus asking price, as % of the asking price (clipped at -80% and +120%)")
    ax.set_ylabel("number of houses")
    ax.set_title("Distribution of the estimate error", loc="left", fontweight="bold")
    ax.legend(frameon=False)
    _save(fig, out, "7-error-distribution.png")
    s5, se = float(np.std(np.clip((np.asarray(p5) - y) / y, -0.8, 1.2))), float(np.std(np.clip((np.asarray(pe) - y) / y, -0.8, 1.2)))
    m5, me = 100 * float(np.median((np.asarray(p5) - y) / y)), 100 * float(np.median((np.asarray(pe) - y) / y))
    return (f"The median error is {m5:+.1f}% with {A_SHORT} and {me:+.1f}% with {B_NAME} (0% means no systematic over- or under-estimate). "
            f"The spread of errors (standard deviation) goes from {100 * s5:.0f} to {100 * se:.0f} percentage points. Some very large misses remain.")
