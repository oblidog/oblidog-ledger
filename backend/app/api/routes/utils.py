import asyncio
import os
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic.networks import EmailStr
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from app.api.deps import get_current_active_superuser
from app.core.config import settings
from app.core.db import engine
from app.demo_seed import DEMO_EMAIL, DEMO_PASSWORD_ENV
from app.schemas import Message
from app.utils import generate_test_email, send_email

router = APIRouter(prefix="/utils", tags=["utils"])
READINESS_TIMEOUT_SECONDS = 3.0


def _check_database() -> None:
    """Execute the smallest useful database round-trip for readiness."""
    with engine.connect() as connection:
        connection.execute(text("SET LOCAL statement_timeout = 2000"))
        connection.execute(text("SELECT 1"))



@router.post(
    "/test-email/",
    dependencies=[Depends(get_current_active_superuser)],
    status_code=201,
)
def test_email(email_to: EmailStr) -> Message:
    """
    Test emails.
    """
    email_data = generate_test_email(email_to=email_to)
    send_email(
        email_to=email_to,
        subject=email_data.subject,
        html_content=email_data.html_content,
    )
    return Message(message="Test email sent")


@router.get("/public-config", include_in_schema=False)
def public_config() -> dict[str, Any]:
    """Return non-sensitive runtime information needed by the public frontend."""
    is_demo = settings.ENVIRONMENT == "demo"
    password = os.environ.get(DEMO_PASSWORD_ENV) if is_demo else None
    credentials = (
        {"email": DEMO_EMAIL, "password": password}
        if is_demo and password
        else None
    )
    return {
        "environment": settings.ENVIRONMENT,
        "is_demo": is_demo,
        "demo_credentials": credentials,
    }


@router.get("/health-check/")
async def health_check() -> bool:
    """Process liveness: does not depend on external services."""
    return True


@router.get("/readiness-check/")
async def readiness_check() -> bool:
    """Application readiness: require a bounded database round-trip."""
    try:
        await asyncio.wait_for(
            asyncio.to_thread(_check_database), timeout=READINESS_TIMEOUT_SECONDS
        )
    except (TimeoutError, SQLAlchemyError):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Service unavailable",
        ) from None
    return True
