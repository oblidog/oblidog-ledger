from datetime import date
from decimal import Decimal

from sqlalchemy.orm import Session

from app.domain import BillingPeriod, ObligationKey, ObligationLifecycle, ValueState
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
