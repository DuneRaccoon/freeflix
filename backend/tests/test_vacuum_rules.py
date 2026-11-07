from dataclasses import replace
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from app.services.instance_settings import EffectiveSettings
from app.services.vacuum import vacuum_info, is_due, next_run_at, seconds_until_next_run

UTC = timezone.utc
NOW = datetime(2026, 11, 7, 10, 0)                     # naive UTC
TONIGHT = datetime(2026, 11, 8, 4, 0, tzinfo=UTC)
ON = EffectiveSettings(True, 30, True, 80, True, 80)


def info(touched_days_ago, percents=None, settings=ON, rate=0.0, recent=False, tz=UTC):
    lt = None if touched_days_ago is None else NOW - timedelta(days=touched_days_ago)
    return vacuum_info(SimpleNamespace(last_touched_at=lt), percents or {}, settings, NOW, recent,
                       live_download_rate=rate, tz=tz)


def test_off_is_off_whatever_the_clock():
    got = info(400, settings=replace(ON, autovacuum_enabled=False))
    assert (got.status, got.deletes_at) == ("off", None)


def test_expired_and_nobody_started_it_deletes_tonight():
    assert (info(31).status, info(31).deletes_at) == ("scheduled", TONIGHT)


def test_the_countdown_lands_on_the_first_run_after_expiry():
    assert info(12).deletes_at == datetime(2026, 11, 26, 4, 0, tzinfo=UTC)   # expiry 11-25 10:00


def test_the_run_hour_is_container_local_not_utc():
    assert info(31, tz=timezone(timedelta(hours=10))).deletes_at == datetime(2026, 11, 7, 18, 0, tzinfo=UTC)


def test_one_starter_below_the_threshold_keeps_it():
    got = info(31, {"p1": 50.0})
    assert (got.status, got.deletes_at) == ("kept_watching", None)


def test_every_starter_must_pass():
    assert info(31, {"p1": 85.0, "p2": 79.9}).status == "kept_watching"


def test_the_threshold_is_inclusive():
    assert info(31, {"p1": 80.0, "p2": 100.0}).status == "scheduled"


def test_the_threshold_comes_from_settings():
    assert info(31, {"p1": 50.0}, settings=replace(ON, autovacuum_watched_pct=40)).status == "scheduled"


def test_gate_off_ignores_percents():
    assert info(31, {"p1": 10.0}, settings=replace(ON, autovacuum_watched_gate=False)).status == "scheduled"


def test_a_live_download_is_active_and_keeps_its_countdown():
    got = info(31, rate=12.5)
    assert (got.status, got.deletes_at) == ("active", TONIGHT)


def test_a_recent_play_is_active():
    assert info(31, recent=True).status == "active"


def test_the_gate_outranks_active():
    assert info(31, {"p1": 50.0}, rate=12.5).status == "kept_watching"


def test_a_row_with_no_clock_has_no_date():
    got = info(None)
    assert (got.status, got.deletes_at) == ("scheduled", None)


def test_is_due_is_inclusive_at_exactly_n_days():
    row = lambda d: SimpleNamespace(last_touched_at=NOW - d)
    assert is_due(row(timedelta(days=30)), ON, NOW) is True
    assert is_due(row(timedelta(days=30) - timedelta(seconds=1)), ON, NOW) is False
    assert is_due(SimpleNamespace(last_touched_at=None), ON, NOW) is False


def test_next_run_is_strictly_after():
    assert next_run_at(datetime(2026, 11, 7, 3, 59, tzinfo=UTC), UTC) == datetime(2026, 11, 7, 4, 0, tzinfo=UTC)
    assert next_run_at(datetime(2026, 11, 7, 4, 0, tzinfo=UTC), UTC) == datetime(2026, 11, 8, 4, 0, tzinfo=UTC)
    assert seconds_until_next_run(datetime(2026, 11, 7, 3, 0, tzinfo=UTC), UTC) == 3600.0
