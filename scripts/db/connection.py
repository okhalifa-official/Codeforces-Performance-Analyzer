"""Shared Postgres connection handling.

Used by both the loader (scripts/db/load.py) and the web request path
(main.py). Railway injects DATABASE_URL; nothing else is required.

The web server spawns a fresh Python process per request (website/server/
server.js), so each process opens its own short-lived connection. Keep the
pool tiny — a large pool per process would exhaust Postgres connections
under concurrency.
"""

import os
import logging

log = logging.getLogger(__name__)

_engine = None


def database_url() -> str | None:
    """DATABASE_URL, normalized for SQLAlchemy.

    Railway hands out postgres:// URLs; SQLAlchemy 2.x wants postgresql://.
    Prefer the private URL when present — it avoids egress charges and is
    faster inside Railway's network.
    """
    url = (os.environ.get("DATABASE_URL_PRIVATE")
           or os.environ.get("DATABASE_URL")
           or "").strip()
    if not url:
        return None
    if url.startswith("postgres://"):
        url = "postgresql://" + url[len("postgres://"):]
    # SQLAlchemy defaults the bare postgresql:// scheme to psycopg2, which is
    # not installed — this project uses psycopg 3. Pin the driver explicitly.
    if url.startswith("postgresql://"):
        url = "postgresql+psycopg://" + url[len("postgresql://"):]
    return url


def use_postgres() -> bool:
    """True when the website should read from Postgres instead of CSVs.

    Gated by an env var so the cutover (and rollback) is a variable flip
    rather than a redeploy.
    """
    if os.environ.get("USE_POSTGRES", "").lower() in ("0", "false", "no"):
        return False
    return database_url() is not None


def get_engine():
    """Lazily built SQLAlchemy engine, cached per process."""
    global _engine
    if _engine is not None:
        return _engine

    url = database_url()
    if not url:
        raise RuntimeError(
            "DATABASE_URL is not set — cannot connect to Postgres. "
            "Set USE_POSTGRES=0 to fall back to the CSV files."
        )

    from sqlalchemy import create_engine
    _engine = create_engine(
        url,
        pool_size=2,          # one process per request; keep this small
        max_overflow=1,
        pool_pre_ping=True,   # transparently replace connections killed server-side
        pool_recycle=1800,
        connect_args={"connect_timeout": 10},
    )
    return _engine


def raw_connection():
    """psycopg connection for COPY-based bulk loading.

    Uses the plain libpq URL: the +psycopg suffix is SQLAlchemy-only syntax
    and psycopg.connect() would reject it.
    """
    import psycopg
    url = database_url()
    if not url:
        raise RuntimeError("DATABASE_URL is not set")
    url = url.replace("postgresql+psycopg://", "postgresql://", 1)
    # keepalives: the runner reaches Railway over a public proxy, and a silently
    # dropped TCP connection would otherwise block a query forever.
    return psycopg.connect(url, connect_timeout=30, keepalives=1,
                           keepalives_idle=30, keepalives_interval=10,
                           keepalives_count=6)
