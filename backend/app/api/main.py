from fastapi import APIRouter, Depends

from app.api.deps import enforce_demo_request_capabilities
from app.api.routes import (
    analytics,
    categories,
    category_data_schemas,
    integration,
    integrations,
    ledgers,
    legacy_import,
    login,
    obligations,
    system_runs,
    users,
    utils,
)

api_router = APIRouter(dependencies=[Depends(enforce_demo_request_capabilities)])
api_router.include_router(login.router)
api_router.include_router(ledgers.router)
api_router.include_router(analytics.router)
api_router.include_router(categories.router)
api_router.include_router(category_data_schemas.router)
api_router.include_router(integration.router)
api_router.include_router(integrations.router)
api_router.include_router(legacy_import.router)
api_router.include_router(obligations.router)
api_router.include_router(system_runs.router)
api_router.include_router(users.router)
api_router.include_router(utils.router)
