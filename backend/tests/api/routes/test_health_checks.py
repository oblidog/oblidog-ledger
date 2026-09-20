import asyncio

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.exc import OperationalError

from app.api.routes import utils
from app.core.config import settings


def test_liveness_does_not_depend_on_database(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def unavailable_database() -> None:
        raise OperationalError("SELECT 1", {}, Exception("database unavailable"))

    monkeypatch.setattr(utils, "_check_database", unavailable_database)

    response = client.get(f"{settings.API_V1_STR}/utils/health-check/")

    assert response.status_code == 200
    assert response.json() is True


def test_readiness_succeeds_when_database_is_available(client: TestClient) -> None:
    response = client.get(f"{settings.API_V1_STR}/utils/readiness-check/")

    assert response.status_code == 200
    assert response.json() is True


def test_readiness_fails_without_exposing_database_error(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def unavailable_database() -> None:
        raise OperationalError(
            "SELECT 1",
            {},
            Exception("postgresql://secret-user:secret-password@db/oblidog"),
        )

    monkeypatch.setattr(utils, "_check_database", unavailable_database)

    response = client.get(f"{settings.API_V1_STR}/utils/readiness-check/")

    assert response.status_code == 503
    assert response.json() == {"detail": "Service unavailable"}
    assert "secret-password" not in response.text


def test_readiness_has_bounded_latency(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def timed_out(_awaitable, *, timeout):  # type: ignore[no-untyped-def]
        assert timeout == utils.READINESS_TIMEOUT_SECONDS
        if hasattr(_awaitable, "close"):
            _awaitable.close()
        raise TimeoutError

    monkeypatch.setattr(asyncio, "wait_for", timed_out)

    response = client.get(f"{settings.API_V1_STR}/utils/readiness-check/")

    assert response.status_code == 503
    assert response.json() == {"detail": "Service unavailable"}


def test_readiness_recovers_after_database_returns(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    attempts = 0

    def recovering_database() -> None:
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            raise OperationalError("SELECT 1", {}, Exception("database unavailable"))

    monkeypatch.setattr(utils, "_check_database", recovering_database)

    first = client.get(f"{settings.API_V1_STR}/utils/readiness-check/")
    second = client.get(f"{settings.API_V1_STR}/utils/readiness-check/")

    assert first.status_code == 503
    assert second.status_code == 200
    assert second.json() is True
