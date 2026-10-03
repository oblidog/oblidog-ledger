# mypy: disable-error-code="import-untyped"

import logging
import uuid
from datetime import UTC, datetime

from findog_legacy_adapter import load_payment_book_from_dropbox

from app.core.business_date import business_today
from app.core.config import settings
from app.core.db import SessionLocal
from app.domain import BillingPeriod, LegacyImportJobStatus, TaskRunMode
from app.models import LegacyImportJob
from app.services.legacy_import import load_legacy_import_config
from app.use_cases import legacy_import as legacy_import_use_cases

logger = logging.getLogger(__name__)


def _update_progress(job_id: uuid.UUID, processed: int, total: int) -> None:
    with SessionLocal() as session:
        job = session.get(LegacyImportJob, job_id)
        if job is None:
            return
        job.processed_obligations = processed
        job.total_obligations = total
        session.commit()
    logger.info("Legacy import job %s: %s/%s obligations", job_id, processed, total)


def run_legacy_import_job(job_id: uuid.UUID) -> None:
    try:
        if settings.LEGACY_IMPORT_MODE is TaskRunMode.DISABLED:
            raise RuntimeError("Legacy import is disabled")
        with SessionLocal() as session:
            job = session.get(LegacyImportJob, job_id)
            if job is None:
                return
            job.status = LegacyImportJobStatus.RUNNING
            job.started_at = datetime.now(UTC)
            session.commit()

        if settings.DROPBOX_API_KEY is None:
            raise RuntimeError("DROPBOX_API_KEY is not configured")
        config = load_legacy_import_config(settings.LEGACY_IMPORT_CONFIG_PATH)
        logger.info("Legacy import job %s: downloading workbook from Dropbox", job_id)
        payment_book = load_payment_book_from_dropbox(
            settings.DROPBOX_API_KEY,
            config.excel_dropbox_path,
            config.monitored_sheets,
            interpret_codes=True,
        )
        logger.info(
            "Legacy import job %s: workbook loaded with %s payments",
            job_id,
            len(payment_book.payment_list),
        )
        today = business_today()
        with SessionLocal() as session:
            job = session.get(LegacyImportJob, job_id)
            if job is None:
                return
            result = legacy_import_use_cases.import_legacy_payment_book(
                session=session,
                ledger_id=job.ledger_id,
                payment_book=payment_book,
                current_period=BillingPeriod(today.year, today.month),
                progress=lambda processed, total: _update_progress(
                    job_id, processed, total
                ),
            )
        logger.info(
            "Legacy import job %s: committed %s obligations",
            job_id,
            result.imported_obligations,
        )
        with SessionLocal() as session:
            job = session.get(LegacyImportJob, job_id)
            if job is None:
                return
            job.status = LegacyImportJobStatus.SUCCEEDED
            job.is_active = False
            job.processed_obligations = result.imported_obligations
            job.total_obligations = result.imported_obligations
            job.created_category_groups = result.created_category_groups
            job.created_categories = result.created_categories
            job.replaced_categories = result.replaced_categories
            job.imported_obligations = result.imported_obligations
            job.finished_at = datetime.now(UTC)
            session.commit()
    except Exception as exc:
        logger.exception("Legacy import job %s failed", job_id)
        with SessionLocal() as session:
            job = session.get(LegacyImportJob, job_id)
            if job is None:
                return
            job.status = LegacyImportJobStatus.FAILED
            job.is_active = False
            job.error = str(exc)
            job.finished_at = datetime.now(UTC)
            session.commit()
