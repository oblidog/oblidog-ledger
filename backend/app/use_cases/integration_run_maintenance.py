"""Scheduled timeout reconciliation and history retention."""
from datetime import datetime, timedelta

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.models import Integration, IntegrationRun, SystemRun
from app.domain.system_run import SystemRunStatus

RETENTION_DAYS = 90


def maintain_run_history(session: Session, *, now: datetime) -> dict[str, int]:
    timed_out = 0
    # Lock each integration to serialize reconciliation with start/finish requests.
    expired = list(session.scalars(
        select(Integration)
        .where(Integration.current_run_id.is_not(None),
               Integration.current_finished_at.is_(None),
               Integration.current_deadline_at <= now)
        .with_for_update()
    ))
    for integration in expired:
        run = session.get(IntegrationRun, integration.current_run_id)
        if run is not None and run.finished_at is None:
            run.finished_at = integration.current_deadline_at
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
    deleted_integrations = int(getattr(integrations_result, 'rowcount', 0) or 0)
    system_runs_result = session.execute(
        delete(SystemRun).where(
            SystemRun.started_at < cutoff,
            SystemRun.status != SystemRunStatus.RUNNING,
        )
    )
    deleted_system_runs = int(getattr(system_runs_result, 'rowcount', 0) or 0)
    return {
        "timed_out": timed_out,
        "deleted_integration_runs": deleted_integrations,
        "deleted_system_runs": deleted_system_runs,
    }
