import secrets
import uuid
import warnings
from pathlib import Path
from typing import Annotated, Any, Literal, Self

from pydantic import (
    AnyUrl,
    BeforeValidator,
    EmailStr,
    HttpUrl,
    PostgresDsn,
    computed_field,
    model_validator,
)
from pydantic_settings import BaseSettings, SettingsConfigDict

from app.domain.system_run import TaskRunMode


def parse_cors(v: Any) -> list[str] | str:
    if isinstance(v, str) and not v.startswith("["):
        return [i.strip() for i in v.split(",") if i.strip()]
    elif isinstance(v, list | str):
        return v
    raise ValueError(v)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        # Use top level .env file (one level above ./backend/)
        env_file="../.env",
        env_ignore_empty=True,
        extra="ignore",
    )
    API_V1_STR: str = "/api/v1"
    SECRET_KEY: str = secrets.token_urlsafe(32)
    # 60 minutes * 24 hours * 8 days = 8 days
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 8
    SESSION_COOKIE_NAME: str = "oblidog_session"
    SESSION_COOKIE_SECURE: bool | None = None
    SESSION_COOKIE_SAMESITE: Literal["lax", "strict", "none"] = "lax"
    FRONTEND_HOST: str = "http://localhost:5173"
    ENVIRONMENT: Literal["local", "staging", "demo", "production"] = "local"

    BACKEND_CORS_ORIGINS: Annotated[
        list[AnyUrl] | str, BeforeValidator(parse_cors)
    ] = []

    @computed_field  # type: ignore[prop-decorator]
    @property
    def all_cors_origins(self) -> list[str]:
        return [str(origin).rstrip("/") for origin in self.BACKEND_CORS_ORIGINS] + [
            self.FRONTEND_HOST.rstrip("/")
        ]

    @computed_field  # type: ignore[prop-decorator]
    @property
    def session_cookie_secure(self) -> bool:
        if self.SESSION_COOKIE_SECURE is not None:
            return self.SESSION_COOKIE_SECURE
        return self.ENVIRONMENT in {"staging", "production"}

    PROJECT_NAME: str
    SENTRY_DSN: HttpUrl | None = None
    # Marketplace integrations provide a complete URL; self-hosted deployments
    # continue to use the individual POSTGRES_* settings below.
    POSTGRES_URL: PostgresDsn | None = None
    # The reset endpoint requires an independently configured demo target.
    DEMO_NEON_HOST: str | None = None
    CRON_SECRET: str | None = None
    POSTGRES_SERVER: str | None = None
    POSTGRES_PORT: int = 5432
    POSTGRES_USER: str | None = None
    POSTGRES_PASSWORD: str = ""
    POSTGRES_DB: str = ""

    @computed_field  # type: ignore[prop-decorator]
    @property
    def SQLALCHEMY_DATABASE_URI(self) -> PostgresDsn:
        if self.POSTGRES_URL is not None:
            url = str(self.POSTGRES_URL)
            if url.startswith("postgresql://"):
                url = url.replace("postgresql://", "postgresql+psycopg://", 1)
            elif url.startswith("postgres://"):
                url = url.replace("postgres://", "postgresql+psycopg://", 1)
            return PostgresDsn(url)

        assert self.POSTGRES_USER is not None
        assert self.POSTGRES_SERVER is not None
        return PostgresDsn.build(
            scheme="postgresql+psycopg",
            username=self.POSTGRES_USER,
            password=self.POSTGRES_PASSWORD,
            host=self.POSTGRES_SERVER,
            port=self.POSTGRES_PORT,
            path=self.POSTGRES_DB,
        )

    TEST_SQLALCHEMY_DATABASE_URI: PostgresDsn | None = None

    SMTP_TLS: bool = True
    SMTP_SSL: bool = False
    SMTP_PORT: int = 587
    SMTP_HOST: str | None = None
    SMTP_USER: str | None = None
    SMTP_PASSWORD: str | None = None
    EMAILS_FROM_EMAIL: EmailStr | None = None
    EMAILS_FROM_NAME: str | None = None

    @model_validator(mode="after")
    def _set_default_emails_from(self) -> Self:
        if not self.EMAILS_FROM_NAME:
            self.EMAILS_FROM_NAME = self.PROJECT_NAME
        return self

    EMAIL_RESET_TOKEN_EXPIRE_HOURS: int = 48
    USER_INVITATION_EXPIRE_HOURS: int = 48

    @computed_field  # type: ignore[prop-decorator]
    @property
    def emails_enabled(self) -> bool:
        return self.ENVIRONMENT != "demo" and bool(
            self.SMTP_HOST and self.EMAILS_FROM_EMAIL
        )

    EMAIL_TEST_USER: EmailStr = "test@example.com"
    FIRST_SUPERUSER: EmailStr
    FIRST_SUPERUSER_PASSWORD: str

    DROPBOX_API_KEY: str | None = None
    LEGACY_IMPORT_CONFIG_PATH: Path = Path("config/legacy-import.yaml")
    LEGACY_IMPORT_MODE: TaskRunMode = TaskRunMode.DISABLED
    LEGACY_IMPORT_LEDGER_ID: uuid.UUID | None = None
    SYSTEM_RUN_SCHEDULE: str = "5 0 * * *"
    SYSTEM_RUN_TIMEZONE: str = "Europe/Warsaw"
    BUSINESS_CALENDAR_COUNTRY: str = "PL"
    SYSTEM_RUN_STALE_AFTER_MINUTES: int = 120
    SYSTEM_RUN_TIMEOUT_SECONDS: int = 3600

    @model_validator(mode="after")
    def _disable_demo_external_services(self) -> Self:
        if self.ENVIRONMENT != "demo":
            return self

        self.SMTP_HOST = None
        self.SMTP_USER = None
        self.SMTP_PASSWORD = None
        self.DROPBOX_API_KEY = None
        self.LEGACY_IMPORT_MODE = TaskRunMode.DISABLED
        self.LEGACY_IMPORT_LEDGER_ID = None
        return self

    def _check_default_secret(self, var_name: str, value: str | None) -> None:
        if value == "changethis":
            message = (
                f'The value of {var_name} is "changethis", '
                "for security, please change it, at least for deployments."
            )
            if self.ENVIRONMENT == "local":
                warnings.warn(message, stacklevel=1)
            else:
                raise ValueError(message)

    @model_validator(mode="after")
    def _enforce_non_default_secrets(self) -> Self:
        if self.POSTGRES_URL is None and (
            not self.POSTGRES_SERVER or not self.POSTGRES_USER
        ):
            raise ValueError(
                "Set POSTGRES_URL or both POSTGRES_SERVER and POSTGRES_USER"
            )

        self._check_default_secret("SECRET_KEY", self.SECRET_KEY)
        self._check_default_secret("POSTGRES_PASSWORD", self.POSTGRES_PASSWORD)
        self._check_default_secret(
            "FIRST_SUPERUSER_PASSWORD", self.FIRST_SUPERUSER_PASSWORD
        )

        if self.SESSION_COOKIE_SAMESITE == "none" and not self.session_cookie_secure:
            raise ValueError("SESSION_COOKIE_SAMESITE=none requires a Secure cookie")

        return self


settings = Settings()  # type: ignore
