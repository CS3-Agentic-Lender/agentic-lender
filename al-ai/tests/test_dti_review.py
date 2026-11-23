"""The DTI breakdown saved on the review document (al-core SCHEMA.md, dtiBreakdown). The write itself, and that it never clobbers
the other fields on the document, is tested against the emulator in test_auto_start.py; these pin the map."""

import pytest

from app import dti_review

FIELDS = {
    "incomeMonthlyEur", "takeHomeMonthlyEur", "existingDebtsMonthlyEur", "livingCostsMonthlyEur",
    "newRepaymentMonthlyEur", "stressedRepaymentMonthlyEur",
    "benchmarkRatePct", "stressMarginPct", "stressedRatePct", "rateDate",
    "dtiPct", "stressedDtiPct", "surplusMonthlyEur", "stressedSurplusMonthlyEur",
    "dtiBand", "surplusBand",
}

# The "single first-time buyer" affordability reference case (al-core/test/dti-reference-cases.json) at the 4.00% test rate.
SINGLE = dict(
    loan_eur=240_000, term_years=30, gross_income_eur=60_000, take_home_monthly_eur=3700,
    debts_monthly_eur=0, living_costs_monthly_eur=1500, benchmark_rate_pct=4.0, rate_date="2026-09",
)


def test_the_map_has_exactly_the_schema_fields():
    assert set(dti_review.dti_breakdown(**SINGLE)) == FIELDS


def test_the_reference_case_is_stored_in_euro_to_the_cent_and_plain_percentages():
    # assess() gives repayment 1145.7967..., stressed 1438.9212..., dti 0.229159..., stressed dti 0.287784...,
    # surplus 1054.2032..., stressed surplus 761.0787...
    assert dti_review.dti_breakdown(**SINGLE) == {
        "incomeMonthlyEur": 5000.0,
        "takeHomeMonthlyEur": 3700,
        "existingDebtsMonthlyEur": 0,
        "livingCostsMonthlyEur": 1500,
        "newRepaymentMonthlyEur": 1145.80,
        "stressedRepaymentMonthlyEur": 1438.92,
        "benchmarkRatePct": 4.0,
        "stressMarginPct": 2.0,
        "stressedRatePct": 6.0,
        "rateDate": "2026-09",
        "dtiPct": 22.92,
        "stressedDtiPct": 28.78,
        "surplusMonthlyEur": 1054.20,
        "stressedSurplusMonthlyEur": 761.08,
        "dtiBand": "Comfortable",
        "surplusBand": "Comfortable",
    }


def test_money_is_rounded_to_the_cent_and_the_stressed_rate_has_no_float_slip():
    got = dti_review.dti_breakdown(**{**SINGLE, "gross_income_eur": 65_000, "take_home_monthly_eur": 3900.556, "benchmark_rate_pct": 3.1})
    assert got["incomeMonthlyEur"] == 5416.67  # 65,000 / 12 = 5416.666...
    assert got["takeHomeMonthlyEur"] == 3900.56
    assert got["benchmarkRatePct"] == 3.1 and got["stressedRatePct"] == 5.1


def test_the_bands_follow_the_stressed_figures():
    # 1,200 of debts takes the DTI to 46.9% at the benchmark rate but 52.8% stressed: the band is the stressed one.
    got = dti_review.dti_breakdown(**{**SINGLE, "debts_monthly_eur": 1200, "living_costs_monthly_eur": 800})
    assert got["dtiPct"] <= 50 < got["stressedDtiPct"]
    assert got["dtiBand"] == "Adverse"
    assert got["surplusMonthlyEur"] >= 500 > got["stressedSurplusMonthlyEur"] >= 0
    assert got["surplusBand"] == "Caution"


def test_a_figure_assess_refuses_raises():
    with pytest.raises(ValueError):
        dti_review.dti_breakdown(**{**SINGLE, "gross_income_eur": 0})
