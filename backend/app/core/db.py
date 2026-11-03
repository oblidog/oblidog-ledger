from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import settings
from app.services.users import ensure_initial_superuser

engine = create_engine(str(settings.SQLALCHEMY_DATABASE_URI), pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine, class_=Session, expire_on_commit=False)


def init_db(session: Session) -> None:
    ensure_initial_superuser(session)
