from sqlalchemy import (
    Boolean, Column, DateTime, Float, ForeignKey, 
    Integer, String, Text, JSON, func
)
from sqlalchemy.orm import relationship, Session
import datetime
from typing import Dict, Any, Optional, List

from app.database.mixins import Model, generate_uuid
from app.models import TorrentStatus, TorrentState, ScheduleResponse, ScheduleConfig, SearchParams


class User(Model):
    """SQLAlchemy model for application users."""
    __tablename__ = "users"
    
    id = Column(String, primary_key=True, default=generate_uuid)
    username = Column(String, nullable=False, unique=True, index=True)
    display_name = Column(String, nullable=False)
    avatar = Column(String, nullable=True)  # Store path to avatar image
    
    # User settings
    settings = relationship("UserSettings", uselist=False, back_populates="user", cascade="all, delete-orphan", lazy="selectin")
    
    # User relationships
    downloads = relationship("Torrent", back_populates="user")
    schedules = relationship("Schedule", back_populates="user")
    
    # Create a user with default settings
    @classmethod
    def create_with_settings(cls, db: Session, **kwargs) -> "User":
        """Create a new user with default settings."""
        user = cls(**kwargs)
        settings = UserSettings(user=user)  # Create default settings
        db.add(user)
        db.add(settings)
        db.commit()
        db.refresh(user)
        return user


class UserSettings(Model):
    """SQLAlchemy model for user settings."""
    __tablename__ = "user_settings"
    
    id = Column(String, primary_key=True, default=generate_uuid)
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    
    # Content restrictions
    maturity_restriction = Column(String, nullable=False, default="none")  # none, pg, pg13, r
    require_passcode = Column(Boolean, nullable=False, default=False)
    passcode = Column(String, nullable=True)  # Hashed passcode if enabled
    
    # Theme preferences
    theme = Column(String, nullable=False, default="dark")  # dark, light
    
    # Download preferences
    default_quality = Column(String, nullable=False, default="1080p")
    download_path = Column(String, nullable=True)
    
    # Relationship
    user = relationship("User", back_populates="settings")