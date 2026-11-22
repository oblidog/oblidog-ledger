"""Add an optional payment execution plan to obligations."""

from alembic import op
import sqlalchemy as sa

revision = "c8d2a4e6f901"
down_revision = "0e382a6b7c8d"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "obligation",
        sa.Column("payment_execution", sa.String(20), nullable=True),
    )
    op.create_check_constraint(
        "payment_execution",
        "obligation",
        "payment_execution IN ('scheduled_transfer', 'automatic_collection')",
    )


def downgrade() -> None:
    op.drop_constraint("payment_execution", "obligation", type_="check")
    op.drop_column("obligation", "payment_execution")
