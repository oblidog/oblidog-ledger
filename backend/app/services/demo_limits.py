"""Per-owner demo quotas; callers retain the row lock until their write commits."""

import logging
import uuid
from typing import Any

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.demo_identity import DEMO_EMAIL
from app.models import User

logger = logging.getLogger(__name__)

MAX_LEDGERS = 3
MAX_GROUPS = 20
MAX_CATEGORIES = 50
MAX_OBLIGATIONS = 300
MAX_COMPONENTS = 20
MAX_SCHEMA_VERSIONS = 5


def demo_owner_locked(session: Session, owner_user_id: uuid.UUID) -> bool:
    if settings.ENVIRONMENT != "demo":
        return False
    # The seed/reset job does not use API routes and is intentionally unaffected.
    owner = session.scalar(
        select(User).where(User.id == owner_user_id).with_for_update()
    )
    return owner is not None and owner.email == DEMO_EMAIL


def remaining_capacity(
    session: Session,
    *,
    owner_user_id: uuid.UUID,
    model: Any,
    predicate: Any,
    limit: int,
    resource: str,
    allow_full: bool = False,
) -> int | None:
    if not demo_owner_locked(session, owner_user_id):
        return None
    count = (
        session.scalar(select(func.count()).select_from(model).where(predicate)) or 0
    )
    remaining = max(0, limit - count)
    if remaining == 0 and not allow_full:
        reject_limit(resource, limit)
    return remaining


def reject_limit(resource: str, limit: int) -> None:
    logger.warning("Demo quota reached resource=%s limit=%d", resource, limit)
    raise HTTPException(
        status_code=409,
        detail=f"Demo limit reached: at most {limit} {resource}. Data is periodically reset.",
    )
