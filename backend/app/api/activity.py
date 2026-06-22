# app/api/activity.py
"""Activity endpoint: returns a count of active downloads + aggregate progress.

Active states are any torrent not yet finished/seeded/stopped/errored:
  queued, checking, downloading_metadata, downloading, allocating.
Paused torrents are excluded — a user-paused torrent should not keep the
nav badge lit.  We query the DB rather than torrent_manager.active_torrents
so this works even before the background update task fires.
"""
from fastapi import APIRouter, Depends
from typing import Annotated
from sqlalchemy.orm import Session

from app.database.session import get_db
from app.database.models import Torrent as DbTorrent
from app.models import ActivityCountResponse
from app.config import settings

router = APIRouter()

# States that count as "active" for the activity badge.
# "paused" is intentionally excluded: a user-paused torrent should not
# keep the nav badge lit.
ACTIVE_STATES = {
    "queued",
    "checking",
    "downloading_metadata",
    "downloading",
    "allocating",
}


@router.get("/count", response_model=ActivityCountResponse)
async def get_activity_count(
    db: Annotated[Session, Depends(get_db)],
):
    """Return the number of active downloads and their mean progress."""
    with db as session:
        rows = (
            session.query(DbTorrent.progress)
            .filter(DbTorrent.state.in_(ACTIVE_STATES))
            .all()
        )

    count = len(rows)
    if count == 0:
        aggregate = 0.0
    else:
        aggregate = sum(r.progress or 0.0 for r in rows) / count

    return ActivityCountResponse(
        active_downloads=count,
        aggregate_progress=round(aggregate, 2),
        max_active_downloads=settings.effective_max_active_downloads(),
    )
