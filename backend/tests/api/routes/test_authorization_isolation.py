"""End-to-end authorization boundaries using signed tokens and real database state."""

from __future__ import annotations

import json
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.security import create_access_token
from app.domain import BillingPeriod, LedgerAccessRole, ObligationKey
from app.models import (
    Category,
    CategoryGroup,
    Counterparty,
    IntegrationCredential,
    Ledger,
    Obligation,
    ObligationComponent,
    User,
)
from app.models.base import Base
from app.use_cases import categories, ledgers, obligations
from tests.utils.ledger_domain import create_test_ledger
from tests.utils.user import create_random_user

SCHEMA = {
    "type": "object",
    "properties": {"private_value": {"type": "string"}},
    "required": ["private_value"],
    "additionalProperties": False,
}
ROLES = (
    "owner",
    "editor",
    "viewer",
    "unrelated",
    "inactive",
    "integration",
    "anonymous",
)
MEMBERS = {"owner", "editor", "viewer"}
EDITORS = {"owner", "editor"}


@dataclass
class Resources:
    ledger: Ledger
    group: CategoryGroup
    category: Category
    obligation: Obligation
    component: ObligationComponent
    integration: dict[str, Any]
    key_headers: dict[str, str]
    marker: str

    @property
    def root(self) -> str:
        return f"/ledgers/{self.ledger.id}"

    @property
    def obligation_path(self) -> str:
        return f"{self.root}/obligations/{self.obligation.business_key}"

    @property
    def category_path(self) -> str:
        return f"{self.root}/categories/{self.category.id}"

    @property
    def integration_path(self) -> str:
        return f"{self.root}/integrations/{self.integration['integration']['id']}"


def token_headers(user: User) -> dict[str, str]:
    token = create_access_token(
        user.id, timedelta(minutes=30), session_version=user.session_version
    )
    return {"Authorization": f"Bearer {token}"}


def build_resources(client: TestClient, db: Session) -> Resources:
    ledger = create_test_ledger(db)
    group = categories.create_category_group(
        session=db, ledger_id=ledger.id, name="Authorization"
    )
    marker = f"private-{uuid.uuid4()}"
    # Deliberately collide business keys between ledgers; a global key lookup
    # must never return or update the other tenant's obligation.
    category = categories.create_category(
        session=db,
        ledger_id=ledger.id,
        category_group_id=group.id,
        name=marker,
        code="AUTH",
    )
    obligation = obligations.create_manual_obligation(
        session=db,
        ledger_id=ledger.id,
        category_code=category.code,
        period=BillingPeriod(2026, 11),
        notes=marker,
    )
    component = obligations.add_obligation_component(
        session=db,
        ledger_id=ledger.id,
        key=ObligationKey.parse(obligation.business_key),
        type="monthly_fee",
        label=marker,
        amount=Decimal("10.00"),
    )
    categories.set_category_data_schema(
        session=db, ledger_id=ledger.id, category_id=category.id, schema=SCHEMA
    )
    categories.create_category_data_record(
        session=db,
        ledger_id=ledger.id,
        category_id=category.id,
        observed_at=datetime.now(UTC),
        data={"private_value": marker},
    )
    response = client.post(
        f"{settings.API_V1_STR}/ledgers/{ledger.id}/integrations",
        headers=token_headers(ledger.owner),
        json={"name": marker, "category_id": str(category.id)},
    )
    assert response.status_code == 201, response.text
    integration = response.json()
    return Resources(
        ledger,
        group,
        category,
        obligation,
        component,
        integration,
        {"Authorization": f"Bearer {integration['connection_key']}"},
        marker,
    )


@dataclass
class World:
    own: Resources
    foreign: Resources
    sibling: Category
    sibling_obligation: Obligation
    sibling_integration: dict[str, Any]
    headers: dict[str, dict[str, str]]
    counterparty: Counterparty


@pytest.fixture(scope="module")
def world(client: TestClient, db: Session) -> World:
    own = build_resources(client, db)
    foreign = build_resources(client, db)
    headers = {
        "owner": token_headers(own.ledger.owner),
        "unrelated": token_headers(foreign.ledger.owner),
        "integration": own.key_headers,
        "anonymous": {},
    }
    for name, role in (
        ("editor", LedgerAccessRole.EDITOR),
        ("viewer", LedgerAccessRole.VIEWER),
    ):
        user = create_random_user(db)
        ledgers.share_ledger(
            session=db, ledger_id=own.ledger.id, target_user_id=user.id, role=role
        )
        headers[name] = token_headers(user)
    inactive = create_random_user(db)
    ledgers.share_ledger(
        session=db,
        ledger_id=own.ledger.id,
        target_user_id=inactive.id,
        role=LedgerAccessRole.EDITOR,
    )
    inactive.is_active = False
    db.commit()
    headers["inactive"] = token_headers(inactive)
    sibling = categories.create_category(
        session=db,
        ledger_id=own.ledger.id,
        category_group_id=own.group.id,
        name=f"sibling-{uuid.uuid4()}",
        code="SIDE",
    )
    sibling_obligation = obligations.create_manual_obligation(
        session=db,
        ledger_id=own.ledger.id,
        category_code=sibling.code,
        period=BillingPeriod(2026, 11),
        notes="sibling-private",
    )
    response = client.post(
        f"{settings.API_V1_STR}{own.root}/integrations",
        headers=headers["owner"],
        json={"name": "Sibling integration", "category_id": str(sibling.id)},
    )
    assert response.status_code == 201, response.text
    counterparty = Counterparty(name=f"shared-dictionary-{uuid.uuid4()}")
    db.add(counterparty)
    db.commit()
    db.refresh(counterparty)
    own.category.counterparty_id = counterparty.id
    db.commit()
    return World(
        own,
        foreign,
        sibling,
        sibling_obligation,
        response.json(),
        headers,
        counterparty,
    )


def database_state(db: Session) -> dict[str, list[str]]:
    """Include audit rows and credentials; ignore only key usage telemetry."""
    db.expire_all()
    result = {}
    for table in Base.metadata.sorted_tables:
        columns = [
            c
            for c in table.c
            if not (table.name == "integration_credential" and c.name == "last_used_at")
        ]
        result[table.name] = sorted(
            json.dumps(dict(row), sort_keys=True, default=str)
            for row in db.execute(select(*columns)).mappings()
        )
    return result


def assert_denied(response: Any, world: World, *, inactive: bool = False) -> None:
    assert response.status_code in (
        {400, 401, 403, 404} if inactive else {401, 403, 404}
    ), response.text
    assert set(response.json()) == {"detail", "code", "params"}
    for secret in (
        world.own.marker,
        world.foreign.marker,
        "sibling-private",
        world.own.integration["connection_key"],
        world.foreign.integration["connection_key"],
    ):
        assert secret not in response.text


READS = (
    "ledger",
    "members",
    "obligations",
    "obligation",
    "components",
    "actions",
    "groups",
    "categories",
    "schema",
    "records",
    "latest",
    "csv",
    "category_counterparty",
    "obligation_counterparty",
    "analytics",
    "history",
    "integrations",
    "integration",
    "runs",
)


def read_path(r: Resources, endpoint: str) -> str:
    return {
        "ledger": r.root,
        "members": f"{r.root}/members",
        "obligations": f"{r.root}/obligations",
        "obligation": r.obligation_path,
        "components": f"{r.obligation_path}/components",
        "actions": f"{r.obligation_path}/actions",
        "groups": f"{r.root}/category-groups",
        "categories": f"{r.root}/categories",
        "schema": f"{r.category_path}/data-schema",
        "records": f"{r.category_path}/data-records",
        "latest": f"{r.category_path}/data-records/latest",
        "csv": f"{r.category_path}/data-records.csv?schema_version=1",
        "category_counterparty": f"{r.category_path}/counterparty/obligations",
        "obligation_counterparty": f"{r.obligation_path}/counterparty",
        "analytics": f"{r.root}/analytics/period-summary?year=2026&month=11",
        "history": f"{r.root}/analytics/categories/{r.category.id}/history?from=2026-11&to=2026-11",
        "integrations": f"{r.root}/integrations",
        "integration": r.integration_path,
        "runs": f"{r.integration_path}/runs",
    }[endpoint]


@pytest.mark.parametrize("role", ROLES)
@pytest.mark.parametrize("endpoint", READS)
def test_ledger_read_matrix(
    client: TestClient, db: Session, world: World, role: str, endpoint: str
) -> None:
    before = database_state(db)
    response = client.get(
        f"{settings.API_V1_STR}{read_path(world.own, endpoint)}",
        headers=world.headers[role],
    )
    if role in (EDITORS if endpoint == "category_counterparty" else MEMBERS):
        assert response.status_code == 200, response.text
        assert world.foreign.marker not in response.text
        assert world.own.integration["connection_key"] not in response.text
        assert world.foreign.integration["connection_key"] not in response.text
    else:
        assert_denied(response, world, inactive=role == "inactive")
    assert database_state(db) == before


WRITES = (
    "obligation",
    "component",
    "category",
    "category_counterparty",
    "schema",
    "ledger",
    "integration",
    "credentials",
)


def write_request(
    world: World, operation: str, role: str
) -> tuple[str, str, dict[str, Any] | None]:
    r = world.own
    requests: dict[str, tuple[str, str, dict[str, Any] | None]] = {
        "obligation": ("PATCH", r.obligation_path, {"notes": f"updated-{role}"}),
        "component": (
            "PATCH",
            f"{r.obligation_path}/components/{r.component.id}",
            {"amount": "12.50"},
        ),
        "category": (
            "PATCH",
            r.category_path,
            {"name": f"updated-{role}", "data_source_policy": "hybrid"},
        ),
        "category_counterparty": (
            "PATCH",
            f"{r.category_path}/counterparty",
            {"counterparty_id": str(world.counterparty.id)},
        ),
        "schema": ("POST", f"{r.category_path}/data-schema", {"schema": SCHEMA}),
        "ledger": (
            "PATCH",
            r.root,
            {"description": f"updated-{role}", "name": "Authorization matrix"},
        ),
        "integration": (
            "PATCH",
            r.integration_path,
            {"expected_revision": 0, "name": "Owner update"},
        ),
        "credentials": ("POST", f"{r.integration_path}/credentials", None),
    }
    return requests[operation]


@pytest.mark.parametrize("role", ROLES)
@pytest.mark.parametrize("operation", WRITES)
def test_ledger_write_matrix(
    client: TestClient, db: Session, world: World, role: str, operation: str
) -> None:
    before = database_state(db)
    method, path, payload = write_request(world, operation, role)
    if operation == "integration" and payload is not None:
        current = client.get(
            f"{settings.API_V1_STR}{world.own.integration_path}",
            headers=world.headers["owner"],
        )
        assert current.status_code == 200
        payload["expected_revision"] = current.json()["revision"]
    response = client.request(
        method,
        f"{settings.API_V1_STR}{path}",
        headers=world.headers[role],
        json=payload,
    )
    allowed = (
        {"owner"} if operation in {"ledger", "integration", "credentials"} else EDITORS
    )
    if role in allowed:
        assert response.status_code in {200, 201}, response.text
    else:
        assert_denied(response, world, inactive=role == "inactive")
        assert database_state(db) == before


NESTED_READS = (
    "schema",
    "records",
    "latest",
    "csv",
    "category_counterparty",
    "history",
    "integration",
    "runs",
)


@pytest.mark.parametrize("role", sorted(MEMBERS))
@pytest.mark.parametrize("endpoint", NESTED_READS)
def test_foreign_nested_resource_under_accessible_ledger(
    client: TestClient, db: Session, world: World, role: str, endpoint: str
) -> None:
    before = database_state(db)
    path = read_path(world.foreign, endpoint).replace(
        world.foreign.root, world.own.root
    )
    response = client.get(f"{settings.API_V1_STR}{path}", headers=world.headers[role])
    assert_denied(response, world)
    assert database_state(db) == before


@pytest.mark.parametrize(
    "operation",
    [
        "component_patch",
        "component_delete",
        "category_patch",
        "category_archive",
        "group_patch",
        "group_create_category",
        "assign_group",
        "schema",
        "counterparty",
        "integration_create",
        "integration_patch",
        "credential_create",
        "credential_revoke",
        "sibling_credential_revoke",
    ],
)
def test_foreign_nested_writes_leave_all_rows_unchanged(
    client: TestClient, db: Session, world: World, operation: str
) -> None:
    a, b = world.own, world.foreign
    foreign_category = f"{a.root}/categories/{b.category.id}"
    foreign_integration = f"{a.root}/integrations/{b.integration['integration']['id']}"
    method, path, payload = {
        "component_patch": (
            "PATCH",
            f"{a.obligation_path}/components/{b.component.id}",
            {"amount": "999"},
        ),
        "component_delete": (
            "DELETE",
            f"{a.obligation_path}/components/{b.component.id}",
            None,
        ),
        "category_patch": (
            "PATCH",
            foreign_category,
            {"name": "Intrusion", "data_source_policy": "hybrid"},
        ),
        "category_archive": ("PATCH", f"{foreign_category}/archive", None),
        "group_patch": (
            "PATCH",
            f"{a.root}/category-groups/{b.group.id}",
            {"name": "Intrusion"},
        ),
        "group_create_category": (
            "POST",
            f"{a.root}/categories",
            {"category_group_id": str(b.group.id), "code": "EVIL", "name": "Intrusion"},
        ),
        "assign_group": (
            "PATCH",
            a.category_path,
            {
                "category_group_id": str(b.group.id),
                "name": "Intrusion",
                "data_source_policy": "hybrid",
            },
        ),
        "schema": ("POST", f"{foreign_category}/data-schema", {"schema": SCHEMA}),
        "counterparty": (
            "PATCH",
            f"{foreign_category}/counterparty",
            {"counterparty_id": str(world.counterparty.id)},
        ),
        "integration_create": (
            "POST",
            f"{a.root}/integrations",
            {"name": "Intrusion", "category_id": str(b.category.id)},
        ),
        "integration_patch": (
            "PATCH",
            foreign_integration,
            {"expected_revision": 0, "name": "Intrusion"},
        ),
        "credential_create": ("POST", f"{foreign_integration}/credentials", None),
        "credential_revoke": (
            "DELETE",
            f"{a.integration_path}/credentials/{b.integration['credential']['id']}",
            None,
        ),
        "sibling_credential_revoke": (
            "DELETE",
            f"{a.integration_path}/credentials/{world.sibling_integration['credential']['id']}",
            None,
        ),
    }[operation]
    before = database_state(db)
    response = client.request(
        method,
        f"{settings.API_V1_STR}{path}",
        headers=world.headers["owner"],
        json=payload,
    )
    assert_denied(response, world)
    assert database_state(db) == before


@pytest.mark.parametrize(
    "method,suffix,payload",
    [
        ("GET", "", None),
        ("GET", "/components", None),
        ("PATCH", "", {"current_amount": "999"}),
        (
            "PUT",
            "/components/upsert",
            {
                "type": "usage",
                "label": "Intrusion",
                "external_id": "intrusion",
                "amount": "999",
            },
        ),
        ("POST", "/notes", {"text": "Intrusion"}),
        ("PATCH", "/ready", None),
        ("POST", "/mark-paid", None),
        ("POST", "/cancel", None),
        ("POST", "/reopen", None),
    ],
)
def test_integration_cannot_address_sibling_category(
    client: TestClient,
    db: Session,
    world: World,
    method: str,
    suffix: str,
    payload: dict[str, Any] | None,
) -> None:
    before = database_state(db)
    response = client.request(
        method,
        f"{settings.API_V1_STR}/integration/obligations/{world.sibling_obligation.business_key}{suffix}",
        headers=world.own.key_headers,
        json=payload,
    )
    assert_denied(response, world)
    assert database_state(db) == before


def test_integration_key_resolves_colliding_keys_only_inside_its_ledger(
    client: TestClient, world: World
) -> None:
    assert world.own.obligation.business_key == world.foreign.obligation.business_key
    for r, other in ((world.own, world.foreign), (world.foreign, world.own)):
        response = client.get(
            f"{settings.API_V1_STR}/integration/obligations/2026-11",
            headers=r.key_headers,
        )
        assert response.status_code == 200, response.text
        assert response.json()["notes"] != other.marker
        assert response.json()["ledger_id"] == str(r.ledger.id)
        assert response.json()["id"] == str(r.obligation.id)
        records = client.get(
            f"{settings.API_V1_STR}/integration/category/data-records",
            headers=r.key_headers,
        )
        assert records.status_code == 200
        assert records.json()["data"][0]["data"] == {"private_value": r.marker}
        components = client.get(
            f"{settings.API_V1_STR}/integration/obligations/2026-11/components",
            headers=r.key_headers,
        )
        assert components.status_code == 200
        assert str(r.component.id) in components.text
        assert str(other.component.id) not in components.text


@pytest.mark.parametrize(
    "payload",
    [
        {"ledger_id": "foreign"},
        {"category_id": "foreign"},
        {"integration_id": "foreign"},
    ],
)
def test_integration_data_write_rejects_scope_overrides(
    client: TestClient, db: Session, world: World, payload: dict[str, Any]
) -> None:
    field = next(iter(payload))
    ids = {
        "ledger_id": world.foreign.ledger.id,
        "category_id": world.sibling.id,
        "integration_id": world.sibling_integration["integration"]["id"],
    }
    before = database_state(db)
    response = client.post(
        f"{settings.API_V1_STR}/integration/category/data-records",
        headers=world.own.key_headers,
        json={
            "observed_at": "2026-11-21T12:00:00Z",
            "data": {"private_value": "attempt"},
            field: str(ids[field]),
        },
    )
    assert response.status_code == 422, response.text
    assert database_state(db) == before


@pytest.mark.parametrize("state", ["revoked", "expired"])
@pytest.mark.parametrize(
    "operation",
    [
        "read",
        "obligation_read",
        "records_read",
        "schema_read",
        "data",
        "component",
        "run_start",
        "run_finish",
    ],
)
def test_inactive_integration_keys_do_not_read_or_write(
    client: TestClient, db: Session, world: World, state: str, operation: str
) -> None:
    # Reuse an isolated rotated key; never revoke the fixture's active key.
    created = client.post(
        f"{settings.API_V1_STR}{world.own.integration_path}/credentials",
        headers=world.headers["owner"],
    )
    assert created.status_code == 201
    key = db.get(IntegrationCredential, uuid.UUID(created.json()["credential"]["id"]))
    assert key is not None
    if state == "revoked":
        key.revoked_at = datetime.now(UTC)
    else:
        key.expires_at = datetime.now(UTC) - timedelta(seconds=1)
    db.commit()
    requests: dict[str, tuple[str, str, dict[str, Any] | None]] = {
        "read": ("GET", "/context", None),
        "obligation_read": ("GET", "/obligations/2026-11", None),
        "records_read": ("GET", "/category/data-records", None),
        "schema_read": ("GET", "/category/schema", None),
        "data": (
            "POST",
            "/category/data-records",
            {
                "observed_at": "2026-11-21T12:00:00Z",
                "data": {"private_value": "attempt"},
            },
        ),
        "component": (
            "PUT",
            "/obligations/2026-11/components/upsert",
            {
                "type": "usage",
                "label": "attempt",
                "external_id": "attempt",
                "amount": "999",
            },
        ),
        "run_start": (
            "POST",
            "/runs/start",
            {"run_id": str(uuid.uuid4()), "expected_revision": 0},
        ),
        "run_finish": (
            "POST",
            "/runs/finish",
            {
                "run_id": str(uuid.uuid4()),
                "result": "success",
                "changes_detected": False,
                "error": None,
            },
        ),
    }
    method, suffix, payload = requests[operation]
    before = database_state(db)
    response = client.request(
        method,
        f"{settings.API_V1_STR}/integration{suffix}",
        headers={"Authorization": f"Bearer {created.json()['connection_key']}"},
        json=payload,
    )
    assert response.status_code == 401, response.text
    assert_denied(response, world)
    assert database_state(db) == before


@pytest.mark.parametrize("role", ROLES)
@pytest.mark.parametrize(
    "method,path,payload",
    [
        ("GET", "/users/", None),
        ("PATCH", "/users/{foreign_user_id}", {"is_superuser": True}),
        ("GET", "/system-runs/", None),
        ("GET", "/system-runs/tasks", None),
        ("POST", "/system-runs/", {}),
        ("POST", "/counterparties", {"name": "Intrusion"}),
    ],
)
def test_admin_endpoints_reject_non_superusers(
    client: TestClient,
    db: Session,
    world: World,
    role: str,
    method: str,
    path: str,
    payload: dict[str, Any] | None,
) -> None:
    path = path.replace("{foreign_user_id}", str(world.foreign.ledger.owner_user_id))
    before = database_state(db)
    response = client.request(
        method,
        f"{settings.API_V1_STR}{path}",
        headers=world.headers[role],
        json=payload,
    )
    assert_denied(response, world, inactive=role == "inactive")
    assert database_state(db) == before


@pytest.mark.parametrize("role", ROLES)
def test_global_counterparty_dictionary_is_readable_but_not_mutable(
    client: TestClient, db: Session, world: World, role: str
) -> None:
    path = f"{settings.API_V1_STR}/counterparties/{world.counterparty.id}"
    response = client.get(path, headers=world.headers[role])
    if role in MEMBERS | {"unrelated"}:
        assert response.status_code == 200
        assert response.json()["id"] == str(world.counterparty.id)
    else:
        assert_denied(response, world, inactive=role == "inactive")
    before = database_state(db)
    for method, payload in (("PATCH", {"name": "Intrusion"}), ("DELETE", None)):
        response = client.request(
            method, path, headers=world.headers[role], json=payload
        )
        assert_denied(response, world, inactive=role == "inactive")
    assert database_state(db) == before


def test_integration_mutation_changes_only_bound_obligation(
    client: TestClient, db: Session, world: World
) -> None:
    foreign_before = client.get(
        f"{settings.API_V1_STR}{world.foreign.obligation_path}",
        headers=world.headers["unrelated"],
    )
    assert foreign_before.status_code == 200
    sibling_before = client.get(
        f"{settings.API_V1_STR}{world.own.root}/obligations/{world.sibling_obligation.business_key}",
        headers=world.headers["owner"],
    )
    assert sibling_before.status_code == 200
    response = client.patch(
        f"{settings.API_V1_STR}/integration/obligations/2026-11",
        headers=world.own.key_headers,
        json={"current_amount": "876.54"},
    )
    assert response.status_code == 200, response.text
    db.refresh(world.own.obligation)
    assert world.own.obligation.current_amount == Decimal("876.54")
    foreign_after = client.get(
        f"{settings.API_V1_STR}{world.foreign.obligation_path}",
        headers=world.headers["unrelated"],
    )
    sibling_after = client.get(
        f"{settings.API_V1_STR}{world.own.root}/obligations/{world.sibling_obligation.business_key}",
        headers=world.headers["owner"],
    )
    assert foreign_after.json() == foreign_before.json()
    assert sibling_after.json() == sibling_before.json()


@pytest.mark.parametrize("target", ["foreign_ledger", "sibling_integration"])
def test_integration_run_id_cannot_finish_another_integrations_run(
    client: TestClient, db: Session, world: World, target: str
) -> None:
    other_key = (
        world.foreign.key_headers
        if target == "foreign_ledger"
        else {"Authorization": f"Bearer {world.sibling_integration['connection_key']}"}
    )
    keys = [world.own.key_headers, other_key]
    run_ids = [str(uuid.uuid4()), str(uuid.uuid4())]
    for headers, run_id in zip(keys, run_ids, strict=True):
        context = client.get(
            f"{settings.API_V1_STR}/integration/context", headers=headers
        )
        assert context.status_code == 200
        started = client.post(
            f"{settings.API_V1_STR}/integration/runs/start",
            headers=headers,
            json={
                "run_id": run_id,
                "expected_revision": context.json()["integration"]["revision"],
            },
        )
        assert started.status_code == 200, started.text
    before = database_state(db)
    finish = {
        "run_id": run_ids[1],
        "result": "success",
        "changes_detected": False,
        "error": None,
    }
    response = client.post(
        f"{settings.API_V1_STR}/integration/runs/finish",
        headers=world.own.key_headers,
        json=finish,
    )
    assert response.status_code == 409, response.text
    assert world.foreign.marker not in response.text
    assert database_state(db) == before
    # Both original credentials can finish their own runs after the rejected attack.
    for headers, run_id in zip(keys, run_ids, strict=True):
        finished = client.post(
            f"{settings.API_V1_STR}/integration/runs/finish",
            headers=headers,
            json={**finish, "run_id": run_id},
        )
        assert finished.status_code == 200, finished.text
