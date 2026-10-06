from datetime import date
from decimal import Decimal

import pytest
from sqlalchemy.orm import Session

from app.domain import (
    BillingPeriod,
    CurrentValueSource,
    EffectiveValueSourceMode,
    ObligationKey,
    ObligationLifecycle,
    ValueState,
)
from app.models import Obligation
from app.use_cases import obligations as obligation_use_cases
from tests.utils.ledger_domain import create_category_with_recurrence


def test_mark_obligation_ready_confirms_issue_date_when_present(db: Session) -> None:
    ledger, _, category = create_category_with_recurrence(db)
    period = BillingPeriod(2026, 8)
    obligation_use_cases.ensure_obligations_for_period(
        session=db, ledger_id=ledger.id, period=period
    )
    key = ObligationKey(category_code=category.code, period=period)
    obligation = obligation_use_cases.update_manual_obligation(
        session=db,
        ledger_id=ledger.id,
        key=key,
        current_amount=Decimal("123.45"),
        issue_date=date(2026, 8, 1),
        due_date=date(2026, 8, 20),
    )
    assert obligation.issue_date_state is ValueState.ESTIMATED

    ready = obligation_use_cases.mark_obligation_ready(
        session=db, ledger_id=ledger.id, key=key
    )

    assert ready.lifecycle is ObligationLifecycle.READY
    assert ready.issue_date_state is ValueState.CONFIRMED


def test_mark_obligation_ready_keeps_missing_issue_date_unknown(db: Session) -> None:
    ledger, _, category = create_category_with_recurrence(db)
    period = BillingPeriod(2026, 8)
    obligation_use_cases.ensure_obligations_for_period(
        session=db, ledger_id=ledger.id, period=period
    )
    key = ObligationKey(category_code=category.code, period=period)
    obligation = obligation_use_cases.update_manual_obligation(
        session=db,
        ledger_id=ledger.id,
        key=key,
        current_amount=Decimal("123.45"),
        due_date=date(2026, 8, 20),
    )
    assert obligation.issue_date is None
    assert obligation.issue_date_state is ValueState.UNKNOWN

    ready = obligation_use_cases.mark_obligation_ready(
        session=db, ledger_id=ledger.id, key=key
    )

    assert ready.lifecycle is ObligationLifecycle.READY
    assert ready.issue_date_state is ValueState.UNKNOWN


def _estimated_draft(db: Session) -> tuple[Obligation, ObligationKey]:
    ledger, _, category = create_category_with_recurrence(db)
    created = obligation_use_cases.ensure_obligations_for_period(
        session=db, ledger_id=ledger.id, period=BillingPeriod(2026, 8)
    )
    draft = next(
        item for item in created if item.lifecycle is ObligationLifecycle.DRAFT
    )
    # Represent complete automatic estimates produced by a system run.
    draft.current_amount = Decimal("100.00")
    draft.amount_state = ValueState.ESTIMATED
    draft.amount_source = CurrentValueSource.AUTOMATIC
    draft.issue_date = date(2026, 9, 1)
    draft.issue_date_state = ValueState.ESTIMATED
    draft.issue_date_source = CurrentValueSource.AUTOMATIC
    draft.due_date = date(2026, 9, 20)
    draft.due_date_state = ValueState.ESTIMATED
    draft.due_date_source = CurrentValueSource.AUTOMATIC
    draft.effective_value_source = EffectiveValueSourceMode.AUTOMATIC
    draft.notes = "Existing note"
    db.commit()
    key = ObligationKey(
        category_code=category.code,
        period=BillingPeriod(draft.period_year, draft.period_month),
    )
    return draft, key


@pytest.mark.parametrize("amount", [Decimal("100.00"), Decimal("0.00")])
def test_mark_draft_ready_preserves_values_sources_and_logs_one_confirmation(
    db: Session, amount: Decimal
) -> None:
    draft, key = _estimated_draft(db)
    draft.current_amount = amount
    db.commit()
    _, before_count = obligation_use_cases.list_obligation_actions(
        session=db, ledger_id=draft.ledger_id, key=key
    )

    ready = obligation_use_cases.mark_obligation_ready(
        session=db, ledger_id=draft.ledger_id, key=key
    )

    assert ready.lifecycle is ObligationLifecycle.READY
    assert ready.current_amount == amount
    assert ready.issue_date == date(2026, 9, 1)
    assert ready.due_date == date(2026, 9, 20)
    assert ready.notes == "Existing note"
    assert ready.amount_state is ValueState.CONFIRMED
    assert ready.issue_date_state is ValueState.CONFIRMED
    assert ready.due_date_state is ValueState.CONFIRMED
    assert ready.amount_source is CurrentValueSource.AUTOMATIC
    assert ready.issue_date_source is CurrentValueSource.AUTOMATIC
    assert ready.due_date_source is CurrentValueSource.AUTOMATIC
    assert ready.effective_value_source is EffectiveValueSourceMode.AUTOMATIC
    actions, count = obligation_use_cases.list_obligation_actions(
        session=db, ledger_id=draft.ledger_id, key=key
    )
    assert count == before_count + 1
    assert actions[0].action == "marked_ready"
    assert actions[0].changes["lifecycle"] == {"from": "draft", "to": "ready"}
    assert set(actions[0].changes) == {
        "lifecycle",
        "amount_state",
        "issue_date_state",
        "due_date_state",
    }


@pytest.mark.parametrize(
    "field,value",
    [
        ("current_amount", None),
        ("due_date", None),
        ("amount_state", ValueState.UNKNOWN),
        ("due_date_state", ValueState.UNKNOWN),
    ],
)
def test_mark_draft_ready_rejects_incomplete_data_without_logging(
    db: Session, field: str, value: object
) -> None:
    draft, key = _estimated_draft(db)
    setattr(draft, field, value)
    db.commit()
    _, before_count = obligation_use_cases.list_obligation_actions(
        session=db, ledger_id=draft.ledger_id, key=key
    )

    with pytest.raises(ValueError):
        obligation_use_cases.mark_obligation_ready(
            session=db, ledger_id=draft.ledger_id, key=key
        )

    assert draft.lifecycle is ObligationLifecycle.DRAFT
    _, count = obligation_use_cases.list_obligation_actions(
        session=db, ledger_id=draft.ledger_id, key=key
    )
    assert count == before_count


@pytest.mark.parametrize(
    "lifecycle",
    [
        ObligationLifecycle.READY,
        ObligationLifecycle.PAID,
        ObligationLifecycle.CANCELED,
        ObligationLifecycle.ERROR,
    ],
)
def test_mark_ready_rejects_other_lifecycles(
    db: Session, lifecycle: ObligationLifecycle
) -> None:
    draft, key = _estimated_draft(db)
    draft.lifecycle = lifecycle
    db.commit()

    with pytest.raises(ValueError, match="Only draft and collecting data"):
        obligation_use_cases.mark_obligation_ready(
            session=db, ledger_id=draft.ledger_id, key=key
        )

    assert draft.lifecycle is lifecycle
