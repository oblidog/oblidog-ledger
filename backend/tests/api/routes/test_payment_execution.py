"""Payment planning is metadata, never a confirmation that money was paid."""

from datetime import date, timedelta
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.domain import (
    BillingPeriod,
    BusinessCalendar,
    ObligationKey,
    ObligationLifecycle,
    PaymentExecution,
    ValueState,
)
from app.models import Obligation, ObligationActionLog
from app.schemas.obligations import ObligationIntegrationUpdate
from app.services.daily_digest_presentation import build_daily_digest
from app.services.daily_obligation_report import _section_for
from app.use_cases import obligations as use_cases
from app.use_cases.attention import obligation_reasons
from tests.utils.ledger_domain import create_category_tree
from tests.utils.user import authentication_token_from_email

TODAY = date(2026, 11, 23)
CALENDAR = BusinessCalendar("PL")


@pytest.mark.parametrize("execution", list(PaymentExecution))
@pytest.mark.parametrize("days", [-1, 0, 1, 2])
def test_only_overdue_planned_payments_require_verification(
    execution: PaymentExecution, days: int
) -> None:
    item = Obligation(
        lifecycle=ObligationLifecycle.READY,
        payment_execution=execution,
        due_date=TODAY + timedelta(days=days),
        due_date_state=ValueState.CONFIRMED,
        current_amount=Decimal("29.99"),
        amount_state=ValueState.CONFIRMED,
        period_year=TODAY.year,
        period_month=TODAY.month,
    )
    assert obligation_reasons(item, TODAY, CALENDAR) == (
        ["overdue", "verify_payment"] if days < 0 else []
    )
    assert _section_for(item, TODAY, BillingPeriod.from_date(TODAY), CALENDAR) == (
        "verify_payment" if days < 0 else None
    )
    assert item.lifecycle is ObligationLifecycle.READY
    assert item.paid_at is None
    for lifecycle in (ObligationLifecycle.PAID, ObligationLifecycle.CANCELED):
        item.lifecycle = lifecycle
        assert obligation_reasons(item, TODAY, CALENDAR) == []
        assert (
            _section_for(item, TODAY, BillingPeriod.from_date(TODAY), CALENDAR) is None
        )


@pytest.mark.parametrize("execution", list(PaymentExecution))
def test_payment_plans_do_not_hide_errors_or_missing_data(
    execution: PaymentExecution,
) -> None:
    item = Obligation(
        lifecycle=ObligationLifecycle.ERROR,
        payment_execution=execution,
        due_date=TODAY,
        due_date_state=ValueState.CONFIRMED,
        current_amount=None,
        amount_state=ValueState.UNKNOWN,
        period_year=TODAY.year,
        period_month=TODAY.month,
    )
    assert obligation_reasons(item, TODAY, CALENDAR) == ["error", "incomplete"]
    assert (
        _section_for(item, TODAY, BillingPeriod.from_date(TODAY), CALENDAR) == "errors"
    )
    item.lifecycle = ObligationLifecycle.COLLECTING_DATA
    item.due_date = None
    assert obligation_reasons(item, TODAY, CALENDAR) == ["incomplete"]
    assert (
        _section_for(item, TODAY, BillingPeriod.from_date(TODAY), CALENDAR)
        == "missing_due_date"
    )


def test_api_plan_updates_ready_items_without_changing_values_and_audits_changes(
    client: TestClient, db: Session
) -> None:
    ledger, _, category = create_category_tree(db)
    owner = ledger.owner
    headers = authentication_token_from_email(client=client, email=owner.email, db=db)
    item = use_cases.create_manual_obligation(
        session=db,
        ledger_id=ledger.id,
        category_code=category.code,
        period=BillingPeriod(2026, 11),
        data_ready=True,
        current_amount=Decimal("29.99"),
        due_date=date(2026, 11, 25),
    )
    url = f"{settings.API_V1_STR}/ledgers/{ledger.id}/obligations/{item.business_key}"
    response = client.patch(
        url, headers=headers, json={"payment_execution": "automatic_collection"}
    )
    assert response.status_code == 200, response.text
    assert response.json()["payment_execution"] == "automatic_collection"
    assert response.json()["lifecycle"] == "ready"
    assert response.json()["current_amount"] == "29.99"
    assert response.json()["paid_at"] is None
    count = db.scalar(
        select(func.count())
        .select_from(ObligationActionLog)
        .where(ObligationActionLog.obligation_id == item.id)
    )
    # Identical writes are not new events.
    assert (
        client.patch(
            url, headers=headers, json={"payment_execution": "automatic_collection"}
        ).status_code
        == 200
    )
    assert (
        db.scalar(
            select(func.count())
            .select_from(ObligationActionLog)
            .where(ObligationActionLog.obligation_id == item.id)
        )
        == count
    )
    logs = list(
        db.scalars(
            select(ObligationActionLog).where(
                ObligationActionLog.obligation_id == item.id,
                ObligationActionLog.action == "values_updated",
            )
        )
    )
    assert logs[-1].changes == {
        "payment_execution": {"from": None, "to": "automatic_collection"}
    }
    assert logs[-1].actor_type == "user"
    assert (
        client.patch(
            url, headers=headers, json={"payment_execution": "invalid"}
        ).status_code
        == 422
    )
    # A plan update must not bypass lifecycle restrictions on amounts/dates.
    assert (
        client.patch(
            url,
            headers=headers,
            json={"payment_execution": "scheduled_transfer", "current_amount": "1.00"},
        ).status_code
        == 409
    )
    assert (
        client.patch(url, headers=headers, json={"payment_execution": None}).json()[
            "payment_execution"
        ]
        is None
    )
    assert client.get(url, headers=headers).json()["payment_execution"] is None
    # Viewers can read the plan but cannot change it.
    from app.domain import LedgerAccessRole
    from app.use_cases import ledgers
    from tests.utils.user import create_random_user

    viewer = create_random_user(db)
    ledgers.share_ledger(
        session=db,
        ledger_id=ledger.id,
        target_user_id=viewer.id,
        role=LedgerAccessRole.VIEWER,
    )
    viewer_headers = authentication_token_from_email(
        client=client, email=viewer.email, db=db
    )
    assert (
        client.patch(
            url,
            headers=viewer_headers,
            json={"payment_execution": "scheduled_transfer"},
        ).status_code
        == 404
    )
    use_cases.mark_obligation_paid(
        session=db, ledger_id=ledger.id, key=ObligationKey.parse(item.business_key)
    )
    assert (
        client.patch(
            url, headers=headers, json={"payment_execution": "scheduled_transfer"}
        ).status_code
        == 409
    )


def test_integration_updates_preserve_plan_and_create_accepts_it(db: Session) -> None:
    ledger, _, category = create_category_tree(db)
    item = use_cases.create_manual_obligation(
        session=db,
        ledger_id=ledger.id,
        category_code=category.code,
        period=BillingPeriod(2026, 11),
        current_amount=Decimal("29.99"),
        due_date=date(2026, 11, 25),
        payment_execution=PaymentExecution.AUTOMATIC_COLLECTION,
    )
    key = ObligationKey.parse(item.business_key)
    use_cases.update_integration_obligation(
        session=db, ledger_id=ledger.id, key=key, current_amount=Decimal("39.99")
    )
    db.refresh(item)
    assert item.payment_execution is PaymentExecution.AUTOMATIC_COLLECTION
    assert item.current_amount == Decimal("39.99")
    # Integration contracts do not expose the user's plan.
    assert "payment_execution" not in ObligationIntegrationUpdate.model_fields
    use_cases.mark_obligation_ready(session=db, ledger_id=ledger.id, key=key)
    use_cases.mark_obligation_paid(session=db, ledger_id=ledger.id, key=key)
    assert item.payment_execution is PaymentExecution.AUTOMATIC_COLLECTION


def test_verification_section_is_presented_in_all_languages() -> None:
    from app.services.daily_obligation_report import DailyReportItem

    item = DailyReportItem(
        ledger_name="Home",
        category_name="Subscription",
        due_date=TODAY,
        amount=Decimal("29.99"),
        currency="PLN",
        amount_state=ValueState.CONFIRMED,
        due_date_state=ValueState.CONFIRMED,
        link="https://example.com/bill",
    )
    for language in ("pl", "en", "de"):
        digest = build_daily_digest(
            sections={"verify_payment": [item]},
            activity_count=0,
            integration_count=0,
            language=language,
        )
        assert len(digest.sections) == 1
        assert digest.sections[0].count == 1
        assert (
            digest.sections[0].ledgers[0].obligations[0].category_name == "Subscription"
        )
