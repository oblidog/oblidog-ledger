import uuid
from datetime import datetime

from sqlalchemy import DateTime, Enum, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.domain.report_delivery import ReportDeliveryStatus
from app.models.base import Base, get_datetime_utc


class ReportDelivery(Base):
    """Best-effort SMTP delivery record.

    Unfinished SMTP attempts require operator recovery before retrying.
    """

    __tablename__ = "report_delivery"
    __table_args__ = (UniqueConstraint("user_id", "delivery_key"),)

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    report_type: Mapped[str] = mapped_column(String(100), nullable=False)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("user.id", ondelete="CASCADE"), nullable=False
    )
    delivery_key: Mapped[str] = mapped_column(String(255), nullable=False)
    status: Mapped[ReportDeliveryStatus] = mapped_column(
        Enum(ReportDeliveryStatus, native_enum=False, length=20), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=get_datetime_utc, nullable=False
    )
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    error_message: Mapped[str | None] = mapped_column(String(1000))
    attempt_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    attempt_started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    attempt_finished_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True)
    )

    @property
    def message_id(self) -> str:
        return f"<report-{self.id}@oblidog.local>"
