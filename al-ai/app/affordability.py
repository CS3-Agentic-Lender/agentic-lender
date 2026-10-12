"""Every affordability figure in one place, so the agent, the endpoint and the rate-shock work agree.

Money is euros, rates are annual decimals (0.04 is 4%), terms are years. Incomes and debts are
household totals: for a joint application the caller adds the applicants up first. Nothing here is
rounded; round only when showing a number to a person.
"""

from dataclasses import dataclass

STRESS_MARGIN = 0.02  # Central Bank stress rule: +2 percentage points
DTI_CAP = 0.40  # prototype policy, used for the largest-loan calculation
LTI_CAP_FIRST_TIME = 4.0  # Central Bank limits for owner-occupiers
LTI_CAP_OTHER = 3.5

# Prototype bands on stressed values (docs: agent committee plan, "Rule flags and bands").
DTI_COMFORTABLE_MAX = 0.40
DTI_CAUTION_MAX = 0.50
SURPLUS_COMFORTABLE_MIN = 500
SURPLUS_CAUTION_MIN = 0


def _at_least_zero(name: str, value) -> None:
    if value is None or value < 0:
        raise ValueError(f"{name} must be 0 or more")


def _above_zero(name: str, value) -> None:
    if value is None or value <= 0:
        raise ValueError(f"{name} must be greater than 0")


def repayment_factor(annual_rate: float, years: float) -> float:
    """Monthly repayment per euro borrowed. Repayment is linear in the loan, so this also inverts it."""
    _at_least_zero("annual_rate", annual_rate)
    _above_zero("years", years)
    n = years * 12
    r = annual_rate / 12
    return 1 / n if r == 0 else r / (1 - (1 + r) ** -n)


def monthly_repayment(loan: float, annual_rate: float, years: float) -> float:
    _at_least_zero("loan", loan)
    return loan * repayment_factor(annual_rate, years)


def stressed_repayment(loan: float, benchmark_rate: float, years: float, stress_margin: float = STRESS_MARGIN) -> float:
    _at_least_zero("stress_margin", stress_margin)
    return monthly_repayment(loan, benchmark_rate + stress_margin, years)


def dti(monthly_debts: float, repayment: float, gross_annual_income: float) -> float:
    """Debts plus the new repayment, over gross monthly income."""
    _at_least_zero("monthly_debts", monthly_debts)
    _at_least_zero("repayment", repayment)
    _above_zero("gross_annual_income", gross_annual_income)
    return (monthly_debts + repayment) / (gross_annual_income / 12)


def loan_to_income(loan: float, gross_annual_income: float) -> float:
    _at_least_zero("loan", loan)
    _above_zero("gross_annual_income", gross_annual_income)
    return loan / gross_annual_income


def exceeds_lti_cap(loan: float, gross_annual_income: float, first_time_buyer: bool) -> bool:
    cap = LTI_CAP_FIRST_TIME if first_time_buyer else LTI_CAP_OTHER
    return loan_to_income(loan, gross_annual_income) > cap


def net_surplus(net_monthly_income: float, monthly_living_costs: float, monthly_debts: float, repayment: float) -> float:
    """Take-home pay left each month after living costs, existing debts and the new repayment."""
    _above_zero("net_monthly_income", net_monthly_income)
    _at_least_zero("monthly_living_costs", monthly_living_costs)
    _at_least_zero("monthly_debts", monthly_debts)
    _at_least_zero("repayment", repayment)
    return net_monthly_income - monthly_living_costs - monthly_debts - repayment


def dti_band(value: float) -> str:
    if value <= DTI_COMFORTABLE_MAX:
        return "Comfortable"
    return "Caution" if value <= DTI_CAUTION_MAX else "Adverse"


def surplus_band(value: float) -> str:
    if value >= SURPLUS_COMFORTABLE_MIN:
        return "Comfortable"
    return "Caution" if value >= SURPLUS_CAUTION_MIN else "Adverse"


def max_loan_for_dti(
    gross_annual_income: float,
    monthly_debts: float,
    benchmark_rate: float,
    years: float,
    dti_cap: float = DTI_CAP,
    stress_margin: float = STRESS_MARGIN,
) -> float:
    """Largest loan whose stressed repayment plus existing debts reaches `dti_cap` of gross monthly income."""
    _above_zero("gross_annual_income", gross_annual_income)
    _at_least_zero("monthly_debts", monthly_debts)
    _at_least_zero("stress_margin", stress_margin)
    budget = dti_cap * gross_annual_income / 12 - monthly_debts
    if budget <= 0:
        return 0.0
    return budget / repayment_factor(benchmark_rate + stress_margin, years)


@dataclass(frozen=True)
class Assessment:
    repayment: float
    stressed_repayment: float
    loan_to_income: float
    dti: float
    stressed_dti: float
    surplus: float
    stressed_surplus: float
    dti_band: str  # bands use the stressed values
    surplus_band: str


def assess(
    loan: float,
    years: float,
    benchmark_rate: float,
    gross_annual_income: float,
    net_monthly_income: float,
    monthly_debts: float,
    monthly_living_costs: float,
    stress_margin: float = STRESS_MARGIN,
) -> Assessment:
    """The full set of figures for one loan, at the benchmark rate and at the stressed rate."""
    normal = monthly_repayment(loan, benchmark_rate, years)
    stressed = stressed_repayment(loan, benchmark_rate, years, stress_margin)
    stressed_dti = dti(monthly_debts, stressed, gross_annual_income)
    stressed_surplus = net_surplus(net_monthly_income, monthly_living_costs, monthly_debts, stressed)
    return Assessment(
        repayment=normal,
        stressed_repayment=stressed,
        loan_to_income=loan_to_income(loan, gross_annual_income),
        dti=dti(monthly_debts, normal, gross_annual_income),
        stressed_dti=stressed_dti,
        surplus=net_surplus(net_monthly_income, monthly_living_costs, monthly_debts, normal),
        stressed_surplus=stressed_surplus,
        dti_band=dti_band(stressed_dti),
        surplus_band=surplus_band(stressed_surplus),
    )
