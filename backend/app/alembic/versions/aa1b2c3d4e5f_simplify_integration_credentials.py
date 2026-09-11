"""Make integrations category-scoped and own their credentials.

Revision ID: aa1b2c3d4e5f
Revises: f5a6b7c8d9e0
"""

import sqlalchemy as sa
from alembic import op

revision = "aa1b2c3d4e5f"
down_revision = "f5a6b7c8d9e0"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Narrowing a legacy integration is a domain decision. Refuse the migration
    # before changing the schema unless every integration already has exactly one
    # category, so no category association can be silently discarded.
    op.execute("""
        DO $$
        DECLARE invalid_count integer;
        BEGIN
            SELECT count(*) INTO invalid_count
            FROM integration i
            WHERE (
                SELECT count(*)
                FROM integration_category link
                WHERE link.integration_id = i.id
            ) <> 1;

            IF invalid_count <> 0 THEN
                RAISE EXCEPTION
                    'Cannot simplify integrations: % integration(s) do not have exactly one category. Resolve their category associations before upgrading.',
                    invalid_count;
            END IF;
        END $$;
    """)
    op.add_column("integration", sa.Column("category_id", sa.Uuid(), nullable=True))
    op.execute("""
        UPDATE integration i SET category_id = link.category_id
        FROM integration_category link
        WHERE link.integration_id = i.id
          AND (SELECT count(*) FROM integration_category x WHERE x.integration_id = i.id) = 1
    """)
    op.create_index("ix_integration_category_id", "integration", ["category_id"])
    op.create_foreign_key(
        "fk_integration_ledger_category", "integration", "category",
        ["ledger_id", "category_id"], ["ledger_id", "id"], ondelete="RESTRICT",
    )
    op.create_table(
        "integration_credential",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("integration_id", sa.Uuid(), nullable=False),
        sa.Column("created_by_user_id", sa.Uuid(), nullable=False),
        sa.Column("key_hash", sa.String(64), nullable=False, unique=True),
        sa.Column("key_prefix", sa.String(32), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_used_at", sa.DateTime(timezone=True)),
        sa.Column("expires_at", sa.DateTime(timezone=True)),
        sa.Column("revoked_at", sa.DateTime(timezone=True)),
        sa.ForeignKeyConstraint(["integration_id"], ["integration.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["user.id"], ondelete="RESTRICT"),
    )
    op.create_index("ix_integration_credential_integration_id", "integration_credential", ["integration_id"])
    op.create_index("ix_integration_credential_created_by_user_id", "integration_credential", ["created_by_user_id"])
    op.create_index("ix_integration_credential_key_prefix", "integration_credential", ["key_prefix"])
    op.drop_constraint("uq_integration_ledger_key", "integration", type_="unique")
    op.drop_constraint("ck_integration_key", "integration", type_="check")
    op.drop_constraint("ck_integration_provider", "integration", type_="check")
    op.drop_column("integration", "key")
    op.drop_column("integration", "provider")
    op.drop_index("ix_integration_category_category_id", table_name="integration_category")
    op.drop_table("integration_category")
    op.alter_column("integration", "category_id", nullable=False)


def downgrade() -> None:
    op.drop_table("integration_credential")
    op.drop_constraint("fk_integration_ledger_category", "integration", type_="foreignkey")
    op.drop_index("ix_integration_category_id", table_name="integration")
    op.drop_column("integration", "category_id")
