"""The Serper client: one search, logged, with the key kept out of everything we keep. Tested with a fake network."""

import json
import logging

import pytest

from app import serper
from app.llm import clients

KEY = "SERPER-KEY-do-not-leak-0123456789"
ENV = {"SERPER_API_KEY": KEY}


def body(*organic, credits=1):
    return json.dumps({"organic": list(organic), "credits": credits}).encode()


def item(link="https://example.ie/rates", title="Rates", snippet="The ECB held rates.", date="Oct 22, 2026"):
    return {"title": title, "link": link, "snippet": snippet, "date": date}


class Net:
    def __init__(self, status=200, raw=None, exc=None):
        self.status, self.raw, self.exc, self.calls = status, raw if raw is not None else body(item()), exc, []

    def __call__(self, url, headers, payload, timeout):
        self.calls.append({"url": url, "headers": headers, "body": json.loads(payload), "timeout": timeout})
        if self.exc:
            raise self.exc
        return self.status, {}, self.raw


def test_a_search_sends_the_key_in_a_header_and_asks_for_recent_irish_results():
    net = Net()
    serper.search("ecb rates", transport=net, env=ENV)
    call = net.calls[0]
    assert call["url"] == "https://google.serper.dev/search"
    assert call["headers"]["X-API-KEY"] == KEY and call["headers"]["User-Agent"].startswith("al-ai/")
    assert call["body"] == {"q": "ecb rates", "num": 5, "gl": "ie", "tbs": "qdr:m"}
    assert KEY not in json.dumps(call["body"])


def test_the_hits_keep_title_link_snippet_and_date():
    r = serper.search("q", transport=Net(), env=ENV)
    assert r.query == "q" and r.credits == 1
    assert r.hits == (serper.Hit("Rates", "https://example.ie/rates", "The ECB held rates.", "Oct 22, 2026"),)


def test_a_result_with_no_date_has_none_and_a_result_with_no_usable_link_is_dropped():
    raw = body({"title": "t", "link": "https://a.ie", "snippet": "s"}, {"title": "bad", "link": "javascript:alert(1)"}, {"title": "none"}, "junk")
    r = serper.search("q", transport=Net(raw=raw), env=ENV)
    assert [(h.link, h.date) for h in r.hits] == [("https://a.ie", None)]


def test_long_text_is_cut_so_a_snippet_cannot_flood_the_prompt():
    r = serper.search("q", transport=Net(raw=body(item(title="t" * 900, snippet="s" * 900))), env=ENV)
    assert len(r.hits[0].title) == serper.MAX_TITLE and len(r.hits[0].snippet) == serper.MAX_SNIPPET


def test_no_key_means_nothing_is_sent():
    net = Net()
    with pytest.raises(clients.MissingKey):
        serper.search("q", transport=net, env={})
    assert net.calls == []


@pytest.mark.parametrize("status", [401, 403, 429, 500])
def test_an_error_status_raises_with_the_status_and_never_the_key(status):
    with pytest.raises(clients.LlmError) as err:
        serper.search("q", transport=Net(status=status, raw=f"denied {KEY}".encode()), env=ENV)
    assert err.value.status == status and KEY not in str(err.value) and "[key]" in str(err.value)


def test_a_network_failure_raises_an_error_without_a_status():
    with pytest.raises(clients.LlmError) as err:
        serper.search("q", transport=Net(exc=TimeoutError("timed out")), env=ENV)
    assert err.value.status is None and "could not be reached" in str(err.value)


@pytest.mark.parametrize("raw", [b"not json", b"[]", b'{"organic": 5}'])
def test_a_reply_in_the_wrong_shape_raises(raw):
    with pytest.raises(clients.LlmError, match="shape"):
        serper.search("q", transport=Net(raw=raw), env=ENV)


def test_every_query_is_logged_with_its_outcome_and_links_and_never_the_key(caplog):
    with caplog.at_level(logging.INFO, logger="al-ai.serper"):
        serper.search("ecb rates", transport=Net(), env=ENV)
        with pytest.raises(clients.LlmError):
            serper.search("again", transport=Net(status=429, raw=KEY.encode()), env=ENV)
    ok, bad = (json.loads(r.message) for r in caplog.records)
    assert ok["search"] == "ecb rates" and ok["outcome"] == "ok" and ok["links"] == ["https://example.ie/rates"] and "duration_s" in ok
    assert bad["outcome"] == "error"
    assert KEY not in caplog.text


def test_a_query_is_logged_with_the_run_and_prompt_version_that_asked_for_it(caplog):
    with caplog.at_level(logging.INFO, logger="al-ai.serper"):
        serper.search("ecb rates", run_id="run-7", prompt_version="market-agent-v1", transport=Net(), env=ENV)
        serper.search("no run", transport=Net(), env=ENV)
    tied, loose = (json.loads(r.message) for r in caplog.records)
    assert tied["run_id"] == "run-7" and tied["prompt_version"] == "market-agent-v1"
    assert loose["run_id"] is None and loose["prompt_version"] is None
