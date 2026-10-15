"""Scheduled timeout reconciliation and history retention."""

from datetime import datetime, timedelta

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.domain.system_run import SystemRunStatus
from app.models import Integration, IntegrationRun, SystemRun

RETENTION_DAYS = 90


def maintain_run_history(session: Session, *, now: datetime) -> dict[str, int]:
    timed_out = 0
    # Lock parent integrations in a stable order, just like start/finish requests.
    # Inspect history rather than the snapshot: a newer run may have replaced
    # current_run_id before maintenance gets a chance to reconcile the old run.
    expired = list(
        session.scalars(
            select(Integration)
            .where(
                select(IntegrationRun.id)
                .where(
                    IntegrationRun.integration_id == Integration.id,
                    IntegrationRun.finished_at.is_(None),
                    IntegrationRun.deadline_at <= now,
                )
                .exists()
            )
            .order_by(Integration.id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
    )
    for integration in expired:
        runs = session.scalars(
            select(IntegrationRun)
            .where(
                IntegrationRun.integration_id == integration.id,
                IntegrationRun.finished_at.is_(None),
                IntegrationRun.deadline_at <= now,
            )
            .execution_options(populate_existing=True)
        )
        for run in runs:
            run.finished_at = run.deadline_at
            run.result = "timed_out"
            run.error_code = "run_timeout"
            run.error_message = "Integration run exceeded its deadline"
            timed_out += 1
        # Keep the existing dynamic timed_out health until a newer run starts.
    cutoff = now - timedelta(days=RETENTION_DAYS)
    integrations_result = session.execute(
        delete(IntegrationRun).where(
            IntegrationRun.started_at < cutoff,
            IntegrationRun.finished_at.is_not(None),
        )
    )
    deleted_integrations = int(getattr(integrations_result, "rowcount", 0) or 0)
    system_runs_result = session.execute(
        delete(SystemRun).where(
            SystemRun.started_at < cutoff,
            SystemRun.status != SystemRunStatus.RUNNING,
        )
    )
    deleted_system_runs = int(getattr(system_runs_result, "rowcount", 0) or 0)
    return {
        "timed_out": timed_out,
        "deleted_integration_runs": deleted_integrations,
        "deleted_system_runs": deleted_system_runs,
    }
