from sqlalchemy import (
    Boolean, Column, DateTime, Float, ForeignKey, 
    Integer, String, Text, JSON, func
)
from sqlalchemy.orm import relationship, Session
import datetime
from typing import Dict, Any, Optional, List

from app.database.mixins import Model, generate_uuid

class UserStreamingProgress(Model):
    """SQLAlchemy model for tracking user streaming progress."""
    __tablename__ = "user_streaming_progress"
    
    id = Column(String, primary_key=True, default=generate_uuid)
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    torrent_id = Column(String, ForeignKey("torrents.id", ondelete="CASCADE"), nullable=False, index=True)
    movie_id = Column(String, nullable=False, index=True)  # To track progress even if torrent changes
    
    # Progress information
    current_time = Column(Float, nullable=False, default=0.0)  # Seconds into the video
    duration = Column(Float, nullable=True)  # Total duration in seconds
    percentage = Column(Float, nullable=False, default=0.0)  # Progress percentage
    completed = Column(Boolean, nullable=False, default=False)  # Whether the user has finished watching
    
    # Additional metadata
    last_watched_at = Column(DateTime, nullable=False, default=datetime.datetime.now(datetime.timezone.utc))
    
    # Relationships
    user = relationship("User", back_populates="streaming_progress")
    torrent = relationship("Torrent", back_populates="streaming_progress")
    
    @classmethod
    def get_by_torrent_and_user(cls, db: Session, torrent_id: str, user_id: str) -> Optional["UserStreamingProgress"]:
        """Get a user's streaming progress for a specific torrent."""
        return db.query(cls).filter(
            cls.torrent_id == torrent_id,
            cls.user_id == user_id
        ).order_by(cls.last_watched_at.desc()).first()
    
    @classmethod
    def get_by_movie_and_user(cls, db: Session, movie_id: str, user_id: str) -> Optional["UserStreamingProgress"]:
        """Get a user's streaming progress for a movie (regardless of torrent)."""
        return db.query(cls).filter(
            cls.movie_id == movie_id,
            cls.user_id == user_id
        ).order_by(cls.last_watched_at.desc()).first()
    
    @classmethod
    def get_recent_for_user(cls, db: Session, user_id: str, limit: int = 10) -> List["UserStreamingProgress"]:
        """Get a user's recent streaming progress entries."""
        return db.query(cls).filter(
            cls.user_id == user_id
        ).order_by(cls.last_watched_at.desc()).limit(limit).all()
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert model instance to dictionary."""
        base_dict = super().to_dict()
        # Format timestamps for easier frontend consumption
        base_dict["last_watched_at"] = self.last_watched_at.isoformat() if self.last_watched_at else None
        return base_dict