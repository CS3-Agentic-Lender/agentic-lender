"""The risk tier and LTV band (AL-246): the same rule, and the same worked cases, as al-core/SCHEMA.md "Risk tier rule"."""

import json
from pathlib import Path

import pytest

from app import affordability as aff
from app.risk_tier import RiskFindings, has_low_support, ltv_band, ltv_ratio, risk_tier, write_risk
from app.valuation_endpoint import BREAKDOWN_WARNING

SHARED_CASES = Path(__file__).resolve().parents[2] / "al-core" / "test" / "risk-tier-examples.json"
CASES = json.loads(SHARED_CASES.read_text())


def findings_from_case(case) -> RiskFindings:
    """The JSON uses al-core's names: `askingPriceEur` is the home's value for a HELOC, the asking price for a mortgage."""
    app, found = case["application"], case["findings"]
    return RiskFindings(
        loan_type=app["loanType"],
        first_time_buyer=app.get("firstTimeBuyer", False),
        gross_annual_income=app["grossIncomeEur"],
        loan=app["loanAmountEur"],
        existing_mortgage_balance=app.get("existingMortgageBalanceEur", 0),
        value=app["askingPriceEur"],
        stressed_dti_band=found["stressedDti"],
        surplus_band=found["surplus"],
        price_needs_review=found.get("priceNeedsReview", False),
        low_model_support=found.get("lowModelSupport", False),
    )


def mortgage(**changes) -> RiskFindings:
    """A mortgage with no concerns: exactly 80% of the price, 3.6x income, both bands Comfortable."""
    base = dict(
        loan_type="mortgage", first_time_buyer=True, gross_annual_income=75_000, loan=270_000, existing_mortgage_balance=0,
        value=337_500, stressed_dti_band="Comfortable", surplus_band="Comfortable", price_needs_review=False, low_model_support=False,
    )
    return RiskFindings(**{**base, **changes})


def heloc(**changes) -> RiskFindings:
    base = dict(
        loan_type="heloc", first_time_buyer=False, gross_annual_income=100_000, loan=40_000, existing_mortgage_balance=300_000,
        value=400_000, stressed_dti_band="Comfortable", surplus_band="Comfortable", price_needs_review=False, low_model_support=False,
    )
    return RiskFindings(**{**base, **changes})


# ---- the shared worked cases (the same file al-core's own test checks) ---------------------

@pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
def test_the_tier_matches_the_shared_worked_case(case):
    assert risk_tier(findings_from_case(case)) == case["tier"], case["why"]


# ---- the tier rule ---------------------------------------------------------------------------

def test_an_adverse_band_is_tier_d_even_with_no_other_concern():
    assert risk_tier(mortgage(surplus_band="Adverse")) == "D"
    assert risk_tier(mortgage(stressed_dti_band="Adverse")) == "D"


def test_four_concerns_are_still_tier_c_never_d():
    worst_without_a_breach = mortgage(stressed_dti_band="Caution", surplus_band="Caution", value=320_000, price_needs_review=True)
    assert risk_tier(worst_without_a_breach) == "C"


def test_price_needs_review_and_low_support_are_one_concern_not_two():
    assert risk_tier(mortgage(price_needs_review=True, low_model_support=True)) == "B"


def test_the_committee_vote_is_not_an_input():
    assert "vote" not in " ".join(RiskFindings.__dataclass_fields__)
    assert "recommendation" not in " ".join(RiskFindings.__dataclass_fields__)


# ---- the LTV that counts ---------------------------------------------------------------------

def test_a_mortgage_is_judged_on_the_loan_over_the_asking_price():
    assert ltv_ratio(mortgage(loan=270_000, value=337_500)) == pytest.approx(0.8)


def test_a_heloc_is_judged_on_the_combined_ltv_not_the_line_alone():
    found = heloc(loan=40_000, existing_mortgage_balance=300_000, value=400_000)
    assert ltv_ratio(found) == aff.combined_ltv(300_000, 40_000, 400_000) == pytest.approx(0.85)
    assert risk_tier(found) == "B"  # the line alone is 10% of the home, so only the combined figure raises the concern


def test_a_heloc_between_80_and_90_percent_is_tier_b_and_over_90_is_tier_d():
    assert risk_tier(heloc(existing_mortgage_balance=300_000, loan=40_000)) == "B"  # 85%
    assert risk_tier(heloc(existing_mortgage_balance=340_000, loan=30_000, gross_annual_income=110_000)) == "D"  # 92.5%


# ---- the LTV band, with its exact boundaries ---------------------------------------------------

@pytest.mark.parametrize(
    "ratio, band",
    [(0.5, "80_or_less"), (0.8, "80_or_less"), (0.8001, "80_to_90"), (0.9, "80_to_90"), (0.9001, "over_90"), (1.2, "over_90")],
)
def test_the_ltv_band_boundaries_exactly_80_and_90_fall_in_the_lower_band(ratio, band):
    assert ltv_band(ratio) == band


# ---- low model support -------------------------------------------------------------------------

def test_no_warnings_is_not_low_support():
    assert has_low_support([]) is False


def test_a_failed_breakdown_is_not_low_support_because_the_estimate_is_still_sound():
    assert has_low_support([BREAKDOWN_WARNING]) is False


@pytest.mark.parametrize(
    "warning",
    [
        "The model has not seen Eircode area T12, so this home is valued as if the Eircode were Other.",
        "BER A0 is not a grade the model was trained on, so it is valued as an unknown rating.",
        "A floor area outside 15 to 1000 m2 is outside what the model was trained on, so the estimate is less reliable.",
    ],
)
def test_any_other_warning_is_low_support(warning):
    assert has_low_support([warning]) is True
    assert has_low_support([BREAKDOWN_WARNING, warning]) is True


# ---- saving it (criterion 3) ---------------------------------------------------------------------

class FakeRef:
    def __init__(self, path):
        self.path = path

    def collection(self, name):
        return FakeCollection(f"{self.path}/{name}")


class FakeCollection(FakeRef):
    def document(self, doc_id):
        return FakeRef(f"{self.path}/{doc_id}")


class FakeBatch:
    def __init__(self):
        self.writes, self.committed = [], False

    def update(self, ref, data):
        self.writes.append(("update", ref.path, data))

    def set(self, ref, data, merge=False):
        self.writes.append(("set", ref.path, data, merge))

    def commit(self):
        self.committed = True


class FakeDb:
    def __init__(self):
        self.last_batch = None

    def collection(self, name):
        return FakeCollection(name)

    def batch(self):
        self.last_batch = FakeBatch()
        return self.last_batch


def test_the_band_and_tier_go_on_the_application_and_the_tier_on_the_underwriting_copy_in_one_batch():
    db = FakeDb()
    result = write_risk(db, "app-1", mortgage(loan=270_000, value=320_000))  # 84.4%: one concern

    assert result == ("80_to_90", "B")
    batch = db.last_batch
    assert batch.committed
    assert batch.writes[0] == ("update", "applications/app-1", {"ltvBand": "80_to_90", "riskTier": "B"})
    kind, path, data, merge = batch.writes[1]
    assert (kind, path, merge) == ("set", "applications/app-1/review/underwriting", True)
    assert data["riskTier"] == "B" and "updatedAt" in data
    assert len(batch.writes) == 2


def test_a_re_run_overwrites_with_the_new_answer():
    db = FakeDb()
    write_risk(db, "app-1", mortgage(surplus_band="Adverse"))
    assert db.last_batch.writes[0][2] == {"ltvBand": "80_or_less", "riskTier": "D"}
