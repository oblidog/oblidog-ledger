import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.domain import TaskRunMode
from app.services.system_run_runner import SYSTEM_RUN_ADVISORY_LOCK_KEY
from app.use_cases.system_runs import SYSTEM_RUN_TASK_REGISTRY
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
    assert {step["task_name"] for step in run["steps"]} >= {
        "scheduled_reports",
        "maintenance_cleanup",
    }
    assert (
        next(step for step in run["steps"] if step["task_name"] == "scheduled_reports")[
            "skip_reason"
        ]
        == "not_configured"
    )
    assert {step["task_name"] for step in run["steps"]} >= {
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


def test_removed_importer_is_not_available(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    from app.main import app

    assert not any("legacy-import" in path for path in app.openapi()["paths"])
    tasks = client.get(
        f"{settings.API_V1_STR}/system-runs/tasks", headers=superuser_token_headers
    )
    assert tasks.status_code == 200
    assert "legacy_import" not in {task["name"] for task in tasks.json()}
    response = client.post(
        f"{settings.API_V1_STR}/system-runs/",
        headers=superuser_token_headers,
        json={"manual_task_names": ["legacy_import"]},
    )
    assert response.status_code == 422
    assert response.json()["code"] == "system_run_unknown_tasks"


@pytest.mark.parametrize("mode", [TaskRunMode.MANUAL_ONLY, TaskRunMode.DISABLED])
def test_manual_task_modes_remain_supported(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
    mode: TaskRunMode,
) -> None:
    task = next(
        task for task in SYSTEM_RUN_TASK_REGISTRY if task.name == "ensure_obligations"
    )
    monkeypatch.setattr(task, "mode", mode)
    response = client.post(
        f"{settings.API_V1_STR}/system-runs/",
        headers=superuser_token_headers,
        json={"manual_task_names": [task.name]},
    )
    if mode is TaskRunMode.DISABLED:
        assert response.status_code == 409
        assert response.json()["code"] == "system_run_disabled_tasks"
    else:
        assert response.status_code == 200
        assert task.name in {step["task_name"] for step in response.json()["steps"]}
