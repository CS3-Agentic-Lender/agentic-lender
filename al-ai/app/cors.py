"""Which browser origins may call al-ai: only the portal's. API design doc, section 5.

The list comes from CORS_ALLOWED_ORIGINS (comma separated) so the deployed portal's origin is a setting for Sprint 3 and
not a code change. With no setting only the local portal is allowed. A wildcard is refused: it would let any site call us
from a signed-in browser.
"""

import os
from urllib.parse import urlsplit

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

SETTING = "CORS_ALLOWED_ORIGINS"
LOCAL_PORTAL = "http://localhost:5173"


def allowed_origins(env: dict | None = None) -> list[str]:
    raw = (os.environ if env is None else env).get(SETTING, "").strip()
    if not raw:
        return [LOCAL_PORTAL]
    origins = [item.strip() for item in raw.split(",") if item.strip()]
    for origin in origins:
        parts = urlsplit(origin)
        if parts.scheme not in ("http", "https") or not parts.netloc or parts.path not in ("", "/") or parts.query or parts.fragment:
            raise ValueError(f"{SETTING} must hold origins like https://portal.example.ie, not {origin!r}")
    return [o.rstrip("/") for o in origins]


def install(app: FastAPI, env: dict | None = None) -> None:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=allowed_origins(env),
        allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type"],
        allow_credentials=False,  # tokens use a header, so the API never needs cookies
    )
