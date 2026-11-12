"""The ECB rates, fetched by code so that every calculation uses a real, dated rate and never one a model made up.

Two series, both from the ECB data portal:
  mortgage_ie  the benchmark mortgage rate: Irish bank rates on new loans for house purchase, monthly (MIR.M.IE.B.A2C.A.R.A.2250.EUR.P)
  ecb_mrr      the main refinancing rate, which has an observation only on the days it changes (FM.B.U2.EUR.4F.KR.MRR_FR.LEV)

Each rate comes back with the date it is from, the value 12 months before that and the time it was fetched. Results are cached in Firestore
(rates_cache/{name}) and fetched again once the cache is more than a day old. If the ECB cannot be reached we
fall back to the cached rate only while it is at most 3 calendar months old; past that we raise, because a rate that old is not one to price on. "Old" is
the age of the observation for the monthly mortgage series, and the time since we last fetched it for the main refinancing rate, which only has a value
when it changes and so can have an old observation while still being the current rate.

    from app import rates
    rate = rates.get_rate("mortgage_ie")      # rate.pct 3.52, rate.month "2026-09"

`python -m app.rates` fetches both against the Firestore in FIRESTORE_EMULATOR_HOST (or the project's own) and prints them.
"""

import csv
import io
import json
import logging
import os
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Callable
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from typing import Protocol

from app.llm import clients

log = logging.getLogger("al-ai.rates")

BASE_URL = "https://data-api.ecb.europa.eu/service/data"
TIMEOUT_S = 20
COLLECTION = "rates_cache"
CACHE_MAX_AGE = timedelta(days=1)
MAX_OBSERVATION_AGE_MONTHS = 3
HISTORY_YEARS = 5  # far enough back to find the rate in force a year ago, even for a series that has not changed in a long time


@dataclass(frozen=True)
class Series:
    flow: str
    key: str
    label: str
    # How an outage fallback decides the cached rate is still good enough (see get_rate):
    #   "observation"  a series with a value every period: the cached rate's own period must be recent, so a series the ECB has stopped publishing is refused
    #   "fetched"      a series with a value only on the days it changes: its period can be old while the rate is current, so what counts is when we last confirmed it
    judged_on: str = "observation"


SERIES = {
    "mortgage_ie": Series("MIR", "M.IE.B.A2C.A.R.A.2250.EUR.P", "Benchmark mortgage rate, Ireland, new house-purchase loans"),
    "ecb_mrr": Series("FM", "B.U2.EUR.4F.KR.MRR_FR.LEV", "ECB main refinancing rate", judged_on="fetched"),
}


class RateUnavailable(Exception):
    """There is no rate we can stand behind. The message says why, and no number is returned."""


@dataclass(frozen=True)
class Rate:
    name: str
    pct: float  # 4.0 means 4%
    observed: str  # the period the ECB gives: "2026-09" for a monthly series, "2026-09-16" for a daily one
    year_earlier_pct: float | None  # the rate in force 12 months before `observed`; None when the history does not reach back that far
    year_earlier_observed: str | None
    fetched_at: datetime  # when we asked the ECB, always timezone-aware UTC

    @property
    def month(self) -> str:
        """YYYY-MM, the month the rate is from."""
        return self.observed[:7]

    def to_doc(self) -> dict:
        return {
            "name": self.name, "ratePct": self.pct, "observed": self.observed,
            "yearEarlierPct": self.year_earlier_pct, "yearEarlierObserved": self.year_earlier_observed,
            "fetchedAt": self.fetched_at,
        }

    @classmethod
    def from_doc(cls, name: str, doc: dict) -> "Rate":
        fetched = doc["fetchedAt"]
        return cls(
            name, float(doc["ratePct"]), str(doc["observed"]),
            None if doc.get("yearEarlierPct") is None else float(doc["yearEarlierPct"]), doc.get("yearEarlierObserved"),
            fetched if fetched.tzinfo else fetched.replace(tzinfo=timezone.utc),
        )


# ---- the cache ----


class Cache(Protocol):
    def load(self, name: str) -> dict | None: ...
    def save(self, name: str, doc: dict) -> None: ...


class MemoryCache:
    def __init__(self):
        self.docs: dict[str, dict] = {}

    def load(self, name):
        return self.docs.get(name)

    def save(self, name, doc):
        self.docs[name] = doc


class FirestoreCache:
    """rates_cache/{name}. Written server-side; the security rules give no client any access to it.

    The client is the same one al-core uses: with FIRESTORE_EMULATOR_HOST set it talks to the emulator and needs no credentials.
    """

    def __init__(self, client=None):
        self._client = client

    def _db(self):
        if self._client is None:
            from google.cloud import firestore

            self._client = firestore.Client(project=os.getenv("FIREBASE_PROJECT_ID", "demo-al"))
        return self._client

    def load(self, name):
        snapshot = self._db().collection(COLLECTION).document(name).get()
        return snapshot.to_dict() if snapshot.exists else None

    def save(self, name, doc):
        self._db().collection(COLLECTION).document(name).set(doc)


# ---- the fetch ----

Transport = Callable[[str, dict, float], tuple[int, bytes]]


def urllib_get(url: str, headers: dict, timeout: float) -> tuple[int, bytes]:
    request = urllib.request.Request(url, headers=headers, method="GET")
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.status, response.read()
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read()


def _period_start(period: str) -> date:
    """The first day of an ECB period: 2026-09 is 1 Sep 2026 and 2026-09-16 is 16 Sep 2026."""
    parts = [int(p) for p in period.split("-")]
    if len(parts) not in (2, 3):
        raise ValueError(period)
    return date(parts[0], parts[1], parts[2] if len(parts) == 3 else 1)


def _year_before(day: date) -> date:
    try:
        return day.replace(year=day.year - 1)
    except ValueError:  # 29 Feb
        return day.replace(year=day.year - 1, day=28)


def _observations(raw: bytes) -> list[tuple[date, str, float]]:
    """(start of period, period, value) for every observation in the ECB's csv, oldest first. Rows with no value are skipped."""
    found = []
    for row in csv.DictReader(io.StringIO(raw.decode("utf-8-sig"))):
        value, period = (row.get("OBS_VALUE") or "").strip(), (row.get("TIME_PERIOD") or "").strip()
        if not value or not period:
            continue
        found.append((_period_start(period), period, float(value)))
    return sorted(found)


def fetch(name: str, *, transport: Transport = urllib_get, now: datetime | None = None, timeout: float = TIMEOUT_S) -> Rate:
    """Ask the ECB for one series. Raises RateUnavailable, with the reason, if it cannot give us a usable rate."""
    series = SERIES[name]
    now = now or datetime.now(timezone.utc)
    since = now.date().replace(year=now.year - HISTORY_YEARS, day=1)
    query = urllib.parse.urlencode({"startPeriod": since.isoformat(), "format": "csvdata"})
    url = f"{BASE_URL}/{series.flow}/{series.key}?{query}"
    try:
        status, raw = transport(url, {"Accept": "text/csv", "User-Agent": clients.USER_AGENT}, timeout)
    except OSError as exc:
        raise RateUnavailable(f"the ECB could not be reached ({type(exc).__name__}: {exc})") from None
    if status != 200:
        raise RateUnavailable(f"the ECB answered HTTP {status} for {series.label}: {raw.decode(errors='replace')[:200]}")
    try:
        observed = _observations(raw)
    except (ValueError, KeyError, UnicodeDecodeError, csv.Error):
        raise RateUnavailable(f"the ECB sent {series.label} in a shape we do not recognise") from None
    if not observed:
        raise RateUnavailable(f"the ECB sent no observations for {series.label}")
    day, period, value = observed[-1]
    earlier = [o for o in observed if o[0] <= _year_before(day)]
    before = earlier[-1] if earlier else None
    return Rate(name, value, period, before[2] if before else None, before[1] if before else None, now)


def _months_since(moment: datetime, now: datetime) -> int:
    return (now.year * 12 + now.month) - (moment.year * 12 + moment.month)


def _months_old(period: str, now: datetime) -> int:
    day = _period_start(period)
    return (now.year * 12 + now.month) - (day.year * 12 + day.month)


def get_rate(
    name: str,
    *,
    cache: Cache | None = None,
    transport: Transport = urllib_get,
    now: datetime | None = None,
) -> Rate:
    """The current rate: from the cache if it was fetched within the last day, else from the ECB.

    If the ECB cannot be reached the cached rate is returned only while it is at most 3 calendar months old. For `mortgage_ie`, which has
    a value every month, that is the age of its observation. For `ecb_mrr`, which has a value only on the days the rate changes, the
    observation can be old while the rate is still current, so it is the time since we last fetched it (and so confirmed it).
    Otherwise this raises RateUnavailable with the reason; it never returns a rate it cannot date.
    """
    if name not in SERIES:
        raise KeyError(f"unknown rate {name!r}; the rates are {', '.join(SERIES)}")
    cache = FirestoreCache() if cache is None else cache
    now = now or datetime.now(timezone.utc)

    cached = None
    try:
        doc = cache.load(name)
        cached = Rate.from_doc(name, doc) if doc else None
    except Exception:  # a broken cache must not stop us asking the ECB
        log.warning("rates cache could not be read for %s", name, exc_info=True)
    if cached and now - cached.fetched_at <= CACHE_MAX_AGE:
        return cached

    try:
        rate = fetch(name, transport=transport, now=now)
    except RateUnavailable as exc:
        if cached and SERIES[name].judged_on == "fetched":
            if _months_since(cached.fetched_at, now) <= MAX_OBSERVATION_AGE_MONTHS:
                log.warning("ECB fetch for %s failed (%s); using the cached rate, last confirmed %s", name, exc, cached.fetched_at.date())
                return cached
            raise RateUnavailable(
                f"{exc}; the last rate we have for {name} was last confirmed on {cached.fetched_at.date()}, more than {MAX_OBSERVATION_AGE_MONTHS} months ago"
            ) from None
        if cached and _months_old(cached.observed, now) <= MAX_OBSERVATION_AGE_MONTHS:
            log.warning("ECB fetch for %s failed (%s); using the cached rate from %s", name, exc, cached.observed)
            return cached
        if cached:
            raise RateUnavailable(
                f"{exc}; the last rate we have for {name} is from {cached.observed}, more than {MAX_OBSERVATION_AGE_MONTHS} months old"
            ) from None
        raise RateUnavailable(f"{exc}; and there is no cached {name} rate") from None
    try:
        cache.save(name, rate.to_doc())
    except Exception:  # the rate is real and dated, so use it even though it could not be kept
        log.warning("rates cache could not be written for %s", name, exc_info=True)
    return rate


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    cache = FirestoreCache()
    for key in SERIES:
        rate = get_rate(key, cache=cache)
        print(json.dumps({**rate.to_doc(), "fetchedAt": rate.fetched_at.isoformat()}, indent=2))
