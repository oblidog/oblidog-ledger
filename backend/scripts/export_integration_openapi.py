from __future__ import annotations

import json
from pathlib import Path

from fastapi import FastAPI
from fastapi.routing import APIRoute

from app.api.routes.integration import router as integration_router
from app.core.config import settings

DATA_RECORD_SCHEMA_NAMES = (
    "IntegrationCategoryDataRecordCreate",
    "CategoryDataRecordPublic",
)


def custom_generate_unique_id(route: APIRoute) -> str:
    return f"{route.tags[0]}-{route.name}"


def build_integration_app() -> FastAPI:
    app = FastAPI(
        title="Oblidog Integration API",
        description="Integration API for Oblidog Ledger.",
        version="1.0.0",
        generate_unique_id_function=custom_generate_unique_id,
    )
    app.include_router(integration_router, prefix=settings.API_V1_STR)
    return app


def export_openapi(output_path: Path) -> None:
    app = build_integration_app()
    spec = app.openapi()
    schemas = spec["components"]["schemas"]

    # Pydantic assigns both inline dict fields the generic title "Data".  That
    # makes openapi-python-client generate colliding model names, so leave these
    # schemas untitled and let the client generator derive parent-scoped names.
    for schema_name in DATA_RECORD_SCHEMA_NAMES:
        schemas[schema_name]["properties"]["data"].pop("title", None)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps(spec, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def main() -> None:
    repo_root = Path(__file__).resolve().parents[2]
    output_path = repo_root / "openapi" / "integration.json"
    export_openapi(output_path)
    print(f"Exported integration OpenAPI schema to {output_path}")  # noqa: T201


if __name__ == "__main__":
    main()
