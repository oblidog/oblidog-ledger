import os
from typing import Any

from fastapi import APIRouter, Depends
from pydantic.networks import EmailStr

from app.api.deps import get_current_active_superuser
from app.core.config import settings
from app.demo_seed import DEMO_EMAIL, DEMO_PASSWORD_ENV
from app.schemas import Message
from app.utils import generate_test_email, send_email

router = APIRouter(prefix="/utils", tags=["utils"])


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
    return True
