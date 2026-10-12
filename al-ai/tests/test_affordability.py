import pytest

from app import affordability as a

RATE = 0.04  # the reference cases use a 4.00% test rate


def eur(x):
    return round(x, 2)


# ---- repayment ----------------------------------------------------------------------------

def test_reference_single_first_time_buyer():
    # EUR 240,000 over 30 years
    assert eur(a.monthly_repayment(240_000, RATE, 30)) == 1145.80
    assert eur(a.stressed_repayment(240_000, RATE, 30)) == 1438.92


def test_reference_joint_mover():
    # EUR 270,000 over 25 years
    assert eur(a.monthly_repayment(270_000, RATE, 25)) == 1425.16
    assert eur(a.stressed_repayment(270_000, RATE, 25)) == 1739.61


def test_zero_rate_is_loan_divided_by_months():
    assert a.monthly_repayment(120_000, 0, 10) == 1000


def test_stress_margin_is_a_parameter():
    assert a.stressed_repayment(240_000, RATE, 30, stress_margin=0.0) == a.monthly_repayment(240_000, RATE, 30)
    assert a.stressed_repayment(240_000, RATE, 30, stress_margin=0.03) == a.monthly_repayment(240_000, 0.07, 30)


def test_results_are_not_rounded():
    # rounding is for display only (the ticket's AC4)
    assert a.monthly_repayment(240_000, RATE, 30) != eur(a.monthly_repayment(240_000, RATE, 30))


# ---- DTI, loan to income, surplus ---------------------------------------------------------

def test_dti_is_debts_plus_repayment_over_gross_monthly_income():
    # (300 + 1,200) / (60,000 / 12) = 0.30
    assert a.dti(300, 1_200, 60_000) == pytest.approx(0.30)


def test_joint_totals_are_summed_by_the_caller():
    # two applicants on 50,000 and 40,000 with 200 and 100 of debts: household totals go in
    assert a.dti(200 + 100, 1_425.16, 50_000 + 40_000) == pytest.approx((300 + 1_425.16) / 7_500)


def test_loan_to_income():
    assert a.loan_to_income(240_000, 60_000) == 4.0


def test_net_surplus():
    # 3,500 take-home - 1,000 living - 300 debts - 1,200 repayment
    assert a.net_surplus(3_500, 1_000, 300, 1_200) == 1_000


def test_assess_gives_normal_and_stressed_figures():
    r = a.assess(
        loan=240_000, years=30, benchmark_rate=RATE,
        gross_annual_income=60_000, net_monthly_income=3_800,
        monthly_debts=200, monthly_living_costs=1_200,
    )
    assert eur(r.repayment) == 1145.80 and eur(r.stressed_repayment) == 1438.92
    assert r.loan_to_income == 4.0
    assert r.dti == pytest.approx((200 + r.repayment) / 5_000)
    assert r.stressed_dti == pytest.approx((200 + r.stressed_repayment) / 5_000)
    assert r.surplus == pytest.approx(3_800 - 1_200 - 200 - r.repayment)
    assert r.stressed_surplus == pytest.approx(3_800 - 1_200 - 200 - r.stressed_repayment)
    # bands use the stressed values: DTI 32.8%, surplus 961.08
    assert (r.dti_band, r.surplus_band) == ("Comfortable", "Comfortable")


def test_assess_bands_follow_the_stressed_values():
    r = a.assess(
        loan=240_000, years=30, benchmark_rate=RATE,
        gross_annual_income=48_000, net_monthly_income=2_900,
        monthly_debts=400, monthly_living_costs=1_200,
    )
    # stressed DTI (400 + 1,438.92) / 4,000 = 46.0%, stressed surplus 2,900 - 1,200 - 400 - 1,438.92 = -138.92
    assert (r.dti_band, r.surplus_band) == ("Caution", "Adverse")


# ---- bands: every boundary ----------------------------------------------------------------

@pytest.mark.parametrize("value, band", [
    (0.0, "Comfortable"), (0.40, "Comfortable"), (0.4000001, "Caution"),
    (0.50, "Caution"), (0.5000001, "Adverse"), (2.0, "Adverse"),
])
def test_dti_bands(value, band):
    assert a.dti_band(value) == band


@pytest.mark.parametrize("value, band", [
    (10_000, "Comfortable"), (500, "Comfortable"), (499.99, "Caution"),
    (0, "Caution"), (-0.01, "Adverse"), (-5_000, "Adverse"),
])
def test_surplus_bands(value, band):
    assert a.surplus_band(value) == band


# ---- Central Bank loan-to-income caps -----------------------------------------------------

@pytest.mark.parametrize("loan, first_time, exceeds", [
    (240_000, True, False),   # exactly 4x
    (240_001, True, True),
    (210_000, False, False),  # exactly 3.5x
    (210_001, False, True),
    (240_000, False, True),   # fine for a first-time buyer, over the cap for everyone else
])
def test_lti_cap_both_sides(loan, first_time, exceeds):
    assert a.exceeds_lti_cap(loan, 60_000, first_time) is exceeds


# ---- largest loan the DTI cap allows ------------------------------------------------------

def test_max_loan_for_dti_hits_the_cap_exactly():
    loan = a.max_loan_for_dti(gross_annual_income=60_000, monthly_debts=300, benchmark_rate=RATE, years=30)
    stressed = a.stressed_repayment(loan, RATE, 30)
    assert a.dti(300, stressed, 60_000) == pytest.approx(0.40)


def test_max_loan_for_dti_uses_the_cap_it_is_given():
    loan = a.max_loan_for_dti(60_000, 0, RATE, 30, dti_cap=0.30)
    assert a.dti(0, a.stressed_repayment(loan, RATE, 30), 60_000) == pytest.approx(0.30)


def test_max_loan_for_dti_is_zero_when_debts_already_use_the_budget():
    assert a.max_loan_for_dti(60_000, 2_000, RATE, 30) == 0   # budget is 2,000, debts are 2,000
    assert a.max_loan_for_dti(60_000, 5_000, RATE, 30) == 0   # debts alone are over the cap


# ---- bad input is rejected, not divided by ------------------------------------------------

@pytest.mark.parametrize("call", [
    lambda: a.dti(0, 1_000, 0),
    lambda: a.dti(0, 1_000, None),
    lambda: a.dti(0, 1_000, -5),
    lambda: a.loan_to_income(100_000, 0),
    lambda: a.exceeds_lti_cap(100_000, 0, True),
    lambda: a.max_loan_for_dti(0, 0, RATE, 30),
    lambda: a.monthly_repayment(-1, RATE, 30),
    lambda: a.monthly_repayment(100_000, -0.01, 30),
    lambda: a.monthly_repayment(100_000, RATE, 0),
    lambda: a.stressed_repayment(100_000, RATE, 30, stress_margin=-0.01),
    lambda: a.dti(-1, 1_000, 60_000),
    lambda: a.net_surplus(3_000, -1, 0, 0),
    lambda: a.max_loan_for_dti(60_000, -1, RATE, 30),
    lambda: a.stressed_repayment(100_000, -0.01, 30),
    lambda: a.max_loan_for_dti(60_000, 0, -0.01, 30),
    lambda: a.max_loan_for_dti(60_000, 0, RATE, 30, dti_cap=-0.1),
    lambda: a.max_loan_for_dti(60_000, 5_000, RATE, -1),   # invalid term, even though the budget is already used
    lambda: a.max_loan_for_dti(60_000, 5_000, -0.01, 30),  # invalid rate, even though the budget is already used
])
def test_bad_input_raises(call):
    with pytest.raises(ValueError):
        call()


@pytest.mark.parametrize("call, field", [
    (lambda: a.stressed_repayment(100_000, -0.01, 30), "benchmark_rate"),
    (lambda: a.max_loan_for_dti(60_000, 0, -0.01, 30), "benchmark_rate"),
    (lambda: a.max_loan_for_dti(60_000, 0, RATE, 30, dti_cap=-0.1), "dti_cap"),
    (lambda: a.max_loan_for_dti(60_000, 5_000, RATE, -1), "years"),
])
def test_the_error_names_the_bad_field(call, field):
    with pytest.raises(ValueError, match=field):
        call()


def test_the_error_names_the_field():
    with pytest.raises(ValueError, match="gross_annual_income"):
        a.dti(0, 1_000, 0)


# ---- NaN and infinity are not valid numbers ------------------------------------------------
# They slip past a plain "< 0" check, so every numeric input must be refused explicitly.

GOOD = {
    a.monthly_repayment: dict(loan=100_000, annual_rate=0.04, years=30),
    a.stressed_repayment: dict(loan=100_000, benchmark_rate=0.04, years=30, stress_margin=0.02),
    a.dti: dict(monthly_debts=500, repayment=1_000, gross_annual_income=60_000),
    a.loan_to_income: dict(loan=100_000, gross_annual_income=60_000),
    a.net_surplus: dict(net_monthly_income=3_000, monthly_living_costs=1_000, monthly_debts=0, repayment=1_000),
    a.dti_band: dict(value=0.3),
    a.surplus_band: dict(value=500),
    a.max_loan_for_dti: dict(gross_annual_income=60_000, monthly_debts=0, benchmark_rate=0.04, years=30,
                             dti_cap=0.4, stress_margin=0.02),
    a.assess: dict(loan=200_000, years=30, benchmark_rate=0.04, gross_annual_income=60_000,
                   net_monthly_income=3_500, monthly_debts=0, monthly_living_costs=1_000, stress_margin=0.02),
}
NON_FINITE = [float("nan"), float("inf"), float("-inf")]
CASES = [(fn, name) for fn, good in GOOD.items() for name in good]


@pytest.mark.parametrize("fn, name", CASES, ids=[f"{fn.__name__}-{name}" for fn, name in CASES])
@pytest.mark.parametrize("bad", NON_FINITE, ids=["nan", "inf", "-inf"])
def test_non_finite_input_is_rejected(fn, name, bad):
    with pytest.raises(ValueError):
        fn(**{**GOOD[fn], name: bad})


@pytest.mark.parametrize("fn", [a.monthly_repayment, a.dti, a.loan_to_income, a.net_surplus, a.dti_band, a.max_loan_for_dti])
def test_the_error_for_a_non_finite_input_names_the_field(fn):
    name = next(iter(GOOD[fn]))
    with pytest.raises(ValueError, match=name):
        fn(**{**GOOD[fn], name: float("nan")})


def test_the_good_inputs_used_above_really_are_good():
    for fn, good in GOOD.items():
        fn(**good)
