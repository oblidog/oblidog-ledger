import smtplib
from datetime import datetime
from zoneinfo import ZoneInfo

import pytest
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


@pytest.mark.parametrize(
    "error",
    [
        ConnectionRefusedError("SMTP unavailable"),
        smtplib.SMTPAuthenticationError(535, b"secret"),
        smtplib.SMTPRecipientsRefused({"private@example.com": (550, b"secret")}),
        smtplib.SMTPDataError(550, b"secret"),
    ],
)
def test_failed_deliveries_retry_without_duplicating_successes(
    db, monkeypatch, error
) -> None:  # type: ignore[no-untyped-def]
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
            raise error

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
    assert failed.error_message == type(error).__name__
    assert failed.attempt_count == 1
    assert failed.attempt_finished_at is not None

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


def _context() -> SystemRunContext:
    return SystemRunContext.create(
        effective_at=datetime(2026, 9, 1, tzinfo=ZoneInfo("Europe/Warsaw")),
        timezone=ZoneInfo("Europe/Warsaw"),
    )


@pytest.mark.parametrize(
    "error",
    [
        TimeoutError("secret credentials and message contents"),
        smtplib.SMTPServerDisconnected("secret"),
        RuntimeError("secret"),
    ],
)
def test_uncertain_send_blocks_retry(db, monkeypatch, error) -> None:  # type: ignore[no-untyped-def]
    user = create_random_user(db)
    report = FakeReport([user])
    calls = []

    def send(**kwargs):  # type: ignore[no-untyped-def]
        calls.append(kwargs["message_id"])
        raise error

    monkeypatch.setattr(scheduled_reports, "send_email", send)
    result = scheduled_reports.deliver_scheduled_report(
        session=db, report=report, context=_context()
    )
    assert result.uncertain == 1
    assert result.failed == 0
    delivery = db.scalar(
        select(ReportDelivery).where(ReportDelivery.user_id == user.id)
    )
    assert delivery.status is ReportDeliveryStatus.UNCERTAIN
    assert delivery.error_message == type(error).__name__
    retry = scheduled_reports.deliver_scheduled_report(
        session=db, report=report, context=_context()
    )
    assert retry.uncertain == 1
    assert len(calls) == 1

    # Explicit operator recovery permits retry with the same stable identity.
    delivery.status = ReportDeliveryStatus.FAILED
    db.commit()
    monkeypatch.setattr(
        scheduled_reports,
        "send_email",
        lambda **kwargs: calls.append(kwargs["message_id"]),
    )
    result = scheduled_reports.deliver_scheduled_report(
        session=db, report=report, context=_context()
    )
    assert result.sent == 1
    assert calls[0] == calls[1] == delivery.message_id
    assert delivery.attempt_count == 2


@pytest.mark.parametrize("accepted", [False, True])
def test_crash_survives_new_session_without_resend(db, monkeypatch, accepted) -> None:  # type: ignore[no-untyped-def]
    from sqlalchemy.orm import Session

    user = create_random_user(db)
    report = FakeReport([user])
    user_id = user.id

    def crash(**_kwargs):  # type: ignore[no-untyped-def]
        raise KeyboardInterrupt()

    if accepted:
        monkeypatch.setattr(scheduled_reports, "send_email", lambda **kwargs: None)
        original_commit = db.commit

        def fail_sent_commit():  # type: ignore[no-untyped-def]
            if any(
                isinstance(obj, ReportDelivery)
                and obj.status is ReportDeliveryStatus.SENT
                for obj in db.dirty
            ):
                raise KeyboardInterrupt()
            original_commit()

        monkeypatch.setattr(db, "commit", fail_sent_commit)
    else:
        monkeypatch.setattr(scheduled_reports, "send_email", crash)

    with pytest.raises(KeyboardInterrupt):
        scheduled_reports.deliver_scheduled_report(
            session=db, report=report, context=_context()
        )
    db.rollback()
    monkeypatch.setattr(
        scheduled_reports,
        "send_email",
        lambda **kwargs: pytest.fail("Interrupted attempt resent"),
    )
    with Session(db.get_bind()) as restarted:
        restarted_user = restarted.get(User, user_id)
        result = scheduled_reports.deliver_scheduled_report(
            session=restarted, report=FakeReport([restarted_user]), context=_context()
        )
        delivery = restarted.scalar(
            select(ReportDelivery).where(ReportDelivery.user_id == user_id)
        )
        assert result.uncertain == 1
        assert delivery.status is ReportDeliveryStatus.UNCERTAIN
        assert delivery.attempt_count == 1
        assert delivery.attempt_finished_at is None


def test_render_failure_is_safe_to_retry(db, monkeypatch) -> None:  # type: ignore[no-untyped-def]
    user = create_random_user(db)
    report = FakeReport([user])
    original_render = report.render

    def fail_render(**_kwargs):  # type: ignore[no-untyped-def]
        raise ValueError("sensitive report data")

    monkeypatch.setattr(report, "render", fail_render)
    monkeypatch.setattr(
        scheduled_reports,
        "send_email",
        lambda **kwargs: pytest.fail("Sending after render failure"),
    )
    result = scheduled_reports.deliver_scheduled_report(
        session=db, report=report, context=_context()
    )
    assert result.failed == 1
    delivery = db.scalar(
        select(ReportDelivery).where(ReportDelivery.user_id == user.id)
    )
    assert delivery.status is ReportDeliveryStatus.FAILED
    assert delivery.attempt_count == 0
    assert delivery.error_message == "ValueError"
    monkeypatch.setattr(report, "render", original_render)
    monkeypatch.setattr(scheduled_reports, "send_email", lambda **kwargs: None)
    assert (
        scheduled_reports.deliver_scheduled_report(
            session=db, report=report, context=_context()
        ).sent
        == 1
    )
