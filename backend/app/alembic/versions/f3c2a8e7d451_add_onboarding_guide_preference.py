"""Add the account preference for displaying the dashboard guide."""

import sqlalchemy as sa
from alembic import op

revision = "f3c2a8e7d451"
down_revision = "e1f2a3b4c5d6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "user",
        sa.Column(
            "onboarding_guide_enabled",
            sa.Boolean(),
            server_default=sa.true(),
            nullable=False,
        ),
    )


def downgrade() -> None:
    op.drop_column("user", "onboarding_guide_enabled")
