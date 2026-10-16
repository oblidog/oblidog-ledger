import logging
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

import jwt
from emails.backend.response import SMTPResponse
from emails.backend.smtp.backend import SMTPBackend
from emails.message import Message
from jwt.exceptions import InvalidTokenError

from app.core import security
from app.core.capabilities import Capability, ensure_capability
from app.core.config import settings
from app.email_i18n import EmailLocale, recipient_language
from app.email_rendering import render_email_template as render_email_template

logger = logging.getLogger(__name__)


@dataclass
class EmailData:
    html_content: str
    subject: str
    text_content: str = ""


@dataclass(frozen=True, slots=True)
class PasswordResetTokenClaims:
    user_id: uuid.UUID
    token_id: uuid.UUID


class _SingleAttemptSMTPBackend(SMTPBackend):
    """Disable emails' implicit resend after a possibly accepted DATA command."""

    def retry_on_disconnect(
        self, func: Callable[..., SMTPResponse | None]
    ) -> Callable[..., SMTPResponse | None]:
        return func


def send_email(
    *,
    email_to: str,
    subject: str = "",
    html_content: str = "",
    text_content: str = "",
    message_id: str | None = None,
) -> None:
    ensure_capability(Capability.EMAIL)
    assert settings.emails_enabled, "no provided configuration for email variables"
    assert settings.EMAILS_FROM_EMAIL is not None
    message = Message(
        message_id=message_id,
        subject=subject,
        html=html_content,
        text=text_content,
        mail_from=(settings.EMAILS_FROM_NAME, settings.EMAILS_FROM_EMAIL),
    )
    smtp_options: dict[str, Any] = {
        "host": settings.SMTP_HOST,
        "port": settings.SMTP_PORT,
        # The ``emails`` package otherwise returns connection failures as a
        # response object and callers wrongly treat the message as delivered.
        "fail_silently": False,
    }
    if settings.SMTP_TLS:
        smtp_options["tls"] = True
    elif settings.SMTP_SSL:
        smtp_options["ssl"] = True
    if settings.SMTP_USER:
        smtp_options["user"] = settings.SMTP_USER
    if settings.SMTP_PASSWORD:
        smtp_options["password"] = settings.SMTP_PASSWORD
    if message_id is not None:
        backend = _SingleAttemptSMTPBackend(**smtp_options)
        try:
            response = message.send(to=email_to, smtp=backend)
        finally:
            # Closing must neither hide the DATA result nor trigger a resend.
            if backend._client is not None:
                backend._client.close()
    else:
        response = message.send(to=email_to, smtp=smtp_options)
    if response is None or not response.success:
        raise RuntimeError("SMTP acceptance not confirmed")
    logger.info("Email accepted by SMTP")


def _localized_email(
    *,
    template: str,
    subject_key: str,
    language: object,
    context: dict[str, Any],
    subject_params: dict[str, str] | None = None,
) -> EmailData:
    locale = EmailLocale(recipient_language(language))
    return EmailData(
        subject=f"{settings.PROJECT_NAME} - {locale.tr(subject_key, **(subject_params or {}))}",
        html_content=render_email_template(
            template_name=f"{template}.html", context=context, language=locale.language
        ),
        text_content=render_email_template(
            template_name=f"{template}.txt", context=context, language=locale.language
        ),
    )


def generate_test_email(email_to: str, *, language: object = None) -> EmailData:
    return _localized_email(
        template="test_email",
        subject_key="test_subject",
        language=language,
        context={"project_name": settings.PROJECT_NAME, "email": email_to},
    )


def generate_reset_password_email(
    email_to: str, email: str, token: str, *, language: object = None
) -> EmailData:
    return _localized_email(
        template="reset_password",
        subject_key="reset_subject",
        language=language,
        subject_params={"email": email},
        context={
            "project_name": settings.PROJECT_NAME,
            "username": email,
            "email": email_to,
            "valid_hours": settings.EMAIL_RESET_TOKEN_EXPIRE_HOURS,
            "link": f"{settings.FRONTEND_HOST}/reset-password?token={token}",
        },
    )


def generate_new_account_email(
    email_to: str, username: str, password: str, *, language: object = None
) -> EmailData:
    return _localized_email(
        template="new_account",
        subject_key="new_subject",
        language=language,
        subject_params={"username": username},
        context={
            "project_name": settings.PROJECT_NAME,
            "username": username,
            "password": password,
            "email": email_to,
            "link": settings.FRONTEND_HOST,
        },
    )


def generate_user_invitation_email(
    email_to: str, token: str, valid_hours: int, *, language: object = None
) -> EmailData:
    return _localized_email(
        template="user_invitation",
        subject_key="invitation_subject",
        language=language,
        context={
            "project_name": settings.PROJECT_NAME,
            "email": email_to,
            "link": f"{settings.FRONTEND_HOST}/accept-invitation?token={token}",
            "valid_hours": valid_hours,
        },
    )


def generate_password_reset_token(
    *,
    user_id: uuid.UUID,
    token_id: uuid.UUID,
    issued_at: datetime | None = None,
    expires_at: datetime | None = None,
) -> str:
    now = issued_at or datetime.now(UTC)
    expires = expires_at or (
        now + timedelta(hours=settings.EMAIL_RESET_TOKEN_EXPIRE_HOURS)
    )
    encoded_jwt = jwt.encode(
        {
            "exp": expires,
            "iat": now,
            "nbf": now,
            "sub": str(user_id),
            "jti": str(token_id),
            "purpose": "password_reset",
        },
        settings.SECRET_KEY,
        algorithm=security.ALGORITHM,
    )
    return encoded_jwt


def verify_password_reset_token(token: str) -> PasswordResetTokenClaims | None:
    try:
        decoded_token = jwt.decode(
            token,
            settings.SECRET_KEY,
            algorithms=[security.ALGORITHM],
            options={"require": ["exp", "iat", "nbf", "sub", "jti", "purpose"]},
        )
        if decoded_token["purpose"] != "password_reset":
            return None
        return PasswordResetTokenClaims(
            user_id=uuid.UUID(str(decoded_token["sub"])),
            token_id=uuid.UUID(str(decoded_token["jti"])),
        )
    except InvalidTokenError, KeyError, TypeError, ValueError:
        return None
