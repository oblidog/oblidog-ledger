import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, date, datetime
from decimal import Decimal
from threading import Barrier

import pytest
from sqlalchemy.orm import Session

from app.domain import BillingPeriod, MutationResult, ObligationKey, ObligationLifecycle
from app.use_cases import obligations as obligation_use_cases
from app.use_cases.exceptions import ObligationReadOnlyError
from tests.utils.ledger_domain import create_category_with_recurrence


def test_ensure_obligations_for_period_creates_current_and_next_periods(
    db: Session,
) -> None:
    ledger, _, category = create_category_with_recurrence(db)
    created = obligation_use_cases.ensure_obligations_for_period(
        session=db, ledger_id=ledger.id, period=BillingPeriod(2026, 3)
    )
    assert len(created) == 2
    assert all(item.category_id == category.id for item in created)
    assert {
        (item.period_year, item.period_month): item.lifecycle for item in created
    } == {
        (2026, 3): ObligationLifecycle.COLLECTING_DATA,
        (2026, 4): ObligationLifecycle.DRAFT,
    }


def test_list_obligations_for_period_filters_by_category_id(db: Session) -> None:
    ledger_one, _, category_one = create_category_with_recurrence(db)
    _, _, category_two = create_category_with_recurrence(db)
    period = BillingPeriod(2026, 9)
    obligation_use_cases.ensure_obligations_for_period(
        session=db, ledger_id=ledger_one.id, period=period
    )

    obligations = obligation_use_cases.list_obligations_for_period(
        session=db, ledger_id=ledger_one.id, period=period, category_id=category_one.id
    )
    assert len(obligations) == 1
    assert obligations[0].category_id == category_one.id
    assert obligations[0].category_id != category_two.id


def test_list_obligations_for_period_filters_by_lifecycle(db: Session) -> None:
    ledger, _, _ = create_category_with_recurrence(db)
    period = BillingPeriod(2026, 8)
    created = obligation_use_cases.ensure_obligations_for_period(
        session=db, ledger_id=ledger.id, period=period
    )
    created[0].lifecycle = ObligationLifecycle.READY
    db.commit()

    obligations = obligation_use_cases.list_obligations_for_period(
        session=db,
        ledger_id=ledger.id,
        period=period,
        lifecycle=ObligationLifecycle.READY,
    )
    assert len(obligations) == 1


def test_create_manual_obligation_rejects_negative_current_amount(db: Session) -> None:
    with pytest.raises(ValueError, match="current_amount"):
        obligation_use_cases.create_manual_obligation(
            session=db,
            ledger_id=uuid.uuid4(),
            category_code="ELEC",
            period=BillingPeriod(2026, 8),
            current_amount=Decimal("-1.00"),
        )


def test_manual_update_moves_draft_obligation_to_collecting_data(db: Session) -> None:
    ledger, _, category = create_category_with_recurrence(db)
    period = BillingPeriod(2026, 8)
    created = obligation_use_cases.ensure_obligations_for_period(
        session=db, ledger_id=ledger.id, period=period
    )
    draft = next(
        item for item in created if item.lifecycle is ObligationLifecycle.DRAFT
    )

    updated = obligation_use_cases.update_manual_obligation(
        session=db,
        ledger_id=ledger.id,
        key=ObligationKey(
            category_code=category.code,
            period=BillingPeriod(draft.period_year, draft.period_month),
        ),
        notes="Manual follow-up",
    )

    assert updated.lifecycle is ObligationLifecycle.COLLECTING_DATA


@pytest.mark.parametrize(
    "lifecycle",
    [
        ObligationLifecycle.READY,
        ObligationLifecycle.PAID,
        ObligationLifecycle.CANCELED,
    ],
)
def test_manual_update_rejects_read_only_lifecycles(
    db: Session, lifecycle: ObligationLifecycle
) -> None:
    ledger, _, category = create_category_with_recurrence(db)
    period = BillingPeriod(2026, 8)
    created = obligation_use_cases.ensure_obligations_for_period(
        session=db, ledger_id=ledger.id, period=period
    )
    obligation = next(
        item
        for item in created
        if item.lifecycle is ObligationLifecycle.COLLECTING_DATA
    )
    obligation.lifecycle = lifecycle
    db.commit()

    with pytest.raises(ObligationReadOnlyError):
        obligation_use_cases.update_manual_obligation(
            session=db,
            ledger_id=ledger.id,
            key=ObligationKey(category_code=category.code, period=period),
            notes="Cannot be changed",
        )


def test_cancel_obligation_moves_collecting_data_to_canceled(db: Session) -> None:
    ledger, _, category = create_category_with_recurrence(db)
    period = BillingPeriod(2026, 8)
    obligation_use_cases.ensure_obligations_for_period(
        session=db, ledger_id=ledger.id, period=period
    )

    canceled = obligation_use_cases.cancel_obligation(
        session=db,
        ledger_id=ledger.id,
        key=ObligationKey(category_code=category.code, period=period),
    )

    assert canceled.lifecycle is ObligationLifecycle.CANCELED


@pytest.mark.parametrize(
    "lifecycle",
    [
        ObligationLifecycle.READY,
        ObligationLifecycle.PAID,
        ObligationLifecycle.CANCELED,
        ObligationLifecycle.ERROR,
    ],
)
def test_reopen_obligation_moves_reopenable_lifecycles_to_collecting_data(
    db: Session, lifecycle: ObligationLifecycle
) -> None:
    ledger, _, category = create_category_with_recurrence(db)
    period = BillingPeriod(2026, 8)
    created = obligation_use_cases.ensure_obligations_for_period(
        session=db, ledger_id=ledger.id, period=period
    )
    obligation = next(
        item
        for item in created
        if item.lifecycle is ObligationLifecycle.COLLECTING_DATA
    )
    obligation.lifecycle = lifecycle
    db.commit()

    reopened = obligation_use_cases.reopen_obligation(
        session=db,
        ledger_id=ledger.id,
        key=ObligationKey(category_code=category.code, period=period),
    )

    assert reopened.lifecycle is ObligationLifecycle.COLLECTING_DATA


@pytest.mark.parametrize("lifecycle", list(ObligationLifecycle))
def test_mark_obligation_error_accepts_every_lifecycle_and_preserves_data(
    db: Session, lifecycle: ObligationLifecycle
) -> None:
    ledger, _, category = create_category_with_recurrence(db)
    period = BillingPeriod(2026, 8)
    obligation_use_cases.ensure_obligations_for_period(
        session=db, ledger_id=ledger.id, period=period
    )
    obligation = obligation_use_cases.update_manual_obligation(
        session=db,
        ledger_id=ledger.id,
        key=ObligationKey(category_code=category.code, period=period),
        current_amount=Decimal("123.45"),
        issue_date=date(2026, 8, 1),
        due_date=date(2026, 8, 20),
        notes="Integration source data",
    )
    obligation.lifecycle = lifecycle
    obligation.paid_at = (
        datetime(2026, 8, 21, tzinfo=UTC)
        if lifecycle is ObligationLifecycle.PAID
        else None
    )
    db.commit()
    before = (
        obligation.paid_at,
        obligation.current_amount,
        obligation.issue_date,
        obligation.due_date,
        obligation.amount_state,
        obligation.issue_date_state,
        obligation.due_date_state,
        obligation.amount_source,
        obligation.issue_date_source,
        obligation.due_date_source,
        obligation.notes,
    )

    marked = obligation_use_cases.mark_obligation_error(
        session=db,
        ledger_id=ledger.id,
        key=ObligationKey(category_code=category.code, period=period),
    )

    assert marked.lifecycle is ObligationLifecycle.ERROR
    assert (
        marked.paid_at,
        marked.current_amount,
        marked.issue_date,
        marked.due_date,
        marked.amount_state,
        marked.issue_date_state,
        marked.due_date_state,
        marked.amount_source,
        marked.issue_date_source,
        marked.due_date_source,
        marked.notes,
    ) == before


def test_obligation_components_support_crud_without_external_identity(
    db: Session,
) -> None:
    ledger, _, category = create_category_with_recurrence(db)
    period = BillingPeriod(2026, 8)
    obligation_use_cases.ensure_obligations_for_period(
        session=db, ledger_id=ledger.id, period=period
    )
    key = ObligationKey(category_code=category.code, period=period)

    component = obligation_use_cases.add_obligation_component(
        session=db,
        ledger_id=ledger.id,
        key=key,
        type="consumption",
        label="Water settlement",
        metadata={"consumption_m3": 12.5},
    )
    assert component.external_id is None
    assert component.component_metadata == {"consumption_m3": 12.5}

    updated = obligation_use_cases.update_obligation_component(
        session=db,
        ledger_id=ledger.id,
        key=key,
        component_id=component.id,
        amount=Decimal("43.21"),
    )
    assert updated.amount == Decimal("43.21")
    assert (
        len(
            obligation_use_cases.list_obligation_components(
                session=db, ledger_id=ledger.id, key=key
            )
        )
        == 1
    )

    obligation_use_cases.remove_obligation_component(
        session=db, ledger_id=ledger.id, key=key, component_id=component.id
    )
    assert not obligation_use_cases.list_obligation_components(
        session=db, ledger_id=ledger.id, key=key
    )


def test_upsert_obligation_component_is_idempotent_for_external_identity(
    db: Session,
) -> None:
    ledger, _, category = create_category_with_recurrence(db)
    period = BillingPeriod(2026, 8)
    obligation_use_cases.ensure_obligations_for_period(
        session=db, ledger_id=ledger.id, period=period
    )
    key = ObligationKey(category_code=category.code, period=period)
    first = obligation_use_cases.upsert_obligation_component(
        session=db,
        ledger_id=ledger.id,
        key=key,
        type="invoice",
        label="August invoice",
        source="provider",
        external_id="FV/2026/08/12345",
        amount=Decimal("100.00"),
    )
    second = obligation_use_cases.upsert_obligation_component(
        session=db,
        ledger_id=ledger.id,
        key=key,
        type="invoice",
        label="August invoice",
        source="provider",
        external_id="FV/2026/08/12345",
        amount=Decimal("120.00"),
    )

    assert first.result == MutationResult.CREATED
    assert second.result == MutationResult.UPDATED
    assert second.component.id == first.component.id
    assert second.component.amount == Decimal("120.00")
    assert (
        len(
            obligation_use_cases.list_obligation_components(
                session=db, ledger_id=ledger.id, key=key
            )
        )
        == 1
    )


def test_concurrent_component_upserts_report_committed_results(
    db: Session,
) -> None:
    ledger, _, category = create_category_with_recurrence(db)
    period = BillingPeriod(2026, 8)
    obligation_use_cases.ensure_obligations_for_period(
        session=db, ledger_id=ledger.id, period=period
    )
    key = ObligationKey(category_code=category.code, period=period)
    start = Barrier(2)

    def upsert() -> obligation_use_cases.ComponentUpsertOutcome:
        with Session(bind=db.get_bind()) as session:
            start.wait()
            return obligation_use_cases.upsert_obligation_component(
                session=session,
                ledger_id=ledger.id,
                key=key,
                type="invoice",
                label="August invoice",
                source="provider",
                external_id="FV/2026/08/12345",
                amount=Decimal("100.00"),
            )

    with ThreadPoolExecutor(max_workers=2) as executor:
        first, second = executor.map(lambda _: upsert(), range(2))

    assert {first.result, second.result} == {
        MutationResult.CREATED,
        MutationResult.UNCHANGED,
    }
    assert second.component.id == first.component.id
