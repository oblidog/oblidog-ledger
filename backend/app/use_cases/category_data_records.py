import uuid
from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import Category, CategoryDataRecord, CategoryDataSchema
from app.use_cases.exceptions import (
    CategoryDataSchemaNotFoundError,
    CategoryNotFoundError,
)


def _require_category(
    *, session: Session, ledger_id: uuid.UUID, category_id: uuid.UUID
) -> None:
    category_id_in_ledger = session.scalar(
        select(Category.id).where(
            Category.id == category_id,
            Category.ledger_id == ledger_id,
        )
    )
    if category_id_in_ledger is None:
        raise CategoryNotFoundError


def _require_schema_version(
    *, session: Session, category_id: uuid.UUID, schema_version: int
) -> None:
    schema_exists = session.scalar(
        select(CategoryDataSchema.version).where(
            CategoryDataSchema.category_id == category_id,
            CategoryDataSchema.version == schema_version,
        )
    )
    if schema_exists is None:
        raise CategoryDataSchemaNotFoundError


def list_category_data_records(
    *,
    session: Session,
    ledger_id: uuid.UUID,
    category_id: uuid.UUID,
    schema_version: int | None = None,
    observed_from: datetime | None = None,
    observed_to: datetime | None = None,
    limit: int = 100,
    offset: int = 0,
) -> list[CategoryDataRecord]:
    _require_category(session=session, ledger_id=ledger_id, category_id=category_id)
    if schema_version is not None:
        _require_schema_version(
            session=session,
            category_id=category_id,
            schema_version=schema_version,
        )

    statement = select(CategoryDataRecord).where(
        CategoryDataRecord.category_id == category_id
    )
    if schema_version is not None:
        statement = statement.where(CategoryDataRecord.schema_version == schema_version)
    if observed_from is not None:
        statement = statement.where(CategoryDataRecord.observed_at >= observed_from)
    if observed_to is not None:
        statement = statement.where(CategoryDataRecord.observed_at <= observed_to)

    return list(
        session.scalars(
            statement.order_by(
                CategoryDataRecord.observed_at.desc(), CategoryDataRecord.id.desc()
            )
            .limit(limit)
            .offset(offset)
        ).all()
    )


def count_category_data_records(
    *,
    session: Session,
    ledger_id: uuid.UUID,
    category_id: uuid.UUID,
    schema_version: int | None = None,
    observed_from: datetime | None = None,
    observed_to: datetime | None = None,
) -> int:
    _require_category(session=session, ledger_id=ledger_id, category_id=category_id)
    if schema_version is not None:
        _require_schema_version(
            session=session,
            category_id=category_id,
            schema_version=schema_version,
        )

    statement = (
        select(func.count())
        .select_from(CategoryDataRecord)
        .where(CategoryDataRecord.category_id == category_id)
    )
    if schema_version is not None:
        statement = statement.where(CategoryDataRecord.schema_version == schema_version)
    if observed_from is not None:
        statement = statement.where(CategoryDataRecord.observed_at >= observed_from)
    if observed_to is not None:
        statement = statement.where(CategoryDataRecord.observed_at <= observed_to)

    return session.scalar(statement) or 0
