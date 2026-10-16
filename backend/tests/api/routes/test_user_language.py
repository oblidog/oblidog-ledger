"""Exercise language preferences through real auth/routes with an isolated store."""

from collections.abc import Generator
from typing import cast

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Table, create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.api.deps import get_db
from app.core.config import settings
from app.main import app
from app.models import User
from app.schemas import UserCreate
from app.services import users as user_service

URL = f"{settings.API_V1_STR}/users/me"
PASSWORD = "language-test-password"


@pytest.fixture
def language_client() -> Generator[tuple[TestClient, Session, User]]:
    # Only the user table is needed. This also allows these contract tests to run
    # without access to either a developer or provider-hosted database.
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    cast(Table, User.__table__).create(engine)
    with Session(engine, expire_on_commit=False) as session:
        user = user_service.create_user(
            session=session,
            user_in=UserCreate(email="language@example.com", password=PASSWORD),
        )
        previous = app.dependency_overrides.copy()
        app.dependency_overrides[get_db] = lambda: session
        try:
            with TestClient(app) as client:
                yield client, session, user
        finally:
            app.dependency_overrides.clear()
            app.dependency_overrides.update(previous)
    engine.dispose()


def login(client: TestClient) -> dict[str, str]:
    response = client.post(
        f"{settings.API_V1_STR}/login/access-token",
        data={"username": "language@example.com", "password": PASSWORD},
    )
    assert response.status_code == 200
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def test_language_persists_across_login_and_partial_profile_updates(
    language_client: tuple[TestClient, Session, User],
) -> None:
    client, session, user = language_client
    other = user_service.create_user(
        session=session,
        user_in=UserCreate(email="other-language@example.com", password=PASSWORD),
    )
    headers = login(client)
    assert client.get(URL, headers=headers).json()["language"] is None
    response = client.patch(URL, headers=headers, json={"language": "pl"})
    assert response.status_code == 200
    assert response.json()["language"] == "pl"
    session.refresh(user)
    assert user.language == "pl"
    assert user.daily_report_enabled and user.weekly_report_enabled
    assert client.get(URL, headers=login(client)).json()["language"] == "pl"
    assert (
        client.patch(URL, headers=headers, json={"full_name": "Example"}).status_code
        == 200
    )
    session.refresh(user)
    assert user.language == "pl"
    for value in ("en", None):
        assert (
            client.patch(URL, headers=headers, json={"language": value}).json()[
                "language"
            ]
            == value
        )
    session.refresh(other)
    assert other.language is None


@pytest.mark.parametrize("value", ["de", "pl-PL", "", 1, True, ["pl"]])
def test_language_rejects_unsupported_values(
    language_client: tuple[TestClient, Session, User], value: object
) -> None:
    client, session, user = language_client
    response = client.patch(URL, headers=login(client), json={"language": value})
    assert response.status_code == 422
    session.refresh(user)
    assert user.language is None


def test_language_update_requires_authentication(
    language_client: tuple[TestClient, Session, User],
) -> None:
    client, _, _ = language_client
    assert client.patch(URL, json={"language": "pl"}).status_code == 401


def test_demo_cannot_mutate_shared_account_language(
    language_client: tuple[TestClient, Session, User], monkeypatch: pytest.MonkeyPatch
) -> None:
    client, session, user = language_client
    headers = login(client)
    monkeypatch.setattr(settings, "ENVIRONMENT", "demo")
    assert (
        client.patch(URL, headers=headers, json={"language": "pl"}).status_code == 403
    )
    session.refresh(user)
    assert user.language is None
