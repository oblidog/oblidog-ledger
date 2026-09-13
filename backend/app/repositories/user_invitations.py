import uuid

from sqlalchemy import desc, select
from sqlalchemy.orm import Session

from app.models import UserInvitation


def get_by_id(
    *, session: Session, invitation_id: uuid.UUID, for_update: bool = False
) -> UserInvitation | None:
    statement = select(UserInvitation).where(UserInvitation.id == invitation_id)
    if for_update:
        statement = statement.with_for_update()
    return session.scalar(statement)


def get_by_token_hash(
    *, session: Session, token_hash: str, for_update: bool = False
) -> UserInvitation | None:
    statement = select(UserInvitation).where(
        UserInvitation.token_hash == token_hash
    )
    if for_update:
        statement = statement.with_for_update()
    return session.scalar(statement)


def get_pending_by_email(
    *, session: Session, email: str, for_update: bool = False
) -> UserInvitation | None:
    statement = select(UserInvitation).where(
        UserInvitation.email == email,
        UserInvitation.accepted_at.is_(None),
        UserInvitation.revoked_at.is_(None),
    )
    if for_update:
        statement = statement.with_for_update()
    return session.scalar(statement)


def list_invitations(
    *, session: Session, skip: int = 0, limit: int = 100
) -> list[UserInvitation]:
    statement = (
        select(UserInvitation)
        .order_by(desc(UserInvitation.created_at))
        .offset(skip)
        .limit(limit)
    )
    return list(session.scalars(statement).all())
