from datetime import UTC, date, datetime
from decimal import Decimal
from types import SimpleNamespace
from uuid import UUID
from zoneinfo import ZoneInfo

from app.domain import BillingPeriod, ObligationLifecycle, ValueState
from app.services.weekly_monthly_overview_report import (
    WeeklyMonthlyOverviewReport,
    _previous_period,
    _summarize_currency,
)
from app.use_cases.system_runs import SystemRunContext


def _obligation(
    *,
    lifecycle: ObligationLifecycle,
    due_date: date | None,
    amount: Decimal | None,
    amount_state: ValueState = ValueState.CONFIRMED,
    due_date_state: ValueState = ValueState.CONFIRMED,
    category_name: str = "Energy",
) -> SimpleNamespace:
    return SimpleNamespace(
        lifecycle=lifecycle,
        due_date=due_date,
        current_amount=amount,
        amount_state=amount_state,
        due_date_state=due_date_state,
        category=SimpleNamespace(name=category_name),
    )


def test_previous_period_crosses_year_boundary() -> None:
    assert _previous_period(BillingPeriod(2026, 1)) == BillingPeriod(2025, 12)
    assert _previous_period(BillingPeriod(2026, 9)) == BillingPeriod(2026, 8)


def test_delivery_key_uses_iso_week_year() -> None:
    report = WeeklyMonthlyOverviewReport()
    context = SimpleNamespace(business_date=date(2027, 1, 1))
    user = SimpleNamespace(id=UUID("00000000-0000-0000-0000-000000000001"))

    assert report.delivery_key(user=user, context=context) == (
        "weekly:00000000-0000-0000-0000-000000000001:2026-W53"
    )


def test_weekly_report_uses_local_business_date_for_schedule() -> None:
    context = SystemRunContext.create(
        effective_at=datetime(2026, 9, 6, 22, 30, tzinfo=UTC),
        timezone=ZoneInfo("Europe/Warsaw"),
    )

    assert context.business_date == date(2026, 9, 7)
    assert context.business_date.weekday() == 0


def test_currency_summary_keeps_unknown_values_explicit() -> None:
    obligations = [
        _obligation(
            lifecycle=ObligationLifecycle.PAID,
            due_date=date(2026, 9, 2),
            amount=Decimal("100.00"),
        ),
        _obligation(
            lifecycle=ObligationLifecycle.READY,
            due_date=date(2026, 9, 5),
            amount=None,
            amount_state=ValueState.UNKNOWN,
        ),
        _obligation(
            lifecycle=ObligationLifecycle.COLLECTING_DATA,
            due_date=None,
            amount=Decimal("50.00"),
            due_date_state=ValueState.ESTIMATED,
        ),
    ]

    summary = _summarize_currency(
        obligations=obligations,  # type: ignore[arg-type]
        currency="PLN",
        report_date=date(2026, 9, 7),
        current_total=Decimal("150.00"),
        paid_total=Decimal("100.00"),
        previous_total=Decimal("120.00"),
        current_complete=False,
        previous_complete=True,
    )

    assert summary.total_known_amount == Decimal("150.00")
    assert summary.remaining_known_amount == Decimal("50.00")
    assert summary.total_is_complete is False
    assert summary.incomplete_count == 2
    assert summary.total_change is None
    assert summary.ready_count == 1
    assert summary.paid_count == 1
    assert summary.not_ready_count == 1
    assert summary.overdue_count == 1
    assert summary.overdue_known_amount == Decimal("0.00")


def test_currency_summary_uses_seven_calendar_day_window() -> None:
    obligations = [
        _obligation(
            lifecycle=ObligationLifecycle.READY,
            due_date=date(2026, 9, 14),
            amount=Decimal("42.00"),
            category_name="Internet",
        ),
        _obligation(
            lifecycle=ObligationLifecycle.READY,
            due_date=date(2026, 9, 15),
            amount=Decimal("43.00"),
            category_name="Phone",
        ),
    ]

    summary = _summarize_currency(
        obligations=obligations,  # type: ignore[arg-type]
        currency="PLN",
        report_date=date(2026, 9, 7),
        current_total=Decimal("85.00"),
        paid_total=Decimal("0.00"),
        previous_total=Decimal("0.00"),
        current_complete=True,
        previous_complete=True,
    )

    assert [item.category_name for item in summary.upcoming] == ["Internet"]
    assert summary.total_change == Decimal("85.00")
