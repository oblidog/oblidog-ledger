"""Versioned commands: a lost response can never create the same entities twice."""

import uuid
from datetime import date
from decimal import Decimal
from typing import Annotated, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

from app.domain import Currency, RecurrenceUnit
from app.schemas.ledgers import LedgerCreate, LedgerPreferencesInput

Name = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=255)
]


class CategoryDraft(BaseModel):
    name: Name
    group_id: uuid.UUID | None = None
    group_name: Name | None = None
    code: str | None = Field(default=None, pattern=r"^[A-Z]{4}$")
    currency: Currency = Currency.PLN

    @model_validator(mode="after")
    def group_target(self) -> Self:
        if (self.group_id is None) == (self.group_name is None):
            raise ValueError("Choose an existing group or enter a new group name")
        return self


class ScheduleDraft(BaseModel):
    first_due_date: date = Field(ge=date(1900, 1, 1), le=date(9998, 12, 31))
    recurrence_interval: int = Field(default=1, ge=1, le=1200)
    recurrence_unit: RecurrenceUnit = RecurrenceUnit.MONTH


class FirstPaymentPreview(ScheduleDraft, LedgerPreferencesInput):
    pass


class OnboardingState(BaseModel):
    revision: int = 0
    step: int = Field(default=0, ge=0, le=4)
    dismissed: bool = False
    ledger_id: uuid.UUID | None = None
    default_currency: Currency = Currency.PLN
    business_calendar_country: str = "PL"
    category: CategoryDraft | None = None
    schedule: ScheduleDraft | None = None
    obligation_key: str | None = None


class Command(BaseModel):
    model_config = ConfigDict(extra="forbid")
    revision: int = Field(ge=0)


class ChooseLedger(Command):
    action: Literal["ledger"]
    ledger_id: uuid.UUID | None = None
    ledger: LedgerCreate | None = None

    @model_validator(mode="after")
    def ledger_target(self) -> Self:
        if self.ledger is not None and not self.ledger.name.strip():
            raise ValueError("Workspace name must not be empty")
        if (self.ledger_id is None) == (self.ledger is None):
            raise ValueError("Choose an existing ledger or enter a new ledger")
        return self


class DescribeCategory(Command):
    action: Literal["category"]
    category: CategoryDraft


class SetSchedule(Command):
    action: Literal["schedule"]
    schedule: ScheduleDraft


class CreateFirstPayment(Command):
    action: Literal["payment"]
    amount: Decimal | None = Field(default=None, ge=0, max_digits=12, decimal_places=2)
    ready: bool = False

    @model_validator(mode="after")
    def ready_amount(self) -> Self:
        if self.ready and self.amount is None:
            raise ValueError("A confirmed amount is required for a ready payment")
        return self


class PauseOnboarding(Command):
    action: Literal["dismiss", "resume", "back", "restart"]


OnboardingCommand = Annotated[
    ChooseLedger
    | DescribeCategory
    | SetSchedule
    | CreateFirstPayment
    | PauseOnboarding,
    Field(discriminator="action"),
]
