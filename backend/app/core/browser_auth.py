import secrets
from datetime import UTC, datetime, timedelta

import jwt
from fastapi import Request, Response, status
from jwt.exceptions import InvalidTokenError
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.responses import JSONResponse

from app.core import security
from app.core.config import settings

UNSAFE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}


def set_session_cookie(response: Response, token: str) -> None:
    max_age = settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60
    response.set_cookie(
        key=settings.SESSION_COOKIE_NAME,
        value=token,
        max_age=max_age,
        expires=datetime.now(UTC) + timedelta(seconds=max_age),
        path="/",
        secure=settings.session_cookie_secure,
        httponly=True,
        samesite=settings.SESSION_COOKIE_SAMESITE,
    )


def clear_session_cookie(response: Response) -> None:
    response.delete_cookie(
        key=settings.SESSION_COOKIE_NAME,
        path="/",
        secure=settings.session_cookie_secure,
        httponly=True,
        samesite=settings.SESSION_COOKIE_SAMESITE,
    )


def session_csrf_token(request: Request) -> str | None:
    token = request.cookies.get(settings.SESSION_COOKIE_NAME)
    if token is None:
        return None
    try:
        payload = jwt.decode(
            token, settings.SECRET_KEY, algorithms=[security.ALGORITHM]
        )
    except InvalidTokenError:
        return None
    csrf_token = payload.get("csrf")
    return csrf_token if isinstance(csrf_token, str) else None


class BrowserSessionSecurityMiddleware(BaseHTTPMiddleware):
    async def dispatch(
        self,
        request: Request,
        call_next: RequestResponseEndpoint,
    ) -> Response:
        if request.method in UNSAFE_METHODS:
            origin = request.headers.get("origin")
            if (
                origin is not None
                and origin.rstrip("/") not in settings.all_cors_origins
            ):
                return JSONResponse(
                    status_code=status.HTTP_403_FORBIDDEN,
                    content={"detail": "Origin is not allowed"},
                )

            csrf_token = session_csrf_token(request)
            if csrf_token is not None:
                provided = request.headers.get(settings.CSRF_HEADER_NAME)
                if provided is None or not secrets.compare_digest(provided, csrf_token):
                    return JSONResponse(
                        status_code=status.HTTP_403_FORBIDDEN,
                        content={"detail": "Invalid CSRF token"},
                    )

        response = await call_next(request)
        csrf_token = session_csrf_token(request)
        if csrf_token is not None:
            response.headers[settings.CSRF_HEADER_NAME] = csrf_token
        return response
