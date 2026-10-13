"""End-to-end check of /core/me against the emulators. Evidence for the ticket and for the iOS sign-up.

Needs: the emulators running (firebase emulators:start --project demo-al) and al-core on port 5002.
Run from al-core/:  uv run python scripts/smoke_me.py
Each run signs up a new throwaway emulator user, so it is safe to repeat.
"""

import json
import os
import urllib.error
import urllib.request
import uuid

AUTH = "http://" + os.getenv("FIREBASE_AUTH_EMULATOR_HOST", "127.0.0.1:9099")
CORE = os.getenv("CORE_URL", "http://127.0.0.1:5002")
os.environ["NO_PROXY"] = "127.0.0.1,localhost"


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


def emulator_token(path, email, password):
    url = f"{AUTH}/identitytoolkit.googleapis.com/v1/accounts:{path}?key=fake-api-key"
    status, body = call("POST", url, {"email": email, "password": password, "returnSecureToken": True})
    assert status == 200, body
    return body["idToken"]


def check(label, ok, detail):
    print(f"{'PASS' if ok else 'FAIL'}  {label}  ->  {detail}")
    return ok


email = f"smoke-{uuid.uuid4().hex[:8]}@example.ie"
password = uuid.uuid4().hex  # throwaway emulator account
token = emulator_token("signUp", email, password)

profile = {
    "full_name": "Smoke Test",
    "email": email.upper(),
    "phone": "+353 87 123 4567",
    "address_line_1": "1 Test Street",
    "county": "Cork",
    "eircode": "T12 X5R2",
    "role": "underwriter",
}

results = []
s, b = call("GET", f"{CORE}/core/me", token=token)
results.append(check("GET before sign-up is 404", s == 404, s))

s, first = call("POST", f"{CORE}/core/me", profile, token)
results.append(check("first POST is 201", s == 201, s))
results.append(check("role is borrower, not the body's role", first.get("role") == "borrower", first.get("role")))
results.append(check("email stored in lower case", first.get("email") == email, first.get("email")))

s, again = call("POST", f"{CORE}/core/me", profile, token)
results.append(check("repeat POST is 200 with the same profile", s == 200 and again == first, s))

token = emulator_token("signInWithPassword", email, password)  # the app does getIdToken(true) here
s, me = call("GET", f"{CORE}/core/me", token=token)
results.append(check("GET after sign-up is 200 with the profile", s == 200 and me == first, s))

s, err = call("POST", f"{CORE}/core/me", {**profile, "eircode": "t12x5r2"}, token)
results.append(check("bad eircode is 422 naming the field", s == 422 and err["error"]["field"] == "eircode", s))

s, err = call("POST", f"{CORE}/core/me", {**profile, "email": "someone.else@example.ie"}, token)
results.append(check("email not matching the sign-in is 422 naming email", s == 422 and err["error"]["field"] == "email", s))

s, err = call("GET", f"{CORE}/core/me")
results.append(check("no token is 401", s == 401, s))

print()
print(json.dumps(first, indent=2))
print(f"\n{sum(results)}/{len(results)} checks passed")
raise SystemExit(0 if all(results) else 1)
