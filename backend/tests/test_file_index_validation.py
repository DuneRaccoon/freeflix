"""An explicitly-passed file_index that is not a video file in the torrent must
produce a clear 404 — it must NOT silently fall back to the largest file."""
import types
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.api import streaming as streaming_api

client = TestClient(app)


def test_get_video_file_info_returns_none_for_unknown_explicit_index(monkeypatch):
    files = [
        {"index": 0, "path": "/d/a.mkv", "size": 100, "downloaded": 0,
         "progress": 0.0, "name": "a.mkv"},
        {"index": 1, "path": "/d/b.mkv", "size": 999, "downloaded": 0,
         "progress": 0.0, "name": "b.mkv"},
    ]
    from app.torrent.manager import torrent_manager
    monkeypatch.setattr(torrent_manager, "get_video_files", lambda tid: files)
    # explicit, non-existent index -> None (no largest-file fallback)
    assert torrent_manager.get_video_file_info("t", file_index=7) is None
    # explicit, existing index -> that exact file (not the largest)
    assert torrent_manager.get_video_file_info("t", file_index=0)["index"] == 0
    # no index -> largest
    assert torrent_manager.get_video_file_info("t", file_index=None)["index"] == 1


def test_endpoint_404_for_invalid_explicit_index(monkeypatch):
    # An explicit file_index that does not resolve -> 404 with a clear detail.
    monkeypatch.setattr(
        streaming_api.torrent_manager, "get_video_file_info",
        lambda tid, fi=None: None,
    )
    r = client.get("/api/v1/streaming/tid-x/video?file_index=42")
    assert r.status_code == 404
    assert "42" in r.json()["detail"]


def test_endpoint_does_not_fall_back_to_largest_for_explicit_index(monkeypatch):
    """If file_index=42 is invalid, the endpoint must not retry with None and
    stream the largest file — get_video_file_info is called only with 42."""
    calls = []

    def _info(tid, fi=None):
        calls.append(fi)
        return None  # nothing resolves

    monkeypatch.setattr(streaming_api.torrent_manager, "get_video_file_info", _info)
    client.get("/api/v1/streaming/tid-x/video?file_index=42")
    assert calls == [42]  # never re-called with None
