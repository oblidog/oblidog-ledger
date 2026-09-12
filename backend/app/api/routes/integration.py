"""Ledger-scoped, API-key authenticated integration endpoints."""

import re
from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Path, Query

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
from app.domain import BillingPeriod, ObligationKey, ObligationLifecycle
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

IntegrationObligationPeriodPath = Annotated[
    str,
    Path(
        description=(
            "Billing period in YYYY-MM format. Full obligation keys are temporarily "
            "accepted for client migration."
        ),
        examples=["2026-09"],
    ),
]


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


_OBLIGATION_PERIOD_PATTERN = re.compile(r"(?P<year>\d{4})-(?P<month>\d{2})")


def _resolve_integration_obligation_key(
    *, context: ApiContext, period: str
) -> ObligationKey:
    """Resolve a period in the credential-bound category to a domain key.

    Full obligation keys remain accepted temporarily so an updated Ledger can
    be deployed before all integration clients have migrated to period-based
    addressing.
    """
    legacy_key: ObligationKey | None = None
    try:
        legacy_key = ObligationKey.parse(period)
    except ValueError:
        pass

    if legacy_key is not None:
        if legacy_key.category_code != context.category.code:
            raise HTTPException(status_code=404, detail="Obligation not found")
        return legacy_key

    match = _OBLIGATION_PERIOD_PATTERN.fullmatch(period)
    if match is None:
        raise HTTPException(status_code=422, detail="Invalid obligation period")
    year = int(match["year"])
    month = int(match["month"])
    if year < 1:
        raise HTTPException(status_code=422, detail="Invalid obligation period")
    try:
        billing_period = BillingPeriod(year=year, month=month)
    except ValueError as exc:
        raise HTTPException(
            status_code=422, detail="Invalid obligation period"
        ) from exc
    return ObligationKey(
        category_code=context.category.code,
        period=billing_period,
    )


def _not_found_as_http(call: Any) -> ObligationPublic:
    try:
        return to_obligation_public(call())
    except ObligationNotFoundError:
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


@router.get("/obligations/{period}", response_model=ObligationPublic)
def read_integration_obligation(
    period: IntegrationObligationPeriodPath,
    context: ApiContext = Depends(require_scope("ledger:read")),
) -> ObligationPublic:
    key = _resolve_integration_obligation_key(context=context, period=period)
    return _not_found_as_http(
        lambda: obligation_use_cases.get_obligation_by_key(
            session=context.session, ledger_id=context.ledger.id, key=key
        )
    )


@router.get(
    "/obligations/{period}/components",
    response_model=ObligationComponentsPublic,
)
def read_integration_obligation_components(
    period: IntegrationObligationPeriodPath,
    context: ApiContext = Depends(require_scope("ledger:read")),
) -> ObligationComponentsPublic:
    key = _resolve_integration_obligation_key(context=context, period=period)
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
    "/obligations/{period}/components/upsert",
    response_model=ObligationComponentPublic,
)
def upsert_integration_obligation_component(
    period: IntegrationObligationPeriodPath,
    component_in: IntegrationObligationComponentUpsert,
    context: ApiContext = Depends(require_scope("ledger:write")),
) -> ObligationComponentPublic:
    key = _resolve_integration_obligation_key(context=context, period=period)
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


@router.patch("/obligations/{period}", response_model=ObligationPublic)
def update_integration_obligation(
    period: IntegrationObligationPeriodPath,
    obligation_in: ObligationIntegrationUpdate,
    context: ApiContext = Depends(require_scope("ledger:write")),
) -> ObligationPublic:
    key = _resolve_integration_obligation_key(context=context, period=period)
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
    *, context: ApiContext, period: str, action: Any
) -> ObligationPublic:
    key = _resolve_integration_obligation_key(context=context, period=period)
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


@router.patch("/obligations/{period}/ready", response_model=ObligationPublic)
def mark_integration_obligation_ready(
    period: IntegrationObligationPeriodPath,
    context: ApiContext = Depends(require_scope("ledger:write")),
) -> ObligationPublic:
    return _run_integration_action(
        context=context,
        period=period,
        action=obligation_use_cases.mark_obligation_ready,
    )


@router.post("/obligations/{period}/mark-paid", response_model=ObligationPublic)
def mark_integration_obligation_paid(
    period: IntegrationObligationPeriodPath,
    context: ApiContext = Depends(require_scope("ledger:write")),
) -> ObligationPublic:
    return _run_integration_action(
        context=context,
        period=period,
        action=obligation_use_cases.mark_obligation_paid,
    )


@router.post("/obligations/{period}/cancel", response_model=ObligationPublic)
def cancel_integration_obligation(
    period: IntegrationObligationPeriodPath,
    context: ApiContext = Depends(require_scope("ledger:write")),
) -> ObligationPublic:
    return _run_integration_action(
        context=context,
        period=period,
        action=obligation_use_cases.cancel_obligation,
    )


@router.post("/obligations/{period}/reopen", response_model=ObligationPublic)
def reopen_integration_obligation(
    period: IntegrationObligationPeriodPath,
    context: ApiContext = Depends(require_scope("ledger:write")),
) -> ObligationPublic:
    return _run_integration_action(
        context=context,
        period=period,
        action=obligation_use_cases.reopen_obligation,
    )


@router.post("/obligations/{period}/error", response_model=ObligationPublic)
def mark_integration_obligation_error(
    period: IntegrationObligationPeriodPath,
    context: ApiContext = Depends(require_scope("ledger:write")),
) -> ObligationPublic:
    return _run_integration_action(
        context=context,
        period=period,
        action=obligation_use_cases.mark_obligation_error,
    )


@router.post("/obligations/{period}/notes", response_model=ObligationPublic)
def append_integration_obligation_note(
    period: IntegrationObligationPeriodPath,
    note_in: ObligationNoteAppend,
    context: ApiContext = Depends(require_scope("ledger:write")),
) -> ObligationPublic:
    key = _resolve_integration_obligation_key(context=context, period=period)
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
