"""Saves every part of an application's debt-to-income calculation on its underwriter-only review document.

The document is `applications/{id}/review/underwriting` and the map is `dtiBreakdown` (al-core/SCHEMA.md). The portal's DTI
table, the rate-shock endpoint and al-core's mint (which takes `benchmarkRatePct` as the rate when `aprPct` is unset) read it.
Only al-ai writes it, with the Admin SDK. The committee saves it right after its calculations step, with that run's rate.
"""

from google.cloud.firestore import SERVER_TIMESTAMP

from app import affordability as aff

# Everything this module owns on the document. `merge=` takes these field paths as a mask: each one is replaced whole, and
# no other field on the document (riskTier, policyGate, valuationDetail) is touched.
OWNED_FIELDS = ["applicationId", "brokerId", "updatedAt", "dtiBreakdown"]


def _cents(value: float) -> float:
    return round(value, 2)


def dti_breakdown(
    *,
    loan_eur: float,
    term_years: float,
    gross_income_eur: float,
    take_home_monthly_eur: float,
    debts_monthly_eur: float,
    living_costs_monthly_eur: float,
    benchmark_rate_pct: float,
    rate_date: str,
) -> dict:
    """The `dtiBreakdown` map from affordability.assess(), at the benchmark rate and at the stressed rate.

    Money is euro to the cent and percentages are plain numbers to two places (`4.0` is 4%), as al-core's seed stores them.
    The bands come from assess(), on the unrounded stressed figures. Incomes and debts are household totals.
    Raises ValueError for a figure assess() refuses.
    """
    a = aff.assess(
        loan_eur, term_years, benchmark_rate_pct / 100, gross_income_eur, take_home_monthly_eur, debts_monthly_eur, living_costs_monthly_eur,
    )
    stress_margin_pct = round(aff.STRESS_MARGIN * 100, 2)
    return {
        "incomeMonthlyEur": _cents(gross_income_eur / 12),
        "takeHomeMonthlyEur": _cents(take_home_monthly_eur),
        "existingDebtsMonthlyEur": _cents(debts_monthly_eur),
        "livingCostsMonthlyEur": _cents(living_costs_monthly_eur),
        "newRepaymentMonthlyEur": _cents(a.repayment),
        "stressedRepaymentMonthlyEur": _cents(a.stressed_repayment),
        "benchmarkRatePct": benchmark_rate_pct,  # as the run used it, so it is the same rate the mint puts on the note
        "stressMarginPct": stress_margin_pct,
        "stressedRatePct": round(benchmark_rate_pct + stress_margin_pct, 2),
        "rateDate": rate_date,
        "dtiPct": round(a.dti * 100, 2),
        "stressedDtiPct": round(a.stressed_dti * 100, 2),
        "surplusMonthlyEur": _cents(a.surplus),
        "stressedSurplusMonthlyEur": _cents(a.stressed_surplus),
        "dtiBand": a.dti_band,
        "surplusBand": a.surplus_band,
    }


def write_dti_breakdown(db, application_id: str, breakdown: dict, *, transaction=None) -> dict:
    """Save a run's breakdown, replacing whatever the last run saved. Returns the map that was written.

    `db` is a Firestore client. The application is only read, for its broker.
    With `transaction`, the read and the write are made in it, so the caller's checks and this write land together or not at all.
    Raises ValueError if the application does not exist or has no brokerId.
    """
    application = db.collection("applications").document(application_id)
    snapshot = application.get(transaction=transaction)
    if not snapshot.exists:
        raise ValueError(f"Application {application_id} does not exist")
    broker_id = (snapshot.to_dict() or {}).get("brokerId")
    if not broker_id:
        raise ValueError(f"Application {application_id} has no brokerId")
    review = application.collection("review").document("underwriting")
    fields = {"applicationId": application_id, "brokerId": broker_id, "updatedAt": SERVER_TIMESTAMP, "dtiBreakdown": breakdown}
    if transaction is None:
        review.set(fields, merge=OWNED_FIELDS)
    else:
        transaction.set(review, fields, merge=OWNED_FIELDS)
    return breakdown
