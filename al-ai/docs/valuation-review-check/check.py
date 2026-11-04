"""AL-61 against the real Firestore emulator: write twice, read back, check the second write replaced the first.

Why: a fake database cannot show that the field mask in write_valuation replaces the whole map. Start the emulator on a free
port (8081 here; 8080 is taken on the author's Mac) with an empty config, then, from al-ai:

    PYTHONPATH=. FIRESTORE_EMULATOR_HOST=localhost:8081 GOOGLE_CLOUD_PROJECT=demo-al uv run python docs/valuation-review-check/check.py

The output of the run that went with the PR is in output.txt.
"""
import json
from fastapi.testclient import TestClient
from google.cloud import firestore

from app import auth, valuation_explain, valuation_review
from app.main import app
from app.valuation_endpoint import ValuationResponse

auth.fb_auth.verify_id_token = lambda token, check_revoked: {"uid": "u1", "role": "borrower"}
client = TestClient(app)
HOME = dict(county="Dublin", property_type="Semi-D", bedrooms=3, floor_area_m2=118, ber="C1", eircode="D24 AB12")


def response(**extra):
    got = client.post("/ai/valuation", json={**HOME, **extra}, headers={"Authorization": "Bearer ok"})
    return ValuationResponse(**got.json())


db = firestore.Client(project="demo-al")
app_ref = db.collection("applications").document("al61-check")
app_ref.set({"brokerId": "broker-1", "property": {"askingPriceEur": 450000}})
review = app_ref.collection("review").document("underwriting")
review.set({"riskTier": "B", "policyGate": {"effective": "Approve"}, "dtiBreakdown": {"dtiBand": "Comfortable"}})  # written earlier by other steps


def show(label):
    data = review.get().to_dict()
    detail = data["valuationDetail"]
    print(f"--- {label}")
    print("other fields kept:", {k: data[k] for k in ("riskTier", "policyGate", "dtiBreakdown")})
    print("ids:", data["applicationId"], data["brokerId"], "updatedAt set:", data["updatedAt"] is not None)
    print("keys:", sorted(detail))
    print("estimate:", detail["estimatedValueEur"], "display:", detail["displayEstimateEur"], "gap:", detail["askingPriceGap"],
          "needsReview:", detail["priceNeedsReview"], "model:", detail["modelVersion"], "warnings:", detail["supportWarnings"])
    print("baseline:", detail["baselineEur"], "contributions:", None if detail["contributions"] is None else [c["feature"] for c in detail["contributions"]])


valuation_review.write_valuation(db, "al61-check", response(asking_price_eur=450000))
show("run 1: mortgage, full breakdown")

# Run 2 replaces it: a HELOC (no asking price) whose breakdown fails. Old contributions, gap and flag must not survive.
valuation_explain.explain_value = lambda *a, **k: (_ for _ in ()).throw(RuntimeError("explain failed"))
valuation_review.write_valuation(db, "al61-check", response(loan_type="heloc", existing_mortgage_balance_eur=150000, loan_amount_eur=40000))
show("run 2: HELOC, breakdown failed")
detail = review.get().to_dict()["valuationDetail"]
assert detail["contributions"] is None and detail["baselineEur"] is None, "stale breakdown survived"
assert detail["askingPriceGap"] is None and detail["priceNeedsReview"] is None, "stale gap or flag survived"
assert review.get().to_dict()["riskTier"] == "B", "another field was touched"
assert app_ref.get().to_dict() == {"brokerId": "broker-1", "property": {"askingPriceEur": 450000}}, "the application was written to"
print("\nALL CHECKS PASSED: run 2 replaced run 1 whole, other review fields and the application were untouched")
