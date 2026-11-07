"""``vacuum`` on /torrents/list and /torrents/status/{id} (Part D, D6).

Both endpoints hand their statuses to ``fill_vacuum``; a row with autovacuum off still
carries ``{"status": "off", "deletes_at": null}`` rather than being absent.
"""
import os
os.environ.setdefault("DB_PATH", "/tmp/test_vacuum_status_fields.db")

import types
from datetime import datetime, timedelta

import pytest
from fastapi.testclient import TestClient

import app.api.torrents as torrents_api
from app.database.models import Torrent
from app.database.models.accounts import INSTANCE_SINGLETON_ID, Instance
from app.database.session import get_db
from app.main import app
from app.services.torrent_touch import utcnow


def _aware(s):
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


@pytest.fixture()
def world(db_session, override_get_db, monkeypatch):
    monkeypatch.setattr("app.services.vacuum.get_db", override_get_db)
    app.dependency_overrides[get_db] = override_get_db
    db_session.add(Instance(id=INSTANCE_SINGLETON_ID, autovacuum_enabled=True))
    db_session.add(Torrent(
        id="expired", movie_title="Expired", quality="1080p", state="finished",
        magnet="magnet:?xt=urn:btih:expired", url="", save_path="downloads/expired",
        last_touched_at=utcnow() - timedelta(days=31),
    ))
    db_session.commit()
    rows = {"expired": db_session.query(Torrent).get("expired")}
    fake = types.SimpleNamespace(active_torrents={})
    fake.get_torrent_status = lambda tid: rows[tid].to_status()
    fake.get_all_torrents = lambda: [r.to_status() for r in rows.values()]
    monkeypatch.setattr(torrents_api, "torrent_manager", fake)
    with TestClient(app) as c:
        c.db = db_session
        yield c
    app.dependency_overrides.pop(get_db, None)


def test_list_carries_the_countdown(world):
    v = world.get("/api/v1/torrents/list").json()[0]["vacuum"]
    assert v["status"] == "scheduled"
    when = _aware(v["deletes_at"])
    assert when.utcoffset() == timedelta(0) and when.astimezone().hour == 4


def test_status_carries_the_countdown(world):
    assert world.get("/api/v1/torrents/status/expired").json()["vacuum"]["status"] == "scheduled"


def test_disabled_is_reported_as_off_not_absent(world):
    world.db.query(Instance).update({"autovacuum_enabled": False})
    world.db.commit()
    assert world.get("/api/v1/torrents/list").json()[0]["vacuum"] == {
        "status": "off", "deletes_at": None}


def _vacuum_breaks(monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("vacuum evaluator failed")
    # Inside fill_vacuum, so the endpoints' own call is what must survive it.
    monkeypatch.setattr("app.services.vacuum._evaluate", boom)


def test_a_failing_vacuum_evaluation_never_fails_a_status_poll(world, monkeypatch):
    # /status is the play path's health signal: the vacuum line is decoration.
    _vacuum_breaks(monkeypatch)
    r = world.get("/api/v1/torrents/status/expired")
    assert r.status_code == 200, r.text
    assert r.json()["id"] == "expired"
    assert r.json()["vacuum"] is None


def test_a_failing_vacuum_evaluation_never_fails_the_list(world, monkeypatch):
    _vacuum_breaks(monkeypatch)
    r = world.get("/api/v1/torrents/list")
    assert r.status_code == 200, r.text
    assert [(t["id"], t["vacuum"]) for t in r.json()] == [("expired", None)]


def test_status_reads_only_the_handle_it_was_asked_about(world):
    # A poll reads its own handle, not every loaded one.
    read = []

    def handle(tid):
        def status():
            read.append(tid)
            return types.SimpleNamespace(download_rate=0, download_payload_rate=0,
                                         is_seeding=False, is_finished=True)
        return (types.SimpleNamespace(status=status), {})

    torrents_api.torrent_manager.active_torrents.update(
        {"expired": handle("expired"), "other": handle("other")})
    assert world.get("/api/v1/torrents/status/expired").status_code == 200
    assert read == ["expired"]
