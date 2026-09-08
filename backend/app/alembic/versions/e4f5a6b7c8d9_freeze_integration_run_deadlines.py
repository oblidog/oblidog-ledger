"""Freeze each integration run's deadline at start.

Revision ID: e4f5a6b7c8d9
Revises: d3e4f5a6b7c8
"""
from alembic import op
import sqlalchemy as sa

revision = "e4f5a6b7c8d9"
down_revision = "d3e4f5a6b7c8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("integration", sa.Column("current_deadline_at", sa.DateTime(timezone=True), nullable=True))
    # Existing registry rows have no deadline snapshot. Preserve their deadline
    # as calculated by the previous schema, for completed and unfinished runs.
    op.execute("UPDATE integration SET current_deadline_at = current_started_at + run_timeout_seconds * INTERVAL '1 second' WHERE current_run_id IS NOT NULL")
    op.create_check_constraint(
        "ck_integration_deadline",
        "integration",
        "(current_run_id IS NULL AND current_deadline_at IS NULL) OR (current_run_id IS NOT NULL AND current_deadline_at IS NOT NULL AND current_deadline_at > current_started_at)",
    )


def downgrade() -> None:
    op.drop_constraint("ck_integration_deadline", "integration", type_="check")
    op.drop_column("integration", "current_deadline_at")
