"""Database engine + session helpers (SQLAlchemy 2.0, SQLite)."""
from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from .config import get_settings

_settings = get_settings()
engine = create_engine(
    _settings.resolved_db_url,
    connect_args={"check_same_thread": False},
    future=True,
)
SessionLocal = sessionmaker(bind=engine, expire_on_commit=False, future=True)


def init_db() -> None:
    from . import models  # noqa: F401  (register mappers)

    models.Base.metadata.create_all(engine)


@contextmanager
def session_scope() -> Iterator[Session]:
    """Transactional session for background workers / scripts."""
    session = SessionLocal()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def get_db() -> Iterator[Session]:
    """FastAPI dependency."""
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()
