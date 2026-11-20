import json

import pytest
from fastapi import Depends
from fastapi.testclient import TestClient
from firebase_admin import auth as fb_auth

from app import auth, request_log
from app.main import app

# Throwaway routes: the real protected endpoints arrive in later tickets.
app.add_api_route("/ai/_whoami", lambda user=Depends(auth.current_user): {"uid": user["uid"]})
app.add_api_route("/ai/_echo", lambda n: {"n": n})


def _crash():
    raise RuntimeError("boom")


app.add_api_route("/ai/_crash", _crash)

client = TestClient(app)
SHAPE = {"code", "message", "field", "request_id"}


def test_health_is_open():
    r = client.get("/ai/health")
    assert r.status_code == 200 and r.json() == {"status": "ok"}


def test_unknown_route_is_404_in_the_shared_shape():
    r = client.get("/ai/nope")
    assert r.status_code == 404 and r.json()["error"]["code"] == "NOT_FOUND"


def test_missing_token_is_401_in_the_shared_shape():
    r = client.get("/ai/_whoami")
    assert r.status_code == 401
    assert set(r.json()["error"]) == SHAPE
    assert r.json()["error"]["code"] == "UNAUTHENTICATED"
    assert r.json()["error"]["request_id"] == r.headers["X-Request-ID"]


def test_bad_token_is_401(monkeypatch):
    def reject(token, check_revoked):
        raise fb_auth.InvalidIdTokenError("bad")

    monkeypatch.setattr(auth.fb_auth, "verify_id_token", reject)
    r = client.get("/ai/_whoami", headers={"Authorization": "Bearer nope"})
    assert r.status_code == 401 and r.json()["error"]["code"] == "UNAUTHENTICATED"


@pytest.mark.parametrize("error", [fb_auth.UserDisabledError("disabled"), fb_auth.UserNotFoundError("deleted")])
def test_disabled_or_deleted_user_is_401_not_500(monkeypatch, error):
    def reject(token, check_revoked):
        raise error

    monkeypatch.setattr(auth.fb_auth, "verify_id_token", reject)
    r = client.get("/ai/_whoami", headers={"Authorization": "Bearer ok"})
    assert r.status_code == 401
    assert set(r.json()["error"]) == SHAPE and r.json()["error"]["code"] == "UNAUTHENTICATED"


def test_good_token_passes_and_revocation_is_checked(monkeypatch):
    calls = []

    def accept(token, check_revoked):
        calls.append(check_revoked)
        return {"uid": "u1", "role": "borrower"}

    monkeypatch.setattr(auth.fb_auth, "verify_id_token", accept)
    r = client.get("/ai/_whoami", headers={"Authorization": "Bearer ok"})
    assert r.status_code == 200 and r.json() == {"uid": "u1"} and calls == [True]


def test_invalid_field_is_422_and_names_the_field():
    r = client.get("/ai/_echo")
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "INVALID_FIELD" and r.json()["error"]["field"] == "n"


def _printed_lines(capsys):
    return [json.loads(line) for line in capsys.readouterr().out.splitlines() if line.strip()]


def test_every_request_prints_one_json_line_with_its_request_id(capsys):
    request_log.send_to_stdout()  # what the start-up does; here capsys is already catching stdout
    r = client.get("/ai/health?secret=x")
    (line,) = _printed_lines(capsys)  # the whole line parses as JSON, so there's no "INFO ..." prefix
    assert line["request_id"] == r.headers["X-Request-ID"]
    assert (line["method"], line["path"], line["status"]) == ("GET", "/ai/health", 200)
    assert "secret" not in json.dumps(line)  # the query string is never logged


def test_a_crash_prints_the_error_class_only_under_the_request_id_the_client_gets(capsys):
    request_log.send_to_stdout()
    r = TestClient(app, raise_server_exceptions=False).get("/ai/_crash")
    assert r.status_code == 500 and r.json()["error"]["code"] == "INTERNAL"
    (line,) = _printed_lines(capsys)
    assert line["request_id"] == r.headers["X-Request-ID"] == r.json()["error"]["request_id"]
    assert line["status"] == 500 and line["error"] == "RuntimeError"
    assert "boom" not in json.dumps(line)  # no exception message


def test_only_the_request_line_is_printed_never_a_valuation_s_user_or_figures(capsys, monkeypatch):
    monkeypatch.setattr(auth.fb_auth, "verify_id_token", lambda token, check_revoked: {"uid": "uid-synthetic-77", "role": "borrower"})
    request_log.send_to_stdout()
    payload = {"county": "Dublin", "floor_area_m2": 123, "bedrooms": 4, "property_type": "Terrace", "ber": "C1",
               "eircode": "D14 AB12", "run_id": "run-synthetic-88"}
    r = client.post("/ai/valuation", json=payload, headers={"Authorization": "Bearer ok"})
    assert r.status_code == 200
    out = capsys.readouterr().out
    (line,) = [json.loads(text) for text in out.splitlines() if text.strip()]
    assert line["path"] == "/ai/valuation" and line["request_id"] == r.headers["X-Request-ID"]
    rest = out.replace(line["request_id"], "")  # a random id could contain "123" by chance
    for private in ["uid-synthetic-77", "run-synthetic-88", "123", "AB12", str(round(r.json()["estimate_eur"]))]:
        assert private not in rest
