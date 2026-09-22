"""Status-code discipline on the /video endpoint.

A raw <video src> hands whatever comes back straight to a decoder, so every
failure here has to be the right status AND an empty body:

- an unsatisfiable range -> 416 + Content-Range: bytes */{size}, not a silent
  clamp that serves the tail under a 206 claiming otherwise;
- a malformed or multipart range -> ignored (200, full body), per RFC 7233 §3.1;
- a file with no bytes yet -> 503 + Retry-After, never 416, which would tell the
  player to give up permanently;
- anything unexpected -> an empty-bodied 503, never a JSON error document.
"""
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


def test_multipart_range_serves_full_body_200(stub_video):
    # RFC 7233 §3.1: an unimplementable/invalid Range must be IGNORED, not 500,
    # and not 416 (which invites the client to give up rather than retry).
    r = client.get(
        "/api/v1/streaming/tid-1/video",
        headers={"Range": "bytes=0-99,200-299"},
    )
    assert r.status_code == 200
    assert "Content-Range" not in r.headers
    assert r.headers["Content-Length"] == "1000"


def test_garbage_range_serves_full_body_200(stub_video):
    r = client.get(
        "/api/v1/streaming/tid-1/video",
        headers={"Range": "bytes=abc-def"},
    )
    assert r.status_code == 200
    assert "Content-Range" not in r.headers


@pytest.fixture
def stub_unallocated_video(tmp_path, monkeypatch):
    """A torrent whose metadata has arrived but whose file has no bytes yet."""
    f = tmp_path / "movie.mkv"
    f.write_bytes(b"")
    info = {"index": 0, "path": str(f), "size": 0,
            "downloaded": 0, "progress": 0.0, "name": "movie.mkv"}
    monkeypatch.setattr(
        streaming_api.torrent_manager, "get_video_file_info",
        lambda tid, fi=None: info,
    )
    monkeypatch.setattr(
        streaming_api.torrent_manager, "get_torrent_status",
        lambda tid: types.SimpleNamespace(progress=0.0),
    )
    monkeypatch.setattr(
        streaming_api.torrent_manager, "prioritize_video_files", lambda *a, **k: True)
    monkeypatch.setattr(
        streaming_api.torrent_manager, "force_start_for_stream", lambda *a, **k: True)
    return info


def test_plain_get_on_unallocated_file_is_503_not_416(stub_unallocated_video):
    # No Range header at all. 416 is only meaningful in reply to a Range request,
    # and it tells <video> to give up for good — over a file that is seconds away
    # from having bytes.
    r = client.get("/api/v1/streaming/tid-1/video")
    assert r.status_code == 503
    assert r.headers["Retry-After"] == "2"
    assert "Content-Range" not in r.headers
    assert r.content == b""


def test_ranged_get_on_unallocated_file_is_also_503(stub_unallocated_video):
    r = client.get(
        "/api/v1/streaming/tid-1/video",
        headers={"Range": "bytes=0-1023"},
    )
    assert r.status_code == 503
    assert r.headers["Retry-After"] == "2"


def test_unexpected_failure_returns_an_empty_bodied_503_not_json(stub_video, monkeypatch):
    # The catch-all used to raise HTTPException(500), i.e. a JSON document served
    # into a decoder by a raw <video src> — the exact defect class the byte-path
    # work exists to remove. It must be empty-bodied, and retryable.
    def _boom(*a, **k):
        raise RuntimeError("invalid torrent handle")

    monkeypatch.setattr(streaming_api.torrent_manager, "get_torrent_status", _boom)
    r = client.get("/api/v1/streaming/tid-1/video")
    assert r.status_code == 503
    assert r.headers["Retry-After"] == "2"
    assert r.content == b""
    assert "application/json" not in r.headers.get("Content-Type", "")
