import uuid
from collections.abc import Generator
from datetime import UTC, date, datetime, time, timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.core.security import verify_password
from app.demo_seed import DEMO_EMAIL, DEMO_LEDGER_NAME, seed_demo
from app.domain import (
    CurrentValueSource,
    EffectiveValueSourceMode,
    ObligationLifecycle,
    ValueState,
)
from app.models import (
    Category,
    CategoryDataRecord,
    CategoryDataSchema,
    CategoryGroup,
    Counterparty,
    Integration,
    IntegrationRun,
    Ledger,
    Obligation,
    ObligationComponent,
    User,
)
from app.services import demo_reset as demo_reset_service
from app.use_cases.integrations import integration_status
from app.use_cases.ledgers import create_ledger

REFERENCE_DATE = date(2026, 9, 7)
DEMO_TEST_PASSWORD = "test-demo-password"


@pytest.fixture(autouse=True)
def cleanup_demo_data(db: Session) -> Generator[None]:
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
    assert obligation_count == 90

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
    runs = list(
        db.scalars(
            select(IntegrationRun).where(
                IntegrationRun.integration_id.in_([item.id for item in integrations])
            )
        )
    )
    assert len(runs) == 72
    by_id = {item.id: item for item in integrations}
    for run in runs:
        integration = by_id[run.integration_id]
        if run.id != integration.current_run_id:
            continue
        assert run.id == integration.current_run_id
        assert run.result == integration.last_result
        assert run.error_code == integration.last_error_code
        assert run.finished_at == integration.current_finished_at
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
        == 60
    )
    assert (
        sum(
            obligation.effective_value_source is EffectiveValueSourceMode.MANUAL
            for obligation in obligations
        )
        == 18
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
        code="RENT",
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
    assert future.lifecycle is ObligationLifecycle.COLLECTING_DATA
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
        == 25
    )
    assert (
        db.scalar(
            select(func.count())
            .select_from(ObligationComponent)
            .join(Obligation, Obligation.id == ObligationComponent.obligation_id)
            .where(Obligation.ledger_id == ledger.id)
        )
        == 35
    )

    shared_counterparty = db.scalar(
        select(Counterparty)
        .join(Category, Category.counterparty_id == Counterparty.id)
        .where(Category.ledger_id == ledger.id)
        .group_by(Counterparty.id)
        .having(func.count(Category.id) > 1)
    )
    assert shared_counterparty is not None


def test_reseed_removes_renamed_and_extra_demo_ledgers(db: Session) -> None:
    first = seed_demo(
        session=db, password=DEMO_TEST_PASSWORD, reference_date=REFERENCE_DATE
    )
    existing = db.get(Ledger, first.ledger_id)
    assert existing is not None
    existing.name = "Visitor renamed the demo"
    db.commit()
    create_ledger(session=db, owner_user_id=first.user_id, name="Visitor extra ledger")

    second = seed_demo(
        session=db, password=DEMO_TEST_PASSWORD, reference_date=REFERENCE_DATE
    )
    remaining = list(
        db.scalars(select(Ledger).where(Ledger.owner_user_id == first.user_id))
    )
    assert [ledger.id for ledger in remaining] == [second.ledger_id]
    assert remaining[0].name == DEMO_LEDGER_NAME


@pytest.mark.parametrize(
    ("reference_date", "expected_overdue"),
    [
        (date(2026, 9, 1), 0),
        (date(2026, 9, 15), 3),
        (date(2026, 9, 30), 3),
    ],
)
def test_current_demo_period_keeps_overdue_share_healthy(
    db: Session,
    reference_date: date,
    expected_overdue: int,
) -> None:
    result = seed_demo(
        session=db,
        password=DEMO_TEST_PASSWORD,
        reference_date=reference_date,
    )

    current_obligations = list(
        db.scalars(
            select(Obligation).where(
                Obligation.ledger_id == result.ledger_id,
                Obligation.period_year == reference_date.year,
                Obligation.period_month == reference_date.month,
            )
        )
    )
    overdue = [
        obligation
        for obligation in current_obligations
        if obligation.due_date is not None
        and obligation.due_date < reference_date
        and obligation.lifecycle is not ObligationLifecycle.PAID
    ]

    assert len(current_obligations) == 15
    assert len(overdue) == expected_overdue
    assert len(overdue) <= len(current_obligations) // 5


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


def test_failed_reset_restores_previous_ledger(
    db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    first = seed_demo(
        session=db, password=DEMO_TEST_PASSWORD, reference_date=REFERENCE_DATE
    )
    monkeypatch.setattr(demo_reset_service, "engine", db.get_bind())

    def seed_then_fail(*, session: Session, password: str) -> None:
        seed_demo(session=session, password=password, reference_date=REFERENCE_DATE)
        raise RuntimeError("failure after internal commits")

    monkeypatch.setattr(demo_reset_service, "seed_demo", seed_then_fail)
    with pytest.raises(RuntimeError, match="failure after internal commits"):
        demo_reset_service.reset_demo_data(password=DEMO_TEST_PASSWORD)

    db.expire_all()
    remaining = list(
        db.scalars(select(Ledger).where(Ledger.owner_user_id == first.user_id))
    )
    assert [ledger.id for ledger in remaining] == [first.ledger_id]
    assert (
        db.scalar(
            select(func.count())
            .select_from(Obligation)
            .where(Obligation.ledger_id == first.ledger_id)
        )
        == 90
    )


@pytest.mark.parametrize(
    "reference_date",
    [date(2027, 1, 1), date(2028, 2, 29), date(2026, 12, 31), date(2026, 6, 1)],
)
def test_demo_history_is_coherent_across_calendar_boundaries(
    db: Session, reference_date: date
) -> None:
    result = seed_demo(
        session=db, password=DEMO_TEST_PASSWORD, reference_date=reference_date
    )
    cutoff = datetime.combine(reference_date, time(), tzinfo=UTC)
    obligations = list(
        db.scalars(select(Obligation).where(Obligation.ledger_id == result.ledger_id))
    )
    current_month = reference_date.year * 12 + reference_date.month
    by_month: dict[int, list[Obligation]] = {}
    for obligation in obligations:
        month = obligation.period_year * 12 + obligation.period_month
        by_month.setdefault(month, []).append(obligation)
        assert obligation.created_at < cutoff
        assert obligation.updated_at < cutoff
        assert obligation.issue_date is None or obligation.issue_date < reference_date
        assert (
            obligation.last_auto_sync_at is None
            or obligation.last_auto_sync_at < cutoff
        )
        if obligation.lifecycle is ObligationLifecycle.PAID:
            assert obligation.paid_at is not None and obligation.paid_at < cutoff
            assert obligation.issue_date is not None
            assert obligation.due_date is not None
            assert (
                obligation.issue_date
                <= obligation.paid_at.date()
                <= obligation.due_date
            )
        else:
            assert obligation.paid_at is None
        if obligation.components:
            assert (
                sum(
                    (
                        component.amount
                        for component in obligation.components
                        if component.amount is not None
                    ),
                    Decimal("0.00"),
                )
                == obligation.current_amount
            )
        for action in obligation.action_logs:
            assert obligation.created_at <= action.created_at <= obligation.updated_at
            if action.action == "marked_paid":
                assert obligation.paid_at is not None
                assert action.changes["paid_at"] == {
                    "from": None,
                    "to": obligation.paid_at.isoformat(),
                }

    assert sorted(by_month) == list(range(current_month - 4, current_month + 2))
    assert all(len(items) == 15 for items in by_month.values())
    for month in range(current_month - 4, current_month - 1):
        assert all(
            item.lifecycle is ObligationLifecycle.PAID for item in by_month[month]
        )
    previous_unpaid = [
        item
        for item in by_month[current_month - 1]
        if item.lifecycle is not ObligationLifecycle.PAID
    ]
    assert len(previous_unpaid) == 1
    assert previous_unpaid[0].category.code == "WATR"
    for obligation in by_month[current_month + 1]:
        assert obligation.lifecycle in {
            ObligationLifecycle.DRAFT,
            ObligationLifecycle.COLLECTING_DATA,
        }
        assert obligation.amount_state is ValueState.ESTIMATED
        assert obligation.current_amount is not None
        assert obligation.amount_source in {
            CurrentValueSource.AUTOMATIC,
            CurrentValueSource.MANUAL,
        }
        assert obligation.issue_date is None
        assert obligation.last_auto_sync_at is None
        assert not obligation.components

    current = by_month[current_month]
    assert any(
        item.lifecycle is ObligationLifecycle.ERROR and item.notes for item in current
    )
    assert any(
        item.lifecycle is ObligationLifecycle.COLLECTING_DATA
        and item.amount_state is ValueState.ESTIMATED
        and item.notes
        for item in current
    )
    integrations = list(
        db.scalars(select(Integration).where(Integration.ledger_id == result.ledger_id))
    )
    assert all(
        item.name.startswith("Demo:") and not item.credentials for item in integrations
    )
    assert {item.last_changes_detected for item in integrations} == {True, False, None}
    for day_time in (time.min, time.max):
        now = datetime.combine(
            reference_date, day_time, tzinfo=ZoneInfo("Europe/Warsaw")
        )
        assert {integration_status(item, now)[2].value for item in integrations} == {
            "healthy",
            "error",
        }
    before_next_reset = datetime.combine(
        reference_date + timedelta(days=1), time(3), tzinfo=UTC
    ) - timedelta(microseconds=1)
    assert {
        integration_status(item, before_next_reset)[2].value for item in integrations
    } == {
        "healthy",
        "error",
    }
    runs = {
        run.id: run
        for run in db.scalars(
            select(IntegrationRun).where(
                IntegrationRun.integration_id.in_([item.id for item in integrations])
            )
        )
    }
    assert all(
        run.finished_at is not None and run.finished_at < cutoff
        for run in runs.values()
    )
    for obligation in obligations:
        for action in obligation.action_logs:
            if action.run_id is not None:
                assert action.run_id in runs
                assert runs[action.run_id].integration_id == action.integration_id
    records = list(
        db.scalars(
            select(CategoryDataRecord)
            .join(Category)
            .where(Category.ledger_id == result.ledger_id)
        )
    )
    assert len(records) == 25
    assert all(record.observed_at < cutoff for record in records)
    electricity = sorted(
        [
            record
            for record in records
            if record.category_id
            == next(
                item.category_id for item in current if item.category.code == "ELEC"
            )
        ],
        key=lambda item: item.observed_at,
    )
    for previous, following in zip(electricity, electricity[1:], strict=False):
        assert Decimal(str(following.data["meter_reading_kwh"])) - Decimal(
            str(previous.data["meter_reading_kwh"])
        ) == Decimal(str(following.data["consumption_kwh"]))


def test_reseed_restores_same_business_dataset(db: Session) -> None:
    def snapshot() -> list[tuple[object, ...]]:
        return sorted(
            (
                item.category.code,
                item.period_year,
                item.period_month,
                item.lifecycle.value,
                item.current_amount,
                item.amount_state.value,
                item.due_date,
                item.issue_date,
                item.paid_at,
                item.last_auto_sync_at,
                item.notes,
                sorted((part.label, part.amount) for part in item.components),
            )
            for item in db.scalars(
                select(Obligation).join(Ledger).where(Ledger.name == DEMO_LEDGER_NAME)
            )
        )

    seed_demo(session=db, password=DEMO_TEST_PASSWORD, reference_date=REFERENCE_DATE)
    first = snapshot()
    seed_demo(session=db, password=DEMO_TEST_PASSWORD, reference_date=REFERENCE_DATE)
    assert snapshot() == first
