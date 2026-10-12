"""Firebase ID token check and role check.

With FIREBASE_AUTH_EMULATOR_HOST set, the Admin SDK accepts emulator tokens. The role always
comes from the `role` claim on the token, never from a request body or a Firestore field.
"""

import os

import firebase_admin
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from firebase_admin import auth as fb_auth

if not firebase_admin._apps:
    firebase_admin.initialize_app(options={"projectId": os.getenv("FIREBASE_PROJECT_ID", "demo-al")})

_bearer = HTTPBearer(auto_error=False)


def current_user(creds: HTTPAuthorizationCredentials | None = Depends(_bearer)) -> dict:
    """Decoded token: `uid` and the `role` claim. Raises 401 if the token is missing, expired, revoked or invalid."""
    if creds is None:
        raise HTTPException(401, "The token is missing, expired or invalid")
    try:
        return fb_auth.verify_id_token(creds.credentials, check_revoked=True)
    except (ValueError, fb_auth.InvalidIdTokenError):  # expired and revoked are subclasses
        raise HTTPException(401, "The token is missing, expired or invalid")
    except fb_auth.CertificateFetchError:
        raise HTTPException(503, "Could not reach Firebase to check the token")


def require_role(*roles: str):
    """Dependency for endpoints limited to some roles. A signed-in caller with another role gets 403."""

    def check(user: dict = Depends(current_user)) -> dict:
        if user.get("role") not in roles:
            raise HTTPException(403, "Your role cannot do this")
        return user

    return check
