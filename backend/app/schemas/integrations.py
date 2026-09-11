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

PositiveSeconds = Annotated[int, Field(strict=True, gt=0, le=2147483647)]
Revision = Annotated[int, Field(strict=True, ge=0, le=9223372036854775807)]
IntegrationName = Annotated[str, Field(min_length=1, max_length=255, pattern=r"\S")]


class IntegrationCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: IntegrationName
    category_id: uuid.UUID


class IntegrationUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_revision: Revision
    name: IntegrationName | None = None
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
    name: str
    category_id: uuid.UUID
    credentials: list["IntegrationCredentialPublic"]
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


class IntegrationCredentialPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    key_prefix: str
    created_at: datetime
    last_used_at: datetime | None
    expires_at: datetime | None
    revoked_at: datetime | None


class IntegrationCreated(BaseModel):
    integration: IntegrationPublic
    credential: IntegrationCredentialPublic
    connection_key: str


class IntegrationCredentialCreated(BaseModel):
    credential: IntegrationCredentialPublic
    connection_key: str


class IntegrationContextPublic(BaseModel):
    integration: dict[str, object]
    category: dict[str, object]


IntegrationPublic.model_rebuild()


class IntegrationConflictDetail(BaseModel):
    code: IntegrationConflictCode


class IntegrationConflictResponse(BaseModel):
    detail: IntegrationConflictDetail
