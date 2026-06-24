"""Core WS3 guarantee: stream_file_range must NEVER yield bytes for a piece that
is not have_piece(), and on timeout it must END the generator (stop yielding)
rather than serve sparse/zero bytes."""
import asyncio
import types
from app.torrent.manager import torrent_manager


class _FakeFile:
    def __init__(self, offset):
        self.offset = offset


class _FakeTI:
    def __init__(self, offset, piece_length, num_pieces):
        self._offset = offset
        self._pl = piece_length
        self._np = num_pieces

    def file_at(self, i):
        return _FakeFile(self._offset)

    def piece_length(self):
        return self._pl

    def num_pieces(self):
        return self._np


class _NeverReadyHandle:
    """have_piece() is always False -> no chunk may ever be served."""
    def __init__(self, ti, num_peers=0, download_rate=0):
        self._ti = ti
        self._num_peers = num_peers
        self._download_rate = download_rate
        self.read_attempts = 0

    def has_metadata(self):
        return True

    def get_torrent_info(self):
        return self._ti

    def set_sequential_download(self, _v):
        pass

    def have_piece(self, _p):
        return False

    def piece_priority(self, _p, _pr):
        pass

    def set_piece_deadline(self, _p, _d):
        pass

    def status(self):
        return types.SimpleNamespace(
            num_peers=self._num_peers, download_rate=self._download_rate
        )


class _ReadyHandle(_NeverReadyHandle):
    def have_piece(self, _p):
        return True


async def _drain(agen):
    torrent_manager._loop = asyncio.get_running_loop()
    out = []
    async for chunk in agen:
        out.append(chunk)
    return b"".join(out)


def _collect(agen):
    return asyncio.run(_drain(agen))


def test_never_yields_when_pieces_unavailable_and_ends(tmp_path):
    # Disk file is fully allocated (sparse in reality), but no piece is "have".
    data = b"GARBAGE_" * 64  # 512 bytes
    f = tmp_path / "vid.mp4"
    f.write_bytes(data)

    ti = _FakeTI(offset=0, piece_length=64, num_pieces=8)
    handle = _NeverReadyHandle(ti, num_peers=0, download_rate=0)
    torrent_manager.active_torrents["t-never"] = (handle, {})
    try:
        gen = torrent_manager.stream_file_range(
            "t-never", 0, str(f), 0, 511, chunk_size=128
        )
        out = _collect(gen)
    finally:
        del torrent_manager.active_torrents["t-never"]

    # Generator ended cleanly having yielded ZERO bytes — never the sparse data.
    assert out == b""


def test_yields_real_bytes_when_pieces_available(tmp_path):
    data = bytes(range(256)) * 2  # 512 bytes
    f = tmp_path / "vid.mp4"
    f.write_bytes(data)

    ti = _FakeTI(offset=0, piece_length=64, num_pieces=8)
    handle = _ReadyHandle(ti, num_peers=5, download_rate=100_000)
    torrent_manager.active_torrents["t-ready"] = (handle, {})
    try:
        out = _collect(
            torrent_manager.stream_file_range(
                "t-ready", 0, str(f), 100, 299, chunk_size=64
            )
        )
    finally:
        del torrent_manager.active_torrents["t-ready"]

    assert out == data[100:300]


def test_partial_then_unavailable_ends_after_good_chunks(tmp_path):
    """First chunk's pieces are ready, the rest never arrive -> serve the good
    chunk(s), then END without yielding garbage for the unavailable tail."""
    data = b"".join(bytes([i]) * 64 for i in range(8))  # 512 bytes, distinct per piece
    f = tmp_path / "vid.mp4"
    f.write_bytes(data)

    ti = _FakeTI(offset=0, piece_length=64, num_pieces=8)

    class _FirstTwoPiecesHandle(_NeverReadyHandle):
        def have_piece(self, p):
            return p < 2  # only pieces 0 and 1 (first 128 bytes) are ready

    handle = _FirstTwoPiecesHandle(ti, num_peers=2, download_rate=0)
    torrent_manager.active_torrents["t-partial"] = (handle, {})
    try:
        out = _collect(
            torrent_manager.stream_file_range(
                "t-partial", 0, str(f), 0, 511, chunk_size=128
            )
        )
    finally:
        del torrent_manager.active_torrents["t-partial"]

    # Exactly the first 128 bytes (pieces 0-1); nothing past that.
    assert out == data[0:128]
