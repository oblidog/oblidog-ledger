"""Business dates must not depend on the host's timezone."""

from datetime import UTC, date, datetime, tzinfo
from typing import Self

import pytest

from app.core import business_date
from app.core.config import settings


@pytest.mark.parametrize(
    ("timezone", "instant", "expected"),
    [
        ("Europe/Warsaw", datetime(2026, 8, 31, 22, 30, tzinfo=UTC), date(2026, 9, 1)),
        ("UTC", datetime(2026, 8, 31, 22, 30, tzinfo=UTC), date(2026, 8, 31)),
        ("Europe/Warsaw", datetime(2026, 12, 31, 23, 30, tzinfo=UTC), date(2027, 1, 1)),
    ],
)
def test_business_today_uses_configured_timezone(
    monkeypatch: pytest.MonkeyPatch, timezone: str, instant: datetime, expected: date
) -> None:
    class FrozenDatetime(datetime):
        @classmethod
        def now(cls, tz: tzinfo | None = None) -> Self:
            assert tz is not None
            return cls.fromtimestamp(instant.timestamp(), tz)

    monkeypatch.setattr(business_date, "datetime", FrozenDatetime)
    monkeypatch.setattr(settings, "SYSTEM_RUN_TIMEZONE", timezone)

    assert business_date.business_today() == expected
