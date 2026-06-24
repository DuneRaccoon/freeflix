"""W4 end-to-end: the /video endpoint streams real bytes through the async
stream_file_range generator (StreamingResponse supports async generators)."""
import types
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.api import streaming as streaming_api

client = TestClient(app)


@pytest.fixture
def stub(tmp_path, monkeypatch):
    data = bytes(range(256)) * 4  # 1024 bytes
    f = tmp_path / "movie.mp4"
    f.write_bytes(data)
    info = {"index": 0, "path": str(f), "size": 1024,
            "downloaded": 1024, "progress": 100.0, "name": "movie.mp4"}
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
    # Not in active_torrents -> stream_file_range takes the disk-fallback path
    # (still async, still off-loop reads).
    streaming_api.torrent_manager.active_torrents.pop("tid-async", None)
    return data


def test_async_generator_streams_range(stub):
    r = client.get(
        "/api/v1/streaming/tid-async/video",
        headers={"Range": "bytes=100-299"},
    )
    assert r.status_code == 206
    assert r.headers["Content-Range"] == "bytes 100-299/1024"
    assert r.content == stub[100:300]


def test_async_generator_full_when_no_range(stub):
    r = client.get("/api/v1/streaming/tid-async/video")
    assert r.status_code in (200, 206)
    assert r.content == stub
