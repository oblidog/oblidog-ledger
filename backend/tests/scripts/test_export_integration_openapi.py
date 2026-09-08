import json
from pathlib import Path

from scripts.export_integration_openapi import export_openapi


def test_export_openapi_uses_distinct_data_model_names(tmp_path: Path) -> None:
    output_path = tmp_path / "integration.json"

    export_openapi(output_path)

    spec = json.loads(output_path.read_text())
    schemas = spec["components"]["schemas"]

    assert spec["info"] == {
        "title": "Oblidog Integration API",
        "description": "Integration API for Oblidog Ledger.",
        "version": "1.0.0",
    }
    assert "title" not in schemas["CategoryDataRecordCreate"]["properties"]["data"]
    assert "title" not in schemas["CategoryDataRecordPublic"]["properties"]["data"]


def test_export_includes_registry_reporting_but_not_owner_management(
    tmp_path: Path,
) -> None:
    output_path = tmp_path / "integration.json"
    export_openapi(output_path)
    spec = json.loads(output_path.read_text())
    root = "/api/v1/integration/instances/{integration_key}"
    for path, method in [
        (root, "get"),
        (root + "/start", "post"),
        (root + "/finish", "post"),
    ]:
        operation = spec["paths"][path][method]
        assert operation["security"] == [{"IntegrationApiKey": []}]
        assert operation["responses"]["200"]["content"]["application/json"]["schema"][
            "$ref"
        ].endswith("/IntegrationPublic")
    assert all(path.startswith("/api/v1/integration/") for path in spec["paths"])
    schemas = spec["components"]["schemas"]
    assert set(schemas["IntegrationRunFinish"]["required"]) == {
        "run_id",
        "result",
        "changes_detected",
        "error",
    }
    assert "ledger_id" not in schemas["IntegrationRunStart"]["properties"]
    assert schemas["IntegrationRunStart"]["additionalProperties"] is False


def test_registry_conflicts_are_typed_in_both_openapi_contracts(tmp_path: Path) -> None:
    from app.main import app

    output_path = tmp_path / "integration.json"
    export_openapi(output_path)
    for spec in (app.openapi(), json.loads(output_path.read_text())):
        paths = [
            ("/api/v1/integration/instances/{integration_key}/start", "post"),
            ("/api/v1/integration/instances/{integration_key}/finish", "post"),
        ]
        if "/api/v1/ledgers/{ledger_id}/integrations" in spec["paths"]:
            paths.extend(
                [
                    ("/api/v1/ledgers/{ledger_id}/integrations", "post"),
                    (
                        "/api/v1/ledgers/{ledger_id}/integrations/{integration_id}",
                        "patch",
                    ),
                ]
            )
        for path, method in paths:
            schema = spec["paths"][path][method]["responses"]["409"]["content"][
                "application/json"
            ]["schema"]
            assert schema["$ref"] == "#/components/schemas/IntegrationConflictResponse"
        schemas = spec["components"]["schemas"]
        assert schemas["IntegrationConflictResponse"]["properties"]["detail"][
            "$ref"
        ].endswith("/IntegrationConflictDetail")
        assert schemas["IntegrationConflictDetail"]["properties"]["code"][
            "$ref"
        ].endswith("/IntegrationConflictCode")
        assert set(schemas["IntegrationConflictCode"]["enum"]) == {
            "duplicate_key",
            "revision_conflict",
            "integration_disabled",
            "run_in_progress",
            "run_conflict",
        }
        assert "current_deadline_at" in schemas["IntegrationPublic"]["required"]
