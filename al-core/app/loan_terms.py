"""The loan's type, amount and term as the loan note and the audit record both state them (AL-283).

One place works them out from the stored application, so the hash that proves what was approved and the note that was
minted can never disagree: the amount in euro cents and the term in months, both whole numbers, and the type as stored.
A rate or a euro amount is scaled with `scaled`, which rounds a half up and goes through text rather than a float, so
123456.78 euro is exactly 12345678 cents and a rate of 4.005% is 401 basis points on every machine.
"""

from decimal import ROUND_HALF_UP, Decimal

LOAN_TYPES = ("mortgage", "heloc")


class LoanTermsError(ValueError):
    """The application is missing a term the loan can't be stated without. The message says which."""


def scaled(value) -> int:
    """A euro amount as cents, or a percentage as basis points: times 100, a half rounded up, no float slips."""
    return int((Decimal(str(value)) * 100).quantize(Decimal(1), rounding=ROUND_HALF_UP))


def _number(application: dict, field: str):
    value = application.get(field)
    return value if isinstance(value, (int, float)) and not isinstance(value, bool) else None


def loan_type(application: dict) -> str:
    kind = application.get("loanType")
    if kind not in LOAN_TYPES:
        raise LoanTermsError("The application has no loan type of mortgage or heloc")
    return kind


def principal_cents(application: dict) -> int:
    amount = _number(application, "loanAmountEur")
    if amount is None or amount <= 0:
        raise LoanTermsError("The application has no loan amount")
    return scaled(amount)


def term_months(application: dict) -> int:
    years = _number(application, "termYears")
    if years is None or years <= 0 or years != int(years):
        raise LoanTermsError("The application has no term in whole years")
    return int(years) * 12
