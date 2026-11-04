"""The loan's type, amount and term, stated once for the audit record and the loan note (AL-283)."""

import pytest

from app import audit, loan_terms, mint
from app.loan_terms import LoanTermsError
from tests.test_audit_record import funded_inputs

LOAN = {"loanType": "mortgage", "loanAmountEur": 270000, "termYears": 30}


@pytest.mark.parametrize(
    "value,scaled",
    [(123456.78, 12_345_678), (270000, 27_000_000), (4.25, 425), (3.99, 399), (4.005, 401), (0.005, 1), (0, 0), (0.1 + 0.2, 30)],
)
def test_a_value_is_scaled_by_100_with_a_half_rounded_up_and_no_float_slips(value, scaled):
    assert loan_terms.scaled(value) == scaled


def test_the_three_terms_of_a_valid_loan():
    assert loan_terms.loan_type(LOAN) == "mortgage"
    assert loan_terms.principal_cents(LOAN) == 27_000_000
    assert loan_terms.term_months(LOAN) == 360


@pytest.mark.parametrize("amount", [None, 0, -5, "270000", True])
def test_an_amount_that_is_not_a_positive_number_is_refused(amount):
    with pytest.raises(LoanTermsError, match="loan amount"):
        loan_terms.principal_cents({**LOAN, "loanAmountEur": amount})


@pytest.mark.parametrize("years", [None, 0, -1, 2.5, "30", True])
def test_a_term_that_is_not_a_positive_whole_number_of_years_is_refused(years):
    with pytest.raises(LoanTermsError, match="term"):
        loan_terms.term_months({**LOAN, "termYears": years})


@pytest.mark.parametrize("kind", [None, "", "bridging", "Mortgage"])
def test_a_loan_type_other_than_mortgage_or_heloc_is_refused(kind):
    with pytest.raises(LoanTermsError, match="loan type"):
        loan_terms.loan_type({**LOAN, "loanType": kind})


# The audit record and the loan note must state the loan the same way (AL-283 criterion 2).


@pytest.mark.parametrize("amount,years,kind", [(270000, 30, "mortgage"), (123456.78, 25, "mortgage"), (60000, 15, "heloc"), (99999.995, 1, "heloc")])
def test_the_audit_record_and_the_loan_note_state_the_same_cents_months_and_type(monkeypatch, amount, years, kind):
    monkeypatch.setenv("BORROWER_REF_SALT", "test-salt")
    application, run, calls = funded_inputs()
    application = {**application, "loanType": kind, "loanAmountEur": amount, "termYears": years, "aprPct": 4.0, "borrowerId": "borrower1"}

    record = audit.build_record("app-funded", application, run, calls)
    note = mint._terms(None, application)  # the rate is on the application, so no document is read

    assert (record["principalCents"], record["termMonths"], record["loanType"]) == (note.principal_cents, note.term_months, note.loan_type)
