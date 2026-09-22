import uuid
from datetime import datetime

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.models import PasswordResetToken


def invalidate_active_for_user(
    *, session: Session, user_id: uuid.UUID, invalidated_at: datetime
) -> None:
    session.execute(
        update(PasswordResetToken)
        .where(
            PasswordResetToken.user_id == user_id,
            PasswordResetToken.consumed_at.is_(None),
            PasswordResetToken.invalidated_at.is_(None),
        )
        .values(invalidated_at=invalidated_at)
    )


def get_by_id_and_hash_for_update(
    *, session: Session, token_id: uuid.UUID, token_hash: str
) -> PasswordResetToken | None:
    statement = (
        select(PasswordResetToken)
        .where(
            PasswordResetToken.id == token_id,
            PasswordResetToken.token_hash == token_hash,
        )
        .with_for_update()
    )
    return session.scalar(statement)
