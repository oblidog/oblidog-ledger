from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy.orm import Session

from app.use_cases import categories as category_use_cases
from app.use_cases import category_data_records as record_use_cases
from app.use_cases.exceptions import (
    CategoryDataSchemaNotFoundError,
    CategoryNotFoundError,
)
from tests.utils.ledger_domain import create_category_tree


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


def test_records_filter_by_schema_version_with_range_pagination_and_count(
    db: Session,
) -> None:
    ledger, _, category = create_category_tree(db)
    first_schema = category_use_cases.set_category_data_schema(
        session=db,
        ledger_id=ledger.id,
        category_id=category.id,
        schema=_reading_schema(),
    )
    start = datetime(2026, 1, 1, tzinfo=UTC)
    first_records = []
    for day in range(4):
        first_records.append(
            category_use_cases.create_category_data_record(
                session=db,
                ledger_id=ledger.id,
                category_id=category.id,
                observed_at=start + timedelta(days=day),
                data={"reading": day},
            )
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

    records = record_use_cases.list_category_data_records(
        session=db,
        ledger_id=ledger.id,
        category_id=category.id,
        schema_version=first_schema.version,
        observed_from=start + timedelta(days=1),
        observed_to=start + timedelta(days=3),
        limit=1,
        offset=1,
    )
    count = record_use_cases.count_category_data_records(
        session=db,
        ledger_id=ledger.id,
        category_id=category.id,
        schema_version=first_schema.version,
        observed_from=start + timedelta(days=1),
        observed_to=start + timedelta(days=3),
    )

    assert [record.id for record in records] == [first_records[2].id]
    assert count == 3
    assert all(record.schema_version == first_schema.version for record in records)
    assert second_schema.version != first_schema.version


def test_records_without_schema_version_preserve_existing_behavior(db: Session) -> None:
    ledger, _, category = create_category_tree(db)
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

    records = record_use_cases.list_category_data_records(
        session=db, ledger_id=ledger.id, category_id=category.id
    )
    count = record_use_cases.count_category_data_records(
        session=db, ledger_id=ledger.id, category_id=category.id
    )

    assert len(records) == 2
    assert count == 2
    assert records[0].observed_at > records[1].observed_at


def test_records_reject_schema_version_not_owned_by_category(db: Session) -> None:
    ledger, _, category = create_category_tree(db)
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

    with pytest.raises(CategoryDataSchemaNotFoundError):
        record_use_cases.list_category_data_records(
            session=db,
            ledger_id=ledger.id,
            category_id=category.id,
            schema_version=foreign_second.version,
        )


def test_records_keep_category_access_boundary(db: Session) -> None:
    ledger, _, _ = create_category_tree(db)
    _, _, foreign_category = create_category_tree(db)

    with pytest.raises(CategoryNotFoundError):
        record_use_cases.list_category_data_records(
            session=db,
            ledger_id=ledger.id,
            category_id=foreign_category.id,
            schema_version=1,
        )
