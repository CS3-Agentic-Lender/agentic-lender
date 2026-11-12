"""The risk tier (A to D) and LTV band for an application, worked out after every committee run.

The rule is the "Risk tier rule" in al-core/SCHEMA.md, and the shared worked cases in al-core/test/risk-tier-examples.json check it.
The committee's vote is never an input: everything here is numbers.
"""

from collections.abc import Iterable
from dataclasses import dataclass

from google.cloud.firestore import SERVER_TIMESTAMP

from app import affordability as aff
from app.valuation_endpoint import BREAKDOWN_WARNING

ADVERSE = "Adverse"
CAUTION = "Caution"
LTV_CONCERN = 0.80  # over 80% of the value is one concern


@dataclass(frozen=True)
class RiskFindings:
    """What one run found, plus the loan's figures. `value` is the asking price for a mortgage and the valuation estimate for a HELOC."""

    loan_type: str  # "mortgage" or "heloc"
    first_time_buyer: bool
    gross_annual_income: float
    loan: float  # the mortgage, or the new HELOC line
    existing_mortgage_balance: float  # 0 for a mortgage
    value: float
    stressed_dti_band: str  # Comfortable, Caution or Adverse, from app.affordability
    surplus_band: str
    price_needs_review: bool
    low_model_support: bool


def ltv_ratio(findings: RiskFindings) -> float:
    """The LTV the tier and band judge the loan on: a mortgage against its asking price, a HELOC's combined LTV against the estimate."""
    if findings.loan_type == "heloc":
        return aff.combined_ltv(findings.existing_mortgage_balance, findings.loan, findings.value)
    return findings.loan / findings.value


def ltv_band(ratio: float) -> str:
    """Exactly 80% and exactly 90% fall in the lower band, the same as the policy gate (on a limit is fine)."""
    if ratio <= LTV_CONCERN:
        return "80_or_less"
    return "80_to_90" if ratio <= aff.LTV_CAP else "over_90"


def breaks_a_central_bank_cap(findings: RiskFindings) -> bool:
    """The loan over its income multiple, or the LTV over 90%. A HELOC always uses 3.5x and counts the existing mortgage too."""
    heloc = findings.loan_type == "heloc"
    borrowed = findings.loan + findings.existing_mortgage_balance if heloc else findings.loan
    first_time = findings.first_time_buyer and not heloc
    return aff.exceeds_lti_cap(borrowed, findings.gross_annual_income, first_time) or ltv_ratio(findings) > aff.LTV_CAP


def has_low_support(support_warnings: Iterable[str]) -> bool:
    """Any valuation warning means the home is outside what the model was trained on, except the notice that the breakdown failed:
    the estimate itself is still sound then, so that notice is not a risk concern."""
    return any(warning != BREAKDOWN_WARNING for warning in support_warnings)


def risk_tier(findings: RiskFindings) -> str:
    """D first (any Adverse band, or a Central Bank cap breach), then C for 2 or more concerns, B for 1, A for none.

    A concern is one of: stressed DTI in Caution, surplus in Caution, LTV over 80%, or the price needs review or model support
    is low (those two together count once).
    """
    if ADVERSE in (findings.stressed_dti_band, findings.surplus_band) or breaks_a_central_bank_cap(findings):
        return "D"
    concerns = sum([
        findings.stressed_dti_band == CAUTION,
        findings.surplus_band == CAUTION,
        ltv_ratio(findings) > LTV_CONCERN,
        findings.price_needs_review or findings.low_model_support,
    ])
    if concerns >= 2:
        return "C"
    return "B" if concerns == 1 else "A"


def findings_from_run(record: dict) -> RiskFindings | None:
    """What a complete committee run found, read from its record (committee.make_record): the calculations step's facts.

    Everything comes from the run itself, the figures the committee judged, so the tier always matches that run's credit memo.
    None for a failed run, or one that did not get as far as the calculations: no tier is written then.
    """
    calculations = ((record.get("steps") or {}).get("calculations") or {}).get("output")
    if record.get("status") != "complete" or not calculations:
        return None
    afford, valuation = calculations["affordability_facts"], calculations["valuation_facts"]
    heloc = valuation["loan_type"] == "heloc"
    return RiskFindings(
        loan_type=valuation["loan_type"],
        first_time_buyer=afford["first_time_buyer"],  # already False for a HELOC
        gross_annual_income=afford["gross_annual_income_eur"],
        loan=afford["loan_eur"],
        existing_mortgage_balance=valuation["existing_mortgage_balance_eur"] if heloc else 0,
        value=valuation["estimate_eur"] if heloc else valuation["asking_price_eur"],
        stressed_dti_band=afford["dti_band"],  # the bands in the facts are already the stressed ones
        surplus_band=afford["surplus_band"],
        price_needs_review=bool(valuation.get("price_needs_review")),  # a HELOC has no asking price, so its facts never flag it
        low_model_support=has_low_support(valuation["support_warnings"]),
    )


def underwriting_document(application):
    """`applications/{id}/review/underwriting`, from the application's document reference."""
    return application.collection("review").document("underwriting")


def risk_writes(application_id: str, broker_id: str, findings: RiskFindings) -> tuple[dict, dict]:
    """The two writes, worked out but not made: (fields for the application, fields to merge into review/underwriting).

    Shared by `write_risk` (its own batch) and auto_start.finish (inside the transaction that ends the run), so both write the same fields.
    """
    band, tier = ltv_band(ltv_ratio(findings)), risk_tier(findings)
    return (
        {"ltvBand": band, "riskTier": tier},
        {"riskTier": tier, "updatedAt": SERVER_TIMESTAMP, "applicationId": application_id, "brokerId": broker_id},
    )


def write_risk(db, application_id: str, findings: RiskFindings) -> tuple[str, str]:
    """Save the band and tier on their own: both on `applications/{id}`, and the tier again on `review/underwriting`
    (readable by underwriters and the assigned broker, never the borrower). One batch, so the two documents never disagree.

    `db` is a Firestore client. After a committee run the same writes are made by auto_start.finish instead, inside its
    transaction (AL-301), so they land only while that run still holds the application. Returns (ltv_band, risk_tier).
    Raises ValueError if the application does not exist or has no brokerId.
    """
    application = db.collection("applications").document(application_id)
    snapshot = application.get()
    if not snapshot.exists:
        raise ValueError(f"Application {application_id} does not exist")
    broker_id = (snapshot.to_dict() or {}).get("brokerId")
    if not broker_id:
        raise ValueError(f"Application {application_id} has no brokerId")
    on_application, on_underwriting = risk_writes(application_id, broker_id, findings)
    batch = db.batch()
    batch.update(application, on_application)
    batch.set(underwriting_document(application), on_underwriting, merge=True)
    batch.commit()
    return on_application["ltvBand"], on_application["riskTier"]
