from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, Session
from contextlib import contextmanager
from pathlib import Path
from loguru import logger

from app.config import settings

# Create the database directory if it doesn't exist
settings.db_path.parent.mkdir(parents=True, exist_ok=True)

# Create SQLAlchemy engine
SQLALCHEMY_DATABASE_URL = f"sqlite:///{settings.db_path}"
engine = create_engine(
    SQLALCHEMY_DATABASE_URL, 
    connect_args={"check_same_thread": False}  # Needed for SQLite
)

# Create sessionmaker
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Base class for SQLAlchemy models
Base = declarative_base()

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

def init_db():
    """Initialize the database tables."""
    Base.metadata.create_all(bind=engine)
    logger.info("Database tables created")