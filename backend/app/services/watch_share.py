"""Who watched a download, and how much (spec 2026-11-06 sections 3.2 and 4.3).

One number per profile per download, shared by the owner's "Watched by" row and the
autovacuum's watched gate, so the two can never disagree: a profile who finished two of a
season pack's four episodes reads 50% in both places.

Accepted limitation (spec 3.2): ``upsert_progress`` repoints a progress row's
``torrent_id`` to the download being played (``progress_upsert.py:48``), so an older
download loses a viewer who re-played the same title from another one.
"""

from collections import defaultdict
from typing import Dict, Iterable, List, Sequence

from sqlalchemy.orm import Session

from app.database.models import Torrent
from app.database.models.streaming import UserStreamingProgress
from app.database.models.users import User
from app.models import WatchedBy


def _row_percent(row) -> float:
    if row.completed:
        return 100.0
    return max(0.0, min(100.0, float(row.percentage or 0.0)))


def percents_from_rows(torrent: Torrent, rows: Iterable) -> Dict[str, float]:
    """Per-profile watched percent for ``torrent``; profiles at 0 are omitted.

    A season pack (a tv row with no single episode) averages over every episode it holds,
    not over the episodes the profile opened. A movie or single episode is the best row.
    """
    rows = list(rows)
    per_profile: Dict[str, List[float]] = defaultdict(list)
    for row in rows:
        per_profile[row.user_id].append(_row_percent(row))

    is_pack = torrent.media_type == "tv" and torrent.episode is None
    result: Dict[str, float] = {}
    if is_pack:
        episodes = torrent.precomputed_episodes
        if isinstance(episodes, dict) and episodes:
            n = len(episodes)
        else:
            n = len({r.file_index for r in rows if r.file_index is not None}) or 1
        for uid, values in per_profile.items():
            result[uid] = min(100.0, sum(values) / n)
    else:
        for uid, values in per_profile.items():
            result[uid] = max(values)
    return {uid: pct for uid, pct in result.items() if pct > 0}


def profile_percents(session: Session, torrent: Torrent) -> Dict[str, float]:
    rows = (
        session.query(UserStreamingProgress)
        .filter(UserStreamingProgress.torrent_id == torrent.id)
        .all()
    )
    return percents_from_rows(torrent, rows)


def watched_by_map(session: Session, torrents: Sequence[Torrent]) -> Dict[str, List[WatchedBy]]:
    """``{torrent_id: [WatchedBy, ...]}`` in one query; every id is a key."""
    result: Dict[str, List[WatchedBy]] = {t.id: [] for t in torrents}
    if not result:
        return result
    by_id = {t.id: t for t in torrents}
    joined = (
        session.query(UserStreamingProgress, User)
        .join(User, User.id == UserStreamingProgress.user_id)
        .filter(UserStreamingProgress.torrent_id.in_(list(result)))
        .all()
    )
    rows: Dict[str, list] = defaultdict(list)
    users: Dict[str, User] = {}
    for progress, user in joined:
        rows[progress.torrent_id].append(progress)
        users[user.id] = user
    for tid, trows in rows.items():
        percents = percents_from_rows(by_id[tid], trows)
        items = [
            WatchedBy(profile_id=uid, display_name=users[uid].display_name,
                      avatar=users[uid].avatar, percent=pct)
            for uid, pct in percents.items()
        ]
        items.sort(key=lambda w: (-w.percent, w.display_name))
        result[tid] = items
    return result
