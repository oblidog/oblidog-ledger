import uuid
from datetime import datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.domain.integrations import (
    IntegrationConflictCode,
    IntegrationExecutionState,
    IntegrationHealth,
    IntegrationResult,
)
from app.models import Category, Integration, IntegrationCredential
from app.models.base import get_datetime_utc
from app.schemas.integrations import (
    IntegrationCreate,
    IntegrationPublic,
    IntegrationRunFinish,
    IntegrationRunStart,
    IntegrationUpdate,
)
from app.services import api_keys as credential_service


class IntegrationNotFoundError(Exception):
    pass


class IntegrationCategoryNotFoundError(Exception):
    pass


class IntegrationConflictError(Exception):
    def __init__(self, code: IntegrationConflictCode) -> None:
        self.code = code
        super().__init__(code)


class IntegrationLimitsError(Exception):
    pass


def execution_state(item: Integration, now: datetime) -> IntegrationExecutionState:
    if item.current_run_id is None:
        return IntegrationExecutionState.NEVER_RUN
    if item.current_finished_at is not None:
        return IntegrationExecutionState.FINISHED
    assert item.current_deadline_at is not None
    if now >= item.current_deadline_at:
        return IntegrationExecutionState.TIMED_OUT
    return IntegrationExecutionState.RUNNING


def to_public(item: Integration, *, now: datetime | None = None) -> IntegrationPublic:
    now = now or get_datetime_utc()
    state = execution_state(item, now)
    is_stale = False
    if item.enabled:
        assert item.enabled_at is not None
        reference = max(item.enabled_at, item.last_finished_at or item.enabled_at)
        is_stale = now >= reference + timedelta(seconds=item.stale_after_seconds)
    if not item.enabled:
        health = IntegrationHealth.DISABLED
    elif state == IntegrationExecutionState.TIMED_OUT:
        health = IntegrationHealth.TIMED_OUT
    elif is_stale:
        health = IntegrationHealth.STALE
    elif state == IntegrationExecutionState.RUNNING:
        health = IntegrationHealth.RUNNING
    elif state == IntegrationExecutionState.NEVER_RUN:
        health = IntegrationHealth.NEVER_RUN
    elif item.last_result == IntegrationResult.FAILURE:
        health = IntegrationHealth.ERROR
    else:
        health = IntegrationHealth.HEALTHY
    derived = {"execution_state": state, "is_stale": is_stale, "health": health}
    return IntegrationPublic.model_validate(
        {
            **{
                field: getattr(item, field)
                for field in IntegrationPublic.model_fields
                if field not in derived
            },
            **derived,
        }
    )


def get_integration(
    *,
    session: Session,
    ledger_id: uuid.UUID,
    integration_id: uuid.UUID | None = None,
    lock: bool = False,
) -> Integration:
    if integration_id is None:
        raise ValueError("Supply an integration identity")
    statement = select(Integration).where(Integration.ledger_id == ledger_id)
    statement = statement.where(Integration.id == integration_id)
    if lock:
        statement = statement.with_for_update().execution_options(
            populate_existing=True
        )
    item = session.scalar(statement)
    if item is None:
        raise IntegrationNotFoundError
    return item


def list_integrations(
    *, session: Session, ledger_id: uuid.UUID, limit: int = 100, offset: int = 0
) -> tuple[list[Integration], int]:
    items = list(
        session.scalars(
            select(Integration)
            .where(Integration.ledger_id == ledger_id)
            .order_by(Integration.name, Integration.id)
            .limit(limit)
            .offset(offset)
        )
    )
    count = (
        session.scalar(
            select(func.count())
            .select_from(Integration)
            .where(Integration.ledger_id == ledger_id)
        )
        or 0
    )
    return items, count


def create_integration(
    *,
    session: Session,
    ledger_id: uuid.UUID,
    created_by_user_id: uuid.UUID,
    data: IntegrationCreate,
) -> tuple[Integration, IntegrationCredential, str]:
    category = session.scalar(
        select(Category.id).where(
            Category.id == data.category_id, Category.ledger_id == ledger_id
        )
    )
    if category is None:
        raise IntegrationCategoryNotFoundError
    now = get_datetime_utc()
    item = Integration(
        ledger_id=ledger_id,
        **data.model_dump(),
        created_at=now,
        updated_at=now,
        enabled_at=now,
    )
    raw_key = credential_service.generate_api_key()
    credential = IntegrationCredential(
        created_by_user_id=created_by_user_id,
        key_hash=credential_service.hash_api_key(raw_key),
        key_prefix=credential_service.key_prefix(raw_key),
    )
    item.credentials.append(credential)
    session.add(item)
    try:
        session.commit()
    except IntegrityError:
        session.rollback()
        raise
    session.refresh(item)
    session.refresh(credential)
    return item, credential, raw_key


def update_integration(
    *,
    session: Session,
    ledger_id: uuid.UUID,
    integration_id: uuid.UUID,
    data: IntegrationUpdate,
) -> Integration:
    item = get_integration(
        session=session, ledger_id=ledger_id, integration_id=integration_id, lock=True
    )
    if item.revision != data.expected_revision:
        raise IntegrationConflictError(IntegrationConflictCode.REVISION_CONFLICT)
    now = get_datetime_utc()
    changes = data.model_dump(exclude_unset=True, exclude={"expected_revision"})
    if {"stale_after_seconds", "run_timeout_seconds"} & changes.keys():
        if execution_state(item, now) == IntegrationExecutionState.RUNNING:
            raise IntegrationConflictError(IntegrationConflictCode.RUN_IN_PROGRESS)
    stale = (
        data.stale_after_seconds
        if data.stale_after_seconds is not None
        else item.stale_after_seconds
    )
    timeout = (
        data.run_timeout_seconds
        if data.run_timeout_seconds is not None
        else item.run_timeout_seconds
    )
    if timeout >= stale:
        raise IntegrationLimitsError
    if data.enabled is True and not item.enabled:
        item.enabled_at = now
    for field, value in changes.items():
        setattr(item, field, value)
    item.updated_at = now
    item.revision += 1
    session.commit()
    session.refresh(item)
    return item


def start_run(
    *, session: Session, integration_id: uuid.UUID, data: IntegrationRunStart
) -> Integration:
    item = session.scalar(
        select(Integration)
        .where(Integration.id == integration_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if item is None:
        raise IntegrationNotFoundError
    if item.current_run_id == data.run_id:
        session.commit()  # Release the lock; retries never move timestamps.
        return item
    if not item.enabled:
        raise IntegrationConflictError(IntegrationConflictCode.INTEGRATION_DISABLED)
    if item.revision != data.expected_revision:
        raise IntegrationConflictError(IntegrationConflictCode.REVISION_CONFLICT)
    now = get_datetime_utc()
    if execution_state(item, now) == IntegrationExecutionState.RUNNING:
        raise IntegrationConflictError(IntegrationConflictCode.RUN_IN_PROGRESS)
    item.current_run_id = data.run_id
    item.current_started_at = now
    item.current_deadline_at = now + timedelta(seconds=item.run_timeout_seconds)
    item.current_finished_at = None
    item.updated_at = now
    item.revision += 1
    session.commit()
    session.refresh(item)
    return item


def finish_run(
    *, session: Session, integration_id: uuid.UUID, data: IntegrationRunFinish
) -> Integration:
    item = session.scalar(
        select(Integration)
        .where(Integration.id == integration_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if item is None:
        raise IntegrationNotFoundError
    if item.current_run_id != data.run_id:
        raise IntegrationConflictError(IntegrationConflictCode.RUN_CONFLICT)
    code = data.error.code if data.error else None
    message = data.error.message if data.error else None
    if item.current_finished_at is not None:
        if (
            item.last_result,
            item.last_changes_detected,
            item.last_error_code,
            item.last_error_message,
        ) != (data.result, data.changes_detected, code, message):
            raise IntegrationConflictError(IntegrationConflictCode.RUN_CONFLICT)
        session.commit()
        return item
    now = get_datetime_utc()
    item.current_finished_at = now
    item.last_finished_at = now
    item.last_result = data.result.value
    item.last_changes_detected = data.changes_detected
    item.last_error_code = code
    item.last_error_message = message
    if data.result == IntegrationResult.SUCCESS:
        item.last_success_at = now
    item.updated_at = now
    item.revision += 1
    session.commit()
    session.refresh(item)
    return item
