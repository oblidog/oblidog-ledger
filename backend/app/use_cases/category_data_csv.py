import csv
import io
import re
import uuid
from datetime import date, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Category, CategoryDataSchema
from app.use_cases import category_data_records
from app.use_cases.exceptions import (
    CategoryDataSchemaNotFoundError,
    CategoryNotFoundError,
)

_METADATA_COLUMNS = ("observed_at", "schema_version", "source", "external_id")
_SUPPORTED_SCALAR_TYPES = {"string", "number", "integer", "boolean"}


class UnsupportedCategoryDataCsvSchemaError(ValueError):
    pass


def _excel_datetime(value: datetime) -> str:
    return value.strftime("%Y-%m-%d %H:%M:%S")


def _unwrap_nullable_scalar_schema(schema: dict[str, Any]) -> dict[str, Any]:
    any_of = schema.get("anyOf")
    if not isinstance(any_of, list) or len(any_of) != 2:
        return schema

    null_option = next(
        (
            option
            for option in any_of
            if isinstance(option, dict) and option.get("type") == "null"
        ),
        None,
    )
    typed_option = next(
        (
            option
            for option in any_of
            if isinstance(option, dict) and option.get("type") != "null"
        ),
        None,
    )
    return (
        typed_option if null_option is not None and typed_option is not None else schema
    )


def _scalar_type(property_name: str, schema: dict[str, Any]) -> str:
    value_type = schema.get("type")
    if isinstance(value_type, list):
        non_null_types = [item for item in value_type if item != "null"]
        if len(non_null_types) == 1:
            value_type = non_null_types[0]

    if not isinstance(value_type, str) or value_type not in _SUPPORTED_SCALAR_TYPES:
        raise UnsupportedCategoryDataCsvSchemaError(
            f"Field '{property_name}' uses unsupported CSV shape/type: {value_type!r}. "
            "Only scalar string, number, integer and boolean fields are supported."
        )
    return value_type


def _property_columns(
    schema_definition: dict[str, Any],
) -> list[tuple[str, dict[str, Any]]]:
    if schema_definition.get("type") != "object":
        raise UnsupportedCategoryDataCsvSchemaError(
            "Category data CSV export requires an object schema."
        )

    properties = schema_definition.get("properties", {})
    if not isinstance(properties, dict):
        raise UnsupportedCategoryDataCsvSchemaError(
            "Category data CSV export requires schema properties to be an object."
        )

    columns: list[tuple[str, dict[str, Any]]] = []
    for name in sorted(properties):
        property_schema = properties[name]
        if not isinstance(property_schema, dict):
            raise UnsupportedCategoryDataCsvSchemaError(
                f"Field '{name}' has an unsupported schema definition."
            )
        scalar_schema = _unwrap_nullable_scalar_schema(property_schema)
        _scalar_type(name, scalar_schema)
        columns.append((name, scalar_schema))
    return columns


def _format_value(value: Any, schema: dict[str, Any]) -> str:
    if value is None:
        return ""

    value_type = schema.get("type")
    if isinstance(value_type, list):
        value_type = next((item for item in value_type if item != "null"), None)

    if value_type == "boolean":
        return "true" if value is True else "false"
    if value_type == "number":
        return str(value).replace(".", ",")
    if value_type == "integer":
        return str(value)
    if value_type == "string":
        text = str(value)
        value_format = schema.get("format")
        if value_format == "date":
            return date.fromisoformat(text).isoformat()
        if value_format == "date-time":
            return _excel_datetime(datetime.fromisoformat(text.replace("Z", "+00:00")))
        return text

    raise UnsupportedCategoryDataCsvSchemaError(
        f"Unsupported CSV scalar type: {value_type!r}."
    )


def _safe_filename(category_name: str, schema_version: int) -> str:
    slug = re.sub(r"[^A-Za-z0-9._-]+", "-", category_name.strip()).strip("-._")
    if not slug:
        slug = "category"
    return f"oblidog-category-data-{slug}-v{schema_version}.csv"


def export_category_data_csv(
    *,
    session: Session,
    ledger_id: uuid.UUID,
    category_id: uuid.UUID,
    schema_version: int,
    observed_from: datetime | None = None,
    observed_to: datetime | None = None,
) -> tuple[str, str]:
    category = session.scalar(
        select(Category).where(
            Category.id == category_id,
            Category.ledger_id == ledger_id,
        )
    )
    if category is None:
        raise CategoryNotFoundError

    category_schema = session.scalar(
        select(CategoryDataSchema).where(
            CategoryDataSchema.category_id == category_id,
            CategoryDataSchema.version == schema_version,
        )
    )
    if category_schema is None:
        raise CategoryDataSchemaNotFoundError

    columns = _property_columns(category_schema.schema)
    count = category_data_records.count_category_data_records(
        session=session,
        ledger_id=ledger_id,
        category_id=category_id,
        schema_version=schema_version,
        observed_from=observed_from,
        observed_to=observed_to,
    )
    records = category_data_records.list_category_data_records(
        session=session,
        ledger_id=ledger_id,
        category_id=category_id,
        schema_version=schema_version,
        observed_from=observed_from,
        observed_to=observed_to,
        limit=max(count, 1),
        offset=0,
    )

    output = io.StringIO(newline="")
    writer = csv.writer(output, delimiter=";", lineterminator="\r\n")
    writer.writerow([*_METADATA_COLUMNS, *(name for name, _ in columns)])
    for record in records:
        writer.writerow(
            [
                _excel_datetime(record.observed_at),
                str(record.schema_version),
                record.source or "",
                record.external_id or "",
                *(
                    _format_value(record.data.get(name), property_schema)
                    for name, property_schema in columns
                ),
            ]
        )

    return _safe_filename(category.name, schema_version), "\ufeff" + output.getvalue()
