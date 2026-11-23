import pytest

from app import house_price_fall, valuation_checks
from app.house_price_fall import Loan


def mortgage(application_id="m1", **changes):
    base = dict(loan_type="mortgage", loan_eur=240_000, existing_mortgage_balance_eur=None, asking_price_eur=300_000, estimate_eur=320_000)
    return Loan(application_id, **{**base, **changes})


def heloc(application_id="h1", **changes):
    base = dict(loan_type="heloc", loan_eur=50_000, existing_mortgage_balance_eur=150_000, asking_price_eur=None, estimate_eur=400_000)
    return Loan(application_id, **{**base, **changes})


def first(loans, fall):
    return house_price_fall.run(loans, fall)["applications"][0]


# ---- one application against a hand-calculated figure ----------------------------------------

def test_a_mortgage_is_measured_against_the_lower_of_asking_price_and_estimate():
    # Asking 300,000 is lower than the estimate 320,000, so the starting value is 300,000. The loan 240,000 is exactly 80%: not above 80.
    # A 10% fall leaves 270,000, so 240,000 / 270,000 = 88.89%: above 80, not above 90.
    r = first([mortgage()], 10)
    assert r["value_basis"] == "asking_price" and r["starting_value_eur"] == 300_000 and r["loan_eur"] == 240_000
    assert r["before"] == {"ltv_pct": 80.0, "above_80": False, "above_90": False}
    assert r["after"] == {"property_value_eur": 270_000.0, "ltv_pct": 88.89, "above_80": True, "above_90": False}


def test_a_lower_estimate_than_the_asking_price_is_the_starting_value():
    # Estimate 280,000 is lower than asking 300,000. Loan 252,000 / 280,000 = 90%: above 80, exactly 90 is not above 90.
    r = first([mortgage(loan_eur=252_000, estimate_eur=280_000)], 0)
    assert r["value_basis"] == "model_estimate" and r["starting_value_eur"] == 280_000
    assert r["before"] == {"ltv_pct": 90.0, "above_80": True, "above_90": False}


def test_a_mortgage_with_no_estimate_yet_uses_the_asking_price():
    # Loan 200,000, asking 250,000, no estimate: 80% before. A 5% fall leaves 237,500: 200,000 / 237,500 = 84.21%.
    r = first([mortgage(loan_eur=200_000, asking_price_eur=250_000, estimate_eur=None)], 5)
    assert r["value_basis"] == "asking_price" and r["starting_value_eur"] == 250_000
    assert r["before"]["ltv_pct"] == 80.0 and r["before"]["above_80"] is False
    assert r["after"] == {"property_value_eur": 237_500.0, "ltv_pct": 84.21, "above_80": True, "above_90": False}


def test_a_heloc_is_the_combined_loan_over_the_estimate():
    # Existing balance 150,000 plus a 50,000 line is 200,000 against an estimate of 400,000: 50%. A 40% fall leaves 240,000: 83.33%.
    r = first([heloc()], 40)
    assert r["value_basis"] == "model_estimate" and r["starting_value_eur"] == 400_000 and r["loan_eur"] == 200_000
    assert r["before"] == {"ltv_pct": 50.0, "above_80": False, "above_90": False}
    assert r["after"] == {"property_value_eur": 240_000.0, "ltv_pct": 83.33, "above_80": True, "above_90": False}


def test_a_heloc_with_no_estimate_yet_is_skipped_and_says_why():
    out = house_price_fall.run([heloc(estimate_eur=None)], 10)
    assert out["applications"] == [] and out["totals"]["count"] == 0
    assert [s["application_id"] for s in out["skipped"]] == ["h1"] and "estimate" in out["skipped"][0]["reason"]


def test_a_zero_fall_leaves_before_and_after_the_same():
    r = first([mortgage(loan_eur=270_000)], 0)
    assert r["after"]["ltv_pct"] == r["before"]["ltv_pct"] == 90.0
    assert r["after"]["property_value_eur"] == r["starting_value_eur"]


@pytest.mark.parametrize("asking, loan, fall, band", [
    (165_000, 92_400, 30, 80),  # 165,000 less 30% is 115,500: 92,400 is exactly 80%
    (164_000, 91_840, 30, 80),  # 114,800: 91,840 is exactly 80%
    (200_000, 126_000, 30, 90),  # 140,000: 126,000 is exactly 90%
])
def test_a_loan_that_lands_exactly_on_80_or_90_after_the_fall_is_not_above_it(asking, loan, fall, band):
    # value * (1 - fall / 100) is inexact in floating point and used to tip these over the line while showing 80.0 or 90.0.
    after = first([mortgage(loan_eur=loan, asking_price_eur=asking, estimate_eur=None)], fall)["after"]
    assert after["ltv_pct"] == float(band)
    assert after["above_80"] is (band == 90) and after["above_90"] is False


def test_the_flags_agree_with_the_shown_ltv_on_every_whole_euro_boundary():
    # Every whole-euro loan that lands on exactly 80% or 90% after a fall, for prices 100,000 to 1,000,000 in 1,000 steps.
    for price in range(100_000, 1_000_001, 1_000):
        for fall in range(0, 41, 5):
            value = price * (100 - fall) // 100
            if price * (100 - fall) % 100:
                continue
            for band in (80, 90):
                if value * band % 100:
                    continue
                after = first([mortgage(loan_eur=value * band // 100, asking_price_eur=price, estimate_eur=None)], fall)["after"]
                assert after["ltv_pct"] == float(band) and not after["above_90"] and after["above_80"] is (band == 90), (price, fall, band)


@pytest.mark.parametrize("loan, shown, above_80, above_90", [
    (160_003, 80.0, False, False),  # 80.0015% is shown as 80.0, so it is not flagged above 80 either
    (160_010, 80.01, True, False),  # 80.005% is shown as 80.01: above 80
    (180_009, 90.0, True, False),  # 90.0045% is shown as 90.0: above 80, not above 90
    (180_020, 90.01, True, True),  # 90.01%: above both
])
def test_the_flags_read_the_same_rounded_ltv_the_underwriter_sees(loan, shown, above_80, above_90):
    # Flags from the unrounded ratio used to say "above 80" next to a shown 80.0 (Nic's 160,003 on 200,000 example).
    before = first([mortgage(loan_eur=loan, asking_price_eur=200_000, estimate_eur=None)], 0)["before"]
    assert before == {"ltv_pct": shown, "above_80": above_80, "above_90": above_90}


def test_a_flag_never_disagrees_with_the_shown_ltv():
    # Every loan from 159,900 to 180,100 euro on 200,000, at every fall: above 80 exactly when the shown figure is over 80.0.
    for loan in range(159_900, 180_101):
        for fall in (0, 5):
            r = first([mortgage(loan_eur=loan, asking_price_eur=200_000, estimate_eur=None)], fall)
            for when in ("before", "after"):
                shown = r[when]
                assert shown["above_80"] is (shown["ltv_pct"] > 80) and shown["above_90"] is (shown["ltv_pct"] > 90), (loan, fall, when)


# ---- the lower-of rule is the one the loan file and the committee use ------------------------

@pytest.mark.parametrize("asking, estimate", [(300_000, 320_000), (300_000, 280_000), (300_000, 300_000), (250_000, None)])
def test_a_mortgage_agrees_with_check_valuation(asking, estimate):
    loan = mortgage(asking_price_eur=asking, estimate_eur=estimate)
    if estimate is None:  # check_valuation needs an estimate; with none, the asking price is the only value
        estimate = asking
    expected = valuation_checks.check_valuation(estimate, loan.loan_eur, asking, 0.357).model_ltv
    assert first([loan], 0)["before"]["ltv_pct"] == round(expected * 100, 2)


def test_a_heloc_agrees_with_check_valuation_on_the_combined_loan():
    loan = heloc()
    expected = valuation_checks.check_valuation(loan.estimate_eur, 200_000, None, 0.357).model_ltv
    assert first([loan], 0)["before"]["ltv_pct"] == round(expected * 100, 2)


# ---- the portfolio totals ---------------------------------------------------------------------

def test_the_totals_count_and_add_up_the_loans_above_80_and_above_90_before_and_after():
    loans = [
        mortgage("a"),                                           # 240,000 on 300,000: exactly 80% before, 100% after
        mortgage("b", loan_eur=200_000, asking_price_eur=400_000, estimate_eur=None),  # 50% -> 62.5%
        heloc("c"),                                              # 50% -> 62.5%
        mortgage("d", loan_eur=285_000, asking_price_eur=300_000),  # 95%: over 80 and over 90 before
    ]
    t = house_price_fall.run(loans, 20)["totals"]
    # After a 20% fall: a is 240,000 / 240,000 = 100%, b 200,000 / 320,000 = 62.5%, c 200,000 / 320,000 = 62.5%, d 285,000 / 240,000 = 118.75%.
    assert t["count"] == 4
    assert t["before"] == {"above_80": {"count": 1, "loan_eur": 285_000.0}, "above_90": {"count": 1, "loan_eur": 285_000.0}}
    assert t["after"] == {"above_80": {"count": 2, "loan_eur": 525_000.0}, "above_90": {"count": 2, "loan_eur": 525_000.0}}


def test_above_90_is_always_part_of_above_80():
    loans = [mortgage(str(i), loan_eur=200_000 + 15_000 * i) for i in range(8)]
    for fall in range(0, 41, 5):
        t = house_price_fall.run(loans, fall)["totals"]
        for when in ("before", "after"):
            assert t[when]["above_90"]["count"] <= t[when]["above_80"]["count"]
            assert t[when]["above_90"]["loan_eur"] <= t[when]["above_80"]["loan_eur"]


def test_a_bigger_fall_never_lowers_a_loans_ltv():
    loan = mortgage()
    ltvs = [first([loan], fall)["after"]["ltv_pct"] for fall in range(0, 41, 5)]
    assert ltvs == sorted(ltvs) and ltvs[0] < ltvs[-1]


def test_an_empty_portfolio_has_zero_totals():
    t = house_price_fall.run([], 10)["totals"]
    assert t["count"] == 0 and t["before"]["above_80"] == {"count": 0, "loan_eur": 0.0}


def test_the_answer_says_it_is_indicative_and_not_a_valuation():
    note = house_price_fall.run([mortgage()], 10)["note"]
    assert "indicative" in note and "not a verified valuation" in note


# ---- loans the maths refuses are skipped and listed, never guessed ---------------------------

@pytest.mark.parametrize("changes", [
    dict(asking_price_eur=None, estimate_eur=None),   # no value at all
    dict(asking_price_eur=None),                      # a mortgage needs an asking price
    dict(loan_eur=None),
    dict(loan_eur=-1),
    dict(loan_eur="240000"),                          # text where a number belongs
    dict(estimate_eur=0),
    dict(asking_price_eur=True),
    dict(estimate_eur=float("nan")),
])
def test_a_bad_mortgage_is_skipped_and_listed(changes):
    out = house_price_fall.run([mortgage("bad", **changes), mortgage("ok")], 10)
    assert [a["application_id"] for a in out["applications"]] == ["ok"]
    assert [s["application_id"] for s in out["skipped"]] == ["bad"] and out["skipped"][0]["reason"]


@pytest.mark.parametrize("changes", [dict(existing_mortgage_balance_eur=None), dict(existing_mortgage_balance_eur=-5), dict(loan_eur=None)])
def test_a_bad_heloc_is_skipped_and_listed(changes):
    out = house_price_fall.run([heloc("bad", **changes)], 10)
    assert out["applications"] == [] and [s["application_id"] for s in out["skipped"]] == ["bad"]


@pytest.mark.parametrize("fall", [-5, 41, 100, 2.5, True, None])
def test_a_fall_outside_0_to_40_is_refused_before_any_loan_is_looked_at(fall):
    with pytest.raises(ValueError):
        house_price_fall.run([mortgage()], fall)


def test_a_loan_type_that_is_neither_mortgage_nor_heloc_is_skipped():
    out = house_price_fall.run([mortgage("odd", loan_type="reverse"), mortgage("none", loan_type=None)], 10)
    assert out["applications"] == [] and sorted(s["application_id"] for s in out["skipped"]) == ["none", "odd"]
