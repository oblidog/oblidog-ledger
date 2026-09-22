import uuid
from datetime import date
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.config import settings
from app.domain import (
    BillingPeriod,
    CurrentValueSource,
    DataSourcePolicy,
    LedgerAccessRole,
    ObligationLifecycle,
    RecurrenceUnit,
    ValueState,
)
from app.models import Obligation
from app.use_cases import categories as category_use_cases
from app.use_cases import ledgers as ledger_use_cases
from app.use_cases import obligations as obligation_use_cases
from tests.utils.user import authentication_token_from_email, create_random_user
from tests.utils.utils import random_lower_string


def _create_ready_obligation(db: Session, *, ledger_id: uuid.UUID) -> Obligation:
    category_group = category_use_cases.create_category_group(
        session=db, ledger_id=ledger_id, name="Group"
    )
    category_use_cases.create_category(
        session=db,
        ledger_id=ledger_id,
        category_group_id=category_group.id,
        name="Electricity",
        code="ELEC",
    )
    return obligation_use_cases.create_manual_obligation(
        session=db,
        ledger_id=ledger_id,
        category_code="ELEC",
        period=BillingPeriod(2026, 8),
        data_ready=True,
        current_amount=Decimal("100.00"),
        due_date=date(2026, 8, 20),
    )


def test_obligation_component_endpoints_support_manual_crud_and_external_upsert(
    client: TestClient, db: Session
) -> None:
    owner = create_random_user(db)
    headers = authentication_token_from_email(client=client, email=owner.email, db=db)
    ledger = ledger_use_cases.create_ledger(
        session=db, owner_user_id=owner.id, name=f"ledger-{random_lower_string()}"
    )
    obligation = _create_ready_obligation(db, ledger_id=ledger.id)
    url = (
        f"{settings.API_V1_STR}/ledgers/{ledger.id}/obligations/"
        f"{obligation.business_key}/components"
    )

    created = client.post(
        url,
        headers=headers,
        json={"type": "consumption", "label": "Water settlement"},
    )
    assert created.status_code == 200
    assert created.json()["external_id"] is None

    component_id = created.json()["id"]
    updated = client.patch(
        f"{url}/{component_id}",
        headers=headers,
        json={"amount": "43.21"},
    )
    assert updated.status_code == 200
    assert updated.json()["amount"] == "43.21"

    first_upsert = client.put(
        f"{url}/upsert",
        headers=headers,
        json={
            "type": "invoice",
            "label": "August invoice",
            "amount": "100.00",
            "source": "provider",
            "external_id": "FV/2026/08/12345",
        },
    )
    second_upsert = client.put(
        f"{url}/upsert",
        headers=headers,
        json={
            "type": "invoice",
            "label": "Corrected August invoice",
            "amount": "120.00",
            "source": "provider",
            "external_id": "FV/2026/08/12345",
        },
    )
    assert first_upsert.status_code == second_upsert.status_code == 200
    assert first_upsert.json()["result"] == "created"
    assert second_upsert.json()["result"] == "updated"
    assert (
        first_upsert.json()["component"]["id"]
        == second_upsert.json()["component"]["id"]
    )
    assert second_upsert.json()["component"]["amount"] == "120.00"

    unchanged_upsert = client.put(
        f"{url}/upsert",
        headers=headers,
        json={
            "type": "invoice",
            "label": "Corrected August invoice",
            "amount": "120.00",
            "source": "provider",
            "external_id": "FV/2026/08/12345",
        },
    )
    assert unchanged_upsert.status_code == 200
    assert unchanged_upsert.json()["result"] == "unchanged"

    duplicate_create = client.post(
        url,
        headers=headers,
        json={
            "type": "invoice",
            "label": "Duplicate invoice",
            "source": "provider",
            "external_id": "FV/2026/08/12345",
        },
    )
    assert duplicate_create.status_code == 409

    conflicting_update = client.patch(
        f"{url}/{component_id}",
        headers=headers,
        json={"source": "provider", "external_id": "FV/2026/08/12345"},
    )
    assert conflicting_update.status_code == 409

    listed = client.get(url, headers=headers)
    assert listed.status_code == 200
    assert listed.json()["count"] == 2

    deleted = client.delete(f"{url}/{component_id}", headers=headers)
    assert deleted.status_code == 204


def test_mark_obligation_paid_sets_paid_at_for_ready_obligation(
    client: TestClient, db: Session
) -> None:
    owner = create_random_user(db)
    headers = authentication_token_from_email(client=client, email=owner.email, db=db)
    ledger = ledger_use_cases.create_ledger(
        session=db, owner_user_id=owner.id, name=f"ledger-{random_lower_string()}"
    )
    obligation = _create_ready_obligation(db, ledger_id=ledger.id)

    response = client.post(
        f"{settings.API_V1_STR}/ledgers/{ledger.id}/obligations/{obligation.business_key}/mark-paid",
        headers=headers,
    )

    assert response.status_code == 200
    assert response.json()["lifecycle"] == ObligationLifecycle.PAID.value
    assert response.json()["paid_at"] is not None


def test_mark_obligation_paid_rejects_draft_and_collecting_data(
    client: TestClient, db: Session
) -> None:
    owner = create_random_user(db)
    headers = authentication_token_from_email(client=client, email=owner.email, db=db)
    ledger = ledger_use_cases.create_ledger(
        session=db, owner_user_id=owner.id, name=f"ledger-{random_lower_string()}"
    )
    obligation = _create_ready_obligation(db, ledger_id=ledger.id)
    url = (
        f"{settings.API_V1_STR}/ledgers/{ledger.id}/obligations/"
        f"{obligation.business_key}/mark-paid"
    )

    obligation.lifecycle = ObligationLifecycle.DRAFT
    db.commit()
    draft_response = client.post(url, headers=headers)

    obligation.lifecycle = ObligationLifecycle.COLLECTING_DATA
    db.commit()
    collecting_response = client.post(url, headers=headers)

    assert draft_response.status_code == 409
    assert draft_response.json() == {
        "detail": "Only ready obligations can be marked as paid"
    }
    assert collecting_response.status_code == 409
    assert collecting_response.json() == {
        "detail": "Only ready obligations can be marked as paid"
    }


def test_mark_obligation_paid_is_idempotent_and_patch_cannot_set_lifecycle(
    client: TestClient, db: Session
) -> None:
    owner = create_random_user(db)
    headers = authentication_token_from_email(client=client, email=owner.email, db=db)
    ledger = ledger_use_cases.create_ledger(
        session=db, owner_user_id=owner.id, name=f"ledger-{random_lower_string()}"
    )
    obligation = _create_ready_obligation(db, ledger_id=ledger.id)
    base_url = f"{settings.API_V1_STR}/ledgers/{ledger.id}/obligations/{obligation.business_key}"

    first = client.post(f"{base_url}/mark-paid", headers=headers)
    second = client.post(f"{base_url}/mark-paid", headers=headers)
    patch = client.patch(
        base_url,
        headers=headers,
        json={"lifecycle": ObligationLifecycle.PAID.value},
    )

    assert first.status_code == 200
    assert second.status_code == 200
    assert second.json()["paid_at"] == first.json()["paid_at"]
    assert patch.status_code == 422


def test_mark_obligation_paid_rejects_viewer(client: TestClient, db: Session) -> None:
    owner = create_random_user(db)
    viewer = create_random_user(db)
    viewer_headers = authentication_token_from_email(
        client=client, email=viewer.email, db=db
    )
    ledger = ledger_use_cases.create_ledger(
        session=db, owner_user_id=owner.id, name=f"ledger-{random_lower_string()}"
    )
    ledger_use_cases.share_ledger(
        session=db,
        ledger_id=ledger.id,
        target_user_id=viewer.id,
        role=LedgerAccessRole.VIEWER,
    )
    obligation = _create_ready_obligation(db, ledger_id=ledger.id)

    response = client.post(
        f"{settings.API_V1_STR}/ledgers/{ledger.id}/obligations/{obligation.business_key}/mark-paid",
        headers=viewer_headers,
    )

    assert response.status_code == 404
    assert response.json() == {"detail": "Ledger not found"}


def test_cancel_obligation_moves_collecting_data_to_canceled(
    client: TestClient, db: Session
) -> None:
    owner = create_random_user(db)
    headers = authentication_token_from_email(client=client, email=owner.email, db=db)
    ledger = ledger_use_cases.create_ledger(
        session=db, owner_user_id=owner.id, name=f"ledger-{random_lower_string()}"
    )
    obligation = _create_ready_obligation(db, ledger_id=ledger.id)
    obligation.lifecycle = ObligationLifecycle.COLLECTING_DATA
    db.commit()

    response = client.post(
        f"{settings.API_V1_STR}/ledgers/{ledger.id}/obligations/{obligation.business_key}/cancel",
        headers=headers,
    )

    assert response.status_code == 200
    assert response.json()["lifecycle"] == ObligationLifecycle.CANCELED.value


@pytest.mark.parametrize(
    "lifecycle",
    [
        ObligationLifecycle.DRAFT,
        ObligationLifecycle.READY,
        ObligationLifecycle.PAID,
        ObligationLifecycle.CANCELED,
        ObligationLifecycle.ERROR,
    ],
)
def test_cancel_obligation_rejects_other_lifecycles(
    client: TestClient, db: Session, lifecycle: ObligationLifecycle
) -> None:
    owner = create_random_user(db)
    headers = authentication_token_from_email(client=client, email=owner.email, db=db)
    ledger = ledger_use_cases.create_ledger(
        session=db, owner_user_id=owner.id, name=f"ledger-{random_lower_string()}"
    )
    obligation = _create_ready_obligation(db, ledger_id=ledger.id)
    obligation.lifecycle = lifecycle
    db.commit()

    response = client.post(
        f"{settings.API_V1_STR}/ledgers/{ledger.id}/obligations/{obligation.business_key}/cancel",
        headers=headers,
    )

    assert response.status_code == 409
    assert response.json() == {
        "detail": "Only obligations collecting data can be canceled"
    }


def test_cancel_obligation_rejects_viewer(client: TestClient, db: Session) -> None:
    owner = create_random_user(db)
    viewer = create_random_user(db)
    viewer_headers = authentication_token_from_email(
        client=client, email=viewer.email, db=db
    )
    ledger = ledger_use_cases.create_ledger(
        session=db, owner_user_id=owner.id, name=f"ledger-{random_lower_string()}"
    )
    ledger_use_cases.share_ledger(
        session=db,
        ledger_id=ledger.id,
        target_user_id=viewer.id,
        role=LedgerAccessRole.VIEWER,
    )
    obligation = _create_ready_obligation(db, ledger_id=ledger.id)
    obligation.lifecycle = ObligationLifecycle.COLLECTING_DATA
    db.commit()

    response = client.post(
        f"{settings.API_V1_STR}/ledgers/{ledger.id}/obligations/{obligation.business_key}/cancel",
        headers=viewer_headers,
    )

    assert response.status_code == 404
    assert response.json() == {"detail": "Ledger not found"}


@pytest.mark.parametrize(
    "lifecycle",
    [
        ObligationLifecycle.READY,
        ObligationLifecycle.PAID,
        ObligationLifecycle.CANCELED,
        ObligationLifecycle.ERROR,
    ],
)
def test_reopen_obligation_moves_reopenable_lifecycles_to_collecting_data(
    client: TestClient, db: Session, lifecycle: ObligationLifecycle
) -> None:
    owner = create_random_user(db)
    headers = authentication_token_from_email(client=client, email=owner.email, db=db)
    ledger = ledger_use_cases.create_ledger(
        session=db, owner_user_id=owner.id, name=f"ledger-{random_lower_string()}"
    )
    obligation = _create_ready_obligation(db, ledger_id=ledger.id)
    base_url = f"{settings.API_V1_STR}/ledgers/{ledger.id}/obligations/{obligation.business_key}"

    if lifecycle is ObligationLifecycle.PAID:
        assert client.post(f"{base_url}/mark-paid", headers=headers).status_code == 200
    elif lifecycle is not ObligationLifecycle.READY:
        obligation.lifecycle = lifecycle
        db.commit()

    response = client.post(f"{base_url}/reopen", headers=headers)

    assert response.status_code == 200
    assert response.json()["lifecycle"] == ObligationLifecycle.COLLECTING_DATA.value
    assert response.json()["paid_at"] is None


@pytest.mark.parametrize(
    "lifecycle",
    [
        ObligationLifecycle.DRAFT,
        ObligationLifecycle.COLLECTING_DATA,
    ],
)
def test_reopen_obligation_rejects_other_lifecycles(
    client: TestClient, db: Session, lifecycle: ObligationLifecycle
) -> None:
    owner = create_random_user(db)
    headers = authentication_token_from_email(client=client, email=owner.email, db=db)
    ledger = ledger_use_cases.create_ledger(
        session=db, owner_user_id=owner.id, name=f"ledger-{random_lower_string()}"
    )
    obligation = _create_ready_obligation(db, ledger_id=ledger.id)
    obligation.lifecycle = lifecycle
    db.commit()

    response = client.post(
        f"{settings.API_V1_STR}/ledgers/{ledger.id}/obligations/{obligation.business_key}/reopen",
        headers=headers,
    )

    assert response.status_code == 409
    assert response.json() == {
        "detail": "Only ready, paid, canceled, or error obligations can be reopened"
    }


def test_reopen_obligation_rejects_viewer(client: TestClient, db: Session) -> None:
    owner = create_random_user(db)
    viewer = create_random_user(db)
    viewer_headers = authentication_token_from_email(
        client=client, email=viewer.email, db=db
    )
    ledger = ledger_use_cases.create_ledger(
        session=db, owner_user_id=owner.id, name=f"ledger-{random_lower_string()}"
    )
    ledger_use_cases.share_ledger(
        session=db,
        ledger_id=ledger.id,
        target_user_id=viewer.id,
        role=LedgerAccessRole.VIEWER,
    )
    obligation = _create_ready_obligation(db, ledger_id=ledger.id)
    obligation.lifecycle = ObligationLifecycle.CANCELED
    db.commit()

    response = client.post(
        f"{settings.API_V1_STR}/ledgers/{ledger.id}/obligations/{obligation.business_key}/reopen",
        headers=viewer_headers,
    )

    assert response.status_code == 404
    assert response.json() == {"detail": "Ledger not found"}


def test_ensure_obligations_creates_current_and_next_period_for_active_categories(
    client: TestClient, db: Session
) -> None:
    owner = create_random_user(db)
    headers = authentication_token_from_email(client=client, email=owner.email, db=db)
    ledger = ledger_use_cases.create_ledger(
        session=db, owner_user_id=owner.id, name=f"ledger-{random_lower_string()}"
    )
    category_group = category_use_cases.create_category_group(
        session=db, ledger_id=ledger.id, name=f"group-{random_lower_string()}"
    )
    category_use_cases.create_category(
        session=db,
        ledger_id=ledger.id,
        category_group_id=category_group.id,
        name="Electricity",
        code="ELEC",
        recurrence_interval=1,
        recurrence_unit=RecurrenceUnit.MONTH,
        first_due_date=date(2026, 3, 10),
    )
    inactive_category = category_use_cases.create_category(
        session=db,
        ledger_id=ledger.id,
        category_group_id=category_group.id,
        name="Inactive electricity",
        code="INAC",
        recurrence_interval=1,
        recurrence_unit=RecurrenceUnit.MONTH,
        first_due_date=date(2026, 3, 10),
    )
    inactive_category.is_active = False
    db.commit()

    response = client.post(
        f"{settings.API_V1_STR}/ledgers/{ledger.id}/obligations/ensure",
        headers=headers,
        params={"year": 2026, "month": 3},
    )

    assert response.status_code == 200
    assert response.json() == {
        "created_keys": ["ELEC-2026-03", "ELEC-2026-04"],
        "created_count": 2,
    }
    current_response = client.get(
        f"{settings.API_V1_STR}/ledgers/{ledger.id}/obligations",
        headers=headers,
        params={"year": 2026, "month": 3},
    )
    next_response = client.get(
        f"{settings.API_V1_STR}/ledgers/{ledger.id}/obligations",
        headers=headers,
        params={"year": 2026, "month": 4},
    )
    assert current_response.json()["data"][0]["lifecycle"] == "collecting_data"
    assert next_response.json()["data"][0]["lifecycle"] == "draft"


def test_ensure_obligations_is_idempotent(client: TestClient, db: Session) -> None:
    owner = create_random_user(db)
    headers = authentication_token_from_email(client=client, email=owner.email, db=db)
    ledger = ledger_use_cases.create_ledger(
        session=db, owner_user_id=owner.id, name=f"ledger-{random_lower_string()}"
    )
    category_group = category_use_cases.create_category_group(
        session=db, ledger_id=ledger.id, name=f"group-{random_lower_string()}"
    )
    category_use_cases.create_category(
        session=db,
        ledger_id=ledger.id,
        category_group_id=category_group.id,
        name="Gas",
        code="GASS",
        recurrence_interval=1,
        recurrence_unit=RecurrenceUnit.MONTH,
        first_due_date=date(2026, 3, 10),
    )
    url = f"{settings.API_V1_STR}/ledgers/{ledger.id}/obligations/ensure"

    first = client.post(url, headers=headers, params={"year": 2026, "month": 3})
    second = client.post(url, headers=headers, params={"year": 2026, "month": 3})

    assert first.status_code == 200
    assert first.json()["created_count"] == 2
    assert second.status_code == 200
    assert second.json() == {"created_keys": [], "created_count": 0}


def test_ensure_obligations_rejects_viewer(client: TestClient, db: Session) -> None:
    owner = create_random_user(db)
    viewer = create_random_user(db)
    viewer_headers = authentication_token_from_email(
        client=client, email=viewer.email, db=db
    )
    ledger = ledger_use_cases.create_ledger(
        session=db, owner_user_id=owner.id, name=f"ledger-{random_lower_string()}"
    )
    ledger_use_cases.share_ledger(
        session=db,
        ledger_id=ledger.id,
        target_user_id=viewer.id,
        role=LedgerAccessRole.VIEWER,
    )

    response = client.post(
        f"{settings.API_V1_STR}/ledgers/{ledger.id}/obligations/ensure",
        headers=viewer_headers,
        params={"year": 2026, "month": 3},
    )

    assert response.status_code == 404
    assert response.json() == {"detail": "Ledger not found"}


def test_obligations_endpoints_happy_path_and_filters(
    client: TestClient, db: Session
) -> None:
    owner = create_random_user(db)
    headers = authentication_token_from_email(client=client, email=owner.email, db=db)
    ledger = ledger_use_cases.create_ledger(
        session=db, owner_user_id=owner.id, name=f"ledger-{random_lower_string()}"
    )
    category_group = category_use_cases.create_category_group(
        session=db, ledger_id=ledger.id, name=f"group-{random_lower_string()}"
    )
    category = category_use_cases.create_category(
        session=db,
        ledger_id=ledger.id,
        category_group_id=category_group.id,
        name="Electricity",
        code="ELEC",
    )

    create_response = client.post(
        f"{settings.API_V1_STR}/ledgers/{ledger.id}/obligations",
        headers=headers,
        json={
            "category_code": "ELEC",
            "period": {"year": 2026, "month": 8},
            "data_ready": True,
            "current_amount": "123.45",
            "issue_date": "2026-08-02",
            "due_date": "2026-08-20",
            "notes": "Created manually",
        },
    )

    assert create_response.status_code == 200
    created = create_response.json()
    assert created["key"] == "ELEC-2026-08"
    assert created["category_code"] == "ELEC"
    assert created["period"] == {"year": 2026, "month": 8}
    assert created["lifecycle"] == ObligationLifecycle.READY.value
    assert created["current_amount"] == "123.45"
    assert created["amount_state"] == ValueState.CONFIRMED.value
    assert created["amount_source"] == CurrentValueSource.MANUAL.value
    assert created["issue_date"] == "2026-08-02"
    assert created["issue_date_state"] == ValueState.CONFIRMED.value
    assert created["issue_date_source"] == CurrentValueSource.MANUAL.value
    assert created["notes"] == "Created manually"
    assert created["due_date"] == "2026-08-20"
    assert created["due_date_state"] == ValueState.CONFIRMED.value
    assert created["due_date_source"] == CurrentValueSource.MANUAL.value

    list_response = client.get(
        f"{settings.API_V1_STR}/ledgers/{ledger.id}/obligations",
        headers=headers,
        params={
            "year": 2026,
            "month": 8,
            "category_code": "ELEC",
            "lifecycle": "ready",
        },
    )

    assert list_response.status_code == 200
    assert list_response.json()["count"] == 1
    assert list_response.json()["data"][0]["key"] == "ELEC-2026-08"

    detail_response = client.get(
        f"{settings.API_V1_STR}/ledgers/{ledger.id}/obligations/ELEC-2026-08",
        headers=headers,
    )

    assert detail_response.status_code == 200
    assert detail_response.json()["id"] == created["id"]

    category.name = "Updated electricity"
    db.commit()

    detail_response = client.get(
        f"{settings.API_V1_STR}/ledgers/{ledger.id}/obligations/ELEC-2026-08",
        headers=headers,
    )

    assert detail_response.status_code == 200
    assert detail_response.json()["name"] == "Updated electricity"

    list_response = client.get(
        f"{settings.API_V1_STR}/ledgers/{ledger.id}/obligations",
        headers=headers,
        params={"year": 2026, "month": 8},
    )

    assert list_response.status_code == 200
    assert list_response.json()["data"][0]["name"] == "Updated electricity"


def test_read_obligations_without_period_filter_returns_all_periods(
    client: TestClient, db: Session
) -> None:
    owner = create_random_user(db)
    headers = authentication_token_from_email(client=client, email=owner.email, db=db)
    ledger = ledger_use_cases.create_ledger(
        session=db, owner_user_id=owner.id, name=f"ledger-{random_lower_string()}"
    )
    category_group = category_use_cases.create_category_group(
        session=db, ledger_id=ledger.id, name=f"group-{random_lower_string()}"
    )
    category_use_cases.create_category(
        session=db,
        ledger_id=ledger.id,
        category_group_id=category_group.id,
        name="Electricity",
        code="ELEC",
    )

    for month in (8, 9):
        response = client.post(
            f"{settings.API_V1_STR}/ledgers/{ledger.id}/obligations",
            headers=headers,
            json={"category_code": "ELEC", "period": {"year": 2026, "month": month}},
        )
        assert response.status_code == 200

    response = client.get(
        f"{settings.API_V1_STR}/ledgers/{ledger.id}/obligations",
        headers=headers,
    )

    assert response.status_code == 200
    assert response.json()["count"] == 2


def test_create_obligation_with_incomplete_data_marks_values_as_estimated(
    client: TestClient, db: Session
) -> None:
    owner = create_random_user(db)
    headers = authentication_token_from_email(client=client, email=owner.email, db=db)
    ledger = ledger_use_cases.create_ledger(
        session=db, owner_user_id=owner.id, name=f"ledger-{random_lower_string()}"
    )
    category_group = category_use_cases.create_category_group(
        session=db, ledger_id=ledger.id, name=f"group-{random_lower_string()}"
    )
    category_use_cases.create_category(
        session=db,
        ledger_id=ledger.id,
        category_group_id=category_group.id,
        name="Electricity",
        code="ELEC",
    )

    response = client.post(
        f"{settings.API_V1_STR}/ledgers/{ledger.id}/obligations",
        headers=headers,
        json={
            "category_code": "ELEC",
            "period": {"year": 2026, "month": 8},
            "current_amount": "100.00",
            "issue_date": "2026-08-02",
        },
    )

    assert response.status_code == 200
    created = response.json()
    assert created["lifecycle"] == ObligationLifecycle.COLLECTING_DATA.value
    assert created["amount_state"] == ValueState.ESTIMATED.value
    assert created["amount_source"] == CurrentValueSource.MANUAL.value
    assert created["issue_date_state"] == ValueState.ESTIMATED.value
    assert created["issue_date_source"] == CurrentValueSource.MANUAL.value
    assert created["due_date"] is None
    assert created["due_date_state"] == ValueState.UNKNOWN.value
    assert created["due_date_source"] == CurrentValueSource.UNKNOWN.value


def test_update_obligation_updates_collecting_data_values_and_notes(
    client: TestClient, db: Session
) -> None:
    owner = create_random_user(db)
    headers = authentication_token_from_email(client=client, email=owner.email, db=db)
    ledger = ledger_use_cases.create_ledger(
        session=db, owner_user_id=owner.id, name=f"ledger-{random_lower_string()}"
    )
    category_group = category_use_cases.create_category_group(
        session=db, ledger_id=ledger.id, name=f"group-{random_lower_string()}"
    )
    category_use_cases.create_category(
        session=db,
        ledger_id=ledger.id,
        category_group_id=category_group.id,
        name="Electricity",
        code="ELEC",
    )
    create_response = client.post(
        f"{settings.API_V1_STR}/ledgers/{ledger.id}/obligations",
        headers=headers,
        json={
            "category_code": "ELEC",
            "period": {"year": 2026, "month": 8},
            "current_amount": "100.00",
            "issue_date": "2026-08-02",
            "due_date": "2026-08-20",
            "notes": "Initial notes",
        },
    )
    assert create_response.status_code == 200

    response = client.patch(
        f"{settings.API_V1_STR}/ledgers/{ledger.id}/obligations/ELEC-2026-08",
        headers=headers,
        json={
            "current_amount": "125.50",
            "issue_date": "2026-08-03",
            "due_date": "2026-08-21",
            "notes": "Corrected manually",
        },
    )

    assert response.status_code == 200
    updated = response.json()
    assert updated["current_amount"] == "125.50"
    assert updated["amount_state"] == ValueState.ESTIMATED.value
    assert updated["amount_source"] == CurrentValueSource.MANUAL.value
    assert updated["issue_date"] == "2026-08-03"
    assert updated["issue_date_state"] == ValueState.ESTIMATED.value
    assert updated["issue_date_source"] == CurrentValueSource.MANUAL.value
    assert updated["due_date"] == "2026-08-21"
    assert updated["due_date_state"] == ValueState.ESTIMATED.value
    assert updated["due_date_source"] == CurrentValueSource.MANUAL.value
    assert updated["notes"] == "Corrected manually"


@pytest.mark.parametrize(
    "lifecycle",
    [
        ObligationLifecycle.READY,
        ObligationLifecycle.PAID,
        ObligationLifecycle.CANCELED,
    ],
)
def test_update_obligation_rejects_read_only_lifecycles(
    client: TestClient, db: Session, lifecycle: ObligationLifecycle
) -> None:
    owner = create_random_user(db)
    headers = authentication_token_from_email(client=client, email=owner.email, db=db)
    ledger = ledger_use_cases.create_ledger(
        session=db, owner_user_id=owner.id, name=f"ledger-{random_lower_string()}"
    )
    obligation = _create_ready_obligation(db, ledger_id=ledger.id)
    obligation.lifecycle = lifecycle
    db.commit()

    response = client.patch(
        f"{settings.API_V1_STR}/ledgers/{ledger.id}/obligations/{obligation.business_key}",
        headers=headers,
        json={"notes": "Cannot be changed"},
    )

    assert response.status_code == 409
    assert response.json() == {
        "detail": "Only draft and collecting data obligations can be edited"
    }


def test_update_obligation_validates_resulting_dates_and_allows_clearing_values(
    client: TestClient, db: Session
) -> None:
    owner = create_random_user(db)
    headers = authentication_token_from_email(client=client, email=owner.email, db=db)
    ledger = ledger_use_cases.create_ledger(
        session=db, owner_user_id=owner.id, name=f"ledger-{random_lower_string()}"
    )
    category_group = category_use_cases.create_category_group(
        session=db, ledger_id=ledger.id, name=f"group-{random_lower_string()}"
    )
    category_use_cases.create_category(
        session=db,
        ledger_id=ledger.id,
        category_group_id=category_group.id,
        name="Electricity",
        code="ELEC",
    )
    create_response = client.post(
        f"{settings.API_V1_STR}/ledgers/{ledger.id}/obligations",
        headers=headers,
        json={
            "category_code": "ELEC",
            "period": {"year": 2026, "month": 8},
            "issue_date": "2026-08-20",
            "due_date": "2026-08-21",
        },
    )
    assert create_response.status_code == 200

    invalid_response = client.patch(
        f"{settings.API_V1_STR}/ledgers/{ledger.id}/obligations/ELEC-2026-08",
        headers=headers,
        json={"due_date": "2026-08-19"},
    )
    assert invalid_response.status_code == 422
    assert invalid_response.json() == {
        "detail": "issue_date cannot be later than due_date"
    }

    response = client.patch(
        f"{settings.API_V1_STR}/ledgers/{ledger.id}/obligations/ELEC-2026-08",
        headers=headers,
        json={"issue_date": None},
    )
    assert response.status_code == 200
    updated = response.json()
    assert updated["issue_date"] is None
    assert updated["issue_date_state"] == ValueState.UNKNOWN.value
    assert updated["issue_date_source"] == CurrentValueSource.UNKNOWN.value


def test_mark_obligation_ready_requires_estimated_amount_and_due_date(
    client: TestClient, db: Session
) -> None:
    owner = create_random_user(db)
    headers = authentication_token_from_email(client=client, email=owner.email, db=db)
    ledger = ledger_use_cases.create_ledger(
        session=db, owner_user_id=owner.id, name=f"ledger-{random_lower_string()}"
    )
    category_group = category_use_cases.create_category_group(
        session=db, ledger_id=ledger.id, name=f"group-{random_lower_string()}"
    )
    category_use_cases.create_category(
        session=db,
        ledger_id=ledger.id,
        category_group_id=category_group.id,
        name="Electricity",
        code="ELEC",
    )
    create_response = client.post(
        f"{settings.API_V1_STR}/ledgers/{ledger.id}/obligations",
        headers=headers,
        json={
            "category_code": "ELEC",
            "period": {"year": 2026, "month": 8},
            "current_amount": "100.00",
            "due_date": "2026-08-20",
        },
    )
    assert create_response.status_code == 200
    assert (
        create_response.json()["lifecycle"] == ObligationLifecycle.COLLECTING_DATA.value
    )

    response = client.patch(
        f"{settings.API_V1_STR}/ledgers/{ledger.id}/obligations/ELEC-2026-08/ready",
        headers=headers,
    )

    assert response.status_code == 200
    assert response.json()["lifecycle"] == ObligationLifecycle.READY.value
    assert response.json()["amount_state"] == ValueState.CONFIRMED.value
    assert response.json()["due_date_state"] == ValueState.CONFIRMED.value


def test_mark_obligation_ready_rejects_missing_required_values(
    client: TestClient, db: Session
) -> None:
    owner = create_random_user(db)
    headers = authentication_token_from_email(client=client, email=owner.email, db=db)
    ledger = ledger_use_cases.create_ledger(
        session=db, owner_user_id=owner.id, name=f"ledger-{random_lower_string()}"
    )
    category_group = category_use_cases.create_category_group(
        session=db, ledger_id=ledger.id, name=f"group-{random_lower_string()}"
    )
    category_use_cases.create_category(
        session=db,
        ledger_id=ledger.id,
        category_group_id=category_group.id,
        name="Electricity",
        code="ELEC",
    )
    create_response = client.post(
        f"{settings.API_V1_STR}/ledgers/{ledger.id}/obligations",
        headers=headers,
        json={
            "category_code": "ELEC",
            "period": {"year": 2026, "month": 8},
            "current_amount": "100.00",
        },
    )
    assert create_response.status_code == 200

    response = client.patch(
        f"{settings.API_V1_STR}/ledgers/{ledger.id}/obligations/ELEC-2026-08/ready",
        headers=headers,
    )

    assert response.status_code == 422
    assert response.json() == {
        "detail": "current_amount and due_date are required to mark ready"
    }


def test_create_ready_obligation_requires_amount_and_due_date(
    client: TestClient, db: Session
) -> None:
    owner = create_random_user(db)
    headers = authentication_token_from_email(client=client, email=owner.email, db=db)
    ledger = ledger_use_cases.create_ledger(
        session=db, owner_user_id=owner.id, name=f"ledger-{random_lower_string()}"
    )
    category_group = category_use_cases.create_category_group(
        session=db, ledger_id=ledger.id, name=f"group-{random_lower_string()}"
    )
    category_use_cases.create_category(
        session=db,
        ledger_id=ledger.id,
        category_group_id=category_group.id,
        name="Electricity",
        code="ELEC",
    )

    response = client.post(
        f"{settings.API_V1_STR}/ledgers/{ledger.id}/obligations",
        headers=headers,
        json={
            "category_code": "ELEC",
            "period": {"year": 2026, "month": 8},
            "data_ready": True,
            "current_amount": "100.00",
        },
    )

    assert response.status_code == 422

    response = client.post(
        f"{settings.API_V1_STR}/ledgers/{ledger.id}/obligations",
        headers=headers,
        json={
            "category_code": "ELEC",
            "period": {"year": 2026, "month": 8},
            "data_ready": True,
            "current_amount": "100.00",
            "issue_date": "2026-08-21",
            "due_date": "2026-08-20",
        },
    )

    assert response.status_code == 422

    response = client.post(
        f"{settings.API_V1_STR}/ledgers/{ledger.id}/obligations",
        headers=headers,
        json={
            "category_code": "ELEC",
            "period": {"year": 2026, "month": 8},
            "data_ready": True,
            "current_amount": "100.00",
            "due_date": "2026-09-11",
        },
    )

    assert response.status_code == 422


def test_create_obligation_rejects_duplicate(client: TestClient, db: Session) -> None:
    owner = create_random_user(db)
    headers = authentication_token_from_email(client=client, email=owner.email, db=db)
    ledger = ledger_use_cases.create_ledger(
        session=db, owner_user_id=owner.id, name=f"ledger-{random_lower_string()}"
    )
    category_group = category_use_cases.create_category_group(
        session=db, ledger_id=ledger.id, name=f"group-{random_lower_string()}"
    )
    category_use_cases.create_category(
        session=db,
        ledger_id=ledger.id,
        category_group_id=category_group.id,
        name="Electricity",
        code="ELEC",
    )
    payload = {"category_code": "ELEC", "period": {"year": 2026, "month": 8}}

    assert (
        client.post(
            f"{settings.API_V1_STR}/ledgers/{ledger.id}/obligations",
            headers=headers,
            json=payload,
        ).status_code
        == 200
    )
    response = client.post(
        f"{settings.API_V1_STR}/ledgers/{ledger.id}/obligations",
        headers=headers,
        json=payload,
    )

    assert response.status_code == 409
    assert response.json() == {"detail": "Obligation already exists"}


def test_create_obligation_rejects_negative_current_amount(
    client: TestClient, db: Session
) -> None:
    owner = create_random_user(db)
    headers = authentication_token_from_email(client=client, email=owner.email, db=db)
    ledger = ledger_use_cases.create_ledger(
        session=db, owner_user_id=owner.id, name=f"ledger-{random_lower_string()}"
    )
    category_group = category_use_cases.create_category_group(
        session=db, ledger_id=ledger.id, name=f"group-{random_lower_string()}"
    )
    category_use_cases.create_category(
        session=db,
        ledger_id=ledger.id,
        category_group_id=category_group.id,
        name="Electricity",
        code="ELEC",
    )

    response = client.post(
        f"{settings.API_V1_STR}/ledgers/{ledger.id}/obligations",
        headers=headers,
        json={
            "category_code": "ELEC",
            "period": {"year": 2026, "month": 8},
            "current_amount": "-1.00",
        },
    )

    assert response.status_code == 422


def test_read_obligations_rejects_invalid_period_filters(
    client: TestClient, db: Session
) -> None:
    owner = create_random_user(db)
    headers = authentication_token_from_email(client=client, email=owner.email, db=db)
    ledger = ledger_use_cases.create_ledger(
        session=db, owner_user_id=owner.id, name=f"ledger-{random_lower_string()}"
    )

    response = client.get(
        f"{settings.API_V1_STR}/ledgers/{ledger.id}/obligations",
        headers=headers,
        params={"year": 0, "month": 13},
    )

    assert response.status_code == 422


def test_create_obligation_rejects_automatic_category(
    client: TestClient, db: Session
) -> None:
    owner = create_random_user(db)
    headers = authentication_token_from_email(client=client, email=owner.email, db=db)
    ledger = ledger_use_cases.create_ledger(
        session=db, owner_user_id=owner.id, name=f"ledger-{random_lower_string()}"
    )
    category_group = category_use_cases.create_category_group(
        session=db, ledger_id=ledger.id, name=f"group-{random_lower_string()}"
    )
    category_use_cases.create_category(
        session=db,
        ledger_id=ledger.id,
        category_group_id=category_group.id,
        name="Electricity",
        code="ELEC",
        data_source_policy=DataSourcePolicy.AUTOMATIC,
    )

    response = client.post(
        f"{settings.API_V1_STR}/ledgers/{ledger.id}/obligations",
        headers=headers,
        json={"category_code": "ELEC", "period": {"year": 2026, "month": 8}},
    )

    assert response.status_code == 422
    assert response.json() == {
        "detail": "Manual obligations are not allowed for automatic categories"
    }


def test_read_obligation_rejects_invalid_business_key(
    client: TestClient, db: Session
) -> None:
    owner = create_random_user(db)
    headers = authentication_token_from_email(client=client, email=owner.email, db=db)
    ledger = ledger_use_cases.create_ledger(
        session=db, owner_user_id=owner.id, name=f"ledger-{random_lower_string()}"
    )

    response = client.get(
        f"{settings.API_V1_STR}/ledgers/{ledger.id}/obligations/ELEC-2026-13",
        headers=headers,
    )

    assert response.status_code == 422
    assert response.json() == {"detail": "Invalid obligation key"}


def test_create_obligation_returns_404_for_missing_category(
    client: TestClient, db: Session
) -> None:
    owner = create_random_user(db)
    headers = authentication_token_from_email(client=client, email=owner.email, db=db)
    ledger = ledger_use_cases.create_ledger(
        session=db, owner_user_id=owner.id, name=f"ledger-{random_lower_string()}"
    )

    response = client.post(
        f"{settings.API_V1_STR}/ledgers/{ledger.id}/obligations",
        headers=headers,
        json={"category_code": "MISS", "period": {"year": 2026, "month": 8}},
    )

    assert response.status_code == 404
    assert response.json() == {"detail": "Category not found"}


def test_obligation_category_and_lookup_are_scoped_to_ledger(
    client: TestClient, db: Session
) -> None:
    owner = create_random_user(db)
    headers = authentication_token_from_email(client=client, email=owner.email, db=db)
    ledger_one = ledger_use_cases.create_ledger(
        session=db, owner_user_id=owner.id, name=f"ledger-{random_lower_string()}"
    )
    ledger_two = ledger_use_cases.create_ledger(
        session=db, owner_user_id=owner.id, name=f"ledger-{random_lower_string()}"
    )
    group_two = category_use_cases.create_category_group(
        session=db, ledger_id=ledger_two.id, name=f"group-{random_lower_string()}"
    )
    category_use_cases.create_category(
        session=db,
        ledger_id=ledger_two.id,
        category_group_id=group_two.id,
        name="Gas",
        code="GASS",
    )
    obligation_use_cases.create_manual_obligation(
        session=db,
        ledger_id=ledger_two.id,
        category_code="GASS",
        period=BillingPeriod(2026, 8),
    )

    create_response = client.post(
        f"{settings.API_V1_STR}/ledgers/{ledger_one.id}/obligations",
        headers=headers,
        json={"category_code": "GASS", "period": {"year": 2026, "month": 8}},
    )
    detail_response = client.get(
        f"{settings.API_V1_STR}/ledgers/{ledger_one.id}/obligations/GASS-2026-08",
        headers=headers,
    )

    assert create_response.status_code == 404
    assert create_response.json() == {"detail": "Category not found"}
    assert detail_response.status_code == 404
    assert detail_response.json() == {"detail": "Obligation not found"}


def test_obligation_endpoints_require_authentication(
    client: TestClient, db: Session
) -> None:
    owner = create_random_user(db)
    ledger = ledger_use_cases.create_ledger(
        session=db, owner_user_id=owner.id, name=f"ledger-{random_lower_string()}"
    )

    response = client.get(f"{settings.API_V1_STR}/ledgers/{ledger.id}/obligations")

    assert response.status_code == 401
