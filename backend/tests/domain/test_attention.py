"""Attention policy tests require no database or scheduler."""

import uuid
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from unittest.mock import Mock

import pytest

from app.domain import BusinessCalendar, ObligationLifecycle, ValueState
from app.models import Category, Integration, Ledger, Obligation
from app.use_cases.attention import get_attention_overview, obligation_reasons

TODAY = date(2026, 11, 2)
NOW = datetime(2026, 11, 2, 12, tzinfo=UTC)
CALENDAR = BusinessCalendar("PL")


def bill(
    *,
    due: date | None = date(2026, 10, 20),
    lifecycle: ObligationLifecycle = ObligationLifecycle.READY,
    amount: Decimal | None = Decimal("89.99"),
    month: int = 10,
) -> Obligation:
    category = Category(id=uuid.uuid4(), name="Home internet", code="HOME")
    return Obligation(
        id=uuid.uuid4(),
        category=category,
        category_id=category.id,
        lifecycle=lifecycle,
        period_year=2026,
        period_month=month,
        due_date=due,
        due_date_state=ValueState.CONFIRMED if due else ValueState.UNKNOWN,
        current_amount=amount,
        amount_state=ValueState.CONFIRMED if amount is not None else ValueState.UNKNOWN,
        currency="EUR",
    )


def integration(category_id: uuid.UUID, **patch: object) -> Integration:
    values = {
        "id": uuid.uuid4(),
        "category_id": category_id,
        "name": "Connecta",
        "enabled": True,
        "enabled_at": NOW - timedelta(hours=1),
        "stale_after_seconds": 93600,
        "current_run_id": uuid.uuid4(),
        "current_finished_at": NOW - timedelta(minutes=5),
        "last_finished_at": NOW - timedelta(minutes=5),
        "last_result": "failure",
    }
    values.update(patch)
    return Integration(**values)


@pytest.mark.parametrize(
    "lifecycle", [ObligationLifecycle.PAID, ObligationLifecycle.CANCELED]
)
def test_terminal_items_never_need_attention(lifecycle: ObligationLifecycle) -> None:
    assert obligation_reasons(bill(lifecycle=lifecycle), TODAY, CALENDAR) == []


def test_rollover_and_overlapping_reasons() -> None:
    item = bill(lifecycle=ObligationLifecycle.ERROR, amount=None)
    assert obligation_reasons(item, TODAY, CALENDAR) == [
        "overdue",
        "error",
        "incomplete",
    ]
    item.due_date = TODAY
    assert obligation_reasons(item, TODAY, CALENDAR) == [
        "error",
        "incomplete",
        "upcoming",
    ]


@pytest.mark.parametrize(
    ("due", "lifecycle", "expected"),
    [
        (date(2026, 11, 4), ObligationLifecycle.READY, ["upcoming"]),
        (date(2026, 11, 5), ObligationLifecycle.READY, []),
        (
            date(2026, 11, 5),
            ObligationLifecycle.COLLECTING_DATA,
            ["incomplete", "upcoming"],
        ),
        (date(2026, 11, 6), ObligationLifecycle.COLLECTING_DATA, []),
        (date(9999, 12, 31), ObligationLifecycle.READY, []),
    ],
)
def test_due_boundaries(
    due: date, lifecycle: ObligationLifecycle, expected: list[str]
) -> None:
    assert (
        obligation_reasons(
            bill(due=due, lifecycle=lifecycle, month=11), TODAY, CALENDAR
        )
        == expected
    )


def test_calendar_holidays_and_weekends() -> None:
    # Wednesday + 2 working days: Thursday, then Monday (Friday 1 May is a holiday).
    today = date(2026, 4, 29)
    assert obligation_reasons(bill(due=date(2026, 5, 4)), today, CALENDAR) == [
        "upcoming"
    ]
    assert obligation_reasons(bill(due=date(2026, 5, 5)), today, CALENDAR) == []


def test_unknown_date_grace_period_and_future_period() -> None:
    item = bill(due=None, amount=None, month=11, lifecycle=ObligationLifecycle.DRAFT)
    assert obligation_reasons(item, TODAY, CALENDAR) == []
    assert obligation_reasons(item, date(2026, 11, 6), CALENDAR) == ["incomplete"]
    item.period_month = 10
    assert obligation_reasons(item, TODAY, CALENDAR) == ["incomplete"]
    item.period_month = 12
    assert obligation_reasons(item, TODAY, CALENDAR) == []


def test_correlation_priority_pagination_and_amount_certainty() -> None:
    overdue = bill(lifecycle=ObligationLifecycle.ERROR, amount=None)
    upcoming = bill(due=TODAY, month=11)
    upcoming.currency = "PLN"
    upcoming.amount_state = ValueState.ESTIMATED
    unrelated = integration(uuid.uuid4(), name="Unrelated")
    failed = integration(overdue.category_id)
    session = Mock()
    session.scalars.side_effect = [[upcoming, overdue], [unrelated, failed]]
    result = get_attention_overview(
        session=session,
        ledger=Ledger(id=uuid.uuid4(), business_calendar_country="PL"),
        offset=0,
        limit=8,
        today=TODAY,
        now=NOW,
    )
    assert result.total == 3
    assert result.items[0].key == overdue.business_key
    assert result.items[0].amount is None
    assert result.items[0].integrations[0].id == failed.id
    assert result.items[1].integrations[0].id == unrelated.id
    assert result.items[2].currency == "PLN"
    assert result.items[2].amount_state == ValueState.ESTIMATED
    session.scalars.side_effect = [[upcoming, overdue], [unrelated, failed]]
    page = get_attention_overview(
        session=session,
        ledger=Ledger(id=uuid.uuid4(), business_calendar_country="PL"),
        offset=1,
        limit=1,
        today=TODAY,
        now=NOW,
    )
    assert page.items == result.items[1:2]
    assert page.total == 3


def test_integration_freshness_uses_existing_threshold_and_empty_is_explicit() -> None:
    category_id = uuid.uuid4()
    healthy = integration(category_id, last_result="success")
    stale = integration(
        category_id,
        last_result="success",
        enabled_at=NOW - timedelta(days=3),
        last_finished_at=NOW - timedelta(seconds=93600),
    )
    session = Mock()
    session.scalars.side_effect = [[], [healthy, stale]]
    ledger = Ledger(id=uuid.uuid4(), business_calendar_country="PL")
    result = get_attention_overview(
        session=session, ledger=ledger, offset=0, limit=8, today=TODAY, now=NOW
    )
    assert result.total == 1
    assert result.items[0].integrations[0].health == "stale"
    session.scalars.side_effect = [[], [healthy]]
    assert (
        get_attention_overview(
            session=session, ledger=ledger, offset=0, limit=8, today=TODAY, now=NOW
        ).total
        == 0
    )
