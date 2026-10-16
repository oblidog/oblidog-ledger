"""Additive error envelope. The historical detail value is preserved."""

from typing import Any

from pydantic import BaseModel, Field

from app.core.api_error_codes import ErrorCode


class ApiErrorResponse(BaseModel):
    detail: Any
    code: ErrorCode
    params: dict[str, Any] = Field(default_factory=dict)
