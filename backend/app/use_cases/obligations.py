from __future__ import annotations

import uuid
from datetime import UTC, date, datetime
from decimal import Decimal

from sqlalchemy import select, text
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.domain import (
    BillingPeriod,
    CurrentValueSource,
    DataSourcePolicy,
    EffectiveValueSourceMode,
    ObligationKey,
    ObligationLifecycle,
    ValueState,
    due_date_range,
)
from app.models import Category, Ledger, Obligation, ObligationComponent
from app.services import obligations as obligation_service
from app.use_cases.exceptions import (
    CategoryNotFoundError,
    DuplicateObligationComponentError,
    DuplicateObligationError,
    LedgerNotFoundError,
    ManualObligationNotAllowedError,
    ObligationComponentNotFoundError,
    ObligationInvalidLifecycleError,
    ObligationNotFoundError,
    ObligationReadOnlyError,
)


class _Unset:
    pass


UNSET = _Unset()


def _require_ledger(*, session: Session, ledger_id: uuid.UUID) -> Ledger:
    ledger = session.get(Ledger, ledger_id)
    if ledger is None:
        raise LedgerNotFoundError
    return ledger


def ensure_obligations_for_period(
    *,
    session: Session,
    ledger_id: uuid.UUID,
    period: BillingPeriod,
) -> list[Obligation]:
    _require_ledger(session=session, ledger_id=ledger_id)

    created = obligation_service.ensure_obligations_for_period(
        session=session,
        ledger_id=ledger_id,
        current_period=period,
    )
    session.commit()
    for obligation in created:
        session.refresh(obligation)
    return created


def estimate_missing_obligation_amounts(
    *, session: Session, ledger_id: uuid.UUID, period: BillingPeriod
) -> list[Obligation]:
    _require_ledger(session=session, ledger_id=ledger_id)
    updated = obligation_service.estimate_missing_obligation_amounts(
        session=session, ledger_id=ledger_id, current_period=period
    )
    for obligation in updated:
        _update_effective_value_source(obligation)
    session.commit()
    for obligation in updated:
        session.refresh(obligation)
    return updated


def list_obligations_for_period(
    *,
    session: Session,
    ledger_id: uuid.UUID,
    period: BillingPeriod,
    lifecycle: ObligationLifecycle | None = None,
    category_id: uuid.UUID | None = None,
) -> list[Obligation]:
    _require_ledger(session=session, ledger_id=ledger_id)

    statement = (
        select(Obligation)
        .join(Obligation.category)
        .where(
            Obligation.ledger_id == ledger_id,
            Obligation.period_year == period.year,
            Obligation.period_month == period.month,
        )
    )
    if lifecycle is not None:
        statement = statement.where(Obligation.lifecycle == lifecycle)
    if category_id is not None:
        statement = statement.where(Obligation.category_id == category_id)

    return list(
        session.scalars(
            statement.order_by(
                Category.name.asc(),
                Obligation.category_id.asc(),
                Obligation.id.asc(),
            )
        ).all()
    )


def list_obligations_for_ledger(
    *,
    session: Session,
    ledger_id: uuid.UUID,
    year: int | None = None,
    month: int | None = None,
    category_code: str | None = None,
    lifecycle: ObligationLifecycle | None = None,
) -> list[Obligation]:
    _require_ledger(session=session, ledger_id=ledger_id)

    statement = (
        select(Obligation)
        .join(Obligation.category)
        .where(Obligation.ledger_id == ledger_id)
    )
    if year is not None:
        statement = statement.where(Obligation.period_year == year)
    if month is not None:
        statement = statement.where(Obligation.period_month == month)
    if category_code is not None:
        statement = statement.where(Category.code == category_code)
    if lifecycle is not None:
        statement = statement.where(Obligation.lifecycle == lifecycle)

    return list(
        session.scalars(
            statement.order_by(
                Obligation.period_year.desc(),
                Obligation.period_month.desc(),
                Category.name.asc(),
                Obligation.id.asc(),
            )
        ).all()
    )


def create_manual_obligation(
    *,
    session: Session,
    ledger_id: uuid.UUID,
    category_code: str,
    period: BillingPeriod,
    data_ready: bool = False,
    current_amount: Decimal | None = None,
    issue_date: date | None = None,
    due_date: date | None = None,
    notes: str | None = None,
) -> Obligation:
    if current_amount is not None and current_amount < 0:
        raise ValueError("current_amount must be greater than or equal to zero")
    if data_ready and (current_amount is None or due_date is None):
        raise ValueError(
            "current_amount and due_date are required when data_ready is true"
        )
    if due_date is not None:
        minimum, maximum = due_date_range(period)
        if not minimum <= due_date <= maximum:
            raise ValueError(
                "due_date must be within the billing period or the first "
                "seven business days after it"
            )
    if issue_date is not None and due_date is not None and issue_date > due_date:
        raise ValueError("issue_date cannot be later than due_date")

    _require_ledger(session=session, ledger_id=ledger_id)
    category = session.scalar(
        select(Category).where(
            Category.ledger_id == ledger_id,
            Category.code == category_code,
        )
    )
    if category is None:
        raise CategoryNotFoundError
    if category.data_source_policy is DataSourcePolicy.AUTOMATIC:
        raise ManualObligationNotAllowedError

    obligation, created = obligation_service.get_or_create_obligation(
        session=session,
        category=category,
        period=period,
    )
    if not created:
        raise DuplicateObligationError

    obligation.lifecycle = (
        ObligationLifecycle.READY if data_ready else ObligationLifecycle.COLLECTING_DATA
    )
    obligation.current_amount = current_amount
    obligation.issue_date = issue_date
    if due_date is not None:
        obligation.due_date = due_date
    obligation.notes = notes
    value_state = ValueState.CONFIRMED if data_ready else ValueState.ESTIMATED
    if current_amount is not None:
        obligation.amount_state = value_state
        obligation.amount_source = CurrentValueSource.MANUAL
    if issue_date is not None:
        obligation.issue_date_state = value_state
        obligation.issue_date_source = CurrentValueSource.MANUAL
    if due_date is not None:
        obligation.due_date_state = value_state
        obligation.due_date_source = CurrentValueSource.MANUAL

    _update_effective_value_source(obligation)

    session.commit()
    session.refresh(obligation)
    return obligation


def _set_value(
    *,
    obligation: Obligation,
    value_attribute: str,
    state_attribute: str,
    source_attribute: str,
    value: Decimal | date | None,
    source: CurrentValueSource,
) -> None:
    setattr(obligation, value_attribute, value)
    if value is None:
        setattr(obligation, state_attribute, ValueState.UNKNOWN)
        setattr(obligation, source_attribute, CurrentValueSource.UNKNOWN)
        return

    previous_state = getattr(obligation, state_attribute)
    setattr(obligation, source_attribute, source)
    if previous_state is ValueState.CONFIRMED:
        setattr(obligation, state_attribute, ValueState.OVERRIDDEN)
    elif previous_state is ValueState.UNKNOWN:
        setattr(obligation, state_attribute, ValueState.ESTIMATED)


def _update_effective_value_source(obligation: Obligation) -> None:
    sources = {
        source
        for value, source in (
            (obligation.current_amount, obligation.amount_source),
            (obligation.issue_date, obligation.issue_date_source),
            (obligation.due_date, obligation.due_date_source),
        )
        if value is not None and source is not CurrentValueSource.UNKNOWN
    }
    if not sources:
        obligation.effective_value_source = EffectiveValueSourceMode.UNKNOWN
    elif sources == {CurrentValueSource.MANUAL}:
        obligation.effective_value_source = EffectiveValueSourceMode.MANUAL
    elif sources == {CurrentValueSource.INTEGRATION}:
        obligation.effective_value_source = EffectiveValueSourceMode.INTEGRATION
    elif sources == {CurrentValueSource.AUTOMATIC}:
        obligation.effective_value_source = EffectiveValueSourceMode.AUTOMATIC
    elif sources == {CurrentValueSource.LEGACY}:
        obligation.effective_value_source = EffectiveValueSourceMode.LEGACY
    else:
        obligation.effective_value_source = EffectiveValueSourceMode.MIXED


def update_manual_obligation(
    *,
    session: Session,
    ledger_id: uuid.UUID,
    key: ObligationKey,
    current_amount: Decimal | None | _Unset = UNSET,
    issue_date: date | None | _Unset = UNSET,
    due_date: date | None | _Unset = UNSET,
    notes: str | None | _Unset = UNSET,
) -> Obligation:
    return _update_obligation_values(
        session=session,
        ledger_id=ledger_id,
        key=key,
        current_amount=current_amount,
        issue_date=issue_date,
        due_date=due_date,
        notes=notes,
        source=CurrentValueSource.MANUAL,
    )


def update_integration_obligation(
    *,
    session: Session,
    ledger_id: uuid.UUID,
    key: ObligationKey,
    current_amount: Decimal | None | _Unset = UNSET,
    issue_date: date | None | _Unset = UNSET,
    due_date: date | None | _Unset = UNSET,
) -> Obligation:
    return _update_obligation_values(
        session=session,
        ledger_id=ledger_id,
        key=key,
        current_amount=current_amount,
        issue_date=issue_date,
        due_date=due_date,
        source=CurrentValueSource.INTEGRATION,
    )


def _update_obligation_values(
    *,
    session: Session,
    ledger_id: uuid.UUID,
    key: ObligationKey,
    current_amount: Decimal | None | _Unset = UNSET,
    issue_date: date | None | _Unset = UNSET,
    due_date: date | None | _Unset = UNSET,
    notes: str | None | _Unset = UNSET,
    source: CurrentValueSource,
) -> Obligation:
    obligation = get_obligation_by_key(session=session, ledger_id=ledger_id, key=key)
    if obligation.lifecycle not in {
        ObligationLifecycle.DRAFT,
        ObligationLifecycle.COLLECTING_DATA,
    }:
        raise ObligationReadOnlyError

    next_current_amount = (
        obligation.current_amount
        if isinstance(current_amount, _Unset)
        else current_amount
    )
    next_issue_date = (
        obligation.issue_date if isinstance(issue_date, _Unset) else issue_date
    )
    next_due_date = obligation.due_date if isinstance(due_date, _Unset) else due_date
    if next_current_amount is not None and next_current_amount < 0:
        raise ValueError("current_amount must be greater than or equal to zero")
    if next_due_date is not None:
        minimum, maximum = due_date_range(
            BillingPeriod(obligation.period_year, obligation.period_month)
        )
        if not minimum <= next_due_date <= maximum:
            raise ValueError(
                "due_date must be within the billing period or the first "
                "seven business days after it"
            )
    if next_issue_date is not None and next_due_date is not None:
        if next_issue_date > next_due_date:
            raise ValueError("issue_date cannot be later than due_date")

    has_value_changes = (
        (
            not isinstance(current_amount, _Unset)
            and current_amount != obligation.current_amount
        )
        or (not isinstance(issue_date, _Unset) and issue_date != obligation.issue_date)
        or (not isinstance(due_date, _Unset) and due_date != obligation.due_date)
        or (not isinstance(notes, _Unset) and notes != obligation.notes)
    )
    if not isinstance(current_amount, _Unset):
        _set_value(
            obligation=obligation,
            value_attribute="current_amount",
            state_attribute="amount_state",
            source_attribute="amount_source",
            value=current_amount,
            source=source,
        )
    if not isinstance(issue_date, _Unset):
        _set_value(
            obligation=obligation,
            value_attribute="issue_date",
            state_attribute="issue_date_state",
            source_attribute="issue_date_source",
            value=issue_date,
            source=source,
        )
    if not isinstance(due_date, _Unset):
        _set_value(
            obligation=obligation,
            value_attribute="due_date",
            state_attribute="due_date_state",
            source_attribute="due_date_source",
            value=due_date,
            source=source,
        )
    if not isinstance(notes, _Unset):
        obligation.notes = notes

    if has_value_changes and obligation.lifecycle is ObligationLifecycle.DRAFT:
        obligation.lifecycle = ObligationLifecycle.COLLECTING_DATA
    _update_effective_value_source(obligation)
    session.commit()
    session.refresh(obligation)
    return obligation


def mark_obligation_ready(
    *, session: Session, ledger_id: uuid.UUID, key: ObligationKey
) -> Obligation:
    obligation = get_obligation_by_key(session=session, ledger_id=ledger_id, key=key)
    if obligation.lifecycle is not ObligationLifecycle.COLLECTING_DATA:
        raise ValueError("Only obligations collecting data can be marked as ready")
    if obligation.current_amount is None or obligation.due_date is None:
        raise ValueError("current_amount and due_date are required to mark ready")
    if (
        obligation.amount_state is ValueState.UNKNOWN
        or obligation.due_date_state is ValueState.UNKNOWN
    ):
        raise ValueError(
            "current_amount and due_date must have at least an estimated state"
        )

    obligation.lifecycle = ObligationLifecycle.READY
    obligation.amount_state = ValueState.CONFIRMED
    obligation.due_date_state = ValueState.CONFIRMED
    if obligation.issue_date is not None:
        obligation.issue_date_state = ValueState.CONFIRMED
    session.commit()
    session.refresh(obligation)
    return obligation


def mark_obligation_paid(
    *, session: Session, ledger_id: uuid.UUID, key: ObligationKey
) -> Obligation:
    obligation = get_obligation_by_key(session=session, ledger_id=ledger_id, key=key)
    if obligation.lifecycle is ObligationLifecycle.PAID:
        return obligation
    if obligation.lifecycle is not ObligationLifecycle.READY:
        raise ObligationInvalidLifecycleError

    obligation.lifecycle = ObligationLifecycle.PAID
    obligation.paid_at = datetime.now(UTC)
    session.commit()
    session.refresh(obligation)
    return obligation


def cancel_obligation(
    *, session: Session, ledger_id: uuid.UUID, key: ObligationKey
) -> Obligation:
    obligation = get_obligation_by_key(session=session, ledger_id=ledger_id, key=key)
    if obligation.lifecycle is not ObligationLifecycle.COLLECTING_DATA:
        raise ObligationInvalidLifecycleError

    obligation.lifecycle = ObligationLifecycle.CANCELED
    session.commit()
    session.refresh(obligation)
    return obligation


def reopen_obligation(
    *, session: Session, ledger_id: uuid.UUID, key: ObligationKey
) -> Obligation:
    obligation = get_obligation_by_key(session=session, ledger_id=ledger_id, key=key)
    if obligation.lifecycle not in {
        ObligationLifecycle.READY,
        ObligationLifecycle.PAID,
        ObligationLifecycle.CANCELED,
        ObligationLifecycle.ERROR,
    }:
        raise ObligationInvalidLifecycleError

    obligation.lifecycle = ObligationLifecycle.COLLECTING_DATA
    obligation.paid_at = None
    session.commit()
    session.refresh(obligation)
    return obligation


def mark_obligation_error(
    *, session: Session, ledger_id: uuid.UUID, key: ObligationKey
) -> Obligation:
    obligation = get_obligation_by_key(session=session, ledger_id=ledger_id, key=key)
    obligation.lifecycle = ObligationLifecycle.ERROR
    session.commit()
    session.refresh(obligation)
    return obligation


def append_integration_note(
    *,
    session: Session,
    ledger_id: uuid.UUID,
    key: ObligationKey,
    integration_name: str,
    text: str,
    now: datetime | None = None,
) -> Obligation:
    obligation = get_obligation_by_key(session=session, ledger_id=ledger_id, key=key)
    timestamp = (now or datetime.now(UTC)).astimezone(UTC).strftime("%Y-%m-%d %H:%M")
    entry = f"[{timestamp}] {integration_name}: {text}"
    obligation.notes = entry if not obligation.notes else f"{obligation.notes}\n{entry}"
    session.commit()
    session.refresh(obligation)
    return obligation


def get_obligation_by_key(
    *, session: Session, ledger_id: uuid.UUID, key: ObligationKey
) -> Obligation:
    _require_ledger(session=session, ledger_id=ledger_id)
    obligation = session.scalar(
        select(Obligation)
        .join(Obligation.category)
        .where(
            Obligation.ledger_id == ledger_id,
            Category.code == key.category_code,
            Obligation.period_year == key.period.year,
            Obligation.period_month == key.period.month,
        )
    )
    if obligation is None:
        raise ObligationNotFoundError
    return obligation


def list_obligation_components(
    *, session: Session, ledger_id: uuid.UUID, key: ObligationKey
) -> list[ObligationComponent]:
    obligation = get_obligation_by_key(session=session, ledger_id=ledger_id, key=key)
    return list(
        session.scalars(
            select(ObligationComponent)
            .where(ObligationComponent.obligation_id == obligation.id)
            .order_by(
                ObligationComponent.created_at.asc(), ObligationComponent.id.asc()
            )
        ).all()
    )


def add_obligation_component(
    *,
    session: Session,
    ledger_id: uuid.UUID,
    key: ObligationKey,
    type: str,
    label: str,
    amount: Decimal | None = None,
    source: str | None = None,
    external_id: str | None = None,
    metadata: dict[str, object] | None = None,
) -> ObligationComponent:
    obligation = get_obligation_by_key(session=session, ledger_id=ledger_id, key=key)
    component = ObligationComponent(
        obligation_id=obligation.id,
        type=type,
        label=label,
        amount=amount,
        source=source,
        external_id=external_id,
        component_metadata=metadata,
    )
    session.add(component)
    try:
        session.commit()
    except IntegrityError as exc:
        session.rollback()
        raise DuplicateObligationComponentError from exc
    session.refresh(component)
    return component


def _get_obligation_component(
    *, session: Session, obligation_id: uuid.UUID, component_id: uuid.UUID
) -> ObligationComponent:
    component = session.scalar(
        select(ObligationComponent).where(
            ObligationComponent.id == component_id,
            ObligationComponent.obligation_id == obligation_id,
        )
    )
    if component is None:
        raise ObligationComponentNotFoundError
    return component


def update_obligation_component(
    *,
    session: Session,
    ledger_id: uuid.UUID,
    key: ObligationKey,
    component_id: uuid.UUID,
    type: str | _Unset = UNSET,
    label: str | _Unset = UNSET,
    amount: Decimal | None | _Unset = UNSET,
    source: str | None | _Unset = UNSET,
    external_id: str | None | _Unset = UNSET,
    metadata: dict[str, object] | None | _Unset = UNSET,
) -> ObligationComponent:
    obligation = get_obligation_by_key(session=session, ledger_id=ledger_id, key=key)
    component = _get_obligation_component(
        session=session, obligation_id=obligation.id, component_id=component_id
    )
    if not isinstance(type, _Unset):
        component.type = type
    if not isinstance(label, _Unset):
        component.label = label
    if not isinstance(amount, _Unset):
        component.amount = amount
    if not isinstance(source, _Unset):
        component.source = source
    if not isinstance(external_id, _Unset):
        component.external_id = external_id
    if not isinstance(metadata, _Unset):
        component.component_metadata = metadata
    try:
        session.commit()
    except IntegrityError as exc:
        session.rollback()
        raise DuplicateObligationComponentError from exc
    session.refresh(component)
    return component


def remove_obligation_component(
    *,
    session: Session,
    ledger_id: uuid.UUID,
    key: ObligationKey,
    component_id: uuid.UUID,
) -> None:
    obligation = get_obligation_by_key(session=session, ledger_id=ledger_id, key=key)
    component = _get_obligation_component(
        session=session, obligation_id=obligation.id, component_id=component_id
    )
    session.delete(component)
    session.commit()


def upsert_obligation_component(
    *,
    session: Session,
    ledger_id: uuid.UUID,
    key: ObligationKey,
    type: str,
    label: str,
    source: str,
    external_id: str,
    amount: Decimal | None = None,
    metadata: dict[str, object] | None = None,
) -> ObligationComponent:
    obligation = get_obligation_by_key(session=session, ledger_id=ledger_id, key=key)
    statement = (
        pg_insert(ObligationComponent)
        .values(
            obligation_id=obligation.id,
            type=type,
            label=label,
            amount=amount,
            source=source,
            external_id=external_id,
            component_metadata=metadata,
        )
        .on_conflict_do_update(
            index_elements=["obligation_id", "source", "external_id"],
            index_where=text("source IS NOT NULL AND external_id IS NOT NULL"),
            set_={
                "type": type,
                "label": label,
                "amount": amount,
                "metadata": metadata,
                "updated_at": datetime.now(UTC),
            },
        )
        .returning(ObligationComponent.id)
    )
    component_id = session.scalar(statement)
    session.commit()
    component = session.get(ObligationComponent, component_id)
    assert component is not None
    session.refresh(component)
    return component
