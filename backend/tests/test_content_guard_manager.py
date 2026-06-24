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


def test_block_torrent_removes_deletes_and_marks(tmp_path):
    # Arrange a real save_path with a junk file + a DB row + a fake session.
    save_path = tmp_path / "Fake.Movie"
    save_path.mkdir()
    (save_path / "Setup.exe").write_bytes(b"junk")

    tid = "t-block-1"
    with get_db() as db:
        # Clean up any leftover row from a prior run.
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

    h = _Handle([("Setup.exe", 4)])
    fake_session = _Session()
    orig_session = torrent_manager.session
    torrent_manager.session = fake_session
    torrent_manager.active_torrents[tid] = (h, {})

    # Make safe_rmtree permit our tmp dir (it guards against deleting outside the
    # download root): point the download root at tmp_path for this call.
    import app.torrent.manager as mgr
    orig_root = mgr.settings.default_download_path
    mgr.settings.default_download_path = tmp_path
    try:
        torrent_manager._block_torrent(tid, h, "Contains an executable file (Setup.exe) — blocked for safety.")
    finally:
        mgr.settings.default_download_path = orig_root
        torrent_manager.session = orig_session
        # Ensure the entry is cleaned up even if the test fails before _block_torrent pops it
        torrent_manager.active_torrents.pop(tid, None)

    # Assert: removed from session, dropped from active_torrents, files gone, DB marked.
    assert h in fake_session.removed
    assert tid not in torrent_manager.active_torrents
    assert not save_path.exists()
    with get_db() as db:
        row = db.query(DbTorrent).filter(DbTorrent.id == tid).first()
        assert row.state == "blocked"
        assert "executable" in (row.block_reason or "").lower()
