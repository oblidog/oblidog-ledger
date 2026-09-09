import uuid

from fastapi.testclient import TestClient
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import settings
from app.domain import BillingPeriod, DataSourcePolicy
from app.models import Category, Counterparty, Ledger
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


def _create_category(db: Session, *, owner_id: uuid.UUID) -> tuple[Ledger, Category]:
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


def test_counterparty_patch_preserves_omitted_metadata(
    client: TestClient,
    superuser_token_headers: dict[str, str],
) -> None:
    original_name = f"Original {random_lower_string()}"
    counterparty = _create_counterparty(
        client,
        superuser_token_headers,
        name=original_name,
    )
    new_name = f"Renamed {random_lower_string()}"

    response = client.patch(
        f"{settings.API_V1_STR}/counterparties/{counterparty['id']}",
        headers=superuser_token_headers,
        json={"name": new_name},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["name"] == new_name
    assert payload["short_name"] == original_name
    assert payload["logo_url"] == counterparty["logo_url"]
    assert payload["website_url"] == counterparty["website_url"]


def test_counterparty_patch_can_update_and_clear_logo(
    client: TestClient,
    superuser_token_headers: dict[str, str],
) -> None:
    counterparty = _create_counterparty(
        client,
        superuser_token_headers,
        name=f"Logo {random_lower_string()}",
    )
    new_logo = "https://example.com/new-logo.svg"

    updated = client.patch(
        f"{settings.API_V1_STR}/counterparties/{counterparty['id']}",
        headers=superuser_token_headers,
        json={"logo_url": new_logo},
    )
    assert updated.status_code == 200
    assert updated.json()["logo_url"] == new_logo

    cleared = client.patch(
        f"{settings.API_V1_STR}/counterparties/{counterparty['id']}",
        headers=superuser_token_headers,
        json={"logo_url": None},
    )
    assert cleared.status_code == 200
    assert cleared.json()["logo_url"] is None


def test_counterparty_patch_rejects_null_name(
    client: TestClient,
    superuser_token_headers: dict[str, str],
) -> None:
    counterparty = _create_counterparty(
        client,
        superuser_token_headers,
        name=f"Named {random_lower_string()}",
    )

    response = client.patch(
        f"{settings.API_V1_STR}/counterparties/{counterparty['id']}",
        headers=superuser_token_headers,
        json={"name": None},
    )

    assert response.status_code == 422


def test_counterparty_names_are_case_insensitively_unique_in_database(
    db: Session,
) -> None:
    suffix = random_lower_string()
    first = Counterparty(name=f"Enea {suffix}")
    db.add(first)
    db.commit()

    db.add(Counterparty(name=f"ENEA {suffix}"))
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        constraint_name = getattr(getattr(exc.orig, "diag", None), "constraint_name", None)
        assert constraint_name == "uq_counterparty_name_lower"
    else:
        raise AssertionError("case-insensitive duplicate counterparty name was accepted")


def test_counterparty_api_returns_conflict_for_case_insensitive_duplicate(
    client: TestClient,
    superuser_token_headers: dict[str, str],
) -> None:
    suffix = random_lower_string()
    _create_counterparty(
        client,
        superuser_token_headers,
        name=f"Enea {suffix}",
    )

    response = client.post(
        f"{settings.API_V1_STR}/counterparties",
        headers=superuser_token_headers,
        json={"name": f"ENEA {suffix}"},
    )

    assert response.status_code == 409


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
