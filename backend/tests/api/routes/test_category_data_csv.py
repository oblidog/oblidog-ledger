import csv
import io
from datetime import UTC, datetime

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.config import settings
from app.use_cases import categories as category_use_cases
from tests.utils.ledger_domain import create_category_tree
from tests.utils.user import authentication_token_from_email


def _headers(client: TestClient, db: Session, email: str) -> dict[str, str]:
    return authentication_token_from_email(client=client, email=email, db=db)


def test_category_data_csv_export_encodes_schema_values_and_escaping(
    client: TestClient, db: Session
) -> None:
    ledger, _, category = create_category_tree(db)
    headers = _headers(client, db, ledger.owner.email)
    category_use_cases.set_category_data_schema(
        session=db,
        ledger_id=ledger.id,
        category_id=category.id,
        schema={
            "type": "object",
            "properties": {
                "label": {"type": "string"},
                "period": {"type": "string", "format": "date"},
                "captured_at": {"type": "string", "format": "date-time"},
                "amount": {"type": "number"},
                "account_204_balance": {
                    "anyOf": [{"type": "number"}, {"type": "null"}]
                },
                "enabled": {"type": "boolean"},
                "optional": {"type": ["string", "null"]},
            },
            "required": ["label", "period", "captured_at", "amount", "enabled"],
            "additionalProperties": False,
        },
    )
    category_use_cases.create_category_data_record(
        session=db,
        ledger_id=ledger.id,
        category_id=category.id,
        observed_at=datetime(2026, 1, 2, 12, 30, tzinfo=UTC),
        source='meter,"main"\nfeed',
        external_id="invoice,42",
        data={
            "label": 'Zażółć, "gęślą"\njaźń',
            "period": "2026-01-02",
            "captured_at": "2026-01-02T10:15:30Z",
            "amount": 12.5,
            "account_204_balance": 241.34,
            "enabled": True,
            "optional": None,
        },
    )

    response = client.get(
        f"{settings.API_V1_STR}/ledgers/{ledger.id}/categories/{category.id}/data-records.csv",
        params={"schema_version": 1},
        headers=headers,
    )

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/csv")
    assert "attachment;" in response.headers["content-disposition"]
    assert response.content.startswith(b"\xef\xbb\xbf")

    rows = list(
        csv.reader(io.StringIO(response.content.decode("utf-8-sig")), delimiter=";")
    )
    assert rows[0] == [
        "observed_at",
        "schema_version",
        "source",
        "external_id",
        "account_204_balance",
        "amount",
        "captured_at",
        "enabled",
        "label",
        "optional",
        "period",
    ]
    assert rows[1][0] == "2026-01-02 12:30:00"
    assert rows[1][1:] == [
        "1",
        'meter,"main"\nfeed',
        "invoice,42",
        "241,34",
        "12,5",
        "2026-01-02 10:15:30",
        "true",
        'Zażółć, "gęślą"\njaźń',
        "",
        "2026-01-02",
    ]


def test_category_data_csv_export_respects_date_filter_and_empty_scope(
    client: TestClient, db: Session
) -> None:
    ledger, _, category = create_category_tree(db)
    headers = _headers(client, db, ledger.owner.email)
    category_use_cases.set_category_data_schema(
        session=db,
        ledger_id=ledger.id,
        category_id=category.id,
        schema={
            "type": "object",
            "properties": {"reading": {"type": "integer"}},
            "required": ["reading"],
            "additionalProperties": False,
        },
    )
    for day, reading in ((1, 10), (2, 20)):
        category_use_cases.create_category_data_record(
            session=db,
            ledger_id=ledger.id,
            category_id=category.id,
            observed_at=datetime(2026, 1, day, 12, tzinfo=UTC),
            data={"reading": reading},
        )

    url = f"{settings.API_V1_STR}/ledgers/{ledger.id}/categories/{category.id}/data-records.csv"
    filtered = client.get(
        url,
        params={
            "schema_version": 1,
            "observed_from": "2026-01-02T00:00:00Z",
            "observed_to": "2026-01-02T23:59:59Z",
        },
        headers=headers,
    )
    empty = client.get(
        url,
        params={
            "schema_version": 1,
            "observed_from": "2027-01-01T00:00:00Z",
        },
        headers=headers,
    )

    assert filtered.status_code == 200
    filtered_rows = list(
        csv.reader(io.StringIO(filtered.content.decode("utf-8-sig")), delimiter=";")
    )
    assert len(filtered_rows) == 2
    assert filtered_rows[1][-1] == "20"

    assert empty.status_code == 200
    empty_rows = list(
        csv.reader(io.StringIO(empty.content.decode("utf-8-sig")), delimiter=";")
    )
    assert empty_rows == [
        ["observed_at", "schema_version", "source", "external_id", "reading"]
    ]


def test_category_data_csv_export_rejects_nested_fields(
    client: TestClient, db: Session
) -> None:
    ledger, _, category = create_category_tree(db)
    headers = _headers(client, db, ledger.owner.email)
    category_use_cases.set_category_data_schema(
        session=db,
        ledger_id=ledger.id,
        category_id=category.id,
        schema={
            "type": "object",
            "properties": {
                "details": {
                    "type": "object",
                    "properties": {"note": {"type": "string"}},
                }
            },
            "additionalProperties": False,
        },
    )

    response = client.get(
        f"{settings.API_V1_STR}/ledgers/{ledger.id}/categories/{category.id}/data-records.csv",
        params={"schema_version": 1},
        headers=headers,
    )

    assert response.status_code == 422
    assert "unsupported CSV shape/type" in response.json()["detail"]


def test_category_data_csv_export_does_not_cross_category_scope(
    client: TestClient, db: Session
) -> None:
    ledger, _, _ = create_category_tree(db)
    other_ledger, _, other_category = create_category_tree(db)
    headers = _headers(client, db, ledger.owner.email)

    response = client.get(
        f"{settings.API_V1_STR}/ledgers/{ledger.id}/categories/{other_category.id}/data-records.csv",
        params={"schema_version": 1},
        headers=headers,
    )

    assert other_ledger.id != ledger.id
    assert response.status_code == 404
