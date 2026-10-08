from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum

from app.domain.currencies import Currency


class LedgerAccessRole(StrEnum):
    OWNER = "owner"
    EDITOR = "editor"
    VIEWER = "viewer"


@dataclass(slots=True)
class Ledger:
    id: uuid.UUID
    owner_user_id: uuid.UUID
    name: str
    description: str | None
    is_active: bool
    created_at: datetime
    updated_at: datetime
    business_calendar_country: str = "PL"
    default_currency: Currency = Currency.PLN


@dataclass(slots=True)
class LedgerMembership:
    ledger_id: uuid.UUID
    user_id: uuid.UUID
    role: LedgerAccessRole
    created_at: datetime
