import time

import pytest

from app import affordability, rate_shock
from app.rate_shock import Loan


def loan(application_id="a1", **changes):
    base = dict(
        loan_eur=300_000, term_years=30, gross_income_eur=80_000, take_home_monthly_eur=4_500, debts_monthly_eur=200,
        living_costs_monthly_eur=1_500, benchmark_rate_pct=4.0, rate_source="stored",
    )
    return Loan(application_id, **{**base, **changes})


# ---- one application against a hand-calculated figure ----------------------------------------

def test_one_application_matches_the_hand_calculation():
    # 300,000 over 30 years: 1,432.25 a month at 4% and 1,798.65 at 6% (the standard amortisation figures, 4.774 and 5.996 per 1,000).
    # Income 80,000 is 6,666.67 a month, so DTI is (200 + 1,432.25) / 6,666.67 = 0.2448 before and (200 + 1,798.65) / 6,666.67 = 0.2998 after.
    # Surplus is 4,500 - 1,500 - 200 - repayment: 1,367.75 before and 1,001.35 after.
    r = rate_shock.run([loan()], 200)["applications"][0]
    assert r["before"] == {"repayment_eur": 1432.25, "dti": 0.2448, "surplus_eur": 1367.75, "band": "Comfortable"}
    assert r["after"] == {"repayment_eur": 1798.65, "dti": 0.2998, "surplus_eur": 1001.35, "band": "Comfortable"}
    assert r["shocked_rate_pct"] == 6.0 and r["moved_into"] is None


def test_a_loan_that_crosses_a_band_says_which_it_moved_into():
    # 200,000 over 25 years: 1,055.67 at 4% and 1,413.56 at 7%. Take-home 3,600, costs 1,500, debts 300, income 50,000 (4,166.67 a month).
    # Surplus 744.33 (Comfortable) falls to 386.44 (Caution); DTI 0.3254 rises to 0.4113 (Caution).
    r = rate_shock.run([loan(loan_eur=200_000, term_years=25, gross_income_eur=50_000, take_home_monthly_eur=3_600, debts_monthly_eur=300)], 300)["applications"][0]
    assert r["before"]["band"] == "Comfortable" and r["after"]["band"] == "Caution"
    assert r["after"]["repayment_eur"] == 1413.56 and r["after"]["surplus_eur"] == 386.44
    assert r["moved_into"] == "Caution"


def test_a_loan_that_is_already_in_caution_has_not_moved_into_it():
    # Surplus is take-home 3,400 - costs 1,500 - debts 200 - repayment: 267.75 at 4% (Caution) and 89.54 at 5% (still Caution).
    r = rate_shock.run([loan(take_home_monthly_eur=3_400)], 100)["applications"][0]
    assert r["before"]["surplus_eur"] == 267.75 and r["after"]["surplus_eur"] == 89.54
    assert r["before"]["band"] == r["after"]["band"] == "Caution" and r["moved_into"] is None


def test_a_loan_can_move_into_adverse():
    # Take-home 3,500: surplus 367.75 at 4% (Caution) and -195.91 at 7% (a repayment of 1,995.91), so it goes below zero.
    r = rate_shock.run([loan(take_home_monthly_eur=3_500)], 300)["applications"][0]
    assert r["before"]["band"] == "Caution" and r["after"]["band"] == "Adverse"
    assert r["after"]["surplus_eur"] == -195.91 and r["moved_into"] == "Adverse"


# ---- it is the shared affordability module ----------------------------------------------------

@pytest.mark.parametrize("pct", [2.5, 4.0, 5.75])
def test_a_shock_of_200_gives_the_committees_stressed_figures(pct):
    a = affordability.assess(300_000, 30, pct / 100, 80_000, 4_500, 200, 1_500)  # the committee's +2 point stress
    r = rate_shock.run([loan(benchmark_rate_pct=pct)], 200)["applications"][0]["after"]
    assert r["repayment_eur"] == round(a.stressed_repayment, 2)
    assert r["dti"] == round(a.stressed_dti, 4) and r["surplus_eur"] == round(a.stressed_surplus, 2)


def test_a_bigger_shock_never_costs_less():
    costs = [rate_shock.run([loan()], bps)["applications"][0]["after"]["repayment_eur"] for bps in range(100, 301, 25)]
    assert costs == sorted(costs) and len(set(costs)) == len(costs)


# ---- the portfolio totals ---------------------------------------------------------------------

def test_totals_count_and_share_each_band_before_and_after():
    loans = [
        loan("fine"),
        loan("slips", loan_eur=200_000, term_years=25, gross_income_eur=50_000, take_home_monthly_eur=3_600, debts_monthly_eur=300),
        loan("slips2", loan_eur=200_000, term_years=25, gross_income_eur=50_000, take_home_monthly_eur=3_600, debts_monthly_eur=300),
        loan("fine2"),
    ]
    out = rate_shock.run(loans, 300)
    t = out["totals"]
    assert t["count"] == 4
    assert t["before"]["Comfortable"] == {"count": 4, "share_pct": 100.0}
    assert t["after"]["Comfortable"] == {"count": 2, "share_pct": 50.0}
    assert t["after"]["Caution"] == {"count": 2, "share_pct": 50.0}
    assert t["moved_into_caution"] == 2 and t["moved_into_adverse"] == 0
    for when in ("before", "after"):
        assert sum(b["count"] for b in t[when].values()) == 4


def test_an_empty_portfolio_has_zero_counts_and_no_division():
    t = rate_shock.run([], 100)["totals"]
    assert t["count"] == 0 and t["before"]["Comfortable"] == {"count": 0, "share_pct": 0.0}


def test_a_loan_the_shared_maths_refuses_is_skipped_and_named():
    out = rate_shock.run([loan("ok"), loan("no-income", gross_income_eur=0), loan("text", term_years="thirty"), loan("missing", loan_eur=None)], 100)
    assert [r["application_id"] for r in out["applications"]] == ["ok"]
    assert [s["application_id"] for s in out["skipped"]] == ["no-income", "text", "missing"]
    assert out["totals"]["count"] == 1


def test_it_keeps_each_loans_rate_source():
    out = rate_shock.run([loan("s", rate_source="stored"), loan("c", benchmark_rate_pct=3.5, rate_source="current")], 100)
    assert [(r["application_id"], r["rate_source"], r["benchmark_rate_pct"]) for r in out["applications"]] == [("s", "stored", 4.0), ("c", "current", 3.5)]


# ---- speed ------------------------------------------------------------------------------------

def test_200_applications_finish_in_under_2_seconds():
    loans = [loan(f"a{i}", loan_eur=150_000 + i * 1_000, gross_income_eur=60_000 + i * 200) for i in range(200)]
    start = time.perf_counter()
    out = rate_shock.run(loans, 300)
    elapsed = time.perf_counter() - start
    assert out["totals"]["count"] == 200
    assert elapsed < 2, f"took {elapsed:.2f}s"
