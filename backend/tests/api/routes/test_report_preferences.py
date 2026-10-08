import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.config import settings
from tests.utils.user import (
    authentication_token_from_email,
    create_random_user,
)

URL = f"{settings.API_V1_STR}/users/me/report-preferences"


def test_report_preferences_default_on_and_update_independently(
    client: TestClient, db: Session
) -> None:
    user = create_random_user(db)
    other = create_random_user(db)
    headers = authentication_token_from_email(client=client, email=user.email, db=db)
    assert client.get(URL, headers=headers).json() == {
        "daily_report_enabled": True,
        "weekly_report_enabled": True,
    }

    for patch, expected in [
        ({"daily_report_enabled": False}, (False, True)),
        ({"weekly_report_enabled": False}, (False, False)),
        ({}, (False, False)),
        ({"daily_report_enabled": True}, (True, False)),
        ({"weekly_report_enabled": True}, (True, True)),
    ]:
        response = client.patch(URL, headers=headers, json=patch)
        assert response.status_code == 200
        assert response.json() == {
            "daily_report_enabled": expected[0],
            "weekly_report_enabled": expected[1],
        }
        assert client.get(URL, headers=headers).json() == response.json()
        db.refresh(user)
        assert (user.daily_report_enabled, user.weekly_report_enabled) == expected

    db.refresh(other)
    assert other.daily_report_enabled is True
    assert other.weekly_report_enabled is True


@pytest.mark.parametrize("method", ["get", "patch"])
def test_report_preferences_require_authentication(method: str) -> None:
    # A fresh client prevents a cookie from an earlier login authenticating this request.
    from app.main import app

    with TestClient(app) as client:
        response = client.request(method, URL, json={})
    assert response.status_code == 401


@pytest.mark.parametrize(
    "body",
    [
        {"daily_report_enabled": None},
        {"weekly_report_enabled": "false"},
        {"daily_report_enabled": 0},
        {"user_id": "another-user", "daily_report_enabled": False},
        {"is_superuser": True},
    ],
)
def test_report_preferences_reject_invalid_values_and_other_fields(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    body: dict[str, object],
) -> None:
    response = client.patch(URL, headers=normal_user_token_headers, json=body)
    assert response.status_code == 422
