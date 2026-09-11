from collections.abc import Generator
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, delete
from sqlalchemy.orm import Session, sessionmaker

from app.api.deps import get_db
from app.core.config import settings
from app.core.db import init_db
from app.main import app
from app.models import (
    Category,
    CategoryDataRecord,
    CategoryDataSchema,
    CategoryGroup,
    Integration,
    IntegrationCredential,
    Ledger,
    LedgerMembership,
    LegacyImportJob,
    Obligation,
    SystemRun,
    SystemRunStep,
    User,
)
from tests.utils.user import authentication_token_from_email
from tests.utils.utils import get_superuser_token_headers

if settings.TEST_SQLALCHEMY_DATABASE_URI is None:
    raise RuntimeError(
        "TEST_SQLALCHEMY_DATABASE_URI must be set to run backend tests safely."
    )

if str(settings.TEST_SQLALCHEMY_DATABASE_URI) == str(settings.SQLALCHEMY_DATABASE_URI):
    raise RuntimeError(
        "TEST_SQLALCHEMY_DATABASE_URI must point to a different database than "
        "SQLALCHEMY_DATABASE_URI."
    )

test_engine = create_engine(
    str(settings.TEST_SQLALCHEMY_DATABASE_URI),
    pool_pre_ping=True,
)
TestingSessionLocal = sessionmaker(
    bind=test_engine,
    class_=Session,
    expire_on_commit=False,
)


def override_get_db() -> Generator[Session, None, None]:
    with TestingSessionLocal() as session:
        yield session


def run_test_migrations() -> None:
    alembic_cfg = Config(str(Path(__file__).resolve().parents[1] / "alembic.ini"))
    alembic_cfg.set_main_option(
        "sqlalchemy.url", str(settings.TEST_SQLALCHEMY_DATABASE_URI)
    )
    command.upgrade(alembic_cfg, "head")


@pytest.fixture(scope="session", autouse=True)
def db() -> Generator[Session, None, None]:
    run_test_migrations()
    with TestingSessionLocal() as session:
        session.execute(delete(IntegrationCredential))
        session.execute(delete(Integration))
        session.execute(delete(SystemRunStep))
        session.execute(delete(SystemRun))
        session.execute(delete(LegacyImportJob))
        session.execute(delete(Obligation))
        session.execute(delete(CategoryDataRecord))
        session.execute(delete(CategoryDataSchema))
        session.execute(delete(Category))
        session.execute(delete(CategoryGroup))
        session.execute(delete(LedgerMembership))
        session.execute(delete(Ledger))
        session.execute(delete(User))
        session.commit()
        init_db(session)
        yield session
        session.execute(delete(IntegrationCredential))
        session.execute(delete(Integration))
        session.execute(delete(SystemRunStep))
        session.execute(delete(SystemRun))
        session.execute(delete(LegacyImportJob))
        session.execute(delete(Obligation))
        session.execute(delete(CategoryDataRecord))
        session.execute(delete(CategoryDataSchema))
        session.execute(delete(Category))
        session.execute(delete(CategoryGroup))
        session.execute(delete(LedgerMembership))
        session.execute(delete(Ledger))
        statement = delete(User)
        session.execute(statement)
        session.commit()


@pytest.fixture(scope="module")
def client() -> Generator[TestClient, None, None]:
    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


@pytest.fixture(scope="module")
def superuser_token_headers(client: TestClient, db: Session) -> dict[str, str]:
    _ = db
    return get_superuser_token_headers(client)


@pytest.fixture(scope="module")
def normal_user_token_headers(client: TestClient, db: Session) -> dict[str, str]:
    return authentication_token_from_email(
        client=client, email=settings.EMAIL_TEST_USER, db=db
    )
