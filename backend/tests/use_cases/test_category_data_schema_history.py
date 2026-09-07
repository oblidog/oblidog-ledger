import pytest
from sqlalchemy.orm import Session

from app.use_cases import categories as category_use_cases
from app.use_cases import category_data_schemas as category_data_schema_use_cases
from app.use_cases.exceptions import (
    CategoryDataSchemaNotFoundError,
    CategoryNotFoundError,
)
from tests.utils.ledger_domain import create_category_tree


def _schema(field: str) -> dict[str, object]:
    return {
        "type": "object",
        "properties": {field: {"type": "number"}},
        "required": [field],
        "additionalProperties": False,
    }


def test_schema_history_lists_versions_newest_first(db: Session) -> None:
    ledger, _, category = create_category_tree(db)
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

    schemas = category_data_schema_use_cases.list_category_data_schemas(
        session=db,
        ledger_id=ledger.id,
        category_id=category.id,
    )

    assert [schema.version for schema in schemas] == [second.version, first.version]
    assert schemas[0].schema == _schema("second")
    assert schemas[0].is_active is True
    assert schemas[1].is_active is False


def test_schema_history_reads_specific_version(db: Session) -> None:
    ledger, _, category = create_category_tree(db)
    first = category_use_cases.set_category_data_schema(
        session=db,
        ledger_id=ledger.id,
        category_id=category.id,
        schema=_schema("first"),
    )
    category_use_cases.set_category_data_schema(
        session=db,
        ledger_id=ledger.id,
        category_id=category.id,
        schema=_schema("second"),
    )

    schema = category_data_schema_use_cases.get_category_data_schema_version(
        session=db,
        ledger_id=ledger.id,
        category_id=category.id,
        version=first.version,
    )

    assert schema.version == first.version
    assert schema.schema == _schema("first")
    assert schema.is_active is False


def test_schema_history_rejects_cross_ledger_category(db: Session) -> None:
    ledger, _, _ = create_category_tree(db)
    _, _, foreign_category = create_category_tree(db)

    with pytest.raises(CategoryNotFoundError):
        category_data_schema_use_cases.list_category_data_schemas(
            session=db,
            ledger_id=ledger.id,
            category_id=foreign_category.id,
        )


def test_schema_history_reports_missing_version(db: Session) -> None:
    ledger, _, category = create_category_tree(db)
    category_use_cases.set_category_data_schema(
        session=db,
        ledger_id=ledger.id,
        category_id=category.id,
        schema=_schema("value"),
    )

    with pytest.raises(CategoryDataSchemaNotFoundError):
        category_data_schema_use_cases.get_category_data_schema_version(
            session=db,
            ledger_id=ledger.id,
            category_id=category.id,
            version=999,
        )
