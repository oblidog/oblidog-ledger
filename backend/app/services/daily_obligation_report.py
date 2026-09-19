"""Conditional daily obligation digest."""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta, tzinfo
from decimal import Decimal
from typing import TYPE_CHECKING

from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload, noload

from app.core.config import settings
from app.domain import BillingPeriod, BusinessCalendar, ObligationLifecycle, ValueState
from app.domain.integrations import IntegrationExecutionState, IntegrationHealth
from app.models import (
    Integration,
    Ledger,
    LedgerMembership,
    Obligation,
    ObligationActionLog,
    User,
)
from app.use_cases.integrations import integration_status
from app.utils import EmailData, render_email_template

if TYPE_CHECKING:
    from app.use_cases.system_runs import SystemRunContext

PREPARATION_DAYS = 3
READY_TO_PAY_DAYS = 2
MISSING_DUE_DATE_DAY = 5
MAX_ACTIVITY_LOGS = 500
MAX_ACTIVITY_GROUPS = 50
MAX_ACTIVITY_MESSAGES_PER_GROUP = 5
MAX_UNHEALTHY_INTEGRATIONS = 50
REPORTED_INTEGRATION_HEALTH = {
    IntegrationHealth.ERROR,
    IntegrationHealth.TIMED_OUT,
    IntegrationHealth.STALE,
}


@dataclass(frozen=True, slots=True)
class DailyReportItem:
    ledger_name: str
    category_name: str
    due_date: date | None
    amount: Decimal | None
    currency: str | None
    amount_state: ValueState
    due_date_state: ValueState
    link: str


@dataclass(frozen=True, slots=True)
class DailyActivityItem:
    ledger_name: str
    category_name: str
    actor_name: str
    messages: tuple[str, ...]
    omitted_changes: int
    link: str


@dataclass(frozen=True, slots=True)
class IntegrationHealthItem:
    ledger_name: str
    integration_name: str
    health: IntegrationHealth
    detail: str
    last_success_at: str | None
    link: str


class DailyObligationReport:
    report_type = "daily_obligations"

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
        return f"daily:{user.id}:{context.business_date.isoformat()}"

    def render(
        self, *, session: Session, user: User, context: SystemRunContext
    ) -> EmailData | None:
        sections = _select_sections(
            session=session, user=user, report_date=context.business_date
        )
        activity, activity_truncated = _select_activity(
            session=session, user=user, context=context
        )
        integration_health, integration_health_truncated = _select_integration_health(
            session=session, user=user, context=context
        )
        if not any(sections.values()) and not activity and not integration_health:
            return None
        rendered = {
            name: _group_by_ledger(items) for name, items in sections.items() if items
        }
        template_context = {
            "project_name": settings.PROJECT_NAME,
            "report_date": context.business_date.isoformat(),
            "sections": rendered,
            "activity": _group_activity_by_ledger(activity),
            "activity_truncated": activity_truncated,
            "integration_health": _group_integration_health_by_ledger(
                integration_health
            ),
            "integration_health_truncated": integration_health_truncated,
        }
        return EmailData(
            subject=f"{settings.PROJECT_NAME} - Daily obligation report",
            html_content=render_email_template(
                template_name="daily_obligation_report.html", context=template_context
            ),
            text_content=render_email_template(
                template_name="daily_obligation_report.txt", context=template_context
            ),
        )


def _select_sections(
    *, session: Session, user: User, report_date: date
) -> dict[str, list[DailyReportItem]]:
    period = BillingPeriod.from_date(report_date)
    calendar = BusinessCalendar(settings.BUSINESS_CALENDAR_COUNTRY)
    obligations = session.scalars(
        select(Obligation)
        .join(LedgerMembership, LedgerMembership.ledger_id == Obligation.ledger_id)
        .join(Ledger, Ledger.id == Obligation.ledger_id)
        .where(LedgerMembership.user_id == user.id, Ledger.is_active)
        .options(joinedload(Obligation.ledger), joinedload(Obligation.category))
    ).unique()
    sections: dict[str, list[DailyReportItem]] = defaultdict(list)
    for obligation in obligations:
        section = _section_for(obligation, report_date, period, calendar)
        if section is not None:
            sections[section].append(_item(obligation))
    return sections


def _section_for(
    obligation: Obligation,
    report_date: date,
    period: BillingPeriod,
    calendar: BusinessCalendar,
) -> str | None:
    if obligation.lifecycle in {ObligationLifecycle.PAID, ObligationLifecycle.CANCELED}:
        return None
    if obligation.lifecycle is ObligationLifecycle.ERROR:
        return "errors"
    if obligation.due_date is not None and obligation.due_date < report_date:
        return "overdue"
    if obligation.lifecycle is ObligationLifecycle.READY:
        if (
            obligation.due_date is not None
            and calendar.business_days_until(start=report_date, end=obligation.due_date)
            <= READY_TO_PAY_DAYS
        ):
            return "ready_to_pay"
        return None
    if obligation.due_date is None:
        if (obligation.period_year, obligation.period_month) == (
            period.year,
            period.month,
        ) and report_date >= calendar.nth_business_day_of_month(
            year=period.year, month=period.month, n=MISSING_DUE_DATE_DAY
        ):
            return "missing_due_date"
        return None
    if (
        calendar.business_days_until(start=report_date, end=obligation.due_date)
        <= PREPARATION_DAYS
    ):
        return "needs_preparation"
    return None


def _item(obligation: Obligation) -> DailyReportItem:
    return DailyReportItem(
        ledger_name=obligation.ledger.name,
        category_name=obligation.category.name,
        due_date=obligation.due_date,
        amount=obligation.current_amount,
        currency=obligation.currency,
        amount_state=obligation.amount_state,
        due_date_state=obligation.due_date_state,
        link=f"{settings.FRONTEND_HOST}/ledgers/{obligation.ledger_id}/obligations/{obligation.id}",
    )


def _group_by_ledger(items: list[DailyReportItem]) -> dict[str, list[DailyReportItem]]:
    grouped: dict[str, list[DailyReportItem]] = defaultdict(list)
    for item in items:
        grouped[item.ledger_name].append(item)
    return dict(grouped)


def _activity_window(context: SystemRunContext) -> tuple[datetime, datetime]:
    """Return the last complete local calendar day as a retry-stable window."""
    end_local = datetime.combine(context.business_date, time.min, context.timezone)
    start_local = end_local - timedelta(days=1)
    return start_local.astimezone(UTC), end_local.astimezone(UTC)


def _select_activity(
    *, session: Session, user: User, context: SystemRunContext
) -> tuple[list[DailyActivityItem], bool]:
    window_start, window_end = _activity_window(context)
    logs = list(
        session.scalars(
            select(ObligationActionLog)
            .join(Obligation, Obligation.id == ObligationActionLog.obligation_id)
            .join(LedgerMembership, LedgerMembership.ledger_id == Obligation.ledger_id)
            .join(Ledger, Ledger.id == Obligation.ledger_id)
            .where(
                LedgerMembership.user_id == user.id,
                Ledger.is_active,
                ObligationActionLog.actor_type.in_(("integration", "user")),
                ObligationActionLog.created_at >= window_start,
                ObligationActionLog.created_at < window_end,
            )
            .options(
                joinedload(ObligationActionLog.obligation).joinedload(
                    Obligation.ledger
                ),
                joinedload(ObligationActionLog.obligation).joinedload(
                    Obligation.category
                ),
            )
            .order_by(ObligationActionLog.created_at, ObligationActionLog.id)
            .limit(MAX_ACTIVITY_LOGS + 1)
        ).unique()
    )
    truncated_logs = len(logs) > MAX_ACTIVITY_LOGS
    logs = logs[:MAX_ACTIVITY_LOGS]

    grouped: dict[tuple[object, object, object, object], list[ObligationActionLog]] = {}
    for log in logs:
        key = (
            log.obligation_id,
            log.actor_type,
            log.actor_id,
            log.run_id or "no-run",
        )
        grouped.setdefault(key, []).append(log)

    items: list[DailyActivityItem] = []
    for group_logs in grouped.values():
        messages = list(
            dict.fromkeys(
                message for log in group_logs for message in _activity_messages(log)
            )
        )
        if not messages:
            continue
        log = group_logs[-1]
        obligation = log.obligation
        visible_messages = tuple(messages[:MAX_ACTIVITY_MESSAGES_PER_GROUP])
        items.append(
            DailyActivityItem(
                ledger_name=obligation.ledger.name,
                category_name=obligation.category.name,
                actor_name=log.actor_display_name,
                messages=visible_messages,
                omitted_changes=len(messages) - len(visible_messages),
                link=(
                    f"{settings.FRONTEND_HOST}/ledgers/{obligation.ledger_id}"
                    f"/obligations/{obligation.id}"
                ),
            )
        )

    truncated_groups = len(items) > MAX_ACTIVITY_GROUPS
    return items[:MAX_ACTIVITY_GROUPS], truncated_logs or truncated_groups


def _activity_messages(log: ObligationActionLog) -> list[str]:
    changes = log.changes
    if log.action == "created":
        return ["Obligation created"]
    if log.action == "marked_paid":
        return ["Payment recognized"]
    if log.action == "marked_ready":
        return ["Marked ready to pay"]
    if log.action == "marked_error":
        return ["Integration marked the obligation as requiring attention"]
    if log.action == "canceled":
        return ["Obligation canceled"]
    if log.action == "reopened":
        return ["Obligation reopened"]
    if log.action == "values_updated":
        return _value_change_messages(changes)
    if log.action == "components_changed":
        return _component_change_messages(changes)
    return []


def _value_change_messages(changes: dict[str, object]) -> list[str]:
    labels = {
        "current_amount": "Amount",
        "issue_date": "Issue date",
        "due_date": "Due date",
    }
    messages: list[str] = []
    for field, label in labels.items():
        diff = changes.get(field)
        if isinstance(diff, dict) and "to" in diff:
            messages.append(
                f"{label} changed: {_display(diff.get('from'))} → {_display(diff['to'])}"
            )
    return messages


def _component_change_messages(changes: dict[str, object]) -> list[str]:
    components = changes.get("components")
    if not isinstance(components, dict):
        return []
    messages: list[str] = []
    for component in components.get("added", []):
        if not isinstance(component, dict):
            continue
        label = str(component.get("label") or "Unnamed component")
        prefix = (
            "New invoice" if component.get("type") == "invoice" else "Component added"
        )
        messages.append(f"{prefix}: {label}{_amount_suffix(component.get('amount'))}")
    for component in components.get("updated", []):
        if not isinstance(component, dict):
            continue
        label = str(component.get("label") or "Unnamed component")
        component_changes = component.get("changes")
        if not isinstance(component_changes, dict):
            continue
        amount = component_changes.get("amount")
        if isinstance(amount, dict) and "to" in amount:
            messages.append(
                f"{label}: amount changed {_display(amount.get('from'))} → "
                f"{_display(amount['to'])}"
            )
        elif component_changes:
            messages.append(f"Component updated: {label}")
    for component in components.get("removed", []):
        if isinstance(component, dict):
            messages.append(
                f"Component removed: {component.get('label') or 'Unnamed component'}"
            )
    return messages


def _amount_suffix(value: object) -> str:
    return "" if value is None else f" ({value})"


def _display(value: object) -> str:
    return "unknown" if value is None else str(value)


def _group_activity_by_ledger(
    items: list[DailyActivityItem],
) -> dict[str, list[DailyActivityItem]]:
    grouped: dict[str, list[DailyActivityItem]] = defaultdict(list)
    for item in items:
        grouped[item.ledger_name].append(item)
    return dict(grouped)


def _select_integration_health(
    *, session: Session, user: User, context: SystemRunContext
) -> tuple[list[IntegrationHealthItem], bool]:
    integrations = list(
        session.execute(
            select(Integration, Ledger.name)
            .join(LedgerMembership, LedgerMembership.ledger_id == Integration.ledger_id)
            .join(Ledger, Ledger.id == Integration.ledger_id)
            .where(LedgerMembership.user_id == user.id, Ledger.is_active)
            .options(noload(Integration.credentials))
            .order_by(Ledger.name, Integration.name, Integration.id)
        )
    )
    items: list[IntegrationHealthItem] = []
    for integration, ledger_name in integrations:
        state, _, health = integration_status(integration, context.effective_at)
        if (
            state is IntegrationExecutionState.NEVER_RUN
            or health not in REPORTED_INTEGRATION_HEALTH
        ):
            continue
        items.append(
            IntegrationHealthItem(
                ledger_name=ledger_name,
                integration_name=integration.name,
                health=health,
                detail=_integration_health_detail(integration, health),
                last_success_at=_local_datetime(
                    integration.last_success_at, context.timezone
                ),
                link=(
                    f"{settings.FRONTEND_HOST}/ledgers/{integration.ledger_id}"
                    f"/integrations/{integration.id}"
                ),
            )
        )
    truncated = len(items) > MAX_UNHEALTHY_INTEGRATIONS
    return items[:MAX_UNHEALTHY_INTEGRATIONS], truncated


def _integration_health_detail(
    integration: Integration, health: IntegrationHealth
) -> str:
    if health is IntegrationHealth.ERROR:
        error = integration.last_error_message or "Last run failed"
        if integration.last_error_code:
            return f"{integration.last_error_code}: {error}"
        return error
    if health is IntegrationHealth.TIMED_OUT:
        return "The current run exceeded its configured timeout"
    return "No completed run within the configured freshness interval"


def _local_datetime(value: datetime | None, timezone: tzinfo) -> str | None:
    if value is None:
        return None
    return value.astimezone(timezone).isoformat(timespec="minutes")


def _group_integration_health_by_ledger(
    items: list[IntegrationHealthItem],
) -> dict[str, list[IntegrationHealthItem]]:
    grouped: dict[str, list[IntegrationHealthItem]] = defaultdict(list)
    for item in items:
        grouped[item.ledger_name].append(item)
    return dict(grouped)
