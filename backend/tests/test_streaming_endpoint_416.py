"""The /video endpoint returns HTTP 416 with Content-Range: bytes */{size} for
an unsatisfiable range, instead of silently clamping and serving the tail."""
import os
import types
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.api import streaming as streaming_api
from app.torrent import manager as manager_mod

client = TestClient(app)


@pytest.fixture
def stub_video(tmp_path, monkeypatch):
    f = tmp_path / "movie.mp4"
    f.write_bytes(b"X" * 1000)
    info = {"index": 0, "path": str(f), "size": 1000,
            "downloaded": 1000, "progress": 100.0, "name": "movie.mp4"}

    monkeypatch.setattr(
        streaming_api.torrent_manager, "get_video_file_info",
        lambda tid, fi=None: info,
    )
    monkeypatch.setattr(
        streaming_api.torrent_manager, "get_torrent_status",
        lambda tid: types.SimpleNamespace(progress=100.0),
    )
    monkeypatch.setattr(
        streaming_api.torrent_manager, "prioritize_video_files",
        lambda *a, **k: True,
    )
    return info


def test_unsatisfiable_range_returns_416(stub_video):
    r = client.get(
        "/api/v1/streaming/tid-1/video",
        headers={"Range": "bytes=5000-"},
    )
    assert r.status_code == 416
    assert r.headers["Content-Range"] == "bytes */1000"


def test_satisfiable_range_returns_206(stub_video):
    r = client.get(
        "/api/v1/streaming/tid-1/video",
        headers={"Range": "bytes=0-99"},
    )
    assert r.status_code == 206
    assert r.headers["Content-Range"] == "bytes 0-99/1000"
