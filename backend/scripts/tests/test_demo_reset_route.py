"""The public API cannot reset data without the dedicated demo guard."""

from __future__ import annotations

import importlib
from contextlib import contextmanager
from datetime import date
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from fastapi import HTTPException, Request, Response
from fastapi.testclient import TestClient
from pydantic import PostgresDsn

DEMO_HOST = "ep-demo.c-12.us-east-1.aws.neon.tech"
DEMO_URL = f"postgresql://owner:password@{DEMO_HOST}/neondb?sslmode=require"


@pytest.fixture
def reset_route(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("PROJECT_NAME", "Test Demo")
    monkeypatch.setenv("FIRST_SUPERUSER", "admin@example.com")
    monkeypatch.setenv("FIRST_SUPERUSER_PASSWORD", "test-password")
    monkeypatch.setenv("POSTGRES_SERVER", "localhost")
    monkeypatch.setenv("POSTGRES_USER", "test")
    monkeypatch.setenv("DEMO_USER_PASSWORD", "demo-password")
    route = importlib.import_module("app.api.routes.demo_reset")
    monkeypatch.setattr(route.settings, "ENVIRONMENT", "demo")
    monkeypatch.setattr(route.settings, "CRON_SECRET", "long-test-cron-secret")
    monkeypatch.setattr(route.settings, "DEMO_NEON_HOST", DEMO_HOST)
    monkeypatch.setattr(route.settings, "POSTGRES_URL", PostgresDsn(DEMO_URL))
    monkeypatch.setattr(route.settings, "POSTGRES_URL_NON_POOLING", None)
    return route


def _request(secret: str | None = None) -> Request:
    headers = (
        [] if secret is None else [(b"authorization", f"Bearer {secret}".encode())]
    )
    return Request(
        {
            "type": "http",
            "method": "GET",
            "path": "/api/v1/demo/reset",
            "headers": headers,
        }
    )


def _reset(route, secret: str | None = None):
    return route.reset_demo(_request(secret), Response())


def test_reset_unavailable_outside_demo(
    reset_route, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(reset_route.settings, "ENVIRONMENT", "production")
    with pytest.raises(HTTPException) as error:
        _reset(reset_route, "long-test-cron-secret")
    assert error.value.status_code == 404


def test_reset_requires_server_secret(reset_route) -> None:
    with pytest.raises(HTTPException) as error:
        _reset(reset_route)
    assert error.value.status_code == 401


def test_registered_route_rejects_unauthenticated_http(reset_route) -> None:
    from app.main import app

    assert reset_route.settings.ENVIRONMENT == "demo"
    assert str(app.url_path_for("reset_demo")) == "/api/v1/demo/reset"
    with TestClient(app) as client:
        response = client.get("/api/v1/demo/reset")
    assert response.status_code == 401


def test_reset_refuses_other_database(
    reset_route, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        reset_route.settings,
        "POSTGRES_URL",
        PostgresDsn("postgresql://owner:password@production.example.com/neondb"),
    )
    with pytest.raises(HTTPException) as error:
        _reset(reset_route, "long-test-cron-secret")
    assert error.value.status_code == 503


def test_reset_uses_direct_neon_url_for_pooled_application(
    reset_route, monkeypatch: pytest.MonkeyPatch
) -> None:
    pooled_url = DEMO_URL.replace(".c-12", "-pooler.c-12")
    monkeypatch.setattr(reset_route.settings, "POSTGRES_URL", PostgresDsn(pooled_url))
    monkeypatch.setattr(
        reset_route.settings, "POSTGRES_URL_NON_POOLING", PostgresDsn(DEMO_URL)
    )
    seed = Mock(return_value=SimpleNamespace(reference_date=date(2026, 9, 25)))
    monkeypatch.setattr(reset_route, "reset_demo_data", seed)

    assert _reset(reset_route, "long-test-cron-secret")["status"] == "ok"
    seed.assert_called_once_with(password="demo-password", database_url=DEMO_URL)


def test_reset_rejects_mismatched_direct_url(
    reset_route, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        reset_route.settings,
        "POSTGRES_URL_NON_POOLING",
        PostgresDsn("postgresql://owner:password@ep-other.neon.tech/neondb"),
    )
    seed = Mock()
    monkeypatch.setattr(reset_route, "reset_demo_data", seed)

    with pytest.raises(HTTPException) as error:
        _reset(reset_route, "long-test-cron-secret")
    assert error.value.status_code == 503
    seed.assert_not_called()


def test_reset_reseeds_without_migrations(
    reset_route, monkeypatch: pytest.MonkeyPatch
) -> None:
    observed = []

    def fake_seed(*, password: str, database_url: str):
        observed.append(password)
        assert database_url == DEMO_URL
        return SimpleNamespace(reference_date=date(2026, 9, 25))

    monkeypatch.setattr(reset_route, "reset_demo_data", fake_seed)
    assert _reset(reset_route, "long-test-cron-secret") == {
        "status": "ok",
        "reference_date": "2026-09-25",
    }
    assert observed == ["demo-password"]


def test_reset_busy_returns_conflict(
    reset_route, monkeypatch: pytest.MonkeyPatch
) -> None:
    def busy(*, password: str, database_url: str):
        assert password == "demo-password"
        assert database_url == DEMO_URL
        raise reset_route.DemoResetBusyError("busy")

    monkeypatch.setattr(reset_route, "reset_demo_data", busy)
    with pytest.raises(HTTPException) as error:
        _reset(reset_route, "long-test-cron-secret")
    assert error.value.status_code == 409


def test_reset_lock_rejects_overlapping_runs(
    reset_route, monkeypatch: pytest.MonkeyPatch
) -> None:
    assert reset_route.settings.ENVIRONMENT == "demo"
    service = importlib.import_module("app.services.demo_reset")
    connection = Mock()
    connection.scalar.return_value = False

    @contextmanager
    def locked_connection():
        yield connection

    monkeypatch.setattr(service.engine, "begin", locked_connection)
    seed = Mock()
    monkeypatch.setattr(service, "seed_demo", seed)
    with pytest.raises(service.DemoResetBusyError):
        service.reset_demo_data(password="demo-password")
    seed.assert_not_called()


def test_hosted_reset_connects_to_direct_url_and_disposes_engine(
    reset_route, monkeypatch: pytest.MonkeyPatch
) -> None:
    assert reset_route.settings.ENVIRONMENT == "demo"
    service = importlib.import_module("app.services.demo_reset")
    connection = Mock()
    connection.scalar.return_value = False
    direct_engine = Mock()

    @contextmanager
    def direct_connection():
        yield connection

    direct_engine.begin = direct_connection
    create_engine = Mock(return_value=direct_engine)
    monkeypatch.setattr(service, "create_engine", create_engine)

    with pytest.raises(service.DemoResetBusyError):
        service.reset_demo_data(password="demo-password", database_url=DEMO_URL)

    create_engine.assert_called_once_with(
        DEMO_URL.replace("postgresql://", "postgresql+psycopg://", 1),
        pool_pre_ping=True,
    )
    direct_engine.dispose.assert_called_once_with()
