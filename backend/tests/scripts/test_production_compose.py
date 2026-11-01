from pathlib import Path

import yaml

REPOSITORY_ROOT = Path(__file__).resolve().parents[3]


def test_production_compose_includes_the_system_run_scheduler() -> None:
    compose = yaml.safe_load((REPOSITORY_ROOT / "compose.production.yml").read_text())
    services = compose["services"]
    scheduler = services["scheduler"]

    assert scheduler["image"] == services["backend"]["image"]
    assert scheduler["depends_on"]["prestart"] == {
        "condition": "service_completed_successfully"
    }
    assert scheduler["env_file"] == [".env"]
    assert scheduler["command"] == ["/app/backend/scripts/system-run-scheduler.sh"]
    assert scheduler["networks"] == ["firefly_net"]

    environment = scheduler["environment"]
    assert (
        "POSTGRES_SERVER=${POSTGRES_SERVER?Set POSTGRES_SERVER in .env}" in environment
    )
    assert "POSTGRES_PORT=${POSTGRES_PORT?Set POSTGRES_PORT in .env}" in environment
    assert "POSTGRES_DB=${POSTGRES_DB?Set POSTGRES_DB in .env}" in environment
    assert "POSTGRES_USER=${POSTGRES_USER?Set POSTGRES_USER in .env}" in environment
    assert (
        "POSTGRES_PASSWORD=${POSTGRES_PASSWORD?Set POSTGRES_PASSWORD in .env}"
        in environment
    )
    assert "SYSTEM_RUN_SCHEDULE=${SYSTEM_RUN_SCHEDULE:-5 0 * * *}" in environment
    assert "SYSTEM_RUN_TIMEZONE=${SYSTEM_RUN_TIMEZONE:-Europe/Warsaw}" in environment
    assert (
        "SYSTEM_RUN_STALE_AFTER_MINUTES=${SYSTEM_RUN_STALE_AFTER_MINUTES:-120}"
        in environment
    )
    assert (
        "SYSTEM_RUN_TIMEOUT_SECONDS=${SYSTEM_RUN_TIMEOUT_SECONDS:-3600}" in environment
    )
    assert "TZ=${SYSTEM_RUN_TIMEZONE:-Europe/Warsaw}" in environment


def test_production_environment_template_documents_system_run_settings() -> None:
    variables = {}
    for line in (REPOSITORY_ROOT / ".env.production.example").read_text().splitlines():
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", maxsplit=1)
            variables[key] = value

    assert variables["SYSTEM_RUN_SCHEDULE"] == "5 0 * * *"
    assert variables["SYSTEM_RUN_TIMEZONE"] == "Europe/Warsaw"
    assert variables["SYSTEM_RUN_TIMEOUT_SECONDS"] == "3600"
    assert variables["SYSTEM_RUN_STALE_AFTER_MINUTES"] == "120"
