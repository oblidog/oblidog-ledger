from datetime import date

import pytest
from pydantic import ValidationError

from app.domain import BillingPeriod, Currency, DataSourcePolicy
from app.domain.business_calendar import (
    supported_calendar_countries,
    validate_calendar_country,
)
from app.models import Category, Ledger
from app.schemas.categories import CategoryCreate, CategoryUpdate
from app.schemas.ledgers import LedgerCreate, LedgerUpdate
from app.services.obligations import _due_date_for_period


def test_supported_country_codes_and_normalization() -> None:
    assert {"PL", "DE", "GB"} <= set(supported_calendar_countries())
    assert "POL" not in supported_calendar_countries()
    assert "UK" not in supported_calendar_countries()
    assert validate_calendar_country(" de ") == "DE"


@pytest.mark.parametrize("country", ["", "XX", "POL", "PL;DROP TABLE ledger"])
def test_unsupported_country_is_rejected(country: str) -> None:
    with pytest.raises(ValidationError):
        LedgerCreate(name="Test", business_calendar_country=country)


def test_omitted_preferences_do_not_reset_existing_values() -> None:
    update = LedgerUpdate(name="Renamed")
    assert update.business_calendar_country is None
    assert update.default_currency is None
    assert LedgerCreate(name="Test").default_currency is Currency.PLN


def test_category_currency_omission_is_distinguished_from_explicit_value() -> None:
    import uuid

    category = CategoryCreate(category_group_id=uuid.uuid4(), name="Test", code="TEST")
    assert category.currency is None
    assert (
        CategoryUpdate(name="Test", data_source_policy=DataSourcePolicy.MANUAL).currency
        is None
    )


@pytest.mark.parametrize(
    ("country", "expected"), [("PL", date(2026, 11, 10)), ("DE", date(2026, 11, 11))]
)
def test_generation_uses_ledger_country(country: str, expected: date) -> None:
    category = Category(
        first_due_date=date(2026, 11, 11),
        ledger=Ledger(business_calendar_country=country),
    )
    assert (
        _due_date_for_period(category=category, period=BillingPeriod(2026, 11))
        == expected
    )
