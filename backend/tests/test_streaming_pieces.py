"""stream_file_range must serve the exact requested byte range, and must only
read pieces that are downloaded.

Regression: the streaming endpoint read torrent files straight off the sparse
disk allocation while downloading, handing the player undownloaded (zero) bytes
-> PIPELINE_ERROR_DECODE / VideoToolbox -12909. stream_file_range now gates each
chunk on piece availability.
"""
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


class _FakeHandle:
    """A handle whose pieces become available after `available_after` checks."""
    def __init__(self, ti, available_after=0):
        self._ti = ti
        self._checks = 0
        self._available_after = available_after
        self.deadlined = []

    def has_metadata(self):
        return True

    def get_torrent_info(self):
        return self._ti

    def set_sequential_download(self, _v):
        pass

    def have_piece(self, _p):
        self._checks += 1
        return self._checks > self._available_after

    def piece_priority(self, _p, _pr):
        pass

    def set_piece_deadline(self, p, _d):
        self.deadlined.append(p)


def _collect(gen):
    return b"".join(gen)


def test_serves_exact_byte_range_when_pieces_available(tmp_path):
    data = bytes(range(256)) * 4  # 1024 bytes
    f = tmp_path / "vid.mp4"
    f.write_bytes(data)

    ti = _FakeTI(offset=0, piece_length=16, num_pieces=64)
    handle = _FakeHandle(ti, available_after=0)  # everything already downloaded
    torrent_manager.active_torrents["t-pieces"] = (handle, {})
    try:
        out = _collect(
            torrent_manager.stream_file_range("t-pieces", 0, str(f), 100, 299, chunk_size=32)
        )
    finally:
        del torrent_manager.active_torrents["t-pieces"]

    assert out == data[100:300]  # inclusive [start, end]


def test_deadlines_pieces_until_available(tmp_path):
    data = b"x" * 512
    f = tmp_path / "vid.mp4"
    f.write_bytes(data)

    ti = _FakeTI(offset=0, piece_length=64, num_pieces=8)
    # First two availability checks report "not yet"; then pieces arrive.
    handle = _FakeHandle(ti, available_after=2)
    torrent_manager.active_torrents["t-wait"] = (handle, {})
    try:
        out = _collect(
            torrent_manager.stream_file_range(
                "t-wait", 0, str(f), 0, 127, chunk_size=128, piece_timeout=5.0
            )
        )
    finally:
        del torrent_manager.active_torrents["t-wait"]

    assert out == data[0:128]
    # It deadlined the pieces it was waiting on.
    assert handle.deadlined, "expected pieces to be deadlined while waiting"


def test_disk_fallback_when_torrent_not_in_session(tmp_path):
    data = b"abcdefghijklmnop"
    f = tmp_path / "done.mp4"
    f.write_bytes(data)

    # "t-gone" is not in active_torrents -> serve straight from disk.
    out = _collect(
        torrent_manager.stream_file_range("t-gone", 0, str(f), 3, 9, chunk_size=4)
    )
    assert out == data[3:10]
