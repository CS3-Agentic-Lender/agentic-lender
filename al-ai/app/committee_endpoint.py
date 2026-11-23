"""POST /ai/committee/runs: an underwriter re-runs the committee for an application whose run failed or is stale.

The run is started by the service's committee listener (auto_start.Listener.rerun), so it is claimed in the same transaction
as every other run and runs on the same pool. The answer comes as soon as the claim is made; the run goes on in the
background, and clients watch `aiRunStatus` on the application for the result.
"""

from fastapi import APIRouter, Body, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field

from app import auth, auto_start

router = APIRouter(prefix="/ai")

REFUSALS = {
    auto_start.Refusal.NOT_FOUND: (404, "No application has that id"),
    auto_start.Refusal.RUNNING: (409, "The application's committee run is still going: watch aiRunStatus for its result"),
    auto_start.Refusal.NOTHING_TO_RERUN: (409, "The application has no failed or stale committee run to re-run"),
    auto_start.Refusal.STOPPING: (503, "The service is shutting down, so no run can start: try again shortly"),
}


class CommitteeRunRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    application_id: str = Field(pattern=r"^[A-Za-z0-9_-]{1,128}$")  # a Firestore document id; never a path


def require_underwriter(user: dict = Depends(auth.current_user)) -> dict:
    if user.get("role") != "underwriter":
        raise HTTPException(403, "Only an underwriter can re-run the committee")
    return user


@router.post("/committee/runs", status_code=201)
def rerun_committee(request: Request, body: CommitteeRunRequest = Body(), user: dict = Depends(require_underwriter)) -> dict:
    listener = getattr(request.app.state, "committee_listener", None)
    if listener is None:
        raise HTTPException(503, "The committee listener is not running in this service (AUTO_START_COMMITTEE is not true)")
    outcome = listener.rerun(body.application_id)
    if isinstance(outcome, auto_start.RerunRefused):
        status, message = REFUSALS[outcome.reason]
        raise HTTPException(status, message)
    return {"run_id": outcome.run_id, "application_id": body.application_id, "status": "running", "trigger": "rerun"}
