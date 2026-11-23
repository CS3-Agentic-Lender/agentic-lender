"""One JSON line per request with its request id (app/request_log.py), so a 500's request id finds its line in CloudWatch."""

import json
import logging
from pathlib import Path

import pytest
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient
from pydantic import BaseModel

from app import auth, errors, request_log
from app.main import app


@pytest.fixture(autouse=True)
def undo_the_start_up_logging():
    """send_to_stdout (what the start-up does) gives the logger its own handler: put it back as it was after each test."""
    log = logging.getLogger("al-core.requests")
    handlers, level, propagate = list(log.handlers), log.level, log.propagate
    log.handlers[:] = []  # so this test's send_to_stdout adds a handler on the stdout capsys is catching
    yield
    log.handlers[:] = handlers
    log.setLevel(level)
    log.propagate = propagate


def _printed_lines(capsys):
    return [json.loads(line) for line in capsys.readouterr().out.splitlines() if line.strip()]


class _Body(BaseModel):
    note: str


def _test_app():
    """A small app with al-core's error handling and request log, plus a route that crashes and one that reads a body."""
    test_app = FastAPI()
    errors.install(test_app)

    @test_app.get("/core/_crash")
    def crash():
        raise RuntimeError("boom: secret detail")

    @test_app.post("/core/_note")
    def note(body: _Body, user: dict = Depends(auth.current_user)):
        return {"uid": user["uid"]}

    return test_app


def test_every_request_prints_one_json_line_with_its_request_id(capsys):
    request_log.send_to_stdout()
    r = TestClient(app).get("/core/health?secret=x")
    (line,) = _printed_lines(capsys)  # the whole line parses as JSON, so there's no "INFO ..." prefix
    assert line["request_id"] == r.headers["X-Request-ID"]
    assert (line["method"], line["path"], line["status"]) == ("GET", "/core/health", 200)
    assert isinstance(line["duration_ms"], int)
    assert "secret" not in json.dumps(line)  # the query string is never logged


def test_an_error_answer_is_logged_under_the_id_in_its_body(capsys):
    request_log.send_to_stdout()
    r = TestClient(app).get("/core/nope")
    (line,) = _printed_lines(capsys)
    assert r.status_code == 404 and line["status"] == 404
    assert line["request_id"] == r.json()["error"]["request_id"] == r.headers["X-Request-ID"]


def test_a_crash_prints_the_error_class_only_under_the_request_id_the_client_gets(capsys):
    request_log.send_to_stdout()
    r = TestClient(_test_app(), raise_server_exceptions=False).get("/core/_crash")
    assert r.status_code == 500 and r.json()["error"]["code"] == "INTERNAL"
    (line,) = _printed_lines(capsys)
    assert line["request_id"] == r.headers["X-Request-ID"] == r.json()["error"]["request_id"]
    assert line["status"] == 500 and line["error"] == "RuntimeError"
    assert "boom" not in json.dumps(line) and "secret detail" not in json.dumps(line)  # no exception message


def test_no_token_body_or_query_string_is_ever_logged(capsys, monkeypatch):
    monkeypatch.setattr(auth.fb_auth, "verify_id_token", lambda token, check_revoked: {"uid": "uid-synthetic-41", "role": "borrower"})
    request_log.send_to_stdout()
    r = TestClient(_test_app()).post(
        "/core/_note?borrower=ben-synthetic", json={"note": "private-note-text"},
        headers={"Authorization": "Bearer token-synthetic-xyz"},
    )
    assert r.status_code == 200
    out = capsys.readouterr().out
    (line,) = [json.loads(text) for text in out.splitlines() if text.strip()]
    assert line["path"] == "/core/_note" and line["request_id"] == r.headers["X-Request-ID"]
    rest = out.replace(line["request_id"], "")  # a random id could contain a short value by chance
    for private in ["token-synthetic-xyz", "Bearer", "private-note-text", "ben-synthetic", "uid-synthetic-41"]:
        assert private not in rest


def test_the_start_up_sends_the_lines_to_stdout():
    log = logging.getLogger("al-core.requests")
    assert not log.handlers
    with TestClient(app):  # runs the lifespan
        assert len(log.handlers) == 1 and log.level == logging.INFO and log.propagate is False


def test_calling_send_to_stdout_twice_adds_one_handler():
    request_log.send_to_stdout()
    request_log.send_to_stdout()
    assert len(logging.getLogger("al-core.requests").handlers) == 1


def test_the_image_turns_off_uvicorn_s_own_access_line():
    # Otherwise each request is logged twice, once without its request id.
    cmd = [line for line in (Path(__file__).resolve().parent.parent / "Dockerfile").read_text().splitlines() if line.startswith("CMD")]
    assert len(cmd) == 1 and "--no-access-log" in json.loads(cmd[0].removeprefix("CMD").strip())
