import logging
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import jwt
from emails.message import Message
from jinja2 import Template
from jwt.exceptions import InvalidTokenError

from app.core import security
from app.core.capabilities import Capability, ensure_capability
from app.core.config import settings

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


def render_email_template(*, template_name: str, context: dict[str, Any]) -> str:
    template_str = (
        Path(__file__).parent / "email-templates" / "build" / template_name
    ).read_text()
    html_content = Template(template_str).render(context)
    return str(html_content)


def send_email(
    *,
    email_to: str,
    subject: str = "",
    html_content: str = "",
    text_content: str = "",
) -> None:
    ensure_capability(Capability.EMAIL)
    assert settings.emails_enabled, "no provided configuration for email variables"
    assert settings.EMAILS_FROM_EMAIL is not None
    message = Message(
        subject=subject,
        html=html_content,
        text=text_content,
        mail_from=(settings.EMAILS_FROM_NAME, settings.EMAILS_FROM_EMAIL),
    )
    smtp_options = {
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
    response = message.send(to=email_to, smtp=smtp_options)
    logger.info(f"send email result: {response}")


def generate_test_email(email_to: str) -> EmailData:
    project_name = settings.PROJECT_NAME
    subject = f"{project_name} - Test email"
    html_content = render_email_template(
        template_name="test_email.html",
        context={"project_name": settings.PROJECT_NAME, "email": email_to},
    )
    return EmailData(html_content=html_content, subject=subject)


def generate_reset_password_email(email_to: str, email: str, token: str) -> EmailData:
    project_name = settings.PROJECT_NAME
    subject = f"{project_name} - Password recovery for user {email}"
    link = f"{settings.FRONTEND_HOST}/reset-password?token={token}"
    html_content = render_email_template(
        template_name="reset_password.html",
        context={
            "project_name": settings.PROJECT_NAME,
            "username": email,
            "email": email_to,
            "valid_hours": settings.EMAIL_RESET_TOKEN_EXPIRE_HOURS,
            "link": link,
        },
    )
    return EmailData(html_content=html_content, subject=subject)


def generate_new_account_email(
    email_to: str, username: str, password: str
) -> EmailData:
    project_name = settings.PROJECT_NAME
    subject = f"{project_name} - New account for user {username}"
    html_content = render_email_template(
        template_name="new_account.html",
        context={
            "project_name": settings.PROJECT_NAME,
            "username": username,
            "password": password,
            "email": email_to,
            "link": settings.FRONTEND_HOST,
        },
    )
    return EmailData(html_content=html_content, subject=subject)


def generate_user_invitation_email(
    email_to: str, token: str, valid_hours: int
) -> EmailData:
    project_name = settings.PROJECT_NAME
    link = f"{settings.FRONTEND_HOST}/accept-invitation?token={token}"
    subject = f"{project_name} - You're invited"
    html_content = render_email_template(
        template_name="user_invitation.html",
        context={
            "project_name": project_name,
            "email": email_to,
            "link": link,
            "valid_hours": valid_hours,
        },
    )
    return EmailData(html_content=html_content, subject=subject)


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
    except (InvalidTokenError, KeyError, TypeError, ValueError):
        return None
