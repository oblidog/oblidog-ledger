import hashlib
import secrets
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Literal

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.security import get_password_hash
from app.models import User, UserInvitation
from app.repositories import user_invitations as invitation_repository
from app.schemas import UserInvitationCreate
from app.services import users as user_service


class InvitationNotFoundError(Exception):
    pass


class InvitationAlreadyExistsError(Exception):
    pass


class InvitationUserAlreadyExistsError(Exception):
    pass


class InvitationExpiredError(Exception):
    pass


class InvitationAcceptedError(Exception):
    pass


class InvitationRevokedError(Exception):
    pass


@dataclass(frozen=True, slots=True)
class InvitationDelivery:
    invitation: UserInvitation
    token: str


InvitationStatus = Literal["pending", "expired", "accepted", "revoked"]


def generate_invitation_token() -> str:
    return secrets.token_urlsafe(32)


def hash_invitation_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _as_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def invitation_status(
    invitation: UserInvitation, *, now: datetime | None = None
) -> InvitationStatus:
    if invitation.accepted_at is not None:
        return "accepted"
    if invitation.revoked_at is not None:
        return "revoked"
    if _as_utc(invitation.expires_at) <= _as_utc(now or datetime.now(UTC)):
        return "expired"
    return "pending"


def _new_expiry(now: datetime) -> datetime:
    return now + timedelta(hours=settings.USER_INVITATION_EXPIRE_HOURS)


def _validate_usable(invitation: UserInvitation, *, now: datetime) -> None:
    status = invitation_status(invitation, now=now)
    if status == "accepted":
        raise InvitationAcceptedError
    if status == "revoked":
        raise InvitationRevokedError
    if status == "expired":
        raise InvitationExpiredError


def list_invitations(
    *, session: Session, skip: int = 0, limit: int = 100
) -> list[UserInvitation]:
    return invitation_repository.list_invitations(
        session=session, skip=skip, limit=limit
    )


def create_invitation(
    *, session: Session, invitation_in: UserInvitationCreate, created_by: User
) -> InvitationDelivery:
    email = user_service.normalize_user_email(str(invitation_in.email))
    if user_service.get_user_by_email(session=session, email=email) is not None:
        raise InvitationUserAlreadyExistsError

    now = datetime.now(UTC)
    existing = invitation_repository.get_pending_by_email(
        session=session, email=email, for_update=True
    )
    if existing is not None:
        if invitation_status(existing, now=now) != "expired":
            raise InvitationAlreadyExistsError
        existing.revoked_at = now
        session.flush()

    token = generate_invitation_token()
    invitation = UserInvitation(
        email=email,
        full_name=invitation_in.full_name,
        is_superuser=invitation_in.is_superuser,
        token_hash=hash_invitation_token(token),
        expires_at=_new_expiry(now),
        created_by_user_id=created_by.id,
    )
    session.add(invitation)
    try:
        session.commit()
    except IntegrityError as exc:
        session.rollback()
        raise InvitationAlreadyExistsError from exc
    session.refresh(invitation)
    return InvitationDelivery(invitation=invitation, token=token)


def resend_invitation(
    *, session: Session, invitation_id: uuid.UUID
) -> InvitationDelivery:
    invitation = invitation_repository.get_by_id(
        session=session, invitation_id=invitation_id, for_update=True
    )
    if invitation is None:
        raise InvitationNotFoundError
    if invitation.accepted_at is not None:
        raise InvitationAcceptedError
    if invitation.revoked_at is not None:
        raise InvitationRevokedError

    now = datetime.now(UTC)
    token = generate_invitation_token()
    invitation.token_hash = hash_invitation_token(token)
    invitation.expires_at = _new_expiry(now)
    session.add(invitation)
    session.commit()
    session.refresh(invitation)
    return InvitationDelivery(invitation=invitation, token=token)


def revoke_invitation(*, session: Session, invitation_id: uuid.UUID) -> None:
    invitation = invitation_repository.get_by_id(
        session=session, invitation_id=invitation_id, for_update=True
    )
    if invitation is None:
        raise InvitationNotFoundError
    if invitation.accepted_at is not None:
        raise InvitationAcceptedError
    if invitation.revoked_at is None:
        invitation.revoked_at = datetime.now(UTC)
        session.add(invitation)
    session.commit()


def inspect_invitation(*, session: Session, token: str) -> UserInvitation:
    invitation = invitation_repository.get_by_token_hash(
        session=session, token_hash=hash_invitation_token(token)
    )
    if invitation is None:
        raise InvitationNotFoundError
    _validate_usable(invitation, now=datetime.now(UTC))
    return invitation


def accept_invitation(*, session: Session, token: str, new_password: str) -> User:
    invitation = invitation_repository.get_by_token_hash(
        session=session,
        token_hash=hash_invitation_token(token),
        for_update=True,
    )
    if invitation is None:
        raise InvitationNotFoundError

    now = datetime.now(UTC)
    _validate_usable(invitation, now=now)
    if (
        user_service.get_user_by_email(session=session, email=invitation.email)
        is not None
    ):
        raise InvitationUserAlreadyExistsError

    user = User(
        email=invitation.email,
        full_name=invitation.full_name,
        is_superuser=invitation.is_superuser,
        is_active=True,
        hashed_password=get_password_hash(new_password),
    )
    invitation.accepted_at = now
    session.add_all([user, invitation])
    try:
        session.commit()
    except IntegrityError as exc:
        session.rollback()
        raise InvitationUserAlreadyExistsError from exc
    session.refresh(user)
    return user
