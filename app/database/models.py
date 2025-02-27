from sqlalchemy import (
    Boolean, Column, DateTime, Float, ForeignKey, 
    Integer, String, Text, JSON, func
)
from sqlalchemy.orm import relationship
import datetime
import uuid

from app.database.session import Base


def generate_uuid():
    """Generate a UUID string for primary keys."""
    return str(uuid.uuid4())


class Torrent(Base):
    """SQLAlchemy model for torrent entries."""
    __tablename__ = "torrents"
    
    id = Column(String, primary_key=True, default=generate_uuid)
    movie_title = Column(String, nullable=False, index=True)
    quality = Column(String, nullable=False)
    magnet = Column(Text, nullable=False)
    url = Column(String, nullable=False)
    save_path = Column(String, nullable=False)
    sizes = Column(JSON, nullable=True)
    
    # Status information
    state = Column(String, nullable=False, default="queued")
    progress = Column(Float, nullable=False, default=0.0)
    error_message = Column(String, nullable=True)
    
    # Resume data for restarting torrents
    resume_data = Column(Text, nullable=True)
    
    # Additional metadata - renamed from 'metadata' to 'meta_data'
    meta_data = Column(JSON, nullable=True)
    
    # Timestamps
    created_at = Column(DateTime, nullable=False, default=datetime.datetime.now(datetime.timezone.utc))
    updated_at = Column(DateTime, nullable=False, default=datetime.datetime.now(datetime.timezone.utc), onupdate=datetime.datetime.now(datetime.timezone.utc))
    
    # Relationships
    download_logs = relationship("TorrentLog", back_populates="torrent", cascade="all, delete-orphan")


class TorrentLog(Base):
    """SQLAlchemy model for logging torrent download progress and events."""
    __tablename__ = "torrent_logs"
    
    id = Column(String, primary_key=True, default=generate_uuid)
    torrent_id = Column(String, ForeignKey("torrents.id", ondelete="CASCADE"), nullable=False)
    timestamp = Column(DateTime, nullable=False, default=datetime.datetime.now(datetime.timezone.utc))
    message = Column(Text, nullable=False)
    level = Column(String, nullable=False, default="INFO")
    
    # Status at time of log
    state = Column(String, nullable=True)
    progress = Column(Float, nullable=True)
    download_rate = Column(Float, nullable=True)  # kB/s
    
    # Relationship
    torrent = relationship("Torrent", back_populates="download_logs")


class Schedule(Base):
    """SQLAlchemy model for scheduled download jobs."""
    __tablename__ = "schedules"
    
    id = Column(String, primary_key=True, default=generate_uuid)
    name = Column(String, nullable=True)
    cron_expression = Column(String, nullable=False)
    search_params = Column(JSON, nullable=False)
    quality = Column(String, nullable=False)
    max_downloads = Column(Integer, nullable=False, default=1)
    enabled = Column(Boolean, nullable=False, default=True)
    
    # Execution information
    last_run = Column(DateTime, nullable=True)
    next_run = Column(DateTime, nullable=False)
    last_run_status = Column(String, nullable=True)
    
    # Timestamps
    created_at = Column(DateTime, nullable=False, default=datetime.datetime.now(datetime.timezone.utc))
    updated_at = Column(DateTime, nullable=False, default=datetime.datetime.now(datetime.timezone.utc), onupdate=datetime.datetime.now(datetime.timezone.utc))
    
    # Relationships
    execution_logs = relationship("ScheduleLog", back_populates="schedule", cascade="all, delete-orphan")


class ScheduleLog(Base):
    """SQLAlchemy model for logging schedule executions."""
    __tablename__ = "schedule_logs"
    
    id = Column(String, primary_key=True, default=generate_uuid)
    schedule_id = Column(String, ForeignKey("schedules.id", ondelete="CASCADE"), nullable=False)
    execution_time = Column(DateTime, nullable=False, default=datetime.datetime.now(datetime.timezone.utc))
    status = Column(String, nullable=False)
    message = Column(Text, nullable=True)
    results = Column(JSON, nullable=True)  # Store results like number of movies found, downloaded, etc.
    
    # Relationship
    schedule = relationship("Schedule", back_populates="execution_logs")


class MovieCache(Base):
    """SQLAlchemy model for caching movie information."""
    __tablename__ = "movie_cache"
    
    id = Column(String, primary_key=True, default=generate_uuid)
    title = Column(String, nullable=False, index=True)
    year = Column(Integer, nullable=False)
    link = Column(String, nullable=False, unique=True)
    rating = Column(String, nullable=False)
    genre = Column(String, nullable=False)
    img = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    
    # Cache the available torrents
    torrents_json = Column(JSON, nullable=False)
    
    # Cache control
    fetched_at = Column(DateTime, nullable=False, default=datetime.datetime.now(datetime.timezone.utc))
    expires_at = Column(DateTime, nullable=False)
    
    # Timestamps
    created_at = Column(DateTime, nullable=False, default=datetime.datetime.now(datetime.timezone.utc))
    updated_at = Column(DateTime, nullable=False, default=datetime.datetime.now(datetime.timezone.utc), onupdate=datetime.datetime.now(datetime.timezone.utc))


class Setting(Base):
    """SQLAlchemy model for application settings."""
    __tablename__ = "settings"
    
    key = Column(String, primary_key=True)
    value = Column(JSON, nullable=False)
    description = Column(String, nullable=True)
    updated_at = Column(DateTime, nullable=False, default=datetime.datetime.now(datetime.timezone.utc), onupdate=datetime.datetime.now(datetime.timezone.utc))