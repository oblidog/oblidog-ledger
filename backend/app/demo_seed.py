from __future__ import annotations

import argparse
import logging
import os
import uuid
from calendar import monthrange
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from decimal import Decimal
from typing import Any

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.core.business_date import business_today
from app.core.db import engine
from app.core.demo_identity import DEMO_EMAIL as DEMO_EMAIL
from app.domain import (
    BillingPeriod,
    Currency,
    DataSourcePolicy,
    ObligationActionActor,
    ObligationKey,
    RecurrenceUnit,
)
from app.domain.integrations import IntegrationResult
from app.models import (
    Category,
    CategoryDataRecord,
    Counterparty,
    Integration,
    IntegrationRun,
    Ledger,
    Obligation,
    User,
)
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

DEMO_LEDGER_NAME = "Oblidog Demo"
DEMO_PASSWORD_ENV = "DEMO_USER_PASSWORD"
DEMO_HISTORY_MONTHS = 4
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
    amounts: tuple[str, ...]
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
        ("2750.00", "2750.00", "2850.00", "2850.00", "2850.00"),
    ),
    CategorySpec(
        "Utilities",
        "Electricity",
        "ELEC",
        "Usage and distribution charges.",
        12,
        "energy",
        ("184.20", "201.65", "190.80", "196.40", "208.75"),
        "NorthGrid electricity",
    ),
    CategorySpec(
        "Utilities",
        "Gas",
        "GASS",
        "Heating and hot water gas.",
        15,
        "energy",
        ("98.40", "82.60", "79.30", "86.20", "92.10"),
        "NorthGrid gas",
    ),
    CategorySpec(
        "Utilities",
        "Water",
        "WATR",
        "Water and sewage settlement.",
        18,
        "city",
        ("118.20", "124.80", "119.50", "121.60", "126.30"),
        "City water meter",
    ),
    CategorySpec(
        "Utilities",
        "Waste collection",
        "WSTE",
        "Municipal waste fee.",
        20,
        "city",
        ("74.00", "74.00", "74.00", "74.00", "74.00"),
        "City waste billing",
    ),
    CategorySpec(
        "Connectivity",
        "Home internet",
        "INET",
        "Fibre plan and router.",
        18,
        "connect",
        ("89.99", "89.99", "89.99", "89.99", "89.99"),
        "Connecta fibre",
    ),
    CategorySpec(
        "Connectivity",
        "Mobile phones",
        "MOBI",
        "Family plan and device.",
        22,
        "connect",
        ("59.90", "59.90", "64.90", "64.90", "64.90"),
        "Connecta mobile",
    ),
    CategorySpec(
        "Insurance",
        "Car insurance",
        "CARI",
        "Car policy provision.",
        9,
        "insurance",
        ("118.00", "118.00", "118.00", "118.00", "118.00"),
        "SafeHarbor car policy",
    ),
    CategorySpec(
        "Insurance",
        "Home insurance",
        "HOME",
        "Home policy provision.",
        3,
        "insurance",
        ("42.00", "42.00", "42.00", "42.00", "42.00"),
        "SafeHarbor home policy",
    ),
    CategorySpec(
        "Subscriptions",
        "Video streaming",
        "STRM",
        "Family video plan.",
        14,
        "media",
        ("49.00", "49.00", "49.00", "49.00", "49.00"),
        "Northstar video",
    ),
    CategorySpec(
        "Subscriptions",
        "Music streaming",
        "MUSC",
        "Family music plan.",
        16,
        "media",
        ("32.99", "32.99", "32.99", "32.99", "32.99"),
        "Northstar music",
    ),
    CategorySpec(
        "Subscriptions",
        "Cloud storage",
        "CLDS",
        "Shared cloud storage.",
        24,
        "cloud",
        ("11.99", "11.99", "11.99", "11.99", "11.99"),
        "SkyVault storage",
    ),
    CategorySpec(
        "Family & lifestyle",
        "Gym membership",
        "GYMM",
        "Monthly gym membership.",
        10,
        "fitness",
        ("129.00", "129.00", "129.00", "129.00", "129.00"),
    ),
    CategorySpec(
        "Family & lifestyle",
        "School meals",
        "MEAL",
        "School canteen settlement.",
        20,
        "school",
        ("160.00", "184.00", "168.00", "176.00", "192.00"),
    ),
    CategorySpec(
        "Transport",
        "Public transport",
        "TRNS",
        "Monthly city pass.",
        8,
        "transit",
        ("119.00", "119.00", "119.00", "119.00", "119.00"),
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
    # 21:30 UTC precedes midnight in Warsaw in both winter and summer.
    # A 32-hour demo freshness window also covers the next reset at 03:00 UTC.
    finished_at = datetime.combine(
        reference_date - timedelta(days=1), time(21, 30), tzinfo=UTC
    )
    integrations: dict[str, Integration] = {}
    for spec in CATEGORY_SPECS:
        if spec.integration_name is None:
            continue
        run_id = uuid.uuid5(_DEMO_UUID_NAMESPACE, f"integration-run:{spec.code}")
        failed = spec.code == "MOBI"
        integration = Integration(
            ledger_id=ledger_id,
            category_id=categories[spec.code].id,
            name=f"Demo: {spec.integration_name}",
            enabled=True,
            created_at=_at_utc(
                _shift_period(
                    BillingPeriod.from_date(reference_date), -DEMO_HISTORY_MONTHS
                ),
                1,
            ),
            updated_at=finished_at,
            enabled_at=_at_utc(
                _shift_period(
                    BillingPeriod.from_date(reference_date), -DEMO_HISTORY_MONTHS
                ),
                1,
            ),
            stale_after_seconds=32 * 60 * 60,
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
            last_changes_detected=(
                None if failed else spec.code not in {"INET", "MUSC", "CLDS"}
            ),
            last_error_code="provider_unavailable" if failed else None,
            last_error_message=(
                "Synthetic demo: provider unavailable; previous billing data is retained."
                if failed
                else None
            ),
            last_success_at=None if failed else finished_at,
        )
        session.add(integration)
        session.commit()
        session.refresh(integration)
        session.add(
            IntegrationRun(
                id=run_id,
                integration_id=integration.id,
                started_at=integration.current_started_at,
                deadline_at=integration.current_deadline_at,
                finished_at=integration.current_finished_at,
                result=integration.last_result,
                changes_detected=integration.last_changes_detected,
                error_code=integration.last_error_code,
                error_message=integration.last_error_message,
            )
        )
        session.commit()
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
    reference_date: date,
) -> Obligation:
    issue_date = min(
        _date_in_period(period, max(1, spec.due_day - 7)),
        reference_date - timedelta(days=1),
    )
    due_date = _date_in_period(period, spec.due_day)
    if integration is None:
        return create_manual_obligation(
            session=session,
            ledger_id=ledger_id,
            category_code=spec.code,
            period=period,
            current_amount=Decimal(amount),
            data_ready=not (
                spec.code == "MEAL"
                and period == BillingPeriod.from_date(reference_date)
            ),
            issue_date=issue_date,
            due_date=due_date,
        )

    run_id = uuid.uuid5(
        _DEMO_UUID_NAMESPACE,
        f"obligation-run:{spec.code}:{period.year:04d}-{period.month:02d}",
    )
    synced_at = datetime.combine(issue_date, time(6), tzinfo=UTC)
    session.add(
        IntegrationRun(
            id=run_id,
            integration_id=integration.id,
            started_at=synced_at - timedelta(minutes=15),
            deadline_at=synced_at + timedelta(minutes=15),
            finished_at=synced_at,
            result=IntegrationResult.SUCCESS.value,
            changes_detected=True,
        )
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
    if integration.last_success_at is None:
        integration.last_success_at = synced_at
    elif integration.last_success_at < synced_at:
        integration.last_success_at = synced_at
    obligation.last_auto_sync_at = synced_at
    session.commit()
    session.refresh(obligation)
    return obligation


def _seed_obligations(
    *,
    session: Session,
    ledger_id: uuid.UUID,
    periods: tuple[BillingPeriod, ...],
    categories: dict[str, Category],
    integrations: dict[str, Integration],
    reference_date: date,
) -> None:
    current_period = periods[-1]
    overdue_budget = len(CATEGORY_SPECS) // 5
    due_days = {spec.code: spec.due_day for spec in CATEGORY_SPECS}
    pending_codes = {"MOBI", "MEAL"}
    pending_overdue = sum(
        _date_in_period(current_period, due_days[code]) < reference_date
        for code in pending_codes
    )
    overdue_showcase = ("HOME", "TRNS", "GYMM")
    current_overdue_codes = {
        code
        for code in overdue_showcase
        if _date_in_period(current_period, due_days[code]) < reference_date
    }
    allowed_showcase_count = max(0, overdue_budget - pending_overdue)
    current_overdue_codes = {
        code
        for code in overdue_showcase[:allowed_showcase_count]
        if code in current_overdue_codes
    }
    for spec in CATEGORY_SPECS:
        for period, amount in zip(periods, spec.amounts, strict=True):
            obligation = _create_seed_obligation(
                session=session,
                ledger_id=ledger_id,
                category=categories[spec.code],
                spec=spec,
                period=period,
                amount=amount,
                integration=integrations.get(spec.code),
                reference_date=reference_date,
            )
            if period == current_period and spec.code == "MEAL":
                obligation.notes = "Synthetic demo: awaiting the final meal count before confirming the bill."
                session.commit()
                continue
            if period == current_period and spec.code == "MOBI":
                obligation.notes = "Synthetic demo: provider unavailable; displayed amount is the last received bill."
                session.commit()
                integration = integrations[spec.code]
                mark_obligation_error(
                    session=session,
                    ledger_id=ledger_id,
                    key=_key(spec.code, period),
                    actor=ObligationActionActor.integration(
                        integration_id=integration.id,
                        display_name=integration.name,
                        run_id=integration.current_run_id,
                    ),
                )
                continue
            is_previous = period == periods[-2]
            if is_previous and spec.code == "WATR":
                obligation.notes = (
                    "Synthetic demo: payment is still awaiting manual confirmation."
                )
            should_be_paid = (
                period != current_period and not (is_previous and spec.code == "WATR")
            ) or (
                period == current_period
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
    periods: tuple[BillingPeriod, ...],
    reference_date: date,
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
        meter = Decimal("8000.0")
        for index, period in enumerate(periods):
            data = dict(records[index % len(records)])
            if code == "ELEC":
                meter += Decimal(str(data["consumption_kwh"]))
                data["meter_reading_kwh"] = float(meter)
            observed_date = min(
                _date_in_period(period, 6), reference_date - timedelta(days=1)
            )
            if code == "WATR":
                data["reading_date"] = observed_date.isoformat()
            category_use_cases.create_category_data_record(
                session=session,
                ledger_id=ledger_id,
                category_id=category.id,
                observed_at=datetime.combine(observed_date, time(6), tzinfo=UTC),
                data=data,
                source="demo-integration",
                external_id=f"{code}-{period.year:04d}-{period.month:02d}",
            )


def _seed_components(
    *,
    session: Session,
    ledger_id: uuid.UUID,
    periods: tuple[BillingPeriod, ...],
) -> None:
    specs = {spec.code: spec for spec in CATEGORY_SPECS}
    for period_index, period in enumerate(periods):
        total = Decimal(specs["ELEC"].amounts[period_index])
        distribution = Decimal("56.00") + Decimal(period_index) * Decimal("1.25")
        renewable = Decimal("6.00") + Decimal(period_index) * Decimal("0.05")
        electricity = (
            ("Energy", total - distribution - renewable),
            ("Distribution", distribution),
            ("Renewables fee", renewable),
        )
        mobile_total = Decimal(specs["MOBI"].amounts[period_index])
        components: list[tuple[str, str, str, Decimal, dict[str, object]]] = [
            ("ELEC", "invoice_line", label, amount, {}) for label, amount in electricity
        ] + [
            (
                "INET",
                "plan",
                "600 Mbps fibre",
                Decimal("79.99"),
                {"contract": "open-ended"},
            ),
            (
                "INET",
                "equipment",
                "Router rental",
                Decimal("10.00"),
                {"model": "Connecta Hub"},
            ),
            (
                "MOBI",
                "plan",
                "Family mobile plan",
                mobile_total - Decimal("20.00"),
                {"lines": 2},
            ),
            (
                "MOBI",
                "device",
                "Phone instalment",
                Decimal("20.00"),
                {"instalment": f"{4 + period_index} of 24"},
            ),
        ]
        for index, (code, type_, label, amount, metadata) in enumerate(components):
            upsert_obligation_component(
                session=session,
                ledger_id=ledger_id,
                key=_key(code, period),
                type=type_,
                label=label,
                amount=amount,
                metadata=metadata,
                source="demo-seed",
                external_id=f"{code}:{index}",
            )


def _seed_planned_obligations(
    *,
    session: Session,
    ledger_id: uuid.UUID,
    categories: dict[str, Category],
    current: BillingPeriod,
) -> None:
    following = _shift_period(current, 1)
    for spec in CATEGORY_SPECS:
        category = categories[spec.code]
        if spec.integration_name is None:
            obligation = create_manual_obligation(
                session=session,
                ledger_id=ledger_id,
                category_code=spec.code,
                period=following,
                current_amount=Decimal(spec.amounts[-1]),
                due_date=_date_in_period(following, spec.due_day),
            )
        else:
            obligation, _ = obligation_service.get_or_create_obligation(
                session=session,
                category=category,
                period=following,
            )
        obligation.notes = (
            "Synthetic demo: planned payment; amount estimated from recorded bills."
        )
    session.commit()
    obligation_service.estimate_missing_obligation_amounts(
        session=session,
        ledger_id=ledger_id,
        current_period=current,
    )
    session.commit()


def _date_seed_history(
    *, session: Session, ledger_id: uuid.UUID, reference_date: date
) -> None:
    """Keep historical bills and their audit trail on the same synthetic timeline."""
    for obligation in session.scalars(
        select(Obligation).where(Obligation.ledger_id == ledger_id)
    ):
        day = obligation.issue_date or reference_date - timedelta(days=1)
        created_at = datetime.combine(day, time(6), tzinfo=UTC)
        obligation.created_at = created_at
        timestamps = [created_at]
        for index, action in enumerate(
            sorted(
                obligation.action_logs, key=lambda item: (item.created_at, str(item.id))
            )
        ):
            action_date = created_at
            if action.action == "marked_error" and action.run_id is not None:
                run = session.get(IntegrationRun, action.run_id)
                assert run is not None and run.finished_at is not None
                action_date = run.finished_at
            if action.action == "marked_paid":
                assert obligation.paid_at is not None
                action_date = obligation.paid_at
                action.changes = {
                    **action.changes,
                    "paid_at": {"from": None, "to": obligation.paid_at.isoformat()},
                }
            action.created_at = action_date + timedelta(seconds=index)
            timestamps.append(action.created_at)
        for component in obligation.components:
            component.created_at = created_at
            component.updated_at = created_at
        obligation.updated_at = max(timestamps)
    for record in session.scalars(
        select(CategoryDataRecord).join(Category).where(Category.ledger_id == ledger_id)
    ):
        record.created_at = record.observed_at
        record.updated_at = record.observed_at
    session.commit()


def seed_demo(
    *,
    session: Session,
    password: str,
    reference_date: date | None = None,
) -> DemoSeedResult:
    today = reference_date or business_today()
    current = BillingPeriod.from_date(today)
    history_periods = tuple(
        _shift_period(current, offset) for offset in range(-DEMO_HISTORY_MONTHS, 1)
    )

    user = _ensure_demo_user(session=session, password=password)
    _remove_existing_demo_ledgers(session=session, user_id=user.id)
    counterparties = _ensure_counterparties(session=session)

    ledger = create_ledger(
        session=session,
        owner_user_id=user.id,
        name=DEMO_LEDGER_NAME,
        description="Synthetic household expenses and integration results. No external services are connected.",
    )
    categories = _create_categories(
        session=session,
        ledger_id=ledger.id,
        first_period=history_periods[0],
        counterparties=counterparties,
    )
    integrations = _create_integrations(
        session=session,
        ledger_id=ledger.id,
        categories=categories,
        reference_date=today,
    )
    _seed_obligations(
        session=session,
        ledger_id=ledger.id,
        periods=history_periods,
        categories=categories,
        integrations=integrations,
        reference_date=today,
    )
    _seed_category_data(
        session=session,
        ledger_id=ledger.id,
        categories=categories,
        periods=history_periods,
        reference_date=today,
    )
    _seed_components(
        session=session,
        ledger_id=ledger.id,
        periods=history_periods,
    )

    _seed_planned_obligations(
        session=session,
        ledger_id=ledger.id,
        categories=categories,
        current=current,
    )
    _date_seed_history(session=session, ledger_id=ledger.id, reference_date=today)

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
