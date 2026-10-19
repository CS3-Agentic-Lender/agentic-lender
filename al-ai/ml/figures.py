"""Pictures for the extra-inputs report: five inputs (blue) against five inputs plus the Eircode routing key (orange).

Every figure uses out-of-fold predictions on the development split, so each point is a prediction for a house the model
was not trained on. Plots are aggregated (bars, curves, density), never a list of individual listings.
Each function saves one PNG and returns the one-line takeaway shown under it in the report.
"""

from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402

BLUE, ORANGE, GREY = "#4C78A8", "#F58518", "#9AA0A6"
BAND_NAMES = ["Q1\ncheapest", "Q2", "Q3", "Q4\ndearest"]
plt.rcParams.update({"font.size": 10, "axes.spines.top": False, "axes.spines.right": False, "axes.grid": True,
                     "grid.alpha": 0.25, "figure.dpi": 100})


def ape(y, p) -> np.ndarray:
    return np.abs(np.asarray(p, float) - y) / y


def share_within(y, p, x: float) -> float:
    """Share of estimates whose error is at most x (0.10 means within 10% of the asking price)."""
    return float((ape(y, p) <= x).mean())


def band_index(values, edges) -> np.ndarray:
    return np.digitize(values, edges)  # 0..3 for three cut points


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


def bars(out: Path, rows: list, five: tuple) -> str:
    """rows: (label, HGB CV MAPE, CatBoost CV MAPE, reference_only, highlight). One bar pair per set of inputs. five is the (HGB, CatBoost) baseline."""
    fig, ax = plt.subplots(figsize=(9, 4.8))
    x = np.arange(len(rows) + 1)
    labels = ["5 inputs\n(today)"] + [r[0] for r in rows]
    h = [five[0]] + [r[1] for r in rows]
    c = [five[1]] + [r[2] for r in rows]
    ref = [False] + [r[3] for r in rows]
    hot = [False] + [r[4] for r in rows]
    for i, (hv, cv, is_ref, is_hot) in enumerate(zip(h, c, ref, hot)):
        color = ORANGE if is_hot else (GREY if is_ref else BLUE)
        ax.bar(i - 0.2, hv, 0.38, color=color, edgecolor="white", **({"hatch": "//", "alpha": 0.55} if is_ref else {}))
        ax.bar(i + 0.2, cv, 0.38, color=color, edgecolor="white", alpha=0.35 if is_ref else 0.6)
        ax.text(i - 0.2, hv + 0.25, f"{hv:.1f}", ha="center", fontsize=8)
        ax.text(i + 0.2, cv + 0.25, f"{cv:.1f}", ha="center", fontsize=8)
    ax.axhline(h[0], color=BLUE, ls="--", lw=1)
    ax.set_xticks(x, labels, fontsize=8)
    ax.set_ylabel("CV MAPE % (lower is better)")
    ax.set_ylim(0, max(h + c) + 3)
    ax.set_title("Error (CV MAPE) for each set of inputs", loc="left", fontweight="bold")
    ax.text(0.99, 0.97, "left bar: HistGradientBoosting, right bar: CatBoost\nhatched grey: reference only, not collectable in the app",
            transform=ax.transAxes, ha="right", va="top", fontsize=8, color="#555")
    _save(fig, out, "1-error-by-input-set.png")
    best = int(np.argmin(h[1:])) + 1 if any(hot) else 1
    return (f"{labels[best].replace(chr(10), ' ')} moves CV MAPE from {h[0]:.2f}% to {h[best]:.2f}% (HistGradientBoosting) and from {c[0]:.2f}% to {c[best]:.2f}% (CatBoost). "
            "Orange is the proposed input, blue the other app-collectable inputs, and hatched grey the reference-only ones (town and coordinates), which show how much more there is to gain.")


def folds(out: Path, five: dict, eircode: dict) -> str:
    """five and eircode map a model name to its five per-fold MAPEs."""
    fig, ax = plt.subplots(figsize=(7, 4.2))
    k = np.arange(1, 6)
    for model, ls in (("hist_gradient_boosting", "-"), ("catboost", "--")):
        ax.plot(k, five[model], ls, marker="o", color=BLUE, label=f"{model}: 5 inputs")
        ax.plot(k, eircode[model], ls, marker="o", color=ORANGE, label=f"{model}: + Eircode key")
    ax.set_xticks(k, [f"fold {i}" for i in k])
    ax.set_ylabel("MAPE % (lower is better)")
    worst = min(f - e for m in five for f, e in zip(five[m], eircode[m]))
    every = worst > 0
    ax.set_title("Error in each of the five folds" + (": better in every fold" if every else ": mixed"), loc="left", fontweight="bold")
    ax.legend(fontsize=8, frameon=False)
    _save(fig, out, "2-every-fold-improves.png")
    return (f"The Eircode key lowers the error in all five folds for both models. The smallest single-fold gain is {worst:.2f} points, so this is not one lucky fold." if every else
            f"The Eircode key does not lower the error in every fold: the worst fold changes by {worst:+.2f} points.")


def within(out: Path, y, p5, pe) -> str:
    fig, ax = plt.subplots(figsize=(7, 4.4))
    xs = np.linspace(0, 0.6, 121)
    for p, color, label in ((p5, BLUE, "5 inputs"), (pe, ORANGE, "+ Eircode key")):
        ax.plot(100 * xs, [100 * share_within(y, p, x) for x in xs], color=color, lw=2, label=label)
    ax.axvline(10, color="#555", ls=":", lw=1)
    a, b = 100 * share_within(y, p5, 0.10), 100 * share_within(y, pe, 0.10)
    ax.annotate(f"within 10%:\n{a:.1f}% to {b:.1f}%", (10, (a + b) / 2), (22, 20), arrowprops={"arrowstyle": "->", "color": "#555"}, fontsize=9)
    ax.set_xlabel("how far the estimate is from the asking price (%)")
    ax.set_ylabel("share of estimates this close or closer (%)")
    ax.set_title("Share of estimates within a given error of the asking price", loc="left", fontweight="bold")
    ax.legend(frameon=False)
    _save(fig, out, "3-share-of-estimates-within-x-percent.png")
    r = lambda x: (100 * share_within(y, p5, x), 100 * share_within(y, pe, x))
    return (f"Within 10% of the asking price: {r(0.10)[0]:.1f}% to {r(0.10)[1]:.1f}%. Within 20%: {r(0.20)[0]:.1f}% to {r(0.20)[1]:.1f}%. "
            f"Within 30%: {r(0.30)[0]:.1f}% to {r(0.30)[1]:.1f}%.")


def density(out: Path, y, p5, pe) -> str:
    fig, axes = plt.subplots(1, 2, figsize=(10, 4.6), sharex=True, sharey=True)
    lo, hi = 5e4, 4e6
    for ax, p, title in ((axes[0], p5, "5 inputs (today)"), (axes[1], pe, "+ Eircode routing key")):
        hb = ax.hexbin(y, np.clip(p, lo, hi), gridsize=40, xscale="log", yscale="log", bins="log", cmap="Blues", mincnt=1, extent=(np.log10(lo), np.log10(hi), np.log10(lo), np.log10(hi)))
        ax.plot([lo, hi], [lo, hi], color="#222", lw=1)
        ax.plot([lo, hi], [lo * 1.1, hi * 1.1], color="#222", lw=0.7, ls=":")
        ax.plot([lo, hi], [lo * 0.9, hi * 0.9], color="#222", lw=0.7, ls=":")
        ax.set_xlim(lo, hi)
        ax.set_ylim(lo, hi)
        ax.set_title(f"{title}: {100 * share_within(y, p, 0.10):.1f}% within 10%", fontsize=10, loc="left")
        ax.set_xlabel("asking price (€)")
    axes[0].set_ylabel("model estimate (€)")
    fig.suptitle("Estimate versus asking price (solid line = exact, dotted = ±10%)", x=0.01, ha="left", fontweight="bold")
    _save(fig, out, "4-estimate-versus-asking-price.png")
    return "Each patch counts houses (darker is more). The closer the cloud hugs the solid line, the better the estimate. The share within the dotted ±10% lines is in each panel title."


def confusion_pair(out: Path, y, p5, pe, edges) -> str:
    fig, axes = plt.subplots(1, 2, figsize=(10, 4.4))
    stats = []
    for ax, p, title in ((axes[0], p5, "5 inputs (today)"), (axes[1], pe, "+ Eircode routing key")):
        m = confusion(y, p, edges)
        pct = m / m.sum(axis=1, keepdims=True)
        im = ax.imshow(pct, cmap="Blues", vmin=0, vmax=0.8)
        for i in range(4):
            for j in range(4):
                ax.text(j, i, f"{100 * pct[i, j]:.0f}%", ha="center", va="center", color="white" if pct[i, j] > 0.45 else "black", fontsize=9)
        right = float(np.trace(m) / m.sum())
        near = float((np.abs(band_index(y, edges) - band_index(p, edges)) <= 1).mean())
        stats.append((right, near))
        ax.set_xticks(range(4), BAND_NAMES, fontsize=8)
        ax.set_yticks(range(4), BAND_NAMES, fontsize=8)
        ax.set_xlabel("price band the model chose")
        ax.set_title(f"{title}: right band {100 * right:.0f}%", fontsize=10, loc="left")
        ax.grid(False)
    axes[0].set_ylabel("home's real price band")
    fig.suptitle("Price-band confusion matrix (each row adds to 100%)", x=0.01, ha="left", fontweight="bold")
    _save(fig, out, "5-price-band-confusion-matrix.png")
    (r5, n5), (re, ne) = stats
    return (f"This is the regression version of a confusion matrix: homes are split into four price bands (cut at the development quartiles €{edges[0]:,.0f}, €{edges[1]:,.0f}, "
            f"€{edges[2]:,.0f}) and each row shows where the model placed them. Right band: {100 * r5:.1f}% to {100 * re:.1f}%. Right band or the one next to it: {100 * n5:.1f}% to {100 * ne:.1f}%.")


def segments(out: Path, band5: dict, bande: dict, county5: dict, countye: dict, top: int = 8) -> str:
    fig, axes = plt.subplots(1, 2, figsize=(11, 4.4), gridspec_kw={"width_ratios": [1, 1.5]})
    names = list(band5)[:4]
    x = np.arange(len(names))
    axes[0].bar(x - 0.2, [band5[n]["mape"] for n in names], 0.38, color=BLUE, label="5 inputs")
    axes[0].bar(x + 0.2, [bande[n]["mape"] for n in names], 0.38, color=ORANGE, label="+ Eircode key")
    axes[0].set_xticks(x, BAND_NAMES, fontsize=8)
    axes[0].set_ylabel("MAPE %")
    axes[0].set_title("By price band", loc="left", fontsize=10)
    axes[0].legend(frameon=False, fontsize=8)
    counties = sorted(county5, key=lambda c: -county5[c]["n"])[:top]
    x = np.arange(len(counties))
    axes[1].bar(x - 0.2, [county5[c]["mape"] for c in counties], 0.38, color=BLUE)
    axes[1].bar(x + 0.2, [countye[c]["mape"] for c in counties], 0.38, color=ORANGE)
    axes[1].set_xticks(x, [f"{c}\n(n={county5[c]['n']:,})" for c in counties], fontsize=8)
    axes[1].set_title(f"By county (the {top} with most listings)", loc="left", fontsize=10)
    fig.suptitle("Error (MAPE) by price band and by county", x=0.01, ha="left", fontweight="bold")
    _save(fig, out, "6-error-by-price-band-and-county.png")
    best = max(counties, key=lambda c: county5[c]["mape"] - countye[c]["mape"])
    bands_better = sum(bande[n]["mape"] < band5[n]["mape"] for n in names)
    counties_better = sum(countye[c]["mape"] < county5[c]["mape"] for c in counties)
    return (f"The error is lower in {bands_better} of {len(names)} price bands and in {counties_better} of the {len(counties)} biggest counties. "
            f"The biggest county gain is {best} ({county5[best]['mape']:.1f}% to {countye[best]['mape']:.1f}%).")


def bias(out: Path, y, p5, pe) -> str:
    fig, ax = plt.subplots(figsize=(7.5, 4.2))
    bins = np.linspace(-0.8, 1.2, 41)
    for p, color, label in ((p5, BLUE, "5 inputs"), (pe, ORANGE, "+ Eircode key")):
        err = np.clip((np.asarray(p) - y) / y, -0.8, 1.2)
        ax.hist(err, bins=bins, histtype="step", lw=2, color=color, label=f"{label} (median {100 * np.median((np.asarray(p) - y) / y):+.1f}%)")
    ax.axvline(0, color="#222", lw=1)
    ax.set_xlabel("estimate minus asking price, as % of asking price (clipped at -80% and +120%)")
    ax.set_ylabel("number of houses")
    ax.set_title("Distribution of the estimate error", loc="left", fontweight="bold")
    ax.legend(frameon=False)
    _save(fig, out, "7-error-distribution.png")
    s5, se = float(np.std(np.clip((np.asarray(p5) - y) / y, -0.8, 1.2))), float(np.std(np.clip((np.asarray(pe) - y) / y, -0.8, 1.2)))
    m5, me = 100 * float(np.median((np.asarray(p5) - y) / y)), 100 * float(np.median((np.asarray(pe) - y) / y))
    return (f"The median error is {m5:+.1f}% with 5 inputs and {me:+.1f}% with the Eircode key (0% means no systematic over- or under-estimate). "
            f"The spread of errors (standard deviation) goes from {100 * s5:.0f} to {100 * se:.0f} percentage points. Some very large misses remain.")
