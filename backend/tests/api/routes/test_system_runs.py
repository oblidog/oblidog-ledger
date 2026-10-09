import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.domain import TaskRunMode
from app.services.system_run_runner import SYSTEM_RUN_ADVISORY_LOCK_KEY
from tests.conftest import TestingSessionLocal
from tests.utils.user import authentication_token_from_email, create_random_user


def test_system_runs_require_a_superuser(client: TestClient, db: Session) -> None:
    user = create_random_user(db)
    headers = authentication_token_from_email(client=client, email=user.email, db=db)

    response = client.get(f"{settings.API_V1_STR}/system-runs/", headers=headers)

    assert response.status_code == 403


def test_administrator_can_start_manual_run_and_inspect_history(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "LEGACY_IMPORT_MODE", TaskRunMode.MANUAL_ONLY)
    monkeypatch.setattr(settings, "SYSTEM_RUN_TIMEZONE", "Europe/Warsaw")
    monkeypatch.setattr(settings, "SMTP_HOST", None)
    started = client.post(
        f"{settings.API_V1_STR}/system-runs/", headers=superuser_token_headers
    )

    assert started.status_code == 200
    run = started.json()
    assert run["trigger"] == "manual"
    assert run["status"] == "success"
    assert run["timezone"] == "Europe/Warsaw"
    assert {step["task_name"] for step in run["steps"]} >= {"scheduled_reports", "maintenance_cleanup"}
    assert run["steps"][-1]["skip_reason"] == "not_configured"
    assert {step["task_name"] for step in run["steps"][:-1]} == {
        "ensure_obligations",
        "estimate_obligation_amounts",
    }

    history = client.get(
        f"{settings.API_V1_STR}/system-runs/", headers=superuser_token_headers
    )
    assert history.status_code == 200
    assert history.json()["data"][0]["id"] == run["id"]

    details = client.get(
        f"{settings.API_V1_STR}/system-runs/{run['id']}",
        headers=superuser_token_headers,
    )
    assert details.status_code == 200
    assert details.json()["steps"] == run["steps"]


def test_manual_only_task_requires_explicit_selection(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "LEGACY_IMPORT_MODE", TaskRunMode.MANUAL_ONLY)
    monkeypatch.setattr(settings, "SMTP_HOST", None)

    response = client.post(
        f"{settings.API_V1_STR}/system-runs/",
        headers=superuser_token_headers,
        json={"manual_task_names": ["legacy_import"]},
    )

    assert response.status_code == 200
    steps = response.json()["steps"]
    assert steps[0]["task_name"] == "legacy_import"
    assert steps[0]["skip_reason"] == "not_configured"
    assert {step["task_name"] for step in steps} >= {"scheduled_reports", "maintenance_cleanup"}
    assert {step["task_name"] for step in steps[1:-1]} == {
        "ensure_obligations",
        "estimate_obligation_amounts",
    }


def test_disabled_tasks_cannot_be_started_manually(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "LEGACY_IMPORT_MODE", TaskRunMode.DISABLED)

    response = client.post(
        f"{settings.API_V1_STR}/system-runs/",
        headers=superuser_token_headers,
        json={"manual_task_names": ["legacy_import"]},
    )

    assert response.status_code == 409
    assert (
        response.json()["detail"] == "Disabled tasks cannot be started: legacy_import"
    )


def test_start_reports_an_already_running_execution(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    with TestingSessionLocal() as locked_session:
        assert locked_session.scalar(
            select(func.pg_try_advisory_lock(SYSTEM_RUN_ADVISORY_LOCK_KEY))
        )
        try:
            response = client.post(
                f"{settings.API_V1_STR}/system-runs/", headers=superuser_token_headers
            )
        finally:
            locked_session.execute(
                select(func.pg_advisory_unlock(SYSTEM_RUN_ADVISORY_LOCK_KEY))
            )
            locked_session.commit()

    assert response.status_code == 409
    assert response.json()["detail"] == "A System Run is already running"
