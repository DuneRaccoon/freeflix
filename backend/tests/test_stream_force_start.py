import os
os.environ.setdefault("DB_PATH", "/tmp/test_stream_force_start.db")

import types
import pytest
from fastapi.testclient import TestClient

import app.api.streaming as streaming_api
from app.main import app


@pytest.fixture()
def client(monkeypatch, tmp_path):
    f = tmp_path / "v.mp4"
    f.write_bytes(b"0" * 2048)
    state = types.SimpleNamespace(forced=[])

    monkeypatch.setattr(streaming_api.torrent_manager, "get_video_file_info",
                        lambda tid, fi=None: {"index": 0, "path": str(f)})

    def fake_status(tid):
        return types.SimpleNamespace(progress=10.0)
    monkeypatch.setattr(streaming_api.torrent_manager, "get_torrent_status", fake_status)
    monkeypatch.setattr(streaming_api.torrent_manager, "prioritize_video_files",
                        lambda tid, file_index=None: True)

    def fake_force(tid):
        state.forced.append(tid)
        return True
    monkeypatch.setattr(streaming_api.torrent_manager, "force_start_for_stream", fake_force)

    def fake_stream(tid, idx, path, start, end, chunk_size=1024 * 1024, **kw):
        yield b"0" * (end - start + 1)
    monkeypatch.setattr(streaming_api.torrent_manager, "stream_file_range", fake_stream)

    with TestClient(app) as c:
        c.state = state
        yield c


def test_stream_force_starts_in_progress_torrent(client):
    r = client.get("/api/v1/streaming/tid-1/video",
                   headers={"Range": "bytes=0-1023"})
    assert r.status_code in (200, 206)
    assert client.state.forced == ["tid-1"]
