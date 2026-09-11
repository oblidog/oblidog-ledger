from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    String,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, get_datetime_utc


class Integration(Base):
    __tablename__ = "integration"
    __table_args__ = (
        UniqueConstraint("ledger_id", "id", name="uq_integration_ledger_id"),
        ForeignKeyConstraint(
            ["ledger_id", "category_id"],
            ["category.ledger_id", "category.id"],
            ondelete="RESTRICT",
        ),
        CheckConstraint(
            "run_timeout_seconds > 0 AND stale_after_seconds > run_timeout_seconds",
            name="ck_integration_limits",
        ),
        CheckConstraint("revision >= 0", name="ck_integration_revision"),
        CheckConstraint(
            "(current_run_id IS NULL AND current_deadline_at IS NULL) OR (current_run_id IS NOT NULL AND current_deadline_at IS NOT NULL AND current_deadline_at > current_started_at)",
            name="ck_integration_deadline",
        ),
        CheckConstraint(
            "NOT enabled OR enabled_at IS NOT NULL", name="ck_integration_enabled"
        ),
        CheckConstraint(
            "(current_run_id IS NULL AND current_started_at IS NULL AND current_finished_at IS NULL) OR (current_run_id IS NOT NULL AND current_started_at IS NOT NULL AND (current_finished_at IS NULL OR current_finished_at >= current_started_at))",
            name="ck_integration_run",
        ),
        CheckConstraint(
            "(last_result IS NULL AND last_finished_at IS NULL AND last_changes_detected IS NULL AND last_error_code IS NULL AND last_error_message IS NULL) OR (last_result IS NOT NULL AND last_finished_at IS NOT NULL AND ((last_result = 'success' AND last_error_code IS NULL AND last_error_message IS NULL) OR (last_result = 'failure' AND last_changes_detected IS NULL AND last_error_code IS NOT NULL AND last_error_message IS NOT NULL)))",
            name="ck_integration_result",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    ledger_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("ledger.id", ondelete="CASCADE"), index=True
    )
    category_id: Mapped[uuid.UUID] = mapped_column(index=True)
    name: Mapped[str] = mapped_column(String(255))
    enabled: Mapped[bool] = mapped_column(default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=get_datetime_utc
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=get_datetime_utc
    )
    enabled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    stale_after_seconds: Mapped[int] = mapped_column(default=93600)
    run_timeout_seconds: Mapped[int] = mapped_column(default=1800)
    revision: Mapped[int] = mapped_column(BigInteger, default=0)
    current_run_id: Mapped[uuid.UUID | None]
    current_started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    current_deadline_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True)
    )
    current_finished_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True)
    )
    last_finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_result: Mapped[str | None] = mapped_column(String(7))
    last_changes_detected: Mapped[bool | None]
    last_error_code: Mapped[str | None] = mapped_column(String(64))
    last_error_message: Mapped[str | None] = mapped_column(String(1000))
    last_success_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    credentials: Mapped[list[IntegrationCredential]] = relationship(
        lazy="selectin", cascade="all, delete-orphan", passive_deletes=True
    )


class IntegrationCredential(Base):
    __tablename__ = "integration_credential"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    integration_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("integration.id", ondelete="CASCADE"), index=True
    )
    created_by_user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("user.id", ondelete="RESTRICT"), index=True
    )
    key_hash: Mapped[str] = mapped_column(String(64), unique=True)
    key_prefix: Mapped[str] = mapped_column(String(32), index=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=get_datetime_utc
    )
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
