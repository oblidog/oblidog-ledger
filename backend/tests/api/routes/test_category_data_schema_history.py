from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.config import settings
from app.use_cases import categories as category_use_cases
from tests.utils.ledger_domain import create_category_tree
from tests.utils.user import authentication_token_from_email


def _schema(field: str) -> dict[str, object]:
    return {
        "type": "object",
        "properties": {field: {"type": "number"}},
        "required": [field],
        "additionalProperties": False,
    }


def test_schema_history_api_lists_and_reads_versions(
    client: TestClient, db: Session
) -> None:
    ledger, _, category = create_category_tree(db)
    headers = authentication_token_from_email(
        client=client, email=ledger.owner.email, db=db
    )
    first = category_use_cases.set_category_data_schema(
        session=db,
        ledger_id=ledger.id,
        category_id=category.id,
        schema=_schema("first"),
    )
    second = category_use_cases.set_category_data_schema(
        session=db,
        ledger_id=ledger.id,
        category_id=category.id,
        schema=_schema("second"),
    )
    base_url = (
        f"{settings.API_V1_STR}/ledgers/{ledger.id}/categories/{category.id}/data-schemas"
    )

    list_response = client.get(base_url, headers=headers)
    version_response = client.get(f"{base_url}/{first.version}", headers=headers)

    assert list_response.status_code == 200
    payload = list_response.json()
    assert payload["count"] == 2
    assert [item["version"] for item in payload["data"]] == [
        second.version,
        first.version,
    ]
    assert payload["data"][0]["schema"] == _schema("second")
    assert payload["data"][0]["is_active"] is True
    assert payload["data"][1]["is_active"] is False
    assert payload["data"][0]["created_at"]

    assert version_response.status_code == 200
    assert version_response.json()["version"] == first.version
    assert version_response.json()["schema"] == _schema("first")
    assert version_response.json()["is_active"] is False


def test_schema_history_api_rejects_cross_ledger_category(
    client: TestClient, db: Session
) -> None:
    ledger, _, _ = create_category_tree(db)
    _, _, foreign_category = create_category_tree(db)
    headers = authentication_token_from_email(
        client=client, email=ledger.owner.email, db=db
    )
    url = (
        f"{settings.API_V1_STR}/ledgers/{ledger.id}/categories/"
        f"{foreign_category.id}/data-schemas"
    )

    response = client.get(url, headers=headers)

    assert response.status_code == 404
    assert response.json()["detail"] == "Category not found"


def test_schema_history_api_returns_404_for_missing_resources(
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
        schema=_schema("value"),
    )
    base_url = (
        f"{settings.API_V1_STR}/ledgers/{ledger.id}/categories/{category.id}/data-schemas"
    )

    missing_version = client.get(f"{base_url}/999", headers=headers)

    assert missing_version.status_code == 404
    assert missing_version.json()["detail"] == "Category data schema not found"
