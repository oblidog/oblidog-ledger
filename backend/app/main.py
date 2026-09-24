from importlib.metadata import version
from pathlib import Path

import sentry_sdk
from fastapi import FastAPI, Request
from fastapi.openapi.docs import get_redoc_html, get_swagger_ui_html
from fastapi.responses import FileResponse
from fastapi.routing import APIRoute
from starlette.middleware.cors import CORSMiddleware

from app.api.main import api_router
from app.core.browser_auth import CSRF_HEADER_NAME, BrowserSessionSecurityMiddleware
from app.core.config import settings


def custom_generate_unique_id(route: APIRoute) -> str:
    return f"{route.tags[0]}-{route.name}"


# Demo is a public deployed environment, so it reports errors like staging and
# production whenever a dedicated SENTRY_DSN is configured. Local stays silent.
if settings.SENTRY_DSN and settings.ENVIRONMENT != "local":
    sentry_sdk.init(dsn=str(settings.SENTRY_DSN), enable_tracing=True)

app = FastAPI(
    title=settings.PROJECT_NAME,
    description="API for Oblidog.",
    version=version("app"),
    openapi_url=f"{settings.API_V1_STR}/openapi.json",
    docs_url=None,
    redoc_url=None,
    generate_unique_id_function=custom_generate_unique_id,
)


def docs_favicon(_request: Request) -> FileResponse:
    return FileResponse(
        Path(__file__).parent / "assets" / "oblidog-icon.svg",
        media_type="image/svg+xml",
    )


def swagger_ui(_request: Request):
    return get_swagger_ui_html(
        openapi_url=f"{settings.API_V1_STR}/openapi.json",
        title=f"{app.title} - Swagger UI",
        swagger_favicon_url="/docs/favicon.svg",
    )


def redoc(_request: Request):
    return get_redoc_html(
        openapi_url=f"{settings.API_V1_STR}/openapi.json",
        title=f"{app.title} - ReDoc",
        redoc_favicon_url="/docs/favicon.svg",
    )


app.add_route("/docs/favicon.svg", docs_favicon)
app.add_route("/docs", swagger_ui)
app.add_route("/redoc", redoc)


app.add_middleware(BrowserSessionSecurityMiddleware)

# Set all CORS enabled origins
if settings.all_cors_origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.all_cors_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=[
            "Accept",
            "Authorization",
            "Content-Type",
            CSRF_HEADER_NAME,
        ],
        expose_headers=[CSRF_HEADER_NAME],
    )

app.include_router(api_router, prefix=settings.API_V1_STR)
