"""The ECB rates a committee run uses, as the figures the Market & Macro agent reads and the benchmark rate the calculations use (AL-291).

Everything comes from `rates.get_rate`, which reads the Firestore cache, asks the ECB when the cache is more than a day old and refuses a
rate older than 3 months. Nothing here has a stand-in or a default: if a rate cannot be had, `RateUnavailable` says which one and why.
"""

from collections.abc import Callable
from dataclasses import dataclass

from app import rates
from app.market_agent import OfficialFigures

GetRate = Callable[[str], rates.Rate]

# figure name -> the series it comes from. Each series gives its rate and the one 12 months before it, both dated.
FIGURES = {
    "ecb_main_refinancing_rate": "ecb_mrr",
    "ie_new_mortgage_rate": "mortgage_ie",
}
BENCHMARK = "mortgage_ie"


@dataclass(frozen=True)
class RunRates:
    official: OfficialFigures
    benchmark_rate_pct: float  # the benchmark mortgage rate the calculations use
    benchmark_rate_month: str  # YYYY-MM, the month it is from

    def evidence(self) -> dict:
        """What the run record keeps, so a saved run shows exactly which rates it used."""
        return {"as_of": self.official.as_of, **self.official.figures, "observed": dict(self.official.observed)}


def load(get_rate: GetRate, today: str) -> RunRates:
    """Fetch both rates. Raises RateUnavailable naming the rate that could not be had; never returns a guess."""
    figures: dict[str, float] = {}
    observed: dict[str, str] = {}
    fetched: dict[str, rates.Rate] = {}
    for stem, series in FIGURES.items():
        try:
            rate = get_rate(series)
        except rates.RateUnavailable as exc:
            raise rates.RateUnavailable(f"the {series} rate is not available: {exc}") from None
        fetched[series] = rate
        figures[f"{stem}_pct"], observed[f"{stem}_pct"] = rate.pct, rate.observed
        if rate.year_earlier_pct is not None:
            figures[f"{stem}_year_earlier_pct"], observed[f"{stem}_year_earlier_pct"] = rate.year_earlier_pct, rate.year_earlier_observed
    benchmark = fetched[BENCHMARK]
    return RunRates(OfficialFigures(today, figures, observed), benchmark.pct, benchmark.month)
