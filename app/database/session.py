from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from contextlib import contextmanager
from pathlib import Path
from loguru import logger

from app.config import settings

# Create the database directory if it doesn't exist
settings.DB_PATH.parent.mkdir(parents=True, exist_ok=True)

# Create SQLAlchemy engine
SQLALCHEMY_DATABASE_URL = f"sqlite:///{settings.DB_PATH}"
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
    """Provide a transactional scope around a series of operations."""
    db = SessionLocal()
    try:
        yield db
        db.commit()
    except Exception as e:
        db.rollback()
        logger.error(f"Database error: {e}")
        raise
    finally:
        db.close()

def init_db():
    """Initialize the database tables."""
    Base.metadata.create_all(bind=engine)
    logger.info("Database tables created")
