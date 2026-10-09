import pytest
from pydantic import ValidationError

from app.core.config import Settings


@pytest.fixture
def base_settings(monkeypatch: pytest.MonkeyPatch) -> dict[str, str]:
    monkeypatch.delenv("SECRET_KEY", raising=False)
    return {
        "PROJECT_NAME": "Test",
        "POSTGRES_SERVER": "localhost",
        "POSTGRES_USER": "test",
        "FIRST_SUPERUSER": "admin@example.com",
        "FIRST_SUPERUSER_PASSWORD": "test-password",
    }


def test_missing_secret_key_fails(base_settings: dict[str, str]) -> None:
    with pytest.raises(ValidationError, match="SECRET_KEY"):
        Settings(_env_file=None, **base_settings)  # type: ignore[arg-type]


@pytest.mark.parametrize("secret", ["", "   "])
def test_empty_secret_key_fails(
    base_settings: dict[str, str], secret: str
) -> None:
    with pytest.raises(ValidationError, match="SECRET_KEY"):
        Settings(_env_file=None, SECRET_KEY=secret, **base_settings)  # type: ignore[arg-type]


def test_explicit_secret_is_stable(base_settings: dict[str, str]) -> None:
    first = Settings(_env_file=None, SECRET_KEY="configured-secret", **base_settings)  # type: ignore[arg-type]
    second = Settings(_env_file=None, SECRET_KEY="configured-secret", **base_settings)  # type: ignore[arg-type]
    assert first.SECRET_KEY == second.SECRET_KEY == "configured-secret"


def test_placeholder_secret_warns_locally(base_settings: dict[str, str]) -> None:
    with pytest.warns(UserWarning, match="SECRET_KEY"):
        Settings(_env_file=None, SECRET_KEY="changethis", **base_settings)  # type: ignore[arg-type]


@pytest.mark.parametrize("environment", ["staging", "demo", "production"])
def test_placeholder_secret_rejected_outside_local(
    base_settings: dict[str, str], environment: str
) -> None:
    with pytest.raises(ValidationError, match="SECRET_KEY"):
        Settings(
            _env_file=None,
            SECRET_KEY="changethis",
            ENVIRONMENT=environment,
            **base_settings,
        )  # type: ignore[arg-type]
