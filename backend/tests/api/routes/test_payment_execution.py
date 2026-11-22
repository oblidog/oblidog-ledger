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


def test_api_plan_updates_editable_items_without_changing_values_and_audits_changes(
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
        data_ready=False,
        current_amount=Decimal("29.99"),
        due_date=date(2026, 11, 25),
    )
    url = f"{settings.API_V1_STR}/ledgers/{ledger.id}/obligations/{item.business_key}"
    response = client.patch(
        url, headers=headers, json={"payment_execution": "automatic_collection"}
    )
    assert response.status_code == 200, response.text
    assert response.json()["payment_execution"] == "automatic_collection"
    assert response.json()["lifecycle"] == "collecting_data"
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
    assert (
        client.patch(url, headers=headers, json={"payment_execution": None}).json()[
            "payment_execution"
        ]
        is None
    )
    assert client.get(url, headers=headers).json()["payment_execution"] is None
    # After data confirmation, even a plan-only PATCH must be rejected.
    use_cases.mark_obligation_ready(
        session=db, ledger_id=ledger.id, key=ObligationKey.parse(item.business_key)
    )
    assert (
        client.patch(url, headers=headers, json={"payment_execution": None}).status_code
        == 409
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


@pytest.mark.parametrize("lifecycle", list(ObligationLifecycle))
def test_payment_execution_patch_obeys_existing_editable_lifecycles(
    lifecycle: ObligationLifecycle, client: TestClient, db: Session
) -> None:
    ledger, _, category = create_category_tree(db)
    headers = authentication_token_from_email(
        client=client, email=ledger.owner.email, db=db
    )
    item = use_cases.create_manual_obligation(
        session=db,
        ledger_id=ledger.id,
        category_code=category.code,
        period=BillingPeriod(2026, 11),
        current_amount=Decimal("29.99"),
        due_date=date(2026, 11, 25),
    )
    item.lifecycle = lifecycle
    db.commit()
    url = f"{settings.API_V1_STR}/ledgers/{ledger.id}/obligations/{item.business_key}"
    before = client.get(url, headers=headers).json()
    response = client.patch(
        url, headers=headers, json={"payment_execution": "scheduled_transfer"}
    )
    if lifecycle not in {
        ObligationLifecycle.DRAFT,
        ObligationLifecycle.COLLECTING_DATA,
    }:
        assert response.status_code == 409
        assert (
            response.json()["detail"]
            == "Only draft and collecting data obligations can be edited"
        )
        assert client.get(url, headers=headers).json() == before
        return
    assert response.status_code == 200, response.text
    after = response.json()
    assert after["payment_execution"] == "scheduled_transfer"
    assert {
        key: value
        for key, value in after.items()
        if key not in {"payment_execution", "updated_at"}
    } == {
        key: value
        for key, value in before.items()
        if key not in {"payment_execution", "updated_at"}
    }


@pytest.mark.parametrize("lifecycle", list(ObligationLifecycle))
@pytest.mark.parametrize("execution", [None, *list(PaymentExecution)])
def test_scheduled_transfer_action_lifecycle_and_audit(
    lifecycle: ObligationLifecycle,
    execution: PaymentExecution | None,
    client: TestClient,
    db: Session,
) -> None:
    ledger, _, category = create_category_tree(db)
    headers = authentication_token_from_email(
        client=client, email=ledger.owner.email, db=db
    )
    item = use_cases.create_manual_obligation(
        session=db,
        ledger_id=ledger.id,
        category_code=category.code,
        period=BillingPeriod(2026, 11),
        current_amount=Decimal("29.99"),
        due_date=date(2026, 11, 25),
        payment_execution=execution,
    )
    item.lifecycle = lifecycle
    db.commit()
    url = f"{settings.API_V1_STR}/ledgers/{ledger.id}/obligations/{item.business_key}"
    before = client.get(url, headers=headers).json()
    allowed = (
        lifecycle
        in {
            ObligationLifecycle.DRAFT,
            ObligationLifecycle.COLLECTING_DATA,
            ObligationLifecycle.READY,
        }
        and execution is not PaymentExecution.AUTOMATIC_COLLECTION
    )
    count_before = db.scalar(
        select(func.count())
        .select_from(ObligationActionLog)
        .where(ObligationActionLog.obligation_id == item.id)
    )
    response = client.patch(
        f"{url}/scheduled-transfer", headers=headers, json={"scheduled": True}
    )
    assert response.status_code == (200 if allowed else 409), response.text
    if not allowed:
        assert client.get(url, headers=headers).json() == before
        return
    after = response.json()
    assert after["payment_execution"] == "scheduled_transfer"
    assert {
        k: v for k, v in after.items() if k not in {"payment_execution", "updated_at"}
    } == {
        k: v for k, v in before.items() if k not in {"payment_execution", "updated_at"}
    }
    assert (
        client.patch(
            f"{url}/scheduled-transfer", headers=headers, json={"scheduled": True}
        ).status_code
        == 200
    )
    count_after = db.scalar(
        select(func.count())
        .select_from(ObligationActionLog)
        .where(ObligationActionLog.obligation_id == item.id)
    )
    assert count_before is not None
    assert count_after == count_before + (execution is None)
    response = client.patch(
        f"{url}/scheduled-transfer", headers=headers, json={"scheduled": False}
    )
    assert response.status_code == 200
    assert response.json()["payment_execution"] is None
    logs = list(
        db.scalars(
            select(ObligationActionLog)
            .where(
                ObligationActionLog.obligation_id == item.id,
                ObligationActionLog.action == "values_updated",
            )
            .order_by(ObligationActionLog.created_at)
        )
    )
    assert logs[-1].changes == {
        "payment_execution": {"from": "scheduled_transfer", "to": None}
    }
    assert logs[-1].actor_type == "user"


def test_scheduled_transfer_action_rejects_extra_fields_and_unauthorized_users(
    client: TestClient, db: Session
) -> None:
    from app.domain import LedgerAccessRole
    from app.use_cases import ledgers
    from tests.utils.user import create_random_user

    ledger, _, category = create_category_tree(db)
    item = use_cases.create_manual_obligation(
        session=db,
        ledger_id=ledger.id,
        category_code=category.code,
        period=BillingPeriod(2026, 11),
        data_ready=True,
        current_amount=Decimal("37.00"),
        due_date=date(2026, 11, 24),
    )
    owner_headers = authentication_token_from_email(
        client=client, email=ledger.owner.email, db=db
    )
    url = f"{settings.API_V1_STR}/ledgers/{ledger.id}/obligations/{item.business_key}/scheduled-transfer"
    for body in [
        {"scheduled": True, "current_amount": "1"},
        {"scheduled": True, "payment_execution": "automatic_collection"},
        {"scheduled": None},
        {"scheduled": "true"},
        {},
    ]:
        assert client.patch(url, headers=owner_headers, json=body).status_code == 422
    assert client.patch(url, json={"scheduled": True}).status_code == 401
    for role in [None, LedgerAccessRole.VIEWER, LedgerAccessRole.EDITOR]:
        user = create_random_user(db)
        if role:
            ledgers.share_ledger(
                session=db, ledger_id=ledger.id, target_user_id=user.id, role=role
            )
        headers = authentication_token_from_email(
            client=client, email=user.email, db=db
        )
        assert client.patch(
            url, headers=headers, json={"scheduled": True}
        ).status_code == (200 if role is LedgerAccessRole.EDITOR else 404)
    db.refresh(item)
    assert item.current_amount == Decimal("37.00")
    assert item.lifecycle is ObligationLifecycle.READY
    assert item.paid_at is None
    other, _, _ = create_category_tree(db)
    other_headers = authentication_token_from_email(
        client=client, email=other.owner.email, db=db
    )
    other_url = f"{settings.API_V1_STR}/ledgers/{other.id}/obligations/{item.business_key}/scheduled-transfer"
    assert (
        client.patch(
            other_url, headers=other_headers, json={"scheduled": True}
        ).status_code
        == 404
    )
    assert (
        client.patch(
            url.replace(item.business_key, "invalid"),
            headers=owner_headers,
            json={"scheduled": True},
        ).status_code
        == 422
    )


def test_category_automatic_collection_is_a_creation_default_with_explicit_overrides(
    client: TestClient, db: Session
) -> None:
    from app.services.obligations import get_or_create_obligation
    from app.use_cases import categories

    ledger, _, category = create_category_tree(db)
    headers = authentication_token_from_email(
        client=client, email=ledger.owner.email, db=db
    )
    url = f"{settings.API_V1_STR}/ledgers/{ledger.id}/obligations"
    old = use_cases.create_manual_obligation(
        session=db,
        ledger_id=ledger.id,
        category_code=category.code,
        period=BillingPeriod(2026, 1),
        payment_execution=PaymentExecution.SCHEDULED_TRANSFER,
    )
    cat_url = f"{settings.API_V1_STR}/ledgers/{ledger.id}/categories/{category.id}"
    body = {
        "name": category.name,
        "data_source_policy": category.data_source_policy.value,
        "automatic_collection": True,
    }
    response = client.patch(cat_url, headers=headers, json=body)
    assert response.status_code == 200, response.text
    assert response.json()["automatic_collection"] is True
    # Older clients omitting the new field cannot clear an existing default.
    body.pop("automatic_collection")
    assert (
        client.patch(cat_url, headers=headers, json=body).json()["automatic_collection"]
        is True
    )
    create_cases: list[tuple[int, dict[str, str | None], str | None]] = [
        (2, {}, "automatic_collection"),
        (3, {"payment_execution": None}, None),
        (4, {"payment_execution": "scheduled_transfer"}, "scheduled_transfer"),
    ]
    for month, extra, expected in create_cases:
        response = client.post(
            url,
            headers=headers,
            json={
                "category_code": category.code,
                "period": {"year": 2026, "month": month},
                **extra,
            },
        )
        assert response.status_code == 200, response.text
        assert response.json()["payment_execution"] == expected
    db.refresh(category)
    generated, created = get_or_create_obligation(
        session=db, category=category, period=BillingPeriod(2026, 5)
    )
    assert created
    assert generated.payment_execution is PaymentExecution.AUTOMATIC_COLLECTION
    db.commit()
    categories.update_category(
        session=db,
        ledger_id=ledger.id,
        category_id=category.id,
        name=category.name,
        automatic_collection=False,
    )
    db.refresh(old)
    db.refresh(generated)
    assert old.payment_execution is PaymentExecution.SCHEDULED_TRANSFER
    assert generated.payment_execution is PaymentExecution.AUTOMATIC_COLLECTION
    same, created = get_or_create_obligation(
        session=db, category=category, period=BillingPeriod(2026, 5)
    )
    assert not created
    assert same.payment_execution is PaymentExecution.AUTOMATIC_COLLECTION
    next_item = use_cases.create_manual_obligation(
        session=db,
        ledger_id=ledger.id,
        category_code=category.code,
        period=BillingPeriod(2026, 6),
    )
    assert next_item.payment_execution is None
    # Category creation API persists the default too.
    response = client.post(
        f"{settings.API_V1_STR}/ledgers/{ledger.id}/categories",
        headers=headers,
        json={
            "category_group_id": str(category.category_group_id),
            "name": "Subscription",
            "code": "SUBS",
            "automatic_collection": True,
        },
    )
    assert response.status_code == 200, response.text
    assert response.json()["automatic_collection"] is True
