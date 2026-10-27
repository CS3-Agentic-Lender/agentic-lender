"""The four provider clients, tested with a fake network so no key and no money is involved."""

import json
import logging

import pytest

from app.llm import clients

SCHEMA = {
    "type": "object",
    "properties": {"answer": {"type": "integer"}},
    "required": ["answer"],
    "additionalProperties": False,
}
KEY = "SECRET-KEY-do-not-leak-0123456789"
ENV = {"GEMINI_API_KEY": KEY, "MISTRAL_API_KEY": KEY, "GROQ_API_KEY": KEY, "OLLAMA_HOST": "http://ollama.test:11434"}
REPLY = '{"answer": 4}'

# What each provider really sends back, trimmed to the parts we read.
RESPONSES = {
    "gemini": ({}, {"candidates": [{"content": {"parts": [{"text": REPLY}]}}],
                    "usageMetadata": {"promptTokenCount": 11, "candidatesTokenCount": 5}, "responseId": "gem-req-1"}),
    "mistral": ({}, {"id": "mis-req-1", "choices": [{"message": {"content": REPLY}}], "usage": {"prompt_tokens": 12, "completion_tokens": 6}}),
    "groq": ({"x-request-id": "groq-req-1"}, {"id": "chatcmpl-x", "choices": [{"message": {"content": REPLY}}],
                                              "usage": {"prompt_tokens": 13, "completion_tokens": 7}}),
    "ollama": ({}, {"message": {"content": REPLY}, "prompt_eval_count": 14, "eval_count": 8}),
}
EXPECTED = {  # input tokens, output tokens, request id
    "gemini": (11, 5, "gem-req-1"), "mistral": (12, 6, "mis-req-1"), "groq": (13, 7, "groq-req-1"), "ollama": (14, 8, None),
}


class Net:
    """A fake network that records every call and answers with a canned reply."""

    def __init__(self, status=200, headers=None, body=None, error=None):
        self.calls, self.status, self.headers, self.body, self.error = [], status, headers or {}, body, error

    def __call__(self, url, headers, body, timeout):
        self.calls.append({"url": url, "headers": headers, "body": json.loads(body), "timeout": timeout})
        if self.error:
            raise self.error
        return self.status, self.headers, json.dumps(self.body).encode() if not isinstance(self.body, bytes) else self.body


def net_for(provider):
    headers, body = RESPONSES[provider]
    return Net(headers=headers, body=body)


def ask(provider, net, env=ENV, model="the-model"):
    return clients.complete_json(provider, model, "be brief", "what is 2+2", SCHEMA, transport=net, env=env)


@pytest.mark.parametrize("provider", sorted(RESPONSES))
def test_each_client_returns_the_raw_reply_the_parsed_json_the_tokens_and_the_request_id(provider):
    result = ask(provider, net_for(provider))
    inp, out, request_id = EXPECTED[provider]
    assert (result.provider, result.model) == (provider, "the-model")
    assert result.raw_reply == REPLY and result.parsed == {"answer": 4}
    assert (result.input_tokens, result.output_tokens, result.request_id) == (inp, out, request_id)
    assert result.duration_s >= 0


@pytest.mark.parametrize("provider", sorted(RESPONSES))
def test_each_client_sends_the_schema_the_model_and_the_prompt_to_its_own_provider(provider):
    net = net_for(provider)
    ask(provider, net)
    assert len(net.calls) == 1
    call = net.calls[0]
    text = json.dumps(call["body"])
    assert "the-model" in call["url"] + text and "what is 2+2" in text and "be brief" in text and '"answer"' in text
    host = {"gemini": "generativelanguage.googleapis.com", "mistral": "api.mistral.ai", "groq": "api.groq.com", "ollama": "ollama.test"}[provider]
    assert host in call["url"]


@pytest.mark.parametrize("provider", ["gemini", "mistral", "groq"])
def test_the_key_goes_in_a_header_and_never_in_the_url_or_body(provider):
    net = net_for(provider)
    ask(provider, net)
    call = net.calls[0]
    assert KEY in json.dumps(call["headers"])
    assert KEY not in call["url"] and KEY not in json.dumps(call["body"])


@pytest.mark.parametrize("provider", sorted(RESPONSES))
def test_every_request_names_itself_so_a_bot_filter_does_not_block_it(provider):
    # Groq sits behind Cloudflare, which refuses Python's default "Python-urllib" User-Agent with HTTP 403 (error 1010).
    net = net_for(provider)
    ask(provider, net)
    agent = net.calls[0]["headers"]["User-Agent"]
    assert agent.startswith("al-ai/") and "urllib" not in agent.lower()


def test_ollama_needs_no_key_and_sends_none():
    net = net_for("ollama")
    ask("ollama", net, env={"OLLAMA_HOST": "http://ollama.test:11434"})
    assert "authorization" not in json.dumps(net.calls[0]["headers"]).lower()


def test_ollama_uses_the_default_local_address_when_no_host_is_set():
    net = net_for("ollama")
    ask("ollama", net, env={})
    assert "localhost:11434" in net.calls[0]["url"]


@pytest.mark.parametrize("provider", ["gemini", "mistral", "groq"])
def test_a_missing_key_names_the_setting_and_makes_no_call(provider):
    net = net_for(provider)
    with pytest.raises(clients.MissingKey) as err:
        ask(provider, net, env={})
    assert provider.upper() + "_API_KEY" in str(err.value)
    assert net.calls == []


@pytest.mark.parametrize("provider", sorted(RESPONSES))
def test_a_rate_limit_is_an_error_and_there_is_no_fallback_to_another_provider(provider):
    net = Net(status=429, body={"error": {"message": "slow down"}})
    with pytest.raises(clients.LlmError):
        ask(provider, net)
    assert len(net.calls) == 1  # one call, to one provider, and nothing else


@pytest.mark.parametrize("provider", sorted(RESPONSES))
def test_a_dead_network_is_an_llm_error(provider):
    with pytest.raises(clients.LlmError):
        ask(provider, Net(error=OSError("connection refused")))


@pytest.mark.parametrize("provider", sorted(RESPONSES))
def test_a_reply_that_is_not_json_is_an_error(provider):
    headers, body = RESPONSES[provider]
    broken = json.loads(json.dumps(body).replace("{\\\"answer\\\": 4}", "four"))
    with pytest.raises(clients.LlmError):
        ask(provider, Net(headers=headers, body=broken))


@pytest.mark.parametrize("provider", sorted(RESPONSES))
def test_json_that_breaks_the_schema_is_an_error(provider):
    headers, body = RESPONSES[provider]
    wrong = json.loads(json.dumps(body).replace("{\\\"answer\\\": 4}", "{\\\"answer\\\": \\\"four\\\"}"))
    with pytest.raises(clients.LlmError, match="schema"):
        ask(provider, Net(headers=headers, body=wrong))


@pytest.mark.parametrize("provider", ["gemini", "mistral", "groq"])
def test_the_key_never_shows_up_in_an_error_or_a_log_even_if_the_provider_echoes_it(provider, caplog):
    net = Net(status=401, body={"error": {"message": f"bad key {KEY}"}})
    with caplog.at_level(logging.DEBUG), pytest.raises(clients.LlmError) as err:
        ask(provider, net)
    assert KEY not in str(err.value) and KEY not in caplog.text


@pytest.mark.parametrize("provider", sorted(RESPONSES))
def test_every_call_is_logged_without_the_key(provider, caplog):
    with caplog.at_level(logging.INFO, logger="al-ai.llm"):
        ask(provider, net_for(provider))
    entry = json.loads(caplog.records[-1].getMessage())
    assert entry["provider"] == provider and entry["model"] == "the-model" and entry["outcome"] == "ok"
    assert KEY not in caplog.text


def test_an_unknown_provider_is_refused():
    with pytest.raises(clients.LlmError):
        clients.complete_json("openai", "gpt-9", "s", "u", SCHEMA, transport=Net(body={}), env=ENV)


# ---- the small schema check ---------------------------------------------------------------------

@pytest.mark.parametrize("value,ok", [
    ({"answer": 4}, True), ({"answer": "4"}, False), ({}, False), ({"answer": 4, "extra": 1}, False), ([], False), ({"answer": True}, False),
])
def test_the_schema_check(value, ok):
    assert (clients.schema_errors(value, SCHEMA) == []) is ok


def test_the_schema_check_handles_enums_arrays_and_numbers():
    schema = {"type": "object", "properties": {"label": {"enum": ["a", "b"]}, "items": {"type": "array", "items": {"type": "number"}}},
              "required": ["label", "items"]}
    assert clients.schema_errors({"label": "a", "items": [1, 2.5]}, schema) == []
    assert clients.schema_errors({"label": "c", "items": []}, schema)
    assert clients.schema_errors({"label": "a", "items": [1, "x"]}, schema)


# ---- OLLAMA_HOST in the forms Ollama's own docs use ---------------------------------------------------------

@pytest.mark.parametrize("host,url", [
    ("127.0.0.1:11434", "http://127.0.0.1:11434/api/chat"),
    ("0.0.0.0", "http://0.0.0.0:11434/api/chat"),
    ("localhost", "http://localhost:11434/api/chat"),
    ("http://ollama.test:11434/", "http://ollama.test:11434/api/chat"),
    ("http://ollama.test:9000", "http://ollama.test:9000/api/chat"),
    ("https://ollama.example.com", "https://ollama.example.com/api/chat"),
    ("  http://localhost:11434  ", "http://localhost:11434/api/chat"),
    ("", "http://localhost:11434/api/chat"),
])
def test_ollama_host_works_with_or_without_a_scheme_and_a_port(host, url):
    net = net_for("ollama")
    ask("ollama", net, env={"OLLAMA_HOST": host})
    assert net.calls[0]["url"] == url


@pytest.mark.parametrize("host", ["ftp://x", "http://", "http://host:notaport", "://nothing", "http://host:99999"])
def test_a_bad_ollama_host_is_an_llm_error_not_a_crash(host):
    net = net_for("ollama")
    with pytest.raises(clients.LlmError, match="OLLAMA_HOST"):
        ask("ollama", net, env={"OLLAMA_HOST": host})
    assert net.calls == []
