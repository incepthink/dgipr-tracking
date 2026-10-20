from __future__ import annotations

from contextlib import contextmanager
from typing import Iterator

from sqlalchemy import create_engine, event
from sqlalchemy.engine import Engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker


class Base(DeclarativeBase):
    pass


def make_engine(url: str) -> Engine:
    connect_args = {"check_same_thread": False, "timeout": 30} if url.startswith("sqlite") else {}
    engine = create_engine(url, connect_args=connect_args, future=True)
    if url.startswith("sqlite"):
        @event.listens_for(engine, "connect")
        def _sqlite_pragmas(dbapi_conn, _):  # noqa: ANN001
            cur = dbapi_conn.cursor()
            if ":memory:" not in url:
                cur.execute("PRAGMA journal_mode=WAL")
            cur.execute("PRAGMA foreign_keys=ON")
            cur.execute("PRAGMA busy_timeout=30000")
            cur.close()
    return engine


def make_session_factory(engine: Engine) -> sessionmaker[Session]:
    return sessionmaker(bind=engine, expire_on_commit=False, future=True)


def init_db(engine: Engine) -> None:
    from app import models  # noqa: F401  (register tables)
    Base.metadata.create_all(engine)
    _allow_reports_without_campaign(engine)


def _allow_reports_without_campaign(engine: Engine) -> None:
    """Older databases created manual_inputs / report_snapshots with campaign_id NOT NULL; the search term is now
    optional, so relax it. SQLite can't drop NOT NULL in place, so the table is rebuilt (data copied as-is)."""
    from sqlalchemy import inspect, text
    insp = inspect(engine)
    for table in ("manual_inputs", "report_snapshots"):
        col = next((c for c in insp.get_columns(table) if c["name"] == "campaign_id"), None)
        if not col or col["nullable"]:
            continue
        if engine.dialect.name != "sqlite":
            with engine.begin() as conn:
                conn.execute(text(f"ALTER TABLE {table} ALTER COLUMN campaign_id DROP NOT NULL"))
            continue
        cols = ", ".join(c["name"] for c in insp.get_columns(table))
        with engine.connect() as conn:
            conn.exec_driver_sql("PRAGMA foreign_keys=OFF")
            conn.exec_driver_sql(f"ALTER TABLE {table} RENAME TO _old_{table}")
            Base.metadata.tables[table].create(conn)
            conn.exec_driver_sql(f"INSERT INTO {table} ({cols}) SELECT {cols} FROM _old_{table}")
            conn.exec_driver_sql(f"DROP TABLE _old_{table}")
            conn.commit()
            conn.exec_driver_sql("PRAGMA foreign_keys=ON")
            conn.commit()


@contextmanager
def session_scope(factory: sessionmaker[Session]) -> Iterator[Session]:
    session = factory()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()
