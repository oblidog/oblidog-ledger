from __future__ import annotations

import re
import uuid
from calendar import monthrange
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from decimal import Decimal
from enum import StrEnum


class ObligationLifecycle(StrEnum):
    DRAFT = "draft"
    COLLECTING_DATA = "collecting_data"
    READY = "ready"
    PAID = "paid"
    CANCELED = "canceled"
    ERROR = "error"


class DataSourcePolicy(StrEnum):
    MANUAL = "manual"
    AUTOMATIC = "automatic"
    HYBRID = "hybrid"


class RecurrenceUnit(StrEnum):
    MONTH = "month"
    YEAR = "year"


class ValueState(StrEnum):
    UNKNOWN = "unknown"
    ESTIMATED = "estimated"
    CONFIRMED = "confirmed"
    OVERRIDDEN = "overridden"


class CurrentValueSource(StrEnum):
    UNKNOWN = "unknown"
    AUTOMATIC = "automatic"
    MANUAL = "manual"
    INTEGRATION = "integration"
    LEGACY = "legacy"


class MutationResult(StrEnum):
    CREATED = "created"
    UPDATED = "updated"
    UNCHANGED = "unchanged"


class EffectiveValueSourceMode(StrEnum):
    UNKNOWN = "unknown"
    AUTOMATIC = "automatic"
    MANUAL = "manual"
    INTEGRATION = "integration"
    LEGACY = "legacy"
    MIXED = "mixed"


class LegacyImportJobStatus(StrEnum):
    PENDING = "pending"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"


@dataclass(frozen=True, slots=True)
class BillingPeriod:
    year: int
    month: int

    def __post_init__(self) -> None:
        if self.month < 1 or self.month > 12:
            raise ValueError("month must be between 1 and 12")

    def next(self) -> BillingPeriod:
        if self.month == 12:
            return BillingPeriod(year=self.year + 1, month=1)
        return BillingPeriod(year=self.year, month=self.month + 1)

    @classmethod
    def from_date(cls, value: date) -> BillingPeriod:
        return cls(year=value.year, month=value.month)


def due_date_range(period: BillingPeriod) -> tuple[date, date]:
    """Return the allowed due-date range for a billing period.

    The maximum is the seventh Monday-to-Friday business day after the end of
    the period. Public holidays are intentionally not included in this rule.
    """

    minimum = date(period.year, period.month, 1)
    maximum = date(period.year, period.month, monthrange(period.year, period.month)[1])
    business_days = 0
    while business_days < 7:
        maximum += timedelta(days=1)
        if maximum.weekday() < 5:
            business_days += 1
    return minimum, maximum


@dataclass(frozen=True, slots=True)
class ObligationKey:
    """Public business key for an obligation."""

    category_code: str
    period: BillingPeriod

    _PATTERN = re.compile(
        r"(?P<category_code>[A-Z]{4})-(?P<year>\d{4})-(?P<month>\d{2})"
    )

    def __str__(self) -> str:
        return f"{self.category_code}-{self.period.year:04d}-{self.period.month:02d}"

    @classmethod
    def parse(cls, value: str) -> ObligationKey:
        match = cls._PATTERN.fullmatch(value)
        if match is None:
            raise ValueError("Invalid obligation key")
        try:
            period = BillingPeriod(
                year=int(match["year"]),
                month=int(match["month"]),
            )
        except ValueError as exc:
            raise ValueError("Invalid obligation key") from exc
        return cls(category_code=match["category_code"], period=period)


@dataclass(slots=True)
class Obligation:
    id: uuid.UUID
    ledger_id: uuid.UUID
    category_id: uuid.UUID
    category_code: str
    period: BillingPeriod
    notes: str | None
    lifecycle: ObligationLifecycle
    effective_value_source: EffectiveValueSourceMode
    current_amount: Decimal | None
    amount_state: ValueState
    amount_source: CurrentValueSource
    issue_date: date | None
    issue_date_state: ValueState
    issue_date_source: CurrentValueSource
    due_date: date | None
    due_date_state: ValueState
    due_date_source: CurrentValueSource
    currency: str | None
    paid_at: datetime | None
    created_at: datetime
    updated_at: datetime

    @property
    def business_key(self) -> str:
        """Stable public key derived from the immutable category code and period."""
        return str(ObligationKey(category_code=self.category_code, period=self.period))


@dataclass(slots=True)
class ObligationComponent:
    """A structured value that contributes context or amount to an obligation."""

    id: uuid.UUID
    obligation_id: uuid.UUID
    type: str
    label: str
    amount: Decimal | None
    source: str | None
    external_id: str | None
    metadata: dict[str, object] | None
    created_at: datetime
    updated_at: datetime
