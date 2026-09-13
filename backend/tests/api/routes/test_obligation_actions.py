from decimal import Decimal

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.config import settings
from app.domain import BillingPeriod, LedgerAccessRole, ObligationKey
from app.use_cases import ledgers as ledger_use_cases
from app.use_cases import obligations as obligation_use_cases
from tests.utils.ledger_domain import create_category_with_recurrence
from tests.utils.user import authentication_token_from_email, create_random_user


def test_obligation_actions_are_attributed_paginated_and_ledger_scoped(
    client: TestClient, db: Session
) -> None:
    ledger, _, category = create_category_with_recurrence(db)
    owner = ledger.owner
    owner.full_name = "Ledger Owner"
    db.commit()
    owner_headers = authentication_token_from_email(
        client=client, email=owner.email, db=db
    )
    period = BillingPeriod(2026, 8)
    obligation_use_cases.ensure_obligations_for_period(
        session=db, ledger_id=ledger.id, period=period
    )
    key = ObligationKey(category_code=category.code, period=period)
    base = f"{settings.API_V1_STR}/ledgers/{ledger.id}/obligations/{key}/actions"

    update = client.patch(
        base.removesuffix("/actions"),
        headers=owner_headers,
        json={"current_amount": "42.50"},
    )
    assert update.status_code == 200, update.text

    response = client.get(base, headers=owner_headers, params={"limit": 1})
    assert response.status_code == 200
    payload = response.json()
    assert payload["count"] == 2
    assert len(payload["data"]) == 1
    action = payload["data"][0]
    assert action["action"] == "values_updated"
    assert action["actor_type"] == "user"
    assert action["actor_id"] == str(owner.id)
    assert action["actor_display_name"] == "Ledger Owner"
    assert action["integration_id"] is None
    assert action["run_id"] is None
    assert "metadata" in action

    for role in (LedgerAccessRole.VIEWER, LedgerAccessRole.EDITOR):
        member = create_random_user(db)
        ledger_use_cases.share_ledger(
            session=db,
            ledger_id=ledger.id,
            target_user_id=member.id,
            role=role,
        )
        headers = authentication_token_from_email(
            client=client, email=member.email, db=db
        )
        assert client.get(base, headers=headers).status_code == 200

    outsider = create_random_user(db)
    outsider_headers = authentication_token_from_email(
        client=client, email=outsider.email, db=db
    )
    assert client.get(base, headers=outsider_headers).status_code == 404
    invalid = base.replace(str(key), "invalid")
    assert client.get(invalid, headers=owner_headers).status_code == 422


def test_failed_obligation_update_does_not_add_an_action(
    client: TestClient, db: Session
) -> None:
    ledger, _, category = create_category_with_recurrence(db)
    headers = authentication_token_from_email(
        client=client, email=ledger.owner.email, db=db
    )
    period = BillingPeriod(2026, 8)
    obligation_use_cases.ensure_obligations_for_period(
        session=db, ledger_id=ledger.id, period=period
    )
    key = ObligationKey(category_code=category.code, period=period)
    root = f"{settings.API_V1_STR}/ledgers/{ledger.id}/obligations/{key}"

    failed = client.patch(
        root,
        headers=headers,
        json={"current_amount": str(Decimal("-1.00"))},
    )
    assert failed.status_code == 422
    history = client.get(f"{root}/actions", headers=headers).json()
    assert history["count"] == 1
