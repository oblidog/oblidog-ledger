"""Remove obsolete legacy importer jobs, preserving imported business data.

Downgrade recreates the job infrastructure, but cannot restore discarded job history.
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "b7c8d9e0f1a2"
down_revision = "a7d9e2f4b6c8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_table("legacy_import_job")


def downgrade() -> None:
    op.create_table(
        "legacy_import_job",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("ledger_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("processed_obligations", sa.Integer(), nullable=False),
        sa.Column("total_obligations", sa.Integer(), nullable=False),
        sa.Column("created_category_groups", sa.Integer()),
        sa.Column("created_categories", sa.Integer()),
        sa.Column("replaced_categories", sa.Integer()),
        sa.Column("imported_obligations", sa.Integer()),
        sa.Column("error", sa.String(length=1000)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True)),
        sa.Column("finished_at", sa.DateTime(timezone=True)),
        sa.ForeignKeyConstraint(["ledger_id"], ["ledger.id"], ondelete="CASCADE"),
    )
    op.create_index(
        "ix_legacy_import_job_ledger_id", "legacy_import_job", ["ledger_id"]
    )
    op.create_index(
        "uq_legacy_import_job_active",
        "legacy_import_job",
        ["is_active"],
        unique=True,
        postgresql_where=sa.text("is_active"),
    )

