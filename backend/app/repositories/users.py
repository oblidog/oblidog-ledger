import uuid

from sqlalchemy import desc, func, select
from sqlalchemy.orm import Session

from app.models import User

USER_UPDATE_FIELDS = {
    "email",
    "full_name",
    "hashed_password",
    "is_active",
    "is_superuser",
}


def get_user_by_id(*, session: Session, user_id: uuid.UUID) -> User | None:
    return session.get(User, user_id)


def get_user_by_email(*, session: Session, email: str) -> User | None:
    statement = select(User).where(func.lower(User.email) == email.casefold())
    return session.scalars(statement).first()


def list_users(*, session: Session, skip: int = 0, limit: int = 100) -> list[User]:
    statement = select(User).order_by(desc(User.created_at)).offset(skip).limit(limit)
    return list(session.scalars(statement).all())


def create_user(
    *,
    session: Session,
    email: str,
    hashed_password: str,
    is_active: bool = True,
    is_superuser: bool = False,
    full_name: str | None = None,
) -> User:
    db_obj = User(
        email=email,
        hashed_password=hashed_password,
        is_active=is_active,
        is_superuser=is_superuser,
        full_name=full_name,
    )
    session.add(db_obj)
    session.commit()
    session.refresh(db_obj)
    return db_obj


def update_user(
    *, session: Session, db_user: User, updates: dict[str, str | bool | None]
) -> User:
    unexpected_fields = set(updates) - USER_UPDATE_FIELDS
    if unexpected_fields:
        raise ValueError(f"Unsupported user updates: {sorted(unexpected_fields)}")
    for field, value in updates.items():
        setattr(db_user, field, value)
    session.add(db_user)
    session.commit()
    session.refresh(db_user)
    return db_user


def delete_user(*, session: Session, db_user: User) -> None:
    session.delete(db_user)
    session.commit()
