"""Serialize hosted demo resets without running migrations."""

from __future__ import annotations

from urllib.parse import urlsplit

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.db import engine
from app.demo_seed import DemoSeedResult, seed_demo

_RESET_LOCK_KEY = 278091


class InvalidDemoTargetError(ValueError):
    pass


class DemoResetBusyError(RuntimeError):
    pass


def validate_demo_target(database_url: str, expected_host: str | None) -> None:
    """Fail closed if Vercel's demo endpoint was pointed at another database."""
    try:
        parsed = urlsplit(database_url)
        if (
            not expected_host
            or not expected_host.endswith(".neon.tech")
            or "-pooler" in expected_host.split(".")[0]
            or parsed.scheme not in {"postgres", "postgresql", "postgresql+psycopg"}
            or parsed.hostname != expected_host
            or parsed.path != "/neondb"
            or not parsed.username
            or not parsed.password
            or parsed.fragment
        ):
            raise ValueError("wrong demo database")
        _ = parsed.port
    except ValueError as exc:
        raise InvalidDemoTargetError("Demo reset database guard failed") from exc


def reset_demo_data(*, password: str) -> DemoSeedResult:
    """Keep the lock and all seed writes in one transaction until completion."""
    with engine.begin() as lock_connection:
        acquired = lock_connection.scalar(
            text("SELECT pg_try_advisory_xact_lock(:key)"), {"key": _RESET_LOCK_KEY}
        )
        if not acquired:
            raise DemoResetBusyError("A demo reset is already running")
        # The canonical seeder and its use cases call Session.commit() repeatedly.
        # Savepoints keep those commits inside the outer transaction, so an error
        # restores the previous ledger instead of exposing a partial reset.
        with Session(
            bind=lock_connection, join_transaction_mode="create_savepoint"
        ) as session:
            return seed_demo(session=session, password=password)
