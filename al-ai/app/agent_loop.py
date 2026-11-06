"""The retry loop every committee agent step shares: ask the model, check the reply, retry what may clear, log every attempt.

A bad reply gets one retry with the reason shown to the model. A provider error that may clear (a timeout, an outage or a
rate limit) gets up to two retries with a pause (2 s, then 8 s, or the provider's Retry-After if longer). The run's `budget`
stops the loop when it runs out. The limits live in retry_policy.py. Anything else, such as a wrong key, fails at once. There is no other model to
fall back to: moving a step to another provider is an edit to agents.json made by a person.
"""

import json
import logging
import time
from datetime import UTC, datetime
from typing import Callable

from app import retry_policy
from app import valuation_agent as va
from app.llm import clients, config


def run_step(
    *,
    log: logging.Logger,
    agent: config.AgentModel,
    prompt: str,
    system: str,
    schema: dict,
    check: Callable[[dict], dict],
    run_id: str,
    prompt_version: str,
    context: dict | None = None,
    transport: clients.Transport = clients.urllib_transport,
    env: dict | None = None,
    sleep: Callable[[float], None] = time.sleep,
    budget: retry_policy.Budget | None = None,
) -> va.AgentResult:
    """`check` raises va.ReplyRejected with a message the model can act on. `context` is added to every logged attempt."""
    attempts: list[dict] = []
    error = None  # why the last reply was rejected, shown to the model on the retry
    invalid_retries = provider_retries = 0
    while True:
        if budget is not None and budget.remaining() <= 0:
            return va.AgentResult(False, None, budget.reason(), attempts)
        sent = prompt if error is None else f"{prompt}\n\nYour previous reply was rejected: {error}. Reply again with only the corrected JSON object."
        t0 = time.monotonic()
        attempt = {
            "run_id": run_id, "attempt": len(attempts) + 1, "provider": agent.provider, "model": agent.model,
            "prompt_version": prompt_version, "started_at": datetime.now(UTC).isoformat(), **(context or {}),
            "raw_reply": None, "parsed_reply": None, "request_id": None, "input_tokens": None, "output_tokens": None,
            "outcome": None, "error": None,
        }
        retry, retry_after = False, None
        try:
            got = clients.complete_json(agent.provider, agent.model, system, sent, schema, transport=transport, env=env, timeout=retry_policy.call_timeout(budget))
            attempt.update(raw_reply=got.raw_reply, request_id=got.request_id, input_tokens=got.input_tokens, output_tokens=got.output_tokens)
            attempt["parsed_reply"] = check(got.parsed)
            attempt["outcome"] = "ok"
        except va.ReplyRejected as exc:
            attempt.update(outcome="invalid_reply", error=str(exc))
            error, invalid_retries, retry = str(exc), invalid_retries + 1, invalid_retries < retry_policy.INVALID_REPLY_RETRIES
        except clients.InvalidReply as exc:  # not JSON, or JSON that breaks the schema
            attempt.update(outcome="invalid_reply", error=str(exc), raw_reply=exc.raw_reply, request_id=exc.request_id,
                           input_tokens=exc.input_tokens, output_tokens=exc.output_tokens)
            error, invalid_retries, retry = str(exc), invalid_retries + 1, invalid_retries < retry_policy.INVALID_REPLY_RETRIES
        except clients.MissingKey as exc:  # nothing was sent and asking again cannot help
            attempt.update(outcome="missing_key", error=str(exc))
        except clients.LlmError as exc:
            attempt.update(outcome="provider_error", error=str(exc))
            retry = va._retryable(exc) and provider_retries < retry_policy.PROVIDER_RETRIES
            retry_after = exc.retry_after
        attempt["duration_s"] = round(time.monotonic() - t0, 3)
        attempts.append(attempt)
        log.info(json.dumps(attempt))
        if attempt["outcome"] == "ok":
            return va.AgentResult(True, attempt["parsed_reply"], None, attempts)
        if not retry:
            return va.AgentResult(False, None, attempt["error"], attempts)
        if attempt["outcome"] == "provider_error":
            pause = retry_policy.pause_before_retry(provider_retries, retry_after, budget)
            if pause is None:
                return va.AgentResult(False, None, budget.reason(), attempts)
            sleep(pause)
            provider_retries += 1
