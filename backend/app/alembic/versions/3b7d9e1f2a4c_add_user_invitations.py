"""Add secure user invitations.

Revision ID: 3b7d9e1f2a4c
Revises: ab2c3d4e5f6a
"""

import sqlalchemy as sa
from alembic import op

revision = "3b7d9e1f2a4c"
down_revision = "ab2c3d4e5f6a"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "user_invitation",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("email", sa.String(255), nullable=False),
        sa.Column("full_name", sa.String(255)),
        sa.Column("is_superuser", sa.Boolean(), nullable=False),
        sa.Column("token_hash", sa.String(64), nullable=False, unique=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("accepted_at", sa.DateTime(timezone=True)),
        sa.Column("revoked_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_by_user_id", sa.Uuid()),
        sa.CheckConstraint(
            "accepted_at IS NULL OR revoked_at IS NULL",
            name="ck_user_invitation_not_accepted_and_revoked",
        ),
        sa.ForeignKeyConstraint(
            ["created_by_user_id"], ["user.id"], ondelete="SET NULL"
        ),
    )
    op.create_index("ix_user_invitation_email", "user_invitation", ["email"])
    op.create_index(
        "ix_user_invitation_created_by_user_id",
        "user_invitation",
        ["created_by_user_id"],
    )
    op.create_index(
        "uq_user_invitation_pending_email",
        "user_invitation",
        ["email"],
        unique=True,
        postgresql_where=sa.text("accepted_at IS NULL AND revoked_at IS NULL"),
    )


def downgrade() -> None:
    op.drop_table("user_invitation")
