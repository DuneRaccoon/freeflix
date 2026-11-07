"""Autovacuum rules: when a download expires and whether it is kept or in use.

This is the pure half. It never imports ``app.torrent.manager`` at module level,
so it stays importable without starting libtorrent.
"""
from datetime import datetime, timedelta, timezone, tzinfo
from typing import Dict, Optional

from app.models import VacuumInfo
from app.services.instance_settings import EffectiveSettings

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
