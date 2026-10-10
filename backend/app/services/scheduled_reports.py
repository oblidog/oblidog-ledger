"""Reusable, HTTP-independent scheduled report delivery."""

from __future__ import annotations

import logging
import smtplib
import socket
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Protocol

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domain.report_delivery import ReportDeliveryStatus
from app.models import ReportDelivery, User
from app.utils import EmailData, send_email

logger = logging.getLogger(__name__)

if TYPE_CHECKING:
    from app.use_cases.system_runs import SystemRunContext


class ScheduledReport(Protocol):
    report_type: str

    def recipients(
        self, *, session: Session, context: SystemRunContext
    ) -> Sequence[User]: ...

    def delivery_key(self, *, user: User, context: SystemRunContext) -> str: ...

    def render(
        self, *, session: Session, user: User, context: SystemRunContext
    ) -> EmailData | None: ...


@dataclass(frozen=True, slots=True)
class DeliverySummary:
    sent: int = 0
    skipped: int = 0
    failed: int = 0
    uncertain: int = 0


def deliver_scheduled_report(
    *, session: Session, report: ScheduledReport, context: SystemRunContext
) -> DeliverySummary:
    sent = skipped = failed = uncertain = 0
    for user in report.recipients(session=session, context=context):
        if not user.email:
            continue
        delivery_key = report.delivery_key(user=user, context=context)
        delivery = session.scalar(
            select(ReportDelivery).where(
                ReportDelivery.user_id == user.id,
                ReportDelivery.delivery_key == delivery_key,
            )
        )
        if delivery is not None and delivery.status is ReportDeliveryStatus.SENT:
            skipped += 1
            continue
        # The caller holds the existing scheduler lock. An unfinished attempt
        # encountered under that lock belongs to a previous interrupted run.
        if delivery is not None and delivery.status in (
            ReportDeliveryStatus.IN_PROGRESS,
            ReportDeliveryStatus.UNCERTAIN,
        ):
            delivery.status = ReportDeliveryStatus.UNCERTAIN
            delivery.error_message = "operator_recovery_required"
            session.commit()
            _log_uncertain(delivery)
            uncertain += 1
            continue
        sending = False
        try:
            email = report.render(session=session, user=user, context=context)
            if email is None:
                logger.info(
                    "Scheduled report %s skipped for user %s: no actionable content",
                    report.report_type,
                    user.id,
                )
                continue
            if delivery is None:
                delivery = ReportDelivery(
                    report_type=report.report_type,
                    user_id=user.id,
                    delivery_key=delivery_key,
                    status=ReportDeliveryStatus.FAILED,
                )
                session.add(delivery)
            else:
                delivery.report_type = report.report_type
                delivery.error_message = None
            delivery.status = ReportDeliveryStatus.IN_PROGRESS
            delivery.attempt_count = (delivery.attempt_count or 0) + 1
            delivery.attempt_started_at = datetime.now(UTC)
            delivery.attempt_finished_at = None
            session.commit()
            sending = True
            send_email(
                email_to=user.email,
                subject=email.subject,
                html_content=email.html_content,
                text_content=email.text_content,
                message_id=delivery.message_id,
            )
        except Exception as exc:
            session.rollback()
            if delivery is None:
                delivery = ReportDelivery(
                    report_type=report.report_type,
                    user_id=user.id,
                    delivery_key=delivery_key,
                    status=ReportDeliveryStatus.FAILED,
                )
                session.add(delivery)
                session.commit()
            delivery = session.get(ReportDelivery, delivery.id)
            if delivery is not None:
                is_uncertain = sending and not _definitely_not_delivered(exc)
                delivery.status = (
                    ReportDeliveryStatus.UNCERTAIN
                    if is_uncertain
                    else ReportDeliveryStatus.FAILED
                )
                delivery.attempt_finished_at = datetime.now(UTC)
                delivery.error_message = _safe_error(exc)
                session.commit()
                if is_uncertain:
                    _log_uncertain(delivery)
                    uncertain += 1
                else:
                    failed += 1
        else:
            delivery = session.get(ReportDelivery, delivery.id)
            if delivery is not None:
                delivery.status = ReportDeliveryStatus.SENT
                delivery.sent_at = datetime.now(UTC)
                delivery.attempt_finished_at = delivery.sent_at
                delivery.error_message = None
                session.commit()
            sent += 1
    summary = DeliverySummary(
        sent=sent, skipped=skipped, failed=failed, uncertain=uncertain
    )
    logger.info(
        "Scheduled report %s finished: sent=%s skipped=%s failed=%s uncertain=%s",
        report.report_type,
        summary.sent,
        summary.skipped,
        summary.failed,
        summary.uncertain,
    )
    return summary


def _definitely_not_delivered(exc: Exception) -> bool:
    return isinstance(
        exc,
        (
            ConnectionRefusedError,
            socket.gaierror,
            smtplib.SMTPConnectError,
            smtplib.SMTPAuthenticationError,
            smtplib.SMTPHeloError,
            smtplib.SMTPSenderRefused,
            smtplib.SMTPRecipientsRefused,
            smtplib.SMTPDataError,
        ),
    )


def _safe_error(exc: Exception) -> str:
    # Exception strings can include SMTP credentials, addresses or message data.
    return exc.__class__.__name__


def _log_uncertain(delivery: ReportDelivery) -> None:
    logger.warning(
        "Scheduled report delivery %s uncertain: attempt=%s; operator recovery required",
        delivery.id,
        delivery.attempt_count,
    )
