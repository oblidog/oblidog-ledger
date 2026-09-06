import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.api.deps import SessionDep, require_ledger_view_access
from app.models import CategoryDataSchema, Ledger
from app.schemas import CategoryDataSchemaPublic
from app.use_cases import category_data_schemas as category_data_schema_use_cases
from app.use_cases.exceptions import (
    CategoryDataSchemaNotFoundError,
    CategoryNotFoundError,
)

router = APIRouter(tags=["categories"])


class CategoryDataSchemasPublic(BaseModel):
    data: list[CategoryDataSchemaPublic]
    count: int


def _to_category_data_schema_public(
    category_schema: CategoryDataSchema,
) -> CategoryDataSchemaPublic:
    return CategoryDataSchemaPublic(
        version=category_schema.version,
        definition=category_schema.schema,
        is_active=category_schema.is_active,
        created_at=category_schema.created_at,
    )


@router.get(
    "/ledgers/{ledger_id}/categories/{category_id}/data-schemas",
    response_model=CategoryDataSchemasPublic,
)
def read_category_data_schemas(
    *,
    session: SessionDep,
    category_id: uuid.UUID,
    ledger: Ledger = Depends(require_ledger_view_access),
) -> Any:
    try:
        category_schemas = category_data_schema_use_cases.list_category_data_schemas(
            session=session,
            ledger_id=ledger.id,
            category_id=category_id,
        )
    except CategoryNotFoundError:
        raise HTTPException(status_code=404, detail="Category not found")

    return CategoryDataSchemasPublic(
        data=[
            _to_category_data_schema_public(category_schema)
            for category_schema in category_schemas
        ],
        count=len(category_schemas),
    )


@router.get(
    "/ledgers/{ledger_id}/categories/{category_id}/data-schemas/{version}",
    response_model=CategoryDataSchemaPublic,
)
def read_category_data_schema_version(
    *,
    session: SessionDep,
    category_id: uuid.UUID,
    version: int,
    ledger: Ledger = Depends(require_ledger_view_access),
) -> Any:
    try:
        category_schema = (
            category_data_schema_use_cases.get_category_data_schema_version(
                session=session,
                ledger_id=ledger.id,
                category_id=category_id,
                version=version,
            )
        )
    except CategoryNotFoundError:
        raise HTTPException(status_code=404, detail="Category not found")
    except CategoryDataSchemaNotFoundError:
        raise HTTPException(status_code=404, detail="Category data schema not found")

    return _to_category_data_schema_public(category_schema)
