"""Bound API request bodies before FastAPI parses user-controlled content."""

import json
import logging
from typing import Any

from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Receive, Scope, Send

from app.core.api_errors import error_body
from app.core.config import settings

logger = logging.getLogger(__name__)
MAX_STRING_CHARS = 2048
MAX_JSON_DEPTH = 12
MAX_JSON_NODES = 1024


def _valid_json(value: Any, depth: int, budget: list[int]) -> bool:
    budget[0] -= 1
    if budget[0] < 0 or depth > MAX_JSON_DEPTH:
        return False
    if isinstance(value, str):
        return len(value) <= MAX_STRING_CHARS
    if isinstance(value, dict):
        return all(
            isinstance(key, str)
            and len(key) <= MAX_STRING_CHARS
            and _valid_json(item, depth + 1, budget)
            for key, item in value.items()
        )
    if isinstance(value, list):
        return all(_valid_json(item, depth + 1, budget) for item in value)
    return True


class RequestLimitsMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        path = scope.get("path", "")
        if scope["type"] != "http" or not (
            path == settings.API_V1_STR or path.startswith(f"{settings.API_V1_STR}/")
        ):
            await self.app(scope, receive, send)
            return

        demo = settings.ENVIRONMENT == "demo"
        limit = (
            settings.DEMO_REQUEST_BODY_LIMIT_BYTES
            if demo
            else settings.REQUEST_BODY_LIMIT_BYTES
        )
        detail = (
            "Demo request body is too large" if demo else "Request body is too large"
        )
        # Content-Length is only an optimization. The receive loop is authoritative
        # for absent, inaccurate, or chunked lengths. Do not read an oversized body.
        for key, value in scope.get("headers", []):
            if key == b"content-length":
                try:
                    declared_length = int(value)
                except ValueError:
                    continue  # Transport validation belongs to the ASGI server.
                if declared_length > limit:
                    await self._reject(scope, receive, send, detail)
                    return

        body = bytearray()
        while True:
            message = await receive()
            if message["type"] == "http.disconnect":
                return
            chunk = message.get("body", b"")
            if len(chunk) > limit - len(body):
                await self._reject(scope, receive, send, detail)
                return
            body.extend(chunk)
            if not message.get("more_body", False):
                break

        headers = dict(scope.get("headers", []))
        content_type = (
            headers.get(b"content-type", b"").split(b";", 1)[0].strip().lower()
        )
        # FastAPI also treats a missing Content-Type and application/*+json as JSON.
        is_json = (
            not content_type
            or content_type == b"application/json"
            or (
                content_type.startswith(b"application/")
                and content_type.endswith(b"+json")
            )
        )
        if demo and is_json and body:
            try:
                data = json.loads(body)
            except RecursionError:
                await self._reject(
                    scope, receive, send, "Demo JSON content is too large"
                )
                return
            except ValueError, UnicodeDecodeError:
                data = None  # FastAPI reports malformed JSON in the usual way.
            if data is not None and not _valid_json(data, 0, [MAX_JSON_NODES]):
                await self._reject(
                    scope, receive, send, "Demo JSON content is too large"
                )
                return

        delivered = False

        async def replay() -> Any:
            nonlocal delivered
            if not delivered:
                delivered = True
                return {"type": "http.request", "body": bytes(body), "more_body": False}
            return await receive()

        await self.app(scope, replay, send)

    @staticmethod
    async def _reject(scope: Scope, receive: Receive, send: Send, detail: str) -> None:
        logger.warning(
            "API request rejected reason=%s method=%s",
            detail,
            scope["method"],
        )
        await JSONResponse(
            error_body(
                "demo_request_too_large"
                if settings.ENVIRONMENT == "demo"
                else "request_too_large",
                detail,
            ),
            status_code=413,
        )(scope, receive, send)
