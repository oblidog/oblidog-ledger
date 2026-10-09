import pytest
from pydantic import ValidationError
from pydantic_settings import SettingsConfigDict

from app.core.config import Settings


class IsolatedSettings(Settings):
    model_config = SettingsConfigDict(env_file=None, env_prefix="TEST_475_")


@pytest.fixture
def base_settings(monkeypatch: pytest.MonkeyPatch) -> dict[str, str]:
    monkeypatch.delenv("TEST_475_SECRET_KEY", raising=False)
    return {
        "PROJECT_NAME": "Test",
        "POSTGRES_SERVER": "localhost",
        "POSTGRES_USER": "test",
        "FIRST_SUPERUSER": "admin@example.com",
        "FIRST_SUPERUSER_PASSWORD": "test-password",
    }


def make_settings(
    base_settings: dict[str, str],
    *,
    secret: str | None = None,
    environment: str = "local",
) -> Settings:
    values = dict(base_settings)
    values["ENVIRONMENT"] = environment
    if secret is not None:
        values["SECRET_KEY"] = secret
    return IsolatedSettings.model_validate(values)


def test_missing_secret_key_fails(base_settings: dict[str, str]) -> None:
    with pytest.raises(ValidationError, match="SECRET_KEY"):
        make_settings(base_settings)


@pytest.mark.parametrize("secret", ["", "   "])
def test_empty_secret_key_fails(base_settings: dict[str, str], secret: str) -> None:
    with pytest.raises(ValidationError, match="SECRET_KEY"):
        make_settings(base_settings, secret=secret)


def test_explicit_secret_is_stable(base_settings: dict[str, str]) -> None:
    first = make_settings(base_settings, secret="configured-secret")
    second = make_settings(base_settings, secret="configured-secret")
    assert first.SECRET_KEY == second.SECRET_KEY == "configured-secret"


def test_placeholder_secret_warns_locally(base_settings: dict[str, str]) -> None:
    with pytest.warns(UserWarning, match="SECRET_KEY"):
        make_settings(base_settings, secret="changethis")


@pytest.mark.parametrize("environment", ["staging", "demo", "production"])
def test_placeholder_secret_rejected_outside_local(
    base_settings: dict[str, str], environment: str
) -> None:
    with pytest.raises(ValidationError, match="SECRET_KEY"):
        make_settings(base_settings, secret="changethis", environment=environment)
