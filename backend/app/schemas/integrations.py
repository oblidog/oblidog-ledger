import uuid
from datetime import datetime
from typing import Annotated, Self

from pydantic import BaseModel, ConfigDict, Field, StrictBool, model_validator

from app.domain.integrations import (
    IntegrationConflictCode,
    IntegrationExecutionState,
    IntegrationHealth,
    IntegrationResult,
)

IntegrationKey = Annotated[str, Field(pattern=r"^[a-z][a-z0-9-]{0,63}$", max_length=64)]
PositiveSeconds = Annotated[int, Field(strict=True, gt=0, le=2147483647)]
Revision = Annotated[int, Field(strict=True, ge=0, le=9223372036854775807)]
IntegrationName = Annotated[str, Field(min_length=1, max_length=255, pattern=r"\S")]


class IntegrationCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    key: IntegrationKey
    provider: IntegrationKey
    name: IntegrationName
    category_ids: list[uuid.UUID] = Field(default_factory=list, max_length=100)
    enabled: StrictBool = True
    stale_after_seconds: PositiveSeconds = 93600
    run_timeout_seconds: PositiveSeconds = 1800

    @model_validator(mode="after")
    def validate_limits(self) -> Self:
        if self.run_timeout_seconds >= self.stale_after_seconds:
            raise ValueError(
                "run_timeout_seconds must be less than stale_after_seconds"
            )
        return self


class IntegrationUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_revision: Revision
    name: IntegrationName | None = None
    category_ids: list[uuid.UUID] | None = Field(default=None, max_length=100)
    enabled: StrictBool | None = None
    stale_after_seconds: PositiveSeconds | None = None
    run_timeout_seconds: PositiveSeconds | None = None

    @model_validator(mode="after")
    def reject_explicit_null(self) -> Self:
        if any(getattr(self, field) is None for field in self.model_fields_set):
            raise ValueError("Update fields cannot be null")
        return self


class IntegrationRunStart(BaseModel):
    model_config = ConfigDict(extra="forbid")
    run_id: uuid.UUID
    expected_revision: Revision


class IntegrationRunError(BaseModel):
    model_config = ConfigDict(extra="forbid")
    code: str = Field(min_length=1, max_length=64, pattern=r"^[a-z][a-z0-9_]*$")
    message: str = Field(
        min_length=1,
        max_length=1000,
        pattern=r"\S",
        description="Sanitized summary only; never credentials, raw responses or tracebacks.",
    )


class IntegrationRunFinish(BaseModel):
    model_config = ConfigDict(extra="forbid")
    run_id: uuid.UUID
    result: IntegrationResult
    changes_detected: StrictBool | None
    error: IntegrationRunError | None

    @model_validator(mode="after")
    def validate_result(self) -> Self:
        if self.result == IntegrationResult.SUCCESS and self.error is not None:
            raise ValueError("Success cannot contain an error")
        if self.result == IntegrationResult.FAILURE and (
            self.error is None or self.changes_detected is not None
        ):
            raise ValueError("Failure requires an error and null changes_detected")
        return self


class IntegrationPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    ledger_id: uuid.UUID
    key: str
    provider: str
    name: str
    category_ids: list[uuid.UUID]
    enabled: bool
    created_at: datetime
    updated_at: datetime
    enabled_at: datetime | None
    stale_after_seconds: int
    run_timeout_seconds: int
    revision: int
    current_run_id: uuid.UUID | None
    current_started_at: datetime | None
    current_deadline_at: datetime | None
    current_finished_at: datetime | None
    last_finished_at: datetime | None
    last_result: IntegrationResult | None
    last_changes_detected: bool | None
    last_error_code: str | None
    last_error_message: str | None
    last_success_at: datetime | None
    execution_state: IntegrationExecutionState
    is_stale: bool
    health: IntegrationHealth


class IntegrationsPublic(BaseModel):
    data: list[IntegrationPublic]
    count: int


class IntegrationConflictDetail(BaseModel):
    code: IntegrationConflictCode


class IntegrationConflictResponse(BaseModel):
    detail: IntegrationConflictDetail
