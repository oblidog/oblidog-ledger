import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.config import settings
from app.domain import Currency, LedgerAccessRole
from app.use_cases import categories as category_use_cases
from app.use_cases import ledgers as ledger_use_cases
from tests.utils.user import authentication_token_from_email, create_random_user
from tests.utils.utils import random_lower_string


def test_create_ledger_uses_bootstrap_country_and_exposes_options(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "BUSINESS_CALENDAR_COUNTRY", "DE")
    owner = create_random_user(db)
    headers = authentication_token_from_email(client=client, email=owner.email, db=db)
    response = client.post(
        f"{settings.API_V1_STR}/ledgers/",
        headers=headers,
        json={"name": random_lower_string()},
    )
    assert response.status_code == 200
    assert response.json()["business_calendar_country"] == "DE"
    assert response.json()["default_currency"] == "PLN"
    options = client.get(
        f"{settings.API_V1_STR}/ledgers/preference-options", headers=headers
    )
    assert options.status_code == 200
    assert {"PL", "DE"} <= set(options.json()["countries"])
    assert options.json()["default_business_calendar_country"] == "DE"
    assert options.json()["currencies"] == ["PLN", "EUR", "USD", "GBP", "CHF"]


def test_preferences_drive_new_categories_and_leave_existing_currency_unchanged(
    client: TestClient, db: Session
) -> None:
    owner = create_random_user(db)
    headers = authentication_token_from_email(client=client, email=owner.email, db=db)
    response = client.post(
        f"{settings.API_V1_STR}/ledgers/",
        headers=headers,
        json={
            "name": random_lower_string(),
            "business_calendar_country": "de",
            "default_currency": "EUR",
        },
    )
    assert response.status_code == 200
    assert response.json()["business_calendar_country"] == "DE"
    ledger_id = uuid.UUID(response.json()["id"])
    group = category_use_cases.create_category_group(
        session=db, ledger_id=ledger_id, name=random_lower_string()
    )
    categories_url = f"{settings.API_V1_STR}/ledgers/{ledger_id}/categories"
    category_response = client.post(
        categories_url,
        headers=headers,
        json={
            "category_group_id": str(group.id),
            "name": random_lower_string(),
            "code": "TEST",
        },
    )
    assert category_response.status_code == 200
    assert category_response.json()["currency"] == "EUR"
    category_id = category_response.json()["id"]
    explicit = client.post(
        categories_url,
        headers=headers,
        json={
            "category_group_id": str(group.id),
            "name": random_lower_string(),
            "code": "EXPL",
            "currency": "CHF",
        },
    )
    assert explicit.status_code == 200
    assert explicit.json()["currency"] == "CHF"
    updated = client.patch(
        f"{settings.API_V1_STR}/ledgers/{ledger_id}",
        headers=headers,
        json={
            "name": response.json()["name"],
            "business_calendar_country": "PL",
            "default_currency": "USD",
        },
    )
    assert updated.status_code == 200
    old_category = client.patch(
        f"{categories_url}/{category_id}",
        headers=headers,
        json={"name": category_response.json()["name"], "data_source_policy": "manual"},
    )
    assert old_category.status_code == 200
    assert old_category.json()["currency"] == "EUR"
    newer = category_use_cases.create_category(
        session=db,
        ledger_id=ledger_id,
        category_group_id=group.id,
        name=random_lower_string(),
        code="NEXT",
    )
    assert newer.currency == "USD"
    renamed = client.patch(
        f"{settings.API_V1_STR}/ledgers/{ledger_id}",
        headers=headers,
        json={"name": random_lower_string()},
    )
    assert renamed.status_code == 200
    assert renamed.json()["default_currency"] == "USD"
    assert renamed.json()["business_calendar_country"] == "PL"


@pytest.mark.parametrize("role", [LedgerAccessRole.VIEWER, LedgerAccessRole.EDITOR])
def test_only_owner_can_update_preferences(
    client: TestClient, db: Session, role: LedgerAccessRole
) -> None:
    owner, member = create_random_user(db), create_random_user(db)
    ledger = ledger_use_cases.create_ledger(
        session=db, owner_user_id=owner.id, name=random_lower_string()
    )
    ledger_use_cases.share_ledger(
        session=db, ledger_id=ledger.id, target_user_id=member.id, role=role
    )
    headers = authentication_token_from_email(client=client, email=member.email, db=db)
    response = client.patch(
        f"{settings.API_V1_STR}/ledgers/{ledger.id}",
        headers=headers,
        json={
            "name": ledger.name,
            "business_calendar_country": "DE",
            "default_currency": "EUR",
        },
    )
    assert response.status_code == 404
    db.refresh(ledger)
    assert ledger.business_calendar_country == "PL"
    assert ledger.default_currency == Currency.PLN


@pytest.mark.parametrize(
    "preferences", [{"business_calendar_country": "XX"}, {"default_currency": "XYZ"}]
)
def test_invalid_preferences_are_rejected(
    client: TestClient, db: Session, preferences: dict[str, str]
) -> None:
    owner = create_random_user(db)
    headers = authentication_token_from_email(client=client, email=owner.email, db=db)
    response = client.post(
        f"{settings.API_V1_STR}/ledgers/",
        headers=headers,
        json={"name": random_lower_string(), **preferences},
    )
    assert response.status_code == 422
