from fastapi import APIRouter, FastAPI

from app import applications, cors, decision, errors, me, saved_checks

app = FastAPI(title="al-core", docs_url="/core/docs", openapi_url="/core/openapi.json", redoc_url=None)
errors.install(app)
cors.install(app)

router = APIRouter(prefix="/core")


@router.get("/health")
def health():
    return {"status": "ok"}


app.include_router(router)
app.include_router(me.router)
app.include_router(applications.router)
app.include_router(saved_checks.router)
app.include_router(decision.router)
