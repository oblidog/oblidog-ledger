import uuid
from collections.abc import Generator
from datetime import date

import pytest
from fastapi.testclient import TestClient

from app.api.deps import require_ledger_view_access
from app.core.config import settings
from app.main import app
from app.models import Ledger


@pytest.fixture
def preview_client() -> Generator[TestClient]:
    previous = app.dependency_overrides.copy()
    app.dependency_overrides[require_ledger_view_access] = lambda: Ledger(
        id=uuid.uuid4()
    )
    try:
        with TestClient(app) as client:
            yield client
    finally:
        app.dependency_overrides.clear()
        app.dependency_overrides.update(previous)


@pytest.mark.parametrize(
    ("anchor", "reference", "expected"),
    [
        ("2026-03-15", "2026-03-01", "2026-03-13"),
        ("2026-01-31", "2026-02-01", "2026-02-27"),
        ("2026-11-11", "2026-11-01", "2026-11-10"),
        ("2026-01-01", "2025-12-31", "2025-12-31"),
    ],
)
def test_preview_returns_effective_due_date(
    preview_client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    anchor: str,
    reference: str,
    expected: str,
) -> None:
    monkeypatch.setattr(settings, "BUSINESS_CALENDAR_COUNTRY", "PL")
    response = preview_client.post(
        f"{settings.API_V1_STR}/ledgers/{uuid.uuid4()}/categories/schedule-preview",
        json={
            "first_due_date": anchor,
            "recurrence_interval": 1,
            "recurrence_unit": "month",
            "reference_date": reference,
        },
    )
    assert response.status_code == 200
    assert response.json()["due_date"] == expected
    assert response.json()["calendar_country"] == "PL"


def test_preview_defaults_to_backend_business_date_and_works_in_read_only_demo(
    preview_client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.api.routes import categories

    monkeypatch.setattr(categories, "business_today", lambda: date(2026, 3, 13))
    monkeypatch.setattr(settings, "ENVIRONMENT", "demo")
    monkeypatch.setattr(settings, "DEMO_WRITES_ENABLED", False)
    monkeypatch.setattr(settings, "BUSINESS_CALENDAR_COUNTRY", "PL")
    response = preview_client.post(
        f"{settings.API_V1_STR}/ledgers/{uuid.uuid4()}/categories/schedule-preview",
        json={
            "first_due_date": "2026-03-15",
            "recurrence_interval": 1,
            "recurrence_unit": "month",
        },
    )
    assert response.status_code == 200
    assert response.json()["due_date"] == "2026-03-13"


@pytest.mark.parametrize("interval", [0, -1, 1.5])
def test_preview_rejects_invalid_interval(
    preview_client: TestClient, interval: float
) -> None:
    response = preview_client.post(
        f"{settings.API_V1_STR}/ledgers/{uuid.uuid4()}/categories/schedule-preview",
        json={
            "first_due_date": "2026-03-15",
            "recurrence_interval": interval,
            "recurrence_unit": "month",
        },
    )
    assert response.status_code == 422


def test_preview_requires_authentication() -> None:
    with TestClient(app) as client:
        response = client.post(
            f"{settings.API_V1_STR}/ledgers/{uuid.uuid4()}/categories/schedule-preview",
            json={
                "first_due_date": "2026-03-15",
                "recurrence_interval": 1,
                "recurrence_unit": "month",
            },
        )
    assert response.status_code == 401
