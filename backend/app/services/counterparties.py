from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import Category, Counterparty, Obligation


class CounterpartyNotFoundError(Exception):
    pass


class DuplicateCounterpartyError(Exception):
    pass


class CounterpartyInUseError(Exception):
    pass


def _normalize_name(value: str) -> str:
    value = value.strip()
    if not value:
        raise ValueError("name must not be empty")
    return value


def _is_counterparty_name_conflict(exc: IntegrityError) -> bool:
    constraint_name = getattr(getattr(exc.orig, "diag", None), "constraint_name", None)
    return constraint_name == "uq_counterparty_name_lower"


def get_counterparty(*, session: Session, counterparty_id: uuid.UUID) -> Counterparty:
    counterparty = session.get(Counterparty, counterparty_id)
    if counterparty is None:
        raise CounterpartyNotFoundError
    return counterparty


def list_counterparties(*, session: Session) -> list[Counterparty]:
    return list(
        session.scalars(
            select(Counterparty).order_by(Counterparty.name.asc(), Counterparty.id.asc())
        ).all()
    )


def search_counterparties(
    *, session: Session, query: str, limit: int = 10
) -> list[Counterparty]:
    normalized = query.strip()
    statement = select(Counterparty)
    if normalized:
        pattern = f"%{normalized}%"
        statement = statement.where(
            or_(
                Counterparty.name.ilike(pattern),
                Counterparty.short_name.ilike(pattern),
            )
        )
    return list(
        session.scalars(
            statement.order_by(
                func.lower(Counterparty.name).asc(), Counterparty.id.asc()
            ).limit(limit)
        ).all()
    )


def create_counterparty(
    *,
    session: Session,
    name: str,
    short_name: str | None = None,
    logo_url: str | None = None,
    website_url: str | None = None,
) -> Counterparty:
    normalized_name = _normalize_name(name)
    existing = session.scalar(
        select(Counterparty.id).where(func.lower(Counterparty.name) == normalized_name.lower())
    )
    if existing is not None:
        raise DuplicateCounterpartyError
    counterparty = Counterparty(
        name=normalized_name,
        short_name=short_name.strip() if short_name else None,
        logo_url=logo_url,
        website_url=website_url,
    )
    session.add(counterparty)
    try:
        session.commit()
    except IntegrityError as exc:
        session.rollback()
        if _is_counterparty_name_conflict(exc):
            raise DuplicateCounterpartyError from exc
        raise
    session.refresh(counterparty)
    return counterparty


def update_counterparty(
    *,
    session: Session,
    counterparty_id: uuid.UUID,
    **changes: Any,
) -> Counterparty:
    allowed_fields = {"name", "short_name", "logo_url", "website_url"}
    if unexpected := set(changes) - allowed_fields:
        raise ValueError(f"Unsupported update fields: {', '.join(sorted(unexpected))}")

    counterparty = get_counterparty(session=session, counterparty_id=counterparty_id)

    if "name" in changes:
        name = changes["name"]
        if name is None:
            raise ValueError("name cannot be null")
        normalized_name = _normalize_name(name)
        existing = session.scalar(
            select(Counterparty.id).where(
                func.lower(Counterparty.name) == normalized_name.lower(),
                Counterparty.id != counterparty_id,
            )
        )
        if existing is not None:
            raise DuplicateCounterpartyError
        counterparty.name = normalized_name

    if "short_name" in changes:
        short_name = changes["short_name"]
        counterparty.short_name = short_name.strip() if short_name else None
    if "logo_url" in changes:
        counterparty.logo_url = changes["logo_url"]
    if "website_url" in changes:
        counterparty.website_url = changes["website_url"]

    try:
        session.commit()
    except IntegrityError as exc:
        session.rollback()
        if _is_counterparty_name_conflict(exc):
            raise DuplicateCounterpartyError from exc
        raise
    session.refresh(counterparty)
    return counterparty


def delete_counterparty(*, session: Session, counterparty_id: uuid.UUID) -> None:
    counterparty = get_counterparty(session=session, counterparty_id=counterparty_id)
    in_use = session.scalar(
        select(Category.id).where(Category.counterparty_id == counterparty_id).limit(1)
    ) or session.scalar(
        select(Obligation.id).where(Obligation.counterparty_id == counterparty_id).limit(1)
    )
    if in_use is not None:
        raise CounterpartyInUseError
    session.delete(counterparty)
    try:
        session.commit()
    except IntegrityError as exc:
        session.rollback()
        raise CounterpartyInUseError from exc
