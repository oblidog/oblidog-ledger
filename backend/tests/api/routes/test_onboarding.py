"""First-time-user journeys through the public API, with a real PostgreSQL DB."""

import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.domain import (
    BillingPeriod,
    Currency,
    DataSourcePolicy,
    LedgerAccessRole,
    RecurrenceUnit,
)
from app.models import (
    Category,
    CategoryGroup,
    Integration,
    Ledger,
    Obligation,
    ObligationActionLog,
    User,
)
from app.use_cases import categories, ledgers, obligations
from tests.conftest import TestingSessionLocal
from tests.utils.user import authentication_token_from_email, create_random_user

URL = f"{settings.API_V1_STR}/onboarding/"


@pytest.fixture
def visitor(client: TestClient, db: Session) -> tuple[User, dict[str, str]]:
    user = create_random_user(db)
    return user, authentication_token_from_email(client=client, email=user.email, db=db)


def advance(
    client: TestClient, headers: dict[str, str], revision: int, action: str, **data: Any
) -> dict[str, Any]:
    response = client.post(
        URL, headers=headers, json={"revision": revision, "action": action, **data}
    )
    assert response.status_code == 200, response.text
    return dict(response.json())


def draft(
    client: TestClient,
    headers: dict[str, str],
    *,
    code: str | None = None,
    first_due_date: str = "2026-11-01",
) -> dict[str, Any]:
    state = advance(
        client,
        headers,
        0,
        "ledger",
        ledger={
            "name": "Home",
            "default_currency": "EUR",
            "business_calendar_country": "PL",
        },
    )
    advance(
        client,
        headers,
        1,
        "category",
        category={
            "name": "Internet",
            "group_name": "Bills",
            "currency": "EUR",
            "code": code,
        },
    )
    # All Saints' Day on Sunday: effective date crosses the billing boundary.
    state = advance(
        client,
        headers,
        2,
        "schedule",
        schedule={
            "first_due_date": first_due_date,
            "recurrence_interval": 1,
            "recurrence_unit": "month",
        },
    )
    return state


@pytest.mark.parametrize(
    "ready,amount", [(False, None), (False, "42.50"), (True, "0"), (True, "42.50")]
)
def test_first_payment_without_integration(
    client: TestClient,
    db: Session,
    visitor: tuple[User, dict[str, str]],
    ready: bool,
    amount: str | None,
) -> None:
    user, headers = visitor
    assert client.get(URL, headers=headers).json()["step"] == 0
    state = draft(client, headers)
    ledger_id = uuid.UUID(state["ledger_id"])
    assert client.get(f"{URL}eligibility/{ledger_id}", headers=headers).json() is True
    assert (
        db.scalar(
            select(func.count())
            .select_from(Category)
            .where(Category.ledger_id == ledger_id)
        )
        == 0
    )
    assert (
        db.scalar(
            select(func.count())
            .select_from(CategoryGroup)
            .where(CategoryGroup.ledger_id == ledger_id)
        )
        == 0
    )
    payment_data = {
        "ready": ready,
        "amount": amount,
        "confirmed_due_date": "2026-10-30" if ready else None,
    }
    state = advance(client, headers, 3, "payment", **payment_data)
    assert state["step"] == 4
    assert client.get(f"{URL}eligibility/{ledger_id}", headers=headers).json() is False
    assert state["obligation_key"] == "INTE-2026-11"
    category = db.scalars(select(Category).where(Category.ledger_id == ledger_id)).one()
    assert category.data_source_policy == DataSourcePolicy.HYBRID
    assert category.recurrence_interval == 1
    payment = db.scalars(
        select(Obligation).where(Obligation.ledger_id == ledger_id)
    ).one()
    assert payment.due_date == date(2026, 10, 30)
    assert str(payment.lifecycle) == ("ready" if ready else "collecting_data")
    assert str(payment.amount_state) == (
        "confirmed" if ready else "unknown" if amount is None else "estimated"
    )
    assert payment.currency == "EUR"
    assert (
        db.scalar(
            select(func.count())
            .select_from(Integration)
            .where(Integration.ledger_id == ledger_id)
        )
        == 0
    )
    log = db.scalars(
        select(ObligationActionLog).where(
            ObligationActionLog.obligation_id == payment.id
        )
    ).first()
    assert log is not None and log.actor_id == user.id
    # The normal generator reuses the first period and creates the next one.
    obligations.ensure_obligations_for_period(
        session=db, ledger_id=ledger_id, period=BillingPeriod(2026, 11)
    )
    assert (
        db.scalar(
            select(func.count())
            .select_from(Obligation)
            .where(Obligation.ledger_id == ledger_id)
        )
        == 2
    )
    replay = client.post(
        URL,
        headers=headers,
        json={"action": "payment", "revision": 3, **payment_data},
    )
    assert replay.status_code == 409
    assert replay.json()["code"] == "onboarding_changed"


@pytest.mark.parametrize("change_after_step", [1, 2])
def test_resumed_steps_keep_the_current_ledger_calendar(
    client: TestClient,
    db: Session,
    visitor: tuple[User, dict[str, str]],
    change_after_step: int,
) -> None:
    _, headers = visitor
    state = advance(
        client,
        headers,
        0,
        "ledger",
        ledger={"name": "Home", "business_calendar_country": "PL"},
    )
    ledger_id = uuid.UUID(state["ledger_id"])
    category = {"name": "Internet", "group_name": "Bills"}
    if change_after_step == 2:
        advance(client, headers, 1, "category", category=category)

    ledgers.update_ledger(
        session=db, ledger_id=ledger_id, name="Home", business_calendar_country="DE"
    )
    assert client.get(URL, headers=headers).json()["business_calendar_country"] == "DE"

    if change_after_step == 1:
        state = advance(client, headers, 1, "category", category=category)
        assert state["business_calendar_country"] == "DE"
    state = advance(
        client, headers, 2, "schedule", schedule={"first_due_date": "2027-01-06"}
    )
    assert state["business_calendar_country"] == "DE"


def test_calendar_change_requires_confirming_the_new_due_date(
    client: TestClient, db: Session, visitor: tuple[User, dict[str, str]]
) -> None:
    _, headers = visitor
    state = draft(client, headers, first_due_date="2027-01-06")
    ledger_id = uuid.UUID(state["ledger_id"])
    ledgers.update_ledger(
        session=db, ledger_id=ledger_id, name="Home", business_calendar_country="DE"
    )
    response = client.post(
        URL,
        headers=headers,
        json={
            "revision": 3,
            "action": "payment",
            "ready": True,
            "amount": "42.50",
            "confirmed_due_date": "2027-01-05",
        },
    )
    assert response.status_code == 409
    assert response.json()["code"] == "onboarding_due_date_changed"
    for model in (CategoryGroup, Category, Obligation):
        assert db.scalar(select(model.id).where(model.ledger_id == ledger_id)) is None

    refreshed = client.get(URL, headers=headers).json()
    assert refreshed["business_calendar_country"] == "DE"
    assert refreshed["step"] == 3
    state = advance(
        client,
        headers,
        refreshed["revision"],
        "payment",
        ready=True,
        amount="42.50",
        confirmed_due_date="2027-01-06",
    )
    assert state["step"] == 4
    payment = db.scalars(
        select(Obligation).where(Obligation.ledger_id == ledger_id)
    ).one()
    assert payment.due_date == date(2027, 1, 6)
    assert str(payment.lifecycle) == "ready"


def test_pause_reload_back_and_reuse_workspace(
    client: TestClient, db: Session, visitor: tuple[User, dict[str, str]]
) -> None:
    _, headers = visitor
    state = draft(client, headers)
    ledger_id = state["ledger_id"]
    state = advance(client, headers, 3, "dismiss")
    assert state["dismissed"]
    assert client.get(URL, headers=headers).json() == state
    state = advance(client, headers, 4, "resume")
    assert state["step"] == 3 and not state["dismissed"]
    assert state["category"]["name"] == "Internet"
    advance(client, headers, 5, "restart")
    state = advance(client, headers, 6, "ledger", ledger={"name": "Home"})
    assert state["ledger_id"] == ledger_id
    assert (
        db.scalar(
            select(func.count())
            .select_from(Ledger)
            .where(Ledger.id == uuid.UUID(ledger_id))
        )
        == 1
    )
    assert (
        client.post(
            URL,
            headers=headers,
            json={"action": "ledger", "revision": 6, "ledger": {"name": "Duplicate"}},
        ).status_code
        == 409
    )
    advance(
        client,
        headers,
        7,
        "category",
        category={"name": "Electricity", "group_name": "Bills"},
    )
    state = advance(client, headers, 8, "back")
    assert state["step"] == 1 and state["category"]["name"] == "Electricity"


def test_conflicting_code_rolls_back_whole_final_step(
    client: TestClient, db: Session, visitor: tuple[User, dict[str, str]]
) -> None:
    _, headers = visitor
    state = draft(client, headers, code="USED")
    ledger_id = uuid.UUID(state["ledger_id"])
    group = categories.create_category_group(
        session=db, ledger_id=ledger_id, name="Existing"
    )
    categories.create_category(
        session=db,
        ledger_id=ledger_id,
        category_group_id=group.id,
        name="Existing",
        code="USED",
    )
    response = client.post(
        URL, headers=headers, json={"action": "payment", "revision": 3}
    )
    assert response.status_code == 409
    assert response.json()["code"] == "onboarding_name_in_use"
    assert client.get(URL, headers=headers).json()["step"] == 3
    assert (
        db.scalar(
            select(func.count())
            .select_from(CategoryGroup)
            .where(CategoryGroup.ledger_id == ledger_id)
        )
        == 1
    )
    assert (
        db.scalar(
            select(func.count())
            .select_from(Obligation)
            .where(Obligation.ledger_id == ledger_id)
        )
        == 0
    )
    # Back to category, clear the colliding code, then finish without duplicates.
    advance(client, headers, 3, "back")
    advance(client, headers, 4, "back")
    advance(
        client,
        headers,
        5,
        "category",
        category={"name": "Internet", "group_name": "Bills"},
    )
    advance(client, headers, 6, "schedule", schedule={"first_due_date": "2026-12-10"})
    advance(client, headers, 7, "payment")
    assert (
        db.scalar(
            select(func.count())
            .select_from(CategoryGroup)
            .where(CategoryGroup.ledger_id == ledger_id)
        )
        == 2
    )


def test_generated_code_and_existing_group_are_reused_safely(
    client: TestClient, db: Session, visitor: tuple[User, dict[str, str]]
) -> None:
    user, headers = visitor
    ledger = ledgers.create_ledger(
        session=db,
        owner_user_id=user.id,
        name="Existing",
        default_currency=Currency.PLN,
    )
    group = categories.create_category_group(
        session=db, ledger_id=ledger.id, name="Bills"
    )
    categories.create_category(
        session=db,
        ledger_id=ledger.id,
        category_group_id=group.id,
        name="Other",
        code="INTE",
    )
    advance(client, headers, 0, "ledger", ledger_id=str(ledger.id))
    advance(
        client,
        headers,
        1,
        "category",
        category={"name": "Internet", "group_id": str(group.id)},
    )
    advance(
        client,
        headers,
        2,
        "schedule",
        schedule={"first_due_date": "2027-01-15", "recurrence_unit": "year"},
    )
    state = advance(client, headers, 3, "payment")
    assert state["category"]["code"] != "INTE"
    assert len(state["category"]["code"]) == 4
    assert (
        db.scalar(
            select(func.count())
            .select_from(CategoryGroup)
            .where(CategoryGroup.ledger_id == ledger.id)
        )
        == 1
    )


@pytest.mark.parametrize(
    "role", [None, LedgerAccessRole.VIEWER, LedgerAccessRole.EDITOR]
)
def test_cannot_set_up_someone_elses_ledger(
    client: TestClient,
    db: Session,
    visitor: tuple[User, dict[str, str]],
    role: LedgerAccessRole | None,
) -> None:
    user, headers = visitor
    other = create_random_user(db)
    ledger = ledgers.create_ledger(session=db, owner_user_id=other.id, name="Private")
    if role:
        ledgers.share_ledger(
            session=db, ledger_id=ledger.id, target_user_id=user.id, role=role
        )
    response = client.post(
        URL,
        headers=headers,
        json={"action": "ledger", "revision": 0, "ledger_id": str(ledger.id)},
    )
    assert response.status_code == 404
    assert client.get(URL, headers=headers).json()["revision"] == 0


def test_cross_ledger_group_rejected_and_ownership_rechecked(
    client: TestClient, db: Session, visitor: tuple[User, dict[str, str]]
) -> None:
    user, headers = visitor
    ledger = ledgers.create_ledger(session=db, owner_user_id=user.id, name="Other")
    group = categories.create_category_group(
        session=db, ledger_id=ledger.id, name="Other"
    )
    advance(client, headers, 0, "ledger", ledger={"name": "Home"})
    response = client.post(
        URL,
        headers=headers,
        json={
            "action": "category",
            "revision": 1,
            "category": {"name": "Internet", "group_id": str(group.id)},
        },
    )
    assert response.status_code == 404
    advance(
        client,
        headers,
        1,
        "category",
        category={"name": "Internet", "group_name": "Bills"},
    )
    state = advance(
        client, headers, 2, "schedule", schedule={"first_due_date": "2026-12-10"}
    )
    target = db.get(Ledger, uuid.UUID(state["ledger_id"]))
    assert target is not None
    target.is_active = False
    db.commit()
    assert (
        client.post(
            URL, headers=headers, json={"action": "payment", "revision": 3}
        ).status_code
        == 404
    )


@pytest.mark.parametrize("writes", [True, False])
def test_demo_never_persists_shared_onboarding(
    client: TestClient,
    db: Session,
    visitor: tuple[User, dict[str, str]],
    monkeypatch: pytest.MonkeyPatch,
    writes: bool,
) -> None:
    user, headers = visitor
    monkeypatch.setattr(settings, "ENVIRONMENT", "demo")
    monkeypatch.setattr(settings, "DEMO_WRITES_ENABLED", writes)
    response = client.post(
        URL,
        headers=headers,
        json={"action": "ledger", "revision": 0, "ledger": {"name": "Demo pollution"}},
    )
    assert response.status_code == 403
    db.refresh(user)
    assert user.onboarding_state is None


@pytest.mark.parametrize(
    "command",
    [
        {"action": "ledger", "ledger": {"name": "   "}},
        {"action": "ledger", "ledger": {"name": "A"}, "ledger_id": str(uuid.uuid4())},
        {"action": "category", "category": {"name": "Internet", "group_name": " "}},
        {"action": "schedule", "schedule": {"first_due_date": "0001-01-01"}},
        {
            "action": "schedule",
            "schedule": {"first_due_date": "2026-12-01", "recurrence_interval": 0},
        },
        {"action": "payment", "ready": True},
        {"action": "payment", "ready": True, "amount": "42.50"},
        {"action": "payment", "amount": "-1"},
        {"action": "payment", "amount": "1.001"},
    ],
)
def test_invalid_commands_do_not_advance(
    client: TestClient, visitor: tuple[User, dict[str, str]], command: dict[str, Any]
) -> None:
    _, headers = visitor
    response = client.post(URL, headers=headers, json={"revision": 0, **command})
    assert response.status_code == 422
    assert client.get(URL, headers=headers).json()["revision"] == 0


def test_two_tabs_cannot_create_two_workspaces(
    db: Session, visitor: tuple[User, dict[str, str]]
) -> None:
    user, _ = visitor
    from app.core.api_errors import ApplicationError
    from app.schemas.ledgers import LedgerCreate
    from app.schemas.onboarding import ChooseLedger
    from app.use_cases.onboarding import advance as advance_use_case

    def run(name: str) -> int:
        with TestingSessionLocal() as session:
            try:
                advance_use_case(
                    session=session,
                    user_id=user.id,
                    command=ChooseLedger(
                        action="ledger", revision=0, ledger=LedgerCreate(name=name)
                    ),
                )
                return 200
            except ApplicationError as error:
                return error.status_code

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(run, ["Tab one", "Tab two"]))
    assert sorted(results) == [200, 409]
    assert (
        db.scalar(
            select(func.count())
            .select_from(Ledger)
            .where(Ledger.owner_user_id == user.id)
        )
        == 1
    )


@pytest.mark.parametrize(
    "country,expected", [("PL", "2026-01-05"), ("US", "2026-01-06")]
)
def test_preview_of_unsaved_workspace_is_read_only_in_demo(
    client: TestClient,
    db: Session,
    visitor: tuple[User, dict[str, str]],
    monkeypatch: pytest.MonkeyPatch,
    country: str,
    expected: str,
) -> None:
    user, headers = visitor
    monkeypatch.setattr(settings, "ENVIRONMENT", "demo")
    monkeypatch.setattr(settings, "DEMO_WRITES_ENABLED", False)
    response = client.post(
        f"{URL}schedule-preview",
        headers=headers,
        json={
            "first_due_date": "2026-01-06",
            "business_calendar_country": country,
        },
    )
    assert response.status_code == 200, response.text
    assert response.json()["due_date"] == expected
    assert response.json()["scheduled_date"] == "2026-01-06"
    assert response.json()["calendar_country"] == country
    db.refresh(user)
    assert user.onboarding_state is None
    assert (
        db.scalar(
            select(func.count())
            .select_from(Ledger)
            .where(Ledger.owner_user_id == user.id)
        )
        == 0
    )


def test_dashboard_setup_uses_published_recurring_payments(
    client: TestClient,
    db: Session,
    visitor: tuple[User, dict[str, str]],
) -> None:
    owner, headers = visitor
    old_draft = draft(client, headers)
    ledger_id = uuid.UUID(old_draft["ledger_id"])
    url = f"{URL}dashboard/{ledger_id}"
    empty = {"completed": False, "payment": None}
    assert client.get(url, headers=headers).json() == empty

    group = categories.create_category_group(
        session=db, ledger_id=ledger_id, name="Existing bills"
    )
    categories.create_category(
        session=db,
        ledger_id=ledger_id,
        category_group_id=group.id,
        name="One-off payment",
        code="ONCE",
        data_source_policy=DataSourcePolicy.MANUAL,
    )
    obligations.create_manual_obligation(
        session=db,
        ledger_id=ledger_id,
        category_code="ONCE",
        period=BillingPeriod(2026, 11),
    )
    assert client.get(url, headers=headers).json() == empty

    for name, code, policy in (
        ("Automatic bill", "AUTO", DataSourcePolicy.AUTOMATIC),
        ("Internet", "INET", DataSourcePolicy.HYBRID),
    ):
        categories.create_category(
            session=db,
            ledger_id=ledger_id,
            category_group_id=group.id,
            name=name,
            code=code,
            data_source_policy=policy,
            recurrence_interval=1,
            recurrence_unit=RecurrenceUnit.MONTH,
            first_due_date=date(2026, 11, 1),
        )
    obligations.create_manual_obligation(
        session=db,
        ledger_id=ledger_id,
        category_code="INET",
        period=BillingPeriod(2026, 10),
    )
    expected = {
        "completed": False,
        "payment": {
            "category_code": "INET",
            "period": {"year": 2026, "month": 11},
            "automatic": False,
        },
    }
    assert client.get(url, headers=headers).json() == expected

    collaborator = create_random_user(db)
    collaborator_headers = authentication_token_from_email(
        client=client, email=collaborator.email, db=db
    )
    assert client.get(url, headers=collaborator_headers).status_code == 404
    ledgers.share_ledger(
        session=db,
        ledger_id=ledger_id,
        target_user_id=collaborator.id,
        role=LedgerAccessRole.VIEWER,
    )
    assert client.get(url, headers=collaborator_headers).status_code == 404
    ledgers.share_ledger(
        session=db,
        ledger_id=ledger_id,
        target_user_id=collaborator.id,
        role=LedgerAccessRole.EDITOR,
    )
    assert client.get(url, headers=collaborator_headers).json() == expected

    obligations.ensure_obligations_for_period(
        session=db,
        ledger_id=ledger_id,
        period=BillingPeriod(2026, 12),
    )
    assert client.get(url, headers=headers).json() == {
        "completed": True,
        "payment": None,
    }
    assert client.get(URL, headers=headers).json() == old_draft

    other = ledgers.create_ledger(
        session=db, owner_user_id=owner.id, name="Other ledger"
    )
    assert client.get(f"{URL}dashboard/{other.id}", headers=headers).json() == empty


@pytest.mark.parametrize(
    ("unit", "interval", "next_period"),
    [
        (RecurrenceUnit.MONTH, 2, BillingPeriod(2027, 1)),
        (RecurrenceUnit.YEAR, 1, BillingPeriod(2027, 11)),
    ],
)
def test_dashboard_requires_payment_in_scheduled_period(
    client: TestClient,
    db: Session,
    visitor: tuple[User, dict[str, str]],
    unit: RecurrenceUnit,
    interval: int,
    next_period: BillingPeriod,
) -> None:
    owner, headers = visitor
    ledger = ledgers.create_ledger(session=db, owner_user_id=owner.id, name="Home")
    group = categories.create_category_group(
        session=db, ledger_id=ledger.id, name="Bills"
    )
    categories.create_category(
        session=db,
        ledger_id=ledger.id,
        category_group_id=group.id,
        name="Internet",
        code="INET",
        data_source_policy=DataSourcePolicy.HYBRID,
        recurrence_interval=interval,
        recurrence_unit=unit,
        first_due_date=date(2026, 11, 1),
    )
    obligations.create_manual_obligation(
        session=db,
        ledger_id=ledger.id,
        category_code="INET",
        period=BillingPeriod(2026, 12),
    )
    url = f"{URL}dashboard/{ledger.id}"
    pending = client.get(url, headers=headers)
    assert pending.status_code == 200
    assert pending.json() == {
        "completed": False,
        "payment": {
            "category_code": "INET",
            "period": {"year": 2026, "month": 11},
            "automatic": False,
        },
    }
    obligations.create_manual_obligation(
        session=db,
        ledger_id=ledger.id,
        category_code="INET",
        period=next_period,
    )
    assert client.get(url, headers=headers).json() == {
        "completed": True,
        "payment": None,
    }
