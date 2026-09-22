import uuid
from collections.abc import Generator
from datetime import date
from decimal import Decimal

import pytest
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.core.security import verify_password
from app.demo_seed import DEMO_EMAIL, DEMO_LEDGER_NAME, seed_demo
from app.domain import EffectiveValueSourceMode, ObligationLifecycle
from app.models import (
    Category,
    CategoryDataRecord,
    CategoryDataSchema,
    CategoryGroup,
    Counterparty,
    Integration,
    Ledger,
    Obligation,
    ObligationComponent,
    User,
)

REFERENCE_DATE = date(2026, 9, 7)
DEMO_TEST_PASSWORD = "test-demo-password"


@pytest.fixture(autouse=True)
def cleanup_demo_data(db: Session) -> Generator[None, None, None]:
    def cleanup() -> None:
        user = db.scalar(select(User).where(User.email == DEMO_EMAIL))
        if user is None:
            return
        ledgers = list(
            db.scalars(select(Ledger).where(Ledger.owner_user_id == user.id))
        )
        for ledger in ledgers:
            db.execute(delete(Integration).where(Integration.ledger_id == ledger.id))
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
        select(func.count())
        .select_from(Category)
        .where(Category.ledger_id == ledger.id)
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
    assert category_count == 15
    assert group_count == 7
    assert obligation_count == 45

    integrations = list(
        db.scalars(select(Integration).where(Integration.ledger_id == ledger.id))
    )
    categories = list(
        db.scalars(select(Category).where(Category.ledger_id == ledger.id))
    )
    obligations = list(
        db.scalars(select(Obligation).where(Obligation.ledger_id == ledger.id))
    )
    counterparty_ids = {
        category.counterparty_id
        for category in categories
        if category.counterparty_id is not None
    }
    counterparties = list(
        db.scalars(select(Counterparty).where(Counterparty.id.in_(counterparty_ids)))
    )
    assert len(integrations) == 12
    assert all(category.counterparty_id is not None for category in categories)
    assert all(category.currency == "EUR" for category in categories)
    assert len(counterparties) == 10
    assert all(
        counterparty.logo_url is not None
        and counterparty.logo_url.startswith("/demo-logos/")
        for counterparty in counterparties
    )
    assert all(obligation.counterparty_id is not None for obligation in obligations)
    assert all(obligation.currency == "EUR" for obligation in obligations)
    assert (
        sum(
            obligation.effective_value_source is EffectiveValueSourceMode.INTEGRATION
            for obligation in obligations
        )
        == 36
    )
    assert (
        sum(
            obligation.effective_value_source is EffectiveValueSourceMode.MANUAL
            for obligation in obligations
        )
        == 9
    )

    overdue = _obligation(
        db,
        ledger_id=ledger.id,
        code="WATR",
        year=2026,
        month=8,
    )
    assert overdue.lifecycle is ObligationLifecycle.READY
    assert overdue.due_date is not None and overdue.due_date < REFERENCE_DATE

    upcoming = _obligation(
        db,
        ledger_id=ledger.id,
        code="GASS",
        year=2026,
        month=9,
    )
    assert upcoming.lifecycle is ObligationLifecycle.READY
    assert upcoming.due_date is not None and upcoming.due_date > REFERENCE_DATE

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

    assert (
        db.scalar(
            select(func.count())
            .select_from(CategoryDataSchema)
            .join(Category, Category.id == CategoryDataSchema.category_id)
            .where(Category.ledger_id == ledger.id)
        )
        == 5
    )
    assert (
        db.scalar(
            select(func.count())
            .select_from(CategoryDataRecord)
            .join(Category, Category.id == CategoryDataRecord.category_id)
            .where(Category.ledger_id == ledger.id)
        )
        == 15
    )
    assert (
        db.scalar(
            select(func.count())
            .select_from(ObligationComponent)
            .join(Obligation, Obligation.id == ObligationComponent.obligation_id)
            .where(Obligation.ledger_id == ledger.id)
        )
        == 15
    )

    shared_counterparty = db.scalar(
        select(Counterparty)
        .join(Category, Category.counterparty_id == Counterparty.id)
        .where(Category.ledger_id == ledger.id)
        .group_by(Counterparty.id)
        .having(func.count(Category.id) > 1)
    )
    assert shared_counterparty is not None


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
    assert restored.current_amount == Decimal("208.75")
