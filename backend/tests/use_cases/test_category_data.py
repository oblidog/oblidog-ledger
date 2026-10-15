from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy.orm import Session

from app.use_cases import categories as category_use_cases
from app.use_cases import category_data_records as record_use_cases
from app.use_cases.exceptions import CategoryDataValidationError
from tests.utils.ledger_domain import create_category_tree


def _schema() -> dict[str, object]:
    return {
        "type": "object",
        "properties": {"reading": {"type": "number"}},
        "required": ["reading"],
        "additionalProperties": False,
    }


def test_category_data_records_are_timestamped_and_ordered(db: Session) -> None:
    ledger, _, category = create_category_tree(db)
    category_use_cases.set_category_data_schema(
        session=db, ledger_id=ledger.id, category_id=category.id, schema=_schema()
    )
    first_at = datetime(2026, 1, 1, tzinfo=UTC)
    second_at = first_at + timedelta(days=1)
    first = category_use_cases.create_category_data_record(
        session=db,
        ledger_id=ledger.id,
        category_id=category.id,
        observed_at=first_at,
        data={"reading": 10},
    )
    second = category_use_cases.create_category_data_record(
        session=db,
        ledger_id=ledger.id,
        category_id=category.id,
        observed_at=second_at,
        data={"reading": 20},
    )

    records = record_use_cases.list_category_data_records(
        session=db, ledger_id=ledger.id, category_id=category.id
    )

    assert [record.id for record in records] == [second.id, first.id]
    assert (
        category_use_cases.get_category_data_record(
            session=db, ledger_id=ledger.id, category_id=category.id
        ).id
        == second.id
    )


def test_records_keep_the_schema_version_used_when_created(db: Session) -> None:
    ledger, _, category = create_category_tree(db)
    first_schema = category_use_cases.set_category_data_schema(
        session=db, ledger_id=ledger.id, category_id=category.id, schema=_schema()
    )
    first = category_use_cases.create_category_data_record(
        session=db,
        ledger_id=ledger.id,
        category_id=category.id,
        observed_at=datetime(2026, 1, 1, tzinfo=UTC),
        data={"reading": 10},
    )
    second_schema = category_use_cases.set_category_data_schema(
        session=db,
        ledger_id=ledger.id,
        category_id=category.id,
        schema={
            "type": "object",
            "properties": {"status": {"type": "string"}},
            "required": ["status"],
            "additionalProperties": False,
        },
    )
    second = category_use_cases.create_category_data_record(
        session=db,
        ledger_id=ledger.id,
        category_id=category.id,
        observed_at=datetime(2026, 1, 2, tzinfo=UTC),
        data={"status": "ok"},
    )

    assert first.schema_version == first_schema.version
    assert second.schema_version == second_schema.version
    assert first.data == {"reading": 10}


def test_record_validation_and_idempotency(db: Session) -> None:
    ledger, _, category = create_category_tree(db)
    category_use_cases.set_category_data_schema(
        session=db, ledger_id=ledger.id, category_id=category.id, schema=_schema()
    )
    with pytest.raises(CategoryDataValidationError, match="required property"):
        category_use_cases.create_category_data_record(
            session=db,
            ledger_id=ledger.id,
            category_id=category.id,
            observed_at=datetime(2026, 1, 1, tzinfo=UTC),
            data={},
        )

    record = category_use_cases.create_category_data_record(
        session=db,
        ledger_id=ledger.id,
        category_id=category.id,
        observed_at=datetime(2026, 1, 1, tzinfo=UTC),
        data={"reading": 10},
        source="meter-api",
        external_id="event-1",
    )
    retry = category_use_cases.create_category_data_record(
        session=db,
        ledger_id=ledger.id,
        category_id=category.id,
        observed_at=datetime(2026, 1, 2, tzinfo=UTC),
        data={"reading": 20},
        source="meter-api",
        external_id="event-1",
    )

    assert retry.id == record.id


def test_records_support_inclusive_ranges_and_pagination(db: Session) -> None:
    ledger, _, category = create_category_tree(db)
    category_use_cases.set_category_data_schema(
        session=db, ledger_id=ledger.id, category_id=category.id, schema=_schema()
    )
    timestamps = [datetime(2026, 1, day, tzinfo=UTC) for day in (1, 2, 3)]
    for index, observed_at in enumerate(timestamps):
        category_use_cases.create_category_data_record(
            session=db,
            ledger_id=ledger.id,
            category_id=category.id,
            observed_at=observed_at,
            data={"reading": index},
        )

    records = record_use_cases.list_category_data_records(
        session=db,
        ledger_id=ledger.id,
        category_id=category.id,
        observed_from=timestamps[1],
        observed_to=timestamps[2],
        limit=1,
        offset=1,
    )
    count = record_use_cases.count_category_data_records(
        session=db,
        ledger_id=ledger.id,
        category_id=category.id,
        observed_from=timestamps[1],
        observed_to=timestamps[2],
    )

    assert [record.data for record in records] == [{"reading": 1}]
    assert count == 2
