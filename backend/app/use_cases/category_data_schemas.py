import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Category, CategoryDataSchema
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


def list_category_data_schemas(
    *, session: Session, ledger_id: uuid.UUID, category_id: uuid.UUID
) -> list[CategoryDataSchema]:
    _require_category(session=session, ledger_id=ledger_id, category_id=category_id)
    return list(
        session.scalars(
            select(CategoryDataSchema)
            .where(CategoryDataSchema.category_id == category_id)
            .order_by(CategoryDataSchema.version.desc())
        ).all()
    )


def get_category_data_schema_version(
    *,
    session: Session,
    ledger_id: uuid.UUID,
    category_id: uuid.UUID,
    version: int,
) -> CategoryDataSchema:
    _require_category(session=session, ledger_id=ledger_id, category_id=category_id)
    category_schema = session.scalar(
        select(CategoryDataSchema).where(
            CategoryDataSchema.category_id == category_id,
            CategoryDataSchema.version == version,
        )
    )
    if category_schema is None:
        raise CategoryDataSchemaNotFoundError
    return category_schema
