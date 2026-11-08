"""The borrower's indicative figures, worked out by code: purchase-price LTV, DTI at the benchmark rate and the approval likelihood.

`application_fields` is the one function that says what goes on `applications/{id}`. The Firestore listener that starts the
committee calls it twice: on submit, before the committee runs (no valuation yet), and again when a run (or re-run) completes,
with that run's rate and the model's findings from `from_run` (AL-63 criterion 4). Only a Draft can be edited, so an edit is
always followed by a new submit and needs no trigger of its own. It only returns the fields; writing them is the listener's job.

The label is separate from the committee's recommendation and is never a percentage. The rule order, first match wins:
  Unknown  the inputs are incomplete or unsupported, or a HELOC has no valuation yet to judge its combined LTV against
  Low      stressed affordability is Adverse (stressed DTI over 50% or a stressed surplus below zero)
  Medium   any Caution band, any Central Bank / policy limit breached, or (once the valuation is known) the price needs review
           or the model has low support for the home
  High     otherwise
"""

from dataclasses import dataclass

from pydantic import ValidationError

from app import affordability as aff
from app import committee_input, policy_gate, risk_tier

UNKNOWN, LOW, MEDIUM, HIGH = "Unknown", "Low", "Medium", "High"


@dataclass(frozen=True)
class ValuationFindings:
    """What the valuation model found. Absent on submit; given when the figures are recalculated."""

    estimate_eur: float
    price_needs_review: bool
    low_model_support: bool


def application_fields(
    application: dict, *, benchmark_rate_pct: float, valuation: ValuationFindings | None = None
) -> dict:
    """The fields to write to the application. `application` is the Firestore document (camelCase, see committee_input.py).

    Always has `approvalLikelihood`. Has `dtiPct` (one decimal place) and, for a mortgage, `purchaseLtvPct` (one decimal place)
    whenever the application is valid. A HELOC with a valuation also has `ltvPct`, its combined LTV against the estimate (one
    decimal place), which is the LTV the borrower's app shows for a HELOC. An invalid or unsupported application gets `Unknown` and no figures.
    """
    try:
        a = committee_input.Application.model_validate(application)
        a.valuation_request()  # a county, property type or BER the valuation model does not know
    except ValidationError:
        return {"approvalLikelihood": UNKNOWN}

    heloc = a.loan_type == "heloc"
    assessed = aff.assess(
        a.loan_amount_eur, a.term_years, benchmark_rate_pct / 100, a.gross_income_eur, a.monthly_take_home_eur,
        a.monthly_debts_eur, a.monthly_living_costs_eur,
    )
    fields: dict = {"dtiPct": round(assessed.dti * 100, 1)}
    if not heloc:
        fields["purchaseLtvPct"] = round(a.loan_amount_eur / a.property.asking_price_eur * 100, 1)

    if heloc and valuation is None:
        fields["approvalLikelihood"] = UNKNOWN  # a HELOC is judged against the model's estimate, which does not exist yet
        return fields

    if heloc:
        fields["ltvPct"] = round(aff.combined_ltv(a.existing_mortgage_balance_eur, a.loan_amount_eur, valuation.estimate_eur) * 100, 1)
        breaches = policy_gate.heloc_breaches(
            existing_balance=a.existing_mortgage_balance_eur, line=a.loan_amount_eur,
            home_value=valuation.estimate_eur, gross_annual_income=a.gross_income_eur,
        )
    else:
        breaches = policy_gate.purchase_breaches(
            loan=a.loan_amount_eur, gross_annual_income=a.gross_income_eur,
            first_time_buyer=bool(a.first_time_buyer), asking_price=a.property.asking_price_eur,
        )

    if "Adverse" in (assessed.dti_band, assessed.surplus_band):
        label = LOW
    elif (
        "Caution" in (assessed.dti_band, assessed.surplus_band)
        or breaches
        or (valuation is not None and (valuation.price_needs_review or valuation.low_model_support))
    ):
        label = MEDIUM
    else:
        label = HIGH
    fields["approvalLikelihood"] = label
    return fields


def from_run(record: dict) -> tuple[float, ValuationFindings] | None:
    """The benchmark rate a complete committee run used and what its valuation found, to recalculate the figures with (criterion 4).

    The run's own rate, not a fresh one, so the borrower's figures match the credit memo. None for a failed run, or one that
    did not get as far as the valuation and the calculations: the figures from submit then stay.
    """
    steps = record.get("steps") or {}
    model = (steps.get("valuation_model") or {}).get("output")
    calculations = (steps.get("calculations") or {}).get("output")
    if record.get("status") != "complete" or not model or not calculations:
        return None
    facts = calculations["valuation_facts"]
    findings = ValuationFindings(
        estimate_eur=model["estimate_eur"],
        price_needs_review=bool(facts.get("price_needs_review")),  # a HELOC has no asking price, so its facts never flag it
        low_model_support=risk_tier.has_low_support(facts["support_warnings"]),
    )
    return calculations["benchmark_rate_pct"], findings
