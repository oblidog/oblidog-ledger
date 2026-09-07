from datetime import UTC, datetime, timedelta

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.config import settings
from app.use_cases import categories as category_use_cases
from tests.utils.ledger_domain import create_category_tree
from tests.utils.user import authentication_token_from_email


def _reading_schema() -> dict[str, object]:
    return {
        "type": "object",
        "properties": {"reading": {"type": "number"}},
        "required": ["reading"],
        "additionalProperties": False,
    }


def _status_schema() -> dict[str, object]:
    return {
        "type": "object",
        "properties": {"status": {"type": "string"}},
        "required": ["status"],
        "additionalProperties": False,
    }


def test_data_records_api_filters_by_schema_version_and_composes_filters(
    client: TestClient, db: Session
) -> None:
    ledger, _, category = create_category_tree(db)
    headers = authentication_token_from_email(
        client=client, email=ledger.owner.email, db=db
    )
    first_schema = category_use_cases.set_category_data_schema(
        session=db,
        ledger_id=ledger.id,
        category_id=category.id,
        schema=_reading_schema(),
    )
    start = datetime(2026, 1, 1, tzinfo=UTC)
    for day in range(4):
        category_use_cases.create_category_data_record(
            session=db,
            ledger_id=ledger.id,
            category_id=category.id,
            observed_at=start + timedelta(days=day),
            data={"reading": day},
        )

    second_schema = category_use_cases.set_category_data_schema(
        session=db,
        ledger_id=ledger.id,
        category_id=category.id,
        schema=_status_schema(),
    )
    category_use_cases.create_category_data_record(
        session=db,
        ledger_id=ledger.id,
        category_id=category.id,
        observed_at=start + timedelta(days=2),
        data={"status": "ok"},
    )

    base_url = (
        f"{settings.API_V1_STR}/ledgers/{ledger.id}/categories/{category.id}/data-records"
    )
    response = client.get(
        base_url,
        params={
            "schema_version": first_schema.version,
            "observed_from": (start + timedelta(days=1)).isoformat(),
            "observed_to": (start + timedelta(days=3)).isoformat(),
            "limit": 1,
            "offset": 1,
        },
        headers=headers,
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["count"] == 3
    assert len(payload["data"]) == 1
    assert payload["data"][0]["schema_version"] == first_schema.version
    assert payload["data"][0]["data"] == {"reading": 2}
    assert second_schema.version != first_schema.version


def test_data_records_api_without_schema_version_remains_backward_compatible(
    client: TestClient, db: Session
) -> None:
    ledger, _, category = create_category_tree(db)
    headers = authentication_token_from_email(
        client=client, email=ledger.owner.email, db=db
    )
    category_use_cases.set_category_data_schema(
        session=db,
        ledger_id=ledger.id,
        category_id=category.id,
        schema=_reading_schema(),
    )
    category_use_cases.create_category_data_record(
        session=db,
        ledger_id=ledger.id,
        category_id=category.id,
        observed_at=datetime(2026, 1, 1, tzinfo=UTC),
        data={"reading": 1},
    )
    category_use_cases.set_category_data_schema(
        session=db,
        ledger_id=ledger.id,
        category_id=category.id,
        schema=_status_schema(),
    )
    category_use_cases.create_category_data_record(
        session=db,
        ledger_id=ledger.id,
        category_id=category.id,
        observed_at=datetime(2026, 1, 2, tzinfo=UTC),
        data={"status": "ok"},
    )

    response = client.get(
        f"{settings.API_V1_STR}/ledgers/{ledger.id}/categories/{category.id}/data-records",
        headers=headers,
    )

    assert response.status_code == 200
    assert response.json()["count"] == 2
    assert len(response.json()["data"]) == 2


def test_data_records_api_rejects_invalid_or_foreign_schema_version(
    client: TestClient, db: Session
) -> None:
    ledger, _, category = create_category_tree(db)
    headers = authentication_token_from_email(
        client=client, email=ledger.owner.email, db=db
    )
    category_use_cases.set_category_data_schema(
        session=db,
        ledger_id=ledger.id,
        category_id=category.id,
        schema=_reading_schema(),
    )

    foreign_ledger, _, foreign_category = create_category_tree(db)
    category_use_cases.set_category_data_schema(
        session=db,
        ledger_id=foreign_ledger.id,
        category_id=foreign_category.id,
        schema=_reading_schema(),
    )
    foreign_second = category_use_cases.set_category_data_schema(
        session=db,
        ledger_id=foreign_ledger.id,
        category_id=foreign_category.id,
        schema=_status_schema(),
    )

    url = (
        f"{settings.API_V1_STR}/ledgers/{ledger.id}/categories/{category.id}/data-records"
    )
    foreign_version = client.get(
        url,
        params={"schema_version": foreign_second.version},
        headers=headers,
    )
    non_positive_version = client.get(
        url,
        params={"schema_version": 0},
        headers=headers,
    )

    assert foreign_version.status_code == 404
    assert foreign_version.json()["detail"] == "Category data schema not found"
    assert non_positive_version.status_code == 422


def test_data_records_api_keeps_cross_ledger_access_boundary(
    client: TestClient, db: Session
) -> None:
    ledger, _, _ = create_category_tree(db)
    _, _, foreign_category = create_category_tree(db)
    headers = authentication_token_from_email(
        client=client, email=ledger.owner.email, db=db
    )

    response = client.get(
        f"{settings.API_V1_STR}/ledgers/{ledger.id}/categories/{foreign_category.id}/data-records",
        params={"schema_version": 1},
        headers=headers,
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "Category not found"
