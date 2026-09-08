import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from threading import Barrier

import pytest
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.domain.integrations import IntegrationResult
from app.models import Integration, IntegrationCategory, Ledger
from app.schemas.integrations import (
    IntegrationCreate,
    IntegrationRunError,
    IntegrationRunFinish,
    IntegrationRunStart,
    IntegrationUpdate,
)
from app.use_cases import integrations as uc
from tests.conftest import TestingSessionLocal
from tests.utils.ledger_domain import create_category_tree

T0 = datetime(2026, 9, 8, 9, tzinfo=UTC)


@pytest.fixture
def item(db: Session, monkeypatch: pytest.MonkeyPatch) -> Integration:
    monkeypatch.setattr(uc, "get_datetime_utc", lambda: T0)
    ledger, _, category = create_category_tree(db)
    return uc.create_integration(
        session=db,
        ledger_id=ledger.id,
        data=IntegrationCreate(
            key="nju-mario", provider="nju", name="Phone", category_ids=[category.id]
        ),
    )


def start(
    db: Session,
    item: Integration,
    *,
    run_id: uuid.UUID | None = None,
    revision: int | None = None,
) -> Integration:
    return uc.start_run(
        session=db,
        ledger_id=item.ledger_id,
        key=item.key,
        data=IntegrationRunStart(
            run_id=run_id or uuid.uuid4(),
            expected_revision=item.revision if revision is None else revision,
        ),
    )


def finish(
    db: Session,
    item: Integration,
    *,
    result: IntegrationResult = IntegrationResult.SUCCESS,
    changes: bool | None = False,
    run_id: uuid.UUID | None = None,
) -> Integration:
    assert item.current_run_id is not None or run_id is not None
    return uc.finish_run(
        session=db,
        ledger_id=item.ledger_id,
        key=item.key,
        data=IntegrationRunFinish(
            run_id=run_id or item.current_run_id,
            result=result,
            changes_detected=changes,
            error=IntegrationRunError(
                code="provider_failed", message="Provider unavailable"
            )
            if result == IntegrationResult.FAILURE
            else None,
        ),
    )


def update(db: Session, item: Integration, **fields: object) -> Integration:
    return uc.update_integration(
        session=db,
        ledger_id=item.ledger_id,
        integration_id=item.id,
        data=IntegrationUpdate.model_validate(
            {"expected_revision": item.revision, **fields}
        ),
    )


def test_never_run_stale_and_reenable_grace(
    db: Session, item: Integration, monkeypatch: pytest.MonkeyPatch
) -> None:
    assert uc.to_public(item, now=T0).health == "never_run"
    deadline = T0 + timedelta(seconds=item.stale_after_seconds)
    assert not uc.to_public(item, now=deadline - timedelta(microseconds=1)).is_stale
    assert uc.to_public(item, now=deadline).health == "stale"
    item = update(db, item, enabled=False)
    assert uc.to_public(item, now=deadline).health == "disabled"
    assert not uc.to_public(item, now=deadline).is_stale
    monkeypatch.setattr(uc, "get_datetime_utc", lambda: deadline)
    item = update(db, item, enabled=True)
    assert item.enabled_at == deadline
    assert uc.to_public(item).health == "never_run"


@pytest.mark.parametrize("changes", [True, False, None])
def test_success_and_retries_do_not_advance_timestamps(
    db: Session,
    item: Integration,
    monkeypatch: pytest.MonkeyPatch,
    changes: bool | None,
) -> None:
    item = start(db, item)
    run_id = item.current_run_id
    assert uc.to_public(item).health == "running"
    item = start(db, item, run_id=run_id, revision=0)
    assert item.revision == 1
    assert item.current_started_at == T0
    completed_at = T0 + timedelta(seconds=5)
    monkeypatch.setattr(uc, "get_datetime_utc", lambda: completed_at)
    item = finish(db, item, changes=changes)
    assert item.last_success_at == completed_at
    assert item.last_changes_detected is changes
    assert uc.to_public(item).health == "healthy"
    monkeypatch.setattr(
        uc, "get_datetime_utc", lambda: completed_at + timedelta(seconds=10)
    )
    item = finish(db, item, changes=changes)
    item = start(db, item, run_id=run_id, revision=0)
    assert item.revision == 2
    assert item.updated_at == completed_at
    assert item.last_finished_at == completed_at
    with pytest.raises(uc.IntegrationConflictError, match="run_conflict"):
        finish(db, item, changes=None, result=IntegrationResult.FAILURE)
    db.rollback()


def test_failure_preserves_success_and_success_clears_error(
    db: Session, item: Integration, monkeypatch: pytest.MonkeyPatch
) -> None:
    item = finish(db, start(db, item))
    success = item.last_success_at
    later = T0 + timedelta(hours=1)
    monkeypatch.setattr(uc, "get_datetime_utc", lambda: later)
    item = start(db, item)
    assert item.last_result == "success"
    item = finish(db, item, result=IntegrationResult.FAILURE, changes=None)
    assert item.last_success_at == success
    assert item.last_finished_at == later
    assert item.last_error_code == "provider_failed"
    assert uc.to_public(item).health == "error"
    assert not uc.to_public(item).is_stale
    item = finish(db, start(db, item), changes=True)
    assert item.last_error_code is None and item.last_error_message is None
    assert item.last_success_at == later


def test_timeout_supersession_and_late_reports(
    db: Session, item: Integration, monkeypatch: pytest.MonkeyPatch
) -> None:
    item = start(db, item)
    old_run = item.current_run_id
    with pytest.raises(uc.IntegrationConflictError, match="run_in_progress"):
        start(db, item)
    db.rollback()
    deadline = T0 + timedelta(seconds=item.run_timeout_seconds)
    assert (
        uc.to_public(item, now=deadline - timedelta(microseconds=1)).health == "running"
    )
    assert uc.to_public(item, now=deadline).health == "timed_out"
    monkeypatch.setattr(uc, "get_datetime_utc", lambda: deadline)
    item = start(db, item)
    new_run = item.current_run_id
    with pytest.raises(uc.IntegrationConflictError, match="run_conflict"):
        finish(db, item, run_id=old_run)
    db.rollback()
    with pytest.raises(uc.IntegrationConflictError, match="revision_conflict"):
        start(db, item, run_id=old_run, revision=0)
    db.rollback()
    assert item.current_run_id == new_run
    assert item.last_success_at is None
    monkeypatch.setattr(uc, "get_datetime_utc", lambda: deadline + timedelta(hours=1))
    item = finish(db, item)
    assert uc.to_public(item).health == "healthy"  # Late but still the current run.


def test_new_start_does_not_hide_stale_reporting(
    db: Session, item: Integration, monkeypatch: pytest.MonkeyPatch
) -> None:
    deadline = T0 + timedelta(seconds=item.stale_after_seconds)
    monkeypatch.setattr(uc, "get_datetime_utc", lambda: deadline)
    item = start(db, item)
    public = uc.to_public(item)
    assert public.execution_state == "running"
    assert public.is_stale and public.health == "stale"


def test_disable_during_run_and_config_conflicts(
    db: Session, item: Integration
) -> None:
    item = start(db, item)
    with pytest.raises(uc.IntegrationConflictError, match="run_in_progress"):
        update(db, item, run_timeout_seconds=600)
    db.rollback()
    item = update(db, item, enabled=False)
    with pytest.raises(uc.IntegrationConflictError, match="integration_disabled"):
        start(db, item)
    db.rollback()
    item = finish(db, item)
    assert uc.to_public(item).health == "disabled"
    assert item.last_success_at == T0
    item = update(db, item, enabled=True)
    with pytest.raises(uc.IntegrationConflictError, match="revision_conflict"):
        update(db, item, expected_revision=0, name="Stale edit")
    db.rollback()
    with pytest.raises(uc.IntegrationLimitsError):
        update(db, item, stale_after_seconds=100)
    db.rollback()
    assert item.name == "Phone"


def test_associations_are_atomic_and_tenant_scoped(
    db: Session, item: Integration
) -> None:
    other_ledger, _, other_category = create_category_tree(db)
    old_categories = item.category_ids
    with pytest.raises(uc.IntegrationCategoryNotFoundError):
        update(db, item, name="Must not persist", category_ids=[other_category.id])
    db.rollback()
    assert item.name == "Phone" and item.category_ids == old_categories
    item = update(db, item, category_ids=old_categories * 2)
    assert item.category_ids == old_categories
    db.add(
        IntegrationCategory(
            ledger_id=item.ledger_id,
            integration_id=item.id,
            category_id=other_category.id,
        )
    )
    with pytest.raises(IntegrityError):
        db.commit()
    db.rollback()
    other = uc.create_integration(
        session=db,
        ledger_id=other_ledger.id,
        data=IntegrationCreate(key=item.key, provider="nju", name="Other"),
    )
    assert other.id != item.id
    with pytest.raises(uc.IntegrationNotFoundError):
        uc.get_integration(
            session=db, ledger_id=other_ledger.id, integration_id=item.id
        )
    with pytest.raises(uc.IntegrationConflictError, match="duplicate_key"):
        uc.create_integration(
            session=db,
            ledger_id=item.ledger_id,
            data=IntegrationCreate(key=item.key, provider="nju", name="Duplicate"),
        )
    item = update(db, item, category_ids=[])
    assert item.category_ids == []


def test_ledger_deletion_cascades_registry(db: Session, item: Integration) -> None:
    item_id, ledger_id = item.id, item.ledger_id
    db.execute(delete(Ledger).where(Ledger.id == ledger_id))
    db.commit()
    assert db.scalar(select(Integration.id).where(Integration.id == item_id)) is None
    assert (
        db.scalar(
            select(IntegrationCategory.integration_id).where(
                IntegrationCategory.integration_id == item_id
            )
        )
        is None
    )


def test_unstarted_finish_rejected_and_disabled_creation(
    db: Session, item: Integration
) -> None:
    with pytest.raises(uc.IntegrationConflictError, match="run_conflict"):
        finish(db, item, run_id=uuid.uuid4())
    db.rollback()
    disabled = uc.create_integration(
        session=db,
        ledger_id=item.ledger_id,
        data=IntegrationCreate(
            key="disabled", provider="nju", name="Disabled", enabled=False
        ),
    )
    assert disabled.enabled_at is None
    assert uc.to_public(disabled).health == "disabled"


def test_concurrent_starts_accept_only_one(db: Session, item: Integration) -> None:
    ledger_id, key = item.ledger_id, item.key
    db.rollback()  # No caller transaction may hold a row lock for the workers.
    barrier = Barrier(2)

    def attempt() -> str:
        with TestingSessionLocal() as session:
            # Preload to exercise refresh of an already-cached ORM object.
            uc.get_integration(session=session, ledger_id=ledger_id, key=key)
            barrier.wait(timeout=10)
            try:
                uc.start_run(
                    session=session,
                    ledger_id=ledger_id,
                    key=key,
                    data=IntegrationRunStart(run_id=uuid.uuid4(), expected_revision=0),
                )
                return "accepted"
            except uc.IntegrationConflictError as exc:
                session.rollback()
                return exc.code

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: attempt(), range(2)))
    assert sorted(results) == ["accepted", "revision_conflict"]
    db.expire_all()
    stored = uc.get_integration(session=db, ledger_id=ledger_id, key=key)
    assert stored.revision == 1


def test_timeout_edit_cannot_revive_expired_run(
    db: Session, item: Integration, monkeypatch: pytest.MonkeyPatch
) -> None:
    item = start(db, item)
    original_run = item.current_run_id
    original_deadline = T0 + timedelta(minutes=30)
    assert item.current_deadline_at == original_deadline
    later = T0 + timedelta(minutes=31)
    monkeypatch.setattr(uc, "get_datetime_utc", lambda: later)
    assert uc.to_public(item).health == "timed_out"

    # A new timeout is configuration for future starts, not a new lease for
    # the old process. Re-enable and identical retries also retain its deadline.
    item = update(db, item, run_timeout_seconds=3600, enabled=False)
    item = update(db, item, enabled=True)
    item = start(db, item, run_id=original_run, revision=0)
    assert item.current_deadline_at == original_deadline
    assert uc.to_public(item).health == "timed_out"

    item = start(db, item)
    assert item.current_run_id != original_run
    assert item.current_deadline_at == later + timedelta(hours=1)
    assert uc.to_public(item).health == "running"


def test_finish_retains_deadline_and_future_timeout_edit_does_not_change_it(
    db: Session, item: Integration, monkeypatch: pytest.MonkeyPatch
) -> None:
    item = start(db, item)
    original_deadline = item.current_deadline_at
    monkeypatch.setattr(uc, "get_datetime_utc", lambda: T0 + timedelta(minutes=31))
    item = finish(db, item)
    item = update(db, item, run_timeout_seconds=60)
    item = finish(db, item)
    assert item.current_deadline_at == original_deadline
    assert uc.to_public(item).health == "healthy"
    item = start(db, item)
    assert item.current_deadline_at == T0 + timedelta(minutes=32)
