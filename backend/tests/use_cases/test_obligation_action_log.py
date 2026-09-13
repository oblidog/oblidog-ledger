import uuid
from decimal import Decimal

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domain import (
    BillingPeriod,
    ObligationActionActor,
    ObligationKey,
    ObligationLifecycle,
)
from app.models import Obligation, ObligationActionLog
from app.use_cases import obligations as obligation_use_cases
from app.use_cases.exceptions import DuplicateObligationComponentError
from tests.utils.ledger_domain import create_category_with_recurrence


def _setup(db: Session) -> tuple[Obligation, ObligationKey]:
    ledger, _, category = create_category_with_recurrence(db)
    period = BillingPeriod(2026, 8)
    created = obligation_use_cases.ensure_obligations_for_period(
        session=db, ledger_id=ledger.id, period=period
    )
    obligation = next(
        item
        for item in created
        if item.lifecycle is ObligationLifecycle.COLLECTING_DATA
    )
    return obligation, ObligationKey(category_code=category.code, period=period)


def _actions(db: Session, obligation_id: uuid.UUID) -> list[ObligationActionLog]:
    return list(
        db.scalars(
            select(ObligationActionLog)
            .where(ObligationActionLog.obligation_id == obligation_id)
            .order_by(ObligationActionLog.created_at, ObligationActionLog.id)
        ).all()
    )


def test_creation_and_value_changes_are_structured_and_skip_noops(
    db: Session,
) -> None:
    ledger, _, category = create_category_with_recurrence(db)
    actor_id = uuid.uuid4()
    actor = ObligationActionActor.user(user_id=actor_id, display_name="Mario Example")
    period = BillingPeriod(2026, 8)
    created = obligation_use_cases.ensure_obligations_for_period(
        session=db, ledger_id=ledger.id, period=period, actor=actor
    )
    obligation = next(
        item
        for item in created
        if item.lifecycle is ObligationLifecycle.COLLECTING_DATA
    )
    key = ObligationKey(category_code=category.code, period=period)

    initial = _actions(db, obligation.id)
    assert len(initial) == 1
    assert initial[0].action == "created"
    assert initial[0].actor_type == "user"
    assert initial[0].actor_id == actor_id
    assert initial[0].actor_display_name == "Mario Example"
    assert initial[0].changes["lifecycle"] == {
        "from": None,
        "to": "collecting_data",
    }

    obligation_use_cases.update_manual_obligation(
        session=db,
        ledger_id=ledger.id,
        key=key,
        current_amount=Decimal("125.00"),
        actor=actor,
    )
    updated = _actions(db, obligation.id)
    assert len(updated) == 2
    assert updated[-1].action == "values_updated"
    assert updated[-1].changes["current_amount"] == {
        "from": None,
        "to": "125.00",
    }
    assert updated[-1].changes["amount_source"] == {
        "from": "unknown",
        "to": "manual",
    }

    obligation_use_cases.update_manual_obligation(
        session=db,
        ledger_id=ledger.id,
        key=key,
        current_amount=Decimal("125.00"),
        actor=actor,
    )
    assert len(_actions(db, obligation.id)) == 2


def test_lifecycle_actions_include_implicit_state_and_paid_at_changes(
    db: Session,
) -> None:
    obligation, key = _setup(db)
    obligation_use_cases.update_manual_obligation(
        session=db,
        ledger_id=obligation.ledger_id,
        key=key,
        current_amount=Decimal("100.00"),
    )
    obligation_use_cases.mark_obligation_ready(
        session=db, ledger_id=obligation.ledger_id, key=key
    )
    paid = obligation_use_cases.mark_obligation_paid(
        session=db, ledger_id=obligation.ledger_id, key=key
    )
    paid_at = paid.paid_at
    assert paid_at is not None
    before_retry = len(_actions(db, obligation.id))
    obligation_use_cases.mark_obligation_paid(
        session=db, ledger_id=obligation.ledger_id, key=key
    )
    assert len(_actions(db, obligation.id)) == before_retry
    obligation_use_cases.reopen_obligation(
        session=db, ledger_id=obligation.ledger_id, key=key
    )

    actions = _actions(db, obligation.id)
    ready, marked_paid, reopened = actions[-3:]
    assert ready.action == "marked_ready"
    assert ready.changes["amount_state"] == {
        "from": "estimated",
        "to": "confirmed",
    }
    assert marked_paid.action == "marked_paid"
    assert marked_paid.changes["lifecycle"] == {"from": "ready", "to": "paid"}
    assert marked_paid.changes["paid_at"]["to"] == paid_at.isoformat()
    assert reopened.action == "reopened"
    assert reopened.changes["paid_at"]["to"] is None


def test_component_crud_records_bounded_diffs_and_integration_correlation(
    db: Session,
) -> None:
    obligation, key = _setup(db)
    integration_id = uuid.uuid4()
    run_id = uuid.uuid4()
    actor = ObligationActionActor.integration(
        integration_id=integration_id,
        display_name="eKartoteka",
        run_id=run_id,
    )

    component = obligation_use_cases.add_obligation_component(
        session=db,
        ledger_id=obligation.ledger_id,
        key=key,
        type="charge",
        label="Heating",
        amount=Decimal("80.00"),
        metadata={"unit": "GJ"},
        actor=actor,
    )
    added = _actions(db, obligation.id)[-1]
    assert added.action == "components_changed"
    assert added.integration_id == integration_id
    assert added.run_id == run_id
    assert added.changes["components"]["added"][0] == {
        "id": str(component.id),
        "type": "charge",
        "label": "Heating",
        "amount": "80.00",
        "source": None,
        "external_id": None,
        "metadata": {"unit": "GJ"},
    }

    obligation_use_cases.update_obligation_component(
        session=db,
        ledger_id=obligation.ledger_id,
        key=key,
        component_id=component.id,
        label="District heating",
        amount=Decimal("92.40"),
        actor=actor,
    )
    updated = _actions(db, obligation.id)[-1]
    entry = updated.changes["components"]["updated"][0]
    assert entry["label"] == "Heating"
    assert entry["changes"]["label"] == {
        "from": "Heating",
        "to": "District heating",
    }
    assert entry["changes"]["amount"] == {"from": "80.00", "to": "92.40"}

    before_noop = len(_actions(db, obligation.id))
    obligation_use_cases.update_obligation_component(
        session=db,
        ledger_id=obligation.ledger_id,
        key=key,
        component_id=component.id,
        label="District heating",
        amount=Decimal("92.40"),
        actor=actor,
    )
    assert len(_actions(db, obligation.id)) == before_noop

    obligation_use_cases.remove_obligation_component(
        session=db,
        ledger_id=obligation.ledger_id,
        key=key,
        component_id=component.id,
        actor=actor,
    )
    removed = _actions(db, obligation.id)[-1]
    removed_snapshot = removed.changes["components"]["removed"][0]
    assert removed_snapshot["label"] == "District heating"
    assert removed_snapshot["amount"] == "92.40"


def test_component_upsert_is_idempotent_and_logs_only_real_changes(
    db: Session,
) -> None:
    obligation, key = _setup(db)
    arguments = {
        "session": db,
        "ledger_id": obligation.ledger_id,
        "key": key,
        "type": "invoice",
        "label": "September invoice",
        "source": "NJU",
        "external_id": "invoice-123",
        "amount": Decimal("50.00"),
    }
    component = obligation_use_cases.upsert_obligation_component(**arguments)
    after_create = len(_actions(db, obligation.id))
    obligation_use_cases.upsert_obligation_component(**arguments)
    assert len(_actions(db, obligation.id)) == after_create

    arguments["amount"] = Decimal("55.00")
    updated = obligation_use_cases.upsert_obligation_component(**arguments)
    assert updated.id == component.id
    action = _actions(db, obligation.id)[-1]
    assert action.changes["components"]["updated"][0]["changes"]["amount"] == {
        "from": "50.00",
        "to": "55.00",
    }


def test_failed_component_mutation_rolls_back_its_action_entry(db: Session) -> None:
    obligation, key = _setup(db)
    first = obligation_use_cases.add_obligation_component(
        session=db,
        ledger_id=obligation.ledger_id,
        key=key,
        type="invoice",
        label="First",
        source="provider",
        external_id="first",
    )
    second = obligation_use_cases.add_obligation_component(
        session=db,
        ledger_id=obligation.ledger_id,
        key=key,
        type="invoice",
        label="Second",
        source="provider",
        external_id="second",
    )
    before = len(_actions(db, obligation.id))

    with pytest.raises(DuplicateObligationComponentError):
        obligation_use_cases.update_obligation_component(
            session=db,
            ledger_id=obligation.ledger_id,
            key=key,
            component_id=second.id,
            source=first.source,
            external_id=first.external_id,
        )

    assert len(_actions(db, obligation.id)) == before


def test_action_history_is_paginated_newest_first(db: Session) -> None:
    obligation, key = _setup(db)
    obligation_use_cases.update_manual_obligation(
        session=db,
        ledger_id=obligation.ledger_id,
        key=key,
        current_amount=Decimal("10.00"),
    )
    items, count = obligation_use_cases.list_obligation_actions(
        session=db,
        ledger_id=obligation.ledger_id,
        key=key,
        limit=1,
        offset=0,
    )
    assert count == 2
    assert len(items) == 1
    assert items[0].action == "values_updated"
