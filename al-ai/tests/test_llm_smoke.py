"""The smoke runner: one tiny structured-output call per provider, saved as evidence.

The offline tests use a fake network. The live tests send real requests with your own keys, so they only run when
AL_LIVE_LLM=1 is set (they use a few free-tier requests): AL_LIVE_LLM=1 uv run pytest tests/test_llm_smoke.py
"""

import json
import os

import pytest

from app.llm import clients, smoke

KEY = "SECRET-KEY-do-not-leak-0123456789"
OK_BODY = {"choices": [{"message": {"content": '{"answer": 4}'}}], "usage": {"prompt_tokens": 9, "completion_tokens": 4}, "id": "req-1"}


def transport(url, headers, body, timeout):
    if "generativelanguage" in url:
        return 200, {}, json.dumps({"candidates": [{"content": {"parts": [{"text": '{"answer": 4}'}]}}], "responseId": "g1"}).encode()
    if "11434" in url:
        return 200, {}, json.dumps({"message": {"content": '{"answer": 4}'}}).encode()
    return 200, {}, json.dumps(OK_BODY).encode()


MODELS = {"gemini": "g-model", "mistral": "m-model", "groq": "q-model", "ollama": "o-model"}


def test_a_provider_with_no_key_is_skipped_not_failed():
    results = smoke.run(MODELS, env={}, transport=transport, only=["groq"])
    assert results == [{"provider": "groq", "model": "q-model", "status": "skipped", "reason": "GROQ_API_KEY is not set"}]


def test_a_working_provider_is_recorded_as_passed_with_its_details():
    (r,) = smoke.run(MODELS, env={"GROQ_API_KEY": KEY}, transport=transport, only=["groq"])
    assert r["status"] == "passed" and r["provider"] == "groq" and r["model"] == "q-model"
    assert r["raw_reply"] == '{"answer": 4}' and r["input_tokens"] == 9 and r["output_tokens"] == 4 and r["request_id"] == "req-1"
    assert r["duration_s"] >= 0 and r["checked_on"]


def test_a_wrong_answer_is_a_fail_even_if_the_schema_passes():
    def wrong(url, headers, body, timeout):
        return 200, {}, json.dumps({"choices": [{"message": {"content": '{"answer": 5}'}}]}).encode()

    (r,) = smoke.run(MODELS, env={"GROQ_API_KEY": KEY}, transport=wrong, only=["groq"])
    assert r["status"] == "failed" and "4" in r["reason"]


def test_a_provider_error_is_recorded_as_failed_and_the_others_still_run():
    def flaky(url, headers, body, timeout):
        if "groq" in url:
            return 429, {}, b'{"error": "rate limit"}'
        return transport(url, headers, body, timeout)

    results = smoke.run(MODELS, env={"GROQ_API_KEY": KEY, "MISTRAL_API_KEY": KEY}, transport=flaky, only=["groq", "mistral"])
    by_provider = {r["provider"]: r for r in results}
    assert by_provider["groq"]["status"] == "failed" and "429" in by_provider["groq"]["reason"]
    assert by_provider["mistral"]["status"] == "passed"


def test_the_saved_evidence_never_contains_a_key(tmp_path):
    def echo(url, headers, body, timeout):
        return 401, {}, f'{{"error": "bad key {KEY}"}}'.encode()

    results = smoke.run(MODELS, env={"GROQ_API_KEY": KEY}, transport=echo, only=["groq"])
    out = smoke.save(results, tmp_path / "evidence.json")
    assert KEY not in out.read_text()
    assert json.loads(out.read_text())["results"][0]["status"] == "failed"


def test_an_env_file_is_read_without_overriding_what_is_already_set(tmp_path):
    path = tmp_path / ".env"
    path.write_text("# a comment\nGROQ_API_KEY=from-file\n\nOLLAMA_HOST = http://x:1\nEMPTY=\nBAD LINE\n")
    env = smoke.load_env(path, base={"GROQ_API_KEY": "already-set"})
    assert env["GROQ_API_KEY"] == "already-set" and env["OLLAMA_HOST"] == "http://x:1" and env["EMPTY"] == ""


def test_a_missing_env_file_is_fine(tmp_path):
    assert smoke.load_env(tmp_path / "nope", base={"A": "1"}) == {"A": "1"}


# ---- live: real requests, opt in -----------------------------------------------------------------------------

LIVE = pytest.mark.skipif(not os.getenv("AL_LIVE_LLM"), reason="live calls use free-tier requests: run with AL_LIVE_LLM=1")


@LIVE
@pytest.mark.parametrize("provider", ["gemini", "groq", "ollama", "mistral"])
def test_live_provider_answers_the_tiny_structured_request(provider):
    from app.llm import config

    env = smoke.load_env()
    models = config.load().smoke_models()
    (r,) = smoke.run(models, env=env, only=[provider])
    if r["status"] == "skipped":
        pytest.skip(r["reason"])
    assert r["status"] == "passed", r.get("reason")
    assert isinstance(r["raw_reply"], str) and clients.PROVIDERS[provider]
