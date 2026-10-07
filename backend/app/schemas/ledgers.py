import uuid
from datetime import datetime

from pydantic import (
    BaseModel,
    ConfigDict,
    EmailStr,
    Field,
    field_validator,
    model_validator,
)

from app.domain import Currency, LedgerAccessRole
from app.domain.business_calendar import validate_calendar_country


class LedgerPreferencesInput(BaseModel):
    business_calendar_country: str | None = None

    @field_validator("business_calendar_country")
    @classmethod
    def validate_country(cls, value: str | None) -> str | None:
        return validate_calendar_country(value) if value is not None else None


class LedgerCreate(LedgerPreferencesInput):
    default_currency: Currency = Currency.PLN
    name: str = Field(min_length=1, max_length=255)
    description: str | None = None


class LedgerUpdate(LedgerPreferencesInput):
    default_currency: Currency | None = None
    name: str = Field(min_length=1, max_length=255)
    description: str | None = None


class LedgerShare(BaseModel):
    user_id: uuid.UUID | None = None
    email: EmailStr | None = None
    role: LedgerAccessRole

    @model_validator(mode="after")
    def validate_target(self) -> LedgerShare:
        if self.user_id is not None and self.email is not None:
            raise ValueError("Provide only one share target")
        if self.user_id is None and self.email is None:
            raise ValueError("Either user_id or email is required")
        return self


class LedgerMemberUpdate(BaseModel):
    role: LedgerAccessRole


class LedgerPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    owner_user_id: uuid.UUID
    business_calendar_country: str
    default_currency: Currency
    name: str
    description: str | None
    created_at: datetime
    updated_at: datetime


class LedgersPublic(BaseModel):
    data: list[LedgerPublic]
    count: int


class LedgerMemberPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    ledger_id: uuid.UUID
    user_id: uuid.UUID
    email: EmailStr
    full_name: str | None
    role: LedgerAccessRole
    created_at: datetime


class LedgerMembersPublic(BaseModel):
    data: list[LedgerMemberPublic]
    count: int


class LedgerPreferenceOptions(BaseModel):
    countries: list[str]
    currencies: list[Currency]
    default_business_calendar_country: str
    default_currency: Currency
