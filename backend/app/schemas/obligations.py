import uuid
from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.domain import (
    BillingPeriod,
    CurrentValueSource,
    EffectiveValueSourceMode,
    ObligationLifecycle,
    ValueState,
    due_date_range,
)
from app.schemas.counterparties import CounterpartySummaryPublic


class BillingPeriodInput(BaseModel):
    year: int = Field(ge=1, le=9999)
    month: int = Field(ge=1, le=12)


class ObligationCreate(BaseModel):
    category_code: str = Field(pattern=r"^[A-Z]{4}$")
    period: BillingPeriodInput
    data_ready: bool = False
    current_amount: Decimal | None = Field(default=None, ge=0)
    issue_date: date | None = None
    due_date: date | None = None
    notes: str | None = None

    @model_validator(mode="after")
    def require_confirmed_values_when_data_is_ready(self) -> "ObligationCreate":
        if self.data_ready and (self.current_amount is None or self.due_date is None):
            raise ValueError(
                "current_amount and due_date are required when data_ready is true"
            )
        if self.due_date is not None:
            minimum, maximum = due_date_range(
                BillingPeriod(year=self.period.year, month=self.period.month)
            )
            if not minimum <= self.due_date <= maximum:
                raise ValueError(
                    "due_date must be within the billing period or the first "
                    "seven business days after it"
                )
        if self.issue_date is not None and self.due_date is not None:
            if self.issue_date > self.due_date:
                raise ValueError("issue_date cannot be later than due_date")
        return self


class ObligationUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    current_amount: Decimal | None = Field(default=None, ge=0)
    issue_date: date | None = None
    due_date: date | None = None
    notes: str | None = None


class ObligationComponentCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: str = Field(min_length=1, max_length=64)
    label: str = Field(min_length=1, max_length=255)
    amount: Decimal | None = None
    source: str | None = Field(default=None, min_length=1, max_length=255)
    external_id: str | None = Field(default=None, min_length=1, max_length=255)
    metadata: dict[str, object] | None = None


class ObligationComponentUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: str | None = Field(default=None, min_length=1, max_length=64)
    label: str | None = Field(default=None, min_length=1, max_length=255)
    amount: Decimal | None = None
    source: str | None = Field(default=None, min_length=1, max_length=255)
    external_id: str | None = Field(default=None, min_length=1, max_length=255)
    metadata: dict[str, object] | None = None

    @field_validator("type", "label")
    @classmethod
    def require_non_null_identity_fields(cls, value: str | None) -> str | None:
        if value is None:
            raise ValueError("field cannot be null")
        return value


class ObligationComponentUpsert(ObligationComponentCreate):
    @model_validator(mode="after")
    def require_external_identity(self) -> "ObligationComponentUpsert":
        if self.source is None or self.external_id is None:
            raise ValueError("source and external_id are required for upsert")
        return self


class IntegrationObligationComponentUpsert(BaseModel):
    """An obligation component identified within its authenticated integration."""

    model_config = ConfigDict(extra="forbid")

    type: str = Field(min_length=1, max_length=64)
    label: str = Field(min_length=1, max_length=255)
    external_id: str = Field(min_length=1, max_length=255)
    amount: Decimal | None = None
    metadata: dict[str, object] | None = None


class ObligationComponentPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    obligation_id: uuid.UUID
    type: str
    label: str
    amount: Decimal | None
    source: str | None
    external_id: str | None
    metadata: dict[str, object] | None
    created_at: datetime
    updated_at: datetime


class ObligationComponentsPublic(BaseModel):
    data: list[ObligationComponentPublic]
    count: int


class ObligationIntegrationUpdate(BaseModel):
    """Values an API-key authenticated integration may update."""

    model_config = ConfigDict(extra="forbid")

    current_amount: Decimal | None = Field(default=None, ge=0)
    issue_date: date | None = None
    due_date: date | None = None


class ObligationNoteAppend(BaseModel):
    model_config = ConfigDict(extra="forbid")

    text: str = Field(min_length=1)


class ObligationPeriodPublic(BillingPeriodInput):
    pass


class ObligationPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    ledger_id: uuid.UUID
    category_id: uuid.UUID
    counterparty_id: uuid.UUID | None
    counterparty: CounterpartySummaryPublic | None
    category_code: str
    key: str
    name: str
    notes: str | None
    lifecycle: ObligationLifecycle
    period: ObligationPeriodPublic
    effective_value_source: EffectiveValueSourceMode
    current_amount: Decimal | None
    amount_state: ValueState
    amount_source: CurrentValueSource
    issue_date: date | None
    issue_date_state: ValueState
    issue_date_source: CurrentValueSource
    due_date: date | None
    due_date_state: ValueState
    due_date_source: CurrentValueSource
    currency: str | None
    paid_at: datetime | None
    created_at: datetime
    updated_at: datetime


class ObligationsPublic(BaseModel):
    data: list[ObligationPublic]
    count: int


class EnsuredObligationsPublic(BaseModel):
    created_keys: list[str]
    created_count: int
