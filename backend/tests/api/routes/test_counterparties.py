from datetime import date

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.config import settings
from app.domain import BillingPeriod, DataSourcePolicy
from app.services import obligations as obligation_service
from app.use_cases import categories as category_use_cases
from app.use_cases import ledgers as ledger_use_cases
from tests.utils.user import authentication_token_from_email, create_random_user
from tests.utils.utils import random_lower_string


def _create_counterparty(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    *,
    name: str,
) -> dict[str, object]:
    response = client.post(
        f"{settings.API_V1_STR}/counterparties",
        headers=superuser_token_headers,
        json={
            "name": name,
            "short_name": name,
            "logo_url": f"https://example.com/{name}.svg",
            "website_url": "https://example.com",
        },
    )
    assert response.status_code == 200
    return response.json()


def _create_category(db: Session, *, owner_id: object) -> tuple[object, object]:
    ledger = ledger_use_cases.create_ledger(
        session=db,
        owner_user_id=owner_id,
        name=f"ledger-{random_lower_string()}",
    )
    group = category_use_cases.create_category_group(
        session=db,
        ledger_id=ledger.id,
        name=f"group-{random_lower_string()}",
    )
    category = category_use_cases.create_category(
        session=db,
        ledger_id=ledger.id,
        category_group_id=group.id,
        name=f"category-{random_lower_string()}",
        code="CPAA",
        data_source_policy=DataSourcePolicy.HYBRID,
    )
    return ledger, category


def test_counterparty_search_is_available_to_authenticated_users(
    client: TestClient,
    db: Session,
    superuser_token_headers: dict[str, str],
) -> None:
    suffix = random_lower_string()
    counterparty = _create_counterparty(
        client,
        superuser_token_headers,
        name=f"Enea {suffix}",
    )
    user = create_random_user(db)
    headers = authentication_token_from_email(client=client, email=user.email, db=db)

    response = client.get(
        f"{settings.API_V1_STR}/counterparties/search",
        headers=headers,
        params={"q": suffix, "limit": 10},
    )

    assert response.status_code == 200
    payload = response.json()
    assert [item["id"] for item in payload["items"]] == [counterparty["id"]]
    assert payload["items"][0]["logo_url"] == counterparty["logo_url"]


def test_non_superuser_cannot_create_global_counterparty(
    client: TestClient,
    db: Session,
) -> None:
    user = create_random_user(db)
    headers = authentication_token_from_email(client=client, email=user.email, db=db)

    response = client.post(
        f"{settings.API_V1_STR}/counterparties",
        headers=headers,
        json={"name": f"Counterparty {random_lower_string()}"},
    )

    assert response.status_code == 403


def test_category_counterparty_is_copied_only_when_obligation_is_created(
    client: TestClient,
    db: Session,
    superuser_token_headers: dict[str, str],
) -> None:
    owner = create_random_user(db)
    headers = authentication_token_from_email(client=client, email=owner.email, db=db)
    ledger, category = _create_category(db, owner_id=owner.id)
    first = _create_counterparty(
        client,
        superuser_token_headers,
        name=f"First {random_lower_string()}",
    )
    second = _create_counterparty(
        client,
        superuser_token_headers,
        name=f"Second {random_lower_string()}",
    )

    assigned = client.patch(
        f"{settings.API_V1_STR}/ledgers/{ledger.id}/categories/{category.id}/counterparty",
        headers=headers,
        json={"counterparty_id": first["id"]},
    )
    assert assigned.status_code == 200
    assert assigned.json()["counterparty_id"] == first["id"]

    db.refresh(category)
    june, created = obligation_service.get_or_create_obligation(
        session=db,
        category=category,
        period=BillingPeriod(2026, 6),
    )
    assert created is True
    db.commit()
    assert str(june.counterparty_id) == first["id"]

    reassigned = client.patch(
        f"{settings.API_V1_STR}/ledgers/{ledger.id}/categories/{category.id}/counterparty",
        headers=headers,
        json={"counterparty_id": second["id"]},
    )
    assert reassigned.status_code == 200

    db.refresh(category)
    db.refresh(june)
    july, created = obligation_service.get_or_create_obligation(
        session=db,
        category=category,
        period=BillingPeriod(2026, 7),
    )
    assert created is True
    db.commit()

    assert str(june.counterparty_id) == first["id"]
    assert str(july.counterparty_id) == second["id"]

    response = client.get(
        f"{settings.API_V1_STR}/ledgers/{ledger.id}/obligations/{july.business_key}",
        headers=headers,
    )
    assert response.status_code == 200
    assert response.json()["counterparty"]["id"] == second["id"]
