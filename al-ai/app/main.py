import os
from contextlib import asynccontextmanager

from fastapi import APIRouter, FastAPI

from app import affordability_endpoint, auto_start, cors, errors, valuation_endpoint


@asynccontextmanager
async def lifespan(app: FastAPI):
    """AUTO_START_COMMITTEE=true starts the listener that runs the committee for each Applied application (AL-141). Off by default."""
    listener = auto_start.start_from_env() if os.getenv("AUTO_START_COMMITTEE", "").lower() == "true" else None
    yield
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
