"""Persist integration run history.

Revision ID: 9a0b1c2d3e4f
Revises: 8f9a0b1c2d3e
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "9a0b1c2d3e4f"
down_revision = "8f9a0b1c2d3e"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "integration_run",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("integration_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("deadline_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True)),
        sa.Column("result", sa.String(16)),
        sa.Column("changes_detected", sa.Boolean()),
        sa.Column("error_code", sa.String(64)),
        sa.Column("error_message", sa.String(1000)),
        sa.ForeignKeyConstraint(["integration_id"], ["integration.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_integration_run_instance_started", "integration_run", ["integration_id", "started_at"])
    # Preserve the current snapshot when rolling out history to existing instances.
    op.execute("""
        INSERT INTO integration_run
            (id, integration_id, started_at, deadline_at, finished_at,
             result, changes_detected, error_code, error_message)
        SELECT current_run_id, id, current_started_at, current_deadline_at,
               current_finished_at,
               CASE WHEN current_finished_at IS NOT NULL THEN last_result END,
               CASE WHEN current_finished_at IS NOT NULL THEN last_changes_detected END,
               CASE WHEN current_finished_at IS NOT NULL THEN last_error_code END,
               CASE WHEN current_finished_at IS NOT NULL THEN last_error_message END
        FROM integration WHERE current_run_id IS NOT NULL
    """)


def downgrade() -> None:
    op.drop_index("ix_integration_run_instance_started", table_name="integration_run")
    op.drop_table("integration_run")
