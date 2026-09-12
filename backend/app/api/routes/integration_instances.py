from fastapi import APIRouter, Depends

from app.api.deps import ApiContext, require_capability, require_scope
from app.api.routes.integrations import integration_errors
from app.core.capabilities import Capability
from app.schemas.integrations import (
    IntegrationConflictResponse,
    IntegrationContextCategoryPublic,
    IntegrationContextIntegrationPublic,
    IntegrationContextPublic,
    IntegrationPublic,
    IntegrationRunFinish,
    IntegrationRunStart,
)
from app.use_cases import integrations as use_cases

router = APIRouter(
    dependencies=[Depends(require_capability(Capability.INTEGRATIONS))],
)


@router.get("/context", response_model=IntegrationContextPublic)
def read_integration_context(
    context: ApiContext = Depends(require_scope("ledger:read")),
) -> IntegrationContextPublic:
    return IntegrationContextPublic(
        integration=IntegrationContextIntegrationPublic(
            id=context.integration.id,
            name=context.integration.name,
            enabled=context.integration.enabled,
            revision=context.integration.revision,
        ),
        category=IntegrationContextCategoryPublic(
            id=context.category.id,
            code=context.category.code,
            name=context.category.name,
        ),
    )


@router.post(
    "/runs/start",
    response_model=IntegrationPublic,
    responses={
        409: {
            "model": IntegrationConflictResponse,
            "description": "Integration run conflict",
        }
    },
)
def start_integration_run(
    data: IntegrationRunStart,
    context: ApiContext = Depends(require_scope("ledger:write")),
) -> IntegrationPublic:
    with integration_errors(context.session):
        return use_cases.to_public(
            use_cases.start_run(
                session=context.session,
                integration_id=context.integration.id,
                data=data,
            )
        )


@router.post(
    "/runs/finish",
    response_model=IntegrationPublic,
    responses={
        409: {
            "model": IntegrationConflictResponse,
            "description": "Integration run conflict",
        }
    },
)
def finish_integration_run(
    data: IntegrationRunFinish,
    context: ApiContext = Depends(require_scope("ledger:write")),
) -> IntegrationPublic:
    with integration_errors(context.session):
        return use_cases.to_public(
            use_cases.finish_run(
                session=context.session,
                integration_id=context.integration.id,
                data=data,
            )
        )
