"""Default automatic collection for newly created obligations only."""

from alembic import op
import sqlalchemy as sa

revision = "e1f2a3b4c5d6"
down_revision = "c8d2a4e6f901"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "category",
        sa.Column("automatic_collection", sa.Boolean(), nullable=False, server_default=sa.false()),
    )


def downgrade() -> None:
    op.drop_column("category", "automatic_collection")
