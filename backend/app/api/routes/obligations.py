import uuid
from datetime import date
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query

from app.api.deps import (
    SessionDep,
    require_ledger_edit_access,
    require_ledger_view_access,
)
from app.domain import BillingPeriod, ObligationKey, ObligationLifecycle
from app.models import Ledger, Obligation
from app.schemas import (
    CounterpartySummaryPublic,
    EnsuredObligationsPublic,
    ObligationComponentCreate,
    ObligationComponentPublic,
    ObligationComponentsPublic,
    ObligationComponentUpdate,
    ObligationComponentUpsert,
    ObligationCreate,
    ObligationPeriodPublic,
    ObligationPublic,
    ObligationsPublic,
    ObligationUpdate,
)
from app.use_cases import obligations as obligation_use_cases
from app.use_cases.exceptions import (
    CategoryNotFoundError,
    DuplicateObligationComponentError,
    DuplicateObligationError,
    ManualObligationNotAllowedError,
    ObligationComponentNotFoundError,
    ObligationInvalidLifecycleError,
    ObligationNotFoundError,
    ObligationReadOnlyError,
)

router = APIRouter(tags=["obligations"])


def to_obligation_public(obligation: Obligation) -> ObligationPublic:
    return ObligationPublic(
        id=obligation.id,
        ledger_id=obligation.ledger_id,
        category_id=obligation.category_id,
        counterparty_id=obligation.counterparty_id,
        counterparty=(
            CounterpartySummaryPublic.model_validate(obligation.counterparty)
            if obligation.counterparty is not None
            else None
        ),
        category_code=obligation.category.code,
        key=obligation.business_key,
        name=obligation.category.name,
        notes=obligation.notes,
        lifecycle=obligation.lifecycle,
        period=ObligationPeriodPublic(
            year=obligation.period_year,
            month=obligation.period_month,
        ),
        effective_value_source=obligation.effective_value_source,
        current_amount=obligation.current_amount,
        amount_state=obligation.amount_state,
        amount_source=obligation.amount_source,
        issue_date=obligation.issue_date,
        issue_date_state=obligation.issue_date_state,
        issue_date_source=obligation.issue_date_source,
        due_date=obligation.due_date,
        due_date_state=obligation.due_date_state,
        due_date_source=obligation.due_date_source,
        currency=obligation.currency,
        paid_at=obligation.paid_at,
        created_at=obligation.created_at,
        updated_at=obligation.updated_at,
    )


def to_obligation_component_public(component: Any) -> ObligationComponentPublic:
    return ObligationComponentPublic(
        id=component.id,
        obligation_id=component.obligation_id,
        type=component.type,
        label=component.label,
        amount=component.amount,
        source=component.source,
        external_id=component.external_id,
        metadata=component.component_metadata,
        created_at=component.created_at,
        updated_at=component.updated_at,
    )


@router.post(
    "/ledgers/{ledger_id}/obligations/ensure",
    response_model=EnsuredObligationsPublic,
)
def ensure_obligations(
    *,
    session: SessionDep,
    year: int | None = Query(default=None, ge=1, le=9999),
    month: int | None = Query(default=None, ge=1, le=12),
    ledger: Ledger = Depends(require_ledger_edit_access),
) -> Any:
    today = date.today()
    period = BillingPeriod(
        year=year if year is not None else today.year,
        month=month if month is not None else today.month,
    )
    created = obligation_use_cases.ensure_obligations_for_period(
        session=session,
        ledger_id=ledger.id,
        period=period,
    )
    return EnsuredObligationsPublic(
        created_keys=[obligation.business_key for obligation in created],
        created_count=len(created),
    )


@router.get("/ledgers/{ledger_id}/obligations", response_model=ObligationsPublic)
def read_obligations(
    session: SessionDep,
    year: int | None = Query(default=None, ge=1, le=9999),
    month: int | None = Query(default=None, ge=1, le=12),
    category_code: str | None = Query(default=None, pattern=r"^[A-Z]{4}$"),
    lifecycle: ObligationLifecycle | None = None,
    ledger: Ledger = Depends(require_ledger_view_access),
) -> Any:
    obligations = obligation_use_cases.list_obligations_for_ledger(
        session=session,
        ledger_id=ledger.id,
        year=year,
        month=month,
        category_code=category_code,
        lifecycle=lifecycle,
    )
    return ObligationsPublic(
        data=[to_obligation_public(obligation) for obligation in obligations],
        count=len(obligations),
    )


@router.post("/ledgers/{ledger_id}/obligations", response_model=ObligationPublic)
def create_obligation(
    *,
    session: SessionDep,
    obligation_in: ObligationCreate,
    ledger: Ledger = Depends(require_ledger_edit_access),
) -> Any:
    try:
        obligation = obligation_use_cases.create_manual_obligation(
            session=session,
            ledger_id=ledger.id,
            category_code=obligation_in.category_code,
            period=BillingPeriod(
                year=obligation_in.period.year,
                month=obligation_in.period.month,
            ),
            data_ready=obligation_in.data_ready,
            current_amount=obligation_in.current_amount,
            issue_date=obligation_in.issue_date,
            due_date=obligation_in.due_date,
            notes=obligation_in.notes,
        )
    except CategoryNotFoundError:
        raise HTTPException(status_code=404, detail="Category not found")
    except ManualObligationNotAllowedError:
        raise HTTPException(
            status_code=422,
            detail="Manual obligations are not allowed for automatic categories",
        )
    except DuplicateObligationError:
        raise HTTPException(status_code=409, detail="Obligation already exists")

    return to_obligation_public(obligation)


def _parse_obligation_key(obligation_key: str) -> ObligationKey:
    try:
        return ObligationKey.parse(obligation_key)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="Invalid obligation key") from exc


@router.get(
    "/ledgers/{ledger_id}/obligations/{obligation_key}/components",
    response_model=ObligationComponentsPublic,
)
def read_obligation_components(
    *,
    session: SessionDep,
    obligation_key: str,
    ledger: Ledger = Depends(require_ledger_view_access),
) -> Any:
    try:
        components = obligation_use_cases.list_obligation_components(
            session=session,
            ledger_id=ledger.id,
            key=_parse_obligation_key(obligation_key),
        )
    except ObligationNotFoundError:
        raise HTTPException(status_code=404, detail="Obligation not found")
    return ObligationComponentsPublic(
        data=[to_obligation_component_public(component) for component in components],
        count=len(components),
    )


@router.post(
    "/ledgers/{ledger_id}/obligations/{obligation_key}/components",
    response_model=ObligationComponentPublic,
)
def add_obligation_component(
    *,
    session: SessionDep,
    obligation_key: str,
    component_in: ObligationComponentCreate,
    ledger: Ledger = Depends(require_ledger_edit_access),
) -> Any:
    try:
        component = obligation_use_cases.add_obligation_component(
            session=session,
            ledger_id=ledger.id,
            key=_parse_obligation_key(obligation_key),
            **component_in.model_dump(),
        )
    except ObligationNotFoundError:
        raise HTTPException(status_code=404, detail="Obligation not found")
    except DuplicateObligationComponentError:
        raise HTTPException(
            status_code=409, detail="Obligation component already exists"
        )
    return to_obligation_component_public(component)


@router.put(
    "/ledgers/{ledger_id}/obligations/{obligation_key}/components/upsert",
    response_model=ObligationComponentPublic,
)
def upsert_obligation_component(
    *,
    session: SessionDep,
    obligation_key: str,
    component_in: ObligationComponentUpsert,
    ledger: Ledger = Depends(require_ledger_edit_access),
) -> Any:
    try:
        component = obligation_use_cases.upsert_obligation_component(
            session=session,
            ledger_id=ledger.id,
            key=_parse_obligation_key(obligation_key),
            **component_in.model_dump(),
        )
    except ObligationNotFoundError:
        raise HTTPException(status_code=404, detail="Obligation not found")
    return to_obligation_component_public(component)


@router.patch(
    "/ledgers/{ledger_id}/obligations/{obligation_key}/components/{component_id}",
    response_model=ObligationComponentPublic,
)
def update_obligation_component(
    *,
    session: SessionDep,
    obligation_key: str,
    component_id: uuid.UUID,
    component_in: ObligationComponentUpdate,
    ledger: Ledger = Depends(require_ledger_edit_access),
) -> Any:
    try:
        component = obligation_use_cases.update_obligation_component(
            session=session,
            ledger_id=ledger.id,
            key=_parse_obligation_key(obligation_key),
            component_id=component_id,
            **component_in.model_dump(exclude_unset=True),
        )
    except ObligationNotFoundError:
        raise HTTPException(status_code=404, detail="Obligation not found")
    except ObligationComponentNotFoundError:
        raise HTTPException(status_code=404, detail="Obligation component not found")
    except DuplicateObligationComponentError:
        raise HTTPException(
            status_code=409, detail="Obligation component already exists"
        )
    return to_obligation_component_public(component)


@router.delete(
    "/ledgers/{ledger_id}/obligations/{obligation_key}/components/{component_id}",
    status_code=204,
)
def remove_obligation_component(
    *,
    session: SessionDep,
    obligation_key: str,
    component_id: uuid.UUID,
    ledger: Ledger = Depends(require_ledger_edit_access),
) -> None:
    try:
        obligation_use_cases.remove_obligation_component(
            session=session,
            ledger_id=ledger.id,
            key=_parse_obligation_key(obligation_key),
            component_id=component_id,
        )
    except ObligationNotFoundError:
        raise HTTPException(status_code=404, detail="Obligation not found")
    except ObligationComponentNotFoundError:
        raise HTTPException(status_code=404, detail="Obligation component not found")


@router.patch(
    "/ledgers/{ledger_id}/obligations/{obligation_key}",
    response_model=ObligationPublic,
)
def update_obligation(
    *,
    session: SessionDep,
    obligation_key: str,
    obligation_in: ObligationUpdate,
    ledger: Ledger = Depends(require_ledger_edit_access),
) -> Any:
    try:
        key = ObligationKey.parse(obligation_key)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="Invalid obligation key") from exc

    try:
        obligation = obligation_use_cases.update_manual_obligation(
            session=session,
            ledger_id=ledger.id,
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


@router.patch(
    "/ledgers/{ledger_id}/obligations/{obligation_key}/ready",
    response_model=ObligationPublic,
)
def mark_obligation_ready(
    *,
    session: SessionDep,
    obligation_key: str,
    ledger: Ledger = Depends(require_ledger_edit_access),
) -> Any:
    try:
        key = ObligationKey.parse(obligation_key)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="Invalid obligation key") from exc

    try:
        obligation = obligation_use_cases.mark_obligation_ready(
            session=session,
            ledger_id=ledger.id,
            key=key,
        )
    except ObligationNotFoundError:
        raise HTTPException(status_code=404, detail="Obligation not found")
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    return to_obligation_public(obligation)


@router.post(
    "/ledgers/{ledger_id}/obligations/{obligation_key}/mark-paid",
    response_model=ObligationPublic,
)
def mark_obligation_paid(
    *,
    session: SessionDep,
    obligation_key: str,
    ledger: Ledger = Depends(require_ledger_edit_access),
) -> Any:
    try:
        key = ObligationKey.parse(obligation_key)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="Invalid obligation key") from exc

    try:
        obligation = obligation_use_cases.mark_obligation_paid(
            session=session,
            ledger_id=ledger.id,
            key=key,
        )
    except ObligationNotFoundError:
        raise HTTPException(status_code=404, detail="Obligation not found")
    except ObligationInvalidLifecycleError:
        raise HTTPException(
            status_code=409,
            detail="Only ready obligations can be marked as paid",
        )

    return to_obligation_public(obligation)


@router.post(
    "/ledgers/{ledger_id}/obligations/{obligation_key}/cancel",
    response_model=ObligationPublic,
)
def cancel_obligation(
    *,
    session: SessionDep,
    obligation_key: str,
    ledger: Ledger = Depends(require_ledger_edit_access),
) -> Any:
    try:
        key = ObligationKey.parse(obligation_key)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="Invalid obligation key") from exc

    try:
        obligation = obligation_use_cases.cancel_obligation(
            session=session,
            ledger_id=ledger.id,
            key=key,
        )
    except ObligationNotFoundError:
        raise HTTPException(status_code=404, detail="Obligation not found")
    except ObligationInvalidLifecycleError:
        raise HTTPException(
            status_code=409,
            detail="Only obligations collecting data can be canceled",
        )

    return to_obligation_public(obligation)


@router.post(
    "/ledgers/{ledger_id}/obligations/{obligation_key}/reopen",
    response_model=ObligationPublic,
)
def reopen_obligation(
    *,
    session: SessionDep,
    obligation_key: str,
    ledger: Ledger = Depends(require_ledger_edit_access),
) -> Any:
    try:
        key = ObligationKey.parse(obligation_key)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="Invalid obligation key") from exc

    try:
        obligation = obligation_use_cases.reopen_obligation(
            session=session,
            ledger_id=ledger.id,
            key=key,
        )
    except ObligationNotFoundError:
        raise HTTPException(status_code=404, detail="Obligation not found")
    except ObligationInvalidLifecycleError:
        raise HTTPException(
            status_code=409,
            detail="Only ready, paid, canceled, or error obligations can be reopened",
        )

    return to_obligation_public(obligation)


@router.get(
    "/ledgers/{ledger_id}/obligations/{obligation_key}",
    response_model=ObligationPublic,
)
def read_obligation(
    *,
    session: SessionDep,
    obligation_key: str,
    ledger: Ledger = Depends(require_ledger_view_access),
) -> Any:
    try:
        key = ObligationKey.parse(obligation_key)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="Invalid obligation key") from exc

    try:
        obligation = obligation_use_cases.get_obligation_by_key(
            session=session,
            ledger_id=ledger.id,
            key=key,
        )
    except ObligationNotFoundError:
        raise HTTPException(status_code=404, detail="Obligation not found")

    return to_obligation_public(obligation)
