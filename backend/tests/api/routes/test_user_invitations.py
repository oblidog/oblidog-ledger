import uuid
from datetime import UTC, datetime, timedelta
from typing import Any
from unittest.mock import patch

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.security import verify_password
from app.models import UserInvitation
from app.schemas import UserCreate, UserInvitationCreate
from app.services import user_invitations as invitation_service
from app.services import users as user_service
from tests.utils.utils import random_email, random_lower_string


def _create_via_api(
    client: TestClient,
    headers: dict[str, str],
    *,
    email: str | None = None,
    token: str | None = None,
    full_name: str | None = "Invited User",
    is_superuser: bool = False,
) -> tuple[Any, str]:
    raw_token = token or f"invite-{uuid.uuid4().hex}"
    with patch(
        "app.services.user_invitations.generate_invitation_token",
        return_value=raw_token,
    ):
        response = client.post(
            f"{settings.API_V1_STR}/users/invitations",
            headers=headers,
            json={
                "email": email or random_email(),
                "full_name": full_name,
                "is_superuser": is_superuser,
            },
        )
    return response, raw_token


def _get_invitation(db: Session, invitation_id: str) -> UserInvitation:
    db.expire_all()
    invitation = db.scalar(
        select(UserInvitation).where(UserInvitation.id == uuid.UUID(invitation_id))
    )
    assert invitation is not None
    return invitation


def test_superuser_creates_invitation_without_creating_user(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    email = f"Case-{uuid.uuid4().hex}@Example.COM"
    response, raw_token = _create_via_api(
        client,
        superuser_token_headers,
        email=email,
        is_superuser=True,
    )

    assert response.status_code == 201
    body = response.json()
    assert body["email"] == email.casefold()
    assert body["status"] == "pending"
    assert body["is_superuser"] is True
    assert "token" not in body
    assert user_service.get_user_by_email(session=db, email=email) is None
    invitation = _get_invitation(db, body["id"])
    assert invitation.token_hash == invitation_service.hash_invitation_token(raw_token)
    assert raw_token not in invitation.token_hash
    assert not hasattr(invitation, "password")
    assert not hasattr(invitation, "hashed_password")


def test_invitation_email_is_sent_when_email_is_enabled(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    email = random_email()
    with (
        patch.object(settings, "SMTP_HOST", "smtp.example.com"),
        patch.object(settings, "EMAILS_FROM_EMAIL", "admin@example.com"),
        patch("app.api.routes.user_invitations.send_email") as send_email,
    ):
        response, token = _create_via_api(client, superuser_token_headers, email=email)

    assert response.status_code == 201
    send_email.assert_called_once()
    call = send_email.call_args.kwargs
    assert call["email_to"] == email
    assert token in call["html_content"]
    assert "/accept-invitation?token=" in call["html_content"]


def test_normal_user_cannot_manage_invitations(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    superuser_token_headers: dict[str, str],
) -> None:
    created, _ = _create_via_api(client, superuser_token_headers)
    invitation_id = created.json()["id"]

    create_response, _ = _create_via_api(client, normal_user_token_headers)
    assert create_response.status_code == 403
    assert (
        client.get(
            f"{settings.API_V1_STR}/users/invitations",
            headers=normal_user_token_headers,
        ).status_code
        == 403
    )
    assert (
        client.post(
            f"{settings.API_V1_STR}/users/invitations/{invitation_id}/resend",
            headers=normal_user_token_headers,
        ).status_code
        == 403
    )
    assert (
        client.delete(
            f"{settings.API_V1_STR}/users/invitations/{invitation_id}",
            headers=normal_user_token_headers,
        ).status_code
        == 403
    )


def test_duplicate_active_invitation_is_rejected_case_insensitively(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    local = uuid.uuid4().hex
    first, _ = _create_via_api(
        client, superuser_token_headers, email=f"{local}@example.com"
    )
    second, _ = _create_via_api(
        client, superuser_token_headers, email=f"{local}@EXAMPLE.COM"
    )

    assert first.status_code == 201
    assert second.status_code == 409


def test_invitation_for_existing_user_is_rejected(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    email = random_email()
    user_service.create_user(
        session=db,
        user_in=UserCreate(email=email, password=random_lower_string()),
    )

    response, _ = _create_via_api(client, superuser_token_headers, email=email.upper())

    assert response.status_code == 409
    assert response.json()["detail"] == "A user with this email already exists"


def test_valid_invitation_can_be_inspected_and_accepted_once(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    email = random_email()
    created, token = _create_via_api(
        client,
        superuser_token_headers,
        email=email,
        full_name="New Owner",
        is_superuser=True,
    )
    assert created.status_code == 201

    inspected = client.get(f"{settings.API_V1_STR}/invitations/{token}")
    assert inspected.status_code == 200
    assert inspected.json()["email"] == email

    password = "secure-password-123"
    accepted = client.post(
        f"{settings.API_V1_STR}/invitations/{token}/accept",
        json={"new_password": password},
    )
    assert accepted.status_code == 200
    assert accepted.json()["full_name"] == "New Owner"
    assert accepted.json()["is_superuser"] is True
    user = user_service.get_user_by_email(session=db, email=email)
    assert user is not None
    verified, _ = verify_password(password, user.hashed_password)
    assert verified

    reused = client.post(
        f"{settings.API_V1_STR}/invitations/{token}/accept",
        json={"new_password": password},
    )
    assert reused.status_code == 409
    users = user_service.list_users(session=db)
    assert sum(item.email == email for item in users) == 1


def test_invalid_token_is_rejected(client: TestClient) -> None:
    response = client.get(f"{settings.API_V1_STR}/invitations/not-a-real-token")
    assert response.status_code == 404


def test_expired_token_is_rejected(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    created, token = _create_via_api(client, superuser_token_headers)
    invitation = _get_invitation(db, created.json()["id"])
    invitation.expires_at = datetime.now(UTC) - timedelta(seconds=1)
    db.add(invitation)
    db.commit()

    inspected = client.get(f"{settings.API_V1_STR}/invitations/{token}")
    accepted = client.post(
        f"{settings.API_V1_STR}/invitations/{token}/accept",
        json={"new_password": "secure-password-123"},
    )
    assert inspected.status_code == 410
    assert accepted.status_code == 410


def test_revoked_token_is_rejected(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    created, token = _create_via_api(client, superuser_token_headers)
    invitation_id = created.json()["id"]
    revoked = client.delete(
        f"{settings.API_V1_STR}/users/invitations/{invitation_id}",
        headers=superuser_token_headers,
    )
    assert revoked.status_code == 200

    inspected = client.get(f"{settings.API_V1_STR}/invitations/{token}")
    accepted = client.post(
        f"{settings.API_V1_STR}/invitations/{token}/accept",
        json={"new_password": "secure-password-123"},
    )
    assert inspected.status_code == 410
    assert accepted.status_code == 410


def test_resend_rotates_token_and_refreshes_expiry(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    created, old_token = _create_via_api(client, superuser_token_headers)
    invitation = _get_invitation(db, created.json()["id"])
    old_expiry = invitation.expires_at
    new_token = f"invite-{uuid.uuid4().hex}"

    with patch(
        "app.services.user_invitations.generate_invitation_token",
        return_value=new_token,
    ):
        resent = client.post(
            f"{settings.API_V1_STR}/users/invitations/{invitation.id}/resend",
            headers=superuser_token_headers,
        )

    assert resent.status_code == 200
    assert (
        client.get(f"{settings.API_V1_STR}/invitations/{old_token}").status_code == 404
    )
    assert (
        client.get(f"{settings.API_V1_STR}/invitations/{new_token}").status_code == 200
    )
    assert datetime.fromisoformat(resent.json()["expires_at"]) >= old_expiry


def test_expired_invitation_can_be_replaced(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    email = random_email()
    created, _ = _create_via_api(client, superuser_token_headers, email=email)
    old = _get_invitation(db, created.json()["id"])
    old.expires_at = datetime.now(UTC) - timedelta(seconds=1)
    db.add(old)
    db.commit()

    replacement, _ = _create_via_api(client, superuser_token_headers, email=email)

    assert replacement.status_code == 201
    db.refresh(old)
    assert old.revoked_at is not None


def test_list_invitations_exposes_status_not_secret(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    created, _ = _create_via_api(client, superuser_token_headers)
    response = client.get(
        f"{settings.API_V1_STR}/users/invitations",
        headers=superuser_token_headers,
    )

    assert response.status_code == 200
    invitation = next(
        item for item in response.json()["data"] if item["id"] == created.json()["id"]
    )
    assert invitation["status"] == "pending"
    assert "token" not in invitation
    assert "token_hash" not in invitation


def test_service_invitation_permissions_come_from_stored_record(
    db: Session,
) -> None:
    creator = user_service.get_user_by_email(
        session=db, email=str(settings.FIRST_SUPERUSER)
    )
    assert creator is not None
    delivery = invitation_service.create_invitation(
        session=db,
        invitation_in=UserInvitationCreate(email=random_email(), is_superuser=False),
        created_by=creator,
    )

    user = invitation_service.accept_invitation(
        session=db,
        token=delivery.token,
        new_password="secure-password-123",
    )

    assert user.is_superuser is False
    assert user.is_active is True
