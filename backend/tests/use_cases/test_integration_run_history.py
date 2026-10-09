"""Database regression coverage for integration execution history and retention."""
import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domain.integrations import IntegrationConflictCode, IntegrationResult
from app.domain.system_run import SystemRunStatus, SystemRunStepStatus, SystemRunTrigger
from app.models import Integration, IntegrationRun, SystemRun, SystemRunStep
from app.schemas.integrations import (
    IntegrationRunError,
    IntegrationRunFinish,
    IntegrationRunStart,
)
from app.use_cases import integrations
from app.use_cases.integration_run_maintenance import maintain_run_history
from tests.utils.ledger_domain import create_category_tree


def make_integration(db: Session) -> Integration:
    ledger, _, category = create_category_tree(db)

    db.add(instance)
    db.commit()
    db.refresh(instance)
    return instance


def start(db: Session, item: Integration, run_id: uuid.UUID) -> Integration:
    return integrations.start_run(
        session=db, integration_id=item.id,
        data=IntegrationRunStart(run_id=run_id, expected_revision=item.revision),
    )


def finish(db: Session, item: Integration, run_id: uuid.UUID,
           result: IntegrationResult = IntegrationResult.SUCCESS) -> Integration:
    return integrations.finish_run(
        session=db, integration_id=item.id,
        data=IntegrationRunFinish(
            run_id=run_id, result=result,
            changes_detected=False if result is IntegrationResult.SUCCESS else None,
            error=None if result is IntegrationResult.SUCCESS else IntegrationRunError(
                code="provider_error", message="Provider unavailable"
            ),
        ),
    )


def test_run_history_persists_multiple_runs_and_is_idempotent(db: Session) -> None:
    item = make_integration(db)
    first_id, second_id = uuid.uuid4(), uuid.uuid4()
    start(db, item, first_id)
    first = db.get(IntegrationRun, first_id)
    assert first is not None
    assert first.finished_at is None
    start(db, item, first_id)
    assert (retried := db.get(IntegrationRun, first_id)) is not None
    assert retried.started_at == first.started_at
    finish(db, item, first_id)
    finish(db, item, first_id)
    start(db, item, second_id)
    finish(db, item, second_id, IntegrationResult.FAILURE)
    history, count = integrations.list_run_history(
        session=db, ledger_id=item.ledger_id, integration_id=item.id
    )
    assert count == 2
    assert {run.id for run in history} == {first_id, second_id}
    assert (failed := db.get(IntegrationRun, second_id)) is not None
    assert failed.error_code == "provider_error"


def test_history_is_ledger_isolated_and_paginated(db: Session) -> None:
    first, other = make_integration(db), make_integration(db)
    run_id = uuid.uuid4()
    start(db, first, run_id)
    with pytest.raises(integrations.IntegrationNotFoundError):
        integrations.list_run_history(
            session=db, ledger_id=other.ledger_id, integration_id=first.id
        )
    history, count = integrations.list_run_history(
        session=db,
        ledger_id=first.ledger_id,
        integration_id=first.id,
        limit=1,
        offset=1,
    )
    assert history == []
    assert count == 1
    with pytest.raises(integrations.IntegrationConflictError) as exc:
        start(db, other, run_id)
    assert exc.value.code is IntegrationConflictCode.RUN_CONFLICT
    db.rollback()


def test_timeout_reconciliation_is_repeatable_and_late_finish_is_supported(
    db: Session,
) -> None:
    item = make_integration(db)
    run_id = uuid.uuid4()
    start(db, item, run_id)
    deadline = item.current_deadline_at
    assert deadline is not None
    assert (
        maintain_run_history(db, now=deadline + timedelta(seconds=1))["timed_out"] >= 1
    )
    db.commit()
    assert (
        maintain_run_history(db, now=deadline + timedelta(seconds=2))["timed_out"] == 0
    )
    db.commit()
    assert (timed_out := db.get(IntegrationRun, run_id)) is not None
    assert timed_out.result == "timed_out"
    finish(db, item, run_id)
    assert (completed := db.get(IntegrationRun, run_id)) is not None
    assert completed.result == "success"


def test_retention_keeps_active_runs_and_cascades_system_steps(db: Session) -> None:
    item = make_integration(db)
    now = datetime.now(UTC)
    old = now - timedelta(days=91)
    historical = IntegrationRun(
        id=uuid.uuid4(),
        integration_id=item.id,
        started_at=old,
        deadline_at=old + timedelta(minutes=30),
        finished_at=old + timedelta(minutes=1),
        result="success",
    )
    active = IntegrationRun(
        id=uuid.uuid4(),
        integration_id=item.id,
        started_at=old,
        deadline_at=now + timedelta(hours=1),
    )
    old_system = SystemRun(
        status=SystemRunStatus.SUCCESS,
        trigger=SystemRunTrigger.SCHEDULED,
        effective_at=old,
        timezone="UTC",
        business_date=old.date(),
        started_at=old,
        finished_at=old,
    )
    running_system = SystemRun(
        status=SystemRunStatus.RUNNING,
        trigger=SystemRunTrigger.SCHEDULED,
        effective_at=old,
        timezone="UTC",
        business_date=old.date(),
        started_at=old,
    )
    db.add_all([historical, active, old_system, running_system])
    db.flush()
    step = SystemRunStep(
        system_run_id=old_system.id,
        task_name="test",
        status=SystemRunStepStatus.SUCCEEDED,
        started_at=old,
        finished_at=old,
    )
    db.add(step)
    db.commit()
    summary = maintain_run_history(db, now=now)
    db.commit()
    assert summary["deleted_integration_runs"] >= 1
    assert summary["deleted_system_runs"] >= 1
    assert db.get(IntegrationRun, historical.id) is None
    assert db.get(IntegrationRun, active.id) is not None
    assert db.get(SystemRun, old_system.id) is None
    assert (
        db.scalar(
            select(SystemRunStep).where(SystemRunStep.system_run_id == old_system.id)
        )
        is None
    )
    assert db.get(SystemRun, running_system.id) is not None
