"""The autovacuum's run and the Downloads list's vacuum line share one evaluator (Part D, D4).

``run_vacuum`` deletes, through the manager's owned-content path, every row the shared
``_evaluate`` marks ``scheduled`` that is also due by this run's ``last_touched_at``.
``fill_vacuum`` puts the same verdict on each ``TorrentStatus``.
"""
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from loguru import logger

from app.database.models import Torrent, User
from app.database.models.accounts import INSTANCE_SINGLETON_ID, Instance
from app.database.models.streaming import UserStreamingProgress
from app.models import TorrentStatus
from app.services.torrent_touch import stamp_legacy_torrents, touch_torrent
from app.services.vacuum import fill_vacuum, run_vacuum

NOW = datetime(2026, 11, 7, 10, 0)  # naive UTC
DELETED = {"expired", "finished-watched", "stale-rate", "errored"}


def _live(rate):
    """The real ``active_torrents`` entry shape: ``(handle, metadata)``."""
    return (SimpleNamespace(status=lambda: SimpleNamespace(download_rate=rate)), {})


@pytest.fixture
def world(db_session, override_get_db, monkeypatch):
    monkeypatch.setattr("app.services.vacuum.get_db", override_get_db)
    db = db_session
    # Days, gate and percent left NULL: 30 days, gate on, 80%.
    db.add(Instance(id=INSTANCE_SINGLETON_ID, autovacuum_enabled=True))
    users = {}
    for name in ("p1", "p2", "p3"):
        users[name] = User(username=name, display_name=name.upper())
        db.add(users[name])
    db.flush()

    fake = SimpleNamespace(active_torrents={}, removed=[], ok={})
    fake.remove_torrent = (
        lambda tid, delete_files=False: fake.removed.append((tid, delete_files)) or fake.ok.get(tid, True)
    )

    def torrent(tid, days, **kw):
        stamp = NOW - timedelta(days=days)
        db.add(Torrent(
            id=tid, movie_title=f"Title {tid}", quality="1080p",
            magnet=f"magnet:?xt=urn:btih:{tid}", url="", save_path=f"downloads/{tid}",
            state=kw.get("state", "finished"), media_type=kw.get("media_type", "movie"),
            # added_at and finished_at age with the clock so that counting from either
            # instead of last_touched_at is caught (ruling D4).
            added_at=stamp, finished_at=stamp, last_touched_at=stamp, size_bytes=1610612736,
            meta_data=kw.get("meta_data"), season=kw.get("season"),
            precomputed_episodes=kw.get("precomputed_episodes"),
        ))

    def progress(user, tid, movie_id, pct, *, completed=False, file_index=None,
                 watched=NOW - timedelta(days=40)):
        db.add(UserStreamingProgress(
            user_id=users[user].id, torrent_id=tid, movie_id=movie_id, percentage=pct,
            completed=completed, file_index=file_index, last_watched_at=watched,
        ))

    torrent("expired", 31)
    torrent("fresh", 5)
    torrent("gated", 31)
    progress("p1", "gated", "movie:1", 40)
    torrent("finished-watched", 31)
    progress("p3", "finished-watched", "movie:3", 100, completed=True)
    torrent("downloading", 31, state="downloading")
    fake.active_torrents["downloading"] = _live(50_000)
    torrent("stale-rate", 31, state="paused", meta_data={"download_rate": 300.0})
    torrent("watching", 31)
    progress("p2", "watching", "movie:2", 95, watched=NOW - timedelta(minutes=5))
    torrent("errored", 31, state="error")
    torrent("pack", 31, media_type="tv", season=1,
            precomputed_episodes={str(i): {"season": 1, "episode": i + 1} for i in range(10)})
    for i in range(3):
        progress("p1", "pack", f"tv:9:s1:e{i + 1}", 100, file_index=i)
    db.commit()

    return SimpleNamespace(db=db, fake=fake, torrent=torrent)


def _capture():
    lines = []
    hid = logger.add(lambda m: lines.append(m.record["message"]), level="INFO")
    return lines, hid


def _deleted_lines(lines):
    return [line for line in lines if line.startswith("Autovacuum: deleted")]


def test_run_deletes_exactly_the_due_rows_with_their_files(world):
    assert set(run_vacuum(NOW, manager=world.fake)) == DELETED
    assert set(world.fake.removed) == {(t, True) for t in DELETED}


def test_removals_run_in_id_order(world):
    assert run_vacuum(NOW, manager=world.fake) == sorted(DELETED)


def _evaluating_fails(monkeypatch):
    # vacuum_info alone answers 'off' when disabled, so only "nothing was evaluated"
    # tells run_vacuum's own enabled check apart from no check at all.
    monkeypatch.setattr("app.services.vacuum._evaluate",
                        lambda *a, **k: pytest.fail("evaluated while the autovacuum is off"))


def test_disabled_deletes_nothing(world, monkeypatch):
    world.db.query(Instance).update({Instance.autovacuum_enabled: False})
    world.db.commit()
    _evaluating_fails(monkeypatch)
    assert run_vacuum(NOW, manager=world.fake) == [] and world.fake.removed == []


def test_no_instance_row_deletes_nothing(world, monkeypatch):
    world.db.query(Instance).delete()
    world.db.commit()
    _evaluating_fails(monkeypatch)
    assert run_vacuum(NOW, manager=world.fake) == []
    assert world.fake.removed == []


def test_a_failed_removal_is_not_reported(world):
    world.fake.ok["expired"] = False
    lines, hid = _capture()
    try:
        got = run_vacuum(NOW, manager=world.fake)
    finally:
        logger.remove(hid)
    assert "expired" not in got
    assert ("expired", True) in world.fake.removed
    assert not any("(expired)" in line for line in _deleted_lines(lines))


def test_one_log_line_per_deletion(world):
    lines, hid = _capture()
    try:
        run_vacuum(NOW, manager=world.fake)
    finally:
        logger.remove(hid)
    deleted = _deleted_lines(lines)
    assert len(deleted) == 4
    assert ("Autovacuum: deleted 'Title expired' (expired) — reason: untouched 31 days; "
            "last touched 2026-10-07 10:00 UTC; freed 1.5 GB") in deleted
    assert any("(finished-watched) — reason: untouched 31 days, every viewer past 80%;" in line
               for line in deleted)


def test_a_download_played_moments_before_the_run_is_kept(world):   # Review Focus 2
    # What C6's reuse (Play pressed at 03:59) and C3's progress writes leave behind. No progress
    # row is added, so recently_played is False and only the clock can protect it.
    touch_torrent(world.db, "expired", NOW - timedelta(seconds=5))
    world.db.commit()
    assert "expired" not in run_vacuum(NOW, manager=world.fake)
    assert ("expired", True) not in world.fake.removed


def test_the_reason_counts_from_last_touched_not_finished(world):
    # A download finished long ago but touched 31 days ago reads "31 days" in its log line.
    world.db.query(Torrent).filter(Torrent.id == "expired").update(
        {Torrent.finished_at: NOW - timedelta(days=100), Torrent.added_at: NOW - timedelta(days=100)})
    world.db.commit()
    lines, hid = _capture()
    try:
        run_vacuum(NOW, manager=world.fake)
    finally:
        logger.remove(hid)
    assert ("Autovacuum: deleted 'Title expired' (expired) — reason: untouched 31 days; "
            "last touched 2026-10-07 10:00 UTC; freed 1.5 GB") in _deleted_lines(lines)


def test_legacy_rows_get_a_full_grace_period_after_the_startup_stamp(world):   # Review Focus 4
    # A pre-upgrade row: every lifecycle column NULL, finished, no size, no account.
    world.db.add(Torrent(id="legacy", movie_title="Old", quality="1080p", state="finished",
                         magnet="magnet:?xt=urn:btih:legacy", url="", save_path="downloads/legacy",
                         media_type="movie"))
    world.db.commit()
    T0 = NOW
    stamp_legacy_torrents(world.db, T0)  # what C3's startup block runs
    world.db.commit()
    assert "legacy" not in run_vacuum(T0 + timedelta(days=29), manager=world.fake)
    lines, hid = _capture()
    try:
        assert "legacy" in run_vacuum(T0 + timedelta(days=30), manager=world.fake)
    finally:
        logger.remove(hid)
    # Loguru never reaches pytest's caplog, so the line is read off a loguru sink.
    assert ("Autovacuum: deleted 'Old' (legacy) — reason: untouched 30 days; "
            "last touched 2026-11-07 10:00 UTC; freed unknown size") in _deleted_lines(lines)


def test_a_loaded_handle_at_zero_rate_is_still_deleted(world):
    # The real (handle, metadata) tuple: forgetting to unpack it would read as "live".
    world.torrent("idle", 31, state="downloading")
    world.db.commit()
    world.fake.active_torrents["idle"] = _live(0)
    assert "idle" in run_vacuum(NOW, manager=world.fake)


def test_an_unreadable_handle_counts_as_live(world):
    def boom():
        raise RuntimeError("invalid torrent handle")
    world.fake.active_torrents["expired"] = (SimpleNamespace(status=boom), {})
    assert "expired" not in run_vacuum(NOW, manager=world.fake)


def test_fill_marks_each_status_and_leaves_unknown_ids_alone(world):
    rows = {r.id: r for r in world.db.query(Torrent).filter(Torrent.id.in_(["expired", "gated"]))}
    statuses = [rows["expired"].to_status(), rows["gated"].to_status(),
                TorrentStatus(id="ghost", movie_title="x", quality="1080p", state="finished",
                              save_path="x", created_at=NOW, updated_at=NOW)]
    fill_vacuum(statuses, NOW, manager=world.fake, tz=timezone.utc)
    assert [s.vacuum.status if s.vacuum else None for s in statuses] == ["scheduled", "kept_watching", None]
    assert statuses[0].vacuum.deletes_at == datetime(2026, 11, 8, 4, 0, tzinfo=timezone.utc)
    assert world.fake.removed == []
