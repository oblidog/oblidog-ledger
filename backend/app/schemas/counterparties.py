import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class CounterpartyCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=255)
    short_name: str | None = Field(default=None, max_length=255)
    logo_url: str | None = Field(default=None, max_length=2048)
    website_url: str | None = Field(default=None, max_length=2048)


class CounterpartyUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=255)
    short_name: str | None = Field(default=None, max_length=255)
    logo_url: str | None = Field(default=None, max_length=2048)
    website_url: str | None = Field(default=None, max_length=2048)


class CounterpartyAssignment(BaseModel):
    model_config = ConfigDict(extra="forbid")

    counterparty_id: uuid.UUID | None = None


class CounterpartySummaryPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    short_name: str | None
    logo_url: str | None


class CounterpartyPublic(CounterpartySummaryPublic):
    website_url: str | None
    created_at: datetime
    updated_at: datetime


class CounterpartiesPublic(BaseModel):
    data: list[CounterpartyPublic]
    count: int


class CounterpartySearchPublic(BaseModel):
    items: list[CounterpartySummaryPublic]
