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
from app.email_i18n import EmailLocale, Language, recipient_language
from app.models import (
    Integration,
    Ledger,
    LedgerMembership,
    Obligation,
    ObligationActionLog,
    User,
)
from app.services.daily_digest_presentation import build_daily_digest
from app.services.daily_digest_rendering import render_daily_digest
from app.use_cases.integrations import integration_status
from app.utils import EmailData

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
                .where(User.is_active, Ledger.is_active, User.daily_report_enabled)
                .distinct()
                .order_by(User.id)
            )
        )

    def delivery_key(self, *, user: User, context: SystemRunContext) -> str:
        return f"daily:{user.id}:{context.business_date.isoformat()}"

    def render(
        self, *, session: Session, user: User, context: SystemRunContext
    ) -> EmailData | None:
        language = recipient_language(user.language)
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
        html, text = render_daily_digest(
            project_name=settings.PROJECT_NAME,
            report_date=context.business_date.isoformat(),
            digest=build_daily_digest(
                sections=sections,
                activity_count=len(activity),
                integration_count=len(integration_health),
                integration_health_truncated=integration_health_truncated,
                language=language,
            ),
            activity=_group_activity_by_ledger(activity),
            activity_truncated=activity_truncated,
            integration_health=_group_integration_health_by_ledger(integration_health),
            integration_health_truncated=integration_health_truncated,
            app_url=f"{settings.FRONTEND_HOST.rstrip('/')}/ledgers",
            language=language,
        )
        return EmailData(
            subject=f"{settings.PROJECT_NAME} - {EmailLocale(language).tr('daily_subject')}",
            html_content=html,
            text_content=text,
        )


def _select_sections(
    *, session: Session, user: User, report_date: date
) -> dict[str, list[DailyReportItem]]:
    period = BillingPeriod.from_date(report_date)
    calendars: dict[str, BusinessCalendar] = {}
    obligations = session.scalars(
        select(Obligation)
        .join(LedgerMembership, LedgerMembership.ledger_id == Obligation.ledger_id)
        .join(Ledger, Ledger.id == Obligation.ledger_id)
        .where(LedgerMembership.user_id == user.id, Ledger.is_active)
        .options(joinedload(Obligation.ledger), joinedload(Obligation.category))
    ).unique()
    sections: dict[str, list[DailyReportItem]] = defaultdict(list)
    for obligation in obligations:
        country = obligation.ledger.business_calendar_country
        if country not in calendars:
            calendars[country] = BusinessCalendar(country)
        calendar = calendars[country]
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
                message
                for log in group_logs
                for message in _activity_messages(
                    log, language=recipient_language(user.language)
                )
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


def _activity_messages(
    log: ObligationActionLog, *, language: Language = "en"
) -> list[str]:
    locale = EmailLocale(language)
    changes = log.changes
    if log.action == "created":
        return [locale.tr("activity_created")]
    if log.action == "marked_paid":
        return [locale.tr("activity_paid")]
    if log.action == "marked_ready":
        return [locale.tr("activity_ready")]
    if log.action == "marked_error":
        return [locale.tr("activity_error")]
    if log.action == "canceled":
        return [locale.tr("activity_canceled")]
    if log.action == "reopened":
        return [locale.tr("activity_reopened")]
    if log.action == "values_updated":
        return _value_change_messages(changes, language=language)
    if log.action == "components_changed":
        return _component_change_messages(changes, language=language)
    return []


def _value_change_messages(
    changes: dict[str, object], *, language: Language = "en"
) -> list[str]:
    locale = EmailLocale(language)
    labels = {
        "current_amount": "field_amount",
        "issue_date": "field_issue_date",
        "due_date": "field_due_date",
    }
    messages: list[str] = []
    for field, label in labels.items():
        diff = changes.get(field)
        if isinstance(diff, dict) and "to" in diff:
            messages.append(
                locale.tr(
                    "value_changed",
                    field=locale.tr(label),
                    before=_display(diff.get("from"), language, field),
                    after=_display(diff["to"], language, field),
                )
            )
    return messages


def _component_change_messages(
    changes: dict[str, object], *, language: Language = "en"
) -> list[str]:
    locale = EmailLocale(language)
    components = changes.get("components")
    if not isinstance(components, dict):
        return []
    messages: list[str] = []
    for component in components.get("added", []):
        if not isinstance(component, dict):
            continue
        label = str(component.get("label") or locale.tr("component_unnamed"))
        prefix = locale.tr(
            "component_invoice"
            if component.get("type") == "invoice"
            else "component_added"
        )
        messages.append(
            f"{prefix}: {label}{_amount_suffix(component.get('amount'), language)}"
        )
    for component in components.get("updated", []):
        if not isinstance(component, dict):
            continue
        label = str(component.get("label") or locale.tr("component_unnamed"))
        component_changes = component.get("changes")
        if not isinstance(component_changes, dict):
            continue
        amount = component_changes.get("amount")
        if isinstance(amount, dict) and "to" in amount:
            messages.append(
                locale.tr(
                    "component_amount_changed",
                    label=label,
                    before=_display(amount.get("from"), language),
                    after=_display(amount["to"], language),
                )
            )
        elif component_changes:
            messages.append(locale.tr("component_updated", label=label))
    for component in components.get("removed", []):
        if isinstance(component, dict):
            messages.append(
                locale.tr(
                    "component_removed",
                    label=component.get("label") or locale.tr("component_unnamed"),
                )
            )
    return messages


def _amount_suffix(value: object, language: Language = "en") -> str:
    return "" if value is None else f" ({EmailLocale(language).amount(value)})"


def _display(
    value: object, language: Language = "en", field: str = "current_amount"
) -> str:
    locale = EmailLocale(language)
    if value is None:
        return locale.tr("unknown")
    if field in {"issue_date", "due_date"} and isinstance(value, str):
        try:
            return locale.date(value)
        except ValueError:
            return value
    return locale.amount(value)


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
                detail=_integration_health_detail(
                    integration,
                    health,
                    context.timezone,
                    language=recipient_language(user.language),
                ),
                last_success_at=_local_datetime(
                    integration.last_success_at,
                    context.timezone,
                    language=recipient_language(user.language),
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
    integration: Integration,
    health: IntegrationHealth,
    timezone: tzinfo,
    *,
    language: Language = "en",
) -> str:
    locale = EmailLocale(language)
    if health is IntegrationHealth.ERROR:
        error = integration.last_error_message or locale.tr("health_failed")
        return (
            f"{integration.last_error_code}: {error}"
            if integration.last_error_code
            else error
        )
    if health is IntegrationHealth.TIMED_OUT:
        return locale.tr(
            "health_timeout",
            started=_local_datetime(
                integration.current_started_at, timezone, language=language
            )
            or locale.tr("unknown"),
            deadline=_local_datetime(
                integration.current_deadline_at, timezone, language=language
            )
            or locale.tr("unknown"),
        )
    reference = integration.last_finished_at or integration.enabled_at
    return locale.tr(
        "health_not_fresh",
        reference=locale.tr(
            "health_reference_finished"
            if integration.last_finished_at
            else "health_reference_enabled"
        ),
        date=_local_datetime(reference, timezone, language=language)
        or locale.tr("unknown"),
    )


def _local_datetime(
    value: datetime | None, timezone: tzinfo, *, language: Language = "en"
) -> str | None:
    return (
        EmailLocale(language).datetime(value.astimezone(timezone))
        if value is not None
        else None
    )


def _group_integration_health_by_ledger(
    items: list[IntegrationHealthItem],
) -> dict[str, list[IntegrationHealthItem]]:
    grouped: dict[str, list[IntegrationHealthItem]] = defaultdict(list)
    for item in items:
        grouped[item.ledger_name].append(item)
    return dict(grouped)
