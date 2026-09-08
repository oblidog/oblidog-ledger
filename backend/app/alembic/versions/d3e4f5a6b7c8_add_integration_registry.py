"""Add ledger-scoped integration registry and current operational state.

Revision ID: d3e4f5a6b7c8
Revises: c2d3e4f5a6b7
"""
from alembic import op
import sqlalchemy as sa

revision = "d3e4f5a6b7c8"
down_revision = "c2d3e4f5a6b7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "integration",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("ledger_id", sa.Uuid(), nullable=False),
        sa.Column("key", sa.String(64), nullable=False),
        sa.Column("provider", sa.String(64), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("enabled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("stale_after_seconds", sa.Integer(), nullable=False),
        sa.Column("run_timeout_seconds", sa.Integer(), nullable=False),
        sa.Column("revision", sa.BigInteger(), nullable=False),
        sa.Column("current_run_id", sa.Uuid(), nullable=True),
        sa.Column("current_started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("current_finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_result", sa.String(7), nullable=True),
        sa.Column("last_changes_detected", sa.Boolean(), nullable=True),
        sa.Column("last_error_code", sa.String(64), nullable=True),
        sa.Column("last_error_message", sa.String(1000), nullable=True),
        sa.Column("last_success_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["ledger_id"], ["ledger.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("ledger_id", "id", name="uq_integration_ledger_id"),
        sa.UniqueConstraint("ledger_id", "key", name="uq_integration_ledger_key"),
        sa.CheckConstraint("key ~ '^[a-z][a-z0-9-]{0,63}$'", name="ck_integration_key"),
        sa.CheckConstraint("provider ~ '^[a-z][a-z0-9-]{0,63}$'", name="ck_integration_provider"),
        sa.CheckConstraint("run_timeout_seconds > 0 AND stale_after_seconds > run_timeout_seconds", name="ck_integration_limits"),
        sa.CheckConstraint("revision >= 0", name="ck_integration_revision"),
        sa.CheckConstraint("NOT enabled OR enabled_at IS NOT NULL", name="ck_integration_enabled"),
        sa.CheckConstraint("(current_run_id IS NULL AND current_started_at IS NULL AND current_finished_at IS NULL) OR (current_run_id IS NOT NULL AND current_started_at IS NOT NULL AND (current_finished_at IS NULL OR current_finished_at >= current_started_at))", name="ck_integration_run"),
        sa.CheckConstraint("(last_result IS NULL AND last_finished_at IS NULL AND last_changes_detected IS NULL AND last_error_code IS NULL AND last_error_message IS NULL) OR (last_result IS NOT NULL AND last_finished_at IS NOT NULL AND ((last_result = 'success' AND last_error_code IS NULL AND last_error_message IS NULL) OR (last_result = 'failure' AND last_changes_detected IS NULL AND last_error_code IS NOT NULL AND last_error_message IS NOT NULL)))", name="ck_integration_result"),
    )
    op.create_index("ix_integration_ledger_id", "integration", ["ledger_id"])
    op.create_table(
        "integration_category",
        sa.Column("integration_id", sa.Uuid(), nullable=False),
        sa.Column("category_id", sa.Uuid(), nullable=False),
        sa.Column("ledger_id", sa.Uuid(), nullable=False),
        sa.PrimaryKeyConstraint("integration_id", "category_id"),
        sa.ForeignKeyConstraint(["ledger_id", "integration_id"], ["integration.ledger_id", "integration.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["ledger_id", "category_id"], ["category.ledger_id", "category.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_integration_category_category_id", "integration_category", ["category_id"])


def downgrade() -> None:
    op.drop_table("integration_category")
    op.drop_table("integration")
