"""The ECB rate tool: parsing a recorded ECB reply, the one-day cache, and the refusal to return a rate that is too old. Tested with a fake network."""

import re
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from app import rates
from app.rates import FirestoreCache, MemoryCache, Rate, RateUnavailable

FIXTURES = Path(__file__).parent / "fixtures"
# Replies the ECB really sent on 5 Nov 2026 (trimmed to start at 2025-06).
MORTGAGE_CSV = (FIXTURES / "ecb_mir_ie.csv").read_bytes()
MRR_CSV = (FIXTURES / "ecb_mrr.csv").read_bytes()
NOW = datetime(2026, 11, 5, 12, 0, tzinfo=timezone.utc)


class Net:
    """Answers each series with its recorded reply, or fails the way it is told to."""

    def __init__(self, status=200, raw=None, exc=None):
        self.status, self.raw, self.exc, self.calls = status, raw, exc, []

    def __call__(self, url, headers, timeout):
        self.calls.append({"url": url, "headers": headers, "timeout": timeout})
        if self.exc:
            raise self.exc
        raw = self.raw if self.raw is not None else (MRR_CSV if "/FM/" in url else MORTGAGE_CSV)
        return self.status, raw


def csv_of(*rows):
    return ("KEY,TIME_PERIOD,OBS_VALUE,OBS_STATUS\n" + "".join(f"K,{p},{v},A\n" for p, v in rows)).encode()


def cached(name="mortgage_ie", observed="2026-09", fetched=NOW - timedelta(hours=3), pct=3.52):
    return Rate(name, pct, observed, 3.59, "2025-09", fetched)


def cache_with(rate):
    cache = MemoryCache()
    cache.save(rate.name, rate.to_doc())
    return cache


# ---- the parsing, on the recorded replies ----


def test_the_mortgage_rate_is_the_latest_month_with_the_month_a_year_earlier():
    rate = rates.fetch("mortgage_ie", transport=Net(), now=NOW)
    assert (rate.pct, rate.observed, rate.month) == (3.52, "2026-09", "2026-09")
    assert (rate.year_earlier_pct, rate.year_earlier_observed) == (3.59, "2025-09")
    assert rate.fetched_at == NOW


def test_the_refinancing_rate_is_the_latest_change_and_the_rate_in_force_a_year_earlier():
    rate = rates.fetch("ecb_mrr", transport=Net(), now=NOW)
    assert (rate.pct, rate.observed, rate.month) == (2.65, "2026-09-16", "2026-09")
    # nothing changed between 11 Jun 2025 and 17 Jun 2026, so the rate in force on 16 Sep 2025 is the June 2025 one
    assert (rate.year_earlier_pct, rate.year_earlier_observed) == (2.15, "2025-06-11")


def test_a_series_with_no_history_a_year_back_has_no_year_earlier_rate():
    rate = rates.fetch("mortgage_ie", transport=Net(raw=csv_of(("2026-08", "3.5"), ("2026-09", "3.52"))), now=NOW)
    assert (rate.pct, rate.year_earlier_pct, rate.year_earlier_observed) == (3.52, None, None)


def test_the_request_names_the_series_and_how_far_back_to_look():
    net = Net()
    rates.fetch("mortgage_ie", transport=net, now=NOW)
    rates.fetch("ecb_mrr", transport=net, now=NOW)
    mortgage, mrr = net.calls
    assert mortgage["url"] == "https://data-api.ecb.europa.eu/service/data/MIR/M.IE.B.A2C.A.R.A.2250.EUR.P?startPeriod=2021-11-01&format=csvdata"
    assert mrr["url"] == "https://data-api.ecb.europa.eu/service/data/FM/B.U2.EUR.4F.KR.MRR_FR.LEV?startPeriod=2021-11-01&format=csvdata"
    assert mortgage["headers"]["Accept"] == "text/csv" and mortgage["headers"]["User-Agent"].startswith("al-ai/")


def test_observations_are_taken_in_date_order_and_empty_values_are_skipped():
    raw = csv_of(("2026-09", "3.52"), ("2026-10", ""), ("2025-09", "3.59"))
    rate = rates.fetch("mortgage_ie", transport=Net(raw=raw), now=NOW)
    assert (rate.pct, rate.observed, rate.year_earlier_pct) == (3.52, "2026-09", 3.59)


def test_a_leap_day_still_finds_the_year_earlier_rate():
    raw = csv_of(("2024-02-28", "4.0"), ("2025-02-27", "3.0"), ("2028-02-29", "2.0"))
    rate = rates.fetch("ecb_mrr", transport=Net(raw=raw), now=datetime(2028, 3, 1, tzinfo=timezone.utc))
    assert (rate.pct, rate.year_earlier_pct, rate.year_earlier_observed) == (2.0, 3.0, "2025-02-27")


@pytest.mark.parametrize(
    "net, reason",
    [
        (Net(status=500, raw=b"boom"), "HTTP 500"),
        (Net(status=404, raw=b"No Results found"), "HTTP 404"),
        (Net(exc=TimeoutError("timed out")), "could not be reached (TimeoutError: timed out)"),
        (Net(raw=b""), "no observations"),
        (Net(raw=b"KEY,TIME_PERIOD,OBS_VALUE,OBS_STATUS\n"), "no observations"),
        (Net(raw=b"<html>maintenance</html>"), "no observations"),
        (Net(raw=csv_of(("2026-09", "n/a"))), "shape we do not recognise"),
        (Net(raw=csv_of(("September", "3.5"))), "shape we do not recognise"),
        (Net(raw=b"\xff\xfe\x00bad"), "shape we do not recognise"),
    ],
)
def test_a_reply_we_cannot_use_raises_with_the_reason_and_returns_no_number(net, reason):
    with pytest.raises(RateUnavailable, match=re.escape(reason)):
        rates.fetch("mortgage_ie", transport=net, now=NOW)


# ---- the cache ----


def test_a_rate_fetched_less_than_a_day_ago_comes_from_the_cache_without_asking_the_ecb():
    net = Net()
    rate = rates.get_rate("mortgage_ie", cache=cache_with(cached()), transport=net, now=NOW)
    assert net.calls == [] and rate == cached()


def test_a_rate_exactly_a_day_old_is_still_used_and_one_second_older_is_fetched_again():
    net = Net()
    rates.get_rate("mortgage_ie", cache=cache_with(cached(fetched=NOW - timedelta(days=1))), transport=net, now=NOW)
    assert net.calls == []
    rates.get_rate("mortgage_ie", cache=cache_with(cached(fetched=NOW - timedelta(days=1, seconds=1))), transport=net, now=NOW)
    assert len(net.calls) == 1


def test_an_empty_cache_fetches_and_keeps_the_result_with_its_dates():
    cache, net = MemoryCache(), Net()
    rate = rates.get_rate("mortgage_ie", cache=cache, transport=net, now=NOW)
    assert cache.docs["mortgage_ie"] == {
        "name": "mortgage_ie", "ratePct": 3.52, "observed": "2026-09", "yearEarlierPct": 3.59, "yearEarlierObserved": "2025-09", "fetchedAt": NOW,
    }
    assert rates.get_rate("mortgage_ie", cache=cache, transport=net, now=NOW + timedelta(hours=23)) == rate
    assert len(net.calls) == 1  # the second ask came from the cache


def test_a_stale_cache_is_replaced_by_a_fresh_fetch():
    cache = cache_with(cached(observed="2026-08", pct=3.4, fetched=NOW - timedelta(days=2)))
    rate = rates.get_rate("mortgage_ie", cache=cache, transport=Net(), now=NOW)
    assert (rate.pct, rate.observed) == (3.52, "2026-09")
    assert cache.docs["mortgage_ie"]["ratePct"] == 3.52 and cache.docs["mortgage_ie"]["fetchedAt"] == NOW


def test_each_series_has_its_own_cache_entry():
    cache = MemoryCache()
    rates.get_rate("mortgage_ie", cache=cache, transport=Net(), now=NOW)
    rates.get_rate("ecb_mrr", cache=cache, transport=Net(), now=NOW)
    assert (cache.docs["mortgage_ie"]["ratePct"], cache.docs["ecb_mrr"]["ratePct"]) == (3.52, 2.65)


def test_an_unknown_rate_name_is_an_error_not_a_guess():
    with pytest.raises(KeyError, match="mortgage_ie, ecb_mrr"):
        rates.get_rate("euribor", cache=MemoryCache(), transport=Net(), now=NOW)


# ---- when the ECB cannot be reached ----


def failing():
    return Net(status=503, raw=b"down")


def test_if_the_fetch_fails_a_cached_rate_with_a_recent_observation_is_used():
    old = cached(observed="2026-08", fetched=NOW - timedelta(days=2))
    assert rates.get_rate("mortgage_ie", cache=cache_with(old), transport=failing(), now=NOW) == old


@pytest.mark.parametrize("observed, ok", [("2026-11", True), ("2026-08", True), ("2026-07", False), ("2026-06", False)])
def test_the_cutoff_is_three_calendar_months(observed, ok):
    old = cached(observed=observed, fetched=NOW - timedelta(days=2))
    if ok:
        assert rates.get_rate("mortgage_ie", cache=cache_with(old), transport=failing(), now=NOW) == old
    else:
        with pytest.raises(RateUnavailable, match=f"from {observed}, more than 3 months old"):
            rates.get_rate("mortgage_ie", cache=cache_with(old), transport=failing(), now=NOW)


# ---- the main refinancing rate only has a value when it changes, so it is judged on when it was last fetched (AL-298) -----


def mrr(observed="2025-06-11", fetched=NOW - timedelta(days=2), pct=2.15):
    return cached(name="ecb_mrr", observed=observed, fetched=fetched, pct=pct)


def test_a_refinancing_rate_that_has_not_changed_for_over_a_year_is_still_used_when_the_ecb_is_down_if_it_was_fetched_recently():
    old = mrr(observed="2025-06-11")  # the real series: the last change was over a year ago and the rate is still 2.15
    got = rates.get_rate("ecb_mrr", cache=cache_with(old), transport=failing(), now=NOW)
    assert got == old and got.pct == 2.15


@pytest.mark.parametrize("fetched, ok", [
    (NOW - timedelta(days=2), True),
    (datetime(2026, 8, 5, 9, 0, tzinfo=timezone.utc), True),  # 3 calendar months back
    (datetime(2026, 7, 31, 9, 0, tzinfo=timezone.utc), False),  # 4 calendar months back
    (datetime(2026, 1, 5, 9, 0, tzinfo=timezone.utc), False),
])
def test_the_refinancing_cutoff_is_three_calendar_months_since_it_was_fetched(fetched, ok):
    old = mrr(fetched=fetched)
    if ok:
        assert rates.get_rate("ecb_mrr", cache=cache_with(old), transport=failing(), now=NOW) == old
    else:
        with pytest.raises(RateUnavailable, match=f"last confirmed on {fetched.date()}, more than 3 months ago"):
            rates.get_rate("ecb_mrr", cache=cache_with(old), transport=failing(), now=NOW)


def test_a_refinancing_rate_not_fetched_for_months_still_raises_with_both_reasons_and_no_number():
    stale = mrr(observed="2026-09-16", fetched=NOW - timedelta(days=200))
    with pytest.raises(RateUnavailable) as raised:
        rates.get_rate("ecb_mrr", cache=cache_with(stale), transport=failing(), now=NOW)
    assert "HTTP 503" in str(raised.value) and "last confirmed" in str(raised.value)


def test_a_recent_observation_does_not_save_a_refinancing_rate_that_was_not_fetched_for_months():
    recent_but_unconfirmed = mrr(observed="2026-10-20", fetched=NOW - timedelta(days=200))
    with pytest.raises(RateUnavailable, match="last confirmed"):
        rates.get_rate("ecb_mrr", cache=cache_with(recent_but_unconfirmed), transport=failing(), now=NOW)


def test_the_monthly_mortgage_rate_is_still_judged_on_its_observation_not_on_when_it_was_fetched():
    # fetched two days ago, but the ECB has not published a newer month for over three months: that is a series that stopped, not a rate that held
    stopped = cached(observed="2026-05", fetched=NOW - timedelta(days=2))
    with pytest.raises(RateUnavailable, match="from 2026-05, more than 3 months old"):
        rates.get_rate("mortgage_ie", cache=cache_with(stopped), transport=failing(), now=NOW)


def test_a_fresh_fetch_of_an_unchanged_refinancing_rate_is_what_counts_as_confirming_it():
    old = mrr(observed="2025-06-11", fetched=NOW - timedelta(days=2))
    cache = cache_with(old)
    got = rates.get_rate("ecb_mrr", cache=cache, transport=Net(), now=NOW)  # the ECB answers: the cache is replaced and fetched_at moves to now
    assert got.fetched_at == NOW and cache.docs["ecb_mrr"]["fetchedAt"] == NOW


def test_if_the_fetch_fails_and_the_cached_observation_is_too_old_the_error_carries_both_reasons_and_no_number():
    old = cached(observed="2026-05", fetched=NOW - timedelta(days=30))
    with pytest.raises(RateUnavailable) as raised:
        rates.get_rate("mortgage_ie", cache=cache_with(old), transport=failing(), now=NOW)
    assert "HTTP 503" in str(raised.value) and "2026-05" in str(raised.value) and "3 months" in str(raised.value)


def test_if_the_fetch_fails_and_nothing_is_cached_there_is_no_rate_to_return():
    with pytest.raises(RateUnavailable, match=r"HTTP 503.*no cached mortgage_ie rate"):
        rates.get_rate("mortgage_ie", cache=MemoryCache(), transport=failing(), now=NOW)


def test_a_fresh_cache_hides_an_outage_that_the_ecb_is_not_asked_about():
    net = failing()
    assert rates.get_rate("mortgage_ie", cache=cache_with(cached()), transport=net, now=NOW).pct == 3.52
    assert net.calls == []


# ---- a cache that is broken ----


class BrokenCache(MemoryCache):
    def __init__(self, load=False, save=False):
        super().__init__()
        self.fail_load, self.fail_save = load, save

    def load(self, name):
        if self.fail_load:
            raise ConnectionError("firestore is down")
        return super().load(name)

    def save(self, name, doc):
        if self.fail_save:
            raise ConnectionError("firestore is down")
        super().save(name, doc)


def test_a_cache_that_cannot_be_read_does_not_stop_a_fresh_fetch():
    assert rates.get_rate("mortgage_ie", cache=BrokenCache(load=True), transport=Net(), now=NOW).pct == 3.52


def test_a_cache_that_cannot_be_written_still_returns_the_real_dated_rate():
    rate = rates.get_rate("mortgage_ie", cache=BrokenCache(save=True), transport=Net(), now=NOW)
    assert (rate.pct, rate.observed) == (3.52, "2026-09")


def test_with_the_cache_and_the_ecb_both_down_there_is_no_rate():
    with pytest.raises(RateUnavailable):
        rates.get_rate("mortgage_ie", cache=BrokenCache(load=True), transport=failing(), now=NOW)


# ---- the Firestore cache, against a fake client ----


class FakeSnapshot:
    def __init__(self, data):
        self.data = data
        self.exists = data is not None

    def to_dict(self):
        return self.data


class FakeFirestore:
    def __init__(self):
        self.docs = {}

    def collection(self, name):
        assert name == "rates_cache"
        return self

    def document(self, doc_id):
        self.id = doc_id
        return self

    def get(self):
        return FakeSnapshot(self.docs.get(self.id))

    def set(self, doc):
        self.docs[self.id] = doc


def test_the_firestore_cache_keeps_one_document_per_rate_in_rates_cache():
    client = FakeFirestore()
    cache = FirestoreCache(client=client)
    assert cache.load("mortgage_ie") is None
    rate = rates.get_rate("mortgage_ie", cache=cache, transport=Net(), now=NOW)
    assert client.docs["mortgage_ie"]["ratePct"] == 3.52
    assert rates.get_rate("mortgage_ie", cache=cache, transport=failing(), now=NOW) == rate


def test_a_time_read_back_without_a_zone_is_taken_as_utc():
    doc = {**cached().to_doc(), "fetchedAt": datetime(2026, 11, 5, 9, 0)}
    assert Rate.from_doc("mortgage_ie", doc).fetched_at == datetime(2026, 11, 5, 9, 0, tzinfo=timezone.utc)
