# backend/tests/test_torrents_api.py
import os
os.environ.setdefault("DB_PATH", "/tmp/test_torrents_api.db")

import types
import pytest
from fastapi.testclient import TestClient

import app.api.torrents as torrents_api
from app.main import app


@pytest.fixture()
def client(monkeypatch):
    fake = types.SimpleNamespace(
        pause_calls=[], resume_calls=[], remove_calls=[], all=[],
    )
    fake.pause_torrent = lambda tid: (fake.pause_calls.append(tid) or True)
    fake.resume_torrent = lambda tid: (fake.resume_calls.append(tid) or True)
    fake.remove_torrent = lambda tid, delete_files=False: (
        fake.remove_calls.append((tid, delete_files)) or True
    )
    fake.get_all_torrents = lambda: fake.all
    monkeypatch.setattr(torrents_api, "torrent_manager", fake)
    with TestClient(app) as c:
        c.fake = fake
        yield c


def test_action_pause(client):
    r = client.post("/api/v1/torrents/action/t1", json={"action": "pause"})
    assert r.status_code == 200 and client.fake.pause_calls == ["t1"]


def test_action_stop_aliases_pause(client):
    r = client.post("/api/v1/torrents/action/t2", json={"action": "stop"})
    assert r.status_code == 200 and client.fake.pause_calls == ["t2"]


def test_action_resume(client):
    r = client.post("/api/v1/torrents/action/t3", json={"action": "resume"})
    assert r.status_code == 200 and client.fake.resume_calls == ["t3"]


def test_action_remove_rejected_422(client):
    r = client.post("/api/v1/torrents/action/t4", json={"action": "remove"})
    assert r.status_code == 422  # not in the Literal


def test_delete_passes_delete_files_flag(client):
    r = client.delete("/api/v1/torrents/t5", params={"delete_files": "true"})
    assert r.status_code == 200 and client.fake.remove_calls == [("t5", True)]


def test_batch_resume(client):
    client.fake.all = [
        types.SimpleNamespace(id="a", state=types.SimpleNamespace(value="paused")),
        types.SimpleNamespace(id="b", state=types.SimpleNamespace(value="downloading")),
    ]
    r = client.post("/api/v1/torrents/batch", json={"action": "resume"})
    assert r.status_code == 200
    data = r.json()
    assert data["succeeded"] == 1 and data["results"][0]["id"] == "a"
    assert client.fake.resume_calls == ["a"]
