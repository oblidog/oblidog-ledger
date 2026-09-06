from __future__ import annotations

import argparse
import logging
import os
import uuid
from calendar import monthrange
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.db import engine
from app.domain import (
    BillingPeriod,
    DataSourcePolicy,
    ObligationKey,
    ObligationLifecycle,
    RecurrenceUnit,
    due_date_range,
)
from app.models import Ledger, Obligation, User
from app.schemas import UserCreate
from app.services import users as user_service
from app.use_cases.categories import create_category, create_category_group
from app.use_cases.ledgers import create_ledger
from app.use_cases.obligations import (
    create_manual_obligation,
    mark_obligation_error,
    mark_obligation_paid,
)

logger = logging.getLogger(__name__)

DEMO_EMAIL = "demo@oblidog.com"
DEMO_LEDGER_NAME = "Oblidog Demo"
DEMO_PASSWORD_ENV = "DEMO_USER_PASSWORD"


@dataclass(frozen=True, slots=True)
class DemoSeedResult:
    user_id: uuid.UUID
    ledger_id: uuid.UUID
    reference_date: date


def _shift_period(period: BillingPeriod, months: int) -> BillingPeriod:
    absolute_month = period.year * 12 + (period.month - 1) + months
    year, zero_based_month = divmod(absolute_month, 12)
    return BillingPeriod(year=year, month=zero_based_month + 1)


def _date_in_period(period: BillingPeriod, day: int) -> date:
    return date(
        period.year,
        period.month,
        min(day, monthrange(period.year, period.month)[1]),
    )


def _key(category_code: str, period: BillingPeriod) -> ObligationKey:
    return ObligationKey(category_code=category_code, period=period)


def _create_ready_obligation(
    *,
    session: Session,
    ledger_id: uuid.UUID,
    category_code: str,
    period: BillingPeriod,
    amount: str,
    due_date: date,
    issue_date: date | None = None,
    notes: str | None = None,
) -> Obligation:
    return create_manual_obligation(
        session=session,
        ledger_id=ledger_id,
        category_code=category_code,
        period=period,
        data_ready=True,
        current_amount=Decimal(amount),
        issue_date=issue_date,
        due_date=due_date,
        notes=notes,
    )


def _ensure_demo_user(*, session: Session, password: str) -> User:
    user = user_service.get_user_by_email(session=session, email=DEMO_EMAIL)
    if user is None:
        return user_service.create_user(
            session=session,
            user_in=UserCreate(
                email=DEMO_EMAIL,
                password=password,
                is_active=True,
                is_superuser=False,
                full_name="Demo User",
            ),
        )

    user.full_name = "Demo User"
    user.is_active = True
    user.is_superuser = False
    user_service.set_user_password(session=session, user=user, new_password=password)
    return user


def _remove_existing_demo_ledger(*, session: Session, user_id: uuid.UUID) -> None:
    ledger = session.scalar(
        select(Ledger).where(
            Ledger.owner_user_id == user_id,
            Ledger.name == DEMO_LEDGER_NAME,
        )
    )
    if ledger is None:
        return
    session.delete(ledger)
    session.commit()


def seed_demo(
    *,
    session: Session,
    password: str,
    reference_date: date | None = None,
) -> DemoSeedResult:
    today = reference_date or date.today()
    current = BillingPeriod.from_date(today)
    previous = _shift_period(current, -1)
    two_months_ago = _shift_period(current, -2)
    next_period = _shift_period(current, 1)

    user = _ensure_demo_user(session=session, password=password)
    _remove_existing_demo_ledger(session=session, user_id=user.id)

    ledger = create_ledger(
        session=session,
        owner_user_id=user.id,
        name=DEMO_LEDGER_NAME,
        description="Public demo ledger with resettable sample household expenses.",
    )

    housing = create_category_group(
        session=session,
        ledger_id=ledger.id,
        name="Housing",
        description="Recurring home-related expenses.",
    )
    utilities = create_category_group(
        session=session,
        ledger_id=ledger.id,
        name="Utilities",
        description="Household utilities and connectivity.",
    )
    subscriptions = create_category_group(
        session=session,
        ledger_id=ledger.id,
        name="Subscriptions",
        description="Digital subscriptions and recurring services.",
    )

    category_specs = (
        (housing.id, "Rent", "RENT", "Monthly apartment rent", 5),
        (utilities.id, "Electricity", "ELEC", "Electricity bill", 12),
        (utilities.id, "Internet", "INET", "Home internet service", 18),
        (utilities.id, "Mobile", "MOBI", "Mobile phone plan", 22),
        (subscriptions.id, "Streaming", "STRM", "Video streaming subscription", 14),
    )
    for group_id, name, code, description, due_day in category_specs:
        create_category(
            session=session,
            ledger_id=ledger.id,
            category_group_id=group_id,
            name=name,
            description=description,
            code=code,
            data_source_policy=DataSourcePolicy.HYBRID,
            recurrence_interval=1,
            recurrence_unit=RecurrenceUnit.MONTH,
            first_due_date=_date_in_period(two_months_ago, due_day),
        )

    for period, rent_amount, electricity_amount in (
        (two_months_ago, "2450.00", "184.20"),
        (previous, "2450.00", "211.80"),
    ):
        rent_due = _date_in_period(period, 5)
        rent = _create_ready_obligation(
            session=session,
            ledger_id=ledger.id,
            category_code="RENT",
            period=period,
            amount=rent_amount,
            issue_date=_date_in_period(period, 1),
            due_date=rent_due,
        )
        mark_obligation_paid(
            session=session,
            ledger_id=ledger.id,
            key=_key("RENT", period),
        )
        rent.paid_at = datetime.combine(rent_due, datetime.min.time(), tzinfo=UTC)
        session.commit()

        electricity_due = _date_in_period(period, 12)
        electricity = _create_ready_obligation(
            session=session,
            ledger_id=ledger.id,
            category_code="ELEC",
            period=period,
            amount=electricity_amount,
            issue_date=_date_in_period(period, 2),
            due_date=electricity_due,
        )
        if period == two_months_ago:
            mark_obligation_paid(
                session=session,
                ledger_id=ledger.id,
                key=_key("ELEC", period),
            )
            electricity.paid_at = datetime.combine(
                electricity_due, datetime.min.time(), tzinfo=UTC
            )
            session.commit()

    current_minimum, current_maximum = due_date_range(current)
    upcoming_due = min(today + timedelta(days=5), current_maximum)
    upcoming_due = max(upcoming_due, today + timedelta(days=1), current_minimum)

    _create_ready_obligation(
        session=session,
        ledger_id=ledger.id,
        category_code="ELEC",
        period=current,
        amount="198.40",
        issue_date=max(current_minimum, today - timedelta(days=2)),
        due_date=upcoming_due,
        notes="Upcoming bill shown in the demo dashboard.",
    )

    create_manual_obligation(
        session=session,
        ledger_id=ledger.id,
        category_code="INET",
        period=current,
        current_amount=Decimal("79.99"),
        issue_date=max(current_minimum, today - timedelta(days=1)),
        notes="Amount received; due date is still being collected.",
    )

    streaming_due = max(current_minimum, min(today, current_maximum))
    streaming = _create_ready_obligation(
        session=session,
        ledger_id=ledger.id,
        category_code="STRM",
        period=current,
        amount="39.99",
        issue_date=streaming_due,
        due_date=streaming_due,
    )
    mark_obligation_paid(
        session=session,
        ledger_id=ledger.id,
        key=_key("STRM", current),
    )
    streaming.paid_at = datetime.combine(
        streaming_due, datetime.min.time(), tzinfo=UTC
    )
    session.commit()

    mobile = create_manual_obligation(
        session=session,
        ledger_id=ledger.id,
        category_code="MOBI",
        period=current,
        current_amount=Decimal("54.90"),
        issue_date=max(current_minimum, today - timedelta(days=1)),
        due_date=upcoming_due,
        notes="Example integration problem for the demo error state.",
    )
    mark_obligation_error(
        session=session,
        ledger_id=ledger.id,
        key=_key("MOBI", current),
    )
    assert mobile.lifecycle is ObligationLifecycle.ERROR

    _create_ready_obligation(
        session=session,
        ledger_id=ledger.id,
        category_code="RENT",
        period=next_period,
        amount="2450.00",
        issue_date=_date_in_period(next_period, 1),
        due_date=_date_in_period(next_period, 5),
        notes="Future obligation used by schedule and forecasting views.",
    )

    return DemoSeedResult(
        user_id=user.id,
        ledger_id=ledger.id,
        reference_date=today,
    )


def _parse_reference_date(value: str) -> date:
    try:
        return date.fromisoformat(value)
    except ValueError as exc:
        raise argparse.ArgumentTypeError("date must use YYYY-MM-DD format") from exc


def main() -> None:
    parser = argparse.ArgumentParser(description="Seed the Oblidog public demo dataset")
    parser.add_argument(
        "--date",
        type=_parse_reference_date,
        default=None,
        help="Reference date in YYYY-MM-DD format (defaults to today)",
    )
    args = parser.parse_args()
    password = os.environ.get(DEMO_PASSWORD_ENV)
    if not password:
        parser.error(f"{DEMO_PASSWORD_ENV} must be set")

    logging.basicConfig(level=logging.INFO)
    with Session(engine) as session:
        result = seed_demo(
            session=session,
            password=password,
            reference_date=args.date,
        )
    logger.info(
        "Demo seed created for %s (user=%s ledger=%s)",
        result.reference_date,
        result.user_id,
        result.ledger_id,
    )


if __name__ == "__main__":
    main()
