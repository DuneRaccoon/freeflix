"""Lifecycle clock helpers for the ``torrents`` table.

Every timestamp written here is naive UTC, matching the plain ``DateTime`` columns.
"""
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.database.models import Torrent
from app.torrent.states import COMPLETE_STATES


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


def stamp_legacy_torrents(session: Session, now: datetime) -> int:
    """Give pre-upgrade rows a full grace period. Does not commit.

    Fills ``added_at`` and ``last_touched_at`` where NULL, and ``finished_at`` where NULL on
    a completed row. Never overwrites a value, so a second call changes nothing.
    Returns the total number of rows changed across the three updates.
    """
    changed = session.query(Torrent).filter(Torrent.added_at.is_(None)).update(
        {Torrent.added_at: now}, synchronize_session=False)
    changed += session.query(Torrent).filter(Torrent.last_touched_at.is_(None)).update(
        {Torrent.last_touched_at: now}, synchronize_session=False)
    changed += session.query(Torrent).filter(
        Torrent.finished_at.is_(None), Torrent.state.in_(COMPLETE_STATES)
    ).update({Torrent.finished_at: now}, synchronize_session=False)
    return changed
