"""Calendar dates in the configured business timezone."""

from datetime import date, datetime
from zoneinfo import ZoneInfo

from app.core.config import settings


def business_today() -> date:
    return datetime.now(ZoneInfo(settings.SYSTEM_RUN_TIMEZONE)).date()
