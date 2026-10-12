from fastapi import APIRouter, FastAPI

from app import affordability_endpoint, errors

app = FastAPI(title="al-ai", docs_url="/ai/docs", openapi_url="/ai/openapi.json", redoc_url=None)
errors.install(app)

router = APIRouter(prefix="/ai")


@router.get("/health")
def health():
    return {"status": "ok"}


app.include_router(router)
app.include_router(affordability_endpoint.router)
