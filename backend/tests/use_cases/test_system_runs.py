from __future__ import annotations

from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import cast
from zoneinfo import ZoneInfo

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.domain import TaskRunMode
from app.domain.system_run import (
    SystemRunSkipReason,
    SystemRunStatus,
    SystemRunStepStatus,
    SystemRunTrigger,
)
from app.models import Ledger, Obligation, SystemRun, SystemRunStep
from app.services.system_run_runner import (
    SYSTEM_RUN_ADVISORY_LOCK_KEY,
    exit_code,
    run_scheduled_system_run,
)
from app.use_cases import ledgers as ledger_use_cases
from app.use_cases.system_runs import (
    EnsureObligationsTask,
    SystemRunContext,
    SystemRunOrchestrator,
    SystemRunTask,
    TaskResult,
)
from tests.conftest import TestingSessionLocal
from tests.utils.ledger_domain import create_category_with_recurrence
from tests.utils.user import create_random_user


class FakeTask:
    def __init__(
        self,
        name: str,
        order: int,
        ledgers: list[Ledger],
        *,
        mode: TaskRunMode = TaskRunMode.SCHEDULED,
        dependencies: tuple[str, ...] = (),
        skip_reason: SystemRunSkipReason | None = None,
        failing_ledger_ids: set[object] | None = None,
    ) -> None:
        self.name = name
        self.order = order
        self.mode = mode
        self.dependencies = dependencies
        self.ledgers = ledgers
        self.skip_reason = skip_reason
        self.failing_ledger_ids = failing_ledger_ids or set()
        self.calls: list[object] = []

    def should_run(self, context: SystemRunContext) -> SystemRunSkipReason | None:
        return self.skip_reason

    def eligible_ledgers(
        self, *, session: Session, context: SystemRunContext
    ) -> list[Ledger]:
        return self.ledgers

    def execute(
        self, *, session: Session, ledger: Ledger | None, context: SystemRunContext
    ) -> TaskResult:
        assert ledger is not None
        self.calls.append(ledger.id)
        if ledger.id in self.failing_ledger_ids:
            raise RuntimeError(f"failed {ledger.id}")
        return TaskResult({"ledger": str(ledger.id)})


def _ledger(db: Session, name: str) -> Ledger:
    user = create_random_user(db)
    return ledger_use_cases.create_ledger(session=db, owner_user_id=user.id, name=name)


def _context() -> SystemRunContext:
    return SystemRunContext.create(
        effective_at=datetime(2026, 9, 1, 0, 30, tzinfo=ZoneInfo("Europe/Warsaw")),
        timezone=ZoneInfo("Europe/Warsaw"),
        trigger=SystemRunTrigger.SCHEDULED,
    )


def _steps(db: Session, run_id: object) -> list[SystemRunStep]:
    return list(
        db.scalars(select(SystemRunStep).where(SystemRunStep.system_run_id == run_id))
    )


def test_failure_blocks_dependents_transitively_but_not_independent_ledgers(
    db: Session,
) -> None:
    first, second = _ledger(db, "First"), _ledger(db, "Second")
    first_task = FakeTask("first", 100, [first, second], failing_ledger_ids={first.id})
    second_task = FakeTask("second", 200, [first, second], dependencies=("first",))
    third_task = FakeTask("third", 300, [first, second], dependencies=("second",))
    independent = FakeTask("independent", 400, [first, second])

    run = SystemRunOrchestrator((third_task, independent, second_task, first_task)).run(
        session=db, context=_context()
    )

    assert run.status is SystemRunStatus.PARTIAL_FAILURE
    assert second_task.calls == [second.id]
    assert third_task.calls == [second.id]
    assert independent.calls == [first.id, second.id]
    blocked = [
        step
        for step in _steps(db, run.id)
        if step.ledger_id == first.id and step.task_name in {"second", "third"}
    ]
    assert {step.skip_reason for step in blocked} == {
        SystemRunSkipReason.PREREQUISITE_FAILED
    }


def test_context_is_persisted_and_uses_business_date(db: Session) -> None:
    ledger, _, _ = create_category_with_recurrence(db)
    context = _context()

    orchestrator = SystemRunOrchestrator(
        (cast(SystemRunTask, EnsureObligationsTask()),)
    )
    run = orchestrator.run(session=db, context=context)
    orchestrator.run(session=db, context=context)

    assert run.business_date.isoformat() == "2026-09-01"
    assert run.timezone == "Europe/Warsaw"
    assert run.trigger is SystemRunTrigger.SCHEDULED
    assert (
        len(
            list(
                db.scalars(
                    select(Obligation).where(
                        Obligation.ledger_id == ledger.id,
                        Obligation.period_year == 2026,
                        Obligation.period_month == 9,
                    )
                )
            )
        )
        == 1
    )


def test_task_eligibility_is_scoped_and_records_results(db: Session) -> None:
    eligible, excluded = _ledger(db, "Eligible"), _ledger(db, "Excluded")
    task = FakeTask("scoped", 100, [eligible])

    run = SystemRunOrchestrator((task,)).run(session=db, context=_context())

    assert task.calls == [eligible.id]
    step = _steps(db, run.id)[0]
    assert step.ledger_id == eligible.id
    assert step.summary == {"ledger": str(eligible.id)}
    assert excluded.id not in task.calls


def test_modes_and_no_targets_are_persisted(db: Session) -> None:
    disabled = FakeTask("disabled", 100, [], mode=TaskRunMode.DISABLED)
    manual = FakeTask("manual", 200, [], mode=TaskRunMode.MANUAL_ONLY)
    not_due = FakeTask("not-due", 300, [], skip_reason=SystemRunSkipReason.NOT_DUE)
    no_targets = FakeTask("none", 400, [])

    run = SystemRunOrchestrator((no_targets, manual, disabled, not_due)).run(
        session=db, context=_context()
    )

    assert {(step.task_name, step.skip_reason) for step in _steps(db, run.id)} == {
        ("disabled", SystemRunSkipReason.DISABLED),
        ("manual", SystemRunSkipReason.MANUAL_ONLY),
        ("not-due", SystemRunSkipReason.NOT_DUE),
        ("none", SystemRunSkipReason.NO_ELIGIBLE_TARGETS),
    }


def test_manual_only_task_requires_explicit_selection(db: Session) -> None:
    ledger = _ledger(db, "Manual")
    task = FakeTask("manual", 100, [ledger], mode=TaskRunMode.MANUAL_ONLY)
    orchestrator = SystemRunOrchestrator((task,))

    implicit = orchestrator.run(session=db, context=_context())
    explicit = orchestrator.run(
        session=db,
        context=SystemRunContext.create(trigger=SystemRunTrigger.MANUAL),
        task_names=("manual",),
    )

    assert _steps(db, implicit.id)[0].skip_reason is SystemRunSkipReason.MANUAL_ONLY
    assert task.calls == [ledger.id]
    assert _steps(db, explicit.id)[0].status is SystemRunStepStatus.SUCCEEDED


def test_scheduled_runner_uses_explicit_context_and_returns_success(
    db: Session,
) -> None:
    ledger = _ledger(db, "Runner")
    task = FakeTask("runner", 100, [ledger])
    effective_at = datetime(2026, 9, 1, 22, 30, tzinfo=UTC)

    run = run_scheduled_system_run(
        session=db,
        effective_at=effective_at,
        timezone=ZoneInfo("Europe/Warsaw"),
        orchestrator=SystemRunOrchestrator((task,)),
    )

    assert run is not None
    assert run.trigger is SystemRunTrigger.SCHEDULED
    assert run.effective_at == effective_at
    assert run.business_date.isoformat() == "2026-09-02"
    assert run.timezone == "Europe/Warsaw"
    assert exit_code(run) == 0


def test_scheduled_runner_rejects_an_overlapping_database_lock(db: Session) -> None:
    with TestingSessionLocal() as locked_session:
        assert locked_session.scalar(
            select(func.pg_try_advisory_lock(SYSTEM_RUN_ADVISORY_LOCK_KEY))
        )
        try:
            assert run_scheduled_system_run(session=db) is None
            assert exit_code(None) == 2
        finally:
            locked_session.execute(
                select(func.pg_advisory_unlock(SYSTEM_RUN_ADVISORY_LOCK_KEY))
            )
            locked_session.commit()


def test_stale_run_recovers_after_the_lock_owner_connection_is_terminated(
    db: Session,
) -> None:
    now = datetime(2026, 9, 2, tzinfo=UTC)
    stale = SystemRun(
        status=SystemRunStatus.RUNNING,
        trigger=SystemRunTrigger.SCHEDULED,
        effective_at=now - timedelta(hours=3),
        timezone="UTC",
        business_date=(now - timedelta(hours=3)).date(),
        started_at=now - timedelta(hours=3),
    )
    db.add(stale)
    db.commit()

    with TestingSessionLocal() as locked_session:
        assert locked_session.scalar(
            select(func.pg_try_advisory_lock(SYSTEM_RUN_ADVISORY_LOCK_KEY))
        )
        assert run_scheduled_system_run(session=db) is None
        locked_session.invalidate()

    resumed = run_scheduled_system_run(
        session=db,
        effective_at=now,
        orchestrator=SystemRunOrchestrator((FakeTask("resume", 100, []),)),
    )
    db.refresh(stale)

    assert resumed is not None
    assert stale.status is SystemRunStatus.FAILURE
    assert stale.error == "System run exceeded the stale-run timeout"


def test_scheduler_one_shot_enforces_the_configured_timeout() -> None:
    script = (
        Path(__file__).resolve().parents[2] / "scripts" / "system-run-once.sh"
    ).read_text()

    assert "SYSTEM_RUN_TIMEOUT_SECONDS" in script
    assert "cd /app/backend" in script
    assert "timeout --signal=TERM --kill-after=30s" in script


def test_scheduled_runner_recovers_stale_runs_and_returns_failure_exit_code(
    db: Session,
) -> None:
    now = datetime(2026, 9, 2, tzinfo=UTC)
    stale = SystemRun(
        status=SystemRunStatus.RUNNING,
        trigger=SystemRunTrigger.SCHEDULED,
        effective_at=now - timedelta(hours=3),
        timezone="UTC",
        business_date=(now - timedelta(hours=3)).date(),
        started_at=now - timedelta(hours=3),
    )
    db.add(stale)
    db.commit()

    failed_task = FakeTask("failed", 100, [_ledger(db, "Failure")])
    failed_task.failing_ledger_ids = {failed_task.ledgers[0].id}
    run = run_scheduled_system_run(
        session=db,
        effective_at=now,
        orchestrator=SystemRunOrchestrator((failed_task,)),
    )
    db.refresh(stale)

    assert stale.status is SystemRunStatus.FAILURE
    assert stale.error == "System run exceeded the stale-run timeout"
    assert run is not None
    assert run.status is SystemRunStatus.FAILURE
    assert exit_code(run) == 1
    run.status = SystemRunStatus.PARTIAL_FAILURE
    assert exit_code(run) == 1
