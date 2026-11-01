import uuid
from datetime import date
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field

from app.domain import ValueState

AttentionReason = Literal["overdue", "error", "incomplete", "upcoming"]


class AttentionIntegrationPublic(BaseModel):
    id: uuid.UUID
    name: str
    health: Literal["error", "timed_out", "stale"]


class AttentionItemPublic(BaseModel):
    key: str
    name: str
    category_code: str | None = None
    year: int | None = None
    month: int | None = None
    due_date: date | None = None
    due_date_state: ValueState = ValueState.UNKNOWN
    amount: Decimal | None = None
    amount_state: ValueState = ValueState.UNKNOWN
    currency: str | None = None
    reasons: list[AttentionReason] = Field(default_factory=list)
    integrations: list[AttentionIntegrationPublic] = Field(default_factory=list)


class AttentionOverviewPublic(BaseModel):
    as_of_date: date
    items: list[AttentionItemPublic]
    total: int
    offset: int
    limit: int
