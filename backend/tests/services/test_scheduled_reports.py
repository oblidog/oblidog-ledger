from datetime import datetime
from zoneinfo import ZoneInfo

from sqlalchemy import select

from app.domain.report_delivery import ReportDeliveryStatus
from app.models import ReportDelivery, User
from app.services import scheduled_reports
from app.use_cases.system_runs import SystemRunContext
from app.utils import EmailData
from tests.utils.user import create_random_user


class FakeReport:
    report_type = "daily"

    def __init__(self, users: list[User]) -> None:
        self.users = users

    def recipients(self, *, session, context):  # type: ignore[no-untyped-def]
        return self.users

    def delivery_key(self, *, user: User, context: SystemRunContext) -> str:
        return f"daily:{user.id}:{context.business_date.isoformat()}"

    def render(self, *, session, user: User, context: SystemRunContext) -> EmailData:  # type: ignore[no-untyped-def]
        return EmailData(html_content="<p>Report</p>", subject="Daily report")


def test_failed_deliveries_retry_without_duplicating_successes(db, monkeypatch) -> None:  # type: ignore[no-untyped-def]
    first, second = create_random_user(db), create_random_user(db)
    report = FakeReport([first, second])
    context = SystemRunContext.create(
        effective_at=datetime(2026, 9, 1, tzinfo=ZoneInfo("Europe/Warsaw")),
        timezone=ZoneInfo("Europe/Warsaw"),
    )
    calls: list[str] = []

    def fail_one(*, email_to: str, **_kwargs: object) -> None:
        calls.append(email_to)
        if email_to == first.email:
            raise RuntimeError("SMTP unavailable")

    monkeypatch.setattr(scheduled_reports, "send_email", fail_one)
    first_result = scheduled_reports.deliver_scheduled_report(
        session=db, report=report, context=context
    )

    assert first_result.sent == 1
    assert first_result.failed == 1
    assert len(calls) == 2
    failed = db.scalar(select(ReportDelivery).where(ReportDelivery.user_id == first.id))
    assert failed is not None
    assert failed.status is ReportDeliveryStatus.FAILED
    assert failed.error_message == "SMTP unavailable"

    monkeypatch.setattr(
        scheduled_reports,
        "send_email",
        lambda *, email_to, **kwargs: calls.append(email_to),
    )
    retry_result = scheduled_reports.deliver_scheduled_report(
        session=db, report=report, context=context
    )

    assert retry_result.sent == 1
    assert retry_result.skipped == 1
    assert retry_result.failed == 0
    assert calls == [first.email, second.email, first.email]
    assert (
        db.scalar(
            select(ReportDelivery).where(ReportDelivery.user_id == first.id)
        ).status
        is ReportDeliveryStatus.SENT
    )
