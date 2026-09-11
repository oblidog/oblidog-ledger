import uuid
from datetime import date
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.config import settings
from app.domain import BillingPeriod, Currency, ObligationKey, ObligationLifecycle
from app.use_cases import categories as category_use_cases
from app.use_cases import ledgers as ledger_use_cases
from app.use_cases import obligations as obligation_use_cases
from tests.utils.user import authentication_token_from_email, create_random_user
from tests.utils.utils import random_lower_string

PERIOD = BillingPeriod(2026, 8)


def _create_obligation(
    db: Session,
    *,
    ledger_id: uuid.UUID,
    code: str,
    amount: Decimal | None,
    currency: Currency = Currency.PLN,
):
    group = category_use_cases.create_category_group(
        session=db, ledger_id=ledger_id, name=f"group-{code}"
    )
    category_use_cases.create_category(
        session=db,
        ledger_id=ledger_id,
        category_group_id=group.id,
        name=f"Category {code}",
        code=code,
        currency=currency,
    )
    return obligation_use_cases.create_manual_obligation(
        session=db,
        ledger_id=ledger_id,
        category_code=code,
        period=PERIOD,
        data_ready=amount is not None,
        current_amount=amount,
        due_date=date(2026, 8, 20) if amount is not None else None,
    )


def _summary_url(ledger_id: uuid.UUID) -> str:
    return (
        f"{settings.API_V1_STR}/ledgers/{ledger_id}/analytics/period-summary"
        "?year=2026&month=8"
    )


def _create_history_category(
    db: Session,
    *,
    ledger_id: uuid.UUID,
    currency: Currency = Currency.PLN,
    code: str = "HIST",
):
    group = category_use_cases.create_category_group(
        session=db, ledger_id=ledger_id, name=f"group-{random_lower_string()}"
    )
    return category_use_cases.create_category(
        session=db,
        ledger_id=ledger_id,
        category_group_id=group.id,
        name=f"Category {random_lower_string()}",
        code=code,
        currency=currency,
    )


def _create_history_obligation(
    db: Session,
    *,
    ledger_id: uuid.UUID,
    category_code: str,
    period: BillingPeriod,
    amount: Decimal | None,
):
    return obligation_use_cases.create_manual_obligation(
        session=db,
        ledger_id=ledger_id,
        category_code=category_code,
        period=period,
        data_ready=amount is not None,
        current_amount=amount,
        due_date=date(period.year, period.month, 20) if amount is not None else None,
    )


@pytest.mark.parametrize(
    ("paid_indexes", "expected_paid_count", "expected_paid_percentage"),
    [({0, 1}, 2, "100"), (set(), 0, "0"), ({0}, 1, "50")],
)
def test_period_summary_reports_all_none_and_partially_paid_obligations(
    client: TestClient,
    db: Session,
    paid_indexes: set[int],
    expected_paid_count: int,
    expected_paid_percentage: str,
) -> None:
    owner = create_random_user(db)
    headers = authentication_token_from_email(client=client, email=owner.email, db=db)
    ledger = ledger_use_cases.create_ledger(
        session=db, owner_user_id=owner.id, name=f"ledger-{random_lower_string()}"
    )
    obligations = [
        _create_obligation(db, ledger_id=ledger.id, code=code, amount=Decimal("50.00"))
        for code in ("PAID", "UNPD")
    ]
    for index in paid_indexes:
        obligation_use_cases.mark_obligation_paid(
            session=db,
            ledger_id=ledger.id,
            key=ObligationKey.parse(obligations[index].business_key),
        )

    response = client.get(_summary_url(ledger.id), headers=headers)

    assert response.status_code == 200
    assert response.json() == {
        "period": {"year": 2026, "month": 8},
        "total_obligation_count": 2,
        "paid_obligation_count": expected_paid_count,
        "paid_percentage": expected_paid_percentage,
        "unknown_amount_count": 0,
        "is_complete": True,
        "amount_summaries": [
            {
                "currency": "PLN",
                "total_known_amount": "100.00",
                "paid_known_amount": f"{expected_paid_count * 50}.00",
                "paid_percentage": expected_paid_percentage,
            }
        ],
    }


def test_period_summary_keeps_unknown_amounts_and_currencies_separate(
    client: TestClient, db: Session
) -> None:
    owner = create_random_user(db)
    headers = authentication_token_from_email(client=client, email=owner.email, db=db)
    ledger = ledger_use_cases.create_ledger(
        session=db, owner_user_id=owner.id, name=f"ledger-{random_lower_string()}"
    )
    paid_pln = _create_obligation(
        db, ledger_id=ledger.id, code="PAID", amount=Decimal("50.00")
    )
    _create_obligation(db, ledger_id=ledger.id, code="UNPD", amount=Decimal("50.00"))
    paid_eur = _create_obligation(
        db,
        ledger_id=ledger.id,
        code="EURO",
        amount=Decimal("20.00"),
        currency=Currency.EUR,
    )
    _create_obligation(db, ledger_id=ledger.id, code="UNKN", amount=None)
    for obligation in (paid_pln, paid_eur):
        obligation_use_cases.mark_obligation_paid(
            session=db,
            ledger_id=ledger.id,
            key=ObligationKey.parse(obligation.business_key),
        )

    other_ledger = ledger_use_cases.create_ledger(
        session=db, owner_user_id=owner.id, name=f"ledger-{random_lower_string()}"
    )
    _create_obligation(
        db, ledger_id=other_ledger.id, code="OTHR", amount=Decimal("999.00")
    )

    response = client.get(_summary_url(ledger.id), headers=headers)

    assert response.status_code == 200
    assert response.json()["total_obligation_count"] == 4
    assert response.json()["paid_obligation_count"] == 2
    assert response.json()["paid_percentage"] == "50"
    assert response.json()["unknown_amount_count"] == 1
    assert response.json()["is_complete"] is False
    assert response.json()["amount_summaries"] == [
        {
            "currency": "EUR",
            "total_known_amount": "20.00",
            "paid_known_amount": "20.00",
            "paid_percentage": "100",
        },
        {
            "currency": "PLN",
            "total_known_amount": "100.00",
            "paid_known_amount": "50.00",
            "paid_percentage": "50",
        },
    ]


def test_period_summary_includes_known_draft_and_error_amounts(
    client: TestClient, db: Session
) -> None:
    owner = create_random_user(db)
    headers = authentication_token_from_email(client=client, email=owner.email, db=db)
    ledger = ledger_use_cases.create_ledger(
        session=db, owner_user_id=owner.id, name=f"ledger-{random_lower_string()}"
    )
    paid = _create_obligation(
        db, ledger_id=ledger.id, code="PAID", amount=Decimal("10.00")
    )
    draft = _create_obligation(
        db, ledger_id=ledger.id, code="DRFT", amount=Decimal("30.00")
    )
    error = _create_obligation(
        db, ledger_id=ledger.id, code="ERRO", amount=Decimal("60.00")
    )
    obligation_use_cases.mark_obligation_paid(
        session=db,
        ledger_id=ledger.id,
        key=ObligationKey.parse(paid.business_key),
    )
    draft.lifecycle = ObligationLifecycle.DRAFT
    error.lifecycle = ObligationLifecycle.ERROR
    db.commit()

    response = client.get(_summary_url(ledger.id), headers=headers)

    assert response.status_code == 200
    assert response.json()["paid_obligation_count"] == 1
    assert response.json()["total_obligation_count"] == 3
    assert response.json()["paid_percentage"] == "33.33"
    assert response.json()["amount_summaries"] == [
        {
            "currency": "PLN",
            "total_known_amount": "100.00",
            "paid_known_amount": "10.00",
            "paid_percentage": "10",
        }
    ]


def test_period_summary_excludes_missing_error_amount_from_amount_totals(
    client: TestClient, db: Session
) -> None:
    owner = create_random_user(db)
    headers = authentication_token_from_email(client=client, email=owner.email, db=db)
    ledger = ledger_use_cases.create_ledger(
        session=db, owner_user_id=owner.id, name=f"ledger-{random_lower_string()}"
    )
    known = _create_obligation(
        db, ledger_id=ledger.id, code="KNWN", amount=Decimal("40.00")
    )
    unknown_error = _create_obligation(
        db, ledger_id=ledger.id, code="UNKN", amount=None
    )
    known.lifecycle = ObligationLifecycle.READY
    unknown_error.lifecycle = ObligationLifecycle.ERROR
    db.commit()

    response = client.get(_summary_url(ledger.id), headers=headers)

    assert response.status_code == 200
    assert response.json()["unknown_amount_count"] == 1
    assert response.json()["is_complete"] is False
    assert response.json()["amount_summaries"] == [
        {
            "currency": "PLN",
            "total_known_amount": "40.00",
            "paid_known_amount": "0.00",
            "paid_percentage": "0",
        }
    ]


def test_period_summary_returns_no_amount_percentage_for_zero_total(
    client: TestClient, db: Session
) -> None:
    owner = create_random_user(db)
    headers = authentication_token_from_email(client=client, email=owner.email, db=db)
    ledger = ledger_use_cases.create_ledger(
        session=db, owner_user_id=owner.id, name=f"ledger-{random_lower_string()}"
    )
    _create_obligation(db, ledger_id=ledger.id, code="ZERO", amount=Decimal("0.00"))

    response = client.get(_summary_url(ledger.id), headers=headers)

    assert response.status_code == 200
    assert response.json()["amount_summaries"] == [
        {
            "currency": "PLN",
            "total_known_amount": "0.00",
            "paid_known_amount": "0.00",
            "paid_percentage": None,
        }
    ]


def test_period_summary_rounds_percentages_to_two_decimal_places(
    client: TestClient, db: Session
) -> None:
    owner = create_random_user(db)
    headers = authentication_token_from_email(client=client, email=owner.email, db=db)
    ledger = ledger_use_cases.create_ledger(
        session=db, owner_user_id=owner.id, name="rounded-percentages"
    )
    obligations = [
        _create_obligation(db, ledger_id=ledger.id, code=code, amount=Decimal("10"))
        for code in ("ONEE", "TWOO", "THRE")
    ]
    for obligation in obligations[:2]:
        obligation_use_cases.mark_obligation_paid(
            session=db,
            ledger_id=ledger.id,
            key=ObligationKey.parse(obligation.business_key),
        )

    response = client.get(_summary_url(ledger.id), headers=headers)

    assert response.status_code == 200
    assert response.json()["paid_percentage"] == "66.67"
    assert response.json()["amount_summaries"][0]["paid_percentage"] == "66.67"


def test_period_summary_excludes_canceled_obligations(
    client: TestClient, db: Session
) -> None:
    owner = create_random_user(db)
    headers = authentication_token_from_email(client=client, email=owner.email, db=db)
    ledger = ledger_use_cases.create_ledger(
        session=db, owner_user_id=owner.id, name=f"ledger-{random_lower_string()}"
    )
    paid = _create_obligation(
        db, ledger_id=ledger.id, code="PAID", amount=Decimal("50.00")
    )
    canceled = _create_obligation(
        db, ledger_id=ledger.id, code="CNCL", amount=Decimal("50.00")
    )
    obligation_use_cases.mark_obligation_paid(
        session=db,
        ledger_id=ledger.id,
        key=ObligationKey.parse(paid.business_key),
    )
    canceled.lifecycle = ObligationLifecycle.CANCELED
    db.commit()

    response = client.get(_summary_url(ledger.id), headers=headers)

    assert response.status_code == 200
    assert response.json()["total_obligation_count"] == 1
    assert response.json()["paid_obligation_count"] == 1
    assert response.json()["paid_percentage"] == "100"
    assert response.json()["unknown_amount_count"] == 0
    assert response.json()["is_complete"] is True
    assert response.json()["amount_summaries"] == [
        {
            "currency": "PLN",
            "total_known_amount": "50.00",
            "paid_known_amount": "50.00",
            "paid_percentage": "100",
        }
    ]


def test_period_summary_for_an_empty_period_is_complete_without_percentages(
    client: TestClient, db: Session
) -> None:
    owner = create_random_user(db)
    headers = authentication_token_from_email(client=client, email=owner.email, db=db)
    ledger = ledger_use_cases.create_ledger(
        session=db, owner_user_id=owner.id, name=f"ledger-{random_lower_string()}"
    )

    response = client.get(_summary_url(ledger.id), headers=headers)

    assert response.status_code == 200
    assert response.json() == {
        "period": {"year": 2026, "month": 8},
        "total_obligation_count": 0,
        "paid_obligation_count": 0,
        "paid_percentage": None,
        "unknown_amount_count": 0,
        "is_complete": True,
        "amount_summaries": [],
    }


def test_category_history_is_continuous_and_distinguishes_missing_and_unknown(
    client: TestClient, db: Session
) -> None:
    owner = create_random_user(db)
    headers = authentication_token_from_email(client=client, email=owner.email, db=db)
    ledger = ledger_use_cases.create_ledger(
        session=db, owner_user_id=owner.id, name=f"ledger-{random_lower_string()}"
    )
    category = _create_history_category(db, ledger_id=ledger.id, currency=Currency.EUR)
    _create_history_obligation(
        db,
        ledger_id=ledger.id,
        category_code=category.code,
        period=BillingPeriod(2025, 12),
        amount=Decimal("10.00"),
    )
    _create_history_obligation(
        db,
        ledger_id=ledger.id,
        category_code=category.code,
        period=BillingPeriod(2026, 2),
        amount=None,
    )

    response = client.get(
        f"{settings.API_V1_STR}/ledgers/{ledger.id}/analytics/categories/"
        f"{category.id}/history?from=2025-12&to=2026-02",
        headers=headers,
    )

    assert response.status_code == 200
    assert response.json()["points"] == [
        {
            "period": {"year": 2025, "month": 12},
            "state": "known",
            "current_amount": "10.00",
            "currency": "EUR",
        },
        {
            "period": {"year": 2026, "month": 1},
            "state": "missing",
            "current_amount": None,
            "currency": "EUR",
        },
        {
            "period": {"year": 2026, "month": 2},
            "state": "unknown",
            "current_amount": None,
            "currency": "EUR",
        },
    ]


def test_category_history_preserves_each_obligations_currency(
    client: TestClient, db: Session
) -> None:
    owner = create_random_user(db)
    headers = authentication_token_from_email(client=client, email=owner.email, db=db)
    ledger = ledger_use_cases.create_ledger(
        session=db, owner_user_id=owner.id, name=f"ledger-{random_lower_string()}"
    )
    category = _create_history_category(db, ledger_id=ledger.id, currency=Currency.PLN)
    _create_history_obligation(
        db,
        ledger_id=ledger.id,
        category_code=category.code,
        period=BillingPeriod(2025, 12),
        amount=Decimal("10.00"),
    )
    category_use_cases.update_category(
        session=db,
        ledger_id=ledger.id,
        category_id=category.id,
        name=category.name,
        currency=Currency.EUR,
    )
    _create_history_obligation(
        db,
        ledger_id=ledger.id,
        category_code=category.code,
        period=BillingPeriod(2026, 1),
        amount=Decimal("20.00"),
    )

    response = client.get(
        f"{settings.API_V1_STR}/ledgers/{ledger.id}/analytics/categories/"
        f"{category.id}/history?from=2025-12&to=2026-01",
        headers=headers,
    )

    assert response.status_code == 200
    assert response.json()["points"] == [
        {
            "period": {"year": 2025, "month": 12},
            "state": "known",
            "current_amount": "10.00",
            "currency": "PLN",
        },
        {
            "period": {"year": 2026, "month": 1},
            "state": "known",
            "current_amount": "20.00",
            "currency": "EUR",
        },
    ]


def test_category_history_is_scoped_to_its_ledger_and_validates_ranges(
    client: TestClient, db: Session
) -> None:
    owner = create_random_user(db)
    headers = authentication_token_from_email(client=client, email=owner.email, db=db)
    ledger = ledger_use_cases.create_ledger(
        session=db, owner_user_id=owner.id, name=f"ledger-{random_lower_string()}"
    )
    other_ledger = ledger_use_cases.create_ledger(
        session=db, owner_user_id=owner.id, name=f"ledger-{random_lower_string()}"
    )
    category = _create_history_category(db, ledger_id=other_ledger.id)
    base_url = (
        f"{settings.API_V1_STR}/ledgers/{ledger.id}/analytics/categories/"
        f"{category.id}/history"
    )

    wrong_ledger = client.get(f"{base_url}?from=2026-01&to=2026-01", headers=headers)
    invalid_range = client.get(f"{base_url}?from=2026-02&to=2026-01", headers=headers)

    assert wrong_ledger.status_code == 404
    assert invalid_range.status_code == 422


def test_period_totals_are_continuous_currency_preserving_and_ledger_scoped(
    client: TestClient, db: Session
) -> None:
    owner = create_random_user(db)
    headers = authentication_token_from_email(client=client, email=owner.email, db=db)
    ledger = ledger_use_cases.create_ledger(
        session=db, owner_user_id=owner.id, name="period-totals"
    )
    other_ledger = ledger_use_cases.create_ledger(
        session=db, owner_user_id=owner.id, name="other-period-totals"
    )
    pln = _create_history_category(
        db, ledger_id=ledger.id, currency=Currency.PLN, code="PTPL"
    )
    eur = _create_history_category(
        db, ledger_id=ledger.id, currency=Currency.EUR, code="PTEU"
    )
    _create_history_obligation(
        db,
        ledger_id=ledger.id,
        category_code=pln.code,
        period=BillingPeriod(2025, 12),
        amount=Decimal("10.00"),
    )
    _create_history_obligation(
        db,
        ledger_id=ledger.id,
        category_code=pln.code,
        period=BillingPeriod(2026, 1),
        amount=None,
    )
    _create_history_obligation(
        db,
        ledger_id=ledger.id,
        category_code=pln.code,
        period=BillingPeriod(2026, 2),
        amount=Decimal("15.00"),
    )
    _create_history_obligation(
        db,
        ledger_id=ledger.id,
        category_code=eur.code,
        period=BillingPeriod(2026, 2),
        amount=Decimal("20.00"),
    )
    other_category = _create_history_category(
        db, ledger_id=other_ledger.id, code="OTHR"
    )
    _create_history_obligation(
        db,
        ledger_id=other_ledger.id,
        category_code=other_category.code,
        period=BillingPeriod(2026, 2),
        amount=Decimal("999.00"),
    )

    response = client.get(
        f"{settings.API_V1_STR}/ledgers/{ledger.id}/analytics/period-totals"
        "?from=2025-12&to=2026-03",
        headers=headers,
    )

    assert response.status_code == 200
    assert response.json()["points"] == [
        {
            "period": {"year": 2025, "month": 12},
            "total_obligation_count": 1,
            "unknown_amount_count": 0,
            "is_complete": True,
            "currency_summaries": [
                {"currency": "EUR", "total_known_amount": "0.00"},
                {"currency": "PLN", "total_known_amount": "10.00"},
            ],
        },
        {
            "period": {"year": 2026, "month": 1},
            "total_obligation_count": 1,
            "unknown_amount_count": 1,
            "is_complete": False,
            "currency_summaries": [
                {"currency": "EUR", "total_known_amount": "0.00"},
                {"currency": "PLN", "total_known_amount": "0.00"},
            ],
        },
        {
            "period": {"year": 2026, "month": 2},
            "total_obligation_count": 2,
            "unknown_amount_count": 0,
            "is_complete": True,
            "currency_summaries": [
                {"currency": "EUR", "total_known_amount": "20.00"},
                {"currency": "PLN", "total_known_amount": "15.00"},
            ],
        },
        {
            "period": {"year": 2026, "month": 3},
            "total_obligation_count": 0,
            "unknown_amount_count": 0,
            "is_complete": True,
            "currency_summaries": [
                {"currency": "EUR", "total_known_amount": "0.00"},
                {"currency": "PLN", "total_known_amount": "0.00"},
            ],
        },
    ]


def test_period_totals_reject_an_inverted_range(
    client: TestClient, db: Session
) -> None:
    owner = create_random_user(db)
    headers = authentication_token_from_email(client=client, email=owner.email, db=db)
    ledger = ledger_use_cases.create_ledger(
        session=db, owner_user_id=owner.id, name="period-totals-range"
    )

    response = client.get(
        f"{settings.API_V1_STR}/ledgers/{ledger.id}/analytics/period-totals"
        "?from=2026-02&to=2026-01",
        headers=headers,
    )

    assert response.status_code == 422


def test_cashflow_separates_currencies_and_exposes_incomplete_unpaid_data(
    client: TestClient, db: Session, monkeypatch
) -> None:
    class FrozenDate(date):
        @classmethod
        def today(cls) -> date:
            return cls(2026, 8, 15)

    from app.use_cases import analytics as analytics_use_cases

    monkeypatch.setattr(analytics_use_cases, "date", FrozenDate)
    owner = create_random_user(db)
    headers = authentication_token_from_email(client=client, email=owner.email, db=db)
    ledger = ledger_use_cases.create_ledger(
        session=db, owner_user_id=owner.id, name=f"ledger-{random_lower_string()}"
    )
    pln = _create_history_category(
        db, ledger_id=ledger.id, currency=Currency.PLN, code="PLNC"
    )
    eur = _create_history_category(
        db, ledger_id=ledger.id, currency=Currency.EUR, code="EURC"
    )
    _create_history_obligation(
        db,
        ledger_id=ledger.id,
        category_code=pln.code,
        period=PERIOD,
        amount=Decimal("100.00"),
    ).due_date = date(2026, 8, 10)
    _create_history_obligation(
        db,
        ledger_id=ledger.id,
        category_code=eur.code,
        period=PERIOD,
        amount=Decimal("20.00"),
    ).due_date = date(2026, 8, 20)
    _create_history_obligation(
        db,
        ledger_id=ledger.id,
        category_code=pln.code,
        period=BillingPeriod(2026, 7),
        amount=None,
    )
    db.commit()

    response = client.get(
        f"{settings.API_V1_STR}/ledgers/{ledger.id}/analytics/cashflow?year=2026&month=8",
        headers=headers,
    )

    assert response.status_code == 200
    assert response.json()["unknown_amount_count"] == 0
    assert response.json()["is_complete"] is True
    assert [item["currency"] for item in response.json()["currency_summaries"]] == [
        "EUR",
        "PLN",
    ]


def _cashflow_url(ledger_id: uuid.UUID) -> str:
    return f"{settings.API_V1_STR}/ledgers/{ledger_id}/analytics/cashflow?year=2026&month=8"


def test_cashflow_excludes_paid_obligations_and_isolates_ledgers(
    client: TestClient, db: Session
) -> None:
    owner = create_random_user(db)
    headers = authentication_token_from_email(client=client, email=owner.email, db=db)
    ledger = ledger_use_cases.create_ledger(
        session=db, owner_user_id=owner.id, name="cashflow"
    )
    other = ledger_use_cases.create_ledger(
        session=db, owner_user_id=owner.id, name="other"
    )
    paid = _create_obligation(
        db, ledger_id=ledger.id, code="PAID", amount=Decimal("10")
    )
    obligation_use_cases.mark_obligation_paid(
        session=db, ledger_id=ledger.id, key=ObligationKey.parse(paid.business_key)
    )
    _create_obligation(db, ledger_id=other.id, code="OTHR", amount=Decimal("99"))

    response = client.get(_cashflow_url(ledger.id), headers=headers)

    assert response.status_code == 200
    assert response.json()["currency_summaries"] == []
    assert response.json()["is_complete"] is True


def test_cashflow_reports_unscheduled_and_unknown_unpaid_obligations(
    client: TestClient, db: Session
) -> None:
    owner = create_random_user(db)
    headers = authentication_token_from_email(client=client, email=owner.email, db=db)
    ledger = ledger_use_cases.create_ledger(
        session=db, owner_user_id=owner.id, name="cashflow"
    )
    known = _create_obligation(
        db, ledger_id=ledger.id, code="KNWN", amount=Decimal("30")
    )
    unknown = _create_obligation(db, ledger_id=ledger.id, code="UNKN", amount=None)
    known.due_date = None
    unknown.due_date = None
    db.commit()

    response = client.get(_cashflow_url(ledger.id), headers=headers)

    assert response.status_code == 200
    assert response.json()["unknown_amount_count"] == 1
    assert response.json()["without_due_date_count"] == 2
    assert response.json()["is_complete"] is False
    assert (
        response.json()["currency_summaries"][0]["unscheduled_known_amount"] == "30.00"
    )


def test_cashflow_for_empty_period_returns_an_empty_complete_summary(
    client: TestClient, db: Session
) -> None:
    owner = create_random_user(db)
    headers = authentication_token_from_email(client=client, email=owner.email, db=db)
    ledger = ledger_use_cases.create_ledger(
        session=db, owner_user_id=owner.id, name="cashflow"
    )

    response = client.get(_cashflow_url(ledger.id), headers=headers)

    assert response.status_code == 200
    assert response.json()["currency_summaries"] == []
    assert response.json()["unknown_amount_count"] == 0
    assert response.json()["without_due_date_count"] == 0
    assert response.json()["is_complete"] is True
