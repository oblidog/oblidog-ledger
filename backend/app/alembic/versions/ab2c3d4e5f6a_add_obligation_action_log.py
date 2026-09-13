"""Add append-only obligation action log.

Revision ID: ab2c3d4e5f6a
Revises: aa1b2c3d4e5f
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "ab2c3d4e5f6a"
down_revision = "aa1b2c3d4e5f"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "obligation_action_log",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("obligation_id", sa.Uuid(), nullable=False),
        sa.Column("action", sa.String(length=32), nullable=False),
        sa.Column("actor_type", sa.String(length=16), nullable=False),
        sa.Column("actor_id", sa.Uuid(), nullable=True),
        sa.Column("actor_display_name", sa.String(length=255), nullable=False),
        sa.Column("integration_id", sa.Uuid(), nullable=True),
        sa.Column("run_id", sa.Uuid(), nullable=True),
        sa.Column("changes", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("metadata", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "action IN ('created', 'values_updated', 'components_changed', "
            "'marked_ready', 'marked_paid', 'canceled', 'reopened', 'marked_error')",
            name="ck_obligation_action_log_action",
        ),
        sa.CheckConstraint(
            "actor_type IN ('user', 'integration', 'system')",
            name="ck_obligation_action_log_actor_type",
        ),
        sa.CheckConstraint(
            "(actor_type = 'user' AND actor_id IS NOT NULL "
            "AND integration_id IS NULL AND run_id IS NULL) OR "
            "(actor_type = 'integration' AND actor_id IS NOT NULL "
            "AND actor_id = integration_id) OR "
            "(actor_type = 'system' AND actor_id IS NULL "
            "AND integration_id IS NULL AND run_id IS NULL)",
            name="ck_obligation_action_log_actor",
        ),
        sa.CheckConstraint(
            "jsonb_typeof(changes) = 'object' AND changes <> '{}'::jsonb",
            name="ck_obligation_action_log_changes",
        ),
        sa.ForeignKeyConstraint(
            ["obligation_id"], ["obligation.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_obligation_action_log_obligation_created",
        "obligation_action_log",
        ["obligation_id", sa.text("created_at DESC"), sa.text("id DESC")],
    )


def downgrade() -> None:
    op.drop_table("obligation_action_log")
