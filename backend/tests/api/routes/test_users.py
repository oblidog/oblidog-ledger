import uuid

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.security import verify_password
from app.main import app
from app.models import User
from app.schemas import UserCreate
from app.services import users as user_service
from tests.utils.user import create_random_user, user_authentication_headers
from tests.utils.utils import random_email, random_lower_string


def test_get_users_superuser_me(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    r = client.get(f"{settings.API_V1_STR}/users/me", headers=superuser_token_headers)
    current_user = r.json()
    assert current_user
    assert current_user["is_active"] is True
    assert current_user["is_superuser"]
    assert current_user["email"] == settings.FIRST_SUPERUSER


def test_get_users_normal_user_me(
    client: TestClient, normal_user_token_headers: dict[str, str]
) -> None:
    r = client.get(f"{settings.API_V1_STR}/users/me", headers=normal_user_token_headers)
    current_user = r.json()
    assert current_user
    assert current_user["is_active"] is True
    assert current_user["is_superuser"] is False
    assert current_user["email"] == settings.EMAIL_TEST_USER


def test_direct_user_creation_is_not_available(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    email = random_email()
    response = client.post(
        f"{settings.API_V1_STR}/users/",
        headers=superuser_token_headers,
        json={"email": email, "password": random_lower_string()},
    )

    assert response.status_code == 405
    assert user_service.get_user_by_email(session=db, email=email) is None
    assert "post" not in app.openapi()["paths"][f"{settings.API_V1_STR}/users/"]


def test_get_existing_user_as_superuser(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    username = random_email()
    password = random_lower_string()
    user_in = UserCreate(email=username, password=password)
    user = user_service.create_user(session=db, user_in=user_in)
    user_id = user.id
    r = client.get(
        f"{settings.API_V1_STR}/users/{user_id}",
        headers=superuser_token_headers,
    )
    assert 200 <= r.status_code < 300
    api_user = r.json()
    existing_user = user_service.get_user_by_email(session=db, email=username)
    assert existing_user
    assert existing_user.email == api_user["email"]


def test_get_non_existing_user_as_superuser(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    r = client.get(
        f"{settings.API_V1_STR}/users/{uuid.uuid4()}",
        headers=superuser_token_headers,
    )
    assert r.status_code == 404
    assert r.json() == {"detail": "User not found"}


def test_get_existing_user_current_user(client: TestClient, db: Session) -> None:
    username = random_email()
    password = random_lower_string()
    user_in = UserCreate(email=username, password=password)
    user = user_service.create_user(session=db, user_in=user_in)
    user_id = user.id

    login_data = {
        "username": username,
        "password": password,
    }
    r = client.post(f"{settings.API_V1_STR}/login/access-token", data=login_data)
    tokens = r.json()
    a_token = tokens["access_token"]
    headers = {"Authorization": f"Bearer {a_token}"}

    r = client.get(
        f"{settings.API_V1_STR}/users/{user_id}",
        headers=headers,
    )
    assert 200 <= r.status_code < 300
    api_user = r.json()
    existing_user = user_service.get_user_by_email(session=db, email=username)
    assert existing_user
    assert existing_user.email == api_user["email"]


def test_get_existing_user_permissions_error(
    db: Session,
    client: TestClient,
    normal_user_token_headers: dict[str, str],
) -> None:
    user = create_random_user(db)

    r = client.get(
        f"{settings.API_V1_STR}/users/{user.id}",
        headers=normal_user_token_headers,
    )
    assert r.status_code == 403
    assert r.json() == {"detail": "The user doesn't have enough privileges"}


def test_get_non_existing_user_permissions_error(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
) -> None:
    user_id = uuid.uuid4()

    r = client.get(
        f"{settings.API_V1_STR}/users/{user_id}",
        headers=normal_user_token_headers,
    )
    assert r.status_code == 403
    assert r.json() == {"detail": "The user doesn't have enough privileges"}


def test_signup_disabled(client: TestClient) -> None:
    response = client.post(
        f"{settings.API_V1_STR}/users/signup",
        json={
            "email": random_email(),
            "password": random_lower_string(),
            "full_name": "Blocked Signup",
        },
    )

    assert response.status_code == 404


def test_retrieve_users(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    username = random_email()
    password = random_lower_string()
    user_in = UserCreate(email=username, password=password)
    user_service.create_user(session=db, user_in=user_in)

    username2 = random_email()
    password2 = random_lower_string()
    user_in2 = UserCreate(email=username2, password=password2)
    user_service.create_user(session=db, user_in=user_in2)

    r = client.get(f"{settings.API_V1_STR}/users/", headers=superuser_token_headers)
    all_users = r.json()

    assert len(all_users["data"]) > 1
    assert "count" in all_users
    for item in all_users["data"]:
        assert "email" in item


def test_update_user_me(
    client: TestClient, normal_user_token_headers: dict[str, str], db: Session
) -> None:
    full_name = "Updated Name"
    email = random_email()
    data = {"full_name": full_name, "email": email}
    r = client.patch(
        f"{settings.API_V1_STR}/users/me",
        headers=normal_user_token_headers,
        json=data,
    )
    assert r.status_code == 200
    updated_user = r.json()
    assert updated_user["email"] == email
    assert updated_user["full_name"] == full_name

    user_query = select(User).where(User.email == email)
    user_db = db.scalars(user_query).first()
    assert user_db
    assert user_db.email == email
    assert user_db.full_name == full_name


def test_update_password_me(
    client: TestClient, db: Session
) -> None:
    email = random_email()
    current_password = random_lower_string()
    new_password = random_lower_string()
    user = user_service.create_user(
        session=db,
        user_in=UserCreate(email=email, password=current_password),
    )
    token_headers = user_authentication_headers(
        client=client, email=email, password=current_password
    )
    data = {
        "current_password": current_password,
        "new_password": new_password,
    }
    r = client.patch(
        f"{settings.API_V1_STR}/users/me/password",
        headers=token_headers,
        json=data,
    )
    assert r.status_code == 200
    updated_user = r.json()
    assert updated_user["message"] == "Password updated successfully"

    user_query = select(User).where(User.email == email)
    user_db = db.scalars(user_query).first()
    assert user_db
    assert user_db.email == email
    verified, _ = verify_password(new_password, user_db.hashed_password)
    assert verified

    revoked = client.get(
        f"{settings.API_V1_STR}/users/me", headers=token_headers
    )
    assert revoked.status_code == 401
    assert revoked.json()["detail"] == "Session expired"

    fresh_headers = user_authentication_headers(
        client=client, email=email, password=new_password
    )
    fresh = client.get(
        f"{settings.API_V1_STR}/users/me", headers=fresh_headers
    )
    assert fresh.status_code == 200
    assert fresh.json()["id"] == str(user.id)


def test_update_password_me_incorrect_password(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    new_password = random_lower_string()
    data = {"current_password": new_password, "new_password": new_password}
    r = client.patch(
        f"{settings.API_V1_STR}/users/me/password",
        headers=superuser_token_headers,
        json=data,
    )
    assert r.status_code == 400
    updated_user = r.json()
    assert updated_user["detail"] == "Incorrect password"


def test_update_user_me_email_exists(
    client: TestClient, normal_user_token_headers: dict[str, str], db: Session
) -> None:
    username = random_email()
    password = random_lower_string()
    user_in = UserCreate(email=username, password=password)
    user = user_service.create_user(session=db, user_in=user_in)

    data = {"email": user.email}
    r = client.patch(
        f"{settings.API_V1_STR}/users/me",
        headers=normal_user_token_headers,
        json=data,
    )
    assert r.status_code == 409
    assert r.json()["detail"] == "User with this email already exists"


def test_update_password_me_same_password_error(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    data = {
        "current_password": settings.FIRST_SUPERUSER_PASSWORD,
        "new_password": settings.FIRST_SUPERUSER_PASSWORD,
    }
    r = client.patch(
        f"{settings.API_V1_STR}/users/me/password",
        headers=superuser_token_headers,
        json=data,
    )
    assert r.status_code == 400
    updated_user = r.json()
    assert (
        updated_user["detail"] == "New password cannot be the same as the current one"
    )


def test_update_user(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    username = random_email()
    password = random_lower_string()
    user_in = UserCreate(email=username, password=password)
    user = user_service.create_user(session=db, user_in=user_in)

    data = {"full_name": "Updated_full_name"}
    r = client.patch(
        f"{settings.API_V1_STR}/users/{user.id}",
        headers=superuser_token_headers,
        json=data,
    )
    assert r.status_code == 200
    updated_user = r.json()

    assert updated_user["full_name"] == "Updated_full_name"

    user_query = select(User).where(User.email == username)
    user_db = db.scalars(user_query).first()
    db.refresh(user_db)
    assert user_db
    assert user_db.full_name == "Updated_full_name"


def test_update_user_partial_full_name_preserves_other_fields(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    user = user_service.create_user(
        session=db,
        user_in=UserCreate(
            email=random_email(),
            password=random_lower_string(),
            full_name="Original Name",
            is_active=False,
            is_superuser=True,
        ),
    )
    original_hash = user.hashed_password

    r = client.patch(
        f"{settings.API_V1_STR}/users/{user.id}",
        headers=superuser_token_headers,
        json={"full_name": "Updated Name"},
    )

    assert r.status_code == 200
    db.expire_all()
    updated = db.get(User, user.id)
    assert updated
    assert updated.full_name == "Updated Name"
    assert updated.email == user.email
    assert updated.is_active is False
    assert updated.is_superuser is True
    assert updated.hashed_password == original_hash


def test_update_user_partial_email_preserves_flags_and_name(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    user = user_service.create_user(
        session=db,
        user_in=UserCreate(
            email=random_email(),
            password=random_lower_string(),
            full_name="Stable Name",
            is_active=False,
            is_superuser=True,
        ),
    )

    new_email = random_email()
    r = client.patch(
        f"{settings.API_V1_STR}/users/{user.id}",
        headers=superuser_token_headers,
        json={"email": new_email},
    )

    assert r.status_code == 200
    db.expire_all()
    updated = db.get(User, user.id)
    assert updated
    assert updated.email == new_email
    assert updated.full_name == "Stable Name"
    assert updated.is_active is False
    assert updated.is_superuser is True


def test_update_user_partial_password_preserves_other_fields(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    original_password = random_lower_string()
    user = user_service.create_user(
        session=db,
        user_in=UserCreate(
            email=random_email(),
            password=original_password,
            full_name="Stable Name",
            is_active=False,
            is_superuser=True,
        ),
    )
    original_hash = user.hashed_password
    original_session_version = user.session_version
    new_password = random_lower_string()

    r = client.patch(
        f"{settings.API_V1_STR}/users/{user.id}",
        headers=superuser_token_headers,
        json={"password": new_password},
    )

    assert r.status_code == 200
    db.expire_all()
    updated = db.get(User, user.id)
    assert updated
    assert updated.email == user.email
    assert updated.full_name == "Stable Name"
    assert updated.is_active is False
    assert updated.is_superuser is True
    assert updated.hashed_password != original_hash
    verified, _ = verify_password(new_password, updated.hashed_password)
    assert verified
    assert updated.session_version == original_session_version + 1


def test_admin_password_replacement_revokes_only_target_user_sessions(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    email = random_email()
    password = random_lower_string()
    new_password = random_lower_string()
    user = user_service.create_user(
        session=db,
        user_in=UserCreate(email=email, password=password),
    )
    user_headers = user_authentication_headers(
        client=client, email=email, password=password
    )

    response = client.patch(
        f"{settings.API_V1_STR}/users/{user.id}",
        headers=superuser_token_headers,
        json={"password": new_password},
    )

    assert response.status_code == 200
    revoked = client.get(f"{settings.API_V1_STR}/users/me", headers=user_headers)
    assert revoked.status_code == 401

    fresh_headers = user_authentication_headers(
        client=client, email=email, password=new_password
    )
    fresh = client.get(f"{settings.API_V1_STR}/users/me", headers=fresh_headers)
    assert fresh.status_code == 200

    admin_still_signed_in = client.get(
        f"{settings.API_V1_STR}/users/me", headers=superuser_token_headers
    )
    assert admin_still_signed_in.status_code == 200


def test_update_user_partial_flags_preserve_omitted_fields(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    user = user_service.create_user(
        session=db,
        user_in=UserCreate(
            email=random_email(),
            password=random_lower_string(),
            full_name="Stable Name",
            is_active=True,
            is_superuser=False,
        ),
    )
    original_hash = user.hashed_password

    r = client.patch(
        f"{settings.API_V1_STR}/users/{user.id}",
        headers=superuser_token_headers,
        json={"is_active": False},
    )

    assert r.status_code == 200
    db.expire_all()
    updated = db.get(User, user.id)
    assert updated
    assert updated.is_active is False
    assert updated.is_superuser is False
    assert updated.full_name == "Stable Name"
    assert updated.email == user.email
    assert updated.hashed_password == original_hash


def test_update_user_partial_superuser_preserves_omitted_fields(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    user = user_service.create_user(
        session=db,
        user_in=UserCreate(
            email=random_email(),
            password=random_lower_string(),
            full_name="Stable Name",
            is_active=False,
            is_superuser=False,
        ),
    )
    original_hash = user.hashed_password

    r = client.patch(
        f"{settings.API_V1_STR}/users/{user.id}",
        headers=superuser_token_headers,
        json={"is_superuser": True},
    )

    assert r.status_code == 200
    db.expire_all()
    updated = db.get(User, user.id)
    assert updated
    assert updated.is_superuser is True
    assert updated.is_active is False
    assert updated.full_name == "Stable Name"
    assert updated.email == user.email
    assert updated.hashed_password == original_hash


def test_update_user_not_exists(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    data = {"full_name": "Updated_full_name"}
    r = client.patch(
        f"{settings.API_V1_STR}/users/{uuid.uuid4()}",
        headers=superuser_token_headers,
        json=data,
    )
    assert r.status_code == 404
    assert r.json()["detail"] == "The user with this id does not exist in the system"


def test_update_user_email_exists(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    username = random_email()
    password = random_lower_string()
    user_in = UserCreate(email=username, password=password)
    user = user_service.create_user(session=db, user_in=user_in)

    username2 = random_email()
    password2 = random_lower_string()
    user_in2 = UserCreate(email=username2, password=password2)
    user2 = user_service.create_user(session=db, user_in=user_in2)

    data = {"email": user2.email}
    r = client.patch(
        f"{settings.API_V1_STR}/users/{user.id}",
        headers=superuser_token_headers,
        json=data,
    )
    assert r.status_code == 409
    assert r.json()["detail"] == "User with this email already exists"


def test_delete_user_me(client: TestClient, db: Session) -> None:
    username = random_email()
    password = random_lower_string()
    user_in = UserCreate(email=username, password=password)
    user = user_service.create_user(session=db, user_in=user_in)
    user_id = user.id

    login_data = {
        "username": username,
        "password": password,
    }
    r = client.post(f"{settings.API_V1_STR}/login/access-token", data=login_data)
    tokens = r.json()
    a_token = tokens["access_token"]
    headers = {"Authorization": f"Bearer {a_token}"}

    r = client.delete(
        f"{settings.API_V1_STR}/users/me",
        headers=headers,
    )
    assert r.status_code == 200
    deleted_user = r.json()
    assert deleted_user["message"] == "User deleted successfully"
    result = db.scalars(select(User).where(User.id == user_id)).first()
    assert result is None

    user_query = select(User).where(User.id == user_id)
    user_db = db.execute(user_query).first()
    assert user_db is None


def test_delete_user_me_as_superuser(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    r = client.delete(
        f"{settings.API_V1_STR}/users/me",
        headers=superuser_token_headers,
    )
    assert r.status_code == 403
    response = r.json()
    assert response["detail"] == "Super users are not allowed to delete themselves"


def test_delete_user_super_user(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    username = random_email()
    password = random_lower_string()
    user_in = UserCreate(email=username, password=password)
    user = user_service.create_user(session=db, user_in=user_in)
    user_id = user.id
    r = client.delete(
        f"{settings.API_V1_STR}/users/{user_id}",
        headers=superuser_token_headers,
    )
    assert r.status_code == 200
    deleted_user = r.json()
    assert deleted_user["message"] == "User deleted successfully"
    result = db.scalars(select(User).where(User.id == user_id)).first()
    assert result is None


def test_delete_user_not_found(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    r = client.delete(
        f"{settings.API_V1_STR}/users/{uuid.uuid4()}",
        headers=superuser_token_headers,
    )
    assert r.status_code == 404
    assert r.json()["detail"] == "User not found"


def test_delete_user_current_super_user_error(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    super_user = user_service.get_user_by_email(
        session=db, email=settings.FIRST_SUPERUSER
    )
    assert super_user
    user_id = super_user.id

    r = client.delete(
        f"{settings.API_V1_STR}/users/{user_id}",
        headers=superuser_token_headers,
    )
    assert r.status_code == 403
    assert r.json()["detail"] == "Super users are not allowed to delete themselves"


def test_delete_user_without_privileges(
    client: TestClient, normal_user_token_headers: dict[str, str], db: Session
) -> None:
    username = random_email()
    password = random_lower_string()
    user_in = UserCreate(email=username, password=password)
    user = user_service.create_user(session=db, user_in=user_in)

    r = client.delete(
        f"{settings.API_V1_STR}/users/{user.id}",
        headers=normal_user_token_headers,
    )
    assert r.status_code == 403
    assert r.json()["detail"] == "The user doesn't have enough privileges"
