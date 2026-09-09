import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query

from app.api.deps import CurrentUser, SessionDep, get_current_active_superuser
from app.models import User
from app.schemas import (
    CounterpartiesPublic,
    CounterpartyCreate,
    CounterpartyPublic,
    CounterpartySearchPublic,
    CounterpartySummaryPublic,
    CounterpartyUpdate,
    Message,
)
from app.services import counterparties as counterparty_service

router = APIRouter(prefix="/counterparties", tags=["counterparties"])


@router.get("", response_model=CounterpartiesPublic)
def read_counterparties(
    session: SessionDep,
    _current_user: CurrentUser,
) -> CounterpartiesPublic:
    counterparties = counterparty_service.list_counterparties(session=session)
    return CounterpartiesPublic(
        data=[CounterpartyPublic.model_validate(item) for item in counterparties],
        count=len(counterparties),
    )


@router.get("/search", response_model=CounterpartySearchPublic)
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


@router.get("/{counterparty_id}", response_model=CounterpartyPublic)
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


@router.post("", response_model=CounterpartyPublic)
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


@router.patch("/{counterparty_id}", response_model=CounterpartyPublic)
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
            **counterparty_in.model_dump(),
        )
    except counterparty_service.CounterpartyNotFoundError:
        raise HTTPException(status_code=404, detail="Counterparty not found")
    except counterparty_service.DuplicateCounterpartyError:
        raise HTTPException(status_code=409, detail="Counterparty already exists")
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    return CounterpartyPublic.model_validate(counterparty)


@router.delete("/{counterparty_id}", response_model=Message)
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
