"""Exercise ASGI frames directly, including lengths HTTP clients normalize away."""

import asyncio
import json
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import ValidationError
from starlette.types import Message, Receive, Scope, Send

from app.core.config import Settings, settings
from app.core.request_limits import RequestLimitsMiddleware
from app.schemas.categories import IntegrationCategoryDataRecordCreate


@pytest.fixture(autouse=True)
def production(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "ENVIRONMENT", "production")


def invoke(
    chunks: list[bytes],
    *,
    headers: list[tuple[bytes, bytes]] | None = None,
    path: str = "/api/v1/integration/category/data-records",
    method: str = "POST",
    disconnect: bool = False,
) -> tuple[list[Message], bytes | None, int]:
    sent: list[Message] = []
    received: bytes | None = None
    reads = 0

    async def app(_scope: Scope, receive: Receive, send: Send) -> None:
        nonlocal received
        received = (await receive())["body"]
        await send({"type": "http.response.start", "status": 200, "headers": []})
        await send({"type": "http.response.body", "body": b"ok"})

    async def receive() -> Message:
        nonlocal reads
        index = reads
        reads += 1
        if disconnect or index >= len(chunks):
            return {"type": "http.disconnect"}
        return {
            "type": "http.request",
            "body": chunks[index],
            "more_body": index < len(chunks) - 1,
        }

    async def send(message: Message) -> None:
        sent.append(message)

    scope: Scope = {
        "type": "http",
        "method": method,
        "path": path,
        "headers": headers or [],
    }
    asyncio.run(RequestLimitsMiddleware(app)(scope, receive, send))
    return sent, received, reads


@pytest.mark.parametrize(
    "environment,limit",
    [
        ("production", 1048576),
        ("demo", 65536),
        ("staging", 1048576),
        ("local", 1048576),
    ],
)
@pytest.mark.parametrize("extra", [0, 1])
def test_boundary(
    monkeypatch: pytest.MonkeyPatch, environment: str, limit: int, extra: int
) -> None:
    monkeypatch.setattr(settings, "ENVIRONMENT", environment)
    body = b"x" * (limit + extra)
    sent, received, _ = invoke([body], headers=[(b"content-type", b"text/plain")])
    assert sent[0]["status"] == (413 if extra else 200)
    assert received == (None if extra else body)
    if extra:
        error = json.loads(sent[1]["body"])
        assert error["code"] == (
            "demo_request_too_large" if environment == "demo" else "request_too_large"
        )
        assert error["params"] == {}


def test_declared_oversize_rejected_without_receiving() -> None:
    sent, received, reads = invoke([], headers=[(b"content-length", b"1048577")])
    assert sent[0]["status"] == 413
    assert received is None
    assert reads == 0


@pytest.mark.parametrize(
    "headers",
    [
        [],
        [(b"transfer-encoding", b"chunked")],
        [(b"content-length", b"1")],
        [(b"content-length", b"invalid")],
    ],
)
def test_actual_bytes_counted_and_reading_stops(
    monkeypatch: pytest.MonkeyPatch, headers: list[tuple[bytes, bytes]]
) -> None:
    monkeypatch.setattr(settings, "REQUEST_BODY_LIMIT_BYTES", 4)
    sent, received, reads = invoke([b"12", b"345", b"unread"], headers=headers)
    assert sent[0]["status"] == 413
    assert received is None
    assert reads == 2


def test_chunked_body_preserved_at_limit(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "REQUEST_BODY_LIMIT_BYTES", 4)
    sent, received, reads = invoke([b"1", b"", b"234"])
    assert sent[0]["status"] == 200
    assert received == b"1234"
    assert reads == 3


@pytest.mark.parametrize(
    "method", ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]
)
def test_body_limit_applies_regardless_of_method(
    monkeypatch: pytest.MonkeyPatch, method: str
) -> None:
    monkeypatch.setattr(settings, "REQUEST_BODY_LIMIT_BYTES", 4)
    assert invoke([b"12345"], method=method)[0][0]["status"] == 413


@pytest.mark.parametrize(
    "content_type",
    [
        None,
        b"application/json",
        b"Application/JSON; charset=utf-8",
        b"application/problem+json; charset=utf-8",
    ],
)
def test_demo_json_media_types(
    monkeypatch: pytest.MonkeyPatch, content_type: bytes | None
) -> None:
    monkeypatch.setattr(settings, "ENVIRONMENT", "demo")
    headers = [] if content_type is None else [(b"content-type", content_type)]
    sent, received, _ = invoke(
        [json.dumps({"note": "x" * 2049}).encode()], headers=headers
    )
    assert sent[0]["status"] == 413
    assert json.loads(sent[1]["body"])["detail"] == "Demo JSON content is too large"
    assert received is None


@pytest.mark.parametrize(
    "body",
    [
        b"[" * 20 + b"0" + b"]" * 20,
        json.dumps([0] * 1024).encode(),
        b"[" * 2000 + b"0" + b"]" * 2000,
    ],
)
def test_demo_complexity_and_decoder_recursion(
    monkeypatch: pytest.MonkeyPatch, body: bytes
) -> None:
    monkeypatch.setattr(settings, "ENVIRONMENT", "demo")
    assert invoke([body])[0][0]["status"] == 413


def test_demo_invalid_json_left_to_fastapi(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "ENVIRONMENT", "demo")
    body = b'{"unfinished":'
    sent, received, _ = invoke([body])
    assert sent[0]["status"] == 200
    assert received == body


def test_disconnect_does_not_call_downstream() -> None:
    sent, received, reads = invoke([], disconnect=True)
    assert (sent, received, reads) == ([], None, 1)


def test_non_api_path_unaffected(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "REQUEST_BODY_LIMIT_BYTES", 4)
    sent, received, _ = invoke([b"12345"], path="/api/v10/other")
    assert sent[0]["status"] == 200
    assert received == b"12345"


def test_configurable_demo_limit(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "ENVIRONMENT", "demo")
    monkeypatch.setattr(settings, "DEMO_REQUEST_BODY_LIMIT_BYTES", 4)
    assert invoke([b"1234"])[0][0]["status"] == 200
    assert invoke([b"12345"])[0][0]["status"] == 413


@pytest.mark.parametrize(
    "name", ["REQUEST_BODY_LIMIT_BYTES", "DEMO_REQUEST_BODY_LIMIT_BYTES"]
)
@pytest.mark.parametrize("value", [0, -1])
def test_settings_require_positive_limits(name: str, value: int) -> None:
    with pytest.raises(ValidationError):
        Settings(**{**settings.model_dump(), name: value})


def test_production_large_integration_record_parses_once() -> None:
    app = FastAPI()
    app.add_middleware(RequestLimitsMiddleware)
    called = False

    @app.post("/api/v1/integration/category/data-records")
    def record(payload: IntegrationCategoryDataRecordCreate) -> dict[str, Any]:
        nonlocal called
        called = True
        return payload.data

    # Legitimate dynamic data exceeds all demo limits: bytes, string and nodes.
    data = {"readings": list(range(2000)), "description": "ą" * 40000}
    with TestClient(app) as client:
        response = client.post(
            "/api/v1/integration/category/data-records",
            json={"observed_at": "2026-11-21T00:00:00Z", "data": data},
        )
        assert response.status_code == 200
        assert response.json() == data
        assert called
        called = False
        response = client.post(
            "/api/v1/integration/category/data-records", content=b"x" * 1048577
        )
        assert response.status_code == 413
        assert response.json()["code"] == "request_too_large"
        assert not called
        # Malformed JSON retains normal FastAPI validation semantics.
        response = client.post(
            "/api/v1/integration/category/data-records",
            content=b'{"broken":',
            headers={"Content-Type": "application/json"},
        )
        assert response.status_code == 422


@pytest.mark.parametrize(
    "body",
    [
        json.dumps("x" * 2048).encode(),
        json.dumps([0] * 1023).encode(),
        b"[" * 12 + b"0" + b"]" * 12,
    ],
)
def test_demo_json_complexity_boundaries_are_inclusive(
    monkeypatch: pytest.MonkeyPatch, body: bytes
) -> None:
    monkeypatch.setattr(settings, "ENVIRONMENT", "demo")
    sent, received, _ = invoke([body])
    assert sent[0]["status"] == 200
    assert received == body


def test_demo_non_json_content_is_only_byte_limited(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "ENVIRONMENT", "demo")
    body = b"x" * 2049
    sent, received, _ = invoke([body], headers=[(b"content-type", b"text/plain")])
    assert sent[0]["status"] == 200
    assert received == body


def test_real_app_rejections_keep_cors_headers() -> None:
    from app.main import app

    with TestClient(app) as client:
        response = client.post(
            f"{settings.API_V1_STR}/integration/category/data-records",
            content=b"x" * 1048577,
            headers={"Origin": settings.FRONTEND_HOST},
        )
    assert response.status_code == 413
    assert response.json() == {
        "detail": "Request body is too large",
        "code": "request_too_large",
        "params": {},
    }
    assert response.headers["access-control-allow-origin"] == settings.FRONTEND_HOST
