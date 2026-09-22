"""A seek into a not-yet-downloaded region must fail with a status code, not a
truncated body.

stream_file_range holds the 206 open for up to 300s and then returns, truncating
below the Content-Length it already promised. A desktop browser re-requests; a TV
media pipeline reports a generic playback failure. Waiting for the FIRST chunk
before the response starts is the only point at which a real status code is still
available.

Two properties of that wait are as load-bearing as the 503 itself:

- The budget is SWARM-AWARE (_adaptive_piece_timeout), not flat. On a Pi with a
  low-seeder torrent the 10s-300s delivery band is the common case, so a flat
  budget turns a slow success into a fatal error for a client that cannot retry.
- No libtorrent call in the method may escape its try. This runs BEFORE the
  response starts, so an exception here becomes a body served into a decoder.
"""
import asyncio
import time
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
    """`offset` is either a single offset for every file, or an {index: offset}
    map. The map form matters: a TV season pack is ONE torrent with many video
    files, so every file but the first has a non-zero offset and the piece
    arithmetic is only really exercised once file_at() honours its argument."""

    def __init__(self, offset, piece_length, num_pieces):
        self._offsets = offset if isinstance(offset, dict) else None
        self._offset = None if self._offsets is not None else offset
        self._pl, self._np = piece_length, num_pieces

    def file_at(self, i):
        if self._offsets is not None:
            return _FakeFile(self._offsets[i])
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


# --------------------------------------------------------------------------
# Season packs: the piece arithmetic at a non-zero file offset.
# --------------------------------------------------------------------------

def _record_targeted_pieces(monkeypatch):
    """Capture the (first_piece, last_piece) the wait actually asks about."""
    seen = []

    def _ready(handle, first_piece, last_piece):
        seen.append((first_piece, last_piece))
        return True

    monkeypatch.setattr(torrent_manager, "_pieces_ready", _ready)
    return seen


def test_first_chunk_targets_pieces_for_a_non_zero_file_offset(monkeypatch):
    # Episode 4 of a season pack starts 1000 bytes into the torrent, deliberately
    # NOT on a piece boundary. Requesting bytes [128, 255] of that file means
    # torrent bytes [1128, 1255], i.e. pieces 17..19 at a 64-byte piece length.
    ti = _FakeTI(offset={0: 0, 3: 1000}, piece_length=64, num_pieces=200)
    seen = _record_targeted_pieces(monkeypatch)
    torrent_manager.active_torrents["t-pack"] = (_FakeHandle(ti, True), {})
    try:
        ok = asyncio.run(
            torrent_manager.wait_for_first_chunk("t-pack", 3, 128, 128, budget=0.5)
        )
    finally:
        del torrent_manager.active_torrents["t-pack"]
    assert ok is True
    assert seen == [(17, 19)], (
        "the wait must offset by the file's position inside the torrent; "
        f"got {seen}"
    )


def test_first_chunk_targets_different_pieces_per_file_index(monkeypatch):
    # The same byte range in file 0 lands on pieces 2..3 — proof that file_at()
    # is consulted rather than the arithmetic happening to work at offset 0.
    ti = _FakeTI(offset={0: 0, 3: 1000}, piece_length=64, num_pieces=200)
    seen = _record_targeted_pieces(monkeypatch)
    torrent_manager.active_torrents["t-pack-0"] = (_FakeHandle(ti, True), {})
    try:
        asyncio.run(
            torrent_manager.wait_for_first_chunk("t-pack-0", 0, 128, 128, budget=0.5)
        )
    finally:
        del torrent_manager.active_torrents["t-pack-0"]
    assert seen == [(2, 3)]


# --------------------------------------------------------------------------
# The budget is swarm-aware, not flat (CRITICAL 1a).
# --------------------------------------------------------------------------

def test_default_budget_comes_from_the_adaptive_timeout(monkeypatch):
    ti = _FakeTI(offset=0, piece_length=64, num_pieces=16)
    calls = []

    def _adaptive(handle, **kw):
        calls.append(handle)
        return 0.5

    monkeypatch.setattr(torrent_manager, "_adaptive_piece_timeout", _adaptive)
    torrent_manager.active_torrents["t-adaptive"] = (_FakeHandle(ti, False), {})
    try:
        ok = asyncio.run(torrent_manager.wait_for_first_chunk("t-adaptive", 0, 0, 128))
    finally:
        del torrent_manager.active_torrents["t-adaptive"]
    assert ok is False
    assert len(calls) == 1, (
        "with no explicit budget the wait must derive one from live swarm status, "
        "not from a constant"
    )


def test_explicit_budget_overrides_the_adaptive_default(monkeypatch):
    ti = _FakeTI(offset=0, piece_length=64, num_pieces=16)

    def _must_not_run(*a, **k):
        raise AssertionError("an explicit budget must not consult the swarm")

    monkeypatch.setattr(torrent_manager, "_adaptive_piece_timeout", _must_not_run)
    torrent_manager.active_torrents["t-explicit"] = (_FakeHandle(ti, False), {})
    try:
        ok = asyncio.run(
            torrent_manager.wait_for_first_chunk("t-explicit", 0, 0, 128, budget=0.5)
        )
    finally:
        del torrent_manager.active_torrents["t-explicit"]
    assert ok is False


def test_dead_swarm_answers_far_sooner_than_the_old_flat_budget():
    # _FakeHandle.status() reports num_peers=0, so the adaptive budget is ~2s.
    # This is the case the 503 was invented for: an honest fast failure. The
    # previous flat 10s would have held the request five times as long — and on a
    # LIVE swarm it would have cut the wait off at 10s and called a slow success
    # a fatal error.
    ti = _FakeTI(offset=0, piece_length=64, num_pieces=16)
    torrent_manager.active_torrents["t-dead"] = (_FakeHandle(ti, False), {})
    t0 = time.monotonic()
    try:
        ok = asyncio.run(torrent_manager.wait_for_first_chunk("t-dead", 0, 0, 128))
    finally:
        del torrent_manager.active_torrents["t-dead"]
    elapsed = time.monotonic() - t0
    assert ok is False
    assert 1.5 <= elapsed < 6.0, f"expected the ~2s dead-swarm budget, waited {elapsed:.1f}s"


# --------------------------------------------------------------------------
# No unguarded libtorrent call before the response starts (CRITICAL 2).
# --------------------------------------------------------------------------

class _InvalidatedHandle:
    """libtorrent raises this from every method once the handle is invalid, which
    _block_torrent makes a live race: it calls session.remove_torrent(handle)
    BEFORE popping active_torrents."""

    def has_metadata(self):
        raise RuntimeError("invalid torrent handle")

    def get_torrent_info(self):
        raise RuntimeError("invalid torrent handle")

    def status(self):
        raise RuntimeError("invalid torrent handle")


def test_invalidated_handle_degrades_to_true_instead_of_raising():
    # An exception escaping here reaches stream_video's catch-all BEFORE the
    # response starts, so it is served as a body rather than truncating one.
    # "Let the generator deal with it" is the correct degradation.
    torrent_manager.active_torrents["t-invalid"] = (_InvalidatedHandle(), {})
    try:
        ok = asyncio.run(
            torrent_manager.wait_for_first_chunk("t-invalid", 0, 0, 128, budget=0.5)
        )
    finally:
        del torrent_manager.active_torrents["t-invalid"]
    assert ok is True


def test_endpoint_does_not_500_when_the_handle_goes_invalid(stub_video, monkeypatch):
    # End-to-end shape of the same race, scoped to the PRE-RESPONSE path: the real
    # wait_for_first_chunk runs against an invalidated handle. Before the fix that
    # raised RuntimeError into stream_video's catch-all and was answered with a
    # JSON 500 body — i.e. a JSON document handed to a media decoder. The generator
    # is stubbed out because its own has_metadata() call is a different (already
    # documented) case: it runs after the status line, so it truncates.
    async def _bytes(*a, **k):
        yield b"X" * 100

    monkeypatch.setattr(streaming_api.torrent_manager, "stream_file_range", _bytes)
    torrent_manager.active_torrents["tid-1"] = (_InvalidatedHandle(), {})
    try:
        r = client.get(
            "/api/v1/streaming/tid-1/video", headers={"Range": "bytes=0-99"}
        )
    finally:
        torrent_manager.active_torrents.pop("tid-1", None)
    assert r.status_code == 206
    assert r.headers["Content-Range"] == "bytes 0-99/4096"
