import hmac
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.security import get_password_hash
from app.models import PasswordResetToken, User
from app.repositories import password_reset_tokens as token_repository
from app.utils import generate_password_reset_token, verify_password_reset_token


class InvalidPasswordResetTokenError(Exception):
    pass


_TOKEN_HASH_DOMAIN = b"oblidog:password-reset-token:v1\0"


@dataclass(frozen=True, slots=True)
class PasswordResetDelivery:
    token: str
    expires_at: datetime


def hash_password_reset_token(token: str) -> str:
    return hmac.digest(
        settings.SECRET_KEY.encode(),
        _TOKEN_HASH_DOMAIN + token.encode(),
        "sha256",
    ).hex()


def _lock_user(*, session: Session, user_id: uuid.UUID) -> User | None:
    return session.scalar(select(User).where(User.id == user_id).with_for_update())


def issue_password_reset(*, session: Session, user: User) -> PasswordResetDelivery:
    locked_user = _lock_user(session=session, user_id=user.id)
    if locked_user is None or not locked_user.is_active:
        raise InvalidPasswordResetTokenError

    now = datetime.now(UTC)
    expires_at = now + timedelta(hours=settings.EMAIL_RESET_TOKEN_EXPIRE_HOURS)
    token_id = uuid.uuid4()
    token = generate_password_reset_token(
        user_id=locked_user.id,
        token_id=token_id,
        issued_at=now,
        expires_at=expires_at,
    )

    # A newly issued reset link supersedes every older link for the user.
    token_repository.invalidate_active_for_user(
        session=session, user_id=locked_user.id, invalidated_at=now
    )
    session.add(
        PasswordResetToken(
            id=token_id,
            user_id=locked_user.id,
            token_hash=hash_password_reset_token(token),
            expires_at=expires_at,
        )
    )
    session.commit()
    return PasswordResetDelivery(token=token, expires_at=expires_at)


def reset_password(*, session: Session, token: str, new_password: str) -> User:
    claims = verify_password_reset_token(token)
    if claims is None:
        raise InvalidPasswordResetTokenError

    # Use the same lock order as issuance to avoid a reset/issuance deadlock.
    user = _lock_user(session=session, user_id=claims.user_id)
    if user is None or not user.is_active:
        raise InvalidPasswordResetTokenError

    reset_token = token_repository.get_by_id_and_hash_for_update(
        session=session,
        token_id=claims.token_id,
        token_hash=hash_password_reset_token(token),
    )
    now = datetime.now(UTC)
    if (
        reset_token is None
        or reset_token.user_id != claims.user_id
        or reset_token.consumed_at is not None
        or reset_token.invalidated_at is not None
        or reset_token.expires_at <= now
    ):
        raise InvalidPasswordResetTokenError

    # Hash before marking the capability consumed. Any hashing or database
    # failure rolls back both the password replacement and token consumption.
    hashed_password = get_password_hash(new_password)
    user.hashed_password = hashed_password
    user.session_version += 1
    reset_token.consumed_at = now
    session.add_all([user, reset_token])
    session.commit()
    return user
