"""Serialize hosted demo resets without running migrations."""

from __future__ import annotations

from urllib.parse import urlsplit

from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from app.core.db import engine
from app.demo_seed import DemoSeedResult, seed_demo

_RESET_LOCK_KEY = 278091


class InvalidDemoTargetError(ValueError):
    pass


class DemoResetBusyError(RuntimeError):
    pass


def validate_demo_target(
    database_url: str, expected_host: str | None, *, allow_pooler: bool = False
) -> None:
    """Fail closed if Vercel's demo endpoint was pointed at another database."""
    allowed_hosts = {expected_host}
    if allow_pooler and expected_host:
        allowed_hosts.add(expected_host.replace(".", "-pooler.", 1))
    try:
        parsed = urlsplit(database_url)
        if (
            not expected_host
            or not expected_host.endswith(".neon.tech")
            or "-pooler" in expected_host.split(".")[0]
            or parsed.scheme not in {"postgres", "postgresql", "postgresql+psycopg"}
            or parsed.hostname not in allowed_hosts
            or parsed.path != "/neondb"
            or not parsed.username
            or not parsed.password
            or parsed.fragment
        ):
            raise ValueError("wrong demo database")
        _ = parsed.port
    except ValueError as exc:
        raise InvalidDemoTargetError("Demo reset database guard failed") from exc


def reset_demo_data(
    *, password: str, database_url: str | None = None
) -> DemoSeedResult:
    """Keep the lock and all seed writes in one transaction until completion."""
    # The hosted reset uses Neon's direct URL. The normal API can keep its
    # pooled URL, while the advisory lock and seed share a direct transaction.
    reset_engine = engine
    if database_url is not None:
        direct_url = database_url.replace("postgres://", "postgresql+psycopg://", 1)
        direct_url = direct_url.replace("postgresql://", "postgresql+psycopg://", 1)
        reset_engine = create_engine(direct_url, pool_pre_ping=True)
    try:
        return _reset_with_engine(reset_engine, password=password)
    finally:
        if database_url is not None:
            reset_engine.dispose()


def _reset_with_engine(reset_engine, *, password: str) -> DemoSeedResult:
    with reset_engine.begin() as lock_connection:
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
