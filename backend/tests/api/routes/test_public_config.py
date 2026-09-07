import pytest
from fastapi.testclient import TestClient

from app.core.config import settings
from app.demo_seed import DEMO_EMAIL, DEMO_PASSWORD_ENV


def test_public_config_does_not_expose_demo_credentials_outside_demo(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "ENVIRONMENT", "local")
    monkeypatch.setenv(DEMO_PASSWORD_ENV, "public-demo-password")

    response = client.get(f"{settings.API_V1_STR}/utils/public-config")

    assert response.status_code == 200
    assert response.json() == {
        "environment": "local",
        "is_demo": False,
        "demo_credentials": None,
    }


def test_public_config_exposes_published_credentials_in_demo(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "ENVIRONMENT", "demo")
    monkeypatch.setenv(DEMO_PASSWORD_ENV, "public-demo-password")

    response = client.get(f"{settings.API_V1_STR}/utils/public-config")

    assert response.status_code == 200
    assert response.json() == {
        "environment": "demo",
        "is_demo": True,
        "demo_credentials": {
            "email": DEMO_EMAIL,
            "password": "public-demo-password",
        },
    }
