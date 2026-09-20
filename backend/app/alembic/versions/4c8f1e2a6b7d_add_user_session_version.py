"""Add user session version.

Revision ID: 4c8f1e2a6b7d
Revises: 3b7d9e1f2a4c
"""

import sqlalchemy as sa
from alembic import op

revision = "4c8f1e2a6b7d"
down_revision = "3b7d9e1f2a4c"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "user",
        sa.Column(
            "session_version",
            sa.Integer(),
            server_default="1",
            nullable=False,
        ),
    )
    op.create_check_constraint(
        "ck_user_session_version_positive",
        "user",
        "session_version >= 1",
    )


def downgrade() -> None:
    op.drop_constraint(
        "ck_user_session_version_positive", "user", type_="check"
    )
    op.drop_column("user", "session_version")
