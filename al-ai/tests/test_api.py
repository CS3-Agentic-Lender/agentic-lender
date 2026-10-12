import pytest
from fastapi import Depends
from fastapi.testclient import TestClient
from firebase_admin import auth as fb_auth

from app import auth
from app.main import app

# Throwaway routes: the real protected endpoints arrive in later tickets.
app.add_api_route("/ai/_whoami", lambda user=Depends(auth.current_user): {"uid": user["uid"]})
app.add_api_route("/ai/_echo", lambda n: {"n": n})

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
