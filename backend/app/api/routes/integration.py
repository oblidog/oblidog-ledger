"""Ledger-scoped, API-key authenticated integration endpoints."""

from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query

from app.api.deps import ApiContext, require_scope
from app.api.routes.categories import (
    _to_category_data_record_public,
    _to_category_data_schema_public,
)
from app.api.routes.integration_instances import router as instances_router
from app.api.routes.obligations import (
    to_obligation_component_public,
    to_obligation_public,
)
from app.domain import ObligationKey, ObligationLifecycle
from app.schemas import (
    CategoryDataRecordPublic,
    CategoryDataRecordsPublic,
    CategoryDataSchemaPublic,
    IntegrationCategoryDataRecordCreate,
    IntegrationObligationComponentUpsert,
    ObligationComponentPublic,
    ObligationComponentsPublic,
    ObligationIntegrationUpdate,
    ObligationNoteAppend,
    ObligationPublic,
    ObligationsPublic,
)
from app.use_cases import categories as category_use_cases
from app.use_cases import obligations as obligation_use_cases
from app.use_cases.exceptions import (
    CategoryDataSchemaNotFoundError,
    CategoryDataValidationError,
    CategoryNotFoundError,
    ObligationInvalidLifecycleError,
    ObligationNotFoundError,
    ObligationReadOnlyError,
)

router = APIRouter(prefix="/integration", tags=["integration"])
router.include_router(instances_router)


@router.get(
    "/category/data-records/latest",
    response_model=CategoryDataRecordPublic,
)
def read_latest_integration_category_data_record(
    context: ApiContext = Depends(require_scope("ledger:read")),
) -> CategoryDataRecordPublic:
    try:
        category_data = category_use_cases.get_category_data_record(
            session=context.session,
            ledger_id=context.ledger.id,
            category_id=context.category.id,
        )
    except (CategoryNotFoundError, CategoryDataSchemaNotFoundError):
        raise HTTPException(status_code=404, detail="Category data record not found")
    return _to_category_data_record_public(category_data)


@router.get("/category/data-records", response_model=CategoryDataRecordsPublic)
def read_integration_category_data_records(
    observed_from: datetime | None = Query(default=None, alias="from"),
    observed_to: datetime | None = Query(default=None, alias="to"),
    limit: int = Query(default=100, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    context: ApiContext = Depends(require_scope("ledger:read")),
) -> CategoryDataRecordsPublic:
    try:
        records = category_use_cases.list_category_data_records(
            session=context.session,
            ledger_id=context.ledger.id,
            category_id=context.category.id,
            observed_from=observed_from,
            observed_to=observed_to,
            limit=limit,
            offset=offset,
        )
        count = category_use_cases.count_category_data_records(
            session=context.session,
            ledger_id=context.ledger.id,
            category_id=context.category.id,
            observed_from=observed_from,
            observed_to=observed_to,
        )
    except CategoryNotFoundError:
        raise HTTPException(status_code=404, detail="Category not found")
    return CategoryDataRecordsPublic(
        data=[_to_category_data_record_public(record) for record in records],
        count=count,
    )


@router.post("/category/data-records", response_model=CategoryDataRecordPublic)
def create_integration_category_data_record(
    category_data_in: IntegrationCategoryDataRecordCreate,
    context: ApiContext = Depends(require_scope("ledger:write")),
) -> CategoryDataRecordPublic:
    try:
        category_data = category_use_cases.create_category_data_record(
            session=context.session,
            ledger_id=context.ledger.id,
            category_id=context.category.id,
            observed_at=category_data_in.observed_at,
            data=category_data_in.data,
            source=context.integration.name,
            external_id=category_data_in.external_id,
        )
    except CategoryNotFoundError:
        raise HTTPException(status_code=404, detail="Category not found")
    except CategoryDataSchemaNotFoundError:
        raise HTTPException(
            status_code=409, detail="Category data schema not configured"
        )
    except CategoryDataValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    return _to_category_data_record_public(category_data)


@router.get("/category/schema", response_model=CategoryDataSchemaPublic)
def read_integration_category_data_schema(
    context: ApiContext = Depends(require_scope("ledger:read")),
) -> CategoryDataSchemaPublic:
    try:
        category_schema = category_use_cases.get_category_data_schema(
            session=context.session,
            ledger_id=context.ledger.id,
            category_id=context.category.id,
        )
    except CategoryNotFoundError:
        raise HTTPException(status_code=404, detail="Category not found")
    except CategoryDataSchemaNotFoundError:
        raise HTTPException(status_code=404, detail="Category data schema not found")
    return _to_category_data_schema_public(category_schema)


def _parse_obligation_key(obligation_key: str) -> ObligationKey:
    try:
        return ObligationKey.parse(obligation_key)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="Invalid obligation key") from exc


def _not_found_as_http(call: Any) -> ObligationPublic:
    try:
        return to_obligation_public(call())
    except ObligationNotFoundError:
        raise HTTPException(status_code=404, detail="Obligation not found")


def _require_context_category(context: ApiContext, key: ObligationKey) -> None:
    try:
        obligation = obligation_use_cases.get_obligation_by_key(
            session=context.session, ledger_id=context.ledger.id, key=key
        )
    except ObligationNotFoundError:
        raise HTTPException(status_code=404, detail="Obligation not found")
    if obligation.category_id != context.category.id:
        raise HTTPException(status_code=404, detail="Obligation not found")


@router.get("/obligations", response_model=ObligationsPublic)
def read_integration_obligations(
    context: ApiContext = Depends(require_scope("ledger:read")),
    year: int | None = Query(default=None, ge=1, le=9999),
    month: int | None = Query(default=None, ge=1, le=12),
    lifecycle: ObligationLifecycle | None = None,
) -> ObligationsPublic:
    obligations = obligation_use_cases.list_obligations_for_ledger(
        session=context.session,
        ledger_id=context.ledger.id,
        year=year,
        month=month,
        category_id=context.category.id,
        lifecycle=lifecycle,
    )
    return ObligationsPublic(
        data=[to_obligation_public(obligation) for obligation in obligations],
        count=len(obligations),
    )


@router.get("/obligations/{obligation_key}", response_model=ObligationPublic)
def read_integration_obligation(
    obligation_key: str,
    context: ApiContext = Depends(require_scope("ledger:read")),
) -> ObligationPublic:
    key = _parse_obligation_key(obligation_key)
    _require_context_category(context, key)
    return _not_found_as_http(
        lambda: obligation_use_cases.get_obligation_by_key(
            session=context.session, ledger_id=context.ledger.id, key=key
        )
    )


@router.get(
    "/obligations/{obligation_key}/components",
    response_model=ObligationComponentsPublic,
)
def read_integration_obligation_components(
    obligation_key: str,
    context: ApiContext = Depends(require_scope("ledger:read")),
) -> ObligationComponentsPublic:
    key = _parse_obligation_key(obligation_key)
    _require_context_category(context, key)
    try:
        components = obligation_use_cases.list_obligation_components(
            session=context.session, ledger_id=context.ledger.id, key=key
        )
    except ObligationNotFoundError:
        raise HTTPException(status_code=404, detail="Obligation not found")
    return ObligationComponentsPublic(
        data=[to_obligation_component_public(component) for component in components],
        count=len(components),
    )


@router.put(
    "/obligations/{obligation_key}/components/upsert",
    response_model=ObligationComponentPublic,
)
def upsert_integration_obligation_component(
    obligation_key: str,
    component_in: IntegrationObligationComponentUpsert,
    context: ApiContext = Depends(require_scope("ledger:write")),
) -> ObligationComponentPublic:
    key = _parse_obligation_key(obligation_key)
    _require_context_category(context, key)
    try:
        component = obligation_use_cases.upsert_obligation_component(
            session=context.session,
            ledger_id=context.ledger.id,
            key=key,
            source=context.integration.name,
            **component_in.model_dump(),
        )
    except ObligationNotFoundError:
        raise HTTPException(status_code=404, detail="Obligation not found")
    return to_obligation_component_public(component)


@router.patch("/obligations/{obligation_key}", response_model=ObligationPublic)
def update_integration_obligation(
    obligation_key: str,
    obligation_in: ObligationIntegrationUpdate,
    context: ApiContext = Depends(require_scope("ledger:write")),
) -> ObligationPublic:
    key = _parse_obligation_key(obligation_key)
    _require_context_category(context, key)
    try:
        obligation = obligation_use_cases.update_integration_obligation(
            session=context.session,
            ledger_id=context.ledger.id,
            key=key,
            **obligation_in.model_dump(exclude_unset=True),
        )
    except ObligationNotFoundError:
        raise HTTPException(status_code=404, detail="Obligation not found")
    except ObligationReadOnlyError:
        raise HTTPException(
            status_code=409,
            detail="Only draft and collecting data obligations can be edited",
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return to_obligation_public(obligation)


def _run_integration_action(
    *, context: ApiContext, obligation_key: str, action: Any
) -> ObligationPublic:
    key = _parse_obligation_key(obligation_key)
    _require_context_category(context, key)
    try:
        obligation = action(
            session=context.session, ledger_id=context.ledger.id, key=key
        )
    except ObligationNotFoundError:
        raise HTTPException(status_code=404, detail="Obligation not found")
    except ObligationInvalidLifecycleError:
        raise HTTPException(status_code=409, detail="Invalid obligation lifecycle")
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return to_obligation_public(obligation)


@router.patch("/obligations/{obligation_key}/ready", response_model=ObligationPublic)
def mark_integration_obligation_ready(
    obligation_key: str,
    context: ApiContext = Depends(require_scope("ledger:write")),
) -> ObligationPublic:
    return _run_integration_action(
        context=context,
        obligation_key=obligation_key,
        action=obligation_use_cases.mark_obligation_ready,
    )


@router.post("/obligations/{obligation_key}/mark-paid", response_model=ObligationPublic)
def mark_integration_obligation_paid(
    obligation_key: str,
    context: ApiContext = Depends(require_scope("ledger:write")),
) -> ObligationPublic:
    return _run_integration_action(
        context=context,
        obligation_key=obligation_key,
        action=obligation_use_cases.mark_obligation_paid,
    )


@router.post("/obligations/{obligation_key}/cancel", response_model=ObligationPublic)
def cancel_integration_obligation(
    obligation_key: str,
    context: ApiContext = Depends(require_scope("ledger:write")),
) -> ObligationPublic:
    return _run_integration_action(
        context=context,
        obligation_key=obligation_key,
        action=obligation_use_cases.cancel_obligation,
    )


@router.post("/obligations/{obligation_key}/reopen", response_model=ObligationPublic)
def reopen_integration_obligation(
    obligation_key: str,
    context: ApiContext = Depends(require_scope("ledger:write")),
) -> ObligationPublic:
    return _run_integration_action(
        context=context,
        obligation_key=obligation_key,
        action=obligation_use_cases.reopen_obligation,
    )


@router.post("/obligations/{obligation_key}/error", response_model=ObligationPublic)
def mark_integration_obligation_error(
    obligation_key: str,
    context: ApiContext = Depends(require_scope("ledger:write")),
) -> ObligationPublic:
    return _run_integration_action(
        context=context,
        obligation_key=obligation_key,
        action=obligation_use_cases.mark_obligation_error,
    )


@router.post("/obligations/{obligation_key}/notes", response_model=ObligationPublic)
def append_integration_obligation_note(
    obligation_key: str,
    note_in: ObligationNoteAppend,
    context: ApiContext = Depends(require_scope("ledger:write")),
) -> ObligationPublic:
    key = _parse_obligation_key(obligation_key)
    _require_context_category(context, key)
    try:
        obligation = obligation_use_cases.append_integration_note(
            session=context.session,
            ledger_id=context.ledger.id,
            key=key,
            integration_name=context.integration.name,
            text=note_in.text,
        )
    except ObligationNotFoundError:
        raise HTTPException(status_code=404, detail="Obligation not found")
    return to_obligation_public(obligation)
