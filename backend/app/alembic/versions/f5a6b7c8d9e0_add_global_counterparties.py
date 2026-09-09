"""Add global counterparties and category/obligation references.

Revision ID: f5a6b7c8d9e0
Revises: e4f5a6b7c8d9
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "f5a6b7c8d9e0"
down_revision = "e4f5a6b7c8d9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "counterparty",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("short_name", sa.String(length=255), nullable=True),
        sa.Column("logo_url", sa.String(length=2048), nullable=True),
        sa.Column("website_url", sa.String(length=2048), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_counterparty_name"), "counterparty", ["name"], unique=False)
    op.create_index(
        "uq_counterparty_name_lower",
        "counterparty",
        [sa.text("lower(name)")],
        unique=True,
    )

    op.add_column(
        "category",
        sa.Column("counterparty_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_index(
        op.f("ix_category_counterparty_id"), "category", ["counterparty_id"], unique=False
    )
    op.create_foreign_key(
        "fk_category_counterparty_id_counterparty",
        "category",
        "counterparty",
        ["counterparty_id"],
        ["id"],
        ondelete="RESTRICT",
    )

    op.add_column(
        "obligation",
        sa.Column("counterparty_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_index(
        op.f("ix_obligation_counterparty_id"),
        "obligation",
        ["counterparty_id"],
        unique=False,
    )
    op.create_foreign_key(
        "fk_obligation_counterparty_id_counterparty",
        "obligation",
        "counterparty",
        ["counterparty_id"],
        ["id"],
        ondelete="RESTRICT",
    )


def downgrade() -> None:
    op.drop_constraint(
        "fk_obligation_counterparty_id_counterparty", "obligation", type_="foreignkey"
    )
    op.drop_index(op.f("ix_obligation_counterparty_id"), table_name="obligation")
    op.drop_column("obligation", "counterparty_id")

    op.drop_constraint(
        "fk_category_counterparty_id_counterparty", "category", type_="foreignkey"
    )
    op.drop_index(op.f("ix_category_counterparty_id"), table_name="category")
    op.drop_column("category", "counterparty_id")

    op.drop_index("uq_counterparty_name_lower", table_name="counterparty")
    op.drop_index(op.f("ix_counterparty_name"), table_name="counterparty")
    op.drop_table("counterparty")
