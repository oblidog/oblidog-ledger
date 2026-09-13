from __future__ import annotations

import uuid
from datetime import UTC, date, datetime
from decimal import Decimal
from enum import Enum
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.domain import (
    SYSTEM_ACTION_ACTOR,
    BillingPeriod,
    CurrentValueSource,
    DataSourcePolicy,
    EffectiveValueSourceMode,
    ObligationActionActor,
    ObligationActionType,
    ObligationKey,
    ObligationLifecycle,
    ValueState,
    due_date_range,
)
from app.models import (
    Category,
    Ledger,
    Obligation,
    ObligationActionLog,
    ObligationComponent,
)
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

_AUDITED_OBLIGATION_FIELDS = (
    "lifecycle",
    "current_amount",
    "amount_state",
    "amount_source",
    "issue_date",
    "issue_date_state",
    "issue_date_source",
    "due_date",
    "due_date_state",
    "due_date_source",
    "effective_value_source",
    "paid_at",
)


def _serialize_action_value(value: Any) -> Any:
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    if isinstance(value, (Enum, uuid.UUID)):
        return str(value.value) if isinstance(value, Enum) else str(value)
    if isinstance(value, dict):
        return {str(key): _serialize_action_value(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_serialize_action_value(item) for item in value]
    return value


def _obligation_snapshot(obligation: Obligation) -> dict[str, object]:
    return {
        field: _serialize_action_value(getattr(obligation, field))
        for field in _AUDITED_OBLIGATION_FIELDS
    }


def _component_snapshot(component: ObligationComponent) -> dict[str, object]:
    return {
        "id": str(component.id),
        "type": component.type,
        "label": component.label,
        "amount": _serialize_action_value(component.amount),
        "source": component.source,
        "external_id": component.external_id,
        "metadata": _serialize_action_value(component.component_metadata),
    }


def _snapshot_diff(
    before: dict[str, object], after: dict[str, object]
) -> dict[str, object]:
    return {
        field: {"from": before[field], "to": after[field]}
        for field in sorted(before.keys() | after.keys())
        if before.get(field) != after.get(field)
    }


def _created_changes(obligation: Obligation) -> dict[str, object]:
    return {
        field: {"from": None, "to": value}
        for field, value in _obligation_snapshot(obligation).items()
    }


def _record_action(
    *,
    session: Session,
    obligation: Obligation,
    action: ObligationActionType,
    actor: ObligationActionActor,
    changes: dict[str, object],
    metadata: dict[str, object] | None = None,
) -> None:
    if not changes:
        return
    session.add(
        ObligationActionLog(
            obligation_id=obligation.id,
            action=action.value,
            actor_type=actor.actor_type.value,
            actor_id=actor.actor_id,
            actor_display_name=actor.display_name,
            integration_id=actor.integration_id,
            run_id=actor.run_id,
            changes=changes,
            action_metadata=_serialize_action_value(metadata),
        )
    )


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
    actor: ObligationActionActor = SYSTEM_ACTION_ACTOR,
) -> list[Obligation]:
    _require_ledger(session=session, ledger_id=ledger_id)

    created = obligation_service.ensure_obligations_for_period(
        session=session,
        ledger_id=ledger_id,
        current_period=period,
    )
    for obligation in created:
        _record_action(
            session=session,
            obligation=obligation,
            action=ObligationActionType.CREATED,
            actor=actor,
            changes=_created_changes(obligation),
        )
    session.commit()
    for obligation in created:
        session.refresh(obligation)
    return created


def estimate_missing_obligation_amounts(
    *,
    session: Session,
    ledger_id: uuid.UUID,
    period: BillingPeriod,
    actor: ObligationActionActor = SYSTEM_ACTION_ACTOR,
) -> list[Obligation]:
    _require_ledger(session=session, ledger_id=ledger_id)
    next_period = period.next()
    candidates = session.scalars(
        select(Obligation).where(
            Obligation.ledger_id == ledger_id,
            (
                (Obligation.period_year == period.year)
                & (Obligation.period_month == period.month)
            )
            | (
                (Obligation.period_year == next_period.year)
                & (Obligation.period_month == next_period.month)
            ),
        )
    ).all()
    before_by_id = {item.id: _obligation_snapshot(item) for item in candidates}
    updated = obligation_service.estimate_missing_obligation_amounts(
        session=session, ledger_id=ledger_id, current_period=period
    )
    for obligation in updated:
        _update_effective_value_source(obligation)
        _record_action(
            session=session,
            obligation=obligation,
            action=ObligationActionType.VALUES_UPDATED,
            actor=actor,
            changes=_snapshot_diff(
                before_by_id[obligation.id], _obligation_snapshot(obligation)
            ),
        )
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
    category_id: uuid.UUID | None = None,
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
    if category_id is not None:
        statement = statement.where(Obligation.category_id == category_id)
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
    actor: ObligationActionActor = SYSTEM_ACTION_ACTOR,
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

    _record_action(
        session=session,
        obligation=obligation,
        action=ObligationActionType.CREATED,
        actor=actor,
        changes=_created_changes(obligation),
    )

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
    actor: ObligationActionActor = SYSTEM_ACTION_ACTOR,
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
        actor=actor,
    )


def update_integration_obligation(
    *,
    session: Session,
    ledger_id: uuid.UUID,
    key: ObligationKey,
    current_amount: Decimal | None | _Unset = UNSET,
    issue_date: date | None | _Unset = UNSET,
    due_date: date | None | _Unset = UNSET,
    actor: ObligationActionActor = SYSTEM_ACTION_ACTOR,
) -> Obligation:
    return _update_obligation_values(
        session=session,
        ledger_id=ledger_id,
        key=key,
        current_amount=current_amount,
        issue_date=issue_date,
        due_date=due_date,
        source=CurrentValueSource.INTEGRATION,
        actor=actor,
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
    actor: ObligationActionActor,
) -> Obligation:
    obligation = get_obligation_by_key(
        session=session, ledger_id=ledger_id, key=key, lock=True
    )
    if obligation.lifecycle not in {
        ObligationLifecycle.DRAFT,
        ObligationLifecycle.COLLECTING_DATA,
    }:
        raise ObligationReadOnlyError

    before = _obligation_snapshot(obligation)
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
    _record_action(
        session=session,
        obligation=obligation,
        action=ObligationActionType.VALUES_UPDATED,
        actor=actor,
        changes=_snapshot_diff(before, _obligation_snapshot(obligation)),
    )
    session.commit()
    session.refresh(obligation)
    return obligation


def mark_obligation_ready(
    *,
    session: Session,
    ledger_id: uuid.UUID,
    key: ObligationKey,
    actor: ObligationActionActor = SYSTEM_ACTION_ACTOR,
) -> Obligation:
    obligation = get_obligation_by_key(
        session=session, ledger_id=ledger_id, key=key, lock=True
    )
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

    before = _obligation_snapshot(obligation)
    obligation.lifecycle = ObligationLifecycle.READY
    obligation.amount_state = ValueState.CONFIRMED
    obligation.due_date_state = ValueState.CONFIRMED
    if obligation.issue_date is not None:
        obligation.issue_date_state = ValueState.CONFIRMED
    _record_action(
        session=session,
        obligation=obligation,
        action=ObligationActionType.MARKED_READY,
        actor=actor,
        changes=_snapshot_diff(before, _obligation_snapshot(obligation)),
    )
    session.commit()
    session.refresh(obligation)
    return obligation


def mark_obligation_paid(
    *,
    session: Session,
    ledger_id: uuid.UUID,
    key: ObligationKey,
    actor: ObligationActionActor = SYSTEM_ACTION_ACTOR,
) -> Obligation:
    obligation = get_obligation_by_key(
        session=session, ledger_id=ledger_id, key=key, lock=True
    )
    if obligation.lifecycle is ObligationLifecycle.PAID:
        return obligation
    if obligation.lifecycle is not ObligationLifecycle.READY:
        raise ObligationInvalidLifecycleError

    before = _obligation_snapshot(obligation)
    obligation.lifecycle = ObligationLifecycle.PAID
    obligation.paid_at = datetime.now(UTC)
    _record_action(
        session=session,
        obligation=obligation,
        action=ObligationActionType.MARKED_PAID,
        actor=actor,
        changes=_snapshot_diff(before, _obligation_snapshot(obligation)),
    )
    session.commit()
    session.refresh(obligation)
    return obligation


def cancel_obligation(
    *,
    session: Session,
    ledger_id: uuid.UUID,
    key: ObligationKey,
    actor: ObligationActionActor = SYSTEM_ACTION_ACTOR,
) -> Obligation:
    obligation = get_obligation_by_key(
        session=session, ledger_id=ledger_id, key=key, lock=True
    )
    if obligation.lifecycle is not ObligationLifecycle.COLLECTING_DATA:
        raise ObligationInvalidLifecycleError

    before = _obligation_snapshot(obligation)
    obligation.lifecycle = ObligationLifecycle.CANCELED
    _record_action(
        session=session,
        obligation=obligation,
        action=ObligationActionType.CANCELED,
        actor=actor,
        changes=_snapshot_diff(before, _obligation_snapshot(obligation)),
    )
    session.commit()
    session.refresh(obligation)
    return obligation


def reopen_obligation(
    *,
    session: Session,
    ledger_id: uuid.UUID,
    key: ObligationKey,
    actor: ObligationActionActor = SYSTEM_ACTION_ACTOR,
) -> Obligation:
    obligation = get_obligation_by_key(
        session=session, ledger_id=ledger_id, key=key, lock=True
    )
    if obligation.lifecycle not in {
        ObligationLifecycle.READY,
        ObligationLifecycle.PAID,
        ObligationLifecycle.CANCELED,
        ObligationLifecycle.ERROR,
    }:
        raise ObligationInvalidLifecycleError

    before = _obligation_snapshot(obligation)
    obligation.lifecycle = ObligationLifecycle.COLLECTING_DATA
    obligation.paid_at = None
    _record_action(
        session=session,
        obligation=obligation,
        action=ObligationActionType.REOPENED,
        actor=actor,
        changes=_snapshot_diff(before, _obligation_snapshot(obligation)),
    )
    session.commit()
    session.refresh(obligation)
    return obligation


def mark_obligation_error(
    *,
    session: Session,
    ledger_id: uuid.UUID,
    key: ObligationKey,
    actor: ObligationActionActor = SYSTEM_ACTION_ACTOR,
) -> Obligation:
    obligation = get_obligation_by_key(
        session=session, ledger_id=ledger_id, key=key, lock=True
    )
    before = _obligation_snapshot(obligation)
    obligation.lifecycle = ObligationLifecycle.ERROR
    _record_action(
        session=session,
        obligation=obligation,
        action=ObligationActionType.MARKED_ERROR,
        actor=actor,
        changes=_snapshot_diff(before, _obligation_snapshot(obligation)),
    )
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
    obligation = get_obligation_by_key(
        session=session, ledger_id=ledger_id, key=key, lock=True
    )
    timestamp = (now or datetime.now(UTC)).astimezone(UTC).strftime("%Y-%m-%d %H:%M")
    entry = f"[{timestamp}] {integration_name}: {text}"
    obligation.notes = entry if not obligation.notes else f"{obligation.notes}\n{entry}"
    session.commit()
    session.refresh(obligation)
    return obligation


def get_obligation_by_key(
    *,
    session: Session,
    ledger_id: uuid.UUID,
    key: ObligationKey,
    lock: bool = False,
) -> Obligation:
    _require_ledger(session=session, ledger_id=ledger_id)
    statement = (
        select(Obligation)
        .join(Obligation.category)
        .where(
            Obligation.ledger_id == ledger_id,
            Category.code == key.category_code,
            Obligation.period_year == key.period.year,
            Obligation.period_month == key.period.month,
        )
    )
    if lock:
        statement = statement.with_for_update(of=Obligation).execution_options(
            populate_existing=True
        )
    obligation = session.scalar(statement)
    if obligation is None:
        raise ObligationNotFoundError
    return obligation


def list_obligation_actions(
    *,
    session: Session,
    ledger_id: uuid.UUID,
    key: ObligationKey,
    limit: int = 100,
    offset: int = 0,
) -> tuple[list[ObligationActionLog], int]:
    obligation = get_obligation_by_key(session=session, ledger_id=ledger_id, key=key)
    items = list(
        session.scalars(
            select(ObligationActionLog)
            .where(ObligationActionLog.obligation_id == obligation.id)
            .order_by(
                ObligationActionLog.created_at.desc(),
                ObligationActionLog.id.desc(),
            )
            .limit(limit)
            .offset(offset)
        ).all()
    )
    count = (
        session.scalar(
            select(func.count())
            .select_from(ObligationActionLog)
            .where(ObligationActionLog.obligation_id == obligation.id)
        )
        or 0
    )
    return items, count


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
    actor: ObligationActionActor = SYSTEM_ACTION_ACTOR,
) -> ObligationComponent:
    obligation = get_obligation_by_key(
        session=session, ledger_id=ledger_id, key=key, lock=True
    )
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
        session.flush()
        _record_action(
            session=session,
            obligation=obligation,
            action=ObligationActionType.COMPONENTS_CHANGED,
            actor=actor,
            changes={
                "components": {
                    "added": [_component_snapshot(component)],
                    "updated": [],
                    "removed": [],
                }
            },
        )
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
    actor: ObligationActionActor = SYSTEM_ACTION_ACTOR,
) -> ObligationComponent:
    obligation = get_obligation_by_key(
        session=session, ledger_id=ledger_id, key=key, lock=True
    )
    component = _get_obligation_component(
        session=session, obligation_id=obligation.id, component_id=component_id
    )
    before = _component_snapshot(component)
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
        after = _component_snapshot(component)
        component_changes = _snapshot_diff(before, after)
        if component_changes:
            _record_action(
                session=session,
                obligation=obligation,
                action=ObligationActionType.COMPONENTS_CHANGED,
                actor=actor,
                changes={
                    "components": {
                        "added": [],
                        "updated": [
                            {
                                "id": str(component.id),
                                "label": before["label"],
                                "changes": component_changes,
                            }
                        ],
                        "removed": [],
                    }
                },
            )
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
    actor: ObligationActionActor = SYSTEM_ACTION_ACTOR,
) -> None:
    obligation = get_obligation_by_key(
        session=session, ledger_id=ledger_id, key=key, lock=True
    )
    component = _get_obligation_component(
        session=session, obligation_id=obligation.id, component_id=component_id
    )
    snapshot = _component_snapshot(component)
    session.delete(component)
    _record_action(
        session=session,
        obligation=obligation,
        action=ObligationActionType.COMPONENTS_CHANGED,
        actor=actor,
        changes={
            "components": {
                "added": [],
                "updated": [],
                "removed": [snapshot],
            }
        },
    )
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
    actor: ObligationActionActor = SYSTEM_ACTION_ACTOR,
) -> ObligationComponent:
    obligation = get_obligation_by_key(
        session=session, ledger_id=ledger_id, key=key, lock=True
    )
    component = session.scalar(
        select(ObligationComponent).where(
            ObligationComponent.obligation_id == obligation.id,
            ObligationComponent.source == source,
            ObligationComponent.external_id == external_id,
        )
    )
    created = component is None
    before: dict[str, object] | None = None
    if component is None:
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
        session.flush()
    else:
        before = _component_snapshot(component)
        component.type = type
        component.label = label
        component.amount = amount
        component.component_metadata = metadata

    after = _component_snapshot(component)
    if created:
        component_diff: dict[str, object] = {
            "components": {"added": [after], "updated": [], "removed": []}
        }
    else:
        assert before is not None
        field_changes = _snapshot_diff(before, after)
        component_diff = (
            {
                "components": {
                    "added": [],
                    "updated": [
                        {
                            "id": str(component.id),
                            "label": before["label"],
                            "changes": field_changes,
                        }
                    ],
                    "removed": [],
                }
            }
            if field_changes
            else {}
        )
    _record_action(
        session=session,
        obligation=obligation,
        action=ObligationActionType.COMPONENTS_CHANGED,
        actor=actor,
        changes=component_diff,
    )
    try:
        session.commit()
    except IntegrityError as exc:
        session.rollback()
        raise DuplicateObligationComponentError from exc
    session.refresh(component)
    return component
