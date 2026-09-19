import uuid
from datetime import UTC, date, datetime
from types import SimpleNamespace
from zoneinfo import ZoneInfo

import pytest

from app.domain import BillingPeriod, ObligationLifecycle
from app.domain.business_calendar import BusinessCalendar
from app.models import ObligationActionLog
from app.services.daily_obligation_report import (
    DailyObligationReport,
    _activity_messages,
    _activity_window,
    _section_for,
)
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


def test_daily_report_renders_grouped_accessible_integration_activity(db) -> None:  # type: ignore[no-untyped-def]
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

    def add_log(*, target, action: str, changes: dict[str, object]) -> None:  # type: ignore[no-untyped-def]
        db.add(
            ObligationActionLog(
                obligation_id=target.id,
                action=action,
                actor_type="integration",
                actor_id=integration_id,
                actor_display_name="eKartoteka",
                integration_id=integration_id,
                run_id=run_id,
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
    assert "Integration activity" in email.text_content
    assert "New invoice: September invoice (125.00)" in email.text_content
    assert "Amount changed: 120.00 → 125.00" in email.text_content
    assert "Payment recognized" in email.text_content
    assert email.text_content.count("eKartoteka") == 1
    assert other_category.name not in email.text_content
    assert "999.00" not in email.text_content
    assert "Integration activity" in email.html_content
    assert category.name in email.html_content
