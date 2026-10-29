"""Only the portal's origin may call al-core from a browser. The allowed origins come from a setting, not from code (AL-233)."""

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app import cors, errors
from app.main import app

client = TestClient(app)
PORTAL = "http://localhost:5173"
OTHER = "https://evil.example"


def preflight(origin, path="/core/applications", method="POST", headers="authorization,content-type", test_client=client):
    return test_client.options(
        path, headers={"Origin": origin, "Access-Control-Request-Method": method, "Access-Control-Request-Headers": headers}
    )


# ---- the browser preflight (acceptance criterion 2) ---------------------------------------------------------


def test_a_preflight_from_the_portal_with_an_authorization_header_succeeds():
    r = preflight(PORTAL)
    assert r.status_code == 200
    assert r.headers["access-control-allow-origin"] == PORTAL
    assert "authorization" in r.headers["access-control-allow-headers"].lower()
    assert "POST" in r.headers["access-control-allow-methods"]


@pytest.mark.parametrize("method", ["GET", "POST", "PATCH", "PUT", "DELETE"])
def test_every_method_the_apps_use_is_allowed_for_the_portal(method):
    r = preflight(PORTAL, method=method)
    assert r.status_code == 200 and method in r.headers["access-control-allow-methods"]


@pytest.mark.parametrize("path", ["/core/me", "/core/me/broker", "/core/applications/abc/submit", "/core/saved-checks"])
def test_the_preflight_works_for_every_route_not_just_one(path):
    assert preflight(PORTAL, path=path).status_code == 200


# ---- any other origin gets nothing (acceptance criterion 3) -----------------------------------------------


def test_a_preflight_from_any_other_origin_gets_no_allow_origin_header():
    r = preflight(OTHER)
    assert "access-control-allow-origin" not in r.headers
    assert r.status_code != 200


def test_a_preflight_from_the_portal_on_another_port_is_refused():
    assert "access-control-allow-origin" not in preflight("http://localhost:5174").headers


def test_the_portal_over_https_is_a_different_origin_and_is_refused():
    assert "access-control-allow-origin" not in preflight("https://localhost:5173").headers


def test_a_request_from_any_other_origin_gets_no_allow_origin_so_the_browser_blocks_it():
    r = client.get("/core/health", headers={"Origin": OTHER})
    assert r.status_code == 200 and "access-control-allow-origin" not in r.headers


# ---- real requests ---------------------------------------------------------------------------------------


def test_a_request_from_the_portal_gets_the_origin_back():
    assert client.get("/core/health", headers={"Origin": PORTAL}).headers["access-control-allow-origin"] == PORTAL


def test_an_error_answer_to_the_portal_still_carries_the_header_so_it_can_read_the_error():
    r = client.post("/core/applications", json={}, headers={"Origin": PORTAL})
    assert r.status_code == 401 and r.headers["access-control-allow-origin"] == PORTAL
    assert r.json()["error"]["code"] == "UNAUTHENTICATED"  # the shared error shape is untouched


def test_a_request_with_no_origin_is_unaffected_like_the_ios_app_and_the_other_service():
    r = client.get("/core/health")
    assert r.status_code == 200 and r.json() == {"status": "ok"} and "access-control-allow-origin" not in r.headers
    assert client.post("/core/applications", json={}).status_code == 401


def test_cookies_are_not_allowed_across_origins_because_tokens_use_a_header():
    assert "access-control-allow-credentials" not in preflight(PORTAL).headers


def test_the_request_id_header_is_still_on_an_answer_to_the_portal():
    assert client.get("/core/health", headers={"Origin": PORTAL}).headers["X-Request-ID"]


# ---- the setting (acceptance criterion 1) ----------------------------------------------------------------


def test_with_no_setting_only_the_local_portal_is_allowed():
    assert cors.allowed_origins({}) == [PORTAL]


def test_the_setting_adds_the_deployed_origin_without_a_code_change():
    env = {"CORS_ALLOWED_ORIGINS": "http://localhost:5173, https://portal.example.ie/"}
    assert cors.allowed_origins(env) == [PORTAL, "https://portal.example.ie"]


def test_the_setting_is_really_read_from_the_environment(monkeypatch):
    monkeypatch.setenv("CORS_ALLOWED_ORIGINS", "https://portal.example.ie")
    assert cors.allowed_origins() == ["https://portal.example.ie"]


def test_an_app_built_with_the_setting_allows_that_origin_and_not_the_local_one():
    built = FastAPI()
    cors.install(built, {"CORS_ALLOWED_ORIGINS": "https://portal.example.ie"})

    @built.get("/ping")
    def ping():
        return {"ok": True}

    other = TestClient(built)
    assert other.get("/ping", headers={"Origin": "https://portal.example.ie"}).headers["access-control-allow-origin"] == "https://portal.example.ie"
    assert "access-control-allow-origin" not in other.get("/ping", headers={"Origin": PORTAL}).headers
    assert preflight("https://portal.example.ie", test_client=other, path="/ping").status_code == 200


def test_a_blank_setting_falls_back_to_the_local_portal():
    assert cors.allowed_origins({"CORS_ALLOWED_ORIGINS": "  "}) == [PORTAL]


@pytest.mark.parametrize("bad", ["*", "http://localhost:5173,*", "portal.example.ie", "https://a.ie/path", "https://a.ie?x=1", "null"])
def test_a_wildcard_or_something_that_is_not_an_origin_is_refused(bad):
    with pytest.raises(ValueError):
        cors.allowed_origins({"CORS_ALLOWED_ORIGINS": bad})


def test_an_unhandled_500_carries_no_allow_origin_header_which_the_readme_warns_about():
    """The server builds a 500 outside the CORS middleware, so the browser reports CORS instead of the 500."""
    boom = FastAPI()
    errors.install(boom)
    cors.install(boom)

    @boom.get("/boom")
    def explode():
        raise RuntimeError("unhandled")

    r = TestClient(boom, raise_server_exceptions=False).get("/boom", headers={"Origin": PORTAL})
    assert r.status_code == 500 and "access-control-allow-origin" not in r.headers
