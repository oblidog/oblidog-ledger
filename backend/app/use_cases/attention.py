"""Cross-period operational attention; policy is documented in docs/dashboard-attention.md."""

import uuid
from datetime import date, datetime, timedelta
from typing import Literal, cast

from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload, noload

from app.core.business_date import business_today
from app.domain import BusinessCalendar, ObligationLifecycle, ValueState
from app.domain.integrations import IntegrationHealth
from app.models import Category, Integration, Ledger, Obligation
from app.models.base import get_datetime_utc
from app.schemas.attention import (
    AttentionIntegrationPublic,
    AttentionItemPublic,
    AttentionOverviewPublic,
    AttentionReason,
)
from app.services.daily_obligation_report import (
    MISSING_DUE_DATE_DAY,
    PREPARATION_DAYS,
    READY_TO_PAY_DAYS,
)
from app.use_cases.integrations import integration_status

LiteralHealth = Literal["error", "timed_out", "stale"]

UNHEALTHY = {
    IntegrationHealth.ERROR,
    IntegrationHealth.TIMED_OUT,
    IntegrationHealth.STALE,
}


def _horizon_end(today: date, days: int, calendar: BusinessCalendar) -> date:
    cursor = today
    remaining = days
    while cursor < date.max:
        next_day = cursor + timedelta(days=1)
        if calendar.is_business_day(next_day):
            if remaining == 0:
                break
            remaining -= 1
        cursor = next_day
    return cursor


def obligation_reasons(
    item: Obligation, today: date, calendar: BusinessCalendar
) -> list[AttentionReason]:
    if item.lifecycle in {ObligationLifecycle.PAID, ObligationLifecycle.CANCELED}:
        return []
    reasons: list[AttentionReason] = []
    overdue = item.due_date is not None and item.due_date < today
    if overdue:
        reasons.append("overdue")
    if item.lifecycle == ObligationLifecycle.ERROR:
        reasons.append("error")
    period = (item.period_year, item.period_month)
    current_period = (today.year, today.month)
    missing_date_due = item.due_date is None and (
        period < current_period
        or (
            period == current_period
            and today
            >= calendar.nth_business_day_of_month(
                year=today.year, month=today.month, n=MISSING_DUE_DATE_DAY
            )
        )
    )
    horizon = (
        READY_TO_PAY_DAYS
        if item.lifecycle == ObligationLifecycle.READY
        else PREPARATION_DAYS
    )
    upcoming = (
        item.due_date is not None
        and item.due_date >= today
        and (item.due_date <= _horizon_end(today, horizon, calendar))
    )
    incomplete = (
        item.lifecycle
        in {ObligationLifecycle.DRAFT, ObligationLifecycle.COLLECTING_DATA}
        or item.current_amount is None
        or item.amount_state == ValueState.UNKNOWN
        or item.due_date is None
        or item.due_date_state == ValueState.UNKNOWN
    )
    if incomplete and (overdue or upcoming or missing_date_due or "error" in reasons):
        reasons.append("incomplete")
    if upcoming:
        reasons.append("upcoming")
    return reasons


def get_attention_overview(
    *,
    session: Session,
    ledger: Ledger,
    offset: int,
    limit: int,
    today: date | None = None,
    now: datetime | None = None,
) -> AttentionOverviewPublic:
    today = today or business_today()
    now = now or get_datetime_utc()
    calendar = BusinessCalendar(ledger.business_calendar_country)
    obligations = session.scalars(
        select(Obligation)
        .join(Category, Obligation.category_id == Category.id)
        .where(
            Obligation.ledger_id == ledger.id,
            Category.is_active.is_(True),
            Category.archived_at.is_(None),
            Obligation.lifecycle.not_in(
                (ObligationLifecycle.PAID, ObligationLifecycle.CANCELED)
            ),
        )
        .options(joinedload(Obligation.category))
        .order_by(
            Obligation.period_year.desc(), Obligation.period_month.desc(), Obligation.id
        )
    )
    items: list[AttentionItemPublic] = []
    # Correlation is solely the real category relation, never inferred causality.
    by_category: dict[uuid.UUID, AttentionItemPublic] = {}
    for item in obligations:
        reasons = obligation_reasons(item, today, calendar)
        if not reasons:
            continue
        row = AttentionItemPublic(
            key=item.business_key,
            name=item.category.name,
            category_code=item.category.code,
            year=item.period_year,
            month=item.period_month,
            due_date=item.due_date,
            due_date_state=item.due_date_state,
            amount=item.current_amount,
            amount_state=item.amount_state,
            currency=item.currency,
            reasons=reasons,
        )
        items.append(row)
        if "error" in reasons or "incomplete" in reasons:
            by_category.setdefault(item.category_id, row)
    integrations = session.scalars(
        select(Integration)
        .join(Category, Integration.category_id == Category.id)
        .where(
            Integration.ledger_id == ledger.id,
            Integration.enabled.is_(True),
            Category.is_active.is_(True),
            Category.archived_at.is_(None),
        )
        .options(noload(Integration.credentials))
        .order_by(Integration.name, Integration.id)
    )
    for integration in integrations:
        _, _, health = integration_status(integration, now)
        if health not in UNHEALTHY:
            continue
        problem = AttentionIntegrationPublic(
            id=integration.id,
            name=integration.name,
            health=cast("LiteralHealth", health.value),
        )
        related_row = by_category.get(integration.category_id)
        if related_row is None:
            related_row = AttentionItemPublic(
                key=f"integration:{integration.id}", name=integration.name
            )
            items.append(related_row)
        related_row.integrations.append(problem)

    def order(row: AttentionItemPublic) -> tuple[int, date, str, str]:
        priority = (
            0
            if "overdue" in row.reasons
            else 1
            if "error" in row.reasons
            else 2
            if row.integrations
            else 3
            if "incomplete" in row.reasons
            else 4
        )
        return priority, row.due_date or date.max, row.name.casefold(), row.key

    items.sort(key=order)
    return AttentionOverviewPublic(
        as_of_date=today,
        items=items[offset : offset + limit],
        total=len(items),
        offset=offset,
        limit=limit,
    )
