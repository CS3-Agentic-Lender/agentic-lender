"""Firebase ID token check. With FIREBASE_AUTH_EMULATOR_HOST set, the Admin SDK accepts emulator tokens."""

import os

import firebase_admin
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from firebase_admin import auth as fb_auth

firebase_admin.initialize_app(options={"projectId": os.getenv("FIREBASE_PROJECT_ID", "demo-al")})

_bearer = HTTPBearer(auto_error=False)


def current_user(creds: HTTPAuthorizationCredentials | None = Depends(_bearer)) -> dict:
    """Decoded token: `uid` and the `role` claim. Raises 401 if the token is missing, expired, revoked, invalid, or for a disabled or deleted user."""
    if creds is None:
        raise HTTPException(401, "The token is missing, expired or invalid")
    try:
        return fb_auth.verify_id_token(creds.credentials, check_revoked=True)
    # expired and revoked are subclasses of InvalidIdTokenError; a disabled or deleted account is not
    except (ValueError, fb_auth.InvalidIdTokenError, fb_auth.UserDisabledError, fb_auth.UserNotFoundError):
        raise HTTPException(401, "The token is missing, expired or invalid")
    except fb_auth.CertificateFetchError:
        raise HTTPException(503, "Could not reach Firebase to check the token")
