import pytest
from fastapi import Depends
from fastapi.testclient import TestClient
from firebase_admin import auth as fb_auth

from app import auth
from app.main import app

# Throwaway routes: the real protected endpoints arrive in later tickets.
app.add_api_route("/core/_whoami", lambda user=Depends(auth.current_user): {"uid": user["uid"]})
app.add_api_route("/core/_brokers_only", lambda user=Depends(auth.require_role("broker")): {"uid": user["uid"]})
app.add_api_route("/core/_echo", lambda n: {"n": n})

client = TestClient(app)
SHAPE = {"code", "message", "field", "request_id"}


def accept_as(monkeypatch, claims):
    monkeypatch.setattr(auth.fb_auth, "verify_id_token", lambda token, check_revoked: claims)


def test_health_is_open():
    r = client.get("/core/health")
    assert r.status_code == 200 and r.json() == {"status": "ok"}
    assert r.headers["X-Request-ID"]


def test_unknown_route_is_404_in_the_shared_shape():
    r = client.get("/core/nope")
    assert r.status_code == 404 and r.json()["error"]["code"] == "NOT_FOUND"


def test_missing_token_is_401_in_the_shared_shape():
    r = client.get("/core/_whoami")
    assert r.status_code == 401
    assert set(r.json()["error"]) == SHAPE
    assert r.json()["error"]["code"] == "UNAUTHENTICATED"
    assert r.json()["error"]["request_id"] == r.headers["X-Request-ID"]


def test_bad_token_is_401(monkeypatch):
    def reject(token, check_revoked):
        raise fb_auth.InvalidIdTokenError("bad")

    monkeypatch.setattr(auth.fb_auth, "verify_id_token", reject)
    r = client.get("/core/_whoami", headers={"Authorization": "Bearer nope"})
    assert r.status_code == 401 and r.json()["error"]["code"] == "UNAUTHENTICATED"


@pytest.mark.parametrize(
    "error",
    [fb_auth.UserDisabledError("disabled"), fb_auth.UserNotFoundError("deleted")],
    ids=["disabled user", "deleted user"],
)
def test_disabled_or_deleted_user_is_401_not_500(monkeypatch, error):
    def reject(token, check_revoked):
        raise error

    monkeypatch.setattr(auth.fb_auth, "verify_id_token", reject)
    r = client.get("/core/_whoami", headers={"Authorization": "Bearer old"})
    assert r.status_code == 401 and r.json()["error"]["code"] == "UNAUTHENTICATED"


def test_good_token_passes_and_revocation_is_checked(monkeypatch):
    calls = []

    def accept(token, check_revoked):
        calls.append(check_revoked)
        return {"uid": "u1", "role": "borrower"}

    monkeypatch.setattr(auth.fb_auth, "verify_id_token", accept)
    r = client.get("/core/_whoami", headers={"Authorization": "Bearer ok"})
    assert r.status_code == 200 and r.json() == {"uid": "u1"} and calls == [True]


def test_right_role_passes_the_role_check(monkeypatch):
    accept_as(monkeypatch, {"uid": "b1", "role": "broker"})
    r = client.get("/core/_brokers_only", headers={"Authorization": "Bearer ok"})
    assert r.status_code == 200 and r.json() == {"uid": "b1"}


def test_wrong_role_is_403_in_the_shared_shape(monkeypatch):
    accept_as(monkeypatch, {"uid": "u1", "role": "borrower"})
    r = client.get("/core/_brokers_only", headers={"Authorization": "Bearer ok"})
    assert r.status_code == 403 and r.json()["error"]["code"] == "FORBIDDEN"


def test_no_role_claim_is_403(monkeypatch):
    accept_as(monkeypatch, {"uid": "new"})
    r = client.get("/core/_brokers_only", headers={"Authorization": "Bearer ok"})
    assert r.status_code == 403


def test_invalid_field_is_422_and_names_the_field():
    r = client.get("/core/_echo")
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "INVALID_FIELD" and r.json()["error"]["field"] == "n"
