"""POST /torrents/{id}/prioritize: deadlines the streamed file's initial pieces +
force-starts the torrent so playback can begin ASAP. Best-effort, idempotent.
Regression guard: the route must EXIST (the frontend calls it on every stream
open; it had been 404ing) and must not be shadowed by sibling torrent routes."""
import os
os.environ.setdefault("DB_PATH", "/tmp/test_prioritize_endpoint.db")

import types
import pytest
from fastapi.testclient import TestClient

import app.api.torrents as torrents_api
from app.main import app


@pytest.fixture()
def client(monkeypatch):
    calls = types.SimpleNamespace(prioritized=[], force_started=[])

    def fake_status(tid):
        if tid == "missing":
            return None
        return types.SimpleNamespace(id=tid, state="downloading", progress=2.0)

    monkeypatch.setattr(torrents_api.torrent_manager, "get_torrent_status", fake_status)
    monkeypatch.setattr(torrents_api.torrent_manager, "prioritize_video_files",
                        lambda tid, *a, **k: calls.prioritized.append(tid) or True)
    monkeypatch.setattr(torrents_api.torrent_manager, "force_start_for_stream",
                        lambda tid: calls.force_started.append(tid) or True)
    with TestClient(app) as c:
        c.calls = calls
        yield c


def test_prioritize_route_exists_and_prioritizes(client):
    r = client.post("/api/v1/torrents/tid-1/prioritize", json={"for_streaming": True})
    assert r.status_code == 200, r.text          # the bug: this used to 404 (no route)
    assert r.json()["success"] is True
    assert client.calls.prioritized == ["tid-1"]
    assert client.calls.force_started == ["tid-1"]


def test_prioritize_404_when_torrent_missing(client):
    r = client.post("/api/v1/torrents/missing/prioritize", json={"for_streaming": True})
    assert r.status_code == 404
