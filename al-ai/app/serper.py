"""Serper web search for the market agent: one small client, urllib only, like the model clients in app.llm.

Every query is logged with the run and prompt version that asked for it, its outcome, its duration and the links it returned. The key is read from SERPER_API_KEY, goes only
in a request header, is never logged and is scrubbed from any error in case the provider echoes it back. There is no retry here:
the market agent decides what to do when a search fails.
"""

import json
import logging
import os
import time
from dataclasses import dataclass

from app.llm import clients

log = logging.getLogger("al-ai.serper")

URL = "https://google.serper.dev/search"
KEY_NAME = "SERPER_API_KEY"
TIMEOUT_S = 20
MAX_TITLE = 200
MAX_SNIPPET = 400


@dataclass(frozen=True)
class Hit:
    title: str
    link: str
    snippet: str
    date: str | None  # as Serper gives it ("2 days ago", "Oct 22, 2026"), None when it gives none


@dataclass(frozen=True)
class SearchResult:
    query: str
    hits: tuple[Hit, ...]
    duration_s: float
    credits: int | None  # what the search cost, so the free allowance can be watched


def _text(value, limit: int) -> str:
    return value.strip()[:limit] if isinstance(value, str) else ""


def _hits(body: dict) -> tuple[Hit, ...]:
    found = []
    for item in body.get("organic") or []:
        link = item.get("link") if isinstance(item, dict) else None
        if not isinstance(link, str) or not link.startswith(("http://", "https://")):
            continue  # a result with no usable link cannot be cited
        date = item.get("date")
        found.append(Hit(_text(item.get("title"), MAX_TITLE), link, _text(item.get("snippet"), MAX_SNIPPET), date.strip() if isinstance(date, str) and date.strip() else None))
    return tuple(found)


def search(
    query: str,
    *,
    run_id: str | None = None,
    prompt_version: str | None = None,
    num: int = 5,
    country: str = "ie",
    period: str = "m",
    transport: clients.Transport = clients.urllib_transport,
    env: dict | None = None,
    timeout: float = TIMEOUT_S,
) -> SearchResult:
    """One Serper search. `period` is Google's recency filter: d day, w week, m month, y year. Raises clients.LlmError if it fails.

    `run_id` and `prompt_version` are only logged, so a search can be tied to the run and the prompt that used it.
    """
    env = os.environ if env is None else env
    key = env.get(KEY_NAME, "")
    if not key:
        raise clients.MissingKey(f"{KEY_NAME} is not set")
    entry = {"search": query, "run_id": run_id, "prompt_version": prompt_version, "outcome": None, "links": []}
    started = time.monotonic()
    try:
        headers = {"X-API-KEY": key, "Content-Type": "application/json", "User-Agent": clients.USER_AGENT}
        body = json.dumps({"q": query, "num": num, "gl": country, "tbs": f"qdr:{period}"}).encode()

        def fail(message: str, status: int | None = None) -> clients.LlmError:
            error = clients.LlmError(message.replace(key, "[key]"))
            error.status = status
            return error

        try:
            status, _, raw = transport(URL, headers, body, timeout)
        except OSError as exc:
            raise fail(f"serper could not be reached ({type(exc).__name__}: {exc})") from None
        if status != 200:
            raise fail(f"serper answered HTTP {status}: {raw.decode(errors='replace')[:200]}", status)
        try:
            parsed = json.loads(raw)
            hits = _hits(parsed)
            credits = parsed.get("credits")
        except (ValueError, AttributeError, TypeError):
            raise fail("serper sent a reply in a shape we do not recognise") from None
        entry.update(outcome="ok", links=[hit.link for hit in hits], credits=credits)
        return SearchResult(query, hits, round(time.monotonic() - started, 3), credits if isinstance(credits, int) else None)
    except clients.LlmError as exc:
        entry.update(outcome="error", error=str(exc))
        raise
    finally:
        entry["duration_s"] = round(time.monotonic() - started, 3)
        log.info(json.dumps(entry))
