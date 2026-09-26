"""Operator-only demo reset, shared by manual invocation and Vercel Cron."""

import logging
import os
import secrets

from fastapi import APIRouter, HTTPException, Request, Response, status

from app.core.config import settings
from app.demo_seed import DEMO_PASSWORD_ENV
from app.services.demo_reset import (
    DemoResetBusyError,
    InvalidDemoTargetError,
    reset_demo_data,
    validate_demo_target,
)

router = APIRouter(prefix="/demo", tags=["demo"])
logger = logging.getLogger(__name__)


@router.get("/reset", include_in_schema=False)
def reset_demo(request: Request, response: Response) -> dict[str, str]:
    response.headers["Cache-Control"] = "no-store"
    if settings.ENVIRONMENT != "demo":
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)

    configured_secret = settings.CRON_SECRET
    authorization = request.headers.get("authorization", "")
    if (
        not configured_secret
        or len(configured_secret) < 16
        or not secrets.compare_digest(authorization, f"Bearer {configured_secret}")
    ):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED)

    password = os.environ.get(DEMO_PASSWORD_ENV, "")
    if not 8 <= len(password) <= 128:
        logger.error("Demo reset unavailable: demo password is missing or invalid")
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE)

    try:
        validate_demo_target(str(settings.POSTGRES_URL or ""), settings.DEMO_NEON_HOST)
    except InvalidDemoTargetError:
        logger.error(
            "Demo reset refused: configured database target is not the demo Neon endpoint"
        )
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE) from None

    try:
        result = reset_demo_data(password=password)
    except DemoResetBusyError:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Demo reset already running"
        ) from None
    except Exception:
        logger.exception("Demo reset failed")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Demo reset failed",
        ) from None

    logger.info("Demo reset completed for reference date %s", result.reference_date)
    return {"status": "ok", "reference_date": result.reference_date.isoformat()}
