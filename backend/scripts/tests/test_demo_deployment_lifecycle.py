"""Guard the GitHub demo database job before it can touch a database."""

from __future__ import annotations

import importlib.util
import subprocess
from pathlib import Path
from unittest.mock import patch

import pytest


def _load_lifecycle():
    path = Path(__file__).parents[1] / "run_vercel_demo_lifecycle.py"
    spec = importlib.util.spec_from_file_location("demo_lifecycle", path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


lifecycle = _load_lifecycle()
DEMO_URL = (
    "postgresql://owner:password@"
    "ep-demo.c-12.us-east-1.aws.neon.tech/neondb?sslmode=require"
)
DEMO_HOST = "ep-demo.c-12.us-east-1.aws.neon.tech"


@pytest.mark.parametrize(
    "url",
    [
        "postgresql://owner:password@production.example.com/neondb",
        "postgresql://owner:password@ep-demo-pooler.c-12.us-east-1.aws.neon.tech/neondb",
        DEMO_URL.replace("/neondb?", "/other?"),
    ],
)
def test_rejects_other_database_targets(url: str) -> None:
    with pytest.raises(ValueError, match="dedicated"):
        lifecycle.validate_target(url, DEMO_HOST)


@pytest.mark.parametrize("host", ["", "prod.example.com", "ep-other.neon.tech"])
def test_requires_matching_demo_host(host: str) -> None:
    with pytest.raises(ValueError, match="dedicated"):
        lifecycle.validate_target(DEMO_URL, host)


def test_migrate_only_and_initialize_is_explicit(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("GITHUB_REF", "refs/heads/dev")
    monkeypatch.setenv("DEMO_POSTGRES_URL", DEMO_URL)
    monkeypatch.setenv("DEMO_NEON_HOST", DEMO_HOST)
    monkeypatch.setenv("DEMO_FIRST_SUPERUSER_PASSWORD", "admin-password")
    monkeypatch.setenv("DEMO_USER_PASSWORD", "demo-password")
    monkeypatch.setenv("POSTGRES_SERVER", "private-production-db")
    with patch.object(lifecycle.subprocess, "run") as execute:
        lifecycle.run_lifecycle("migrate")
        assert [call.args[0][-3:] for call in execute.call_args_list] == [
            ["alembic", "upgrade", "head"]
        ]
        assert "POSTGRES_SERVER" not in execute.call_args.kwargs["env"]
        execute.reset_mock()
        with pytest.raises(ValueError, match="confirmation"):
            lifecycle.run_lifecycle("initialize")
        execute.assert_not_called()
        lifecycle.run_lifecycle("initialize", "replace-demo-ledger")
        assert [call.args[0][-3:] for call in execute.call_args_list] == [
            ["alembic", "upgrade", "head"],
            ["python", "-m", "app.initial_data"],
            ["python", "-m", "app.demo_seed"],
        ]


def test_rejects_other_branch_before_database_access(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("GITHUB_REF", "refs/heads/main")
    with patch.object(lifecycle.subprocess, "run") as execute:
        with pytest.raises(ValueError, match="dev branch"):
            lifecycle.run_lifecycle("migrate")
        execute.assert_not_called()


def test_failed_migration_stops_before_seed(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GITHUB_REF", "refs/heads/dev")
    monkeypatch.setenv("DEMO_POSTGRES_URL", DEMO_URL)
    monkeypatch.setenv("DEMO_NEON_HOST", DEMO_HOST)
    monkeypatch.setenv("DEMO_FIRST_SUPERUSER_PASSWORD", "admin-password")
    monkeypatch.setenv("DEMO_USER_PASSWORD", "demo-password")
    with patch.object(
        lifecycle.subprocess,
        "run",
        side_effect=subprocess.CalledProcessError(1, ["uv", "run", "alembic"]),
    ) as execute:
        with pytest.raises(subprocess.CalledProcessError):
            lifecycle.run_lifecycle("initialize", "replace-demo-ledger")
        execute.assert_called_once()
