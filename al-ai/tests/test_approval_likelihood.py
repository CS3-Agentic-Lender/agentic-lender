"""The approval likelihood and the figures written beside it (AL-63 criteria 2 and 3). Plain code, no network."""

import copy
import json
from pathlib import Path

import pytest

from app import approval_likelihood as al

SAMPLES = Path(__file__).resolve().parents[1] / "app" / "committee_samples"
MORTGAGE = json.loads((SAMPLES / "mortgage-application.json").read_text())
HELOC = json.loads((SAMPLES / "heloc-application.json").read_text())
RATE = 4.0
CALM = al.ValuationFindings(estimate_eur=450_000, price_needs_review=False, low_model_support=False)


def mortgage(**changes):
    app = copy.deepcopy(MORTGAGE)
    app.update(changes)
    return app


def label(application, valuation=None):
    return al.application_fields(application, benchmark_rate_pct=RATE, valuation=valuation)["approvalLikelihood"]


# ---- one test per branch of the rule order -------------------------------------------------------

def test_unknown_when_the_application_is_incomplete():
    bad = copy.deepcopy(MORTGAGE)
    del bad["property"]["askingPriceEur"]
    assert al.application_fields(bad, benchmark_rate_pct=RATE) == {"approvalLikelihood": "Unknown"}


def test_unknown_when_the_home_is_one_the_valuation_model_does_not_support():
    odd = copy.deepcopy(MORTGAGE)
    odd["property"]["county"] = "Atlantis"
    assert al.application_fields(odd, benchmark_rate_pct=RATE) == {"approvalLikelihood": "Unknown"}


def test_unknown_for_a_heloc_until_the_valuation_estimate_exists_but_the_figures_are_still_written():
    fields = al.application_fields(HELOC, benchmark_rate_pct=RATE)
    assert fields["approvalLikelihood"] == "Unknown" and "dtiPct" in fields and "purchaseLtvPct" not in fields


def test_low_when_stressed_affordability_is_adverse():
    assert label(mortgage(monthlyDebtsEur=1900)) == "Low"  # stressed surplus below zero


def test_medium_when_a_band_is_in_caution():
    assert label(mortgage(monthlyLivingCostsEur=2900)) == "Medium"  # stressed surplus 0 to 500, nothing adverse


def test_medium_when_a_purchase_is_over_the_income_cap():
    over = mortgage(grossIncomeEur=85_000, monthlyTakeHomeEur=6500, monthlyLivingCostsEur=1000)  # 360k is 4.2x
    assert label(over) == "Medium"


def test_medium_when_a_purchase_is_over_90_percent_of_the_asking_price():
    over = mortgage(grossIncomeEur=150_000, monthlyTakeHomeEur=9000, monthlyLivingCostsEur=1000)
    over["property"]["askingPriceEur"] = 390_000  # 360k / 390k = 92.3%
    assert label(over) == "Medium"


def test_high_when_nothing_is_wrong():
    assert label(mortgage(grossIncomeEur=150_000, monthlyTakeHomeEur=9000, monthlyLivingCostsEur=1000)) == "High"


def test_first_match_wins_adverse_beats_a_limit_breach():
    both = mortgage(monthlyDebtsEur=1900, grossIncomeEur=85_000)  # adverse and over the income cap
    assert label(both) == "Low"


# ---- the valuation concern joins the Medium rule once the model estimate is known (criterion 4's data) ----

@pytest.mark.parametrize("concern", [{"price_needs_review": True}, {"low_model_support": True}])
def test_a_valuation_concern_makes_an_otherwise_high_application_medium(concern):
    easy = mortgage(grossIncomeEur=150_000, monthlyTakeHomeEur=9000, monthlyLivingCostsEur=1000)
    assert label(easy) == "High"
    assert label(easy, al.ValuationFindings(450_000, **{"price_needs_review": False, "low_model_support": False, **concern})) == "Medium"


def test_a_valuation_concern_does_not_lift_an_adverse_application():
    assert label(mortgage(monthlyDebtsEur=1900), al.ValuationFindings(450_000, True, True)) == "Low"


def test_a_heloc_with_a_valuation_is_judged_on_its_combined_ltv():
    assert label(HELOC, al.ValuationFindings(600_000, False, False)) == "High"
    over = al.ValuationFindings(estimate_eur=220_000, price_needs_review=False, low_model_support=False)  # (150k+40k)/220k = 86% > 80%
    assert label(HELOC, over) == "Medium"


# ---- criterion 3: the label, never a percentage; the other figures ---------------------------------

def test_the_label_is_one_of_four_words_and_no_percentage_field_is_written():
    for app in (MORTGAGE, HELOC, mortgage(monthlyDebtsEur=1900)):
        fields = al.application_fields(app, benchmark_rate_pct=RATE, valuation=CALM)
        assert fields["approvalLikelihood"] in {"Unknown", "Low", "Medium", "High"}
        assert "approvalLikelihoodPct" not in fields


def test_a_mortgage_gets_its_purchase_price_ltv_and_dti_to_one_decimal_place():
    fields = al.application_fields(MORTGAGE, benchmark_rate_pct=RATE)
    assert fields["purchaseLtvPct"] == 80.0  # 360,000 / 450,000
    assert fields["dtiPct"] == round(fields["dtiPct"], 1) and 0 < fields["dtiPct"] < 100


def test_dti_is_the_debts_plus_the_repayment_at_the_benchmark_rate_over_gross_monthly_income():
    from app import affordability as aff

    expected = (250 + aff.monthly_repayment(360_000, 0.04, 30)) / (95_000 / 12) * 100
    assert al.application_fields(MORTGAGE, benchmark_rate_pct=RATE)["dtiPct"] == round(expected, 1)


def test_a_heloc_has_no_purchase_price_ltv():
    assert "purchaseLtvPct" not in al.application_fields(HELOC, benchmark_rate_pct=RATE, valuation=CALM)


# ---- AL-63 criterion 4: recalculated from a run, with the valuation it produced ------------------------

def run_record(status="complete", estimate=380_000, needs_review=False, warnings=(), rate=3.9):
    """The parts of a committee run record (committee.make_record) that the recalculation reads."""
    steps = {
        "valuation_model": {"ok": True, "output": {"estimate_eur": estimate, "support_warnings": list(warnings)}},
        "calculations": {"ok": True, "output": {
            "benchmark_rate_pct": rate, "valuation_facts": {"price_needs_review": needs_review, "support_warnings": list(warnings)},
        }},
    }
    return {"status": status, "steps": steps}


def test_a_complete_run_gives_the_rate_it_used_and_its_valuation_findings():
    rate, findings = al.from_run(run_record(estimate=410_000, needs_review=True, rate=3.9))
    assert rate == 3.9
    assert findings == al.ValuationFindings(estimate_eur=410_000, price_needs_review=True, low_model_support=False)


def test_a_support_warning_is_low_model_support_but_a_failed_breakdown_is_not():
    from app.valuation_endpoint import BREAKDOWN_WARNING

    assert al.from_run(run_record(warnings=["few homes like this in the training data"]))[1].low_model_support
    assert not al.from_run(run_record(warnings=[BREAKDOWN_WARNING]))[1].low_model_support


def test_a_failed_run_or_one_without_a_valuation_gives_nothing():
    assert al.from_run(run_record(status="failed")) is None
    incomplete = run_record()
    del incomplete["steps"]["calculations"]
    assert al.from_run(incomplete) is None


def test_a_heloc_gets_its_combined_ltv_and_a_label_once_the_estimate_exists():
    valuation = al.ValuationFindings(estimate_eur=380_000, price_needs_review=False, low_model_support=False)
    fields = al.application_fields(HELOC, benchmark_rate_pct=RATE, valuation=valuation)
    assert fields["ltvPct"] == 50.0  # (150,000 owed + 40,000 line) / 380,000
    assert fields["approvalLikelihood"] != "Unknown" and "purchaseLtvPct" not in fields


def test_a_mortgage_never_gets_the_heloc_ltv_field():
    assert "ltvPct" not in al.application_fields(MORTGAGE, benchmark_rate_pct=RATE, valuation=CALM)
