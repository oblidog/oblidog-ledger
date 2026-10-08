"""Persist the holiday country and default currency per ledger.

Revision ID: 7e8f9a0b1c2d
Revises: 6d7e8f9a0b1c
"""

from alembic import op
import sqlalchemy as sa

from app.core.config import settings
from app.domain.business_calendar import validate_calendar_country

revision = "7e8f9a0b1c2d"
down_revision = "6d7e8f9a0b1c"
branch_labels = None
depends_on = None


def upgrade() -> None:
    country = validate_calendar_country(settings.BUSINESS_CALENDAR_COUNTRY)
    op.add_column(
        "ledger",
        sa.Column(
            "business_calendar_country",
            sa.String(2),
            nullable=False,
            server_default=country,
        ),
    )
    op.add_column(
        "ledger",
        sa.Column(
            "default_currency", sa.String(3), nullable=False, server_default="PLN"
        ),
    )
    op.alter_column("ledger", "business_calendar_country", server_default=None)


def downgrade() -> None:
    op.drop_column("ledger", "default_currency")
    op.drop_column("ledger", "business_calendar_country")
