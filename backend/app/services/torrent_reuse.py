"""Which existing download already answers a Play press (spec 2026-11-06 section 3.2).

``POST /torrents/download`` reuses a row instead of starting a second copy, and
``GET /torrents/for-title`` tells the television which rows it may play. Both go through
:func:`covers_title` and :func:`pack_contains`, so the TV's "ready" answer and the server's
reuse never disagree about a season pack.
"""
from datetime import datetime
from typing import Optional

from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.database.models import Torrent
from app.torrent.states import ACTIVE_DOWNLOAD_STATES, COMPLETE_STATES

#: Never reused: a failed download, or one the content guard refused.
UNREUSABLE_STATES = ("error", "blocked")


def covers_title(row, *, tmdb_id: int, media_type: str,
                 season: Optional[int], episode: Optional[int]) -> bool:
    """Does ``row`` cover the title? The rule of ``covers()`` in the TV's ``_data/title.ts``.

    ``tmdb_id`` and ``media_type`` must both agree, and a NULL ``media_type`` never matches.
    A movie row carries no season or episode. A row with ``season: N, episode: NULL`` is a
    season pack, which covers any episode of season N and is the only thing that covers
    the season itself.
    """
    if row.tmdb_id != tmdb_id or row.media_type != media_type:
        return False
    if media_type == "movie":
        return row.season is None and row.episode is None
    if season is None:
        return True
    if row.season != season:
        return False
    if episode is None:
        return row.episode is None
    return row.episode is None or row.episode == episode


def _matches(entry, season: Optional[int], episode: Optional[int]) -> bool:
    return (isinstance(entry, dict)
            and entry.get("season") == season and entry.get("episode") == episode)


def pack_contains(row, season: Optional[int], episode: Optional[int]) -> bool:
    """Does a pack answering an episode request actually hold that episode?

    Judges only a pack (``row.episode is None``) asked for an episode; anything else is
    True. A NULL ``precomputed_episodes`` means the metadata is not in yet, so the episode
    is assumed present. An empty ``{}`` is metadata that lists no such episode: missing.
    """
    if row.episode is not None or episode is None:
        return True
    episodes = row.precomputed_episodes
    if episodes is None:
        return True
    if not isinstance(episodes, dict):
        return False
    return any(_matches(v, season, episode) for v in episodes.values())


def pack_file_index(row, season: Optional[int], episode: Optional[int]) -> Optional[int]:
    """The libtorrent file index of the requested episode inside a pack, or None.

    None unless ``row`` is a pack with a known episode map and an episode was asked for,
    and None for zero or several matches: a sample or repack parsing to the same episode
    is ambiguous, the same refusal as ``TorrentManager._completed_pack_file``.
    """
    if row.episode is not None or episode is None:
        return None
    episodes = row.precomputed_episodes
    if not isinstance(episodes, dict):
        return None
    keys = [k for k, v in episodes.items() if _matches(v, season, episode)]
    if len(keys) != 1:
        return None
    try:
        return int(keys[0])
    except (TypeError, ValueError):
        return None


def _rank(row) -> int:
    if row.state in COMPLETE_STATES:
        return 0
    if row.state in ACTIVE_DOWNLOAD_STATES:
        return 1
    return 2


def _preference(row):
    # Ready first, then downloading, then the rest; newest added_at first (NULL last);
    # id ascending as the final tie-break so the answer never depends on insert order.
    added = row.added_at
    age = -(added - datetime.min).total_seconds() if added is not None else 0.0
    return (_rank(row), added is None, age, row.id)


def find_reusable(session: Session, *, tmdb_id: int, media_type: str,
                  season: Optional[int], episode: Optional[int],
                  quality: str) -> Optional[Torrent]:
    """The best existing download for this title at this quality, or None.

    A row matches on its release's own ``quality`` or on the ``requested_quality`` it was
    started for, so a 1080p request answered by a 720p release is reused by the next 1080p
    press instead of adding the same torrent again. Legacy rows hold NULL there and match
    on ``quality`` alone.

    Never a row in ``error`` or ``blocked``. Ownership is not considered: a member's Play
    may reuse the owner's download (the row keeps its ``account_id``).
    """
    rows = (
        session.query(Torrent)
        .filter(
            Torrent.tmdb_id == tmdb_id,
            Torrent.media_type == media_type,
            or_(Torrent.quality == quality, Torrent.requested_quality == quality),
            Torrent.state.notin_(UNREUSABLE_STATES),
        )
        .all()
    )
    kept = [
        r for r in rows
        if covers_title(r, tmdb_id=tmdb_id, media_type=media_type,
                        season=season, episode=episode)
        and pack_contains(r, season, episode)
    ]
    if not kept:
        return None
    return min(kept, key=_preference)
