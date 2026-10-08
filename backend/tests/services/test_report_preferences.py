from datetime import UTC, datetime

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import LedgerMembership, ReportDelivery, User
from app.services import scheduled_reports
from app.services.daily_obligation_report import DailyObligationReport
from app.services.scheduled_reports import ScheduledReport
from app.services.weekly_monthly_overview_report import WeeklyMonthlyOverviewReport
from app.use_cases.system_runs import SystemRunContext
from tests.utils.ledger_domain import create_test_ledger


@pytest.mark.parametrize(
    ("daily_enabled", "weekly_enabled"),
    [(True, True), (False, True), (True, False), (False, False)],
)
def test_report_selection_respects_independent_toggles(
    db: Session, daily_enabled: bool, weekly_enabled: bool
) -> None:
    ledger = create_test_ledger(db)
    user = db.get(User, ledger.owner_user_id)
    assert user is not None
    user.daily_report_enabled = daily_enabled
    user.weekly_report_enabled = weekly_enabled
    db.commit()
    context = SystemRunContext.create(effective_at=datetime(2026, 9, 7, tzinfo=UTC))

    reports: list[tuple[ScheduledReport, bool]] = [
        (DailyObligationReport(), daily_enabled),
        (WeeklyMonthlyOverviewReport(), weekly_enabled),
    ]
    for report, enabled in reports:
        recipients = report.recipients(session=db, context=context)
        assert (user.id in {recipient.id for recipient in recipients}) is enabled

    # Duplicate memberships must still result in one recipient per report.
    second_ledger = create_test_ledger(db)
    membership = db.get(LedgerMembership, (ledger.id, user.id))
    assert membership is not None
    db.add(
        LedgerMembership(
            ledger_id=second_ledger.id, user_id=user.id, role=membership.role
        )
    )
    db.commit()
    assert sum(
        recipient.id == user.id
        for recipient in DailyObligationReport().recipients(session=db, context=context)
    ) == int(daily_enabled)


def test_opted_out_user_is_never_rendered_or_recorded(
    db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    ledger = create_test_ledger(db)
    user = db.get(User, ledger.owner_user_id)
    assert user is not None
    user.daily_report_enabled = False
    user.weekly_report_enabled = False
    db.commit()
    context = SystemRunContext.create(effective_at=datetime(2026, 9, 7, tzinfo=UTC))

    reports: list[ScheduledReport] = [
        DailyObligationReport(),
        WeeklyMonthlyOverviewReport(),
    ]
    for report in reports:
        # Isolate delivery to the selected user while retaining the real recipient query.
        recipients = report.recipients(session=db, context=context)
        monkeypatch.setattr(
            report,
            "recipients",
            lambda recipients=recipients, **kwargs: [
                u for u in recipients if u.id == user.id
            ],
        )

        def unexpected_render(**_kwargs: object) -> None:
            raise AssertionError("Opted-out report must not be rendered")

        monkeypatch.setattr(report, "render", unexpected_render)
        summary = scheduled_reports.deliver_scheduled_report(
            session=db, report=report, context=context
        )
        assert summary.sent == summary.failed == 0

    assert (
        db.scalar(select(ReportDelivery).where(ReportDelivery.user_id == user.id))
        is None
    )
