"""Business-calendar calculations used by report policies."""

from __future__ import annotations

from datetime import date, timedelta

import holidays


def supported_calendar_countries() -> list[str]:
    """Return supported two-letter country codes, excluding aliases."""
    return sorted(
        code
        for code in holidays.list_supported_countries(include_aliases=False)
        if len(code) == 2
    )


def validate_calendar_country(value: str) -> str:
    country = value.strip().upper()
    if country not in supported_calendar_countries():
        raise ValueError("Unsupported business calendar country")
    return country


class BusinessCalendar:
    """Calendar of working days for a configured country.

    The country is intentionally an explicit constructor argument so calendars can
    later be selected per ledger without changing report-policy code.
    """

    def __init__(self, country: str) -> None:
        self._holidays = holidays.country_holidays(country)

    def is_business_day(self, value: date) -> bool:
        return value.weekday() < 5 and value not in self._holidays

    def business_days_until(self, *, start: date, end: date) -> int:
        """Return working days in ``(start, end]``.

        Report policies call this only for dates that are not overdue.
        """
        if end < start:
            raise ValueError("end date must not precede start date")

        result = 0
        current = start
        while current < end:
            current += timedelta(days=1)
            if self.is_business_day(current):
                result += 1
        return result

    def nth_business_day_of_month(self, *, year: int, month: int, n: int) -> date:
        if n < 1:
            raise ValueError("n must be positive")

        current = date(year, month, 1)
        count = 0
        while True:
            if self.is_business_day(current):
                count += 1
                if count == n:
                    return current
            current += timedelta(days=1)
