from __future__ import annotations

import uuid
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date
from decimal import ROUND_HALF_UP, Decimal
from typing import Literal

from sqlalchemy import select, tuple_
from sqlalchemy.orm import Session

from app.domain import BillingPeriod, ObligationLifecycle
from app.models import Category, Obligation
from app.use_cases.exceptions import CategoryNotFoundError


@dataclass(frozen=True, slots=True)
class CurrencyPaymentSummary:
    """Amount progress for obligations expressed in one currency."""

    currency: str | None
    total_known_amount: Decimal
    paid_known_amount: Decimal
    paid_percentage: Decimal | None


@dataclass(frozen=True, slots=True)
class PeriodPaymentSummary:
    """Payment progress for every non-canceled obligation in a ledger period.

    Counts include obligations in every non-canceled lifecycle. Known amounts from
    those obligations contribute to their currency summary; missing amounts are
    counted as unknown and excluded from amount totals.
    """

    total_obligation_count: int
    paid_obligation_count: int
    paid_percentage: Decimal | None
    unknown_amount_count: int
    is_complete: bool
    amount_summaries: list[CurrencyPaymentSummary]


def is_obligation_paid(obligation: Obligation) -> bool:
    """Return whether an obligation is paid according to the domain lifecycle."""

    return obligation.lifecycle is ObligationLifecycle.PAID


def summarize_period_payment_progress(
    *, session: Session, ledger_id: uuid.UUID, period: BillingPeriod
) -> PeriodPaymentSummary:
    """Read payment progress for one ledger period without combining currencies."""

    obligations = list(
        session.scalars(
            select(Obligation).where(
                Obligation.ledger_id == ledger_id,
                Obligation.period_year == period.year,
                Obligation.period_month == period.month,
                Obligation.lifecycle != ObligationLifecycle.CANCELED,
            )
        )
    )
    total_obligation_count = len(obligations)
    paid_obligation_count = sum(is_obligation_paid(item) for item in obligations)
    unknown_amount_count = sum(item.current_amount is None for item in obligations)
    amounts_by_currency: defaultdict[str | None, list[Decimal]] = defaultdict(
        lambda: [Decimal("0.00"), Decimal("0.00")]
    )

    for obligation in obligations:
        if obligation.current_amount is None:
            continue
        amounts = amounts_by_currency[obligation.currency]
        amounts[0] += obligation.current_amount
        if is_obligation_paid(obligation):
            amounts[1] += obligation.current_amount

    return PeriodPaymentSummary(
        total_obligation_count=total_obligation_count,
        paid_obligation_count=paid_obligation_count,
        paid_percentage=_percentage(paid_obligation_count, total_obligation_count),
        unknown_amount_count=unknown_amount_count,
        is_complete=unknown_amount_count == 0,
        amount_summaries=[
            CurrencyPaymentSummary(
                currency=currency,
                total_known_amount=amounts[0],
                paid_known_amount=amounts[1],
                paid_percentage=_percentage(amounts[1], amounts[0]),
            )
            for currency, amounts in sorted(
                amounts_by_currency.items(), key=lambda item: item[0] or ""
            )
        ],
    )


def _percentage(numerator: Decimal | int, denominator: Decimal | int) -> Decimal | None:
    if denominator == 0:
        return None
    if numerator == 0:
        return Decimal("0")
    percentage = (Decimal(numerator) * Decimal("100") / Decimal(denominator)).quantize(
        Decimal("0.01"), rounding=ROUND_HALF_UP
    )
    return (
        percentage.quantize(Decimal("1"))
        if percentage == percentage.to_integral()
        else percentage
    )


HistoryPointState = Literal["missing", "unknown", "known"]


@dataclass(frozen=True, slots=True)
class CategoryAmountHistoryPoint:
    period: BillingPeriod
    state: HistoryPointState
    current_amount: Decimal | None
    currency: str | None


@dataclass(frozen=True, slots=True)
class CategoryAmountHistory:
    category_id: uuid.UUID
    points: list[CategoryAmountHistoryPoint]


def get_category_amount_history(
    *,
    session: Session,
    ledger_id: uuid.UUID,
    category_id: uuid.UUID,
    from_period: BillingPeriod,
    to_period: BillingPeriod,
) -> CategoryAmountHistory:
    """Return a continuous, currency-preserving amount history for a category."""

    if (from_period.year, from_period.month) > (to_period.year, to_period.month):
        raise ValueError("from period must not be after to period")

    category = session.scalar(
        select(Category).where(
            Category.id == category_id, Category.ledger_id == ledger_id
        )
    )
    if category is None:
        raise CategoryNotFoundError

    obligations = session.scalars(
        select(Obligation).where(
            Obligation.ledger_id == ledger_id,
            Obligation.category_id == category_id,
            tuple_(Obligation.period_year, Obligation.period_month).between(
                (from_period.year, from_period.month),
                (to_period.year, to_period.month),
            ),
        )
    )
    obligations_by_period = {
        (obligation.period_year, obligation.period_month): obligation
        for obligation in obligations
    }

    points: list[CategoryAmountHistoryPoint] = []
    period = from_period
    while period != to_period.next():
        obligation = obligations_by_period.get((period.year, period.month))
        if obligation is None:
            points.append(
                CategoryAmountHistoryPoint(
                    period=period,
                    state="missing",
                    current_amount=None,
                    currency=category.currency,
                )
            )
        elif obligation.current_amount is None:
            points.append(
                CategoryAmountHistoryPoint(
                    period=period,
                    state="unknown",
                    current_amount=None,
                    currency=obligation.currency,
                )
            )
        else:
            points.append(
                CategoryAmountHistoryPoint(
                    period=period,
                    state="known",
                    current_amount=obligation.current_amount,
                    currency=obligation.currency,
                )
            )
        period = period.next()

    return CategoryAmountHistory(category_id=category.id, points=points)


@dataclass(frozen=True, slots=True)
class CurrencyPeriodTotal:
    """Known obligation amount for one currency in a ledger period."""

    currency: str | None
    total_known_amount: Decimal


@dataclass(frozen=True, slots=True)
class ObligationPeriodTotal:
    """A chart point which keeps unknown values and currencies explicit."""

    period: BillingPeriod
    total_obligation_count: int
    unknown_amount_count: int
    is_complete: bool
    currency_summaries: list[CurrencyPeriodTotal]


@dataclass(frozen=True, slots=True)
class ObligationPeriodTotals:
    """Continuous, currency-preserving totals for a ledger period range."""

    points: list[ObligationPeriodTotal]


def get_obligation_period_totals(
    *,
    session: Session,
    ledger_id: uuid.UUID,
    from_period: BillingPeriod,
    to_period: BillingPeriod,
) -> ObligationPeriodTotals:
    """Return continuous totals without converting or combining currencies."""

    if (from_period.year, from_period.month) > (to_period.year, to_period.month):
        raise ValueError("from period must not be after to period")

    obligations = list(
        session.scalars(
            select(Obligation).where(
                Obligation.ledger_id == ledger_id,
                Obligation.lifecycle != ObligationLifecycle.CANCELED,
                tuple_(Obligation.period_year, Obligation.period_month).between(
                    (from_period.year, from_period.month),
                    (to_period.year, to_period.month),
                ),
            )
        )
    )
    currencies = {item.currency for item in obligations}
    obligations_by_period: defaultdict[tuple[int, int], list[Obligation]] = defaultdict(
        list
    )
    for obligation in obligations:
        obligations_by_period[(obligation.period_year, obligation.period_month)].append(
            obligation
        )

    points: list[ObligationPeriodTotal] = []
    period = from_period
    while period != to_period.next():
        period_obligations = obligations_by_period[(period.year, period.month)]
        amounts_by_currency: defaultdict[str | None, Decimal] = defaultdict(
            lambda: Decimal("0.00")
        )
        for obligation in period_obligations:
            if obligation.current_amount is not None:
                amounts_by_currency[obligation.currency] += obligation.current_amount
        points.append(
            ObligationPeriodTotal(
                period=period,
                total_obligation_count=len(period_obligations),
                unknown_amount_count=sum(
                    item.current_amount is None for item in period_obligations
                ),
                is_complete=all(
                    item.current_amount is not None for item in period_obligations
                ),
                currency_summaries=[
                    CurrencyPeriodTotal(
                        currency=currency,
                        total_known_amount=amounts_by_currency[currency],
                    )
                    for currency in sorted(currencies, key=lambda item: item or "")
                ],
            )
        )
        period = period.next()

    return ObligationPeriodTotals(points=points)


@dataclass(frozen=True, slots=True)
class DailyCashflow:
    due_date: date
    amount: Decimal
    cumulative_amount: Decimal
    is_overdue: bool


@dataclass(frozen=True, slots=True)
class CurrencyCashflow:
    currency: str | None
    total_known_amount: Decimal
    scheduled_known_amount: Decimal
    unscheduled_known_amount: Decimal
    overdue_known_amount: Decimal
    daily: list[DailyCashflow]


@dataclass(frozen=True, slots=True)
class PeriodCashflow:
    as_of_date: date
    unknown_amount_count: int
    without_due_date_count: int
    is_complete: bool
    currency_summaries: list[CurrencyCashflow]


@dataclass(slots=True)
class _CashflowAccumulator:
    total: Decimal = Decimal("0.00")
    scheduled: Decimal = Decimal("0.00")
    unscheduled: Decimal = Decimal("0.00")
    overdue: Decimal = Decimal("0.00")
    by_date: defaultdict[date, Decimal] = field(
        default_factory=lambda: defaultdict(lambda: Decimal("0.00"))
    )


def get_remaining_period_cashflow(
    *, session: Session, ledger_id: uuid.UUID, period: BillingPeriod
) -> PeriodCashflow:
    """Read unpaid scheduled outflow without treating unknown amounts as zero."""

    obligations = list(
        session.scalars(
            select(Obligation).where(
                Obligation.ledger_id == ledger_id,
                Obligation.period_year == period.year,
                Obligation.period_month == period.month,
                Obligation.lifecycle.not_in(
                    (ObligationLifecycle.PAID, ObligationLifecycle.CANCELED)
                ),
            )
        )
    )
    as_of_date = date.today()
    unknown_amount_count = sum(item.current_amount is None for item in obligations)
    without_due_date_count = sum(item.due_date is None for item in obligations)
    amounts_by_currency: defaultdict[str | None, _CashflowAccumulator] = defaultdict(
        _CashflowAccumulator
    )

    for obligation in obligations:
        if obligation.current_amount is None:
            continue
        summary = amounts_by_currency[obligation.currency]
        summary.total += obligation.current_amount
        if obligation.due_date is None:
            summary.unscheduled += obligation.current_amount
            continue
        summary.scheduled += obligation.current_amount
        if obligation.due_date < as_of_date:
            summary.overdue += obligation.current_amount
        summary.by_date[obligation.due_date] += obligation.current_amount

    return PeriodCashflow(
        as_of_date=as_of_date,
        unknown_amount_count=unknown_amount_count,
        without_due_date_count=without_due_date_count,
        is_complete=unknown_amount_count == 0 and without_due_date_count == 0,
        currency_summaries=[
            _to_currency_cashflow(
                currency=currency, summary=summary, as_of_date=as_of_date
            )
            for currency, summary in sorted(
                amounts_by_currency.items(), key=lambda item: item[0] or ""
            )
        ],
    )


def _to_currency_cashflow(
    *, currency: str | None, summary: _CashflowAccumulator, as_of_date: date
) -> CurrencyCashflow:
    cumulative_amount = Decimal("0.00")
    daily: list[DailyCashflow] = []
    for due_date, amount in sorted(summary.by_date.items()):
        cumulative_amount += amount
        daily.append(
            DailyCashflow(
                due_date=due_date,
                amount=amount,
                cumulative_amount=cumulative_amount,
                is_overdue=due_date < as_of_date,
            )
        )
    return CurrencyCashflow(
        currency=currency,
        total_known_amount=summary.total,
        scheduled_known_amount=summary.scheduled,
        unscheduled_known_amount=summary.unscheduled,
        overdue_known_amount=summary.overdue,
        daily=daily,
    )
