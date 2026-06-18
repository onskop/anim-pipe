"""Database engine + session helpers (SQLAlchemy 2.0, SQLite)."""
from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager

from sqlalchemy import create_engine, inspect, select, text
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


def migrate() -> None:
    """Idempotent, Alembic-free migrations for the local SQLite DB.

    create_all() adds new *tables* but never new *columns*, so we ALTER in the
    `graph_id` columns on pre-existing installs, then backfill a default Graph
    per project and assign its orphaned nodes/edges to it. Safe to run on every
    boot and on a fresh DB (where the columns already exist)."""
    from .models import Edge, Graph, Node, Project

    insp = inspect(engine)
    with engine.begin() as conn:
        for table in ("nodes", "edges"):
            cols = {c["name"] for c in insp.get_columns(table)}
            if "graph_id" not in cols:
                conn.execute(text(f"ALTER TABLE {table} ADD COLUMN graph_id VARCHAR(32)"))

    with session_scope() as s:
        for p in s.execute(select(Project)).scalars().all():
            orphan_nodes = s.execute(
                select(Node).where(Node.project_id == p.id, Node.graph_id.is_(None))
            ).scalars().all()
            orphan_edges = s.execute(
                select(Edge).where(Edge.project_id == p.id, Edge.graph_id.is_(None))
            ).scalars().all()
            if not orphan_nodes and not orphan_edges:
                continue
            g = s.execute(select(Graph).where(Graph.project_id == p.id)).scalars().first()
            if g is None:
                g = Graph(project_id=p.id, name="Main")
                s.add(g)
                s.flush()
            for nd in orphan_nodes:
                nd.graph_id = g.id
            for ed in orphan_edges:
                ed.graph_id = g.id


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
