from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import TYPE_CHECKING, cast

from sqlalchemy import (
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    String,
    Text,
    UniqueConstraint,
    event,
    inspect,
    select,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, column_property, mapped_column, relationship

from app.domain import BillingPeriod, Currency, DataSourcePolicy, RecurrenceUnit
from app.models.base import Base, get_datetime_utc

if TYPE_CHECKING:
    from app.models.counterparty import Counterparty
    from app.models.ledger import Ledger
    from app.models.obligation import Obligation


class CategoryGroup(Base):
    __tablename__ = "category_group"
    __table_args__ = (
        UniqueConstraint("ledger_id", "id"),
        UniqueConstraint("ledger_id", "name"),
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
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(default=True, nullable=False)
    archived_at: Mapped[datetime | None] = mapped_column(
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

    ledger: Mapped[Ledger] = relationship(back_populates="category_groups")
    categories: Mapped[list[Category]] = relationship(
        back_populates="category_group",
        cascade="all, delete-orphan",
        overlaps="ledger",
    )


class Category(Base):
    __tablename__ = "category"
    __table_args__ = (
        ForeignKeyConstraint(
            ["ledger_id", "category_group_id"],
            ["category_group.ledger_id", "category_group.id"],
            ondelete="RESTRICT",
        ),
        UniqueConstraint("ledger_id", "id"),
        UniqueConstraint("ledger_id", "category_group_id", "name"),
        UniqueConstraint("ledger_id", "code"),
        CheckConstraint("code ~ '^[A-Z]{4}$'"),
        CheckConstraint("recurrence_interval IS NULL OR recurrence_interval > 0"),
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
    category_group_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), nullable=False, index=True
    )
    counterparty_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("counterparty.id", ondelete="RESTRICT"),
        nullable=True,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(default=True, nullable=False)
    code: Mapped[str] = mapped_column(String(4), nullable=False)
    data_source_policy: Mapped[DataSourcePolicy] = mapped_column(nullable=False)
    recurrence_interval: Mapped[int | None] = mapped_column(nullable=True)
    recurrence_unit: Mapped[RecurrenceUnit | None] = mapped_column(nullable=True)
    first_due_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    currency: Mapped[Currency] = mapped_column(
        String(3), default=Currency.PLN, nullable=False
    )
    archived_at: Mapped[datetime | None] = mapped_column(
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
        back_populates="categories",
        overlaps="categories,category_group",
    )
    category_group: Mapped[CategoryGroup] = relationship(
        back_populates="categories",
        overlaps="ledger,categories",
    )
    counterparty: Mapped[Counterparty | None] = relationship(back_populates="categories")
    obligations: Mapped[list[Obligation]] = relationship(
        back_populates="category",
        overlaps="ledger,obligations",
    )
    data_records: Mapped[list[CategoryDataRecord]] = relationship(
        back_populates="category", cascade="all, delete-orphan"
    )
    data_schemas: Mapped[list[CategoryDataSchema]] = relationship(
        back_populates="category", cascade="all, delete-orphan"
    )

    @property
    def active_data_schema_version(self) -> int | None:
        return cast(int | None, self.__dict__.get("_active_data_schema_version"))

    @property
    def has_data_schema(self) -> bool:
        return self.active_data_schema_version is not None

    def occurs_in(self, period: BillingPeriod) -> bool:
        if (
            self.data_source_policy is DataSourcePolicy.MANUAL
            or self.recurrence_interval is None
            or self.recurrence_unit is None
            or self.first_due_date is None
        ):
            return False

        anchor_period = BillingPeriod.from_date(self.first_due_date)
        month_difference = (period.year - anchor_period.year) * 12 + (
            period.month - anchor_period.month
        )
        if month_difference < 0:
            return False
        if self.recurrence_unit is RecurrenceUnit.MONTH:
            return month_difference % self.recurrence_interval == 0
        return (
            period.month == anchor_period.month
            and (period.year - anchor_period.year) % self.recurrence_interval == 0
        )


@event.listens_for(Category, "before_update")
def _prevent_category_code_change(
    _mapper: object, _connection: object, target: Category
) -> None:
    if inspect(target).attrs.code.history.has_changes():
        raise ValueError("Category code is immutable")


class CategoryDataRecord(Base):
    __tablename__ = "category_data"
    __table_args__ = (
        ForeignKeyConstraint(
            ["category_id", "schema_version"],
            ["category_data_schema.category_id", "category_data_schema.version"],
        ),
        Index(
            "ix_category_data_category_observed_at",
            "category_id",
            text("observed_at DESC"),
        ),
        Index(
            "uq_category_data_source_external_id",
            "category_id",
            "source",
            "external_id",
            unique=True,
            postgresql_where=text("source IS NOT NULL AND external_id IS NOT NULL"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    category_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("category.id", ondelete="CASCADE"),
        nullable=False,
    )
    schema_version: Mapped[int] = mapped_column(nullable=False)
    observed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    data: Mapped[dict[str, object]] = mapped_column(JSONB, nullable=False)
    source: Mapped[str | None] = mapped_column(String(255), nullable=True)
    external_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=get_datetime_utc, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=get_datetime_utc,
        onupdate=get_datetime_utc,
        nullable=False,
    )

    category: Mapped[Category] = relationship(back_populates="data_records")


class CategoryDataSchema(Base):
    __tablename__ = "category_data_schema"
    __table_args__ = (
        UniqueConstraint("category_id", "version"),
        Index(
            "uq_category_data_schema_active",
            "category_id",
            unique=True,
            postgresql_where=text("is_active"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    category_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("category.id", ondelete="CASCADE"),
        nullable=False,
    )
    version: Mapped[int] = mapped_column(nullable=False)
    schema: Mapped[dict[str, object]] = mapped_column(JSONB, nullable=False)
    is_active: Mapped[bool] = mapped_column(default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=get_datetime_utc, nullable=False
    )

    category: Mapped[Category] = relationship(back_populates="data_schemas")


Category._active_data_schema_version = column_property(
    select(CategoryDataSchema.version)
    .where(
        CategoryDataSchema.category_id == Category.id,
        CategoryDataSchema.is_active.is_(True),
    )
    .correlate_except(CategoryDataSchema)
    .scalar_subquery()
)
