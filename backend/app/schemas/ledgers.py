import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field, model_validator

from app.domain import LedgerAccessRole


class LedgerCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    description: str | None = None


class LedgerUpdate(BaseModel):
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
