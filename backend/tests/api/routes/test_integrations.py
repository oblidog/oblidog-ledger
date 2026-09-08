import uuid
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.config import settings
from app.domain import LedgerAccessRole
from app.models import ApiKey, Ledger, User
from app.schemas.integrations import IntegrationConflictResponse
from app.use_cases import ledgers as ledger_uc
from tests.utils.ledger_domain import create_category_tree
from tests.utils.user import authentication_token_from_email, create_random_user


@pytest.fixture
def setup(
    client: TestClient, db: Session
) -> tuple[Ledger, dict[str, str], dict[str, str]]:
    ledger, _, _ = create_category_tree(db)
    owner = db.get(User, ledger.owner_user_id)
    assert owner is not None
    jwt = authentication_token_from_email(client=client, email=owner.email, db=db)
    response = client.post(
        f"{settings.API_V1_STR}/ledgers/{ledger.id}/api-keys",
        headers=jwt,
        json={"name": "Shared runner key", "scopes": ["ledger:read", "ledger:write"]},
    )
    assert response.status_code == 200
    return ledger, jwt, {"Authorization": f"Bearer {response.json()['key']}"}


def create(
    client: TestClient,
    ledger: Ledger,
    jwt: dict[str, str],
    key: str = "nju-mario",
    **extra: Any,
) -> dict[str, Any]:
    response = client.post(
        f"{settings.API_V1_STR}/ledgers/{ledger.id}/integrations",
        headers=jwt,
        json={"key": key, "provider": "nju", "name": "Phone", **extra},
    )
    assert response.status_code == 201, response.text
    return response.json()


def test_shared_key_independent_instances_and_rotation(
    client: TestClient,
    db: Session,
    setup: tuple[Ledger, dict[str, str], dict[str, str]],
) -> None:
    ledger, jwt, api = setup
    first = create(client, ledger, jwt)
    second = create(client, ledger, jwt, "nju-second")
    prefix = f"{settings.API_V1_STR}/integration/instances"
    run = str(uuid.uuid4())
    response = client.post(
        f"{prefix}/nju-mario/start",
        headers=api,
        json={"run_id": run, "expected_revision": 0},
    )
    assert response.status_code == 200
    assert response.json()["health"] == "running"
    assert response.json()["current_deadline_at"] is not None
    response = client.post(
        f"{prefix}/nju-mario/finish",
        headers=api,
        json={
            "run_id": run,
            "result": "success",
            "changes_detected": False,
            "error": None,
        },
    )
    assert response.status_code == 200 and response.json()["health"] == "healthy"
    assert response.json()["last_success_at"] is not None
    assert (
        client.get(f"{prefix}/nju-second", headers=api).json()["health"] == "never_run"
    )
    key_response = client.post(
        f"{settings.API_V1_STR}/ledgers/{ledger.id}/api-keys",
        headers=jwt,
        json={"name": "Rotated", "scopes": ["ledger:read"]},
    )
    rotated = {"Authorization": f"Bearer {key_response.json()['key']}"}
    assert (
        client.get(f"{prefix}/nju-mario", headers=rotated).json()["id"] == first["id"]
    )
    assert (
        client.get(f"{prefix}/nju-second", headers=rotated).json()["id"] == second["id"]
    )
    assert (
        client.post(
            f"{prefix}/nju-second/start",
            headers=rotated,
            json={"run_id": str(uuid.uuid4()), "expected_revision": 0},
        ).status_code
        == 403
    )
    key = db.get(ApiKey, uuid.UUID(key_response.json()["id"]))
    assert key is not None and key.ledger_id == ledger.id


def test_owner_management_viewers_and_tenant_isolation(
    client: TestClient,
    db: Session,
    setup: tuple[Ledger, dict[str, str], dict[str, str]],
) -> None:
    ledger, jwt, api = setup
    item = create(client, ledger, jwt)
    base = f"{settings.API_V1_STR}/ledgers/{ledger.id}/integrations"
    assert client.get(base, headers=jwt, params={"limit": 1, "offset": 1}).json() == {
        "data": [],
        "count": 1,
    }
    assert client.get(base, headers=jwt, params={"limit": 0}).status_code == 422
    for role in (LedgerAccessRole.VIEWER, LedgerAccessRole.EDITOR):
        member = create_random_user(db)
        ledger_uc.share_ledger(
            session=db, ledger_id=ledger.id, target_user_id=member.id, role=role
        )
        member_headers = authentication_token_from_email(
            client=client, email=member.email, db=db
        )
        assert client.get(base, headers=member_headers).status_code == 200
        assert (
            client.get(f"{base}/{item['id']}", headers=member_headers).status_code
            == 200
        )
        assert (
            client.patch(
                f"{base}/{item['id']}",
                headers=member_headers,
                json={"expected_revision": 0, "enabled": False},
            ).status_code
            == 404
        )
        assert (
            client.post(
                base,
                headers=member_headers,
                json={"key": "new", "provider": "nju", "name": "New"},
            ).status_code
            == 404
        )
    other, _, category = create_category_tree(db)
    foreign_base = f"{settings.API_V1_STR}/ledgers/{other.id}/integrations"
    assert client.get(foreign_base, headers=jwt).status_code == 404
    assert client.get(f"{foreign_base}/{item['id']}", headers=jwt).status_code == 404
    assert (
        client.patch(
            f"{base}/{item['id']}",
            headers=jwt,
            json={"expected_revision": 0, "category_ids": [str(category.id)]},
        ).status_code
        == 404
    )
    assert (
        client.post(
            base,
            headers=jwt,
            json={
                "key": "foreign",
                "provider": "nju",
                "name": "Foreign",
                "category_ids": [str(category.id)],
            },
        ).status_code
        == 404
    )
    assert (
        client.get(
            f"{settings.API_V1_STR}/integration/instances/missing", headers=api
        ).status_code
        == 404
    )
    response = client.get(
        f"{settings.API_V1_STR}/integration/instances/nju-mario?ledger_id={other.id}",
        headers=api,
    )
    assert response.json()["ledger_id"] == str(ledger.id)
    response = client.patch(
        f"{base}/{item['id']}",
        headers=jwt,
        json={"expected_revision": 0, "name": "Renamed", "category_ids": []},
    )
    assert response.status_code == 200 and response.json()["revision"] == 1
    assert client.get(f"{base}/{uuid.uuid4()}", headers=jwt).status_code == 404


@pytest.mark.parametrize(
    "extra",
    [
        {"key": "UPPER"},
        {"provider": "has spaces"},
        {"name": " "},
        {"enabled": "true"},
        {"run_timeout_seconds": 0},
        {"run_timeout_seconds": 100, "stale_after_seconds": 100},
        {"stale_after_seconds": 2147483648},
        {"current_run_id": str(uuid.uuid4())},
    ],
)
def test_reject_invalid_creation(
    client: TestClient,
    setup: tuple[Ledger, dict[str, str], dict[str, str]],
    extra: dict[str, Any],
) -> None:
    ledger, jwt, _ = setup
    response = client.post(
        f"{settings.API_V1_STR}/ledgers/{ledger.id}/integrations",
        headers=jwt,
        json={"key": "valid", "provider": "nju", "name": "Phone", **extra},
    )
    assert response.status_code == 422


def test_conflicts_and_invalid_reports(
    client: TestClient, setup: tuple[Ledger, dict[str, str], dict[str, str]]
) -> None:
    ledger, jwt, api = setup
    item = create(client, ledger, jwt)
    base = f"{settings.API_V1_STR}/ledgers/{ledger.id}/integrations"
    duplicate = client.post(
        base,
        headers=jwt,
        json={"key": "nju-mario", "provider": "nju", "name": "Duplicate"},
    )
    assert (
        duplicate.status_code == 409
        and duplicate.json()["detail"]["code"] == "duplicate_key"
    )
    for patch in (
        {"name": None},
        {"key": "changed"},
        {"provider": "other"},
        {"last_result": "success"},
    ):
        assert (
            client.patch(
                f"{base}/{item['id']}",
                headers=jwt,
                json={"expected_revision": 0, **patch},
            ).status_code
            == 422
        )
    assert (
        client.patch(
            f"{base}/{item['id']}",
            headers=jwt,
            json={"expected_revision": 0, "stale_after_seconds": 1},
        ).status_code
        == 422
    )
    response = client.patch(
        f"{base}/{item['id']}",
        headers=jwt,
        json={"expected_revision": 9, "name": "Stale"},
    )
    assert (
        response.status_code == 409
        and IntegrationConflictResponse.model_validate(response.json()).detail.code
        == "revision_conflict"
    )
    prefix = f"{settings.API_V1_STR}/integration/instances/nju-mario"
    run = str(uuid.uuid4())
    assert (
        client.post(
            f"{prefix}/start",
            headers=api,
            json={"run_id": run, "expected_revision": 0, "ledger_id": str(ledger.id)},
        ).status_code
        == 422
    )
    assert (
        client.post(
            f"{prefix}/start", headers=api, json={"run_id": run, "expected_revision": 0}
        ).status_code
        == 200
    )
    for fields in (
        {"result": "failure", "error": None},
        {"result": "success", "error": {"code": "bad", "message": "Bad"}},
        {"changes_detected": "false"},
        {"finished_at": "2099-01-01T00:00:00Z"},
        {"error": {"code": "bad", "message": "x" * 1001}},
    ):
        response = client.post(
            f"{prefix}/finish",
            headers=api,
            json={
                "run_id": run,
                "result": "success",
                "changes_detected": False,
                "error": None,
                **fields,
            },
        )
        assert response.status_code == 422
    response = client.post(
        f"{prefix}/finish",
        headers=api,
        json={
            "run_id": str(uuid.uuid4()),
            "result": "success",
            "changes_detected": False,
            "error": None,
        },
    )
    assert (
        response.status_code == 409
        and IntegrationConflictResponse.model_validate(response.json()).detail.code
        == "run_conflict"
    )
    assert client.get(prefix).status_code == 401


def test_demo_blocks_all_registry_routes(
    client: TestClient,
    setup: tuple[Ledger, dict[str, str], dict[str, str]],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    ledger, jwt, api = setup
    item = create(client, ledger, jwt)
    monkeypatch.setattr(settings, "ENVIRONMENT", "demo")
    base = f"{settings.API_V1_STR}/ledgers/{ledger.id}/integrations"
    for method, path, headers in [
        ("GET", base, jwt),
        ("POST", base, jwt),
        ("GET", f"{base}/{item['id']}", jwt),
        ("PATCH", f"{base}/{item['id']}", jwt),
        ("GET", f"{settings.API_V1_STR}/integration/instances/nju-mario", api),
        ("POST", f"{settings.API_V1_STR}/integration/instances/nju-mario/start", api),
        ("POST", f"{settings.API_V1_STR}/integration/instances/nju-mario/finish", api),
    ]:
        assert client.request(method, path, headers=headers).status_code == 403
