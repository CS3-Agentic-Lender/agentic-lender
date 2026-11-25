"""End-to-end check of closing a support request (AL-339) against the emulators.

Needs: the Auth and Firestore emulators running (firebase emulators:start --project demo-al) and al-core on port 5002
with FIREBASE_AUTH_EMULATOR_HOST and FIRESTORE_EMULATOR_HOST set. Run from al-core/:
    FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 uv run python scripts/smoke_support_close.py
Each run makes throwaway emulator accounts and a new request, so it is safe to repeat. It refuses to run without the emulators.
"""

import json
import os
import sys
import urllib.error
import urllib.request
import uuid

if not (os.getenv("FIREBASE_AUTH_EMULATOR_HOST") and os.getenv("FIRESTORE_EMULATOR_HOST")):
    sys.exit("Set FIREBASE_AUTH_EMULATOR_HOST and FIRESTORE_EMULATOR_HOST: this script only runs against the emulators.")

import firebase_admin  # noqa: E402
from firebase_admin import auth  # noqa: E402
from google.cloud import firestore  # noqa: E402

PROJECT = os.getenv("FIREBASE_PROJECT_ID", "demo-al")
AUTH = "http://" + os.environ["FIREBASE_AUTH_EMULATOR_HOST"]
CORE = os.getenv("CORE_URL", "http://127.0.0.1:5002")
os.environ["NO_PROXY"] = "127.0.0.1,localhost"
firebase_admin.initialize_app(options={"projectId": PROJECT})
db = firestore.Client(project=PROJECT)


def call(method, url, body=None, token=None):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.load(r)
    except urllib.error.HTTPError as e:
        return e.code, json.load(e)


def account(role):
    """A throwaway emulator account with this role claim, signed in. Returns (uid, ID token)."""
    email, password = f"smoke-{role}-{uuid.uuid4().hex[:8]}@example.ie", uuid.uuid4().hex
    uid = auth.create_user(email=email, password=password).uid
    auth.set_custom_user_claims(uid, {"role": role})
    url = f"{AUTH}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-api-key"
    status, body = call("POST", url, {"email": email, "password": password, "returnSecureToken": True})
    assert status == 200, body
    return uid, body["idToken"]


def check(label, ok, detail):
    print(f"{'PASS' if ok else 'FAIL'}  {label}  ->  {detail}")
    return ok


def logged(reference):
    return [d.to_dict() for d in db.collection("admin_actions").where("targetRef", "==", f"support_requests/{reference}").stream()]


borrower, borrower_token = account("borrower")
admin, admin_token = account("admin")
_, underwriter_token = account("underwriter")

results = []
s, sent = call("POST", f"{CORE}/core/support-requests", {"category": "other", "subject": "Smoke", "message": "Hi"}, borrower_token)
results.append(check("a borrower sends a request", s == 201 and sent["status"] == "open" and sent["closed_at"] is None, (s, sent)))
reference = sent["reference"]
url = f"{CORE}/core/admin/support-requests/{reference}/close"

for who, token in (("borrower", borrower_token), ("underwriter", underwriter_token)):
    s, b = call("POST", url, token=token)
    results.append(check(f"the {who} can't close it", s == 403, s))
s, b = call("POST", url)
results.append(check("no token is a 401", s == 401, s))

s, closed = call("POST", url, token=admin_token)
results.append(check("the admin closes it", s == 200 and closed["status"] == "closed" and closed["closed_by"] == admin, (s, closed)))
stored = db.collection("support_requests").document(reference).get().to_dict()
results.append(check("Firestore has status, closedAt and closedBy", stored["status"] == "closed"
                     and stored["closedAt"] is not None and stored["closedBy"] == admin, stored))
log = logged(reference)
results.append(check("one admin_actions record, with who, what, which and when", len(log) == 1 and log[0]["actorUid"] == admin
                     and log[0]["action"] == "close_support_request" and log[0]["createdAt"] is not None, log))

s, again = call("POST", url, token=admin_token)
results.append(check("closing it again is a 200 that changes nothing", s == 200 and again == closed, (s, again)))
results.append(check("and logs nothing more", len(logged(reference)) == 1, len(logged(reference))))

s, b = call("POST", f"{CORE}/core/admin/support-requests/SR-NOPE0000/close", token=admin_token)
results.append(check("an unknown reference is a 404", s == 404, (s, b)))

print(f"\n{sum(results)}/{len(results)} checks passed")
sys.exit(0 if all(results) else 1)
