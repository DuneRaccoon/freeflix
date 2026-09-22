"""A seek into a not-yet-downloaded region must fail with a status code, not a
truncated body.

stream_file_range holds the 206 open for up to 300s and then returns, truncating
below the Content-Length it already promised. A desktop browser re-requests; a TV
media pipeline reports a generic playback failure. Waiting for the FIRST chunk
before the response starts is the only point at which a real status code is still
available.
"""
import asyncio
import types
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.api import streaming as streaming_api
from app.torrent.manager import torrent_manager

client = TestClient(app)


class _FakeFile:
    def __init__(self, offset):
        self.offset = offset


class _FakeTI:
    def __init__(self, offset, piece_length, num_pieces):
        self._offset, self._pl, self._np = offset, piece_length, num_pieces

    def file_at(self, i):
        return _FakeFile(self._offset)

    def piece_length(self):
        return self._pl

    def num_pieces(self):
        return self._np


class _FakeHandle:
    """have_piece always returns `available` — no piece ever arrives when False."""
    def __init__(self, ti, available):
        self._ti, self._available = ti, available

    def has_metadata(self):
        return True

    def get_torrent_info(self):
        return self._ti

    def set_sequential_download(self, _v):
        pass

    def have_piece(self, _p):
        return self._available

    def piece_priority(self, _p, _pr):
        pass

    def set_piece_deadline(self, _p, _d):
        pass

    def reset_piece_deadline(self, _p):
        pass

    def status(self):
        return types.SimpleNamespace(num_peers=0, download_rate=0)


def test_wait_for_first_chunk_true_when_pieces_present():
    ti = _FakeTI(offset=0, piece_length=64, num_pieces=16)
    torrent_manager.active_torrents["t-ready"] = (_FakeHandle(ti, True), {})
    try:
        ok = asyncio.run(
            torrent_manager.wait_for_first_chunk("t-ready", 0, 0, 128, budget=0.5)
        )
    finally:
        del torrent_manager.active_torrents["t-ready"]
    assert ok is True


def test_wait_for_first_chunk_false_when_pieces_never_arrive():
    ti = _FakeTI(offset=0, piece_length=64, num_pieces=16)
    torrent_manager.active_torrents["t-stuck"] = (_FakeHandle(ti, False), {})
    try:
        ok = asyncio.run(
            torrent_manager.wait_for_first_chunk("t-stuck", 0, 0, 128, budget=0.5)
        )
    finally:
        del torrent_manager.active_torrents["t-stuck"]
    assert ok is False


def test_wait_for_first_chunk_true_when_torrent_not_in_session():
    # Completed and removed from the session: every byte is already on disk.
    ok = asyncio.run(
        torrent_manager.wait_for_first_chunk("t-absent", 0, 0, 128, budget=0.5)
    )
    assert ok is True


@pytest.fixture
def stub_video(tmp_path, monkeypatch):
    f = tmp_path / "movie.mkv"
    f.write_bytes(b"X" * 4096)
    info = {"index": 0, "path": str(f), "size": 4096,
            "downloaded": 512, "progress": 12.0, "name": "movie.mkv"}
    monkeypatch.setattr(
        streaming_api.torrent_manager, "get_video_file_info",
        lambda tid, fi=None: info,
    )
    monkeypatch.setattr(
        streaming_api.torrent_manager, "get_torrent_status",
        lambda tid: types.SimpleNamespace(progress=12.0),
    )
    monkeypatch.setattr(
        streaming_api.torrent_manager, "prioritize_video_files", lambda *a, **k: True)
    monkeypatch.setattr(
        streaming_api.torrent_manager, "force_start_for_stream", lambda *a, **k: True)
    return info


def test_endpoint_503s_when_first_chunk_unavailable(stub_video, monkeypatch):
    async def _never(*a, **k):
        return False

    monkeypatch.setattr(streaming_api.torrent_manager, "wait_for_first_chunk", _never)
    r = client.get("/api/v1/streaming/tid-1/video", headers={"Range": "bytes=2048-"})
    assert r.status_code == 503
    assert r.headers["Retry-After"] == "2"


def test_endpoint_206s_when_first_chunk_available(stub_video, monkeypatch):
    async def _ready(*a, **k):
        return True

    monkeypatch.setattr(streaming_api.torrent_manager, "wait_for_first_chunk", _ready)
    r = client.get("/api/v1/streaming/tid-1/video", headers={"Range": "bytes=0-99"})
    assert r.status_code == 206
    assert r.headers["Content-Range"] == "bytes 0-99/4096"
