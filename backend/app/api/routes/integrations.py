import uuid
from collections.abc import Iterator
from contextlib import contextmanager

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.api.deps import (
    SessionDep,
    require_capability,
    require_ledger_owner_access,
    require_ledger_view_access,
)
from app.core.capabilities import Capability
from app.models import Ledger
from app.schemas.integrations import (
    IntegrationCreate,
    IntegrationPublic,
    IntegrationsPublic,
    IntegrationUpdate,
)
from app.use_cases import integrations as use_cases

router = APIRouter(
    tags=["integrations"],
    dependencies=[Depends(require_capability(Capability.INTEGRATIONS))],
)


@contextmanager
def integration_errors(session: Session) -> Iterator[None]:
    try:
        yield
    except (
        use_cases.IntegrationNotFoundError,
        use_cases.IntegrationCategoryNotFoundError,
    ):
        session.rollback()
        raise HTTPException(status_code=404, detail="Integration or category not found")
    except use_cases.IntegrationConflictError as exc:
        session.rollback()
        raise HTTPException(status_code=409, detail={"code": exc.code})
    except use_cases.IntegrationLimitsError:
        session.rollback()
        raise HTTPException(
            status_code=422,
            detail="run_timeout_seconds must be less than stale_after_seconds",
        )


@router.get("/ledgers/{ledger_id}/integrations", response_model=IntegrationsPublic)
def list_integrations(
    *,
    session: SessionDep,
    ledger: Ledger = Depends(require_ledger_view_access),
    limit: int = Query(default=100, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
) -> IntegrationsPublic:
    items, count = use_cases.list_integrations(
        session=session, ledger_id=ledger.id, limit=limit, offset=offset
    )
    return IntegrationsPublic(
        data=[use_cases.to_public(item) for item in items], count=count
    )


@router.post(
    "/ledgers/{ledger_id}/integrations",
    response_model=IntegrationPublic,
    status_code=201,
)
def create_integration(
    *,
    session: SessionDep,
    data: IntegrationCreate,
    ledger: Ledger = Depends(require_ledger_owner_access),
) -> IntegrationPublic:
    with integration_errors(session):
        return use_cases.to_public(
            use_cases.create_integration(
                session=session, ledger_id=ledger.id, data=data
            )
        )


@router.get(
    "/ledgers/{ledger_id}/integrations/{integration_id}",
    response_model=IntegrationPublic,
)
def get_integration(
    *,
    session: SessionDep,
    integration_id: uuid.UUID,
    ledger: Ledger = Depends(require_ledger_view_access),
) -> IntegrationPublic:
    with integration_errors(session):
        return use_cases.to_public(
            use_cases.get_integration(
                session=session, ledger_id=ledger.id, integration_id=integration_id
            )
        )


@router.patch(
    "/ledgers/{ledger_id}/integrations/{integration_id}",
    response_model=IntegrationPublic,
)
def update_integration(
    *,
    session: SessionDep,
    integration_id: uuid.UUID,
    data: IntegrationUpdate,
    ledger: Ledger = Depends(require_ledger_owner_access),
) -> IntegrationPublic:
    with integration_errors(session):
        return use_cases.to_public(
            use_cases.update_integration(
                session=session,
                ledger_id=ledger.id,
                integration_id=integration_id,
                data=data,
            )
        )
