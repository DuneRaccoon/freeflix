"""Autovacuum: when a download expires, whether it is kept or in use, and the run.

``vacuum_info`` is the pure rule. ``_evaluate`` feeds it from the database and the live
handles, and is the one evaluator shared by ``run_vacuum`` (which deletes) and
``fill_vacuum`` (which labels the Downloads list), so the two can never disagree.

It never imports ``app.torrent.manager`` at module level, so it stays importable without
starting libtorrent.
"""
from datetime import datetime, timedelta, timezone, tzinfo
from typing import Dict, List, Optional

from loguru import logger
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database.models import Torrent
from app.database.models.streaming import UserStreamingProgress
from app.database.session import get_db
from app.models import TorrentStatus, VacuumInfo
from app.services import accounts as accounts_service
from app.services.instance_settings import EffectiveSettings, effective_settings
from app.services.watch_share import profile_percents
from app.torrent.storage import human_size

VACUUM_HOUR = 4
RECENT_PLAY_WINDOW = timedelta(minutes=10)


def next_run_at(after: datetime, tz: Optional[tzinfo] = None) -> datetime:
    """The first VACUUM_HOUR:00 strictly after ``after``, as aware UTC.

    ``tz=None`` is the container's local zone. ``astimezone()`` yields a fixed
    offset, so on a DST-change day the run lands an hour early or late.
    """
    local = after.astimezone(tz)
    run = local.replace(hour=VACUUM_HOUR, minute=0, second=0, microsecond=0)
    if run <= local:
        run += timedelta(days=1)
    return run.astimezone(timezone.utc)


def seconds_until_next_run(now: datetime, tz: Optional[tzinfo] = None) -> float:
    return (next_run_at(now, tz) - now).total_seconds()


def is_due(row, settings: EffectiveSettings, now: datetime) -> bool:
    """``now`` is naive UTC. Inclusive at exactly N days."""
    return (
        row.last_touched_at is not None
        and now - row.last_touched_at >= timedelta(days=settings.autovacuum_days)
    )


def vacuum_info(
    row,
    percents: Dict[str, float],
    settings: EffectiveSettings,
    now: datetime,
    recently_played: bool,
    *,
    live_download_rate: float,
    tz: Optional[tzinfo] = None,
) -> VacuumInfo:
    if not settings.autovacuum_enabled:
        return VacuumInfo(status='off')

    # Nobody started it means percents is empty, so the gate does not apply.
    if settings.autovacuum_watched_gate and any(
        p < settings.autovacuum_watched_pct for p in percents.values()
    ):
        return VacuumInfo(status='kept_watching')

    if row.last_touched_at is None:
        deletes_at = None
    else:
        expiry = (row.last_touched_at + timedelta(days=settings.autovacuum_days)).replace(tzinfo=timezone.utc)
        now_aware = now.replace(tzinfo=timezone.utc)
        deletes_at = next_run_at(max(expiry, now_aware), tz)

    active = live_download_rate > 0 or recently_played
    return VacuumInfo(status='active' if active else 'scheduled', deletes_at=deletes_at)


def _manager_or_default(manager):
    if manager is None:
        from app.torrent.manager import torrent_manager
        return torrent_manager
    return manager


def _live_rates(manager) -> Dict[str, float]:
    """``{torrent_id: live download rate}`` off each loaded handle, never off ``meta_data``.

    An entry whose handle cannot be read counts as live (1.0): deleting on an unreadable
    handle is the unsafe direction.
    """
    rates: Dict[str, float] = {}
    for tid, entry in list(getattr(manager, "active_torrents", {}).items()):
        try:
            handle, _ = entry
            rates[tid] = float(handle.status().download_rate)
        except Exception:
            rates[tid] = 1.0
    return rates


def _last_played(session: Session, ids: List[str]) -> Dict[str, datetime]:
    """Latest progress write per torrent id, in one grouped query, as naive UTC."""
    if not ids:
        return {}
    rows = (
        session.query(UserStreamingProgress.torrent_id, func.max(UserStreamingProgress.last_watched_at))
        .filter(UserStreamingProgress.torrent_id.in_(ids))
        .group_by(UserStreamingProgress.torrent_id)
        .all()
    )
    result: Dict[str, datetime] = {}
    for tid, latest in rows:
        if latest is None:
            continue
        # The PUT heartbeat writes naive *local* time (api/streaming.py:595). With TZ east of
        # UTC that over-reports "recent", which keeps the download (the safe direction). With
        # TZ west of UTC it under-reports, and the clock still protects the download, because
        # every progress write also touches last_touched_at (Part C).
        if latest.tzinfo is not None:
            latest = latest.astimezone(timezone.utc).replace(tzinfo=None)
        result[tid] = latest
    return result


def _evaluate(
    session: Session,
    rows: List[Torrent],
    settings: EffectiveSettings,
    now: datetime,
    *,
    manager,
    tz: Optional[tzinfo],
) -> Dict[str, VacuumInfo]:
    rates = _live_rates(manager)
    last_played = _last_played(session, [row.id for row in rows])
    result: Dict[str, VacuumInfo] = {}
    for row in rows:
        latest = last_played.get(row.id)
        recently_played = latest is not None and latest >= now - RECENT_PLAY_WINDOW
        result[row.id] = vacuum_info(
            row, profile_percents(session, row), settings, now, recently_played,
            live_download_rate=rates.get(row.id, 0.0), tz=tz,
        )
    return result


def fill_vacuum(statuses: List[TorrentStatus], now: datetime, *, manager=None, tz=None) -> None:
    """Set ``status.vacuum`` on each status; one with no row keeps ``vacuum = None``."""
    if not statuses:
        return
    manager = _manager_or_default(manager)
    with get_db() as session:
        settings = effective_settings(accounts_service.get_instance(session, create=False))
        rows = session.query(Torrent).filter(Torrent.id.in_([s.id for s in statuses])).all()
        infos = _evaluate(session, rows, settings, now, manager=manager, tz=tz)
    for status in statuses:
        info = infos.get(status.id)
        if info is not None:
            status.vacuum = info


def run_vacuum(now: datetime, *, manager=None, tz=None) -> List[str]:
    """Delete every due, scheduled download with its files. Returns the ids removed.

    ``now`` is naive UTC. Due-ness is read from this run's ``last_touched_at``, never from
    an earlier ``fill_vacuum`` or from ``added_at``/``finished_at``.
    """
    manager = _manager_or_default(manager)
    due = []
    with get_db() as session:
        settings = effective_settings(accounts_service.get_instance(session, create=False))
        if not settings.autovacuum_enabled:
            return []
        rows = session.query(Torrent).order_by(Torrent.id).all()
        infos = _evaluate(session, rows, settings, now, manager=manager, tz=tz)
        for row in rows:
            if infos[row.id].status != 'scheduled' or not is_due(row, settings, now):
                continue
            lt = row.last_touched_at
            reason = f"untouched {(now - lt).days} days"
            # Gate applied: on, and somebody started it (so every starter passed it).
            if settings.autovacuum_watched_gate and profile_percents(session, row):
                reason += f", every viewer past {settings.autovacuum_watched_pct}%"
            due.append((row.id, row.movie_title, reason, lt, row.size_bytes))

    # The session is closed: never hold it across a manager call.
    deleted: List[str] = []
    for tid, title, reason, lt, size in due:  # id order, from the query
        if manager.remove_torrent(tid, delete_files=True):
            deleted.append(tid)
            logger.info(
                f"Autovacuum: deleted '{title}' ({tid}) — reason: {reason}; "
                f"last touched {lt:%Y-%m-%d %H:%M} UTC; "
                f"freed {human_size(size) if size else 'unknown size'}"
            )
    return deleted
