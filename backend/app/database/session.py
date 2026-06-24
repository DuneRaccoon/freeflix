from sqlalchemy import create_engine, inspect as sa_inspect, text
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, Session
from contextlib import contextmanager
from pathlib import Path
from loguru import logger
import os
import functools
import asyncio
import threading

from app.config import settings

# Create the database directory if it doesn't exist
settings.db_path.parent.mkdir(parents=True, exist_ok=True)

# Create SQLAlchemy engine based on environment
if settings.postgres_host and settings.postgres_user:
    try:
        # Build connection string for PostgreSQL without asyncpg
        if settings.postgres_dsn:
            # Ensure we're not using asyncpg
            connection_string = str(settings.postgres_dsn)
            if 'asyncpg' in connection_string:
                connection_string = connection_string.replace('postgresql+asyncpg', 'postgresql')
        else:
            # Manually build connection string
            db_name = settings.postgres_db or 'postgres'
            port = settings.postgres_port or 5432
            connection_string = f"postgresql://{settings.postgres_user}"
            if settings.postgres_password:
                connection_string += f":{settings.postgres_password}"
            connection_string += f"@{settings.postgres_host}:{port}/{db_name}"
        
        logger.info(f"Using PostgreSQL database at {connection_string.split('@')[0]}@********")
        engine = create_engine(connection_string, pool_pre_ping=True, pool_size=10, max_overflow=5)
    except Exception as e:
        logger.error(f"Failed to connect to PostgreSQL: {e}")
        # Fall back to SQLite
        logger.warning("Falling back to SQLite database")
        SQLALCHEMY_DATABASE_URL = f"sqlite:///{settings.db_path}"
        engine = create_engine(
            SQLALCHEMY_DATABASE_URL,
            connect_args={"check_same_thread": False},  # Needed for SQLite
            pool_pre_ping=True
        )
else:
    # SQLite connection for local development
    SQLALCHEMY_DATABASE_URL = f"sqlite:///{settings.db_path}"
    logger.info(f"Using SQLite database at {settings.db_path}")
    
    engine = create_engine(
        SQLALCHEMY_DATABASE_URL, 
        connect_args={"check_same_thread": False},  # Needed for SQLite
        pool_pre_ping=True  # Check connection validity before using
    )

# Create sessionmaker
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Base class for SQLAlchemy models
Base = declarative_base()

# Thread-local storage for session tracking
_thread_local = threading.local()

@contextmanager
def get_db():
    """
    Provide a transactional scope around a series of operations.
    
    Usage:
        with get_db() as db:
            # Use the database session
            db.query(Model).filter(...).all()
            
            # If no exception occurs, commit happens automatically
            # If an exception occurs, rollback happens automatically
    """
    session = SessionLocal()
    # Store the session in thread local storage
    if not hasattr(_thread_local, 'sessions'):
        _thread_local.sessions = set()
    _thread_local.sessions.add(session)
    
    try:
        yield session
        # Commit only if no exception occurred and if the session is still active
        if session.is_active:
            try:
                session.commit()
            except Exception as commit_error:
                logger.error(f"Error committing database session: {commit_error}")
                session.rollback()
                raise
    except Exception as e:
        # Only rollback if the session is still active
        if session.is_active:
            session.rollback()
        logger.error(f"Database error: {e}")
        raise
    finally:
        # Always close the session
        session.close()
        # Remove from thread local tracking
        if hasattr(_thread_local, 'sessions'):
            _thread_local.sessions.discard(session)

# Helper to safely close any sessions in the current thread
def close_thread_sessions():
    """Close any open sessions in the current thread"""
    if hasattr(_thread_local, 'sessions'):
        for session in list(_thread_local.sessions):
            try:
                if session.is_active:
                    session.rollback()
                session.close()
            except Exception as e:
                logger.error(f"Error closing session: {e}")
        _thread_local.sessions.clear()

def sync_columns(engine_, tables=None):
    """Lightweight additive migration: add any model columns missing from already-existing
    tables.

    ``create_all`` only creates tables that don't yet exist — it never alters an existing
    table. With no migration framework in the project, columns added to a model after a table
    was first created would otherwise be invisible to the database, causing runtime errors on
    any query that touches them. This bridges that gap by issuing ``ALTER TABLE ... ADD COLUMN``
    for each missing column.

    It only ever ADDs columns (never drops or alters), so it is safe to run on every startup
    and is idempotent. Brand-new tables are skipped here — ``create_all`` handles those.
    """
    if tables is None:
        tables = Base.metadata.sorted_tables

    inspector = sa_inspect(engine_)
    existing_tables = set(inspector.get_table_names())

    for table in tables:
        if table.name not in existing_tables:
            continue  # create_all will/has created the whole table with all columns
        existing_cols = {c["name"] for c in inspector.get_columns(table.name)}
        for column in table.columns:
            if column.name in existing_cols:
                continue
            try:
                col_type = column.type.compile(dialect=engine_.dialect)
                with engine_.begin() as conn:
                    conn.execute(text(
                        f'ALTER TABLE {table.name} ADD COLUMN {column.name} {col_type}'
                    ))
                logger.info(f"Added missing column {table.name}.{column.name} ({col_type})")
            except Exception as e:
                logger.warning(f"Could not add column {table.name}.{column.name}: {e}")

def sync_indexes(engine_):
    """Idempotent, additive index creation that sync_columns cannot perform.

    ``sync_columns`` only ADDs columns; it can never create an index or a unique
    constraint. With no migration framework, a unique index on an existing table must
    be created defensively here. Before creating the UNIQUE index on
    ``user_streaming_progress (user_id, movie_id)`` we DEDUPLICATE any pre-existing
    duplicate rows (keeping the latest ``last_watched_at`` per pair, ties broken by id),
    otherwise the CREATE UNIQUE INDEX would fail on a dirty table. Valid on both
    PostgreSQL and SQLite; safe to run on every startup.
    """
    table = "user_streaming_progress"
    inspector = sa_inspect(engine_)
    if table not in set(inspector.get_table_names()):
        return  # create_all will create it fresh (with the declarative UniqueConstraint)

    try:
        with engine_.begin() as conn:
            # Delete every row that is NOT the surviving (latest) row for its
            # (user_id, movie_id). Survivor = max last_watched_at, tie-break max id.
            # Correlated NOT EXISTS works identically on Postgres and SQLite.
            conn.execute(text(
                f"""
                DELETE FROM {table} AS p
                WHERE EXISTS (
                    SELECT 1 FROM {table} AS q
                    WHERE q.user_id = p.user_id
                      AND q.movie_id = p.movie_id
                      AND (
                          q.last_watched_at > p.last_watched_at
                          OR (q.last_watched_at = p.last_watched_at AND q.id > p.id)
                      )
                )
                """
            ))
    except Exception as e:
        # SQLite older syntax does not accept the "AS p" table alias in DELETE.
        # Retry without the alias (Postgres accepts both; this form is portable).
        logger.warning(f"Aliased dedup DELETE failed ({e}); retrying unaliased")
        with engine_.begin() as conn:
            conn.execute(text(
                f"""
                DELETE FROM {table}
                WHERE EXISTS (
                    SELECT 1 FROM {table} AS q
                    WHERE q.user_id = {table}.user_id
                      AND q.movie_id = {table}.movie_id
                      AND (
                          q.last_watched_at > {table}.last_watched_at
                          OR (q.last_watched_at = {table}.last_watched_at
                              AND q.id > {table}.id)
                      )
                )
                """
            ))

    try:
        with engine_.begin() as conn:
            conn.execute(text(
                f"CREATE UNIQUE INDEX IF NOT EXISTS uq_user_movie_progress "
                f"ON {table} (user_id, movie_id)"
            ))
        logger.info("Ensured unique index uq_user_movie_progress(user_id, movie_id)")
    except Exception as e:
        logger.warning(f"Could not create unique index uq_user_movie_progress: {e}")


def init_db():
    """Initialize the database tables."""
    Base.metadata.create_all(bind=engine)
    # Apply additive column migrations for tables that pre-date newer model columns.
    sync_columns(engine)
    # Create indexes/unique constraints that sync_columns cannot (dedup-then-create).
    sync_indexes(engine)
    logger.info("Database tables created")

# Decorator for safely handling database operations in async functions
def safe_db_operation(func):
    """Decorator to safely handle database operations in async functions"""
    @functools.wraps(func)
    async def wrapper(*args, **kwargs):
        try:
            return await func(*args, **kwargs)
        except Exception as e:
            logger.error(f"Database operation error in {func.__name__}: {e}")
            # Close any open sessions
            close_thread_sessions()
            raise
    return wrapper