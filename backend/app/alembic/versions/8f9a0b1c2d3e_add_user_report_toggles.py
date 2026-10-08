"""Add independent scheduled report toggles, preserving existing delivery.

Revision ID: 8f9a0b1c2d3e
Revises: 7e8f9a0b1c2d
"""

from alembic import op
import sqlalchemy as sa

revision = "8f9a0b1c2d3e"
down_revision = "7e8f9a0b1c2d"
branch_labels = None
depends_on = None


def upgrade() -> None:
    for name in ("daily_report_enabled", "weekly_report_enabled"):
        op.add_column(
            "user",
            sa.Column(name, sa.Boolean(), nullable=False, server_default=sa.true()),
        )


def downgrade() -> None:
    op.drop_column("user", "weekly_report_enabled")
    op.drop_column("user", "daily_report_enabled")
