"""The rate shock over the active portfolio (AL-68): what each loan costs if every rate rises by 100 to 300 basis points.

All the maths is app.affordability.assess, with its stress margin set to the shock instead of the usual +2 points, so the repayment,
DTI, surplus and bands are the committee's own. This module only loops over the loans and counts. It does no I/O: portfolio_endpoint.py
loads the applications and hands them in.

"Before" is the loan at its benchmark rate with no shock. "After" is the benchmark rate plus the shock. An application's band is the
worse of its DTI band and its surplus band, the way the committee reads the two together.
"""

from dataclasses import dataclass

from app import affordability

ACTIVE_STATUSES = ("Applied", "AI Deliberated", "Underwriter Approved", "Funded")
BANDS = ("Comfortable", "Caution", "Adverse")  # best to worst
SHOCK_MIN_BPS, SHOCK_MAX_BPS, SHOCK_STEP_BPS = 100, 300, 25


@dataclass(frozen=True)
class Loan:
    application_id: str
    loan_eur: float  # a HELOC's requested credit limit, taken as fully drawn, as affordability.heloc_capacity does
    term_years: float
    gross_income_eur: float
    take_home_monthly_eur: float
    debts_monthly_eur: float
    living_costs_monthly_eur: float
    benchmark_rate_pct: float
    rate_source: str  # "stored" (the committee run's own benchmark rate) or "current" (today's ECB rate, as the run has not happened yet)


def worse(a: str, b: str) -> str:
    return a if BANDS.index(a) >= BANDS.index(b) else b


def _result(loan: Loan, shock_bps: int) -> dict:
    a = affordability.assess(
        loan.loan_eur, loan.term_years, loan.benchmark_rate_pct / 100, loan.gross_income_eur, loan.take_home_monthly_eur,
        loan.debts_monthly_eur, loan.living_costs_monthly_eur, stress_margin=shock_bps / 10_000,
    )
    # assess puts its bands on the shocked values; the unshocked ones are banded here with the same functions.
    band_before = worse(affordability.dti_band(a.dti), affordability.surplus_band(a.surplus))
    band_after = worse(a.dti_band, a.surplus_band)
    moved_into = band_after if BANDS.index(band_after) > BANDS.index(band_before) else None
    return {
        "application_id": loan.application_id,
        "rate_source": loan.rate_source,
        "benchmark_rate_pct": loan.benchmark_rate_pct,
        "shocked_rate_pct": round(loan.benchmark_rate_pct + shock_bps / 100, 6),
        "before": {"repayment_eur": round(a.repayment, 2), "dti": round(a.dti, 4), "surplus_eur": round(a.surplus, 2), "band": band_before},
        "after": {
            "repayment_eur": round(a.stressed_repayment, 2), "dti": round(a.stressed_dti, 4),
            "surplus_eur": round(a.stressed_surplus, 2), "band": band_after,
        },
        "moved_into": moved_into,  # "Caution" or "Adverse" when the loan got worse, else None
    }


def _counts(results: list[dict], when: str) -> dict:
    total = len(results)
    out = {}
    for band in BANDS:
        n = sum(1 for r in results if r[when]["band"] == band)
        out[band] = {"count": n, "share_pct": round(100 * n / total, 2) if total else 0.0}
    return out


def run(loans: list[Loan], shock_bps: int) -> dict:
    """The per-application results and the portfolio totals. A loan whose figures the shared maths refuses is skipped and listed, not guessed."""
    results, skipped = [], []
    for loan in loans:
        try:
            results.append(_result(loan, shock_bps))
        except ValueError as exc:
            skipped.append({"application_id": loan.application_id, "reason": str(exc)})
        except TypeError:  # a stored field of the wrong type, such as text where a number belongs
            skipped.append({"application_id": loan.application_id, "reason": "a figure on the application is not a number"})
    return {
        "shock_bps": shock_bps,
        "applications": results,
        "totals": {
            "count": len(results),
            "before": _counts(results, "before"),
            "after": _counts(results, "after"),
            "moved_into_caution": sum(1 for r in results if r["moved_into"] == "Caution"),
            "moved_into_adverse": sum(1 for r in results if r["moved_into"] == "Adverse"),
        },
        "skipped": skipped,
    }
