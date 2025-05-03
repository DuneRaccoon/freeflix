from sqlalchemy import create_engine
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
if settings.postgres_host and settings.postgres_dsn:
    logger.info(f"Using PostgreSQL database at {settings.postgres_dsn}")
    engine = create_engine(str(settings.postgres_dsn), pool_pre_ping=True)
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

def init_db():
    """Initialize the database tables."""
    Base.metadata.create_all(bind=engine)
    logger.info("Database tables created")

# Decorator for safely handling database sessions in async functions
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