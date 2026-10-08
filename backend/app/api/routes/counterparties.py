import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import or_, select

from app.api.deps import (
    CurrentActionActor,
    CurrentUser,
    SessionDep,
    get_current_active_superuser,
    require_ledger_edit_access,
    require_ledger_view_access,
)
from app.core.business_date import business_today
from app.domain import BillingPeriod, ObligationKey
from app.models import Category, Ledger, Obligation, User
from app.schemas import (
    CategoryPublic,
    CounterpartiesPublic,
    CounterpartyAssignment,
    CounterpartyCreate,
    CounterpartyPublic,
    CounterpartySearchPublic,
    CounterpartySummaryPublic,
    CounterpartyUpdate,
    Message,
)
from app.schemas.counterparties import (
    CategoryCounterpartyApply,
    CategoryCounterpartyPreview,
)
from app.services import counterparties as counterparty_service
from app.use_cases import obligations as obligation_use_cases
from app.use_cases.exceptions import ObligationNotFoundError

router = APIRouter(tags=["counterparties"])


def _category_for_counterparty_apply(
    session: SessionDep, ledger: Ledger, category_id: uuid.UUID, *, lock: bool = False
) -> Category:
    statement = select(Category).where(
        Category.id == category_id, Category.ledger_id == ledger.id
    )
    if lock:
        statement = statement.with_for_update()
    category = session.scalar(statement)
    if category is None:
        raise HTTPException(status_code=404, detail="Category not found")
    if category.counterparty_id is None:
        raise HTTPException(
            status_code=409, detail="Assign a category counterparty first"
        )
    return category


def _counterparty_apply_targets(
    session: SessionDep,
    category: Category,
    period: BillingPeriod,
    *,
    overwrite: bool,
    lock: bool = False,
) -> list[Obligation]:
    following = period.next()
    statement = (
        select(Obligation)
        .where(
            Obligation.ledger_id == category.ledger_id,
            Obligation.category_id == category.id,
            or_(
                (Obligation.period_year == period.year)
                & (Obligation.period_month == period.month),
                (Obligation.period_year == following.year)
                & (Obligation.period_month == following.month),
            ),
            or_(
                Obligation.counterparty_id.is_(None),
                Obligation.counterparty_id != category.counterparty_id,
            )
            if overwrite
            else Obligation.counterparty_id.is_(None),
        )
        .order_by(Obligation.id)
    )
    if lock:
        statement = statement.with_for_update()
    return list(session.scalars(statement))


@router.get(
    "/ledgers/{ledger_id}/categories/{category_id}/counterparty/obligations",
    response_model=CategoryCounterpartyPreview,
)
def preview_category_counterparty_apply(
    category_id: uuid.UUID,
    session: SessionDep,
    ledger: Ledger = Depends(require_ledger_edit_access),
    overwrite: bool = False,
) -> CategoryCounterpartyPreview:
    category = _category_for_counterparty_apply(session, ledger, category_id)
    period = BillingPeriod.from_date(business_today())
    following = period.next()
    return CategoryCounterpartyPreview(
        counterparty=CounterpartySummaryPublic.model_validate(category.counterparty),
        period_year=period.year,
        period_month=period.month,
        periods=[f"{item.year:04d}-{item.month:02d}" for item in (period, following)],
        count=len(
            _counterparty_apply_targets(session, category, period, overwrite=overwrite)
        ),
    )


@router.post(
    "/ledgers/{ledger_id}/categories/{category_id}/counterparty/obligations",
    response_model=Message,
)
def apply_category_counterparty(
    category_id: uuid.UUID,
    assignment: CategoryCounterpartyApply,
    session: SessionDep,
    actor: CurrentActionActor,
    ledger: Ledger = Depends(require_ledger_edit_access),
) -> Message:
    category = _category_for_counterparty_apply(session, ledger, category_id, lock=True)
    period = BillingPeriod.from_date(business_today())
    if category.counterparty_id != assignment.counterparty_id or (
        period.year,
        period.month,
    ) != (assignment.period_year, assignment.period_month):
        raise HTTPException(
            status_code=409, detail="Category or period changed. Reload the preview."
        )
    counterparty = category.counterparty
    if counterparty is None:
        raise HTTPException(
            status_code=409, detail="Assign a category counterparty first"
        )
    targets = _counterparty_apply_targets(
        session, category, period, overwrite=assignment.overwrite, lock=True
    )
    for obligation in targets:
        obligation_use_cases.assign_counterparty_with_audit(
            session=session,
            obligation=obligation,
            counterparty_id=assignment.counterparty_id,
            counterparty_name=counterparty.name,
            actor=actor,
        )
    session.commit()
    return Message(message=f"Counterparty applied to {len(targets)} obligations")


def _counterparty_summary_or_none(
    counterparty: Any,
) -> CounterpartySummaryPublic | None:
    if counterparty is None:
        return None
    return CounterpartySummaryPublic.model_validate(counterparty)


@router.get("/counterparties", response_model=CounterpartiesPublic)
def read_counterparties(
    session: SessionDep,
    _current_user: CurrentUser,
) -> CounterpartiesPublic:
    counterparties = counterparty_service.list_counterparties(session=session)
    return CounterpartiesPublic(
        data=[CounterpartyPublic.model_validate(item) for item in counterparties],
        count=len(counterparties),
    )


@router.get("/counterparties/search", response_model=CounterpartySearchPublic)
def search_counterparties(
    session: SessionDep,
    _current_user: CurrentUser,
    q: str = Query(default="", max_length=255),
    limit: int = Query(default=10, ge=1, le=50),
) -> CounterpartySearchPublic:
    counterparties = counterparty_service.search_counterparties(
        session=session, query=q, limit=limit
    )
    return CounterpartySearchPublic(
        items=[
            CounterpartySummaryPublic.model_validate(item) for item in counterparties
        ]
    )


@router.get("/counterparties/{counterparty_id}", response_model=CounterpartyPublic)
def read_counterparty(
    counterparty_id: uuid.UUID,
    session: SessionDep,
    _current_user: CurrentUser,
) -> CounterpartyPublic:
    try:
        counterparty = counterparty_service.get_counterparty(
            session=session, counterparty_id=counterparty_id
        )
    except counterparty_service.CounterpartyNotFoundError as caught_error:
        raise HTTPException(
            status_code=404, detail="Counterparty not found"
        ) from caught_error
    return CounterpartyPublic.model_validate(counterparty)


@router.post("/counterparties", response_model=CounterpartyPublic)
def create_counterparty(
    *,
    session: SessionDep,
    counterparty_in: CounterpartyCreate,
    _superuser: User = Depends(get_current_active_superuser),
) -> Any:
    try:
        counterparty = counterparty_service.create_counterparty(
            session=session, **counterparty_in.model_dump()
        )
    except counterparty_service.DuplicateCounterpartyError as caught_error:
        raise HTTPException(
            status_code=409, detail="Counterparty already exists"
        ) from caught_error
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return CounterpartyPublic.model_validate(counterparty)


@router.patch("/counterparties/{counterparty_id}", response_model=CounterpartyPublic)
def update_counterparty(
    *,
    counterparty_id: uuid.UUID,
    session: SessionDep,
    counterparty_in: CounterpartyUpdate,
    _superuser: User = Depends(get_current_active_superuser),
) -> Any:
    try:
        counterparty = counterparty_service.update_counterparty(
            session=session,
            counterparty_id=counterparty_id,
            **counterparty_in.model_dump(exclude_unset=True),
        )
    except counterparty_service.CounterpartyNotFoundError as caught_error:
        raise HTTPException(
            status_code=404, detail="Counterparty not found"
        ) from caught_error
    except counterparty_service.DuplicateCounterpartyError as caught_error:
        raise HTTPException(
            status_code=409, detail="Counterparty already exists"
        ) from caught_error
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return CounterpartyPublic.model_validate(counterparty)


@router.delete("/counterparties/{counterparty_id}", response_model=Message)
def delete_counterparty(
    *,
    counterparty_id: uuid.UUID,
    session: SessionDep,
    _superuser: User = Depends(get_current_active_superuser),
) -> Message:
    try:
        counterparty_service.delete_counterparty(
            session=session, counterparty_id=counterparty_id
        )
    except counterparty_service.CounterpartyNotFoundError as caught_error:
        raise HTTPException(
            status_code=404, detail="Counterparty not found"
        ) from caught_error
    except counterparty_service.CounterpartyInUseError as caught_error:
        raise HTTPException(
            status_code=409, detail="Counterparty is in use"
        ) from caught_error
    return Message(message="Counterparty deleted")


@router.patch(
    "/ledgers/{ledger_id}/categories/{category_id}/counterparty",
    response_model=CategoryPublic,
)
def assign_category_counterparty(
    *,
    category_id: uuid.UUID,
    assignment: CounterpartyAssignment,
    session: SessionDep,
    ledger: Ledger = Depends(require_ledger_edit_access),
) -> CategoryPublic:
    category = session.scalar(
        select(Category).where(
            Category.id == category_id,
            Category.ledger_id == ledger.id,
        )
    )
    if category is None:
        raise HTTPException(status_code=404, detail="Category not found")
    if assignment.counterparty_id is not None:
        try:
            counterparty_service.get_counterparty(
                session=session, counterparty_id=assignment.counterparty_id
            )
        except counterparty_service.CounterpartyNotFoundError as caught_error:
            raise HTTPException(
                status_code=404, detail="Counterparty not found"
            ) from caught_error
    category.counterparty_id = assignment.counterparty_id
    session.commit()
    session.refresh(category)
    return CategoryPublic.model_validate(category)


@router.get(
    "/ledgers/{ledger_id}/obligations/{obligation_key}/counterparty",
    response_model=CounterpartySummaryPublic | None,
)
def read_obligation_counterparty(
    *,
    obligation_key: str,
    session: SessionDep,
    ledger: Ledger = Depends(require_ledger_view_access),
) -> CounterpartySummaryPublic | None:
    try:
        key = ObligationKey.parse(obligation_key)
        obligation = obligation_use_cases.get_obligation_by_key(
            session=session, ledger_id=ledger.id, key=key
        )
    except (ValueError, ObligationNotFoundError) as caught_error:
        raise HTTPException(
            status_code=404, detail="Obligation not found"
        ) from caught_error
    return _counterparty_summary_or_none(obligation.counterparty)


@router.patch(
    "/ledgers/{ledger_id}/obligations/{obligation_key}/counterparty",
    response_model=CounterpartySummaryPublic | None,
)
def assign_obligation_counterparty(
    *,
    obligation_key: str,
    assignment: CounterpartyAssignment,
    session: SessionDep,
    ledger: Ledger = Depends(require_ledger_edit_access),
) -> CounterpartySummaryPublic | None:
    try:
        key = ObligationKey.parse(obligation_key)
        obligation = obligation_use_cases.get_obligation_by_key(
            session=session, ledger_id=ledger.id, key=key
        )
    except (ValueError, ObligationNotFoundError) as caught_error:
        raise HTTPException(
            status_code=404, detail="Obligation not found"
        ) from caught_error
    if assignment.counterparty_id is not None:
        try:
            counterparty_service.get_counterparty(
                session=session, counterparty_id=assignment.counterparty_id
            )
        except counterparty_service.CounterpartyNotFoundError as caught_error:
            raise HTTPException(
                status_code=404, detail="Counterparty not found"
            ) from caught_error
    obligation.counterparty_id = assignment.counterparty_id
    session.commit()
    session.refresh(obligation)
    return _counterparty_summary_or_none(obligation.counterparty)
