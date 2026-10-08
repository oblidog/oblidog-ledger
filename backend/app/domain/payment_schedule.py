"""Recurrence and effective due dates shared by previews and generation."""

from calendar import monthrange
from dataclasses import dataclass
from datetime import date, timedelta

from app.domain.business_calendar import BusinessCalendar
from app.domain.obligations import BillingPeriod, RecurrenceUnit


@dataclass(frozen=True, slots=True)
class ScheduledPayment:
    period: BillingPeriod
    scheduled_date: date
    due_date: date


def occurs_in_period(
    *, first_due_date: date, interval: int, unit: RecurrenceUnit, period: BillingPeriod
) -> bool:
    if interval < 1:
        raise ValueError("interval must be positive")
    difference = (
        (period.year - first_due_date.year) * 12 + period.month - first_due_date.month
    )
    step = interval * (12 if unit is RecurrenceUnit.YEAR else 1)
    return difference >= 0 and difference % step == 0


def payment_for_period(
    *, first_due_date: date, period: BillingPeriod, calendar: BusinessCalendar
) -> ScheduledPayment:
    scheduled_date = date(
        period.year,
        period.month,
        min(first_due_date.day, monthrange(period.year, period.month)[1]),
    )
    due_date = scheduled_date
    while not calendar.is_business_day(due_date):
        due_date -= timedelta(days=1)
    return ScheduledPayment(period, scheduled_date, due_date)


def next_payment(
    *,
    first_due_date: date,
    interval: int,
    unit: RecurrenceUnit,
    reference_date: date,
    calendar: BusinessCalendar,
) -> ScheduledPayment | None:
    """Return the first effective due date on or after the reference date.

    Always derive occurrences from the anchor, preserving the original day
    after short months. Corrections can cross a billing-period boundary.
    """
    if interval < 1:
        raise ValueError("interval must be positive")
    step = interval * (12 if unit is RecurrenceUnit.YEAR else 1)
    difference = (
        (reference_date.year - first_due_date.year) * 12
        + reference_date.month
        - first_due_date.month
    )
    occurrence = max(0, (difference + step - 1) // step)
    anchor_month = (first_due_date.year - 1) * 12 + first_due_date.month - 1
    while True:
        year_index, month_index = divmod(anchor_month + occurrence * step, 12)
        if year_index >= 9999:
            return None
        payment = payment_for_period(
            first_due_date=first_due_date,
            period=BillingPeriod(year_index + 1, month_index + 1),
            calendar=calendar,
        )
        if payment.due_date >= reference_date:
            return payment
        occurrence += 1
