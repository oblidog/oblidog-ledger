import uuid
from datetime import UTC, date, datetime, timedelta
from types import SimpleNamespace
from zoneinfo import ZoneInfo

import pytest

from app.domain import BillingPeriod, LedgerAccessRole, ObligationLifecycle
from app.domain.business_calendar import BusinessCalendar
from app.models import LedgerMembership, ObligationActionLog
from app.schemas.integrations import IntegrationCreate
from app.services.daily_obligation_report import (
    DailyObligationReport,
    _activity_messages,
    _activity_window,
    _section_for,
    _select_integration_health,
)
from app.use_cases import integrations as integration_use_cases
from app.use_cases import obligations as obligation_use_cases
from app.use_cases.system_runs import SystemRunContext
from tests.utils.ledger_domain import create_category_with_recurrence

CALENDAR = BusinessCalendar("PL")


@pytest.mark.parametrize(
    ("lifecycle", "due_date", "report_date", "expected"),
    [
        (
            ObligationLifecycle.COLLECTING_DATA,
            date(2026, 9, 4),
            date(2026, 9, 1),
            "needs_preparation",
        ),
        (ObligationLifecycle.READY, date(2026, 9, 3), date(2026, 9, 1), "ready_to_pay"),
        (
            ObligationLifecycle.COLLECTING_DATA,
            date(2026, 8, 31),
            date(2026, 9, 1),
            "overdue",
        ),
        (ObligationLifecycle.PAID, date(2026, 8, 31), date(2026, 9, 1), None),
        (ObligationLifecycle.CANCELED, date(2026, 8, 31), date(2026, 9, 1), None),
    ],
)
def test_daily_report_assigns_due_obligations_to_sections(
    lifecycle: ObligationLifecycle,
    due_date: date,
    report_date: date,
    expected: str | None,
) -> None:
    obligation = SimpleNamespace(
        lifecycle=lifecycle,
        due_date=due_date,
        period_year=2026,
        period_month=9,
    )

    assert (
        _section_for(
            obligation, report_date, BillingPeriod.from_date(report_date), CALENDAR
        )
        == expected
    )  # type: ignore[arg-type]


def test_daily_report_marks_current_period_missing_due_dates_from_fifth_business_day() -> (
    None
):
    obligation = SimpleNamespace(
        lifecycle=ObligationLifecycle.COLLECTING_DATA,
        due_date=None,
        period_year=2026,
        period_month=9,
    )

    assert (
        _section_for(obligation, date(2026, 9, 4), BillingPeriod(2026, 9), CALENDAR)
        is None
    )  # type: ignore[arg-type]
    assert (
        _section_for(obligation, date(2026, 9, 7), BillingPeriod(2026, 9), CALENDAR)
        == "missing_due_date"
    )  # type: ignore[arg-type]


@pytest.mark.parametrize(
    ("lifecycle", "due_date", "expected"),
    [
        (ObligationLifecycle.READY, date(2026, 6, 8), "ready_to_pay"),
        (ObligationLifecycle.READY, date(2026, 6, 9), None),
        (ObligationLifecycle.COLLECTING_DATA, date(2026, 6, 9), "needs_preparation"),
        (ObligationLifecycle.COLLECTING_DATA, date(2026, 6, 10), None),
    ],
)
def test_daily_report_counts_weekends_and_polish_holidays_as_non_business_days(
    lifecycle: ObligationLifecycle, due_date: date, expected: str | None
) -> None:
    # 2026-06-04 (Corpus Christi) and the following weekend do not consume lead time.
    obligation = SimpleNamespace(
        lifecycle=lifecycle,
        due_date=due_date,
        period_year=2026,
        period_month=6,
    )

    assert (
        _section_for(obligation, date(2026, 6, 3), BillingPeriod(2026, 6), CALENDAR)
        == expected
    )  # type: ignore[arg-type]


def test_daily_report_uses_fifth_business_day_for_missing_due_dates() -> None:
    obligation = SimpleNamespace(
        lifecycle=ObligationLifecycle.COLLECTING_DATA,
        due_date=None,
        period_year=2026,
        period_month=1,
    )

    # New Year's Day and Epiphany are Polish public holidays; 2026-01-09 is day five.
    assert (
        _section_for(obligation, date(2026, 1, 8), BillingPeriod(2026, 1), CALENDAR)
        is None
    )  # type: ignore[arg-type]
    assert (
        _section_for(obligation, date(2026, 1, 9), BillingPeriod(2026, 1), CALENDAR)
        == "missing_due_date"
    )  # type: ignore[arg-type]


@pytest.mark.parametrize("due_date", [date(2026, 5, 1), date(2026, 12, 31), None])
def test_daily_report_always_reports_errors_in_the_dedicated_section(
    due_date: date | None,
) -> None:
    obligation = SimpleNamespace(
        lifecycle=ObligationLifecycle.ERROR,
        due_date=due_date,
        period_year=2025,
        period_month=1,
    )

    assert (
        _section_for(obligation, date(2026, 6, 3), BillingPeriod(2026, 6), CALENDAR)
        == "errors"
    )  # type: ignore[arg-type]


def test_activity_window_is_previous_complete_local_day() -> None:
    context = SystemRunContext.create(
        effective_at=datetime(2026, 9, 19, 9, 30, tzinfo=ZoneInfo("Europe/Warsaw")),
        timezone=ZoneInfo("Europe/Warsaw"),
    )

    assert _activity_window(context) == (
        datetime(2026, 9, 17, 22, 0, tzinfo=UTC),
        datetime(2026, 9, 18, 22, 0, tzinfo=UTC),
    )


def test_activity_messages_use_invoice_wording_only_for_invoice_components() -> None:
    invoice_log = SimpleNamespace(
        action="components_changed",
        changes={
            "components": {
                "added": [
                    {
                        "type": "invoice",
                        "label": "September invoice",
                        "amount": "42.00",
                    },
                    {"type": "charge", "label": "Heating", "amount": "12.00"},
                ]
            }
        },
    )

    assert _activity_messages(invoice_log) == [  # type: ignore[arg-type]
        "New invoice: September invoice (42.00)",
        "Component added: Heating (12.00)",
    ]


def test_daily_report_renders_grouped_accessible_user_and_integration_activity(
    db,
) -> None:  # type: ignore[no-untyped-def]
    ledger, _, category = create_category_with_recurrence(db)
    other_ledger, _, other_category = create_category_with_recurrence(db)
    obligation = obligation_use_cases.ensure_obligations_for_period(
        session=db, ledger_id=ledger.id, period=BillingPeriod(2026, 9)
    )[0]
    other_obligation = obligation_use_cases.ensure_obligations_for_period(
        session=db, ledger_id=other_ledger.id, period=BillingPeriod(2026, 9)
    )[0]
    integration_id = uuid.uuid4()
    run_id = uuid.uuid4()
    occurred_at = datetime(2026, 9, 18, 12, tzinfo=UTC)

    def add_log(  # type: ignore[no-untyped-def]
        *,
        target,
        action: str,
        changes: dict[str, object],
        actor_type: str = "integration",
        actor_id: uuid.UUID = integration_id,
        actor_name: str = "eKartoteka",
        action_run_id: uuid.UUID | None = run_id,
    ) -> None:
        db.add(
            ObligationActionLog(
                obligation_id=target.id,
                action=action,
                actor_type=actor_type,
                actor_id=actor_id,
                actor_display_name=actor_name,
                integration_id=actor_id if actor_type == "integration" else None,
                run_id=action_run_id,
                changes=changes,
                created_at=occurred_at,
            )
        )

    add_log(
        target=obligation,
        action="components_changed",
        changes={
            "components": {
                "added": [
                    {
                        "type": "invoice",
                        "label": "September invoice",
                        "amount": "125.00",
                    }
                ]
            }
        },
    )
    add_log(
        target=obligation,
        action="values_updated",
        changes={"current_amount": {"from": "120.00", "to": "125.00"}},
    )
    add_log(
        target=obligation,
        action="marked_paid",
        changes={"lifecycle": {"from": "ready", "to": "paid"}},
    )
    add_log(
        target=obligation,
        action="values_updated",
        changes={"due_date": {"from": "2026-09-20", "to": "2026-09-22"}},
        actor_type="user",
        actor_id=ledger.owner_user_id,
        actor_name="Mario",
        action_run_id=None,
    )
    add_log(
        target=other_obligation,
        action="values_updated",
        changes={"current_amount": {"from": "1.00", "to": "999.00"}},
    )
    db.commit()

    context = SystemRunContext.create(
        effective_at=datetime(2026, 9, 19, 9, 30, tzinfo=ZoneInfo("Europe/Warsaw")),
        timezone=ZoneInfo("Europe/Warsaw"),
    )
    email = DailyObligationReport().render(
        session=db, user=ledger.owner, context=context
    )

    assert email is not None
    assert email.text_content is not None
    assert "Recent activity" in email.text_content
    assert "New invoice: September invoice (125.00)" in email.text_content
    assert "Amount changed: 120.00 → 125.00" in email.text_content
    assert "Payment recognized" in email.text_content
    assert "Due date changed: 2026-09-20 → 2026-09-22" in email.text_content
    assert email.text_content.count("eKartoteka") == 1
    assert email.text_content.count("Mario") == 1
    assert other_category.name not in email.text_content
    assert "999.00" not in email.text_content
    assert "Recent activity" in email.html_content
    assert category.name in email.html_content


def test_daily_report_includes_only_actionable_accessible_integration_health(
    db,
) -> None:  # type: ignore[no-untyped-def]
    ledger, _, category = create_category_with_recurrence(db)
    inaccessible_ledger, _, inaccessible_category = create_category_with_recurrence(db)
    inactive_ledger, _, inactive_category = create_category_with_recurrence(db)
    db.add(
        LedgerMembership(
            ledger_id=inactive_ledger.id,
            user_id=ledger.owner_user_id,
            role=LedgerAccessRole.VIEWER,
        )
    )
    inactive_ledger.is_active = False
    db.commit()

    context = SystemRunContext.create(
        effective_at=datetime(2026, 9, 19, 9, 30, tzinfo=ZoneInfo("Europe/Warsaw")),
        timezone=ZoneInfo("Europe/Warsaw"),
    )
    now = context.effective_at

    def create_integration(
        name: str, *, target_ledger=ledger, target_category=category
    ):  # type: ignore[no-untyped-def]
        item, _, _ = integration_use_cases.create_integration(
            session=db,
            ledger_id=target_ledger.id,
            created_by_user_id=target_ledger.owner_user_id,
            data=IntegrationCreate(name=name, category_id=target_category.id),
        )
        item.enabled_at = now - timedelta(minutes=10)
        return item

    error = create_integration("Failed provider")
    error.current_run_id = uuid.uuid4()
    error.current_started_at = now - timedelta(minutes=20)
    error.current_deadline_at = now + timedelta(minutes=10)
    error.current_finished_at = now - timedelta(minutes=15)
    error.last_finished_at = error.current_finished_at
    error.last_result = "failure"
    error.last_error_code = "provider_unavailable"
    error.last_error_message = "Provider returned maintenance response"
    error.last_success_at = now - timedelta(days=2)

    timed_out = create_integration("Timed out provider")
    timed_out.current_run_id = uuid.uuid4()
    timed_out.current_started_at = now - timedelta(hours=1)
    timed_out.current_deadline_at = now - timedelta(minutes=30)

    stale = create_integration("Stale provider")
    stale.enabled_at = now - timedelta(days=3)
    stale.stale_after_seconds = 3600
    stale.current_run_id = uuid.uuid4()
    stale.current_started_at = now - timedelta(days=2, minutes=5)
    stale.current_deadline_at = now - timedelta(days=2)
    stale.current_finished_at = now - timedelta(days=2, minutes=1)
    stale.last_finished_at = stale.current_finished_at
    stale.last_result = "success"
    stale.last_changes_detected = False
    stale.last_success_at = stale.current_finished_at

    healthy = create_integration("Healthy provider")
    healthy.current_run_id = uuid.uuid4()
    healthy.current_started_at = now - timedelta(minutes=5)
    healthy.current_deadline_at = now + timedelta(minutes=25)
    healthy.current_finished_at = now - timedelta(minutes=1)
    healthy.last_finished_at = healthy.current_finished_at
    healthy.last_result = "success"
    healthy.last_changes_detected = False
    healthy.last_success_at = healthy.current_finished_at

    running = create_integration("Running provider")
    running.current_run_id = uuid.uuid4()
    running.current_started_at = now - timedelta(minutes=5)
    running.current_deadline_at = now + timedelta(minutes=25)

    disabled = create_integration("Disabled provider")
    disabled.enabled = False

    never_run = create_integration("Unconfigured provider")
    never_run.enabled_at = now - timedelta(days=30)
    never_run.stale_after_seconds = 3600

    inaccessible = create_integration(
        "Inaccessible failure",
        target_ledger=inaccessible_ledger,
        target_category=inaccessible_category,
    )
    inaccessible.current_run_id = uuid.uuid4()
    inaccessible.current_started_at = now - timedelta(minutes=20)
    inaccessible.current_deadline_at = now + timedelta(minutes=10)
    inaccessible.current_finished_at = now - timedelta(minutes=15)
    inaccessible.last_finished_at = inaccessible.current_finished_at
    inaccessible.last_result = "failure"
    inaccessible.last_error_code = "hidden"
    inaccessible.last_error_message = "Must not be rendered"

    inactive = create_integration(
        "Inactive ledger failure",
        target_ledger=inactive_ledger,
        target_category=inactive_category,
    )
    inactive.current_run_id = uuid.uuid4()
    inactive.current_started_at = now - timedelta(minutes=20)
    inactive.current_deadline_at = now + timedelta(minutes=10)
    inactive.current_finished_at = now - timedelta(minutes=15)
    inactive.last_finished_at = inactive.current_finished_at
    inactive.last_result = "failure"
    inactive.last_error_code = "inactive"
    inactive.last_error_message = "Must not be rendered"
    db.commit()

    items, truncated = _select_integration_health(
        session=db, user=ledger.owner, context=context
    )
    assert truncated is False
    assert [item.integration_name for item in items] == [
        "Failed provider",
        "Stale provider",
        "Timed out provider",
    ]

    email = DailyObligationReport().render(
        session=db, user=ledger.owner, context=context
    )
    assert email is not None
    assert email.text_content is not None
    assert "Integration health" in email.text_content
    assert "provider_unavailable: Provider returned maintenance response" in (
        email.text_content
    )
    assert "last success:" in email.text_content
    assert "started: 2026-09-19T08:30+02:00" in email.text_content
    assert "deadline: 2026-09-19T09:00+02:00" in email.text_content
    assert "last completed run: 2026-09-17T09:29+02:00" in email.text_content
    assert "Healthy provider" not in email.text_content
    assert "Running provider" not in email.text_content
    assert "Disabled provider" not in email.text_content
    assert "Unconfigured provider" not in email.text_content
    assert "Inaccessible failure" not in email.text_content
    assert "Inactive ledger failure" not in email.text_content
    assert "Integration health" in email.html_content
    assert "started: 2026-09-19T08:30+02:00" in email.html_content
    assert "deadline: 2026-09-19T09:00+02:00" in email.html_content
    assert "last completed run: 2026-09-17T09:29+02:00" in email.html_content
