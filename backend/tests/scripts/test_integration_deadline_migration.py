from datetime import UTC, datetime, timedelta
from importlib import import_module
from uuid import uuid4

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import text

from tests.conftest import test_engine


def test_deadline_migration_backfills_started_runs_and_round_trips(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    migration = import_module(
        "app.alembic.versions.e4f5a6b7c8d9_freeze_integration_run_deadlines"
    )
    started_at = datetime(2026, 9, 8, 9, tzinfo=UTC)
    # Connection-local temporary table shadows the real registry. The migration
    # is exercised against PostgreSQL without altering application tables.
    with test_engine.begin() as connection:
        connection.execute(
            text(
                "CREATE TEMPORARY TABLE integration (id integer PRIMARY KEY, current_run_id uuid, current_started_at timestamptz, current_finished_at timestamptz, run_timeout_seconds integer NOT NULL) ON COMMIT DROP"
            )
        )
        connection.execute(
            text(
                "INSERT INTO integration VALUES (:id, :run_id, :started_at, :finished_at, :timeout)"
            ),
            [
                {
                    "id": 1,
                    "run_id": None,
                    "started_at": None,
                    "finished_at": None,
                    "timeout": 1800,
                },
                {
                    "id": 2,
                    "run_id": uuid4(),
                    "started_at": started_at,
                    "finished_at": None,
                    "timeout": 1800,
                },
                {
                    "id": 3,
                    "run_id": uuid4(),
                    "started_at": started_at,
                    "finished_at": started_at + timedelta(minutes=5),
                    "timeout": 3600,
                },
            ],
        )
        monkeypatch.setattr(
            migration, "op", Operations(MigrationContext.configure(connection))
        )
        migration.upgrade()
        rows = (
            connection.execute(
                text("SELECT current_deadline_at FROM integration ORDER BY id")
            )
            .scalars()
            .all()
        )
        assert rows == [
            None,
            started_at + timedelta(minutes=30),
            started_at + timedelta(hours=1),
        ]
        migration.downgrade()
        assert (
            connection.scalar(
                text(
                    "SELECT count(*) FROM pg_attribute WHERE attrelid = 'pg_temp.integration'::regclass AND attname = 'current_deadline_at' AND NOT attisdropped"
                )
            )
            == 0
        )
        assert connection.scalar(text("SELECT count(*) FROM integration")) == 3
