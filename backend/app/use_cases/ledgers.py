from __future__ import annotations

import uuid

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.domain import Currency, LedgerAccessRole
from app.domain.business_calendar import validate_calendar_country
from app.models import (
    Category,
    CategoryGroup,
    Ledger,
    LedgerMembership,
    Obligation,
    User,
)
from app.use_cases.exceptions import (
    LedgerAccessConflictError,
    LedgerCategoriesInUseError,
    LedgerMembershipNotFoundError,
    LedgerNotFoundError,
    UserNotFoundError,
)


def _require_user(*, session: Session, user_id: uuid.UUID) -> User:
    user = session.get(User, user_id)
    if user is None:
        raise UserNotFoundError
    return user


def _require_ledger(*, session: Session, ledger_id: uuid.UUID) -> Ledger:
    ledger = session.get(Ledger, ledger_id)
    if ledger is None:
        raise LedgerNotFoundError
    return ledger


def _normalize_name(value: str) -> str:
    normalized = value.strip()
    if not normalized:
        raise ValueError("name must not be empty")
    return normalized


def create_ledger(
    *,
    session: Session,
    owner_user_id: uuid.UUID,
    name: str,
    description: str | None = None,
    business_calendar_country: str | None = None,
    default_currency: Currency = Currency.PLN,
) -> Ledger:
    _require_user(session=session, user_id=owner_user_id)

    ledger = Ledger(
        owner_user_id=owner_user_id,
        name=_normalize_name(name),
        description=description,
        business_calendar_country=validate_calendar_country(
            business_calendar_country
            if business_calendar_country is not None
            else settings.BUSINESS_CALENDAR_COUNTRY
        ),
        default_currency=default_currency,
    )
    session.add(ledger)
    session.flush()

    session.add(
        LedgerMembership(
            ledger_id=ledger.id,
            user_id=owner_user_id,
            role=LedgerAccessRole.OWNER,
        )
    )
    session.commit()
    session.refresh(ledger)
    return ledger


def update_ledger(
    *,
    session: Session,
    ledger_id: uuid.UUID,
    name: str,
    description: str | None = None,
    business_calendar_country: str | None = None,
    default_currency: Currency | None = None,
) -> Ledger:
    ledger = _require_ledger(session=session, ledger_id=ledger_id)
    country = (
        validate_calendar_country(business_calendar_country)
        if business_calendar_country is not None
        else None
    )
    ledger.name = _normalize_name(name)
    ledger.description = description
    if country is not None:
        ledger.business_calendar_country = country
    if default_currency is not None:
        ledger.default_currency = default_currency
    session.commit()
    session.refresh(ledger)
    return ledger


def delete_all_categories(*, session: Session, ledger_id: uuid.UUID) -> None:
    _require_ledger(session=session, ledger_id=ledger_id)
    has_obligations = session.scalar(
        select(Obligation.id).where(Obligation.ledger_id == ledger_id).limit(1)
    )
    if has_obligations is not None:
        raise LedgerCategoriesInUseError

    session.execute(delete(Category).where(Category.ledger_id == ledger_id))
    session.execute(delete(CategoryGroup).where(CategoryGroup.ledger_id == ledger_id))
    session.commit()


def delete_all_obligations(*, session: Session, ledger_id: uuid.UUID) -> None:
    _require_ledger(session=session, ledger_id=ledger_id)
    session.execute(delete(Obligation).where(Obligation.ledger_id == ledger_id))
    session.commit()


def share_ledger(
    *,
    session: Session,
    ledger_id: uuid.UUID,
    target_user_id: uuid.UUID,
    role: LedgerAccessRole,
) -> LedgerMembership:
    ledger = _require_ledger(session=session, ledger_id=ledger_id)
    _require_user(session=session, user_id=target_user_id)

    if role == LedgerAccessRole.OWNER and target_user_id != ledger.owner_user_id:
        raise LedgerAccessConflictError

    membership = session.get(
        LedgerMembership,
        {"ledger_id": ledger_id, "user_id": target_user_id},
    )
    if membership is None:
        membership = LedgerMembership(
            ledger_id=ledger_id,
            user_id=target_user_id,
            role=(
                LedgerAccessRole.OWNER
                if target_user_id == ledger.owner_user_id
                else role
            ),
        )
        session.add(membership)
    elif membership.role != LedgerAccessRole.OWNER:
        membership.role = (
            LedgerAccessRole.OWNER if target_user_id == ledger.owner_user_id else role
        )

    session.commit()
    session.refresh(membership)
    return membership


def update_ledger_membership(
    *,
    session: Session,
    ledger_id: uuid.UUID,
    target_user_id: uuid.UUID,
    role: LedgerAccessRole,
) -> LedgerMembership:
    ledger = _require_ledger(session=session, ledger_id=ledger_id)
    membership = session.get(
        LedgerMembership,
        {"ledger_id": ledger_id, "user_id": target_user_id},
    )
    if membership is None:
        raise LedgerMembershipNotFoundError
    if (
        target_user_id == ledger.owner_user_id
        or membership.role == LedgerAccessRole.OWNER
    ):
        raise LedgerAccessConflictError
    if role == LedgerAccessRole.OWNER:
        raise LedgerAccessConflictError

    membership.role = role
    session.commit()
    session.refresh(membership)
    return membership


def remove_ledger_membership(
    *,
    session: Session,
    ledger_id: uuid.UUID,
    target_user_id: uuid.UUID,
) -> None:
    ledger = _require_ledger(session=session, ledger_id=ledger_id)
    membership = session.get(
        LedgerMembership,
        {"ledger_id": ledger_id, "user_id": target_user_id},
    )
    if membership is None:
        raise LedgerMembershipNotFoundError
    if (
        target_user_id == ledger.owner_user_id
        or membership.role == LedgerAccessRole.OWNER
    ):
        raise LedgerAccessConflictError

    session.delete(membership)
    session.commit()


def list_ledgers_for_user(*, session: Session, user_id: uuid.UUID) -> list[Ledger]:
    _require_user(session=session, user_id=user_id)

    return list(
        session.scalars(
            select(Ledger)
            .join(LedgerMembership, LedgerMembership.ledger_id == Ledger.id)
            .where(LedgerMembership.user_id == user_id)
            .order_by(Ledger.name.asc(), Ledger.created_at.asc(), Ledger.id.asc())
        ).all()
    )
