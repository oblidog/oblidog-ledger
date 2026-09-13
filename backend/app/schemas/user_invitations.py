import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, EmailStr, Field

from app.schemas.common import PasswordStr


class UserInvitationCreate(BaseModel):
    email: EmailStr = Field(max_length=255)
    full_name: str | None = Field(default=None, max_length=255)
    is_superuser: bool = False


class UserInvitationAccept(BaseModel):
    new_password: PasswordStr


class UserInvitationInspect(BaseModel):
    email: EmailStr
    expires_at: datetime


class UserInvitationPublic(BaseModel):
    id: uuid.UUID
    email: EmailStr
    full_name: str | None
    is_superuser: bool
    status: Literal["pending", "expired", "accepted", "revoked"]
    expires_at: datetime
    accepted_at: datetime | None
    revoked_at: datetime | None
    created_at: datetime
    created_by_user_id: uuid.UUID | None


class UserInvitationsPublic(BaseModel):
    data: list[UserInvitationPublic]
    count: int
