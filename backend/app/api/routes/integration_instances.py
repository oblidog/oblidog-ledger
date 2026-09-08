from fastapi import APIRouter, Depends

from app.api.deps import ApiContext, require_capability, require_scope
from app.api.routes.integrations import integration_errors
from app.core.capabilities import Capability
from app.schemas.integrations import (
    IntegrationConflictResponse,
    IntegrationKey,
    IntegrationPublic,
    IntegrationRunFinish,
    IntegrationRunStart,
)
from app.use_cases import integrations as use_cases

router = APIRouter(
    prefix="/instances",
    dependencies=[Depends(require_capability(Capability.INTEGRATIONS))],
)


@router.get("/{integration_key}", response_model=IntegrationPublic)
def read_integration_instance(
    integration_key: IntegrationKey,
    context: ApiContext = Depends(require_scope("ledger:read")),
) -> IntegrationPublic:
    with integration_errors(context.session):
        return use_cases.to_public(
            use_cases.get_integration(
                session=context.session,
                ledger_id=context.ledger.id,
                key=integration_key,
            )
        )


@router.post(
    "/{integration_key}/start",
    response_model=IntegrationPublic,
    responses={
        409: {
            "model": IntegrationConflictResponse,
            "description": "Integration run conflict",
        }
    },
)
def start_integration_run(
    integration_key: IntegrationKey,
    data: IntegrationRunStart,
    context: ApiContext = Depends(require_scope("ledger:write")),
) -> IntegrationPublic:
    with integration_errors(context.session):
        return use_cases.to_public(
            use_cases.start_run(
                session=context.session,
                ledger_id=context.ledger.id,
                key=integration_key,
                data=data,
            )
        )


@router.post(
    "/{integration_key}/finish",
    response_model=IntegrationPublic,
    responses={
        409: {
            "model": IntegrationConflictResponse,
            "description": "Integration run conflict",
        }
    },
)
def finish_integration_run(
    integration_key: IntegrationKey,
    data: IntegrationRunFinish,
    context: ApiContext = Depends(require_scope("ledger:write")),
) -> IntegrationPublic:
    with integration_errors(context.session):
        return use_cases.to_public(
            use_cases.finish_run(
                session=context.session,
                ledger_id=context.ledger.id,
                key=integration_key,
                data=data,
            )
        )
