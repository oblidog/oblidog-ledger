from collections.abc import Generator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.capabilities import CapabilityDisabledError
from app.core.config import Settings, settings
from app.domain import TaskRunMode
from app.services import users as user_service
from app.use_cases import ledgers as ledger_use_cases
from app.utils import send_email
from tests.utils.user import authentication_token_from_email, create_random_user


@pytest.fixture
def demo_environment(monkeypatch: pytest.MonkeyPatch) -> Generator[None, None, None]:
    monkeypatch.setattr(settings, "ENVIRONMENT", "demo")
    yield


def test_demo_settings_disable_external_service_configuration() -> None:
    demo_settings = Settings(
        _env_file=None,
        PROJECT_NAME="Oblidog",
        ENVIRONMENT="demo",
        SECRET_KEY="test-secret-key",
        POSTGRES_SERVER="localhost",
        POSTGRES_USER="postgres",
        POSTGRES_PASSWORD="postgres-password",
        POSTGRES_DB="oblidog",
        FIRST_SUPERUSER="admin@example.com",
        FIRST_SUPERUSER_PASSWORD="superuser-password",
        SMTP_HOST="smtp.example.com",
        SMTP_USER="smtp-user",
        SMTP_PASSWORD="smtp-password",
        EMAILS_FROM_EMAIL="noreply@example.com",
        DROPBOX_API_KEY="dropbox-token",
        LEGACY_IMPORT_MODE=TaskRunMode.SCHEDULED,
    )

    assert demo_settings.ENVIRONMENT == "demo"
    assert demo_settings.emails_enabled is False
    assert demo_settings.SMTP_HOST is None
    assert demo_settings.SMTP_USER is None
    assert demo_settings.SMTP_PASSWORD is None
    assert demo_settings.DROPBOX_API_KEY is None
    assert demo_settings.LEGACY_IMPORT_MODE is TaskRunMode.DISABLED


def test_demo_blocks_sensitive_api_operations_before_endpoint_execution(
    client: TestClient,
    db: Session,
    demo_environment: None,
) -> None:
    user = create_random_user(db)
    headers = authentication_token_from_email(client=client, email=user.email, db=db)
    ledger = ledger_use_cases.create_ledger(
        session=db,
        owner_user_id=user.id,
        name="Demo restriction test",
    )

    api_key_response = client.post(
        f"{settings.API_V1_STR}/ledgers/{ledger.id}/api-keys",
        headers=headers,
        json={"name": "blocked", "scopes": ["ledger:read"]},
    )
    assert api_key_response.status_code == 403
    assert api_key_response.json() == {
        "detail": "api_keys is disabled in demo environment"
    }

    integration_response = client.get(f"{settings.API_V1_STR}/integration/ledger")
    assert integration_response.status_code == 403
    assert integration_response.json() == {
        "detail": "integrations is disabled in demo environment"
    }

    account_response = client.patch(
        f"{settings.API_V1_STR}/users/me",
        headers=headers,
        json={"full_name": "Changed"},
    )
    assert account_response.status_code == 403
    assert account_response.json() == {
        "detail": "account_security is disabled in demo environment"
    }

    recovery_response = client.post(
        f"{settings.API_V1_STR}/password-recovery/{user.email}"
    )
    assert recovery_response.status_code == 403
    assert recovery_response.json() == {
        "detail": "account_security is disabled in demo environment"
    }

    membership_response = client.post(
        f"{settings.API_V1_STR}/ledgers/{ledger.id}/members",
        headers=headers,
        json={"user_id": str(user.id), "role": "viewer"},
    )
    assert membership_response.status_code == 403
    assert membership_response.json() == {
        "detail": "account_security is disabled in demo environment"
    }


def test_demo_keeps_core_ledger_read_workflow_available(
    client: TestClient,
    db: Session,
    demo_environment: None,
) -> None:
    user = create_random_user(db)
    headers = authentication_token_from_email(client=client, email=user.email, db=db)
    ledger = ledger_use_cases.create_ledger(
        session=db,
        owner_user_id=user.id,
        name="Demo readable ledger",
    )

    response = client.get(
        f"{settings.API_V1_STR}/ledgers/{ledger.id}",
        headers=headers,
    )

    assert response.status_code == 200
    assert response.json()["id"] == str(ledger.id)


def test_non_demo_behavior_remains_unchanged(
    client: TestClient,
    db: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "ENVIRONMENT", "local")
    user = create_random_user(db)
    headers = authentication_token_from_email(client=client, email=user.email, db=db)

    response = client.patch(
        f"{settings.API_V1_STR}/users/me",
        headers=headers,
        json={"full_name": "Updated outside demo"},
    )

    assert response.status_code == 200
    assert response.json()["full_name"] == "Updated outside demo"
    db.expire_all()
    refreshed = user_service.get_user_by_id(session=db, user_id=user.id)
    assert refreshed is not None
    assert refreshed.full_name == "Updated outside demo"


def test_send_email_cannot_be_called_in_demo(demo_environment: None) -> None:
    with pytest.raises(CapabilityDisabledError, match="email is disabled"):
        send_email(email_to="recipient@example.com", subject="Blocked")
