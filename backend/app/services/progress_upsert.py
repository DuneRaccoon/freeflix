"""Atomic, dialect-aware upsert for UserStreamingProgress keyed by (user_id, movie_id).

Replaces a read-then-write that raced under concurrent player heartbeats. Relies on the
unique index uq_user_movie_progress(user_id, movie_id) created by sync_indexes().
"""
import datetime
import uuid
from typing import Optional

from sqlalchemy.exc import IntegrityError, OperationalError
from sqlalchemy.orm import Session
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert

from app.database.models import UserStreamingProgress


def upsert_progress(
    session: Session,
    *,
    user_id: str,
    movie_id: str,
    torrent_id: Optional[str],
    current_time: float,
    duration: Optional[float],
    percentage: float,
    completed: bool,
    file_index: Optional[int],
    title: Optional[str],
    content_id: Optional[str],
) -> UserStreamingProgress:
    now = datetime.datetime.now(datetime.timezone.utc)
    values = dict(
        id=str(uuid.uuid4()),
        user_id=user_id,
        movie_id=movie_id,
        torrent_id=torrent_id,
        current_time=current_time,
        duration=duration,
        percentage=percentage,
        completed=completed,
        file_index=file_index,
        title=title,
        content_id=content_id,
        last_watched_at=now,
    )
    update_cols = dict(
        torrent_id=torrent_id,
        current_time=current_time,
        duration=duration,
        percentage=percentage,
        completed=completed,
        file_index=file_index,
        title=title,
        content_id=content_id,
        last_watched_at=now,
    )

    dialect = session.bind.dialect.name
    table = UserStreamingProgress.__table__

    try:
        if dialect == "postgresql":
            stmt = pg_insert(table).values(**values)
            stmt = stmt.on_conflict_do_update(
                index_elements=["user_id", "movie_id"],
                set_=update_cols,
            )
            session.execute(stmt)
        elif dialect == "sqlite":
            stmt = sqlite_insert(table).values(**values)
            stmt = stmt.on_conflict_do_update(
                index_elements=["user_id", "movie_id"],
                set_=update_cols,
            )
            session.execute(stmt)
        else:
            # Generic fallback for any other backend: insert, else update on conflict.
            _fallback_upsert(session, values, update_cols, user_id, movie_id)

        session.flush()

    except (IntegrityError, OperationalError):
        # IntegrityError: unique constraint violated (two concurrent inserts, one loses).
        # OperationalError: SQLite "database is locked" under concurrent writers — same
        # semantic outcome; retry as update on conflict.
        session.rollback()
        _fallback_upsert(session, values, update_cols, user_id, movie_id)
        # Flush the staged insert/update NOW so it is persisted and visible to the
        # re-query below. The re-query runs under no_autoflush, which would otherwise
        # suppress this flush — leaving a freshly-added row invisible to the SELECT and
        # returning None (→ session.refresh(None) → AttributeError in the caller).
        session.flush()

    with session.no_autoflush:
        return (
            session.query(UserStreamingProgress)
            .filter(
                UserStreamingProgress.user_id == user_id,
                UserStreamingProgress.movie_id == movie_id,
            )
            .first()
        )


def _fallback_upsert(session, values, update_cols, user_id, movie_id) -> None:
    """Insert-or-update without dialect-specific SQL.

    Used for non-PG/non-SQLite backends, or as a post-error retry after IntegrityError
    or OperationalError from the primary upsert path.
    """
    with session.no_autoflush:
        existing = (
            session.query(UserStreamingProgress)
            .filter(
                UserStreamingProgress.user_id == user_id,
                UserStreamingProgress.movie_id == movie_id,
            )
            .first()
        )
    if existing:
        for k, v in update_cols.items():
            setattr(existing, k, v)
        session.add(existing)
    else:
        session.add(UserStreamingProgress(**values))
