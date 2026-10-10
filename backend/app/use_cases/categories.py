from __future__ import annotations

import re
import uuid
from datetime import date, datetime
from typing import Any

from jsonschema import FormatChecker, SchemaError, ValidationError
from jsonschema.validators import validator_for
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domain import Currency, DataSourcePolicy, RecurrenceUnit
from app.models import (
    Category,
    CategoryDataRecord,
    CategoryDataSchema,
    CategoryGroup,
    Ledger,
)
from app.services import categories as category_service
from app.use_cases.exceptions import (
    CategoryDataSchemaNotFoundError,
    CategoryDataValidationError,
    CategoryGroupArchivedError,
    CategoryGroupHasActiveChildrenError,
    CategoryGroupNotFoundError,
    CategoryNotFoundError,
    CrossLedgerReferenceError,
    DuplicateCategoryCodeError,
    DuplicateCategoryError,
    DuplicateCategoryGroupError,
    InvalidCategoryCodeError,
    InvalidCategoryDataSchemaError,
    LedgerNotFoundError,
)


def _require_ledger(*, session: Session, ledger_id: uuid.UUID) -> Ledger:
    ledger = session.get(Ledger, ledger_id)
    if ledger is None:
        raise LedgerNotFoundError
    return ledger


def _normalize_name(value: str) -> str:
    normalized = value.strip()
    if not normalized:
        raise ValueError("name must not be empty")
    return normalized


def _normalize_code(value: str) -> str:
    normalized = value.strip()
    if re.fullmatch(r"[A-Z]{4}", normalized) is None:
        raise InvalidCategoryCodeError
    return normalized


def _require_category(
    *,
    session: Session,
    ledger_id: uuid.UUID,
    category_id: uuid.UUID,
    for_update: bool = False,
) -> Category:
    statement = select(Category).where(
        Category.id == category_id, Category.ledger_id == ledger_id
    )
    if for_update:
        statement = statement.with_for_update()
    category = session.scalar(statement)
    if category is None:
        raise CategoryNotFoundError
    return category


def get_category_by_code(
    *, session: Session, ledger_id: uuid.UUID, category_code: str
) -> Category:
    category = session.scalar(
        select(Category).where(
            Category.ledger_id == ledger_id,
            Category.code == category_code,
        )
    )
    if category is None:
        raise CategoryNotFoundError
    return category


def _validate_schema(schema: dict[str, Any]) -> None:
    if schema.get("type") != "object":
        raise InvalidCategoryDataSchemaError(
            "Category data schema root type must be object"
        )
    try:
        validator_for(schema).check_schema(schema)
    except SchemaError as exc:
        raise InvalidCategoryDataSchemaError(str(exc.message)) from exc


def _validate_data(*, schema: dict[str, Any], data: dict[str, Any]) -> None:
    validator = validator_for(schema)
    try:
        validator(schema, format_checker=FormatChecker()).validate(data)
    except ValidationError as exc:
        location = ".".join(str(part) for part in exc.absolute_path)
        prefix = f"{location}: " if location else ""
        raise CategoryDataValidationError(f"{prefix}{exc.message}") from exc


def get_category_data_schema(
    *, session: Session, ledger_id: uuid.UUID, category_id: uuid.UUID
) -> CategoryDataSchema:
    _require_category(session=session, ledger_id=ledger_id, category_id=category_id)
    schema = session.scalar(
        select(CategoryDataSchema).where(
            CategoryDataSchema.category_id == category_id,
            CategoryDataSchema.is_active.is_(True),
        )
    )
    if schema is None:
        raise CategoryDataSchemaNotFoundError
    return schema


def set_category_data_schema(
    *,
    session: Session,
    ledger_id: uuid.UUID,
    category_id: uuid.UUID,
    schema: dict[str, Any],
) -> CategoryDataSchema:
    _require_category(
        session=session, ledger_id=ledger_id, category_id=category_id, for_update=True
    )
    _validate_schema(schema)
    current_schema = session.scalar(
        select(CategoryDataSchema).where(
            CategoryDataSchema.category_id == category_id,
            CategoryDataSchema.is_active.is_(True),
        )
    )
    latest_version = session.scalar(
        select(CategoryDataSchema.version)
        .where(CategoryDataSchema.category_id == category_id)
        .order_by(CategoryDataSchema.version.desc())
        .limit(1)
    )
    if current_schema is not None:
        current_schema.is_active = False
        session.flush()
    category_schema = CategoryDataSchema(
        category_id=category_id,
        version=(latest_version or 0) + 1,
        schema=schema,
        is_active=True,
    )
    session.add(category_schema)
    session.flush()
    session.commit()
    session.refresh(category_schema)
    return category_schema


def get_category_data_record(
    *, session: Session, ledger_id: uuid.UUID, category_id: uuid.UUID
) -> CategoryDataRecord:
    _require_category(session=session, ledger_id=ledger_id, category_id=category_id)
    category_data = session.scalar(
        select(CategoryDataRecord)
        .where(CategoryDataRecord.category_id == category_id)
        .order_by(CategoryDataRecord.observed_at.desc(), CategoryDataRecord.id.desc())
        .limit(1)
    )
    if category_data is None:
        raise CategoryDataSchemaNotFoundError
    return category_data


def create_category_data_record(
    *,
    session: Session,
    ledger_id: uuid.UUID,
    category_id: uuid.UUID,
    observed_at: datetime,
    data: dict[str, Any],
    source: str | None = None,
    external_id: str | None = None,
) -> CategoryDataRecord:
    _require_category(
        session=session, ledger_id=ledger_id, category_id=category_id, for_update=True
    )
    if source is not None and external_id is not None:
        existing_record = session.scalar(
            select(CategoryDataRecord).where(
                CategoryDataRecord.category_id == category_id,
                CategoryDataRecord.source == source,
                CategoryDataRecord.external_id == external_id,
            )
        )
        if existing_record is not None:
            return existing_record
    active_schema = get_category_data_schema(
        session=session, ledger_id=ledger_id, category_id=category_id
    )
    _validate_data(schema=active_schema.schema, data=data)
    category_data = CategoryDataRecord(
        category_id=category_id,
        schema_version=active_schema.version,
        observed_at=observed_at,
        data=data,
        source=source,
        external_id=external_id,
    )
    session.add(category_data)
    session.commit()
    session.refresh(category_data)
    return category_data


def create_category_group(
    *,
    session: Session,
    ledger_id: uuid.UUID,
    name: str,
    description: str | None = None,
) -> CategoryGroup:
    _require_ledger(session=session, ledger_id=ledger_id)
    normalized_name = _normalize_name(name)

    existing = session.scalar(
        select(CategoryGroup.id).where(
            CategoryGroup.ledger_id == ledger_id,
            CategoryGroup.name == normalized_name,
        )
    )
    if existing is not None:
        raise DuplicateCategoryGroupError

    category_group = CategoryGroup(
        ledger_id=ledger_id,
        name=normalized_name,
        description=description,
        is_active=True,
    )
    session.add(category_group)
    session.commit()
    session.refresh(category_group)
    return category_group


def list_category_groups_for_ledger(
    *,
    session: Session,
    ledger_id: uuid.UUID,
    include_archived: bool = False,
) -> list[CategoryGroup]:
    _require_ledger(session=session, ledger_id=ledger_id)

    statement = select(CategoryGroup).where(CategoryGroup.ledger_id == ledger_id)
    if not include_archived:
        statement = statement.where(CategoryGroup.is_active.is_(True))

    return list(
        session.scalars(
            statement.order_by(CategoryGroup.name.asc(), CategoryGroup.id.asc())
        ).all()
    )


def update_category_group(
    *,
    session: Session,
    ledger_id: uuid.UUID,
    category_group_id: uuid.UUID,
    name: str,
    description: str | None = None,
) -> CategoryGroup:
    _require_ledger(session=session, ledger_id=ledger_id)
    category_group = session.scalar(
        select(CategoryGroup).where(
            CategoryGroup.id == category_group_id,
            CategoryGroup.ledger_id == ledger_id,
        )
    )
    if category_group is None:
        raise CategoryGroupNotFoundError

    normalized_name = _normalize_name(name)
    existing = session.scalar(
        select(CategoryGroup.id).where(
            CategoryGroup.ledger_id == ledger_id,
            CategoryGroup.name == normalized_name,
            CategoryGroup.id != category_group_id,
        )
    )
    if existing is not None:
        raise DuplicateCategoryGroupError

    category_group.name = normalized_name
    category_group.description = description
    session.commit()
    session.refresh(category_group)
    return category_group


def create_category(
    *,
    session: Session,
    ledger_id: uuid.UUID,
    category_group_id: uuid.UUID,
    name: str,
    description: str | None = None,
    code: str,
    data_source_policy: DataSourcePolicy = DataSourcePolicy.HYBRID,
    recurrence_interval: int | None = None,
    recurrence_unit: RecurrenceUnit | None = None,
    first_due_date: date | None = None,
    currency: Currency | None = None,
) -> Category:
    ledger = _require_ledger(session=session, ledger_id=ledger_id)
    normalized_name = _normalize_name(name)

    category_group = session.scalar(
        select(CategoryGroup).where(
            CategoryGroup.id == category_group_id,
            CategoryGroup.ledger_id == ledger_id,
        )
    )
    if category_group is None:
        category_group_in_other_ledger = session.scalar(
            select(CategoryGroup.id).where(CategoryGroup.id == category_group_id)
        )
        if category_group_in_other_ledger is not None:
            raise CrossLedgerReferenceError
        raise CategoryGroupNotFoundError
    if not category_group.is_active:
        raise CategoryGroupArchivedError

    existing = session.scalar(
        select(Category.id).where(
            Category.ledger_id == ledger_id,
            Category.category_group_id == category_group_id,
            Category.name == normalized_name,
        )
    )
    if existing is not None:
        raise DuplicateCategoryError

    normalized_code = _normalize_code(code)
    while (
        session.scalar(
            select(Category.id).where(
                Category.ledger_id == ledger_id, Category.code == normalized_code
            )
        )
        is not None
    ):
        raise DuplicateCategoryCodeError

    if data_source_policy is DataSourcePolicy.MANUAL:
        recurrence_interval = recurrence_unit = first_due_date = None

    category = Category(
        ledger_id=ledger_id,
        category_group_id=category_group_id,
        name=normalized_name,
        description=description,
        is_active=True,
        code=normalized_code,
        data_source_policy=data_source_policy,
        recurrence_interval=recurrence_interval,
        recurrence_unit=recurrence_unit,
        first_due_date=first_due_date,
        currency=currency if currency is not None else ledger.default_currency,
    )
    session.add(category)
    session.commit()
    session.refresh(category)
    return category


def update_category(
    *,
    session: Session,
    ledger_id: uuid.UUID,
    category_id: uuid.UUID,
    category_group_id: uuid.UUID | None = None,
    name: str,
    description: str | None = None,
    data_source_policy: DataSourcePolicy = DataSourcePolicy.HYBRID,
    recurrence_interval: int | None = None,
    recurrence_unit: RecurrenceUnit | None = None,
    first_due_date: date | None = None,
    currency: Currency | None = None,
) -> Category:
    _require_ledger(session=session, ledger_id=ledger_id)
    category = session.scalar(
        select(Category).where(
            Category.id == category_id,
            Category.ledger_id == ledger_id,
        )
    )
    if category is None:
        raise CategoryNotFoundError

    target_group_id = category_group_id or category.category_group_id
    category_group = session.scalar(
        select(CategoryGroup).where(
            CategoryGroup.id == target_group_id,
            CategoryGroup.ledger_id == ledger_id,
        )
    )
    if category_group is None:
        raise CategoryGroupNotFoundError
    if not category_group.is_active:
        raise CategoryGroupArchivedError

    normalized_name = _normalize_name(name)
    existing_name = session.scalar(
        select(Category.id).where(
            Category.ledger_id == ledger_id,
            Category.category_group_id == target_group_id,
            Category.name == normalized_name,
            Category.id != category_id,
        )
    )
    if existing_name is not None:
        raise DuplicateCategoryError

    category.category_group_id = target_group_id
    category.name = normalized_name
    category.description = description
    category.data_source_policy = data_source_policy
    if data_source_policy is DataSourcePolicy.MANUAL:
        recurrence_interval = recurrence_unit = first_due_date = None
    category.recurrence_interval = recurrence_interval
    category.recurrence_unit = recurrence_unit
    category.first_due_date = first_due_date
    if currency is not None:
        category.currency = currency
    session.commit()
    session.refresh(category)
    return category


def list_categories_for_ledger(
    *,
    session: Session,
    ledger_id: uuid.UUID,
    category_group_id: uuid.UUID | None = None,
    include_archived: bool = False,
) -> list[Category]:
    _require_ledger(session=session, ledger_id=ledger_id)

    statement = (
        select(Category)
        .where(Category.ledger_id == ledger_id)
        .execution_options(populate_existing=True)
    )
    if category_group_id is not None:
        statement = statement.where(Category.category_group_id == category_group_id)
    if not include_archived:
        statement = statement.where(Category.is_active.is_(True))

    return list(
        session.scalars(
            statement.order_by(Category.name.asc(), Category.id.asc())
        ).all()
    )


def archive_category(
    *,
    session: Session,
    ledger_id: uuid.UUID,
    category_id: uuid.UUID,
) -> Category:
    _require_ledger(session=session, ledger_id=ledger_id)

    try:
        category = category_service.archive_category(
            session=session,
            ledger_id=ledger_id,
            category_id=category_id,
        )
    except category_service.CategoryNotFoundError as exc:
        raise CategoryNotFoundError from exc

    session.commit()
    session.refresh(category)
    return category


def archive_category_group(
    *,
    session: Session,
    ledger_id: uuid.UUID,
    category_group_id: uuid.UUID,
) -> CategoryGroup:
    _require_ledger(session=session, ledger_id=ledger_id)

    try:
        category_group = category_service.archive_category_group(
            session=session,
            ledger_id=ledger_id,
            category_group_id=category_group_id,
        )
    except category_service.CategoryGroupNotFoundError as exc:
        raise CategoryGroupNotFoundError from exc
    except category_service.CategoryGroupHasActiveChildrenError as exc:
        raise CategoryGroupHasActiveChildrenError from exc

    session.commit()
    session.refresh(category_group)
    return category_group


def restore_category(
    *, session: Session, ledger_id: uuid.UUID, category_id: uuid.UUID
) -> Category:
    _require_ledger(session=session, ledger_id=ledger_id)
    try:
        category = category_service.restore_category(
            session=session,
            ledger_id=ledger_id,
            category_id=category_id,
        )
    except category_service.CategoryNotFoundError as exc:
        raise CategoryNotFoundError from exc
    except category_service.CategoryGroupNotFoundError as exc:
        raise CategoryGroupNotFoundError from exc
    except category_service.CategoryGroupHasActiveChildrenError as exc:
        raise CategoryGroupArchivedError from exc

    session.commit()
    session.refresh(category)
    return category
