import os
from contextlib import asynccontextmanager

from fastapi import APIRouter, FastAPI

from app import affordability_endpoint, auto_start, committee_endpoint, cors, errors, portfolio_endpoint, request_log, run_log, valuation_endpoint


@asynccontextmanager
async def lifespan(app: FastAPI):
    """AUTO_START_COMMITTEE=true starts the listener that runs the committee for each Applied application (AL-141). Off by default."""
    request_log.send_to_stdout()  # at start-up, not on import, so tests keep their own logging; on ECS stdout goes to CloudWatch
    run_log.send_to_stdout()  # one line per committee step, so a run on AWS can be followed in CloudWatch
    listener = auto_start.start_from_env() if os.getenv("AUTO_START_COMMITTEE", "").lower() == "true" else None
    app.state.committee_listener = listener  # POST /ai/committee/runs re-runs through it; without it that endpoint answers 503
    yield
    app.state.committee_listener = None
    if listener:
        listener.stop()


app = FastAPI(title="al-ai", docs_url="/ai/docs", openapi_url="/ai/openapi.json", redoc_url=None, lifespan=lifespan)
errors.install(app)
cors.install(app)

router = APIRouter(prefix="/ai")


@router.get("/health")
def health():
    return {"status": "ok"}


app.include_router(router)
app.include_router(affordability_endpoint.router)
app.include_router(valuation_endpoint.router)
app.include_router(portfolio_endpoint.router)
app.include_router(committee_endpoint.router)
