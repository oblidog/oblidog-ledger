"""Persist scheduled report attempt outcomes.

Revision ID: a1b2c3d4e5f6
Revises: 9a0b1c2d3e4f
"""
from alembic import op
import sqlalchemy as sa

revision = "a1b2c3d4e5f6"
down_revision = "9a0b1c2d3e4f"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column("report_delivery", "status", existing_type=sa.String(6), type_=sa.String(20), existing_nullable=False)
    op.add_column("report_delivery", sa.Column("attempt_count", sa.Integer(), server_default="0", nullable=False))
    op.add_column("report_delivery", sa.Column("attempt_started_at", sa.DateTime(timezone=True)))
    op.add_column("report_delivery", sa.Column("attempt_finished_at", sa.DateTime(timezone=True)))
    # Legacy FAILED also meant "send in progress"; its outcome cannot be proven.
    op.execute("UPDATE report_delivery SET status = 'UNCERTAIN', error_message = 'legacy_outcome_requires_review' WHERE status = 'FAILED'")


def downgrade() -> None:
    # Do not turn uncertainty into automatically retryable FAILED on rollback.
    bind = op.get_bind()
    if bind.execute(sa.text("SELECT count(*) FROM report_delivery WHERE status IN ('UNCERTAIN', 'IN_PROGRESS')")).scalar():
        raise RuntimeError("Resolve uncertain report deliveries before downgrade")
    op.drop_column("report_delivery", "attempt_finished_at")
    op.drop_column("report_delivery", "attempt_started_at")
    op.drop_column("report_delivery", "attempt_count")
    op.alter_column("report_delivery", "status", existing_type=sa.String(20), type_=sa.String(6), existing_nullable=False)
