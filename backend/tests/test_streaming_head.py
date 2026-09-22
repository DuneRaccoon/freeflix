"""A HEAD probe must answer from metadata only.

Starlette auto-adds HEAD to GET routes, so HEAD /video used to run the full GET
handler: prioritize_video_files + force_start_for_stream (a DB write) and then the
piece-gated generator, which can block for up to 300s before the body is thrown
away. TV media pipelines probe with HEAD before GET.
"""
import types
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.api import streaming as streaming_api

client = TestClient(app)


@pytest.fixture
def stub_video(tmp_path, monkeypatch):
    f = tmp_path / "movie.mkv"
    f.write_bytes(b"X" * 4096)
    info = {"index": 0, "path": str(f), "size": 4096,
            "downloaded": 1024, "progress": 25.0, "name": "movie.mkv"}
    calls = {"prioritize": 0, "force_start": 0}

    monkeypatch.setattr(
        streaming_api.torrent_manager, "get_video_file_info",
        lambda tid, fi=None: info,
    )
    monkeypatch.setattr(
        streaming_api.torrent_manager, "get_torrent_status",
        lambda tid: types.SimpleNamespace(progress=25.0),
    )

    def _prioritize(*a, **k):
        calls["prioritize"] += 1
        return True

    def _force_start(*a, **k):
        calls["force_start"] += 1
        return True

    monkeypatch.setattr(streaming_api.torrent_manager, "prioritize_video_files", _prioritize)
    monkeypatch.setattr(streaming_api.torrent_manager, "force_start_for_stream", _force_start)
    return calls


def test_head_returns_metadata_headers(stub_video):
    r = client.head("/api/v1/streaming/tid-head/video")
    assert r.status_code == 200
    assert r.headers["Accept-Ranges"] == "bytes"
    assert r.headers["Content-Length"] == "4096"
    assert r.headers["Content-Type"] == "video/x-matroska"
    assert r.content == b""


def test_head_does_not_touch_the_torrent(stub_video):
    client.head("/api/v1/streaming/tid-head/video")
    assert stub_video["prioritize"] == 0, "HEAD must not recompute file priorities"
    assert stub_video["force_start"] == 0, "HEAD must not force-start the torrent"


def test_head_404s_for_unknown_file_index(stub_video, monkeypatch):
    monkeypatch.setattr(
        streaming_api.torrent_manager, "get_video_file_info",
        lambda tid, fi=None: None,
    )
    r = client.head("/api/v1/streaming/tid-head/video?file_index=7")
    assert r.status_code == 404
