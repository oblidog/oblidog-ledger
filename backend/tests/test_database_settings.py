import pytest
from pydantic import ValidationError

from app.core.config import Settings


def _settings(**overrides: str) -> Settings:
    return Settings(
        _env_file=None,  # type: ignore[call-arg]
        PROJECT_NAME="Oblidog",
        FIRST_SUPERUSER="admin@example.com",
        FIRST_SUPERUSER_PASSWORD="test-password",
        **overrides,
    )


def test_neon_url_uses_psycopg_and_preserves_connection_options() -> None:
    settings = _settings(
        POSTGRES_URL=(
            "postgresql://demo:secret@ep-example-pooler.us-east-1.aws.neon.tech/"
            "neondb?sslmode=require&channel_binding=require"
        ),
        POSTGRES_SERVER="legacy-host",
        POSTGRES_USER="legacy-user",
    )

    assert str(settings.SQLALCHEMY_DATABASE_URI) == (
        "postgresql+psycopg://demo:secret@ep-example-pooler.us-east-1.aws.neon.tech/"
        "neondb?sslmode=require&channel_binding=require"
    )


def test_existing_self_hosted_database_configuration_still_works(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("POSTGRES_URL", raising=False)
    settings = _settings(
        POSTGRES_SERVER="db",
        POSTGRES_USER="oblidog",
        POSTGRES_PASSWORD="test-password",
        POSTGRES_DB="oblidog",
    )

    assert str(settings.SQLALCHEMY_DATABASE_URI) == (
        "postgresql+psycopg://oblidog:test-password@db:5432/oblidog"
    )


def test_database_connection_is_required(monkeypatch: pytest.MonkeyPatch) -> None:
    for name in ("POSTGRES_URL", "POSTGRES_SERVER", "POSTGRES_USER"):
        monkeypatch.delenv(name, raising=False)
    with pytest.raises(ValidationError, match="Set POSTGRES_URL"):
        _settings()
