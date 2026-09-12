from __future__ import annotations

import uuid
from datetime import UTC, datetime

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.config import settings
from app.domain import BillingPeriod
from app.use_cases import categories as category_use_cases
from app.use_cases import obligations as obligation_use_cases
from tests.utils.ledger_domain import create_category_tree
from tests.utils.user import authentication_token_from_email


def _create_integration(
    client: TestClient, db: Session
) -> tuple[dict[str, object], dict[str, str], object, object]:
    ledger, group, category = create_category_tree(db)
    headers = authentication_token_from_email(
        client=client, email=ledger.owner.email, db=db
    )
    response = client.post(
        f"{settings.API_V1_STR}/ledgers/{ledger.id}/integrations",
        headers=headers,
        json={"name": "Meter", "category_id": str(category.id)},
    )
    assert response.status_code == 201, response.text
    return response.json(), headers, ledger, category


def test_creation_returns_secret_once_and_context_is_credential_scoped(
    client: TestClient, db: Session
) -> None:
    created, headers, ledger, category = _create_integration(client, db)
    assert set(created) == {"integration", "credential", "connection_key"}
    integration = created["integration"]
    assert integration["category_id"] == str(category.id)
    assert "key" not in integration and "provider" not in integration
    connection_headers = {"Authorization": f"Bearer {created['connection_key']}"}
    context = client.get(
        f"{settings.API_V1_STR}/integration/context", headers=connection_headers
    )
    assert context.status_code == 200
    assert context.json() == {
        "integration": {
            "id": integration["id"],
            "name": "Meter",
            "enabled": True,
            "revision": 0,
        },
        "category": {
            "id": str(category.id),
            "code": category.code,
            "name": category.name,
        },
    }
    listed = client.get(
        f"{settings.API_V1_STR}/ledgers/{ledger.id}/integrations", headers=headers
    )
    assert "connection_key" not in listed.json()["data"][0]


def test_rotation_preserves_health_and_revocation_invalidates_only_that_key(
    client: TestClient, db: Session
) -> None:
    created, headers, ledger, _ = _create_integration(client, db)
    integration = created["integration"]
    first = {"Authorization": f"Bearer {created['connection_key']}"}
    started = client.post(
        f"{settings.API_V1_STR}/integration/runs/start",
        headers=first,
        json={"run_id": str(uuid.uuid4()), "expected_revision": 0},
    )
    assert started.status_code == 200
    rotated = client.post(
        f"{settings.API_V1_STR}/ledgers/{ledger.id}/integrations/{integration['id']}/credentials",
        headers=headers,
    )
    assert rotated.status_code == 201
    assert rotated.json()["connection_key"] != created["connection_key"]
    assert (
        client.get(
            f"{settings.API_V1_STR}/integration/context", headers=first
        ).status_code
        == 200
    )
    revoke = client.delete(
        f"{settings.API_V1_STR}/ledgers/{ledger.id}/integrations/{integration['id']}/credentials/{created['credential']['id']}",
        headers=headers,
    )
    assert revoke.status_code == 200
    assert (
        client.get(
            f"{settings.API_V1_STR}/integration/context", headers=first
        ).status_code
        == 401
    )
    second = {"Authorization": f"Bearer {rotated.json()['connection_key']}"}
    refreshed = client.get(
        f"{settings.API_V1_STR}/ledgers/{ledger.id}/integrations/{integration['id']}",
        headers=headers,
    )
    assert refreshed.json()["health"] == "running"
    assert (
        client.get(
            f"{settings.API_V1_STR}/integration/context", headers=second
        ).status_code
        == 200
    )


def test_credential_cannot_access_another_category_obligation(
    client: TestClient, db: Session
) -> None:
    created, _, ledger, category = _create_integration(client, db)
    other = category_use_cases.create_category(
        session=db,
        ledger_id=ledger.id,
        category_group_id=category.category_group_id,
        name="Other",
        code="OTHR",
    )
    obligation = obligation_use_cases.create_manual_obligation(
        session=db,
        ledger_id=ledger.id,
        category_code=other.code,
        period=BillingPeriod(2026, 8),
    )
    connection_headers = {"Authorization": f"Bearer {created['connection_key']}"}
    listed = client.get(
        f"{settings.API_V1_STR}/integration/obligations", headers=connection_headers
    )
    assert listed.status_code == 200 and listed.json()["count"] == 0
    response = client.get(
        f"{settings.API_V1_STR}/integration/obligations/{obligation.business_key}",
        headers=connection_headers,
    )
    assert response.status_code == 404


def test_integration_derives_category_data_and_component_source_from_context(
    client: TestClient, db: Session
) -> None:
    created, _, ledger, category = _create_integration(client, db)
    category_use_cases.set_category_data_schema(
        session=db,
        ledger_id=ledger.id,
        category_id=category.id,
        schema={
            "type": "object",
            "properties": {"reading": {"type": "number"}},
            "required": ["reading"],
        },
    )
    obligation = obligation_use_cases.create_manual_obligation(
        session=db,
        ledger_id=ledger.id,
        category_code=category.code,
        period=BillingPeriod(2026, 8),
    )
    connection_headers = {"Authorization": f"Bearer {created['connection_key']}"}

    rejected_data = client.post(
        f"{settings.API_V1_STR}/integration/category/data-records",
        headers=connection_headers,
        json={
            "observed_at": datetime(2026, 8, 1, tzinfo=UTC).isoformat(),
            "data": {"reading": 10},
            "source": "forged-source",
        },
    )
    assert rejected_data.status_code == 422

    category_data = client.post(
        f"{settings.API_V1_STR}/integration/category/data-records",
        headers=connection_headers,
        json={
            "observed_at": datetime(2026, 8, 1, tzinfo=UTC).isoformat(),
            "data": {"reading": 10},
            "external_id": "reading-1",
        },
    )
    assert category_data.status_code == 200
    assert category_data.json()["source"] == "Meter"

    component_url = (
        f"{settings.API_V1_STR}/integration/obligations/"
        f"{obligation.business_key}/components/upsert"
    )
    rejected_component = client.put(
        component_url,
        headers=connection_headers,
        json={
            "type": "invoice",
            "label": "August invoice",
            "external_id": "FV/2026/08/12345",
            "source": "forged-source",
        },
    )
    assert rejected_component.status_code == 422

    component = client.put(
        component_url,
        headers=connection_headers,
        json={
            "type": "invoice",
            "label": "August invoice",
            "external_id": "FV/2026/08/12345",
        },
    )
    assert component.status_code == 200
    assert component.json()["source"] == "Meter"
