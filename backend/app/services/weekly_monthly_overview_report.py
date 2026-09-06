"""Weekly current-month overview email report."""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal
from typing import TYPE_CHECKING

from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.core.config import settings
from app.domain import BillingPeriod, ObligationLifecycle, ValueState
from app.models import Ledger, LedgerMembership, Obligation, User
from app.use_cases.analytics import (
    get_obligation_period_totals,
    summarize_period_payment_progress,
)
from app.utils import EmailData, render_email_template

if TYPE_CHECKING:
    from app.use_cases.system_runs import SystemRunContext

CONFIRMED_STATES = {ValueState.CONFIRMED, ValueState.OVERRIDDEN}


@dataclass(frozen=True, slots=True)
class UpcomingObligation:
    category_name: str
    due_date: date
    amount: Decimal | None


@dataclass(frozen=True, slots=True)
class CurrencyOverview:
    currency: str | None
    total_known_amount: Decimal
    paid_known_amount: Decimal
    remaining_known_amount: Decimal
    ready_count: int
    paid_count: int
    not_ready_count: int
    overdue_count: int
    overdue_known_amount: Decimal
    paid_percentage: Decimal | None
    incomplete_count: int
    total_is_complete: bool
    previous_total_known_amount: Decimal
    previous_total_is_complete: bool
    total_change: Decimal | None
    upcoming: list[UpcomingObligation]


@dataclass(frozen=True, slots=True)
class LedgerOverview:
    ledger_name: str
    currencies: list[CurrencyOverview]


class WeeklyMonthlyOverviewReport:
    report_type = "weekly_monthly_overview"

    def recipients(self, *, session: Session, context: SystemRunContext) -> list[User]:
        return list(
            session.scalars(
                select(User)
                .join(LedgerMembership, LedgerMembership.user_id == User.id)
                .join(Ledger, Ledger.id == LedgerMembership.ledger_id)
                .where(User.is_active, Ledger.is_active)
                .distinct()
                .order_by(User.id)
            )
        )

    def delivery_key(self, *, user: User, context: SystemRunContext) -> str:
        iso_year, iso_week, _ = context.business_date.isocalendar()
        return f"weekly:{user.id}:{iso_year}-W{iso_week:02d}"

    def render(
        self, *, session: Session, user: User, context: SystemRunContext
    ) -> EmailData | None:
        # System Run is daily; this report owns the weekly cadence while
        # ReportDelivery guarantees one successful delivery per ISO week.
        if context.business_date.weekday() != 0:
            return None

        overviews = _build_user_overviews(
            session=session, user=user, report_date=context.business_date
        )
        template_context = {
            "project_name": settings.PROJECT_NAME,
            "report_date": context.business_date.isoformat(),
            "period": f"{context.business_date.year:04d}-{context.business_date.month:02d}",
            "ledgers": overviews,
        }
        return EmailData(
            subject=f"{settings.PROJECT_NAME} - Weekly monthly overview",
            html_content=render_email_template(
                template_name="weekly_monthly_overview_report.html",
                context=template_context,
            ),
            text_content=render_email_template(
                template_name="weekly_monthly_overview_report.txt",
                context=template_context,
            ),
        )


def _build_user_overviews(
    *, session: Session, user: User, report_date: date
) -> list[LedgerOverview]:
    ledgers = list(
        session.scalars(
            select(Ledger)
            .join(LedgerMembership, LedgerMembership.ledger_id == Ledger.id)
            .where(LedgerMembership.user_id == user.id, Ledger.is_active)
            .order_by(Ledger.name, Ledger.id)
        )
    )
    period = BillingPeriod.from_date(report_date)
    previous_period = _previous_period(period)
    result: list[LedgerOverview] = []

    for ledger in ledgers:
        obligations = list(
            session.scalars(
                select(Obligation)
                .where(
                    Obligation.ledger_id == ledger.id,
                    Obligation.period_year == period.year,
                    Obligation.period_month == period.month,
                    Obligation.lifecycle != ObligationLifecycle.CANCELED,
                )
                .options(joinedload(Obligation.category))
            ).unique()
        )
        payment = summarize_period_payment_progress(
            session=session, ledger_id=ledger.id, period=period
        )
        totals = get_obligation_period_totals(
            session=session,
            ledger_id=ledger.id,
            from_period=previous_period,
            to_period=period,
        )
        current_point, previous_point = totals.points[1], totals.points[0]
        current_totals = {
            item.currency: item.total_known_amount for item in current_point.currency_summaries
        }
        previous_totals = {
            item.currency: item.total_known_amount for item in previous_point.currency_summaries
        }
        paid_totals = {
            item.currency: item.paid_known_amount for item in payment.amount_summaries
        }
        currencies = sorted(
            {item.currency for item in obligations}
            | set(current_totals)
            | set(previous_totals),
            key=lambda value: value or "",
        )
        overviews = [
            _summarize_currency(
                obligations=[item for item in obligations if item.currency == currency],
                currency=currency,
                report_date=report_date,
                current_total=current_totals.get(currency, Decimal("0.00")),
                paid_total=paid_totals.get(currency, Decimal("0.00")),
                previous_total=previous_totals.get(currency, Decimal("0.00")),
                current_complete=current_point.is_complete,
                previous_complete=previous_point.is_complete,
            )
            for currency in currencies
        ]
        result.append(LedgerOverview(ledger_name=ledger.name, currencies=overviews))
    return result


def _summarize_currency(
    *,
    obligations: list[Obligation],
    currency: str | None,
    report_date: date,
    current_total: Decimal,
    paid_total: Decimal,
    previous_total: Decimal,
    current_complete: bool,
    previous_complete: bool,
) -> CurrencyOverview:
    paid_count = sum(item.lifecycle is ObligationLifecycle.PAID for item in obligations)
    ready_count = sum(item.lifecycle is ObligationLifecycle.READY for item in obligations)
    not_ready_count = sum(
        item.lifecycle not in {ObligationLifecycle.READY, ObligationLifecycle.PAID}
        for item in obligations
    )
    overdue = [
        item
        for item in obligations
        if item.lifecycle is not ObligationLifecycle.PAID
        and item.due_date is not None
        and item.due_date < report_date
    ]
    overdue_known_amount = sum(
        (item.current_amount for item in overdue if item.current_amount is not None),
        Decimal("0.00"),
    )
    upcoming_end = report_date + timedelta(days=7)
    upcoming = [
        UpcomingObligation(
            category_name=item.category.name,
            due_date=item.due_date,
            amount=item.current_amount,
        )
        for item in obligations
        if item.lifecycle is not ObligationLifecycle.PAID
        and item.due_date is not None
        and report_date <= item.due_date <= upcoming_end
    ]
    upcoming.sort(key=lambda item: (item.due_date, item.category_name))
    incomplete_count = sum(
        item.amount_state not in CONFIRMED_STATES
        or item.due_date_state not in CONFIRMED_STATES
        for item in obligations
    )
    paid_percentage = (
        (Decimal(paid_count) * Decimal("100") / Decimal(len(obligations))).quantize(
            Decimal("0.01")
        )
        if obligations
        else None
    )
    return CurrencyOverview(
        currency=currency,
        total_known_amount=current_total,
        paid_known_amount=paid_total,
        remaining_known_amount=current_total - paid_total,
        ready_count=ready_count,
        paid_count=paid_count,
        not_ready_count=not_ready_count,
        overdue_count=len(overdue),
        overdue_known_amount=overdue_known_amount,
        paid_percentage=paid_percentage,
        incomplete_count=incomplete_count,
        total_is_complete=current_complete,
        previous_total_known_amount=previous_total,
        previous_total_is_complete=previous_complete,
        total_change=(current_total - previous_total)
        if current_complete and previous_complete
        else None,
        upcoming=upcoming,
    )


def _previous_period(period: BillingPeriod) -> BillingPeriod:
    if period.month == 1:
        return BillingPeriod(period.year - 1, 12)
    return BillingPeriod(period.year, period.month - 1)
