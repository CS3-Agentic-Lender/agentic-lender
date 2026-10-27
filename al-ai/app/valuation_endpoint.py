"""POST /ai/valuation: the saved model's estimate of a home's asking price, with its warnings. The model itself lives in app.valuation_model."""

import json
import logging
import re
import time
from typing import Annotated, Literal

from fastapi import APIRouter, Body, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field

from app import auth, valuation_model
from app.affordability_endpoint import BER_VALUES, _one_of
from ml import data_readiness as dr

router = APIRouter(prefix="/ai")
log = logging.getLogger("al-ai.valuation")

SCHEMA_VERSION = "1"
MODEL_VERSION = "v2"
BASIS = "2024 asking-price estimate"
# The floor areas the model was trained on. Outside them it still answers, with a warning.
TRAINED_AREA_M2 = (15, 1000)
# The same rule as al-core and the iOS form: capitals, one space, e.g. "A65 F4E2".
EIRCODE = re.compile(r"^[A-Z][0-9][0-9W] [A-Z0-9]{4}$")
VALUATION_BER_VALUES = {*BER_VALUES, "A0"}  # A0 is on the new scale; the model has no band for it


class ValuationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    county: Annotated[str, _one_of(dr.REPUBLIC_COUNTIES, "county")]
    property_type: Annotated[str, _one_of(dr.SUPPORTED_TYPES, "property_type")]
    bedrooms: int = Field(ge=0, le=30)
    floor_area_m2: float = Field(gt=0, le=100_000, allow_inf_nan=False)
    ber: Annotated[str, _one_of(VALUATION_BER_VALUES, "ber")]
    eircode: str = Field(pattern=EIRCODE.pattern)  # the full Eircode; the routing key is worked out here, never sent on its own
    asking_price_eur: float | None = Field(default=None, gt=0, le=1_000_000_000, allow_inf_nan=False)
    run_id: str | None = Field(default=None, max_length=100)  # set when the call is part of a committee run


class ValuationResponse(BaseModel):
    estimate_eur: float
    display_estimate_eur: int  # nearest EUR 1,000
    basis: Literal["2024 asking-price estimate"]
    support_warnings: list[str]
    model_version: str
    schema_version: str
    price_gap: float | None  # asking price / estimate - 1; null when no asking price was sent
    price_needs_review: bool | None


def _warnings(request: ValuationRequest, routing_key: str) -> list[str]:
    found = []
    if routing_key not in valuation_model.routing_keys():
        found.append(f"The model has not seen Eircode area {routing_key}, so this home is valued as if the Eircode were Other.")
    if request.ber == "A0":
        found.append("BER A0 is not a grade the model was trained on, so it is valued as an unknown rating.")
    low, high = TRAINED_AREA_M2
    if not low <= request.floor_area_m2 <= high:
        found.append(f"A floor area outside {low} to {high} m2 is outside what the model was trained on, so the estimate is less reliable.")
    return found


@router.post("/valuation")
def value_home(
    request: Annotated[ValuationRequest, Body()], http: Request, user: dict = Depends(auth.current_user)
) -> ValuationResponse:
    routing_key = request.eircode[:3]
    # The full Eircode is close to a home address, so the log keeps only the routing key (a broad area).
    inputs = request.model_dump(exclude={"run_id", "eircode"}) | {"routing_key": routing_key}
    entry = {
        "call": "valuation_model", "request_id": http.state.request_id, "run_id": request.run_id, "uid": user.get("uid"),
        "inputs": inputs, "model_version": MODEL_VERSION, "outcome": None, "estimate_eur": None,
    }
    started = time.monotonic()
    try:
        # A0 has no band, so ber_band turns it into Unknown inside estimate_value; the warning above says so.
        estimate = valuation_model.estimate_value(
            request.county, request.property_type, request.bedrooms, request.floor_area_m2, request.ber, routing_key
        )
        warnings = _warnings(request, routing_key)
        gap = request.asking_price_eur / estimate - 1 if request.asking_price_eur else None
        response = ValuationResponse(
            estimate_eur=round(estimate, 2),
            display_estimate_eur=int(round(estimate / 1000)) * 1000,
            basis=BASIS,
            support_warnings=warnings,
            model_version=MODEL_VERSION,
            schema_version=SCHEMA_VERSION,
            price_gap=None if gap is None else round(gap, 6),
            price_needs_review=None if gap is None else gap > valuation_model.review_threshold(),
        )
        entry.update(outcome="ok", estimate_eur=response.estimate_eur)
        return response
    except valuation_model.ValuationUnavailable as exc:
        entry.update(outcome="model_unavailable", error=str(exc))
        raise HTTPException(503, "The home valuation is not available")
    finally:
        entry["duration_s"] = round(time.monotonic() - started, 3)
        log.info(json.dumps(entry))
