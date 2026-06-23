from sqlalchemy import (
    Column, DateTime, Float, ForeignKey, Integer, String, UniqueConstraint, func
)
from sqlalchemy.orm import relationship, Session
import datetime
from typing import List, Optional

from app.database.mixins import Model, generate_uuid


class UserWatchlist(Model):
    """SQLAlchemy model for tracking items a user has saved to My List."""
    __tablename__ = "user_watchlist"

    # DB-level deduplication backstop (note: sync_columns won't add this
    # constraint to already-provisioned databases — only fresh installs).
    __table_args__ = (
        UniqueConstraint("user_id", "content_id", name="uq_watchlist_user_content"),
    )

    id = Column(String, primary_key=True, default=generate_uuid)
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)

    # content_id mirrors the format used in UserStreamingProgress.movie_id:
    #   movie:{tmdb_id}  |  tv:{tmdb_id}  (show-level, no season/episode)
    content_id = Column(String, nullable=False, index=True)

    # Denormalised for quick rendering without a TMDB lookup
    tmdb_id = Column(String, nullable=False)
    media_type = Column(String, nullable=False)   # "movie" | "tv"
    title = Column(String, nullable=True)

    # Denormalised display metadata (nullable; legacy rows backfilled lazily
    # via WatchlistContext auto-heal). sync_columns adds these on startup.
    poster_url = Column(String, nullable=True)
    year = Column(Integer, nullable=True)
    vote_average = Column(Float, nullable=True)

    added_at = Column(
        DateTime,
        nullable=False,
        default=lambda: datetime.datetime.now(datetime.timezone.utc),
    )

    # Relationships
    user = relationship("User", back_populates="watchlist")

    @classmethod
    def get_for_user(
        cls, db: Session, user_id: str, limit: int = 200
    ) -> List["UserWatchlist"]:
        """Return a user's watchlist entries, newest first.

        Ties broken by id descending for a stable insertion-order fallback.
        """
        return (
            db.query(cls)
            .filter(cls.user_id == user_id)
            .order_by(cls.added_at.desc(), cls.id.desc())
            .limit(limit)
            .all()
        )

    @classmethod
    def find(
        cls, db: Session, user_id: str, content_id: str
    ) -> Optional["UserWatchlist"]:
        """Find a specific entry by (user_id, content_id)."""
        return (
            db.query(cls)
            .filter(cls.user_id == user_id, cls.content_id == content_id)
            .first()
        )
