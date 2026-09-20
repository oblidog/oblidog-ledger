from datetime import UTC, datetime, timedelta
from unittest.mock import patch

import jwt
from fastapi.testclient import TestClient
from pwdlib.hashers.bcrypt import BcryptHasher
from sqlalchemy.orm import Session

from app.core import security
from app.core.browser_auth import CSRF_HEADER_NAME
from app.core.config import settings
from app.core.security import get_password_hash, verify_password
from app.models import User
from app.schemas import UserCreate
from app.services import users as user_service
from app.utils import generate_password_reset_token
from tests.utils.user import user_authentication_headers
from tests.utils.utils import random_email, random_lower_string


def test_health_check(client: TestClient) -> None:
    response = client.get(f"{settings.API_V1_STR}/utils/health-check/")
    assert response.status_code == 200
    assert response.json() is True


def test_get_access_token(client: TestClient) -> None:
    login_data = {
        "username": settings.FIRST_SUPERUSER,
        "password": settings.FIRST_SUPERUSER_PASSWORD,
    }
    r = client.post(f"{settings.API_V1_STR}/login/access-token", data=login_data)
    tokens = r.json()
    assert r.status_code == 200
    assert "access_token" in tokens
    assert tokens["access_token"]


def test_browser_session_uses_http_only_cookie_and_csrf(client: TestClient) -> None:
    login_data = {
        "username": settings.FIRST_SUPERUSER,
        "password": settings.FIRST_SUPERUSER_PASSWORD,
    }
    try:
        login = client.post(f"{settings.API_V1_STR}/login/session", data=login_data)

        assert login.status_code == 200
        assert login.json() == {"message": "Session created"}
        assert "access_token" not in login.text
        set_cookie = login.headers["set-cookie"]
        assert f"{settings.SESSION_COOKIE_NAME}=" in set_cookie
        assert "HttpOnly" in set_cookie
        assert "Max-Age=" in set_cookie
        assert "SameSite=lax" in set_cookie
        csrf_token = login.headers[CSRF_HEADER_NAME]

        current_user = client.get(f"{settings.API_V1_STR}/users/me")
        assert current_user.status_code == 200
        assert current_user.headers[CSRF_HEADER_NAME] == csrf_token

        rejected = client.post(
            f"{settings.API_V1_STR}/login/test-token",
            headers={"Origin": settings.FRONTEND_HOST},
        )
        assert rejected.status_code == 403
        assert rejected.json() == {"detail": "Invalid CSRF token"}

        accepted = client.post(
            f"{settings.API_V1_STR}/login/test-token",
            headers={
                "Origin": settings.FRONTEND_HOST,
                CSRF_HEADER_NAME: csrf_token,
            },
        )
        assert accepted.status_code == 200

        logout = client.post(
            f"{settings.API_V1_STR}/login/logout",
            headers={CSRF_HEADER_NAME: csrf_token},
        )
        assert logout.status_code == 200
        assert client.cookies.get(settings.SESSION_COOKIE_NAME) is None
        assert "Max-Age=0" in logout.headers["set-cookie"]
    finally:
        client.cookies.clear()


def test_explicit_bearer_takes_priority_over_browser_session_cookie(
    client: TestClient,
) -> None:
    login_data = {
        "username": settings.FIRST_SUPERUSER,
        "password": settings.FIRST_SUPERUSER_PASSWORD,
    }
    try:
        access_login = client.post(
            f"{settings.API_V1_STR}/login/access-token", data=login_data
        )
        access_token = access_login.json()["access_token"]
        session_login = client.post(
            f"{settings.API_V1_STR}/login/session", data=login_data
        )
        assert session_login.status_code == 200

        accepted = client.post(
            f"{settings.API_V1_STR}/login/test-token",
            headers={"Authorization": f"Bearer {access_token}"},
        )
        assert accepted.status_code == 200

        rejected = client.post(
            f"{settings.API_V1_STR}/login/test-token",
            headers={"Authorization": "Bearer invalid"},
        )
        assert rejected.status_code == 403
    finally:
        client.cookies.clear()


def test_access_token_cannot_be_used_as_browser_session_cookie(
    client: TestClient,
) -> None:
    login_data = {
        "username": settings.FIRST_SUPERUSER,
        "password": settings.FIRST_SUPERUSER_PASSWORD,
    }
    try:
        access_login = client.post(
            f"{settings.API_V1_STR}/login/access-token", data=login_data
        )
        access_token = access_login.json()["access_token"]
        client.cookies.set(settings.SESSION_COOKIE_NAME, access_token)

        response = client.get(f"{settings.API_V1_STR}/users/me")

        assert response.status_code == 403
        assert response.json() == {"detail": "Could not validate credentials"}
    finally:
        client.cookies.clear()


def test_browser_login_rejects_untrusted_origin(client: TestClient) -> None:
    login_data = {
        "username": settings.FIRST_SUPERUSER,
        "password": settings.FIRST_SUPERUSER_PASSWORD,
    }
    response = client.post(
        f"{settings.API_V1_STR}/login/session",
        data=login_data,
        headers={"Origin": "https://attacker.example"},
    )
    assert response.status_code == 403
    assert response.json() == {"detail": "Origin is not allowed"}


def test_browser_cors_explicitly_allows_credentials_and_csrf(
    client: TestClient,
) -> None:
    response = client.options(
        f"{settings.API_V1_STR}/login/session",
        headers={
            "Origin": settings.FRONTEND_HOST,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": CSRF_HEADER_NAME,
        },
    )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == settings.FRONTEND_HOST
    assert response.headers["access-control-allow-credentials"] == "true"
    assert (
        CSRF_HEADER_NAME.lower()
        in response.headers["access-control-allow-headers"].lower()
    )


def test_legacy_token_is_version_one_until_password_changes(
    client: TestClient, db: Session
) -> None:
    password = random_lower_string()
    user = user_service.create_user(
        session=db,
        user_in=UserCreate(email=random_email(), password=password),
    )
    legacy_token = jwt.encode(
        {
            "sub": str(user.id),
            "exp": datetime.now(UTC) + timedelta(minutes=5),
        },
        settings.SECRET_KEY,
        algorithm=security.ALGORITHM,
    )
    headers = {"Authorization": f"Bearer {legacy_token}"}

    accepted = client.get(f"{settings.API_V1_STR}/users/me", headers=headers)
    assert accepted.status_code == 200

    user_service.set_user_password(
        session=db, user=user, new_password=random_lower_string()
    )
    revoked = client.get(f"{settings.API_V1_STR}/users/me", headers=headers)
    assert revoked.status_code == 401


def test_get_access_token_incorrect_password(client: TestClient) -> None:
    login_data = {
        "username": settings.FIRST_SUPERUSER,
        "password": "incorrect",
    }
    r = client.post(f"{settings.API_V1_STR}/login/access-token", data=login_data)
    assert r.status_code == 400


def test_use_access_token(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    r = client.post(
        f"{settings.API_V1_STR}/login/test-token",
        headers=superuser_token_headers,
    )
    result = r.json()
    assert r.status_code == 200
    assert "email" in result


def test_recovery_password(
    client: TestClient, normal_user_token_headers: dict[str, str]
) -> None:
    with patch("app.api.routes.login.send_email", return_value=None):
        email = "test@example.com"
        r = client.post(
            f"{settings.API_V1_STR}/password-recovery/{email}",
            headers=normal_user_token_headers,
        )
        assert r.status_code == 200
        assert r.json() == {
            "message": "If that email is registered, we sent a password recovery link"
        }


def test_recovery_password_user_not_exits(
    client: TestClient, normal_user_token_headers: dict[str, str]
) -> None:
    email = "jVgQr@example.com"
    r = client.post(
        f"{settings.API_V1_STR}/password-recovery/{email}",
        headers=normal_user_token_headers,
    )
    # Should return 200 with generic message to prevent email enumeration attacks
    assert r.status_code == 200
    assert r.json() == {
        "message": "If that email is registered, we sent a password recovery link"
    }


def test_reset_password(client: TestClient, db: Session) -> None:
    email = random_email()
    password = random_lower_string()
    new_password = random_lower_string()

    user_create = UserCreate(
        email=email,
        full_name="Test User",
        password=password,
        is_active=True,
        is_superuser=False,
    )
    user = user_service.create_user(session=db, user_in=user_create)
    token = generate_password_reset_token(email=email)
    headers = user_authentication_headers(client=client, email=email, password=password)
    data = {"new_password": new_password, "token": token}

    r = client.post(
        f"{settings.API_V1_STR}/reset-password/",
        headers=headers,
        json=data,
    )

    assert r.status_code == 200
    assert r.json() == {"message": "Password updated successfully"}

    db.refresh(user)
    verified, _ = verify_password(new_password, user.hashed_password)
    assert verified

    revoked = client.get(f"{settings.API_V1_STR}/users/me", headers=headers)
    assert revoked.status_code == 401

    fresh_headers = user_authentication_headers(
        client=client, email=email, password=new_password
    )
    fresh = client.get(f"{settings.API_V1_STR}/users/me", headers=fresh_headers)
    assert fresh.status_code == 200


def test_reset_password_invalid_token(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    data = {"new_password": "changethis", "token": "invalid"}
    r = client.post(
        f"{settings.API_V1_STR}/reset-password/",
        headers=superuser_token_headers,
        json=data,
    )
    response = r.json()

    assert "detail" in response
    assert r.status_code == 400
    assert response["detail"] == "Invalid token"


def test_login_with_bcrypt_password_upgrades_to_argon2(
    client: TestClient, db: Session
) -> None:
    """Test that logging in with a bcrypt password hash upgrades it to argon2."""
    email = random_email()
    password = random_lower_string()

    # Create a bcrypt hash directly (simulating legacy password)
    bcrypt_hasher = BcryptHasher()
    bcrypt_hash = bcrypt_hasher.hash(password)
    assert bcrypt_hash.startswith("$2")  # bcrypt hashes start with $2

    user = User(email=email, hashed_password=bcrypt_hash, is_active=True)
    db.add(user)
    db.commit()
    db.refresh(user)

    assert user.hashed_password.startswith("$2")

    login_data = {"username": email, "password": password}
    r = client.post(f"{settings.API_V1_STR}/login/access-token", data=login_data)
    assert r.status_code == 200
    tokens = r.json()
    assert "access_token" in tokens

    db.refresh(user)

    # Verify the hash was upgraded to argon2
    assert user.hashed_password.startswith("$argon2")

    verified, updated_hash = verify_password(password, user.hashed_password)
    assert verified
    # Should not need another update since it's already argon2
    assert updated_hash is None


def test_login_with_argon2_password_keeps_hash(client: TestClient, db: Session) -> None:
    """Test that logging in with an argon2 password hash does not update it."""
    email = random_email()
    password = random_lower_string()

    # Create an argon2 hash (current default)
    argon2_hash = get_password_hash(password)
    assert argon2_hash.startswith("$argon2")

    # Create user with argon2 hash
    user = User(email=email, hashed_password=argon2_hash, is_active=True)
    db.add(user)
    db.commit()
    db.refresh(user)

    original_hash = user.hashed_password

    login_data = {"username": email, "password": password}
    r = client.post(f"{settings.API_V1_STR}/login/access-token", data=login_data)
    assert r.status_code == 200
    tokens = r.json()
    assert "access_token" in tokens

    db.refresh(user)

    assert user.hashed_password == original_hash
    assert user.hashed_password.startswith("$argon2")
