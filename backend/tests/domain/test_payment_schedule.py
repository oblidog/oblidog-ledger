from datetime import date

import pytest

from app.domain import BillingPeriod, RecurrenceUnit
from app.domain.business_calendar import BusinessCalendar
from app.domain.payment_schedule import (
    next_payment,
    occurs_in_period,
    payment_for_period,
)


@pytest.mark.parametrize(
    ("anchor", "period", "expected"),
    [
        (date(2026, 3, 15), BillingPeriod(2026, 3), date(2026, 3, 13)),
        (date(2026, 1, 31), BillingPeriod(2026, 2), date(2026, 2, 27)),
        (date(2024, 1, 31), BillingPeriod(2024, 2), date(2024, 2, 29)),
        (date(2026, 11, 11), BillingPeriod(2026, 11), date(2026, 11, 10)),
        (date(2026, 12, 27), BillingPeriod(2026, 12), date(2026, 12, 23)),
        (date(2026, 1, 1), BillingPeriod(2026, 1), date(2025, 12, 31)),
    ],
)
def test_effective_dates(anchor: date, period: BillingPeriod, expected: date) -> None:
    payment = payment_for_period(
        first_due_date=anchor, period=period, calendar=BusinessCalendar("PL")
    )
    assert payment.due_date == expected
    assert payment.period == period


@pytest.mark.parametrize(
    ("reference", "expected"),
    [(date(2026, 3, 13), date(2026, 3, 13)), (date(2026, 3, 14), date(2026, 4, 15))],
)
def test_next_payment_compares_adjusted_date_including_today(
    reference: date, expected: date
) -> None:
    payment = next_payment(
        first_due_date=date(2026, 3, 15),
        interval=1,
        unit=RecurrenceUnit.MONTH,
        reference_date=reference,
        calendar=BusinessCalendar("PL"),
    )
    assert payment is not None
    assert payment.due_date == expected


def test_next_payment_can_belong_to_next_month() -> None:
    payment = next_payment(
        first_due_date=date(2026, 1, 1),
        interval=1,
        unit=RecurrenceUnit.MONTH,
        reference_date=date(2025, 12, 31),
        calendar=BusinessCalendar("PL"),
    )
    assert payment is not None
    assert payment.period == BillingPeriod(2026, 1)
    assert payment.due_date == date(2025, 12, 31)


def test_original_day_is_preserved_after_short_month() -> None:
    payment = next_payment(
        first_due_date=date(2026, 1, 31),
        interval=1,
        unit=RecurrenceUnit.MONTH,
        reference_date=date(2026, 3, 1),
        calendar=BusinessCalendar("PL"),
    )
    assert payment is not None
    assert payment.scheduled_date == date(2026, 3, 31)


def test_yearly_leap_day_and_recurrence() -> None:
    anchor = date(2024, 2, 29)
    assert occurs_in_period(
        first_due_date=anchor,
        interval=2,
        unit=RecurrenceUnit.YEAR,
        period=BillingPeriod(2026, 2),
    )
    assert not occurs_in_period(
        first_due_date=anchor,
        interval=2,
        unit=RecurrenceUnit.YEAR,
        period=BillingPeriod(2025, 2),
    )
    payment = next_payment(
        first_due_date=anchor,
        interval=2,
        unit=RecurrenceUnit.YEAR,
        reference_date=date(2025, 1, 1),
        calendar=BusinessCalendar("PL"),
    )
    assert payment is not None
    assert payment.scheduled_date == date(2026, 2, 28)


def test_calendar_country_changes_holiday_adjustment() -> None:
    assert payment_for_period(
        first_due_date=date(2026, 11, 11),
        period=BillingPeriod(2026, 11),
        calendar=BusinessCalendar("DE"),
    ).due_date == date(2026, 11, 11)


def test_no_future_date_returns_none_instead_of_overflow() -> None:
    assert (
        next_payment(
            first_due_date=date(2026, 1, 1),
            interval=1000000,
            unit=RecurrenceUnit.YEAR,
            reference_date=date(2027, 1, 1),
            calendar=BusinessCalendar("PL"),
        )
        is None
    )


def test_preview_stops_after_last_supported_billing_period() -> None:
    calendar = BusinessCalendar("PL")
    payment = next_payment(
        first_due_date=date(2199, 12, 15),
        interval=1,
        unit=RecurrenceUnit.MONTH,
        reference_date=date(2199, 12, 1),
        calendar=calendar,
    )
    assert payment is not None
    assert payment.period == BillingPeriod(2199, 12)
    assert (
        next_payment(
            first_due_date=date(2199, 12, 15),
            interval=1,
            unit=RecurrenceUnit.MONTH,
            reference_date=date(2200, 1, 1),
            calendar=calendar,
        )
        is None
    )


def test_preview_skips_unsupported_historical_billing_periods() -> None:
    payment = next_payment(
        first_due_date=date(1960, 1, 15),
        interval=1,
        unit=RecurrenceUnit.MONTH,
        reference_date=date(1969, 1, 1),
        calendar=BusinessCalendar("PL"),
    )
    assert payment is not None
    assert payment.period == BillingPeriod(1970, 1)


def test_first_supported_period_can_be_due_before_epoch() -> None:
    payment = next_payment(
        first_due_date=date(1960, 1, 1),
        interval=1,
        unit=RecurrenceUnit.MONTH,
        reference_date=date(1969, 12, 31),
        calendar=BusinessCalendar("PL"),
    )
    assert payment is not None
    assert payment.period == BillingPeriod(1970, 1)
    assert payment.due_date == date(1969, 12, 31)
