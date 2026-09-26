from __future__ import annotations

import argparse
import logging
import os
import uuid
from calendar import monthrange
from dataclasses import dataclass
from datetime import UTC, date, datetime, time
from decimal import Decimal
from typing import Any

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.core.db import engine
from app.domain import (
    BillingPeriod,
    Currency,
    DataSourcePolicy,
    ObligationActionActor,
    ObligationKey,
    RecurrenceUnit,
)
from app.domain.integrations import IntegrationResult
from app.models import Category, Counterparty, Integration, Ledger, Obligation, User
from app.schemas import UserCreate
from app.services import counterparties as counterparty_service
from app.services import obligations as obligation_service
from app.services import users as user_service
from app.use_cases import categories as category_use_cases
from app.use_cases.categories import create_category, create_category_group
from app.use_cases.ledgers import create_ledger
from app.use_cases.obligations import (
    create_manual_obligation,
    mark_obligation_error,
    mark_obligation_paid,
    mark_obligation_ready,
    update_integration_obligation,
    upsert_obligation_component,
)

logger = logging.getLogger(__name__)

DEMO_EMAIL = "demo@oblidog.com"
DEMO_LEDGER_NAME = "Oblidog Demo"
DEMO_PASSWORD_ENV = "DEMO_USER_PASSWORD"
_DEMO_UUID_NAMESPACE = uuid.UUID("5d1a6522-b2a3-4db9-b6c2-69db1fe69317")


@dataclass(frozen=True, slots=True)
class DemoSeedResult:
    user_id: uuid.UUID
    ledger_id: uuid.UUID
    reference_date: date


@dataclass(frozen=True, slots=True)
class CounterpartySpec:
    key: str
    name: str
    short_name: str
    logo_url: str


@dataclass(frozen=True, slots=True)
class CategorySpec:
    group: str
    name: str
    code: str
    description: str
    due_day: int
    counterparty: str
    amounts: tuple[str, str, str]
    integration_name: str | None = None


COUNTERPARTY_SPECS = (
    CounterpartySpec(
        "housing",
        "Zielona 12 Housing Association",
        "Zielona 12",
        "/demo-logos/zielona-12.svg",
    ),
    CounterpartySpec(
        "energy", "NorthGrid Energy", "NorthGrid", "/demo-logos/northgrid.svg"
    ),
    CounterpartySpec(
        "city", "City Services", "City Services", "/demo-logos/city-services.svg"
    ),
    CounterpartySpec("connect", "Connecta", "Connecta", "/demo-logos/connecta.svg"),
    CounterpartySpec(
        "insurance",
        "SafeHarbor Insurance",
        "SafeHarbor",
        "/demo-logos/safeharbor.svg",
    ),
    CounterpartySpec(
        "media", "Northstar Media", "Northstar", "/demo-logos/northstar.svg"
    ),
    CounterpartySpec("cloud", "SkyVault", "SkyVault", "/demo-logos/skyvault.svg"),
    CounterpartySpec(
        "fitness", "ActiveLife Club", "ActiveLife", "/demo-logos/activelife.svg"
    ),
    CounterpartySpec(
        "school",
        "Riverside Primary School",
        "Riverside",
        "/demo-logos/riverside.svg",
    ),
    CounterpartySpec("transit", "Metro Transit", "Metro", "/demo-logos/metro.svg"),
)


CATEGORY_SPECS = (
    CategorySpec(
        "Housing",
        "Rent",
        "RENT",
        "Rent and service charge.",
        5,
        "housing",
        ("2850.00", "2850.00", "2850.00"),
    ),
    CategorySpec(
        "Utilities",
        "Electricity",
        "ELEC",
        "Usage and distribution charges.",
        12,
        "energy",
        ("196.40", "208.75", "214.30"),
        "NorthGrid electricity",
    ),
    CategorySpec(
        "Utilities",
        "Gas",
        "GASS",
        "Heating and hot water gas.",
        15,
        "energy",
        ("86.20", "92.10", "118.60"),
        "NorthGrid gas",
    ),
    CategorySpec(
        "Utilities",
        "Water",
        "WATR",
        "Water and sewage settlement.",
        18,
        "city",
        ("121.60", "126.30", "132.40"),
        "City water meter",
    ),
    CategorySpec(
        "Utilities",
        "Waste collection",
        "WSTE",
        "Municipal waste fee.",
        20,
        "city",
        ("74.00", "74.00", "78.00"),
        "City waste billing",
    ),
    CategorySpec(
        "Connectivity",
        "Home internet",
        "INET",
        "Fibre plan and router.",
        18,
        "connect",
        ("89.99", "89.99", "89.99"),
        "Connecta fibre",
    ),
    CategorySpec(
        "Connectivity",
        "Mobile phones",
        "MOBI",
        "Family plan and device.",
        22,
        "connect",
        ("64.90", "64.90", "64.90"),
        "Connecta mobile",
    ),
    CategorySpec(
        "Insurance",
        "Car insurance",
        "CARI",
        "Car policy provision.",
        9,
        "insurance",
        ("118.00", "118.00", "124.00"),
        "SafeHarbor car policy",
    ),
    CategorySpec(
        "Insurance",
        "Home insurance",
        "HOME",
        "Home policy provision.",
        3,
        "insurance",
        ("42.00", "42.00", "45.00"),
        "SafeHarbor home policy",
    ),
    CategorySpec(
        "Subscriptions",
        "Video streaming",
        "STRM",
        "Family video plan.",
        14,
        "media",
        ("49.00", "49.00", "54.00"),
        "Northstar video",
    ),
    CategorySpec(
        "Subscriptions",
        "Music streaming",
        "MUSC",
        "Family music plan.",
        16,
        "media",
        ("32.99", "32.99", "32.99"),
        "Northstar music",
    ),
    CategorySpec(
        "Subscriptions",
        "Cloud storage",
        "CLDS",
        "Shared cloud storage.",
        24,
        "cloud",
        ("11.99", "11.99", "11.99"),
        "SkyVault storage",
    ),
    CategorySpec(
        "Family & lifestyle",
        "Gym membership",
        "GYMM",
        "Monthly gym membership.",
        10,
        "fitness",
        ("129.00", "129.00", "139.00"),
    ),
    CategorySpec(
        "Family & lifestyle",
        "School meals",
        "MEAL",
        "School canteen settlement.",
        20,
        "school",
        ("176.00", "192.00", "184.00"),
    ),
    CategorySpec(
        "Transport",
        "Public transport",
        "TRNS",
        "Monthly city pass.",
        8,
        "transit",
        ("119.00", "119.00", "129.00"),
        "Metro pass",
    ),
)


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


def _remove_existing_demo_ledgers(*, session: Session, user_id: uuid.UUID) -> None:
    ledgers = list(
        session.scalars(select(Ledger).where(Ledger.owner_user_id == user_id))
    )
    for ledger in ledgers:
        session.execute(delete(Integration).where(Integration.ledger_id == ledger.id))
        session.delete(ledger)
    session.commit()


def _at_utc(period: BillingPeriod, day: int, hour: int = 6) -> datetime:
    return datetime.combine(_date_in_period(period, day), time(hour), tzinfo=UTC)


def _ensure_counterparties(*, session: Session) -> dict[str, Counterparty]:
    counterparties: dict[str, Counterparty] = {}
    for spec in COUNTERPARTY_SPECS:
        counterparty = session.scalar(
            select(Counterparty).where(
                func.lower(Counterparty.name) == spec.name.lower()
            )
        )
        if counterparty is None:
            counterparty = counterparty_service.create_counterparty(
                session=session,
                name=spec.name,
                short_name=spec.short_name,
                logo_url=spec.logo_url,
            )
        else:
            counterparty.short_name = spec.short_name
            counterparty.logo_url = spec.logo_url
            session.commit()
            session.refresh(counterparty)
        counterparties[spec.key] = counterparty
    return counterparties


def _create_categories(
    *,
    session: Session,
    ledger_id: uuid.UUID,
    first_period: BillingPeriod,
    counterparties: dict[str, Counterparty],
) -> dict[str, Category]:
    group_descriptions = {
        "Housing": "Rent and recurring home costs.",
        "Utilities": "Metered and municipal household services.",
        "Connectivity": "Internet and mobile communication.",
        "Insurance": "Recurring insurance provisions.",
        "Subscriptions": "Digital subscriptions and online services.",
        "Family & lifestyle": "Education, health and family expenses.",
        "Transport": "Recurring mobility costs.",
    }
    groups = {
        name: create_category_group(
            session=session,
            ledger_id=ledger_id,
            name=name,
            description=description,
        )
        for name, description in group_descriptions.items()
    }
    categories: dict[str, Category] = {}
    for spec in CATEGORY_SPECS:
        automatic = spec.integration_name is not None
        category = create_category(
            session=session,
            ledger_id=ledger_id,
            category_group_id=groups[spec.group].id,
            name=spec.name,
            description=spec.description,
            code=spec.code,
            currency=Currency.EUR,
            data_source_policy=(
                DataSourcePolicy.AUTOMATIC if automatic else DataSourcePolicy.MANUAL
            ),
            recurrence_interval=1 if automatic else None,
            recurrence_unit=RecurrenceUnit.MONTH if automatic else None,
            first_due_date=(
                _date_in_period(first_period, spec.due_day) if automatic else None
            ),
        )
        category.counterparty_id = counterparties[spec.counterparty].id
        session.commit()
        session.refresh(category)
        categories[spec.code] = category
    return categories


def _create_integrations(
    *,
    session: Session,
    ledger_id: uuid.UUID,
    categories: dict[str, Category],
    reference_date: date,
) -> dict[str, Integration]:
    finished_at = datetime.combine(reference_date, time(6, 30), tzinfo=UTC)
    integrations: dict[str, Integration] = {}
    for spec in CATEGORY_SPECS:
        if spec.integration_name is None:
            continue
        run_id = uuid.uuid5(_DEMO_UUID_NAMESPACE, f"integration-run:{spec.code}")
        failed = spec.code == "MOBI"
        integration = Integration(
            ledger_id=ledger_id,
            category_id=categories[spec.code].id,
            name=spec.integration_name,
            enabled=True,
            created_at=finished_at,
            updated_at=finished_at,
            enabled_at=finished_at,
            stale_after_seconds=93600,
            run_timeout_seconds=1800,
            revision=2,
            current_run_id=run_id,
            current_started_at=finished_at.replace(minute=15),
            current_deadline_at=finished_at.replace(minute=45),
            current_finished_at=finished_at,
            last_finished_at=finished_at,
            last_result=(
                IntegrationResult.FAILURE.value
                if failed
                else IntegrationResult.SUCCESS.value
            ),
            last_changes_detected=None if failed else True,
            last_error_code="provider_unavailable" if failed else None,
            last_error_message=(
                "The provider did not respond during the last sync." if failed else None
            ),
            last_success_at=None if failed else finished_at,
        )
        session.add(integration)
        session.commit()
        session.refresh(integration)
        integrations[spec.code] = integration
    return integrations


def _create_seed_obligation(
    *,
    session: Session,
    ledger_id: uuid.UUID,
    category: Category,
    spec: CategorySpec,
    period: BillingPeriod,
    amount: str,
    integration: Integration | None,
) -> Obligation:
    issue_date = _date_in_period(period, max(1, spec.due_day - 7))
    due_date = _date_in_period(period, spec.due_day)
    if integration is None:
        return _create_ready_obligation(
            session=session,
            ledger_id=ledger_id,
            category_code=spec.code,
            period=period,
            amount=amount,
            issue_date=issue_date,
            due_date=due_date,
        )

    run_id = uuid.uuid5(
        _DEMO_UUID_NAMESPACE,
        f"obligation-run:{spec.code}:{period.year:04d}-{period.month:02d}",
    )
    actor = ObligationActionActor.integration(
        integration_id=integration.id,
        display_name=integration.name,
        run_id=run_id,
    )
    obligation, created = obligation_service.get_or_create_obligation(
        session=session,
        category=category,
        period=period,
    )
    assert created
    session.commit()
    obligation = update_integration_obligation(
        session=session,
        ledger_id=ledger_id,
        key=_key(spec.code, period),
        current_amount=Decimal(amount),
        issue_date=issue_date,
        due_date=due_date,
        actor=actor,
    )
    obligation = mark_obligation_ready(
        session=session,
        ledger_id=ledger_id,
        key=_key(spec.code, period),
        actor=actor,
    )
    obligation.last_auto_sync_at = _at_utc(period, max(1, spec.due_day - 6))
    session.commit()
    session.refresh(obligation)
    return obligation


def _seed_obligations(
    *,
    session: Session,
    ledger_id: uuid.UUID,
    periods: tuple[BillingPeriod, BillingPeriod, BillingPeriod],
    categories: dict[str, Category],
    integrations: dict[str, Integration],
    reference_date: date,
) -> None:
    previously_paid = {spec.code for spec in CATEGORY_SPECS} - {"WATR", "INET"}
    current_period = periods[1]
    overdue_budget = len(CATEGORY_SPECS) // 5
    due_days = {spec.code: spec.due_day for spec in CATEGORY_SPECS}
    error_is_overdue = (
        _date_in_period(current_period, due_days["MOBI"]) < reference_date
    )
    overdue_showcase = ("HOME", "TRNS", "GYMM")
    current_overdue_codes = {
        code
        for code in overdue_showcase
        if _date_in_period(current_period, due_days[code]) < reference_date
    }
    allowed_showcase_count = max(0, overdue_budget - int(error_is_overdue))
    current_overdue_codes = {
        code
        for code in overdue_showcase[:allowed_showcase_count]
        if code in current_overdue_codes
    }
    for spec in CATEGORY_SPECS:
        for period_index, (period, amount) in enumerate(
            zip(periods, spec.amounts, strict=True)
        ):
            obligation = _create_seed_obligation(
                session=session,
                ledger_id=ledger_id,
                category=categories[spec.code],
                spec=spec,
                period=period,
                amount=amount,
                integration=integrations.get(spec.code),
            )
            if period_index == 1 and spec.code == "MOBI":
                mark_obligation_error(
                    session=session,
                    ledger_id=ledger_id,
                    key=_key(spec.code, period),
                )
                continue
            should_be_paid = (period_index == 0 and spec.code in previously_paid) or (
                period_index == 1
                and obligation.due_date is not None
                and obligation.due_date < reference_date
                and spec.code not in current_overdue_codes
            )
            if not should_be_paid:
                continue
            paid = mark_obligation_paid(
                session=session,
                ledger_id=ledger_id,
                key=_key(spec.code, period),
            )
            assert paid.due_date is not None
            paid.paid_at = datetime.combine(paid.due_date, time(9), tzinfo=UTC)
            session.commit()


def _seed_category_data(
    *,
    session: Session,
    ledger_id: uuid.UUID,
    categories: dict[str, Category],
    periods: tuple[BillingPeriod, BillingPeriod, BillingPeriod],
) -> None:
    datasets: dict[str, tuple[dict[str, Any], tuple[dict[str, Any], ...]]] = {
        "ELEC": (
            {
                "type": "object",
                "properties": {
                    "meter_reading_kwh": {"type": "number"},
                    "consumption_kwh": {"type": "number"},
                    "estimated": {"type": "boolean"},
                },
                "required": ["meter_reading_kwh", "consumption_kwh", "estimated"],
                "additionalProperties": False,
            },
            (
                {
                    "meter_reading_kwh": 8421.2,
                    "consumption_kwh": 176.4,
                    "estimated": False,
                },
                {
                    "meter_reading_kwh": 8610.5,
                    "consumption_kwh": 189.3,
                    "estimated": False,
                },
                {
                    "meter_reading_kwh": 8805.1,
                    "consumption_kwh": 194.6,
                    "estimated": False,
                },
            ),
        ),
        "WATR": (
            {
                "type": "object",
                "properties": {
                    "cold_water_m3": {"type": "number"},
                    "hot_water_m3": {"type": "number"},
                    "reading_date": {"type": "string", "format": "date"},
                },
                "required": ["cold_water_m3", "hot_water_m3", "reading_date"],
                "additionalProperties": False,
            },
            (
                {"cold_water_m3": 4.7, "hot_water_m3": 2.8},
                {"cold_water_m3": 4.9, "hot_water_m3": 2.9},
                {"cold_water_m3": 5.1, "hot_water_m3": 3.0},
            ),
        ),
        "MOBI": (
            {
                "type": "object",
                "properties": {
                    "plan": {"type": "string"},
                    "used_gb": {"type": "number"},
                    "roaming_used": {"type": "boolean"},
                },
                "required": ["plan", "used_gb", "roaming_used"],
                "additionalProperties": False,
            },
            (
                {"plan": "Family 60 GB", "used_gb": 38.4, "roaming_used": False},
                {"plan": "Family 60 GB", "used_gb": 44.8, "roaming_used": True},
                {"plan": "Family 60 GB", "used_gb": 41.2, "roaming_used": False},
            ),
        ),
        "INET": (
            {
                "type": "object",
                "properties": {
                    "download_mbps": {"type": "integer"},
                    "uptime_percent": {"type": "number"},
                },
                "required": ["download_mbps", "uptime_percent"],
                "additionalProperties": False,
            },
            (
                {"download_mbps": 600, "uptime_percent": 99.92},
                {"download_mbps": 600, "uptime_percent": 99.98},
                {"download_mbps": 600, "uptime_percent": 99.96},
            ),
        ),
        "TRNS": (
            {
                "type": "object",
                "properties": {
                    "rides": {"type": "integer"},
                    "zones": {"type": "array", "items": {"type": "string"}},
                    "pass_active": {"type": "boolean"},
                },
                "required": ["rides", "zones", "pass_active"],
                "additionalProperties": False,
            },
            (
                {"rides": 31, "zones": ["A"], "pass_active": True},
                {"rides": 36, "zones": ["A"], "pass_active": True},
                {"rides": 28, "zones": ["A", "B"], "pass_active": True},
            ),
        ),
    }
    for code, (schema, records) in datasets.items():
        category = categories[code]
        category_use_cases.set_category_data_schema(
            session=session,
            ledger_id=ledger_id,
            category_id=category.id,
            schema=schema,
        )
        for period, record in zip(periods, records, strict=True):
            data = dict(record)
            if code == "WATR":
                data["reading_date"] = _date_in_period(period, 6).isoformat()
            category_use_cases.create_category_data_record(
                session=session,
                ledger_id=ledger_id,
                category_id=category.id,
                observed_at=_at_utc(period, 6),
                data=data,
                source="demo-integration",
                external_id=f"{code}-{period.year:04d}-{period.month:02d}",
            )


def _seed_components(
    *,
    session: Session,
    ledger_id: uuid.UUID,
    periods: tuple[BillingPeriod, BillingPeriod, BillingPeriod],
) -> None:
    electricity = (
        (
            ("Energy", "132.10"),
            ("Distribution", "58.20"),
            ("Renewables fee", "6.10"),
        ),
        (
            ("Energy", "141.05"),
            ("Distribution", "61.50"),
            ("Renewables fee", "6.20"),
        ),
        (
            ("Energy", "144.80"),
            ("Distribution", "63.20"),
            ("Renewables fee", "6.30"),
        ),
    )
    for period, components in zip(periods, electricity, strict=True):
        for index, (label, amount) in enumerate(components):
            upsert_obligation_component(
                session=session,
                ledger_id=ledger_id,
                key=_key("ELEC", period),
                type="invoice_line",
                label=label,
                amount=Decimal(amount),
                source="northgrid",
                external_id=f"{period.year:04d}-{period.month:02d}:{index}",
            )

    current = periods[1]
    component_specs: tuple[tuple[str, str, str, str | None, dict[str, object]], ...] = (
        ("RENT", "lease", "Apartment 3B", None, {"floor": 3, "area_m2": 68.4}),
        (
            "INET",
            "plan",
            "600 Mbps fibre",
            "79.99",
            {"contract": "open-ended"},
        ),
        (
            "INET",
            "equipment",
            "Router rental",
            "10.00",
            {"model": "Connecta Hub"},
        ),
        ("MOBI", "plan", "Family mobile plan", "44.90", {"lines": 2}),
        (
            "MOBI",
            "device",
            "Phone instalment",
            "20.00",
            {"instalment": "8 of 24"},
        ),
        ("MEAL", "usage", "16 school meals", "192.00", {"meals": 16}),
    )
    for index, (code, type_, label, component_amount, metadata) in enumerate(
        component_specs
    ):
        upsert_obligation_component(
            session=session,
            ledger_id=ledger_id,
            key=_key(code, current),
            type=type_,
            label=label,
            amount=(
                Decimal(component_amount) if component_amount is not None else None
            ),
            metadata=metadata,
            source="demo-seed",
            external_id=f"{code}:{index}",
        )


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
    _remove_existing_demo_ledgers(session=session, user_id=user.id)
    counterparties = _ensure_counterparties(session=session)

    ledger = create_ledger(
        session=session,
        owner_user_id=user.id,
        name=DEMO_LEDGER_NAME,
        description="Public demo ledger with resettable sample household expenses.",
    )
    categories = _create_categories(
        session=session,
        ledger_id=ledger.id,
        first_period=previous,
        counterparties=counterparties,
    )
    integrations = _create_integrations(
        session=session,
        ledger_id=ledger.id,
        categories=categories,
        reference_date=today,
    )
    obligation_periods = (previous, current, next_period)
    _seed_obligations(
        session=session,
        ledger_id=ledger.id,
        periods=obligation_periods,
        categories=categories,
        integrations=integrations,
        reference_date=today,
    )
    _seed_category_data(
        session=session,
        ledger_id=ledger.id,
        categories=categories,
        periods=(two_months_ago, previous, current),
    )
    _seed_components(
        session=session,
        ledger_id=ledger.id,
        periods=obligation_periods,
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
