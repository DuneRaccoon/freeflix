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
    """SQLAlchemy model for a viewing PROFILE.

    The table is still called ``users`` and the class is still ``User``: five FK
    constraints across four tables point at ``users.id`` and the project has no
    migration framework that can rename a table. Since the instance-claim work this
    row means "a profile", owned by an :class:`~app.database.models.accounts.Account`.
    The API and the UI call it a profile; only the storage layer says ``user``.
    """
    __tablename__ = "users"

    id = Column(String, primary_key=True, default=generate_uuid)
    username = Column(String, nullable=False, unique=True, index=True)
    display_name = Column(String, nullable=False)
    avatar = Column(String, nullable=True)  # Store path to avatar image

    # Owning account. Nullable so sync_columns() can ADD COLUMN it to already-provisioned
    # databases (it cannot emit NOT NULL, a default, an index or a FK on an existing
    # table — see sync_auth_schema() for the index/FK, and migrate_users_to_accounts()
    # for the backfill). NULL means "not yet migrated", never "public".
    account_id = Column(
        String, ForeignKey("accounts.id", ondelete="CASCADE"), nullable=True, index=True
    )
    account = relationship("Account", back_populates="profiles")

    # User settings
    settings = relationship("UserSettings", uselist=False, back_populates="user", cascade="all, delete-orphan", lazy="selectin")
    
    # User relationships
    downloads = relationship("Torrent", back_populates="user")
    schedules = relationship("Schedule", back_populates="user")
    streaming_progress = relationship("UserStreamingProgress", back_populates="user", cascade="all, delete-orphan")
    watchlist = relationship("UserWatchlist", back_populates="user", cascade="all, delete-orphan")
    
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

    # DEPRECATED — this column held the passcode in PLAINTEXT and was leaked to every
    # caller through UserResponse.settings. It is never read or written again; the
    # migration hashes any surviving value into passcode_hash and blanks it. It cannot
    # be dropped because sync_columns() is additive-only.
    passcode = Column(String, nullable=True)
    # pbkdf2_sha256$<iterations>$<salt_b64>$<hash_b64>. Never leaves the server.
    passcode_hash = Column(String, nullable=True)
    # Digit count, so the keypad knows how many dots to draw without seeing the code.
    passcode_len = Column(Integer, nullable=True)

    # Theme preferences
    theme = Column(String, nullable=False, default="dark")  # dark, light
    
    # Download preferences
    default_quality = Column(String, nullable=False, default="1080p")
    download_path = Column(String, nullable=True)

    # Playback preferences.
    #
    # NULLABLE WITH NO SERVER DEFAULT, and that is forced rather than chosen: there is no
    # migration framework here, so this column reaches an already-provisioned database
    # through ``sync_columns()``, which can only emit a bare ``ALTER TABLE ... ADD COLUMN``
    # — no NOT NULL, no DEFAULT, no backfill. Every existing row therefore reads NULL.
    #
    # So NULL means "never chosen" and the FEATURE IS ON for it: the read path is
    # ``auto_next_episode is not False`` (``api/users.py``), never ``bool(...)``, which
    # would turn every pre-existing profile's unset column into an opt-out nobody asked
    # for.
    #
    # AND NO ``default=True`` EITHER, which is the shape this started as. A Python-side
    # default fires whenever the attribute is None at flush — including when a caller
    # assigns None explicitly — so with one, NEW rows store True while MIGRATED rows hold
    # NULL, and the default-on rule has two implementations that can disagree. Without
    # one there is a single rule: the column is NULL until somebody turns the feature off,
    # and only an explicit False is an opt-out. (It also makes the migrated state
    # constructible in a test, which with the default it was not — measured: the row
    # asserting NULL came back True.)
    auto_next_episode = Column(Boolean, nullable=True)
    
    # Relationship
    user = relationship("User", back_populates="settings")