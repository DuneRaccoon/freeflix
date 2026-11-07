"""Manager content-guard: validate file list + enforce a block (remove, delete, mark)."""
import os
os.environ.setdefault("DB_PATH", "/tmp/test_content_guard_manager.db")

import types
from pathlib import Path
from app.torrent.manager import torrent_manager
from app.database.session import get_db
from app.database.models.torrents import Torrent as DbTorrent


class _TI:
    def __init__(self, files):  # files: list[(path, size)]
        self._files = files
    def num_files(self):
        return len(self._files)
    def file_at(self, i):
        p, s = self._files[i]
        return types.SimpleNamespace(path=p, size=s)
    def name(self):
        return "Setup.exe"


class _Handle:
    def __init__(self, files, meta=True):
        self._ti = _TI(files)
        self._meta = meta
    def has_metadata(self):
        return self._meta
    def get_torrent_info(self):
        return self._ti


class _Session:
    def __init__(self):
        self.removed = []
    def remove_torrent(self, handle):
        self.removed.append(handle)


def test_validate_flags_executable():
    h = _Handle([("movie.mkv", 2_000_000_000), ("Setup.exe", 500_000)])
    reason = torrent_manager.validate_torrent_content(h)
    assert reason and "executable" in reason.lower()


def test_validate_allows_clean_video():
    h = _Handle([("movie.mkv", 2_000_000_000), ("subs.srt", 50_000)])
    assert torrent_manager.validate_torrent_content(h) is None


def test_validate_no_metadata_returns_none():
    h = _Handle([("Setup.exe", 1)], meta=False)
    assert torrent_manager.validate_torrent_content(h) is None


def _seed_rows(rows):
    """(id, save_path) pairs; any leftover row from a prior run is replaced."""
    with get_db() as db:
        for tid, save_path in rows:
            existing = db.query(DbTorrent).filter(DbTorrent.id == tid).first()
            if existing:
                db.delete(existing)
                db.commit()
            db.add(DbTorrent(
                id=tid, movie_title="Fake Movie", quality="1080p",
                magnet="magnet:?x", url="magnet:?x", save_path=str(save_path),
                state="downloading", progress=1.0,
            ))
        db.commit()


def _drop_rows(ids):
    with get_db() as db:
        db.query(DbTorrent).filter(DbTorrent.id.in_(ids)).delete(synchronize_session=False)
        db.commit()


def _run_block(tid, h, root):
    fake_session = _Session()
    orig_session = torrent_manager.session
    torrent_manager.session = fake_session
    torrent_manager.active_torrents[tid] = (h, {})
    import app.torrent.manager as mgr
    orig_root = mgr.settings.default_download_path
    mgr.settings.default_download_path = root
    try:
        torrent_manager._block_torrent(tid, h, "Contains an executable file (Setup.exe) — blocked for safety.")
    finally:
        mgr.settings.default_download_path = orig_root
        torrent_manager.session = orig_session
        torrent_manager.active_torrents.pop(tid, None)
    return fake_session


def test_block_torrent_with_a_sibling_deletes_only_its_own_content(tmp_path):
    # Two downloads of one title share its save_path; blocking one must not take the other.
    save_path = tmp_path / "Fake.Movie"
    (save_path / "Other.Release").mkdir(parents=True)
    (save_path / "Other.Release" / "keep.mkv").write_bytes(b"film")
    (save_path / "Setup.exe").write_bytes(b"junk")
    tid, sib = "t-block-shared", "t-block-shared-sibling"
    _seed_rows([(tid, save_path), (sib, save_path)])

    h = _Handle([("Setup.exe", 4)])
    try:
        fake_session = _run_block(tid, h, tmp_path)
    finally:
        _drop_rows([tid, sib])

    assert h in fake_session.removed
    assert save_path.exists() and not (save_path / "Setup.exe").exists()
    assert (save_path / "Other.Release" / "keep.mkv").exists()


def test_block_torrent_removes_deletes_and_marks(tmp_path):
    # Arrange a real save_path with a junk file + a DB row + a fake session. No other
    # row shares the save_path, so the whole directory is this download's.
    save_path = tmp_path / "Fake.Movie"
    save_path.mkdir()
    (save_path / "Setup.exe").write_bytes(b"junk")
    (save_path / "Other.Release").mkdir()
    (save_path / "Other.Release" / "keep.mkv").write_bytes(b"leftover")

    tid = "t-block-1"
    _seed_rows([(tid, save_path)])

    h = _Handle([("Setup.exe", 4)])
    # The delete refuses anything outside the download root: point the root at
    # tmp_path for this call.
    fake_session = _run_block(tid, h, tmp_path)

    # Assert: removed from session, dropped from active_torrents, files gone, DB marked.
    assert h in fake_session.removed
    assert tid not in torrent_manager.active_torrents
    assert not save_path.exists()
    with get_db() as db:
        row = db.query(DbTorrent).filter(DbTorrent.id == tid).first()
        assert row.state == "blocked"
        assert "executable" in (row.block_reason or "").lower()
    from app.database.models.torrents import TorrentLog
    with get_db() as db:
        log = db.query(TorrentLog).filter(TorrentLog.torrent_id == tid).order_by(TorrentLog.timestamp.desc()).first()
        assert log is not None and log.state == "blocked"


def test_validate_fail_open_on_classifier_error(monkeypatch):
    monkeypatch.setattr(
        "app.torrent.content_guard.classify_torrent_files",
        lambda *a, **k: (_ for _ in ()).throw(RuntimeError("boom")),
    )
    h = _Handle([("movie.mkv", 2_000_000_000)])
    assert torrent_manager.validate_torrent_content(h) is None
