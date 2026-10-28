"""Only the portal's origin may call al-ai from a browser. The allowed origins come from a setting, not from code."""

import pytest
from fastapi.testclient import TestClient

from app import cors
from app.main import app

client = TestClient(app)
PORTAL = "http://localhost:5173"
OTHER = "https://evil.example"


def preflight(origin, path="/ai/valuation", method="POST", headers="authorization,content-type"):
    return client.options(path, headers={"Origin": origin, "Access-Control-Request-Method": method, "Access-Control-Request-Headers": headers})


# ---- the browser preflight --------------------------------------------------------------------------

def test_a_preflight_from_the_portal_with_an_authorization_header_succeeds():
    r = preflight(PORTAL)
    assert r.status_code == 200
    assert r.headers["access-control-allow-origin"] == PORTAL
    assert "authorization" in r.headers["access-control-allow-headers"].lower()
    assert "POST" in r.headers["access-control-allow-methods"]


def test_a_preflight_from_any_other_origin_gets_no_cors_headers():
    r = preflight(OTHER)
    assert "access-control-allow-origin" not in r.headers
    assert r.status_code != 200


def test_a_preflight_from_the_portal_on_another_port_is_refused():
    assert "access-control-allow-origin" not in preflight("http://localhost:5174").headers


# ---- real requests -------------------------------------------------------------------------------------

def test_a_request_from_the_portal_gets_the_origin_back():
    assert client.get("/ai/health", headers={"Origin": PORTAL}).headers["access-control-allow-origin"] == PORTAL


def test_a_request_from_any_other_origin_gets_no_cors_headers_so_the_browser_blocks_it():
    r = client.get("/ai/health", headers={"Origin": OTHER})
    assert r.status_code == 200 and "access-control-allow-origin" not in r.headers


def test_an_error_answer_to_the_portal_still_carries_the_header_so_it_can_read_the_error():
    r = client.post("/ai/valuation", json={}, headers={"Origin": PORTAL})
    assert r.status_code in (401, 403) and r.headers["access-control-allow-origin"] == PORTAL


def test_cookies_are_not_allowed_across_origins_because_tokens_use_a_header():
    assert "access-control-allow-credentials" not in preflight(PORTAL).headers


# ---- the setting ---------------------------------------------------------------------------------------

def test_with_no_setting_only_the_local_portal_is_allowed():
    assert cors.allowed_origins({}) == [PORTAL]


def test_the_setting_adds_the_deployed_origin_without_a_code_change():
    env = {"CORS_ALLOWED_ORIGINS": "http://localhost:5173, https://portal.example.ie"}
    assert cors.allowed_origins(env) == [PORTAL, "https://portal.example.ie"]


def test_a_blank_setting_falls_back_to_the_local_portal():
    assert cors.allowed_origins({"CORS_ALLOWED_ORIGINS": "  "}) == [PORTAL]


@pytest.mark.parametrize("bad", ["*", "http://localhost:5173,*", "portal.example.ie", "https://a.ie/path", "null"])
def test_a_wildcard_or_something_that_is_not_an_origin_is_refused(bad):
    with pytest.raises(ValueError):
        cors.allowed_origins({"CORS_ALLOWED_ORIGINS": bad})
