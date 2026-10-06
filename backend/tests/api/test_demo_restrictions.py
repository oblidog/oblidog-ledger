from collections.abc import Generator
from datetime import date

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.capabilities import CapabilityDisabledError
from app.core.config import Settings, settings
from app.demo_seed import DEMO_EMAIL
from app.domain import RecurrenceUnit, TaskRunMode
from app.models import Obligation
from app.services import demo_limits
from app.services import users as user_service
from app.use_cases import categories as category_use_cases
from app.use_cases import ledgers as ledger_use_cases
from app.utils import send_email
from tests.utils.user import authentication_token_from_email, create_random_user


@pytest.fixture
def demo_environment(monkeypatch: pytest.MonkeyPatch) -> Generator[None]:
    monkeypatch.setattr(settings, "ENVIRONMENT", "demo")
    yield


def test_demo_settings_disable_external_service_configuration() -> None:
    demo_settings = Settings(
        _env_file=None,  # type: ignore[call-arg]
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


@pytest.mark.usefixtures("demo_environment")
def test_demo_blocks_sensitive_api_operations_before_endpoint_execution(
    client: TestClient, db: Session
) -> None:
    user = create_random_user(db)
    headers = authentication_token_from_email(client=client, email=user.email, db=db)
    ledger = ledger_use_cases.create_ledger(
        session=db,
        owner_user_id=user.id,
        name="Demo restriction test",
    )

    integration_response = client.get(f"{settings.API_V1_STR}/integration/context")
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


@pytest.mark.usefixtures("demo_environment")
def test_demo_keeps_core_ledger_read_workflow_available(
    client: TestClient, db: Session
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


@pytest.mark.usefixtures("demo_environment")
def test_send_email_cannot_be_called_in_demo() -> None:
    with pytest.raises(CapabilityDisabledError, match="email is disabled"):
        send_email(email_to="recipient@example.com", subject="Blocked")


@pytest.mark.usefixtures("demo_environment")
def test_read_only_demo_keeps_login_and_reads_but_blocks_all_write_methods(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "DEMO_WRITES_ENABLED", False)
    user = create_random_user(db)
    headers = authentication_token_from_email(client=client, email=user.email, db=db)
    ledger = ledger_use_cases.create_ledger(
        session=db, owner_user_id=user.id, name="Read-only demo"
    )

    assert (
        client.get(f"{settings.API_V1_STR}/ledgers/", headers=headers).status_code
        == 200
    )
    assert (
        client.post(
            f"{settings.API_V1_STR}/login/test-token", headers=headers
        ).status_code
        == 200
    )
    assert (
        client.get(f"{settings.API_V1_STR}/utils/public-config").json()[
            "demo_writes_enabled"
        ]
        is False
    )
    for method, path in (
        ("POST", "/ledgers/"),
        ("PATCH", f"/ledgers/{ledger.id}"),
        ("PUT", f"/ledgers/{ledger.id}/obligations/unknown/components/upsert"),
        ("DELETE", f"/ledgers/{ledger.id}/obligations"),
    ):
        response = client.request(
            method, f"{settings.API_V1_STR}{path}", headers=headers
        )
        assert response.status_code == 403
        assert response.json()["detail"] == "Demo is temporarily read-only"


@pytest.mark.usefixtures("demo_environment")
def test_demo_rejects_large_mutable_content_before_database_write(
    client: TestClient, db: Session
) -> None:
    user = create_random_user(db)
    headers = authentication_token_from_email(client=client, email=user.email, db=db)

    response = client.post(
        f"{settings.API_V1_STR}/ledgers/",
        headers=headers,
        json={"name": "test", "description": "x" * 2049},
    )
    assert response.status_code == 413
    assert response.json()["detail"] == "Demo JSON content is too large"

    oversized = client.post(
        f"{settings.API_V1_STR}/ledgers/",
        headers=headers,
        content=b"x" * (64 * 1024 + 1),
    )
    assert oversized.status_code == 413
    assert oversized.json()["detail"] == "Demo request body is too large"


@pytest.mark.usefixtures("demo_environment")
def test_shared_demo_owner_cannot_create_unbounded_ledgers(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(demo_limits, "MAX_LEDGERS", 1)
    headers = authentication_token_from_email(client=client, email=DEMO_EMAIL, db=db)

    first = client.post(
        f"{settings.API_V1_STR}/ledgers/", headers=headers, json={"name": "quota-one"}
    )
    second = client.post(
        f"{settings.API_V1_STR}/ledgers/", headers=headers, json={"name": "quota-two"}
    )

    assert first.status_code == 200
    assert second.status_code == 409
    assert "Demo limit reached" in second.json()["detail"]


@pytest.mark.usefixtures("demo_environment")
def test_ensure_rolls_back_all_new_obligations_when_demo_quota_is_exceeded(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(demo_limits, "MAX_OBLIGATIONS", 1)
    headers = authentication_token_from_email(client=client, email=DEMO_EMAIL, db=db)
    user = user_service.get_user_by_email(session=db, email=DEMO_EMAIL)
    assert user is not None
    ledger = ledger_use_cases.create_ledger(
        session=db, owner_user_id=user.id, name="quota-ensure"
    )
    group = category_use_cases.create_category_group(
        session=db, ledger_id=ledger.id, name="quota-group"
    )
    for code in ("QUOT", "SECO"):
        category_use_cases.create_category(
            session=db,
            ledger_id=ledger.id,
            category_group_id=group.id,
            name=code,
            code=code,
            recurrence_interval=1,
            recurrence_unit=RecurrenceUnit.MONTH,
            first_due_date=date(2026, 1, 1),
        )

    response = client.post(
        f"{settings.API_V1_STR}/ledgers/{ledger.id}/obligations/ensure?year=2026&month=9",
        headers=headers,
    )
    assert response.status_code == 409
    assert "Demo limit reached" in response.json()["detail"]
    db.expire_all()
    assert (
        db.scalar(
            select(func.count())
            .select_from(Obligation)
            .where(Obligation.ledger_id == ledger.id)
        )
        == 0
    )
