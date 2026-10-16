from typing import Any

from fastapi import APIRouter, BackgroundTasks, Depends, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.api.deps import SessionDep, require_ledger_owner_access
from app.core.api_errors import ApplicationError as HTTPException
from app.core.config import settings
from app.domain import LegacyImportJobStatus, TaskRunMode
from app.models import Ledger, LegacyImportJob
from app.schemas.legacy_import import LegacyImportJobPublic
from app.services.legacy_import_jobs import run_legacy_import_job

router = APIRouter(tags=["legacy-import"])


@router.post(
    "/ledgers/{ledger_id}/legacy-import",
    response_model=LegacyImportJobPublic,
    status_code=status.HTTP_202_ACCEPTED,
)
def start_legacy_import(
    *,
    session: SessionDep,
    background_tasks: BackgroundTasks,
    ledger: Ledger = Depends(require_ledger_owner_access),
) -> Any:
    if settings.LEGACY_IMPORT_MODE is TaskRunMode.DISABLED:
        raise HTTPException(
            code="legacy_import_disabled",
            status_code=409,
            detail="Legacy import is disabled",
        )
    job = LegacyImportJob(
        ledger_id=ledger.id,
        status=LegacyImportJobStatus.PENDING,
        is_active=True,
        processed_obligations=0,
        total_obligations=0,
    )
    try:
        session.add(job)
        session.commit()
    except IntegrityError as exc:
        session.rollback()
        raise HTTPException(
            code="legacy_import_running",
            status_code=409,
            detail="A legacy import is already active",
        ) from exc
    session.refresh(job)
    background_tasks.add_task(run_legacy_import_job, job.id)
    return LegacyImportJobPublic.model_validate(job)


@router.get(
    "/ledgers/{ledger_id}/legacy-import",
    response_model=LegacyImportJobPublic,
)
def read_legacy_import_job(
    *,
    session: SessionDep,
    ledger: Ledger = Depends(require_ledger_owner_access),
) -> Any:
    job = session.scalar(
        select(LegacyImportJob)
        .where(LegacyImportJob.ledger_id == ledger.id)
        .order_by(LegacyImportJob.created_at.desc())
    )
    if job is None:
        raise HTTPException(
            code="legacy_import_not_found",
            status_code=404,
            detail="Legacy import job not found",
        )
    return LegacyImportJobPublic.model_validate(job)
