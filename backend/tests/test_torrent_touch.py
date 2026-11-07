import asyncio
from datetime import datetime, timedelta
from types import SimpleNamespace

import libtorrent as lt
import pytest

import app.torrent.manager as mgr
from app.database.models import Torrent
from fastapi.testclient import TestClient

from app.services.torrent_touch import mark_finished, stamp_legacy_torrents, touch_torrent

FROZEN = datetime(2026, 11, 6, 4, 0, 0)
OLD = datetime(2020, 1, 1, 0, 0, 0)


def _row(tid, **kw):
    base = dict(id=tid, movie_title="Film", quality="1080p", magnet="m", url="u",
                save_path="/tmp/x", state="downloading", last_touched_at=OLD)
    base.update(kw)
    return Torrent(**base)


def _manager(monkeypatch, override_get_db, **active):
    monkeypatch.setattr(mgr, "get_db", override_get_db)
    monkeypatch.setattr(mgr, "utcnow", lambda: FROZEN)
    inst = mgr.TorrentManager.__new__(mgr.TorrentManager)
    inst.active_torrents = dict(active)
    return inst


def _fresh(session_factory, tid):
    s = session_factory()
    try:
        s.expire_all()
        r = s.query(Torrent).filter(Torrent.id == tid).one()
        s.expunge(r)
        return r
    finally:
        s.close()


def test_mark_finished_stamps_once():
    row = SimpleNamespace(finished_at=None, last_touched_at=OLD)
    mark_finished(row, FROZEN)
    assert row.finished_at == FROZEN and row.last_touched_at == FROZEN
    mark_finished(row, FROZEN + timedelta(days=1))
    assert row.finished_at == FROZEN and row.last_touched_at == FROZEN


def test_touch_torrent_sets_only_that_row(db_session):
    db_session.add_all([_row("a"), _row("b")])
    db_session.commit()
    touch_torrent(db_session, "a", FROZEN)
    db_session.commit()
    db_session.expire_all()
    got = {r.id: r.last_touched_at for r in db_session.query(Torrent).all()}
    assert got == {"a": FROZEN, "b": OLD}
    touch_torrent(db_session, "missing", FROZEN)


def test_add_torrent_records_account_and_clock(monkeypatch, override_get_db, session_factory, tmp_path):
    inst = _manager(monkeypatch, override_get_db)
    inst._add_torrent = lambda *a, **k: object()

    async def _noop():
        return None
    inst.start_update_task = _noop
    movie = SimpleNamespace(title="Film", year=None, genre="", tmdb_id=603, media_type="movie",
                            season=None, episode=None)

    def tor(tid):
        return SimpleNamespace(id=tid, quality="1080p", magnet="magnet:?xt=urn:btih:" + "a" * 40,
                               url="u", sizes=("1.0 GB", ""))

    asyncio.run(inst.add_torrent(movie, tor("t-add"), save_path=tmp_path / "Film", account_id="acc-7"))
    r = _fresh(session_factory, "t-add")
    assert r.account_id == "acc-7"
    assert r.added_at == FROZEN and r.last_touched_at == FROZEN
    assert r.finished_at is None

    asyncio.run(inst.add_torrent(movie, tor("t-cron"), save_path=tmp_path / "Film2"))
    assert _fresh(session_factory, "t-cron").account_id is None


def test_add_torrent_records_the_requested_quality(monkeypatch, override_get_db,
                                                    session_factory, tmp_path):
    inst = _manager(monkeypatch, override_get_db)
    inst._add_torrent = lambda *a, **k: object()

    async def _noop():
        return None
    inst.start_update_task = _noop
    movie = SimpleNamespace(title="Film", year=None, genre="", tmdb_id=603, media_type="movie",
                            season=None, episode=None)
    down = SimpleNamespace(id="t-down", quality="720p", requested_quality="1080p",
                           magnet="magnet:?xt=urn:btih:" + "b" * 40, url="u",
                           sizes=("1.0 GB", ""))
    asyncio.run(inst.add_torrent(movie, down, save_path=tmp_path / "Film"))
    r = _fresh(session_factory, "t-down")
    assert (r.quality, r.requested_quality) == ("720p", "1080p")

    # The schedule cron's torrent model has no requested bucket: the column stays NULL.
    cron = SimpleNamespace(id="t-cron", quality="720p",
                           magnet="magnet:?xt=urn:btih:" + "c" * 40, url="u",
                           sizes=("1.0 GB", ""))
    asyncio.run(inst.add_torrent(movie, cron, save_path=tmp_path / "Film2"))
    assert _fresh(session_factory, "t-cron").requested_quality is None


class _FinishedAlert:
    pass


class _StateAlert:
    pass


def test_finish_alert_stamps_finished_at(monkeypatch, override_get_db, session_factory, db_session):
    h = object()
    db_session.add(_row("t1"))
    db_session.commit()
    inst = _manager(monkeypatch, override_get_db, t1=(h, {}))
    inst.release_stream_force_start = lambda tid: True
    monkeypatch.setattr(mgr.lt, "torrent_finished_alert", _FinishedAlert)
    alert = _FinishedAlert()
    alert.handle = h
    inst._handle_alert(alert)
    r = _fresh(session_factory, "t1")
    assert r.state == "finished"
    assert r.finished_at == FROZEN and r.last_touched_at == FROZEN


@pytest.mark.parametrize("lt_state,stamped", [
    (lt.torrent_status.seeding, True),
    (lt.torrent_status.downloading, False),
])
def test_state_changed_to_seeding_stamps_finished_at(monkeypatch, override_get_db, session_factory,
                                                     db_session, lt_state, stamped):
    h = object()
    db_session.add(_row("t1", state="checking"))
    db_session.commit()
    inst = _manager(monkeypatch, override_get_db, t1=(h, {}))
    monkeypatch.setattr(mgr.lt, "state_changed_alert", _StateAlert)
    alert = _StateAlert()
    alert.handle = h
    alert.state = lt_state
    inst._handle_alert(alert)
    r = _fresh(session_factory, "t1")
    assert r.finished_at == (FROZEN if stamped else None)


def _status(**kw):
    base = dict(state=lt.torrent_status.seeding, progress=1.0, download_rate=0, upload_rate=0,
                num_peers=0, total_wanted=4_500_000_000, total_wanted_done=4_500_000_000,
                has_metadata=True)
    base.update(kw)
    return SimpleNamespace(**base)


@pytest.mark.parametrize("status_kw,eta,finished,size", [
    ({}, None, True, 4_500_000_000),
    (dict(state=lt.torrent_status.downloading, download_rate=100, total_wanted=1000,
          total_wanted_done=400), 6, False, 1000),
    (dict(state=lt.torrent_status.finished), None, True, 4_500_000_000),
])
def test_update_loop_persists_size_clears_eta_and_stamps_finish(
        monkeypatch, override_get_db, session_factory, db_session, status_kw, eta, finished, size):
    st = _status(**status_kw)
    handle = SimpleNamespace(status=lambda: st, need_save_resume_data=lambda: False,
                             has_metadata=lambda: True)
    db_session.add(_row("t1", meta_data={"eta": 999}))
    db_session.commit()
    inst = _manager(monkeypatch, override_get_db, t1=(handle, {}))
    inst.session = SimpleNamespace(pop_alerts=lambda: [])
    inst._last_logged = {"t1": 1e18}

    async def _cancel(*a):
        raise asyncio.CancelledError

    monkeypatch.setattr(mgr, "asyncio", SimpleNamespace(sleep=_cancel, CancelledError=asyncio.CancelledError))
    asyncio.run(inst._update_torrents_status())
    r = _fresh(session_factory, "t1")
    assert r.size_bytes == size
    assert r.meta_data["eta"] == eta
    assert (r.finished_at == FROZEN) if finished else (r.finished_at is None)


def test_stamp_legacy_torrents(db_session):
    a, b, c = datetime(2021, 1, 1), datetime(2022, 2, 2), datetime(2023, 3, 3)
    db_session.add_all([
        _row("fin", state="seeding", added_at=None, last_touched_at=None, finished_at=None),
        _row("dl", state="downloading", added_at=None, last_touched_at=None, finished_at=None),
        _row("new", state="finished", added_at=a, last_touched_at=b, finished_at=c),
    ])
    db_session.commit()
    n = stamp_legacy_torrents(db_session, FROZEN)
    db_session.commit()
    db_session.expire_all()
    rows = {r.id: r for r in db_session.query(Torrent).all()}
    assert (rows["fin"].added_at, rows["fin"].last_touched_at, rows["fin"].finished_at) == (FROZEN,) * 3
    assert (rows["dl"].added_at, rows["dl"].last_touched_at) == (FROZEN, FROZEN)
    assert rows["dl"].finished_at is None
    assert (rows["new"].added_at, rows["new"].last_touched_at, rows["new"].finished_at) == (a, b, c)
    assert n == 5
    assert stamp_legacy_torrents(db_session, FROZEN + timedelta(days=1)) == 0


def test_startup_runs_the_legacy_stamp(monkeypatch):
    from app.main import app

    calls = []
    monkeypatch.setattr("app.main.stamp_legacy_torrents", lambda db, now: calls.append(now) or 0)
    with TestClient(app):
        pass
    assert len(calls) == 1
    assert isinstance(calls[0], datetime)
