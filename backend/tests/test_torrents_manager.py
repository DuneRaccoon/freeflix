# backend/tests/test_torrents_manager.py
import os
os.environ.setdefault("DB_PATH", "/tmp/test_torrents_manager.db")

import types
import pytest
import libtorrent as lt

from app.torrent.manager import torrent_manager
from app.torrent.storage import encode_resume_data


def _fake_atp():
    return types.SimpleNamespace(save_path=None, storage_mode=None)


def test_add_torrent_from_magnet(monkeypatch):
    torrent_manager.active_torrents.clear()
    calls = {}

    def fake_parse(uri):
        calls["uri"] = uri
        return _fake_atp()

    fake_handle = types.SimpleNamespace(set_sequential_download=lambda v: calls.setdefault("seq", v))
    monkeypatch.setattr(lt, "parse_magnet_uri", fake_parse)
    monkeypatch.setattr(torrent_manager.session, "add_torrent", lambda atp: fake_handle)

    handle = torrent_manager._add_torrent("t1", "magnet:?xt=urn:btih:abc", "/tmp/x", {"k": "v"})

    assert calls["uri"] == "magnet:?xt=urn:btih:abc"
    assert calls["seq"] is True
    assert torrent_manager.active_torrents["t1"] == (fake_handle, {"k": "v"})


def test_add_torrent_from_resume_data(monkeypatch):
    torrent_manager.active_torrents.clear()
    seen = {}

    def fake_read(buf):
        seen["buf"] = buf
        return _fake_atp()

    fake_handle = types.SimpleNamespace(set_sequential_download=lambda v: None)
    monkeypatch.setattr(lt, "read_resume_data", fake_read)
    monkeypatch.setattr(torrent_manager.session, "add_torrent", lambda atp: fake_handle)

    blob = encode_resume_data(b"resume-bytes")
    torrent_manager._add_torrent("t2", "magnet:?xt=urn:btih:abc", "/tmp/x", {}, resume_data=blob)

    assert seen["buf"] == b"resume-bytes"
    assert "t2" in torrent_manager.active_torrents


import types as _types
from contextlib import contextmanager
from pathlib import Path
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database.session import Base
from app.database.models import Torrent as DbTorrent


@pytest.fixture()
def mgr_db(monkeypatch, tmp_path):
    """Point the manager's get_db at a throwaway SQLite session."""
    engine = create_engine(f"sqlite:///{tmp_path/'mgr.db'}", connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine)

    @contextmanager
    def fake_get_db():
        s = Session()
        try:
            yield s
            s.commit()
        except Exception:
            s.rollback()
            raise
        finally:
            s.close()

    monkeypatch.setattr("app.torrent.manager.get_db", fake_get_db)
    return Session


def _seed(Session, **kw):
    s = Session()
    t = DbTorrent(movie_title="m", quality="1080p", magnet="magnet:?xt=test",
                  url="u", save_path=str(Path("/tmp/m")), **kw)
    s.add(t); s.commit(); s.refresh(t); tid = t.id; s.close()
    return tid


def test_pause_unloads_and_marks_paused(mgr_db, monkeypatch):
    tid = _seed(mgr_db, state="downloading")
    calls = {}
    handle = _types.SimpleNamespace(
        save_resume_data=lambda: calls.setdefault("saved", True),
        pause=lambda: calls.setdefault("paused", True),
    )
    torrent_manager.active_torrents[tid] = (handle, {})
    monkeypatch.setattr(torrent_manager.session, "remove_torrent", lambda h: calls.setdefault("removed", h))

    assert torrent_manager.pause_torrent(tid) is True
    assert calls.get("saved") and calls.get("paused") and calls.get("removed") is handle
    assert tid not in torrent_manager.active_torrents
    s = mgr_db(); assert s.get(DbTorrent, tid).state == "paused"; s.close()


def test_resume_readds_and_marks_downloading(mgr_db, monkeypatch):
    tid = _seed(mgr_db, state="paused", error_message="boom")
    torrent_manager.active_torrents.pop(tid, None)
    fake_handle = _types.SimpleNamespace(resume=lambda: None)
    added = {}

    def fake_add(torrent_id, magnet, save_path, meta, resume_data=None):
        added["id"] = torrent_id
        torrent_manager.active_torrents[torrent_id] = (fake_handle, meta)
        return fake_handle

    monkeypatch.setattr(torrent_manager, "_add_torrent", fake_add)

    assert torrent_manager.resume_torrent(tid) is True
    assert added["id"] == tid
    s = mgr_db(); row = s.get(DbTorrent, tid)
    assert row.state == "downloading" and row.error_message is None; s.close()


def test_stop_torrent_removed():
    assert not hasattr(torrent_manager, "stop_torrent")


def test_remove_hard_deletes_row_keep_files(mgr_db, monkeypatch, tmp_path):
    root = tmp_path / "downloads"; sub = root / "movie"; sub.mkdir(parents=True)
    tid = _seed(mgr_db, state="finished")
    s = mgr_db(); s.get(DbTorrent, tid).save_path = str(sub); s.commit(); s.close()
    monkeypatch.setattr("app.torrent.manager.settings.default_download_path", root, raising=False)
    torrent_manager.active_torrents.pop(tid, None)

    assert torrent_manager.remove_torrent(tid, delete_files=False) is True
    s = mgr_db(); assert s.get(DbTorrent, tid) is None; s.close()
    assert sub.exists()  # files kept


def test_remove_delete_files_rmtrees(mgr_db, monkeypatch, tmp_path):
    root = tmp_path / "downloads"; sub = root / "movie"; sub.mkdir(parents=True)
    (sub / "f.mkv").write_bytes(b"x")
    tid = _seed(mgr_db, state="finished")
    s = mgr_db(); s.get(DbTorrent, tid).save_path = str(sub); s.commit(); s.close()
    monkeypatch.setattr("app.torrent.manager.settings.default_download_path", root, raising=False)
    torrent_manager.active_torrents.pop(tid, None)

    assert torrent_manager.remove_torrent(tid, delete_files=True) is True
    s = mgr_db(); assert s.get(DbTorrent, tid) is None; s.close()
    assert not sub.exists()  # files deleted


def test_remove_unloads_active_handle(mgr_db, monkeypatch):
    tid = _seed(mgr_db, state="downloading")
    handle = _types.SimpleNamespace()
    torrent_manager.active_torrents[tid] = (handle, {})
    removed = {}
    monkeypatch.setattr(torrent_manager.session, "remove_torrent", lambda h: removed.setdefault("h", h))

    assert torrent_manager.remove_torrent(tid, delete_files=False) is True
    assert removed["h"] is handle
    assert tid not in torrent_manager.active_torrents
