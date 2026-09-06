"""HTTP- and scheduler-independent orchestration for system work."""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from dataclasses import asdict, dataclass
from datetime import UTC, date, datetime
from typing import Protocol, cast
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.domain import BillingPeriod, TaskRunMode
from app.domain.system_run import (
    SystemRunSkipReason,
    SystemRunStatus,
    SystemRunStepStatus,
    SystemRunTrigger,
)
from app.models import Ledger, SystemRun, SystemRunStep
from app.services.daily_obligation_report import DailyObligationReport
from app.services.legacy_import import load_legacy_import_config
from app.services.scheduled_reports import ScheduledReport, deliver_scheduled_report
from app.services.weekly_monthly_overview_report import WeeklyMonthlyOverviewReport
from app.use_cases import legacy_import as legacy_import_use_cases
from app.use_cases import obligations as obligation_use_cases


@dataclass(frozen=True, slots=True)
class SystemRunContext:
    effective_at: datetime
    timezone: ZoneInfo
    business_date: date
    trigger: SystemRunTrigger

    @classmethod
    def create(
        cls,
        *,
        effective_at: datetime | None = None,
        timezone: ZoneInfo = ZoneInfo("UTC"),
        trigger: SystemRunTrigger = SystemRunTrigger.SCHEDULED,
    ) -> SystemRunContext:
        value = effective_at or datetime.now(timezone)
        if value.tzinfo is None:
            raise ValueError("effective_at must be timezone-aware")
        localized = value.astimezone(timezone)
        return cls(localized, timezone, localized.date(), trigger)


@dataclass(frozen=True, slots=True)
class TaskResult:
    summary: dict[str, object]


class SystemRunTask(Protocol):
    name: str
    order: int
    mode: TaskRunMode
    dependencies: tuple[str, ...]

    def should_run(self, context: SystemRunContext) -> SystemRunSkipReason | None: ...

    def eligible_ledgers(
        self, *, session: Session, context: SystemRunContext
    ) -> Sequence[Ledger]: ...

    def execute(
        self, *, session: Session, ledger: Ledger | None, context: SystemRunContext
    ) -> TaskResult: ...


class EnsureObligationsTask:
    name = "ensure_obligations"
    order = 200
    mode = TaskRunMode.SCHEDULED
    dependencies: tuple[str, ...] = ()
    is_global = False

    def should_run(self, context: SystemRunContext) -> SystemRunSkipReason | None:
        return None

    def eligible_ledgers(
        self, *, session: Session, context: SystemRunContext
    ) -> Sequence[Ledger]:
        return list(
            session.scalars(
                select(Ledger).where(Ledger.is_active).order_by(Ledger.id)
            ).all()
        )

    def execute(
        self, *, session: Session, ledger: Ledger, context: SystemRunContext
    ) -> TaskResult:
        created = obligation_use_cases.ensure_obligations_for_period(
            session=session,
            ledger_id=ledger.id,
            period=BillingPeriod.from_date(context.business_date),
        )
        return TaskResult({"created_obligations": len(created)})


class EstimateObligationAmountsTask(EnsureObligationsTask):
    name = "estimate_obligation_amounts"
    order = 250
    dependencies = ("ensure_obligations",)

    def execute(
        self, *, session: Session, ledger: Ledger, context: SystemRunContext
    ) -> TaskResult:
        updated = obligation_use_cases.estimate_missing_obligation_amounts(
            session=session,
            ledger_id=ledger.id,
            period=BillingPeriod.from_date(context.business_date),
        )
        return TaskResult({"estimated_obligations": len(updated)})


class LegacyImportTask:
    name = "legacy_import"
    order = 100
    dependencies: tuple[str, ...] = ()
    is_global = False

    @property
    def mode(self) -> TaskRunMode:
        return settings.LEGACY_IMPORT_MODE

    def should_run(self, context: SystemRunContext) -> SystemRunSkipReason | None:
        if (
            not settings.DROPBOX_API_KEY
            or not settings.LEGACY_IMPORT_CONFIG_PATH.is_file()
        ):
            return SystemRunSkipReason.NOT_CONFIGURED
        if settings.LEGACY_IMPORT_LEDGER_ID is None:
            return SystemRunSkipReason.NOT_CONFIGURED
        return None

    def eligible_ledgers(
        self, *, session: Session, context: SystemRunContext
    ) -> Sequence[Ledger]:
        ledger = session.get(Ledger, settings.LEGACY_IMPORT_LEDGER_ID)
        return [ledger] if ledger is not None and ledger.is_active else []

    def execute(
        self, *, session: Session, ledger: Ledger, context: SystemRunContext
    ) -> TaskResult:
        from findog_legacy_adapter import (  # type: ignore[import-untyped]
            load_payment_book_from_dropbox,
        )

        config = load_legacy_import_config(settings.LEGACY_IMPORT_CONFIG_PATH)
        payment_book = load_payment_book_from_dropbox(
            settings.DROPBOX_API_KEY,
            config.excel_dropbox_path,
            config.monitored_sheets,
            interpret_codes=True,
        )
        result = legacy_import_use_cases.import_legacy_payment_book(
            session=session,
            ledger_id=ledger.id,
            payment_book=payment_book,
            current_period=BillingPeriod.from_date(context.business_date),
        )
        return TaskResult(asdict(result))


class ScheduledReportsTask:
    name = "scheduled_reports"
    order = 300
    mode = TaskRunMode.SCHEDULED
    dependencies = ("ensure_obligations",)
    is_global = True

    def __init__(self, reports: Sequence[ScheduledReport] = ()) -> None:
        self.reports = reports

    def should_run(self, context: SystemRunContext) -> SystemRunSkipReason | None:
        if not self.reports or not settings.emails_enabled:
            return SystemRunSkipReason.NOT_CONFIGURED
        return None

    def eligible_ledgers(
        self, *, session: Session, context: SystemRunContext
    ) -> Sequence[Ledger]:
        return []

    def execute(
        self, *, session: Session, ledger: Ledger | None, context: SystemRunContext
    ) -> TaskResult:
        sent = skipped = failed = 0
        for report in self.reports:
            summary = deliver_scheduled_report(
                session=session, report=report, context=context
            )
            sent += summary.sent
            skipped += summary.skipped
            failed += summary.failed
        if failed:
            raise RuntimeError(f"{failed} scheduled report deliveries failed")
        return TaskResult({"sent": sent, "skipped": skipped, "failed": failed})


SYSTEM_RUN_TASK_REGISTRY: tuple[SystemRunTask, ...] = (
    cast(SystemRunTask, LegacyImportTask()),
    cast(SystemRunTask, EnsureObligationsTask()),
    cast(SystemRunTask, EstimateObligationAmountsTask()),
    cast(
        SystemRunTask,
        ScheduledReportsTask((DailyObligationReport(), WeeklyMonthlyOverviewReport())),
    ),
)


class SystemRunOrchestrator:
    def __init__(
        self, tasks: Sequence[SystemRunTask] = SYSTEM_RUN_TASK_REGISTRY
    ) -> None:
        self.tasks = _ordered_tasks(tasks)

    def run(
        self,
        *,
        session: Session,
        context: SystemRunContext | None = None,
        task_names: Iterable[str] | None = None,
    ) -> SystemRun:
        execution = context or SystemRunContext.create()
        requested = set(task_names) if task_names is not None else None
        known = {task.name for task in self.tasks}
        if requested is not None and (unknown := requested - known):
            raise ValueError(f"Unknown system-run tasks: {', '.join(sorted(unknown))}")

        system_run = SystemRun(
            status=SystemRunStatus.RUNNING,
            trigger=execution.trigger,
            effective_at=execution.effective_at,
            timezone=execution.timezone.key,
            business_date=execution.business_date,
            started_at=datetime.now(UTC),
        )
        session.add(system_run)
        session.commit()
        session.refresh(system_run)
        blocked_targets: set[tuple[str, object | None]] = set()
        try:
            self._run_tasks(session, system_run, execution, requested, blocked_targets)
        except Exception as exc:
            session.rollback()
            self._finalize_unexpected_failure(session, system_run.id, exc)
            return session.get(SystemRun, system_run.id) or system_run
        return self._finalize(session, system_run.id)

    def _run_tasks(
        self,
        session: Session,
        system_run: SystemRun,
        context: SystemRunContext,
        requested: set[str] | None,
        blocked_targets: set[tuple[str, object | None]],
    ) -> None:
        for task in self.tasks:
            if requested is not None and task.name not in requested:
                continue
            if requested is None and task.mode is not TaskRunMode.SCHEDULED:
                self._skip_task(session, system_run, task.name, _mode_reason(task.mode))
                continue
            if task.mode is TaskRunMode.DISABLED:
                self._skip_task(
                    session, system_run, task.name, SystemRunSkipReason.DISABLED
                )
                continue
            try:
                reason = task.should_run(context)
            except Exception as exc:
                self._fail_task(session, system_run, task.name, exc)
                blocked_targets.add((task.name, None))
                continue
            if reason is not None:
                self._skip_task(session, system_run, task.name, reason)
                continue
            if getattr(task, "is_global", False):
                if any(name in task.dependencies for name, _ in blocked_targets):
                    blocked_targets.add((task.name, None))
                    self._add_step(
                        session,
                        system_run,
                        task.name,
                        None,
                        SystemRunStepStatus.SKIPPED,
                        skip_reason=SystemRunSkipReason.PREREQUISITE_FAILED,
                    )
                    continue
                started_at = datetime.now(UTC)
                try:
                    result = task.execute(session=session, ledger=None, context=context)
                except Exception as exc:
                    session.rollback()
                    blocked_targets.add((task.name, None))
                    self._add_step(
                        session,
                        system_run,
                        task.name,
                        None,
                        SystemRunStepStatus.FAILED,
                        started_at=started_at,
                        error=_safe_error(exc),
                    )
                else:
                    self._add_step(
                        session,
                        system_run,
                        task.name,
                        None,
                        SystemRunStepStatus.SUCCEEDED,
                        started_at=started_at,
                        summary=result.summary,
                    )
                continue
            try:
                ledgers = task.eligible_ledgers(session=session, context=context)
            except Exception as exc:
                self._fail_task(session, system_run, task.name, exc)
                blocked_targets.add((task.name, None))
                continue
            if not ledgers:
                self._skip_task(
                    session,
                    system_run,
                    task.name,
                    SystemRunSkipReason.NO_ELIGIBLE_TARGETS,
                )
                continue
            for ledger in ledgers:
                if any(
                    (dependency, None) in blocked_targets
                    or (dependency, ledger.id) in blocked_targets
                    for dependency in task.dependencies
                ):
                    blocked_targets.add((task.name, ledger.id))
                    self._add_step(
                        session,
                        system_run,
                        task.name,
                        ledger.id,
                        SystemRunStepStatus.SKIPPED,
                        skip_reason=SystemRunSkipReason.PREREQUISITE_FAILED,
                    )
                    continue
                started_at = datetime.now(UTC)
                try:
                    result = task.execute(
                        session=session, ledger=ledger, context=context
                    )
                except Exception as exc:
                    session.rollback()
                    blocked_targets.add((task.name, ledger.id))
                    self._add_step(
                        session,
                        system_run,
                        task.name,
                        ledger.id,
                        SystemRunStepStatus.FAILED,
                        started_at=started_at,
                        error=_safe_error(exc),
                    )
                else:
                    self._add_step(
                        session,
                        system_run,
                        task.name,
                        ledger.id,
                        SystemRunStepStatus.SUCCEEDED,
                        started_at=started_at,
                        summary=result.summary,
                    )

    def _fail_task(
        self, session: Session, system_run: SystemRun, task_name: str, exc: Exception
    ) -> None:
        self._add_step(
            session,
            system_run,
            task_name,
            None,
            SystemRunStepStatus.FAILED,
            error=_safe_error(exc),
        )

    def _skip_task(
        self,
        session: Session,
        system_run: SystemRun,
        task_name: str,
        reason: SystemRunSkipReason,
    ) -> None:
        self._add_step(
            session,
            system_run,
            task_name,
            None,
            SystemRunStepStatus.SKIPPED,
            skip_reason=reason,
        )

    @staticmethod
    def _add_step(
        session: Session,
        system_run: SystemRun,
        task_name: str,
        ledger_id: object | None,
        status: SystemRunStepStatus,
        *,
        started_at: datetime | None = None,
        skip_reason: SystemRunSkipReason | None = None,
        error: str | None = None,
        summary: dict[str, object] | None = None,
    ) -> None:
        session.add(
            SystemRunStep(
                system_run_id=system_run.id,
                task_name=task_name,
                ledger_id=ledger_id,
                status=status,
                skip_reason=skip_reason,
                error=error,
                summary=summary,
                started_at=started_at or datetime.now(UTC),
                finished_at=datetime.now(UTC),
            )
        )
        session.commit()

    @staticmethod
    def _finalize(session: Session, system_run_id: object) -> SystemRun:
        system_run = session.get(SystemRun, system_run_id)
        if system_run is None:
            raise RuntimeError("System run disappeared before finalization")
        steps = list(
            session.scalars(
                select(SystemRunStep).where(
                    SystemRunStep.system_run_id == system_run.id
                )
            )
        )
        failed = sum(step.status is SystemRunStepStatus.FAILED for step in steps)
        succeeded = sum(step.status is SystemRunStepStatus.SUCCEEDED for step in steps)
        system_run.status = (
            SystemRunStatus.PARTIAL_FAILURE
            if failed and succeeded
            else SystemRunStatus.FAILURE
            if failed
            else SystemRunStatus.SUCCESS
        )
        system_run.summary = {
            "succeeded_steps": succeeded,
            "failed_steps": failed,
            "skipped_steps": sum(
                step.status is SystemRunStepStatus.SKIPPED for step in steps
            ),
        }
        system_run.finished_at = datetime.now(UTC)
        session.commit()
        session.refresh(system_run)
        return system_run

    @staticmethod
    def _finalize_unexpected_failure(
        session: Session, system_run_id: object, exc: Exception
    ) -> None:
        system_run = session.get(SystemRun, system_run_id)
        if system_run is None:
            return
        system_run.status = SystemRunStatus.FAILURE
        system_run.error = _safe_error(exc)
        system_run.finished_at = datetime.now(UTC)
        session.commit()


def _safe_error(exc: Exception) -> str:
    message = " ".join(str(exc).split())
    if settings.DROPBOX_API_KEY:
        message = message.replace(settings.DROPBOX_API_KEY, "[redacted]")
    return message[:1000] or exc.__class__.__name__


def _mode_reason(mode: TaskRunMode) -> SystemRunSkipReason:
    return (
        SystemRunSkipReason.DISABLED
        if mode is TaskRunMode.DISABLED
        else SystemRunSkipReason.MANUAL_ONLY
    )


def _ordered_tasks(tasks: Sequence[SystemRunTask]) -> tuple[SystemRunTask, ...]:
    names = [task.name for task in tasks]
    if len(set(names)) != len(names):
        raise ValueError("System-run task names must be unique")
    if len({task.order for task in tasks}) != len(tasks):
        raise ValueError("System-run task order values must be unique")
    by_name = {task.name: task for task in tasks}
    for task in tasks:
        for dependency in task.dependencies:
            prerequisite = by_name.get(dependency)
            if prerequisite is None:
                raise ValueError(f"Unknown system-run task dependency: {dependency}")
            if prerequisite.order >= task.order:
                raise ValueError("Task dependencies must precede their dependent task")
    return tuple(sorted(tasks, key=lambda task: task.order))
