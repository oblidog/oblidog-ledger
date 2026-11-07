"""A single user lock and transaction cover each step and its domain writes.

Only the ledger is created early. Category, group and first obligation are
published together, so the scheduler cannot race a half-configured category.
"""

import secrets
import string
import unicodedata
import uuid

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.api_errors import ApplicationError
from app.core.config import settings
from app.domain import (
    BillingPeriod,
    Currency,
    DataSourcePolicy,
    ObligationActionActor,
    ObligationKey,
)
from app.models import Category, CategoryGroup, Ledger, User
from app.schemas.onboarding import (
    ChooseLedger,
    CreateFirstPayment,
    DescribeCategory,
    OnboardingCommand,
    OnboardingState,
    SetSchedule,
)
from app.use_cases import categories, ledgers, obligations
from app.use_cases.exceptions import (
    DuplicateCategoryCodeError,
    DuplicateCategoryError,
    DuplicateCategoryGroupError,
)


def _conflict() -> ApplicationError:
    return ApplicationError(
        status_code=409,
        code="onboarding_changed",
        detail="Onboarding changed. Reload progress and continue.",
    )


def _owned_ledger(
    session: Session,
    user: User,
    ledger_id: uuid.UUID | None,
    *,
    for_update: bool = False,
) -> Ledger:
    query = select(Ledger).where(
        Ledger.id == ledger_id,
        Ledger.owner_user_id == user.id,
        Ledger.is_active.is_(True),
    )
    if for_update:
        query = query.with_for_update()
    ledger = session.scalar(query)
    if ledger is None:
        raise ApplicationError(
            status_code=404, code="ledger_not_found", detail="Ledger not found"
        )
    return ledger


def _group(session: Session, ledger: Ledger, group_id: uuid.UUID) -> CategoryGroup:
    group = session.scalar(
        select(CategoryGroup).where(
            CategoryGroup.id == group_id,
            CategoryGroup.ledger_id == ledger.id,
            CategoryGroup.is_active.is_(True),
        )
    )
    if group is None:
        raise ApplicationError(
            status_code=404,
            code="category_group_not_found",
            detail="Category group not found",
        )
    return group


def suggest_code(session: Session, ledger_id: uuid.UUID, name: str) -> str:
    ascii_name = (
        unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode().upper()
    )
    prefix = "".join(c for c in ascii_name if c in string.ascii_uppercase)
    candidate = (prefix + "XXXX")[:4]
    used = set(
        session.scalars(select(Category.code).where(Category.ledger_id == ledger_id))
    )
    while candidate in used:
        candidate = "".join(secrets.choice(string.ascii_uppercase) for _ in range(4))
    return candidate


def read_progress(user: User) -> OnboardingState:
    return OnboardingState.model_validate(user.onboarding_state or {})


def advance(
    *, session: Session, user_id: uuid.UUID, command: OnboardingCommand
) -> OnboardingState:
    # The public demo uses an isolated client-side preview, including when writes
    # elsewhere in the demo are enabled. Never persist shared-account progress.
    if settings.ENVIRONMENT == "demo":
        raise ApplicationError(
            status_code=403,
            code="onboarding_demo_preview",
            detail="Use the onboarding preview in demo",
        )
    user = session.scalars(
        select(User)
        .where(User.id == user_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    ).one()
    state = read_progress(user)
    if state.revision != command.revision:
        raise _conflict()
    try:
        if command.action == "dismiss":
            state.dismissed = True
        elif command.action == "resume":
            state.dismissed = False
        elif command.action == "restart":
            state = OnboardingState(revision=state.revision)
        elif command.action == "back":
            if state.step == 4:
                raise _conflict()
            state.step = max(0, state.step - 1)
        elif isinstance(command, ChooseLedger):
            if state.step != 0:
                raise _conflict()
            ledger: Ledger | None
            if command.ledger_id:
                ledger = _owned_ledger(session, user, command.ledger_id)
            else:
                assert command.ledger is not None
                # Reuse a named workspace after restart or a previous manual setup.
                ledger = session.scalar(
                    select(Ledger).where(
                        Ledger.owner_user_id == user.id,
                        Ledger.name == command.ledger.name.strip(),
                        Ledger.is_active.is_(True),
                    )
                )
                if ledger is None:
                    ledger = ledgers.create_ledger(
                        session=session,
                        owner_user_id=user.id,
                        **command.ledger.model_dump(),
                        commit=False,
                    )
            if state.ledger_id != ledger.id:
                state.category = None
                state.schedule = None
            state.ledger_id = ledger.id
            state.default_currency = Currency(ledger.default_currency)
            state.business_calendar_country = ledger.business_calendar_country
            state.step = 1
        elif isinstance(command, DescribeCategory):
            if state.step != 1:
                raise _conflict()
            ledger = _owned_ledger(session, user, state.ledger_id)
            if command.category.group_id:
                _group(session, ledger, command.category.group_id)
            state.category = command.category
            state.step = 2
        elif isinstance(command, SetSchedule):
            if state.step != 2:
                raise _conflict()
            _owned_ledger(session, user, state.ledger_id)
            state.schedule = command.schedule
            state.step = 3
        elif isinstance(command, CreateFirstPayment):
            if state.step != 3 or state.category is None or state.schedule is None:
                raise _conflict()
            # Keep the ledger calendar stable from calculation through confirmation.
            ledger = _owned_ledger(session, user, state.ledger_id, for_update=True)
            state.business_calendar_country = ledger.business_calendar_country
            draft = state.category
            group: CategoryGroup | None
            if draft.group_id:
                group = _group(session, ledger, draft.group_id)
            else:
                group = session.scalar(
                    select(CategoryGroup).where(
                        CategoryGroup.ledger_id == ledger.id,
                        CategoryGroup.name == draft.group_name,
                        CategoryGroup.is_active.is_(True),
                    )
                )
                if group is None:
                    assert draft.group_name is not None
                    group = categories.create_category_group(
                        session=session,
                        ledger_id=ledger.id,
                        name=draft.group_name,
                        commit=False,
                    )
            category = categories.create_category(
                session=session,
                ledger_id=ledger.id,
                category_group_id=group.id,
                name=draft.name,
                code=draft.code or suggest_code(session, ledger.id, draft.name),
                currency=draft.currency,
                data_source_policy=DataSourcePolicy.HYBRID,
                **state.schedule.model_dump(),
                commit=False,
            )
            actor = ObligationActionActor.user(
                user_id=user.id, display_name=user.full_name or user.email
            )
            period = BillingPeriod.from_date(state.schedule.first_due_date)
            payment = obligations.create_manual_obligation(
                session=session,
                ledger_id=ledger.id,
                category_code=category.code,
                period=period,
                current_amount=command.amount,
                actor=actor,
                commit=False,
            )
            if command.ready:
                if payment.due_date != command.confirmed_due_date:
                    session.rollback()
                    raise ApplicationError(
                        status_code=409,
                        code="onboarding_due_date_changed",
                        detail="The first payment due date changed. Review it and confirm again.",
                    )
                payment = obligations.mark_obligation_ready(
                    session=session,
                    ledger_id=ledger.id,
                    key=ObligationKey(category_code=category.code, period=period),
                    actor=actor,
                    commit=False,
                )
            state.category = draft.model_copy(
                update={"group_id": group.id, "group_name": None, "code": category.code}
            )
            state.obligation_key = payment.business_key
            state.step = 4
        state.revision += 1
        user.onboarding_state = state.model_dump(mode="json")
        session.commit()
    except (
        DuplicateCategoryCodeError,
        DuplicateCategoryError,
        DuplicateCategoryGroupError,
        IntegrityError,
    ) as error:
        session.rollback()
        raise ApplicationError(
            status_code=409,
            code="onboarding_name_in_use",
            detail="A name or code is already in use. Go back and change it.",
        ) from error
    return state
