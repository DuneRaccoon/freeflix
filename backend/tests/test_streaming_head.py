"""A HEAD probe must answer from metadata only.

Before the HEAD route existed, HEAD /video was a bare 405. Starlette's
Route.__init__ does auto-add HEAD to a GET route, but FastAPI's APIRoute.__init__
never calls super().__init__() — it sets
`self.methods = {method.upper() for method in methods}` directly — so that line
never runs. Verified against the pinned fastapi 0.104.1 / starlette 0.27.0. (An
earlier draft of the spec claimed a HEAD probe ran the full GET handler and could
block for 300s; it did not.)

A 405 is milder than that but still wrong for the target: a TV media pipeline
probes with HEAD before GET and gets a refusal instead of the size and type it
asked for. These tests pin the real contract — headers only, and none of the GET
handler's side effects (prioritize_video_files, force_start_for_stream, the
piece-gated generator) — and pin the defensive registration order that keeps it
true if FastAPI's method handling ever changes.
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


def test_head_404s_when_video_not_ready(monkeypatch):
    # No file_index given, and get_video_file_info returns falsy: this is the
    # "metadata not ready yet" branch, distinct from an explicit bad file_index.
    # HEAD responses (including error ones) carry no body, so only the status
    # code is checkable here -- the detail string is exercised by the GET-path
    # equivalent and by _resolve_video_file's shared branch logic.
    monkeypatch.setattr(
        streaming_api.torrent_manager, "get_video_file_info",
        lambda tid, fi=None: None,
    )
    r = client.head("/api/v1/streaming/tid-head/video")
    assert r.status_code == 404
    assert r.content == b""


def test_head_404s_when_file_missing_on_disk(monkeypatch):
    # Metadata resolves fine, but the file itself isn't on disk (e.g. moved or
    # deleted out from under the torrent).
    info = {"index": 0, "path": "/nonexistent/path/movie.mkv", "size": 4096,
            "downloaded": 1024, "progress": 25.0, "name": "movie.mkv"}
    monkeypatch.setattr(
        streaming_api.torrent_manager, "get_video_file_info",
        lambda tid, fi=None: info,
    )
    r = client.head("/api/v1/streaming/tid-head/video")
    assert r.status_code == 404
    assert r.content == b""


def _video_routes():
    """The registered routes for the streaming /video path, in registration order."""
    return [
        r for r in app.routes
        if getattr(r, "path", "").endswith("/streaming/{torrent_id}/video")
    ]


def test_get_route_does_not_carry_head():
    # Pins the framework fact the route comment relies on: FastAPI's APIRoute does
    # NOT inherit Starlette's automatic `methods.add("HEAD")`, so the GET route
    # answers GET only. If this ever starts failing, FastAPI changed and the
    # registration-order defence below became load-bearing rather than precautionary.
    get_routes = [r for r in _video_routes() if "GET" in (r.methods or set())]
    assert get_routes, "no GET route registered for /streaming/{torrent_id}/video"
    for r in get_routes:
        assert "HEAD" not in (r.methods or set())


def test_head_route_is_registered_above_the_get_route():
    # Starlette matches routes in registration order. Keeping the metadata-only
    # HEAD route first means a probe can never fall into the GET handler even if
    # FastAPI's method handling changes under us.
    routes = _video_routes()
    head_at = [i for i, r in enumerate(routes) if "HEAD" in (r.methods or set())]
    get_at = [i for i, r in enumerate(routes) if "GET" in (r.methods or set())]
    assert head_at and get_at
    assert min(head_at) < min(get_at), "the HEAD route must be declared first"
