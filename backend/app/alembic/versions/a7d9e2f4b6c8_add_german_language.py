"""Allow German as a user language preference.

Revision ID: a7d9e2f4b6c8
Revises: f31a7c9e2b64
"""

from alembic import op

revision = "a7d9e2f4b6c8"
down_revision = "f31a7c9e2b64"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_constraint("ck_user_language_supported", "user", type_="check")
    op.create_check_constraint(
        "ck_user_language_supported",
        "user",
        "language IS NULL OR language IN ('en', 'pl', 'de')",
    )


def downgrade() -> None:
    # Older releases do not understand German. Restore their default preference.
    op.execute("UPDATE \"user\" SET language = NULL WHERE language = 'de'")
    op.drop_constraint("ck_user_language_supported", "user", type_="check")
    op.create_check_constraint(
        "ck_user_language_supported",
        "user",
        "language IS NULL OR language IN ('en', 'pl')",
    )
