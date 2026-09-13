import uuid

from pydantic import EmailStr, TypeAdapter, ValidationError
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.security import get_password_hash, verify_password
from app.models import User
from app.repositories import users as user_repository
from app.schemas import UserCreate, UserUpdate, UserUpdateMe

email_adapter = TypeAdapter(EmailStr)


class UserEmailAlreadyExistsError(Exception):
    pass


class UserNotFoundError(Exception):
    pass


class InsufficientPrivilegesError(Exception):
    pass


class SelfDeleteForbiddenError(Exception):
    pass


class IncorrectPasswordError(Exception):
    pass


class SamePasswordError(Exception):
    pass


def _build_user_updates(user_in: UserUpdate) -> dict[str, str | bool | None]:
    updates: dict[str, str | bool | None] = user_in.model_dump(
        exclude_unset=True,
        exclude={"password"},
    )
    if user_in.password is not None:
        updates["hashed_password"] = get_password_hash(user_in.password)
    return updates


def _has_valid_user_email(user: User) -> bool:
    try:
        email_adapter.validate_python(user.email)
    except ValidationError:
        return False
    return True


def get_user_by_id(*, session: Session, user_id: uuid.UUID) -> User | None:
    return user_repository.get_user_by_id(session=session, user_id=user_id)


def get_user_by_email(*, session: Session, email: str) -> User | None:
    return user_repository.get_user_by_email(
        session=session, email=normalize_user_email(email)
    )


def normalize_user_email(email: str) -> str:
    return str(email_adapter.validate_python(email)).strip().casefold()


def list_users(*, session: Session, skip: int = 0, limit: int = 100) -> list[User]:
    users = user_repository.list_users(session=session, skip=skip, limit=limit)
    return [user for user in users if _has_valid_user_email(user)]


def create_user(*, session: Session, user_in: UserCreate) -> User:
    email = normalize_user_email(str(user_in.email))
    existing_user = get_user_by_email(session=session, email=email)
    if existing_user:
        raise UserEmailAlreadyExistsError

    return user_repository.create_user(
        session=session,
        email=email,
        hashed_password=get_password_hash(user_in.password),
        is_active=user_in.is_active,
        is_superuser=user_in.is_superuser,
        full_name=user_in.full_name,
    )


def update_user_me(
    *, session: Session, current_user: User, user_in: UserUpdateMe
) -> User:
    if user_in.email:
        existing_user = get_user_by_email(session=session, email=user_in.email)
        if existing_user and existing_user.id != current_user.id:
            raise UserEmailAlreadyExistsError

    updates = user_in.model_dump(exclude_unset=True)
    if "email" in updates:
        updates["email"] = normalize_user_email(str(updates["email"]))
    return user_repository.update_user(
        session=session,
        db_user=current_user,
        updates=updates,
    )


def set_user_password(*, session: Session, user: User, new_password: str) -> User:
    return user_repository.update_user(
        session=session,
        db_user=user,
        updates={"hashed_password": get_password_hash(new_password)},
    )


def update_password(
    *,
    session: Session,
    current_user: User,
    current_password: str,
    new_password: str,
) -> User:
    verified, _ = verify_password(current_password, current_user.hashed_password)
    if not verified:
        raise IncorrectPasswordError
    if current_password == new_password:
        raise SamePasswordError

    return set_user_password(
        session=session, user=current_user, new_password=new_password
    )


def get_user_for_view(
    *, session: Session, current_user: User, user_id: uuid.UUID
) -> User:
    if current_user.id == user_id:
        return current_user
    if not current_user.is_superuser:
        raise InsufficientPrivilegesError

    user = get_user_by_id(session=session, user_id=user_id)
    if not user:
        raise UserNotFoundError
    return user


def update_user_by_id(
    *, session: Session, user_id: uuid.UUID, user_in: UserUpdate
) -> User:
    db_user = get_user_by_id(session=session, user_id=user_id)
    if not db_user:
        raise UserNotFoundError

    if user_in.email:
        existing_user = get_user_by_email(session=session, email=user_in.email)
        if existing_user and existing_user.id != user_id:
            raise UserEmailAlreadyExistsError

    updates = _build_user_updates(user_in)
    if "email" in updates:
        updates["email"] = normalize_user_email(str(updates["email"]))
    return user_repository.update_user(
        session=session,
        db_user=db_user,
        updates=updates,
    )


def delete_user_me(*, session: Session, current_user: User) -> None:
    if current_user.is_superuser:
        raise SelfDeleteForbiddenError
    user_repository.delete_user(session=session, db_user=current_user)


def delete_user_by_id(
    *, session: Session, current_user: User, user_id: uuid.UUID
) -> None:
    user = get_user_by_id(session=session, user_id=user_id)
    if not user:
        raise UserNotFoundError
    if user.id == current_user.id:
        raise SelfDeleteForbiddenError
    user_repository.delete_user(session=session, db_user=user)


def ensure_initial_superuser(session: Session) -> None:
    user = get_user_by_email(session=session, email=settings.FIRST_SUPERUSER)
    if not user:
        user = create_user(
            session=session,
            user_in=UserCreate(
                email=settings.FIRST_SUPERUSER,
                password=settings.FIRST_SUPERUSER_PASSWORD,
                is_superuser=True,
                is_active=True,
            ),
        )

    verified, _ = verify_password(
        settings.FIRST_SUPERUSER_PASSWORD, user.hashed_password
    )
    if user.is_superuser and user.is_active and verified:
        return

    user_repository.update_user(
        session=session,
        db_user=user,
        updates={
            "hashed_password": get_password_hash(settings.FIRST_SUPERUSER_PASSWORD),
            "is_superuser": True,
            "is_active": True,
            "full_name": user.full_name,
        },
    )
