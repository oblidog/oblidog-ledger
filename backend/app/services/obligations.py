from __future__ import annotations

import uuid
from calendar import monthrange
from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.domain import (
    BillingPeriod,
    CurrentValueSource,
    EffectiveValueSourceMode,
    ObligationLifecycle,
    ValueState,
)
from app.models import Category, Obligation


def _due_date_for_period(*, category: Category, period: BillingPeriod) -> date | None:
    if category.first_due_date is None:
        return None

    due_date = date(
        period.year,
        period.month,
        min(category.first_due_date.day, monthrange(period.year, period.month)[1]),
    )
    while due_date.weekday() >= 5:
        due_date -= timedelta(days=1)
    return due_date


def get_or_create_obligation(
    *,
    session: Session,
    category: Category,
    period: BillingPeriod,
    lifecycle: ObligationLifecycle = ObligationLifecycle.DRAFT,
) -> tuple[Obligation, bool]:
    obligation = session.scalar(
        select(Obligation).where(
            Obligation.ledger_id == category.ledger_id,
            Obligation.category_id == category.id,
            Obligation.period_year == period.year,
            Obligation.period_month == period.month,
        )
    )
    if obligation is not None:
        return obligation, False

    due_date = _due_date_for_period(category=category, period=period)

    obligation = Obligation(
        ledger_id=category.ledger_id,
        category_id=category.id,
        counterparty_id=category.counterparty_id,
        lifecycle=lifecycle,
        period_year=period.year,
        period_month=period.month,
        effective_value_source=(
            EffectiveValueSourceMode.AUTOMATIC
            if due_date is not None
            else EffectiveValueSourceMode.UNKNOWN
        ),
        current_amount=None,
        amount_state=ValueState.UNKNOWN,
        amount_source=CurrentValueSource.UNKNOWN,
        issue_date=None,
        issue_date_state=ValueState.UNKNOWN,
        issue_date_source=CurrentValueSource.UNKNOWN,
        due_date=due_date,
        due_date_state=(
            ValueState.ESTIMATED if due_date is not None else ValueState.UNKNOWN
        ),
        due_date_source=(
            CurrentValueSource.AUTOMATIC
            if due_date is not None
            else CurrentValueSource.UNKNOWN
        ),
        currency=category.currency,
    )
    try:
        with session.begin_nested():
            session.add(obligation)
            session.flush()
    except IntegrityError:
        obligation = session.scalar(
            select(Obligation).where(
                Obligation.ledger_id == category.ledger_id,
                Obligation.category_id == category.id,
                Obligation.period_year == period.year,
                Obligation.period_month == period.month,
            )
        )
        if obligation is None:
            raise
        return obligation, False

    return obligation, True


def ensure_obligations_for_period(
    *,
    session: Session,
    ledger_id: uuid.UUID,
    current_period: BillingPeriod,
) -> list[Obligation]:
    categories = session.scalars(
        select(Category).where(
            Category.ledger_id == ledger_id,
            Category.is_active.is_(True),
        )
    ).all()

    created: list[Obligation] = []
    for category in categories:
        for period in (current_period, current_period.next()):
            if not category.occurs_in(period):
                continue
            obligation, was_created = get_or_create_obligation(
                session=session,
                category=category,
                period=period,
                lifecycle=(
                    ObligationLifecycle.COLLECTING_DATA
                    if period == current_period
                    else ObligationLifecycle.DRAFT
                ),
            )
            if was_created:
                created.append(obligation)

    return created


def estimate_missing_obligation_amounts(
    *, session: Session, ledger_id: uuid.UUID, current_period: BillingPeriod
) -> list[Obligation]:
    next_period = current_period.next()
    targets = session.scalars(
        select(Obligation).where(
            Obligation.ledger_id == ledger_id,
            (
                (Obligation.period_year == current_period.year)
                & (Obligation.period_month == current_period.month)
            )
            | (
                (Obligation.period_year == next_period.year)
                & (Obligation.period_month == next_period.month)
            ),
            (
                (Obligation.current_amount.is_(None))
                & (Obligation.amount_state == ValueState.UNKNOWN)
            )
            | (
                (Obligation.amount_state == ValueState.ESTIMATED)
                & (Obligation.amount_source == CurrentValueSource.AUTOMATIC)
            ),
        )
    ).all()
    updated: list[Obligation] = []
    for obligation in targets:
        values = [
            value
            for value in session.scalars(
                select(Obligation.current_amount)
                .where(
                    Obligation.ledger_id == ledger_id,
                    Obligation.category_id == obligation.category_id,
                    Obligation.current_amount.is_not(None),
                    Obligation.amount_state.in_(
                        (ValueState.CONFIRMED, ValueState.OVERRIDDEN)
                    ),
                    (Obligation.period_year < obligation.period_year)
                    | (
                        (Obligation.period_year == obligation.period_year)
                        & (Obligation.period_month < obligation.period_month)
                    ),
                )
                .order_by(Obligation.period_year.desc(), Obligation.period_month.desc())
                .limit(12)
            ).all()
            if value is not None
        ]
        if not values:
            continue
        values.sort()
        middle = len(values) // 2
        median = (
            values[middle]
            if len(values) % 2
            else (values[middle - 1] + values[middle]) / 2
        )
        obligation.current_amount = median.quantize(
            Decimal("0.01"), rounding=ROUND_HALF_UP
        )
        obligation.amount_state = ValueState.ESTIMATED
        obligation.amount_source = CurrentValueSource.AUTOMATIC
        updated.append(obligation)
    return updated
