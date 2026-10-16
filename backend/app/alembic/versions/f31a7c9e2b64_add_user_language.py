"""Add an optional user language preference.

Revision ID: f31a7c9e2b64
Revises: a1b2c3d4e5f6
"""
from alembic import op
import sqlalchemy as sa

revision = "f31a7c9e2b64"
down_revision = "a1b2c3d4e5f6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("user", sa.Column("language", sa.String(2), nullable=True))
    op.create_check_constraint("ck_user_language_supported", "user", "language IS NULL OR language IN ('en', 'pl')")


def downgrade() -> None:
    op.drop_constraint("ck_user_language_supported", "user", type_="check")
    op.drop_column("user", "language")
