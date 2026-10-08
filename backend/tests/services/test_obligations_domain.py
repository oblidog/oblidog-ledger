from datetime import date
from decimal import Decimal

import pytest
from sqlalchemy.orm import Session

from app.domain import (
    BillingPeriod,
    CurrentValueSource,
    DataSourcePolicy,
    RecurrenceUnit,
    ValueState,
)
from app.models import Obligation
from app.services import obligations as obligation_service
from tests.utils.ledger_domain import create_category_with_recurrence


def test_ensure_obligations_creates_current_and_next_periods_with_lifecycles(
    db: Session,
) -> None:
    ledger, _, category = create_category_with_recurrence(db)

    created = obligation_service.ensure_obligations_for_period(
        session=db, ledger_id=ledger.id, current_period=BillingPeriod(2026, 3)
    )

    assert len(created) == 2
    assert {(item.period_year, item.period_month) for item in created} == {
        (2026, 3),
        (2026, 4),
    }
    assert all(item.category_id == category.id for item in created)
    assert {item.business_key for item in created} == {
        f"{category.code}-2026-03",
        f"{category.code}-2026-04",
    }
    assert {
        (item.period_year, item.period_month): item.lifecycle for item in created
    } == {
        (2026, 3): "collecting_data",
        (2026, 4): "draft",
    }


def test_ensure_obligations_is_idempotent(db: Session) -> None:
    ledger, _, _ = create_category_with_recurrence(db)
    period = BillingPeriod(2026, 3)

    first = obligation_service.ensure_obligations_for_period(
        session=db, ledger_id=ledger.id, current_period=period
    )
    second = obligation_service.ensure_obligations_for_period(
        session=db, ledger_id=ledger.id, current_period=period
    )

    assert len(first) == 2
    assert second == []
    assert (
        len(db.query(Obligation).filter(Obligation.ledger_id == ledger.id).all()) == 2
    )


def test_estimate_missing_amounts_uses_trustworthy_history_median(db: Session) -> None:
    ledger, _, category = create_category_with_recurrence(db)
    for month, amount, state in (
        (5, "10.00", ValueState.CONFIRMED),
        (6, "20.00", ValueState.OVERRIDDEN),
        (7, "999.00", ValueState.ESTIMATED),
    ):
        obligation, _ = obligation_service.get_or_create_obligation(
            session=db, category=category, period=BillingPeriod(2026, month)
        )
        obligation.current_amount = Decimal(amount)
        obligation.amount_state = state
        obligation.amount_source = CurrentValueSource.MANUAL
    db.commit()

    obligation_service.ensure_obligations_for_period(
        session=db, ledger_id=ledger.id, current_period=BillingPeriod(2026, 8)
    )
    updated = obligation_service.estimate_missing_obligation_amounts(
        session=db, ledger_id=ledger.id, current_period=BillingPeriod(2026, 8)
    )

    assert len(updated) == 2
    assert all(item.current_amount == Decimal("15.00") for item in updated)
    assert all(item.amount_state is ValueState.ESTIMATED for item in updated)
    assert all(item.amount_source is CurrentValueSource.AUTOMATIC for item in updated)


def test_ensure_obligations_ignores_categories_without_recurrence(db: Session) -> None:
    ledger, _, _ = create_category_with_recurrence(
        db, recurrence_interval=None, recurrence_unit=None, first_due_date=None
    )

    assert (
        obligation_service.ensure_obligations_for_period(
            session=db, ledger_id=ledger.id, current_period=BillingPeriod(2026, 3)
        )
        == []
    )


def test_ensure_obligations_requires_a_first_due_date_for_recurrence(
    db: Session,
) -> None:
    ledger, _, category = create_category_with_recurrence(db)
    category.first_due_date = None
    db.commit()

    assert (
        obligation_service.ensure_obligations_for_period(
            session=db, ledger_id=ledger.id, current_period=BillingPeriod(2026, 3)
        )
        == []
    )


def test_ensure_obligations_ignores_manual_categories_with_recurrence(
    db: Session,
) -> None:
    ledger, _, category = create_category_with_recurrence(db)
    category.data_source_policy = DataSourcePolicy.MANUAL
    db.commit()

    assert (
        obligation_service.ensure_obligations_for_period(
            session=db, ledger_id=ledger.id, current_period=BillingPeriod(2026, 3)
        )
        == []
    )


def test_ensure_obligations_only_creates_periods_that_occur(db: Session) -> None:
    ledger, _, _ = create_category_with_recurrence(
        db,
        recurrence_interval=2,
        recurrence_unit=RecurrenceUnit.MONTH,
        first_due_date=date(2026, 1, 10),
    )

    created = obligation_service.ensure_obligations_for_period(
        session=db, ledger_id=ledger.id, current_period=BillingPeriod(2026, 2)
    )

    assert {(item.period_year, item.period_month) for item in created} == {(2026, 3)}


def test_ensure_obligations_derives_due_date_from_category_first_due_date(
    db: Session,
) -> None:
    ledger, _, category = create_category_with_recurrence(db)
    category.first_due_date = date(2026, 1, 31)
    db.commit()

    created = obligation_service.ensure_obligations_for_period(
        session=db, ledger_id=ledger.id, current_period=BillingPeriod(2026, 2)
    )

    due_dates = {
        (item.period_year, item.period_month): item.due_date for item in created
    }
    assert due_dates == {
        (2026, 2): date(2026, 2, 27),
        (2026, 3): date(2026, 3, 31),
    }
    assert all(item.due_date_state.value == "estimated" for item in created)
    assert all(item.due_date_source.value == "automatic" for item in created)


def test_category_occurs_in_respects_month_and_year_recurrence(db: Session) -> None:
    _, _, category = create_category_with_recurrence(
        db,
        recurrence_interval=2,
        recurrence_unit=RecurrenceUnit.MONTH,
        first_due_date=date(2026, 1, 15),
    )

    assert category.occurs_in(BillingPeriod(2026, 1))
    assert not category.occurs_in(BillingPeriod(2026, 2))
    assert category.occurs_in(BillingPeriod(2026, 3))

    category.recurrence_interval = 1
    category.recurrence_unit = RecurrenceUnit.YEAR
    category.first_due_date = date(2026, 3, 1)

    assert category.occurs_in(BillingPeriod(2027, 3))
    assert not category.occurs_in(BillingPeriod(2027, 4))


@pytest.mark.parametrize(
    ("anchor", "period", "expected"),
    [
        (date(2026, 3, 15), BillingPeriod(2026, 3), date(2026, 3, 13)),
        (date(2026, 1, 31), BillingPeriod(2026, 2), date(2026, 2, 27)),
        (date(2024, 1, 31), BillingPeriod(2024, 2), date(2024, 2, 29)),
        (date(2026, 12, 27), BillingPeriod(2026, 12), date(2026, 12, 23)),
        (date(2026, 11, 11), BillingPeriod(2026, 11), date(2026, 11, 10)),
        (date(2026, 1, 1), BillingPeriod(2026, 1), date(2025, 12, 31)),
    ],
)
def test_preview_matches_ensure_and_existing_dates_are_preserved(
    db: Session,
    monkeypatch: pytest.MonkeyPatch,
    anchor: date,
    period: BillingPeriod,
    expected: date,
) -> None:
    from app.core.config import settings
    from app.domain.business_calendar import BusinessCalendar
    from app.domain.payment_schedule import next_payment

    monkeypatch.setattr(settings, "BUSINESS_CALENDAR_COUNTRY", "PL")
    ledger, _, category = create_category_with_recurrence(db, first_due_date=anchor)
    assert category.first_due_date is not None
    preview = next_payment(
        first_due_date=category.first_due_date,
        interval=1,
        unit=RecurrenceUnit.MONTH,
        reference_date=min(date(period.year, period.month, 1), expected),
        calendar=BusinessCalendar("PL"),
    )
    created = obligation_service.ensure_obligations_for_period(
        session=db, ledger_id=ledger.id, current_period=period
    )
    obligation = next(
        item
        for item in created
        if (item.period_year, item.period_month) == (period.year, period.month)
    )
    assert preview is not None
    assert obligation.due_date == preview.due_date == expected
    obligation.due_date = anchor
    db.flush()
    assert (
        obligation_service.ensure_obligations_for_period(
            session=db, ledger_id=ledger.id, current_period=period
        )
        == []
    )
    assert obligation.due_date == anchor
