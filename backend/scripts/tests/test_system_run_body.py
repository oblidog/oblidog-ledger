"""Manual system runs retain their optional request body."""

from unittest.mock import Mock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.deps import get_current_active_superuser, get_db
from app.api.routes import system_runs


def test_system_run_accepts_omitted_body(monkeypatch: pytest.MonkeyPatch) -> None:
    app = FastAPI()
    app.include_router(system_runs.router)
    app.dependency_overrides[get_db] = lambda: Mock()
    app.dependency_overrides[get_current_active_superuser] = lambda: Mock()
    runner = Mock(return_value=None)
    monkeypatch.setattr(system_runs, "run_system_run", runner)

    with TestClient(app) as client:
        response = client.post("/system-runs/")

    assert response.status_code == 409
    assert response.json() == {"detail": "A System Run is already running"}
    runner.assert_called_once()
