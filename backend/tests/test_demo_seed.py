import uuid
from collections.abc import Generator
from datetime import date
from decimal import Decimal

import pytest
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.core.security import verify_password
from app.demo_seed import DEMO_EMAIL, DEMO_LEDGER_NAME, seed_demo
from app.domain import ObligationLifecycle
from app.models import Category, CategoryGroup, Ledger, Obligation, User

REFERENCE_DATE = date(2026, 9, 7)
DEMO_TEST_PASSWORD = "test-demo-password"


@pytest.fixture(autouse=True)
def cleanup_demo_data(db: Session) -> Generator[None, None, None]:
    def cleanup() -> None:
        user = db.scalar(select(User).where(User.email == DEMO_EMAIL))
        if user is None:
            return
        ledgers = list(db.scalars(select(Ledger).where(Ledger.owner_user_id == user.id)))
        for ledger in ledgers:
            db.delete(ledger)
        db.commit()
        db.execute(delete(User).where(User.id == user.id))
        db.commit()

    cleanup()
    yield
    cleanup()


def _obligation(
    db: Session,
    *,
    ledger_id: uuid.UUID,
    code: str,
    year: int,
    month: int,
) -> Obligation:
    obligation = db.scalar(
        select(Obligation)
        .join(Category, Category.id == Obligation.category_id)
        .where(
            Obligation.ledger_id == ledger_id,
            Category.code == code,
            Obligation.period_year == year,
            Obligation.period_month == month,
        )
    )
    assert obligation is not None
    return obligation


def test_seed_demo_creates_relative_representative_dataset(db: Session) -> None:
    result = seed_demo(
        session=db,
        password=DEMO_TEST_PASSWORD,
        reference_date=REFERENCE_DATE,
    )

    user = db.get(User, result.user_id)
    ledger = db.get(Ledger, result.ledger_id)
    assert user is not None
    assert user.email == DEMO_EMAIL
    assert user.is_active is True
    assert user.is_superuser is False
    verified, _ = verify_password(DEMO_TEST_PASSWORD, user.hashed_password)
    assert verified is True

    assert ledger is not None
    assert ledger.name == DEMO_LEDGER_NAME
    assert result.reference_date == REFERENCE_DATE

    category_count = db.scalar(
        select(func.count()).select_from(Category).where(Category.ledger_id == ledger.id)
    )
    group_count = db.scalar(
        select(func.count())
        .select_from(CategoryGroup)
        .where(CategoryGroup.ledger_id == ledger.id)
    )
    obligation_count = db.scalar(
        select(func.count())
        .select_from(Obligation)
        .where(Obligation.ledger_id == ledger.id)
    )
    assert category_count == 5
    assert group_count == 3
    assert obligation_count == 9

    overdue = _obligation(
        db,
        ledger_id=ledger.id,
        code="ELEC",
        year=2026,
        month=8,
    )
    assert overdue.lifecycle is ObligationLifecycle.READY
    assert overdue.due_date is not None and overdue.due_date < REFERENCE_DATE

    upcoming = _obligation(
        db,
        ledger_id=ledger.id,
        code="ELEC",
        year=2026,
        month=9,
    )
    assert upcoming.lifecycle is ObligationLifecycle.READY
    assert upcoming.due_date is not None and upcoming.due_date > REFERENCE_DATE

    collecting = _obligation(
        db,
        ledger_id=ledger.id,
        code="INET",
        year=2026,
        month=9,
    )
    assert collecting.lifecycle is ObligationLifecycle.COLLECTING_DATA

    paid = _obligation(
        db,
        ledger_id=ledger.id,
        code="STRM",
        year=2026,
        month=9,
    )
    assert paid.lifecycle is ObligationLifecycle.PAID

    error = _obligation(
        db,
        ledger_id=ledger.id,
        code="MOBI",
        year=2026,
        month=9,
    )
    assert error.lifecycle is ObligationLifecycle.ERROR

    future = _obligation(
        db,
        ledger_id=ledger.id,
        code="RENT",
        year=2026,
        month=10,
    )
    assert future.lifecycle is ObligationLifecycle.READY
    assert future.due_date is not None and future.due_date > REFERENCE_DATE


def test_seed_demo_replaces_existing_demo_ledger(db: Session) -> None:
    first = seed_demo(
        session=db,
        password=DEMO_TEST_PASSWORD,
        reference_date=REFERENCE_DATE,
    )
    current_electricity = _obligation(
        db,
        ledger_id=first.ledger_id,
        code="ELEC",
        year=2026,
        month=9,
    )
    current_electricity.current_amount = Decimal("1.00")
    db.commit()

    second = seed_demo(
        session=db,
        password=DEMO_TEST_PASSWORD,
        reference_date=REFERENCE_DATE,
    )

    assert second.ledger_id != first.ledger_id
    ledgers = list(
        db.scalars(
            select(Ledger).where(
                Ledger.owner_user_id == second.user_id,
                Ledger.name == DEMO_LEDGER_NAME,
            )
        )
    )
    assert len(ledgers) == 1

    restored = _obligation(
        db,
        ledger_id=second.ledger_id,
        code="ELEC",
        year=2026,
        month=9,
    )
    assert restored.current_amount == Decimal("198.40")
