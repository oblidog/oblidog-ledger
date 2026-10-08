import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from app.schemas.common import PasswordStr


class UserBase(BaseModel):
    email: EmailStr = Field(max_length=255)
    is_active: bool = True
    is_superuser: bool = False
    full_name: str | None = Field(default=None, max_length=255)


class UserCreate(UserBase):
    password: PasswordStr


class UserUpdate(BaseModel):
    email: EmailStr | None = Field(default=None, max_length=255)
    is_active: bool | None = None
    is_superuser: bool | None = None
    full_name: str | None = Field(default=None, max_length=255)
    password: PasswordStr | None = None


class UserUpdateMe(BaseModel):
    full_name: str | None = Field(default=None, max_length=255)
    email: EmailStr | None = Field(default=None, max_length=255)


class UpdatePassword(BaseModel):
    current_password: PasswordStr
    new_password: PasswordStr


class UserReportPreferences(BaseModel):
    model_config = ConfigDict(from_attributes=True, extra="forbid", strict=True)

    daily_report_enabled: bool
    weekly_report_enabled: bool


class UserReportPreferencesUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    daily_report_enabled: bool = True
    weekly_report_enabled: bool = True


class UserPublic(UserBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    created_at: datetime


class UsersPublic(BaseModel):
    data: list[UserPublic]
    count: int
