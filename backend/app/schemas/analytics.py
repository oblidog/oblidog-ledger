import uuid
from datetime import date
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel

from app.schemas.obligations import ObligationPeriodPublic


class CurrencyPaymentSummaryPublic(BaseModel):
    """Amounts are grouped by currency and are never converted or combined."""

    currency: str | None
    total_known_amount: Decimal
    paid_known_amount: Decimal
    paid_percentage: Decimal | None


class PeriodPaymentSummaryPublic(BaseModel):
    """Payment progress across all non-canceled obligations in the period.

    Amount summaries include known values from draft, collecting data, ready,
    paid, and error obligations. Missing values are reported by
    ``unknown_amount_count`` and excluded from amount totals.
    """

    period: ObligationPeriodPublic
    total_obligation_count: int
    paid_obligation_count: int
    paid_percentage: Decimal | None
    unknown_amount_count: int
    is_complete: bool
    amount_summaries: list[CurrencyPaymentSummaryPublic]


class CategoryAmountHistoryPointPublic(BaseModel):
    """A period's amount, keeping missing and unknown values distinct."""

    period: ObligationPeriodPublic
    state: Literal["missing", "unknown", "known"]
    current_amount: Decimal | None
    currency: str | None


class CategoryAmountHistoryPublic(BaseModel):
    category_id: uuid.UUID
    points: list[CategoryAmountHistoryPointPublic]


class CurrencyPeriodTotalPublic(BaseModel):
    """Known amounts are grouped by currency and are never converted or combined."""

    currency: str | None
    total_known_amount: Decimal


class ObligationPeriodTotalPublic(BaseModel):
    """One continuous chart point; unknown amounts are not represented as zero."""

    period: ObligationPeriodPublic
    total_obligation_count: int
    unknown_amount_count: int
    is_complete: bool
    currency_summaries: list[CurrencyPeriodTotalPublic]


class ObligationPeriodTotalsPublic(BaseModel):
    points: list[ObligationPeriodTotalPublic]


class DailyCashflowPublic(BaseModel):
    due_date: date
    amount: Decimal
    cumulative_amount: Decimal
    is_overdue: bool


class CurrencyCashflowPublic(BaseModel):
    """Amounts are grouped by currency and are never converted or combined."""

    currency: str | None
    total_known_amount: Decimal
    scheduled_known_amount: Decimal
    unscheduled_known_amount: Decimal
    overdue_known_amount: Decimal
    daily: list[DailyCashflowPublic]


class PeriodCashflowPublic(BaseModel):
    period: ObligationPeriodPublic
    as_of_date: date
    unknown_amount_count: int
    without_due_date_count: int
    is_complete: bool
    currency_summaries: list[CurrencyCashflowPublic]
