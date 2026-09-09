from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import TYPE_CHECKING

from sqlalchemy import (
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.domain import (
    CurrentValueSource,
    EffectiveValueSourceMode,
    ObligationLifecycle,
    ValueState,
)
from app.models.base import Base, get_datetime_utc

if TYPE_CHECKING:
    from app.models.category import Category
    from app.models.counterparty import Counterparty
    from app.models.ledger import Ledger


class Obligation(Base):
    __tablename__ = "obligation"
    __table_args__ = (
        ForeignKeyConstraint(
            ["ledger_id", "category_id"],
            ["category.ledger_id", "category.id"],
            ondelete="RESTRICT",
        ),
        UniqueConstraint("ledger_id", "id"),
        UniqueConstraint(
            "ledger_id",
            "category_id",
            "period_year",
            "period_month",
            name="uq_obligation_ledger_category_period",
        ),
        CheckConstraint("period_month >= 1 AND period_month <= 12"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    ledger_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("ledger.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    category_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), nullable=False, index=True
    )
    counterparty_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("counterparty.id", ondelete="RESTRICT"),
        nullable=True,
        index=True,
    )
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    lifecycle: Mapped[ObligationLifecycle] = mapped_column(nullable=False)
    period_year: Mapped[int] = mapped_column(nullable=False)
    period_month: Mapped[int] = mapped_column(nullable=False)
    effective_value_source: Mapped[EffectiveValueSourceMode] = mapped_column(
        nullable=False
    )
    current_amount: Mapped[Decimal | None] = mapped_column(
        Numeric(12, 2), nullable=True
    )
    amount_state: Mapped[ValueState] = mapped_column(nullable=False)
    amount_source: Mapped[CurrentValueSource] = mapped_column(nullable=False)
    issue_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    issue_date_state: Mapped[ValueState] = mapped_column(nullable=False)
    issue_date_source: Mapped[CurrentValueSource] = mapped_column(nullable=False)
    due_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    due_date_state: Mapped[ValueState] = mapped_column(nullable=False)
    due_date_source: Mapped[CurrentValueSource] = mapped_column(nullable=False)
    currency: Mapped[str | None] = mapped_column(String(3), nullable=True)
    paid_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    last_auto_sync_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=get_datetime_utc, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=get_datetime_utc,
        onupdate=get_datetime_utc,
        nullable=False,
    )

    ledger: Mapped[Ledger] = relationship(
        back_populates="obligations",
        overlaps="category,obligations",
    )
    category: Mapped[Category] = relationship(
        back_populates="obligations",
        overlaps="ledger,obligations",
    )
    counterparty: Mapped[Counterparty | None] = relationship(back_populates="obligations")
    components: Mapped[list[ObligationComponent]] = relationship(
        back_populates="obligation", cascade="all, delete-orphan"
    )

    @property
    def business_key(self) -> str:
        """Stable public key derived from the immutable category code and period."""
        return f"{self.category.code}-{self.period_year:04d}-{self.period_month:02d}"


class ObligationComponent(Base):
    __tablename__ = "obligation_component"
    __table_args__ = (
        Index("ix_obligation_component_obligation_id", "obligation_id"),
        Index(
            "uq_obligation_component_source_external_id",
            "obligation_id",
            "source",
            "external_id",
            unique=True,
            postgresql_where=text("source IS NOT NULL AND external_id IS NOT NULL"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    obligation_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("obligation.id", ondelete="CASCADE"),
        nullable=False,
    )
    type: Mapped[str] = mapped_column(String(64), nullable=False)
    label: Mapped[str] = mapped_column(String(255), nullable=False)
    amount: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    source: Mapped[str | None] = mapped_column(String(255), nullable=True)
    external_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    component_metadata: Mapped[dict[str, object] | None] = mapped_column(
        "metadata", JSONB, nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=get_datetime_utc, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=get_datetime_utc,
        onupdate=get_datetime_utc,
        nullable=False,
    )

    obligation: Mapped[Obligation] = relationship(back_populates="components")
