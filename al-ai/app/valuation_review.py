"""Saves the valuation model's result for an application on its underwriter-only review document (AL-61).

The document is `applications/{id}/review/underwriting` (al-core/SCHEMA.md). Underwriters and the assigned broker read it,
the borrower never does, and only al-ai writes it (the Admin SDK skips the security rules; no client has a write rule).
The portal reads these stored values instead of calling /ai/valuation again on every render.
"""

from google.cloud.firestore import SERVER_TIMESTAMP

from app.valuation_endpoint import ValuationResponse

# Everything this function owns on the document. `merge=` takes these field paths as a mask: each one is replaced whole, and
# no other field on the document (riskTier, policyGate, dtiBreakdown) is touched.
OWNED_FIELDS = ["applicationId", "brokerId", "updatedAt", "valuationDetail"]


def valuation_detail(response: ValuationResponse) -> dict:
    """The `valuationDetail` map. Every key is always present, null when unknown, so a re-run can never leave an old value behind.

    A HELOC has no asking price, so its gap and flag are null. If only the breakdown failed, the baseline and the
    contributions are null together and the estimate is still stored.
    """
    return {
        "estimatedValueEur": response.estimate_eur,
        "displayEstimateEur": response.display_estimate_eur,
        "askingPriceGap": response.asking_price_gap,  # asking price / estimate - 1, signed
        "priceNeedsReview": response.price_needs_review,
        "supportWarnings": list(response.support_warnings),
        "modelVersion": response.model_version,
        "baselineEur": response.baseline_eur,
        "contributions": None if response.contributions is None else [piece.model_dump() for piece in response.contributions],
    }


def write_valuation(db, application_id: str, response: ValuationResponse) -> dict:
    """Save the model's result after a run or re-run, replacing whatever the last run saved. Returns the map that was written.

    `db` is a Firestore client. The committee flow calls this after the valuation step. The application itself is only read,
    for its broker (the asking price on it is the borrower's own input and is never written here).
    Raises ValueError if the application does not exist or has no brokerId.
    """
    application = db.collection("applications").document(application_id)
    snapshot = application.get()
    if not snapshot.exists:
        raise ValueError(f"Application {application_id} does not exist")
    broker_id = (snapshot.to_dict() or {}).get("brokerId")
    if not broker_id:
        raise ValueError(f"Application {application_id} has no brokerId")
    detail = valuation_detail(response)
    application.collection("review").document("underwriting").set(
        {"applicationId": application_id, "brokerId": broker_id, "updatedAt": SERVER_TIMESTAMP, "valuationDetail": detail},
        merge=OWNED_FIELDS,
    )
    return detail
