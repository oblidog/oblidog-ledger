"""Application errors carry explicit codes without changing their historical detail."""

import json
import logging
from typing import Any

from fastapi import FastAPI, HTTPException, Request
from fastapi.exception_handlers import (
    http_exception_handler,
    request_validation_exception_handler,
)
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.responses import Response

from app.core.api_error_codes import ErrorCode

logger = logging.getLogger(__name__)


class ApplicationError(HTTPException):
    def __init__(
        self,
        status_code: int,
        detail: Any = None,
        headers: dict[str, str] | None = None,
        *,
        code: ErrorCode,
        params: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(status_code=status_code, detail=detail, headers=headers)
        self.code = code
        self.params = params or {}


def error_body(
    code: ErrorCode, detail: Any, params: dict[str, Any] | None = None
) -> dict[str, Any]:
    return {"detail": detail, "code": code, "params": params or {}}


STATUS_CODES: dict[int, ErrorCode] = {
    401: "auth_required",
    403: "permission_denied",
    404: "resource_not_found",
    413: "request_invalid",
    422: "request_validation_failed",
    503: "service_unavailable",
}


async def application_exception_handler(request: Request, exc: Exception) -> Response:
    assert isinstance(exc, StarletteHTTPException)
    # Preserve FastAPI's handling of headers, encoding and bodyless status codes.
    response = await http_exception_handler(request, exc)
    if exc.status_code in {204, 304} or exc.status_code < 200:
        return response
    code = (
        exc.code
        if isinstance(exc, ApplicationError)
        else STATUS_CODES.get(
            exc.status_code,
            "internal_error" if exc.status_code >= 500 else "request_invalid",
        )
    )
    params = exc.params if isinstance(exc, ApplicationError) else {}
    return JSONResponse(
        status_code=exc.status_code,
        content=error_body(code, exc.detail, params),
        headers=exc.headers,
    )


async def validation_exception_handler(
    request: Request, exc: Exception
) -> JSONResponse:
    assert isinstance(exc, RequestValidationError)
    response = await request_validation_exception_handler(request, exc)
    # FastAPI owns the validation detail serialization, including ctx/input.
    payload = json.loads(bytes(response.body))
    return JSONResponse(
        status_code=response.status_code,
        content=error_body("request_validation_failed", payload["detail"]),
    )


async def unexpected_exception_handler(
    request: Request, exc: Exception
) -> JSONResponse:
    logger.error(
        "Unhandled API error method=%s path=%s",
        request.method,
        request.url.path,
        exc_info=exc,
    )
    return JSONResponse(
        status_code=500,
        content=error_body("internal_error", "Internal Server Error"),
    )


def install_error_handlers(app: FastAPI) -> None:
    app.add_exception_handler(StarletteHTTPException, application_exception_handler)
    app.add_exception_handler(RequestValidationError, validation_exception_handler)
    app.add_exception_handler(Exception, unexpected_exception_handler)
