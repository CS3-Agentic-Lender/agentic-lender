"""End-to-end check of POST /core/applications/{id}/close against the emulators and a local chain. Evidence for the ticket.

Needs, all running (see README, "The loan note and the mint"):
  - a local Hardhat node with the contracts deployed (cd chain && npx hardhat node, then npm run deploy:local)
  - the emulators with the seed (firebase emulators:start --project demo-al --import=./seed-data)
  - al-core on port 5002, started with the chain settings (CHAIN_MINTER_PRIVATE_KEY, CHAIN_REGISTRAR_PRIVATE_KEY, BORROWER_REF_SALT)
Run from al-core/:  uv run python scripts/smoke_close.py

It mints the seeded app-approved, closes it, and closes the seeded Declined app-declined. Those changes stay in the emulator and
on the node, so to run it again re-import seed-data/ (restart the emulators) and redeploy (restart the node and npm run deploy:local).
"""

import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

os.environ.setdefault("FIRESTORE_EMULATOR_HOST", "127.0.0.1:8080")
os.environ["NO_PROXY"] = "127.0.0.1,localhost"
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from google.cloud import firestore  # noqa: E402
from web3 import Web3  # noqa: E402

from app.loan_notes import ABI, STATUS_CLOSED  # noqa: E402

AUTH = "http://" + os.getenv("FIREBASE_AUTH_EMULATOR_HOST", "127.0.0.1:9099")
CORE = os.getenv("CORE_URL", "http://127.0.0.1:5002")
RPC = os.getenv("CHAIN_RPC_URL", "http://127.0.0.1:8545")
PASSWORD = "password123"  # betterleaks:allow — fake password of the seeded emulator users, local emulator only, never real auth


def call(method, path, token=None):
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    req = urllib.request.Request(CORE + path, data=b"" if method == "POST" else None, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.load(r)
    except urllib.error.HTTPError as e:
        return e.code, json.load(e)


def sign_in(email):
    url = f"{AUTH}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-api-key"
    body = json.dumps({"email": email, "password": PASSWORD, "returnSecureToken": True}).encode()
    with urllib.request.urlopen(urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"})) as r:
        return json.load(r)["idToken"]


def check(label, ok, detail):
    print(f"{'PASS' if ok else 'FAIL'}  {label}  ->  {detail}")
    return ok


w3 = Web3(Web3.HTTPProvider(RPC))
db = firestore.Client(project="demo-al")
underwriter, borrower, broker = sign_in("uma@test.com"), sign_in("alice@test.com"), sign_in("bob@test.com")
results = []

start = db.collection("applications").document("app-approved").get().to_dict()["status"]
if start != "Underwriter Approved":
    print(f"app-approved is {start}, not Underwriter Approved: re-import seed-data/ and redeploy the contracts, then run this again")
    raise SystemExit(2)

s, minted = call("POST", "/core/applications/app-approved/mint", underwriter)
results.append(check("mint the seeded Underwriter Approved application", s == 201 and minted["status"] == "Funded", s))
token_id, contract = int(minted["loan_note"]["token_id"]), minted["loan_note"]["contract_address"]
results.append(check("a fresh note has no close time or transaction", minted["loan_note"]["closed_at"] is None and minted["loan_note"]["close_tx_hash"] is None, "null, null"))

s, _ = call("POST", "/core/applications/app-approved/close", borrower)
results.append(check("a borrower cannot close", s == 403, s))
s, _ = call("POST", "/core/applications/app-approved/close", broker)
results.append(check("a broker cannot close", s == 403, s))
s, _ = call("POST", "/core/applications/app-approved/close")
results.append(check("no token is 401", s == 401, s))
s, err = call("POST", "/core/applications/app-applied/close", underwriter)
results.append(check("an Applied application is 409", s == 409, err["error"]["message"] if s == 409 else s))

before = w3.eth.block_number
s, closed = call("POST", "/core/applications/app-approved/close", underwriter)
mined = w3.eth.block_number - before
note = closed.get("loan_note") or {}
results.append(check("close the Funded application", s == 200 and closed.get("status") == "Closed", s))
results.append(check("the response carries when and how", bool(note.get("closed_at")) and str(note.get("close_tx_hash", "")).startswith("0x"), f"{note.get('closed_at')} {note.get('close_tx_hash')}"))
results.append(check("the close sent exactly one transaction", mined == 1, f"{mined} block mined"))

before = w3.eth.block_number
s, again = call("POST", "/core/applications/app-approved/close", underwriter)
results.append(check("closing again is 200 with the same body", s == 200 and again == closed, s))
results.append(check("closing again sent nothing", w3.eth.block_number == before, f"{w3.eth.block_number - before} blocks mined"))

stored = db.collection("applications").document("app-approved").get().to_dict()
entry = stored["statusHistory"][-1]
results.append(check("Firestore: status Closed, close transaction saved next to the mint's", stored["status"] == "Closed" and stored["loanNote"]["closeTxHash"] == note.get("close_tx_hash") and stored["loanNote"]["txHash"] == minted["loan_note"]["tx_hash"], stored["status"]))
results.append(check("Firestore: the move is logged once, by the underwriter", (entry["from"], entry["to"], entry["actor"]) == ("Funded", "Closed", "underwriter") and sum(h["to"] == "Closed" for h in stored["statusHistory"]) == 1, (entry["from"], entry["to"], entry["actor"])))

on_chain = w3.eth.contract(address=contract, abi=ABI).functions.noteOf(token_id).call()
results.append(check("the chain says the note is Closed", on_chain[6] == STATUS_CLOSED, f"status {on_chain[6]}"))
results.append(check("the chain's close time is the one saved in Firestore", on_chain[8] == int(stored["loanNote"]["closedAt"].timestamp()), on_chain[8]))

s, declined = call("POST", "/core/applications/app-declined/close", underwriter)
stored = db.collection("applications").document("app-declined").get().to_dict()
results.append(check("close the Declined application: no note, no chain", s == 200 and declined["status"] == "Closed" and declined["loan_note"] is None and "loanNote" not in stored, s))

print(f"\n{sum(results)}/{len(results)} checks passed")
raise SystemExit(0 if all(results) else 1)
