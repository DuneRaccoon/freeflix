"""Every progress write counts as a play: it touches the torrent it points at."""
import os

os.environ.setdefault("DB_PATH", "/tmp/test_progress_touches_torrent.db")

from datetime import datetime

import pytest
from fastapi.testclient import TestClient

from app.database.models import Torrent, User, UserStreamingProgress
from app.database.session import get_db
from app.main import app

FROZEN = datetime(2026, 11, 6, 4, 0, 0)
OLD = datetime(2020, 1, 1, 0, 0, 0)


def _torrent(tid):
    return Torrent(id=tid, movie_title="Film", quality="1080p", magnet="m", url="u",
                   save_path="/tmp/x", state="downloading", last_touched_at=OLD)


@pytest.fixture
def client(db_session, override_get_db, monkeypatch):
    monkeypatch.setattr("app.api.streaming.utcnow", lambda: FROZEN)
    db_session.add(User(id="u1", username="u1", display_name="U"))
    db_session.add_all([_torrent("t1"), _torrent("t2")])
    db_session.commit()
    app.dependency_overrides[get_db] = override_get_db
    yield TestClient(app)
    app.dependency_overrides.clear()


def _touched(db_session):
    db_session.expire_all()
    return {t.id: t.last_touched_at for t in db_session.query(Torrent).all()}


def test_post_progress_touches_its_torrent(client, db_session):
    r = client.post("/api/v1/streaming/progress/u1", json={
        "torrent_id": "t1", "movie_id": "movie:603", "current_time": 10, "percentage": 5})
    assert r.status_code == 200, r.text
    assert _touched(db_session) == {"t1": FROZEN, "t2": OLD}


def test_put_progress_touches_the_rows_torrent(client, db_session):
    db_session.add(UserStreamingProgress(id="p1", user_id="u1", movie_id="movie:603",
                                         torrent_id="t2", percentage=1.0))
    db_session.commit()
    r = client.put("/api/v1/streaming/progress/u1/p1", json={"current_time": 20, "percentage": 6})
    assert r.status_code == 200, r.text
    assert _touched(db_session) == {"t1": OLD, "t2": FROZEN}


def test_put_progress_with_no_torrent_still_saves(client, db_session):
    db_session.add(UserStreamingProgress(id="p1", user_id="u1", movie_id="movie:603",
                                         torrent_id=None, percentage=1.0))
    db_session.commit()
    r = client.put("/api/v1/streaming/progress/u1/p1", json={"current_time": 20, "percentage": 6})
    assert r.status_code == 200, r.text
    assert _touched(db_session) == {"t1": OLD, "t2": OLD}
