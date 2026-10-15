"""Every error leaves the service in the shape from docs/api-design.md section 8."""

import uuid

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException  # base class, so unknown-route 404s get the shape too

CODES = {
    401: "UNAUTHENTICATED",
    403: "FORBIDDEN",
    404: "NOT_FOUND",
    409: "CONFLICT",
    422: "INVALID_FIELD",
    503: "UPSTREAM_UNAVAILABLE",
}


def _error(request: Request, status: int, code: str, message: str, field: str | None = None):
    body = {"code": code, "message": message, "field": field, "request_id": request.state.request_id}
    return JSONResponse({"error": body}, status_code=status, headers={"X-Request-ID": request.state.request_id})


def install(app: FastAPI) -> None:
    @app.middleware("http")
    async def request_id(request: Request, call_next):
        request.state.request_id = str(uuid.uuid4())
        response = await call_next(request)
        response.headers["X-Request-ID"] = request.state.request_id
        return response

    @app.exception_handler(HTTPException)
    async def http_error(request: Request, exc: HTTPException):
        return _error(request, exc.status_code, CODES.get(exc.status_code, "INTERNAL"), str(exc.detail))

    @app.exception_handler(RequestValidationError)
    async def invalid_field(request: Request, exc: RequestValidationError):
        first = exc.errors()[0]
        # A nested body field is named by its path, e.g. "property.county"; top-level ones stay "phone".
        loc = [str(part) for part in first["loc"] if part not in ("body", "query", "path", "header")]
        field = ".".join(loc) or None
        message = str(first["msg"]).removeprefix("Value error, ")
        return _error(request, 422, "INVALID_FIELD", f"{field}: {message}", field)

    @app.exception_handler(Exception)
    async def internal(request: Request, exc: Exception):
        # No stack trace or detail leaves the service; the request id points to the log line.
        return _error(request, 500, "INTERNAL", "The service failed while handling the request")
