from datetime import UTC, datetime
from decimal import Decimal
from importlib import import_module
from uuid import uuid4

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import inspect, text
from sqlalchemy.orm import Session

from app.api.routes.obligations import to_obligation_public
from app.domain import (
    BillingPeriod,
    CurrentValueSource,
    EffectiveValueSourceMode,
    ObligationLifecycle,
)
from app.models import Obligation
from app.use_cases import obligations as obligation_use_cases
from tests.conftest import test_engine
from tests.utils.ledger_domain import create_category_with_recurrence


def test_removal_preserves_imported_paid_obligations_and_round_trips(
    db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    ledger, _, category = create_category_with_recurrence(db)
    obligation = obligation_use_cases.ensure_obligations_for_period(
        session=db, ledger_id=ledger.id, period=BillingPeriod(2026, 8)
    )[0]
    obligation.amount_source = CurrentValueSource.LEGACY
    obligation.issue_date_source = CurrentValueSource.LEGACY
    obligation.due_date_source = CurrentValueSource.LEGACY
    obligation.effective_value_source = EffectiveValueSourceMode.LEGACY
    obligation.current_amount = Decimal("123.45")
    obligation.lifecycle = ObligationLifecycle.PAID
    obligation.paid_at = datetime(2026, 8, 20, tzinfo=UTC)
    db.commit()
    before = to_obligation_public(obligation).model_dump()
    migration = import_module(
        "app.alembic.versions.b7c8d9e0f1a2_remove_legacy_import_jobs"
    )
    schema = f"migration_{uuid4().hex}"
    with test_engine.begin() as connection:
        # Isolate the importer table while retaining real business-data FKs.
        connection.execute(text(f'CREATE SCHEMA "{schema}"'))
        connection.execute(text(f'SET LOCAL search_path TO "{schema}", public'))
        monkeypatch.setattr(
            migration, "op", Operations(MigrationContext.configure(connection))
        )
        migration.downgrade()
        connection.execute(
            text(
                "INSERT INTO legacy_import_job "
                "(id, ledger_id, status, is_active, processed_obligations, "
                "total_obligations, created_at) VALUES "
                "(:id, :ledger_id, 'SUCCEEDED', false, 1, 1, now())"
            ),
            {"id": uuid4(), "ledger_id": ledger.id},
        )
        migration.upgrade()
        assert "legacy_import_job" not in inspect(connection).get_table_names(
            schema=schema
        )
        migration.downgrade()
        assert connection.scalar(text("SELECT count(*) FROM legacy_import_job")) == 0
        indexes = inspect(connection).get_indexes("legacy_import_job", schema=schema)
        assert {index["name"] for index in indexes} == {
            "ix_legacy_import_job_ledger_id",
            "uq_legacy_import_job_active",
        }
        migration.upgrade()
        connection.execute(text(f'DROP SCHEMA "{schema}"'))
    db.expire_all()
    restored = db.get(Obligation, obligation.id)
    assert restored is not None
    assert to_obligation_public(restored).model_dump() == before
    assert restored.category.id == category.id
