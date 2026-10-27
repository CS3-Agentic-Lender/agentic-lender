"""POST /ai/valuation: the saved model's estimate of a home's asking price, with its warnings. The model itself lives in app.valuation_model."""

import json
import logging
import re
import time
from typing import Annotated, Literal

from fastapi import APIRouter, Body, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field

from app import auth, valuation_checks, valuation_explain, valuation_model
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


class Contribution(BaseModel):
    feature: Literal["county", "property_type", "bedrooms", "floor_area", "ber", "eircode_area"] = Field(
        description="The input this piece explains. eircode_area is the routing key, the first three characters of the Eircode."
    )
    value: str | int | float = Field(description="The value of that input for this home, as it was sent (eircode_area is the routing key only).")
    eur: float = Field(description="Euro this input added to the estimate (positive) or took off it (negative), compared with the baseline.")


class ValuationResponse(BaseModel):
    """An ESTIMATE of a 2024 asking price. It is not a valuation. baseline_eur plus every contribution adds up to estimate_eur."""

    estimate_eur: float
    display_estimate_eur: int  # nearest EUR 1,000
    basis: Literal["2024 asking-price estimate"]
    support_warnings: list[str]
    model_version: str
    schema_version: str
    asking_price_gap: float | None  # asking price / estimate - 1; null when no asking price was sent
    price_needs_review: bool | None
    baseline_eur: float = Field(description="The model's average estimate over the 100 sample homes saved with it: the starting point of the breakdown.")
    contributions: list[Contribution] = Field(
        description="One piece for each of the six inputs, biggest first by size (ignoring the sign). baseline_eur plus all the pieces is estimate_eur."
    )


def _breakdown(request: ValuationRequest, routing_key: str) -> tuple[float, list[Contribution]]:
    """The baseline and one euro piece per input, biggest first. The pieces come from app.valuation_explain."""
    explained = valuation_explain.explain_value(
        request.county, request.property_type, request.bedrooms, request.floor_area_m2, request.ber, routing_key
    )
    shown = {  # the name the API uses for each model column, and the value that was sent
        "county": ("county", request.county), "property_type": ("property_type", request.property_type),
        "bedrooms": ("bedrooms", request.bedrooms), "floor_area_m2": ("floor_area", request.floor_area_m2),
        "ber": ("ber", request.ber), "rkey": ("eircode_area", routing_key),
    }
    pieces = [Contribution(feature=shown[col][0], value=shown[col][1], eur=round(eur, 2)) for col, eur in explained.contributions.items()]
    return round(explained.baseline, 2), sorted(pieces, key=lambda c: abs(c.eur), reverse=True)


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
        baseline, contributions = _breakdown(request, routing_key)
        gap, needs_review = valuation_checks.price_gap_check(estimate, request.asking_price_eur, valuation_model.review_threshold())
        response = ValuationResponse(
            estimate_eur=round(estimate, 2),
            display_estimate_eur=int(round(estimate / 1000)) * 1000,
            basis=BASIS,
            support_warnings=warnings,
            model_version=MODEL_VERSION,
            schema_version=SCHEMA_VERSION,
            asking_price_gap=None if gap is None else round(gap, 6),
            price_needs_review=needs_review,
            baseline_eur=baseline,
            contributions=contributions,
        )
        entry.update(outcome="ok", estimate_eur=response.estimate_eur)
        return response
    except valuation_model.ValuationUnavailable as exc:
        entry.update(outcome="model_unavailable", error=str(exc))
        raise HTTPException(503, "The home valuation is not available")
    finally:
        entry["duration_s"] = round(time.monotonic() - started, 3)
        log.info(json.dumps(entry))
