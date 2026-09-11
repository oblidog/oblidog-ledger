import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import (
    CurrentUser,
    SessionDep,
    require_capability,
    require_ledger_owner_access,
    require_ledger_view_access,
)
from app.core.capabilities import Capability
from app.models import IntegrationCredential, Ledger
from app.schemas.integrations import (
    IntegrationConflictDetail,
    IntegrationConflictResponse,
    IntegrationCreate,
    IntegrationCreated,
    IntegrationCredentialCreated,
    IntegrationCredentialPublic,
    IntegrationPublic,
    IntegrationsPublic,
    IntegrationUpdate,
)
from app.services import api_keys as credential_service
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
        raise HTTPException(
            status_code=409,
            detail=IntegrationConflictDetail(code=exc.code).model_dump(mode="json"),
        )
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
    response_model=IntegrationCreated,
    status_code=201,
    responses={
        409: {
            "model": IntegrationConflictResponse,
            "description": "Integration state or identity conflict",
        }
    },
)
def create_integration(
    *,
    session: SessionDep,
    data: IntegrationCreate,
    ledger: Ledger = Depends(require_ledger_owner_access),
    current_user: CurrentUser,
) -> IntegrationCreated:
    with integration_errors(session):
        item, credential, raw_key = use_cases.create_integration(
            session=session,
            ledger_id=ledger.id,
            created_by_user_id=current_user.id,
            data=data,
        )
        return IntegrationCreated(
            integration=use_cases.to_public(item),
            credential=IntegrationCredentialPublic.model_validate(credential),
            connection_key=raw_key,
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
    responses={
        409: {
            "model": IntegrationConflictResponse,
            "description": "Integration state or revision conflict",
        }
    },
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


@router.post(
    "/ledgers/{ledger_id}/integrations/{integration_id}/credentials",
    response_model=IntegrationCredentialCreated,
    status_code=201,
)
def generate_integration_credential(
    *,
    session: SessionDep,
    integration_id: uuid.UUID,
    ledger: Ledger = Depends(require_ledger_owner_access),
    current_user: CurrentUser,
) -> IntegrationCredentialCreated:
    with integration_errors(session):
        use_cases.get_integration(
            session=session, ledger_id=ledger.id, integration_id=integration_id
        )
        raw_key = credential_service.generate_api_key()
        credential = IntegrationCredential(
            integration_id=integration_id,
            created_by_user_id=current_user.id,
            key_hash=credential_service.hash_api_key(raw_key),
            key_prefix=credential_service.key_prefix(raw_key),
        )
        session.add(credential)
        session.commit()
        session.refresh(credential)
        return IntegrationCredentialCreated(
            credential=IntegrationCredentialPublic.model_validate(credential),
            connection_key=raw_key,
        )


@router.delete(
    "/ledgers/{ledger_id}/integrations/{integration_id}/credentials/{credential_id}",
    response_model=IntegrationCredentialPublic,
)
def revoke_integration_credential(
    *,
    session: SessionDep,
    integration_id: uuid.UUID,
    credential_id: uuid.UUID,
    ledger: Ledger = Depends(require_ledger_owner_access),
) -> IntegrationCredentialPublic:
    with integration_errors(session):
        use_cases.get_integration(
            session=session, ledger_id=ledger.id, integration_id=integration_id
        )
        credential = session.scalar(
            select(IntegrationCredential).where(
                IntegrationCredential.id == credential_id,
                IntegrationCredential.integration_id == integration_id,
            )
        )
        if credential is None:
            raise HTTPException(status_code=404, detail="Connection key not found")
        if credential.revoked_at is None:
            credential.revoked_at = datetime.now(UTC)
            session.commit()
            session.refresh(credential)
        return IntegrationCredentialPublic.model_validate(credential)
