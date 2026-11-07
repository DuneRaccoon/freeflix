"""Lifecycle clock helpers for the ``torrents`` table.

Every timestamp written here is naive UTC, matching the plain ``DateTime`` columns.
"""
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.database.models import Torrent


def utcnow() -> datetime:
    """Naive UTC now."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


def touch_torrent(session: Session, torrent_id: str, now: datetime) -> None:
    """Stamp ``last_touched_at`` on one row. Does not commit; a missing id is a no-op."""
    session.query(Torrent).filter(Torrent.id == torrent_id).update(
        {Torrent.last_touched_at: now}, synchronize_session=False
    )


def mark_finished(row: Torrent, now: datetime) -> None:
    """Stamp ``finished_at`` (and ``last_touched_at``) the first time a row completes."""
    if row.finished_at is None:
        row.finished_at = now
        row.last_touched_at = now
