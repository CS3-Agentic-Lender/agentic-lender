from fastapi import APIRouter, FastAPI

from app import errors, me

app = FastAPI(title="al-core", docs_url="/core/docs", openapi_url="/core/openapi.json", redoc_url=None)
errors.install(app)

router = APIRouter(prefix="/core")


@router.get("/health")
def health():
    return {"status": "ok"}


app.include_router(router)
app.include_router(me.router)
