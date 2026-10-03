"""Bound demo API request bodies before FastAPI parses user-controlled content."""

import json
import logging
from typing import Any

from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Receive, Scope, Send

from app.core.config import settings

logger = logging.getLogger(__name__)
MAX_BODY_BYTES = 64 * 1024
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


class DemoRequestLimitsMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        method = scope.get("method", "")
        path = scope.get("path", "")
        if (
            scope["type"] != "http"
            or settings.ENVIRONMENT != "demo"
            or method not in {"POST", "PUT", "PATCH", "DELETE"}
            or not path.startswith(f"{settings.API_V1_STR}/")
        ):
            await self.app(scope, receive, send)
            return

        body = bytearray()
        while True:
            message = await receive()
            if message["type"] == "http.disconnect":
                return
            body.extend(message.get("body", b""))
            if len(body) > MAX_BODY_BYTES:
                await self._reject(
                    scope, receive, send, 413, "Demo request body is too large"
                )
                return
            if not message.get("more_body", False):
                break

        headers = dict(scope.get("headers", []))
        if (
            headers.get(b"content-type", b"").lower().startswith(b"application/json")
            and body
        ):
            try:
                data = json.loads(body)
            except ValueError, UnicodeDecodeError:
                data = None  # FastAPI reports malformed JSON in the usual way.
            if data is not None and not _valid_json(data, 0, [MAX_JSON_NODES]):
                await self._reject(
                    scope, receive, send, 413, "Demo JSON content is too large"
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
    async def _reject(
        scope: Scope, receive: Receive, send: Send, code: int, detail: str
    ) -> None:
        logger.warning(
            "Demo request rejected reason=%s method=%s",
            detail,
            scope["method"],
        )
        await JSONResponse({"detail": detail}, status_code=code)(scope, receive, send)
