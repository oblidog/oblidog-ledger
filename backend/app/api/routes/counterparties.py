import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select

from app.api.deps import (
    CurrentUser,
    SessionDep,
    get_current_active_superuser,
    require_ledger_edit_access,
    require_ledger_view_access,
)
from app.domain import ObligationKey
from app.models import Category, Ledger, User
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
from app.services import counterparties as counterparty_service
from app.use_cases import obligations as obligation_use_cases
from app.use_cases.exceptions import ObligationNotFoundError

router = APIRouter(tags=["counterparties"])


def _counterparty_summary_or_none(counterparty: Any) -> CounterpartySummaryPublic | None:
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
        items=[CounterpartySummaryPublic.model_validate(item) for item in counterparties]
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
    except counterparty_service.CounterpartyNotFoundError:
        raise HTTPException(status_code=404, detail="Counterparty not found")
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
    except counterparty_service.DuplicateCounterpartyError:
        raise HTTPException(status_code=409, detail="Counterparty already exists")
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
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
    except counterparty_service.CounterpartyNotFoundError:
        raise HTTPException(status_code=404, detail="Counterparty not found")
    except counterparty_service.DuplicateCounterpartyError:
        raise HTTPException(status_code=409, detail="Counterparty already exists")
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
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
    except counterparty_service.CounterpartyNotFoundError:
        raise HTTPException(status_code=404, detail="Counterparty not found")
    except counterparty_service.CounterpartyInUseError:
        raise HTTPException(status_code=409, detail="Counterparty is in use")
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
        except counterparty_service.CounterpartyNotFoundError:
            raise HTTPException(status_code=404, detail="Counterparty not found")
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
    except (ValueError, ObligationNotFoundError):
        raise HTTPException(status_code=404, detail="Obligation not found")
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
    except (ValueError, ObligationNotFoundError):
        raise HTTPException(status_code=404, detail="Obligation not found")
    if assignment.counterparty_id is not None:
        try:
            counterparty_service.get_counterparty(
                session=session, counterparty_id=assignment.counterparty_id
            )
        except counterparty_service.CounterpartyNotFoundError:
            raise HTTPException(status_code=404, detail="Counterparty not found")
    obligation.counterparty_id = assignment.counterparty_id
    session.commit()
    session.refresh(obligation)
    return _counterparty_summary_or_none(obligation.counterparty)
