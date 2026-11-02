from fastapi import APIRouter, Depends

from app.api.deps import enforce_demo_request_capabilities, enforce_demo_write_policy
from app.api.routes import (
    analytics,
    categories,
    category_data_csv,
    category_data_schemas,
    counterparties,
    demo_reset,
    integration,
    integrations,
    ledgers,
    login,
    obligations,
    system_runs,
    user_invitations,
    users,
    utils,
)
from app.schemas.api_errors import ApiErrorResponse

api_router = APIRouter(
    responses={
        status: {
            "model": ApiErrorResponse,
            "description": "Application error with stable code; legacy detail is unchanged",
        }
        for status in (400, 401, 403, 404, 409, 413, 422, 500, 503)
    },
    dependencies=[
        Depends(enforce_demo_request_capabilities),
        Depends(enforce_demo_write_policy),
    ],
)
api_router.include_router(login.router)
api_router.include_router(ledgers.router)
api_router.include_router(analytics.router)
api_router.include_router(categories.router)
api_router.include_router(category_data_csv.router)
api_router.include_router(category_data_schemas.router)
api_router.include_router(counterparties.router)
api_router.include_router(demo_reset.router)
api_router.include_router(integration.router)
api_router.include_router(integrations.router)
api_router.include_router(obligations.router)
api_router.include_router(system_runs.router)
api_router.include_router(user_invitations.admin_router)
api_router.include_router(user_invitations.public_router)
api_router.include_router(users.router)
api_router.include_router(utils.router)
