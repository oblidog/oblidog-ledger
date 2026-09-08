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
        UniqueConstraint("ledger_id", "key", name="uq_integration_ledger_key"),
        CheckConstraint("key ~ '^[a-z][a-z0-9-]{0,63}$'", name="ck_integration_key"),
        CheckConstraint(
            "provider ~ '^[a-z][a-z0-9-]{0,63}$'", name="ck_integration_provider"
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
    key: Mapped[str] = mapped_column(String(64))
    provider: Mapped[str] = mapped_column(String(64))
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
    category_links: Mapped[list[IntegrationCategory]] = relationship(
        lazy="selectin", cascade="all, delete-orphan", passive_deletes=True
    )

    @property
    def category_ids(self) -> list[uuid.UUID]:
        return sorted((link.category_id for link in self.category_links), key=str)


class IntegrationCategory(Base):
    __tablename__ = "integration_category"
    __table_args__ = (
        ForeignKeyConstraint(
            ["ledger_id", "integration_id"],
            ["integration.ledger_id", "integration.id"],
            ondelete="CASCADE",
        ),
        ForeignKeyConstraint(
            ["ledger_id", "category_id"],
            ["category.ledger_id", "category.id"],
            ondelete="CASCADE",
        ),
    )
    integration_id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    category_id: Mapped[uuid.UUID] = mapped_column(primary_key=True, index=True)
    ledger_id: Mapped[uuid.UUID]
