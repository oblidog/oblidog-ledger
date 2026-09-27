"""Run deliberate migration or initialization against the dedicated Neon demo DB."""

from __future__ import annotations

import argparse
import logging
import os
import secrets
import subprocess
from urllib.parse import urlsplit

DEMO_DATABASE = "neondb"
DEMO_ADMIN_EMAIL = "demo-admin@oblidog.com"
logger = logging.getLogger(__name__)


def validate_target(raw_url: str, expected_host: str) -> None:
    try:
        url = urlsplit(raw_url)
        database = url.path.removeprefix("/")
        if (
            url.scheme not in {"postgres", "postgresql", "postgresql+psycopg"}
            or not expected_host.endswith(".neon.tech")
            or "-pooler" in expected_host.split(".")[0]
            or url.hostname != expected_host
            or database != DEMO_DATABASE
            or not url.username
            or not url.password
            or url.fragment
        ):
            raise ValueError("unexpected Neon target")
        # Accessing port catches malformed URL values before any DB operation.
        _ = url.port
    except ValueError as exc:
        raise ValueError(
            "Expected the dedicated, unpooled oblidog-demo Neon URL"
        ) from exc


def run_lifecycle(action: str, confirmation: str = "") -> None:
    if action not in {"migrate", "initialize"}:
        raise ValueError("Action must be migrate or initialize")
    if action == "initialize" and confirmation != "replace-demo-ledger":
        raise ValueError("Initialization requires confirmation: replace-demo-ledger")

    if os.environ.get("GITHUB_REF") != "refs/heads/dev":
        raise ValueError("Run this workflow from the dev branch only")

    database_url = os.environ.get("DEMO_POSTGRES_URL", "")
    validate_target(database_url, os.environ.get("DEMO_NEON_HOST", ""))
    admin_password = os.environ.get("DEMO_FIRST_SUPERUSER_PASSWORD", "")
    demo_password = os.environ.get("DEMO_USER_PASSWORD", "")
    if len(admin_password) < 8 or len(demo_password) < 8:
        raise ValueError(
            "Demo admin and user passwords must each have at least 8 characters"
        )

    # Never inherit a self-hosted database URL or external integration settings.
    environment = {
        key: value
        for key, value in os.environ.items()
        if not key.startswith(("POSTGRES_", "PG", "SMTP_", "DROPBOX_"))
        and key not in {"DATABASE_URL", "UV_ENV_FILE", "TEST_SQLALCHEMY_DATABASE_URI"}
    }
    environment.update(
        POSTGRES_URL=database_url,
        PROJECT_NAME="Oblidog Demo",
        ENVIRONMENT="demo",
        FIRST_SUPERUSER=DEMO_ADMIN_EMAIL,
        FIRST_SUPERUSER_PASSWORD=admin_password,
        DEMO_USER_PASSWORD=demo_password,
        SECRET_KEY=secrets.token_urlsafe(32),
    )

    commands = [("alembic", "upgrade", "head")]
    if action == "initialize":
        commands.extend(
            [("python", "-m", "app.initial_data"), ("python", "-m", "app.demo_seed")]
        )
    logger.info("Target: configured Neon demo database; action: %s", action)
    for command in commands:
        logger.info("Running: %s", " ".join(command))
        subprocess.run(["uv", "run", "--locked", *command], env=environment, check=True)
    logger.info("Demo %s completed", action)


def main() -> None:
    logging.basicConfig(level=logging.INFO)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["migrate", "initialize"])
    parser.add_argument("--confirmation", default="")
    args = parser.parse_args()
    try:
        run_lifecycle(args.action, args.confirmation)
    except ValueError as exc:
        parser.error(str(exc))


if __name__ == "__main__":
    main()
