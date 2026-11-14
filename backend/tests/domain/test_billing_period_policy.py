"""The write policy must not narrow the readable domain or response schema."""

import pytest
from pydantic import ValidationError

from app.domain import BillingPeriod, ObligationKey
from app.domain.obligations import validate_new_billing_year
from app.schemas.obligations import BillingPeriodInput, ObligationPeriodPublic


@pytest.mark.parametrize("year", [1970, 2199])
@pytest.mark.parametrize("month", [1, 12])
def test_supported_billing_period_boundaries(year: int, month: int) -> None:
    validate_new_billing_year(year)
    assert BillingPeriodInput(year=year, month=month).year == year


@pytest.mark.parametrize("year", [1, 999, 1969, 2200, 9999])
def test_new_periods_rejected_but_existing_periods_remain_readable(year: int) -> None:
    with pytest.raises(ValueError, match="between 1970 and 2199"):
        validate_new_billing_year(year)
    with pytest.raises(ValidationError):
        BillingPeriodInput(year=year, month=10)
    assert ObligationPeriodPublic(year=year, month=10).year == year
    assert ObligationKey.parse(f"TEST-{year:04d}-10").period == BillingPeriod(year, 10)
