"""Add single-use password reset tokens.

Revision ID: 6d7e8f9a0b1c
Revises: 4c8f1e2a6b7d
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "6d7e8f9a0b1c"
down_revision = "4c8f1e2a6b7d"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "password_reset_token",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("consumed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("invalidated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "consumed_at IS NULL OR invalidated_at IS NULL",
            name="ck_password_reset_token_single_terminal_state",
        ),
        sa.ForeignKeyConstraint(["user_id"], ["user.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("token_hash"),
    )
    op.create_index(
        op.f("ix_password_reset_token_user_id"),
        "password_reset_token",
        ["user_id"],
        unique=False,
    )
    op.create_index(
        "uq_password_reset_token_active_user",
        "password_reset_token",
        ["user_id"],
        unique=True,
        postgresql_where=sa.text(
            "consumed_at IS NULL AND invalidated_at IS NULL"
        ),
    )


def downgrade() -> None:
    op.drop_index(
        "uq_password_reset_token_active_user",
        table_name="password_reset_token",
    )
    op.drop_index(
        op.f("ix_password_reset_token_user_id"),
        table_name="password_reset_token",
    )
    op.drop_table("password_reset_token")
