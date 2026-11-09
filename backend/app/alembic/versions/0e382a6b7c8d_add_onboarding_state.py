"""Persist resumable first-payment onboarding per user."""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0e382a6b7c8d"
down_revision = "b7c8d9e0f1a2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("user", sa.Column("onboarding_state", postgresql.JSONB(), nullable=True))


def downgrade() -> None:
    op.drop_column("user", "onboarding_state")
