"""Tests for GET /api/v1/activity/count."""
import os
os.environ.setdefault("DB_PATH", "/tmp/test_activity.db")

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database.session import Base, get_db
from app.database.models import Torrent as DbTorrent
from app.main import app


# --------------------------------------------------------------------------- #
# Fixtures
# --------------------------------------------------------------------------- #

@pytest.fixture(scope="module")
def db_engine(tmp_path_factory):
    """In-memory SQLite engine scoped to the test module."""
    db_file = tmp_path_factory.mktemp("data") / "activity_test.db"
    engine = create_engine(
        f"sqlite:///{db_file}",
        connect_args={"check_same_thread": False},
    )
    Base.metadata.create_all(bind=engine)
    yield engine
    engine.dispose()


@pytest.fixture(scope="module")
def db_session(db_engine):
    SessionLocal = sessionmaker(bind=db_engine, autocommit=False, autoflush=False)
    session = SessionLocal()
    yield session
    session.close()


@pytest.fixture(scope="module")
def client(db_engine):
    """TestClient with get_db overridden to use the test engine."""
    from contextlib import contextmanager
    from sqlalchemy.orm import sessionmaker as sm

    TestSession = sm(bind=db_engine, autocommit=False, autoflush=False)

    @contextmanager
    def override_get_db():
        session = TestSession()
        try:
            yield session
            session.commit()
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #

def _make_torrent(session, state: str, progress: float = 0.0):
    """Insert a minimal Torrent row and return it."""
    t = DbTorrent(
        movie_title=f"Test ({state})",
        quality="1080p",
        magnet="magnet:?xt=test",
        url="http://example.com/test.torrent",
        save_path="/tmp/test",
        state=state,
        progress=progress,
    )
    session.add(t)
    session.commit()
    session.refresh(t)
    return t


# --------------------------------------------------------------------------- #
# Response shape test (no seeds needed)
# --------------------------------------------------------------------------- #

def test_count_response_shape(client):
    """GET /count always returns the expected JSON shape."""
    resp = client.get("/api/v1/activity/count")
    assert resp.status_code == 200
    data = resp.json()
    assert "active_downloads" in data
    assert "aggregate_progress" in data
    assert isinstance(data["active_downloads"], int)
    assert isinstance(data["aggregate_progress"], float)


# --------------------------------------------------------------------------- #
# Zero active torrents
# --------------------------------------------------------------------------- #

def test_count_zero_when_no_active(client):
    resp = client.get("/api/v1/activity/count")
    assert resp.status_code == 200
    data = resp.json()
    assert data["active_downloads"] == 0
    assert data["aggregate_progress"] == 0.0


# --------------------------------------------------------------------------- #
# Seeded active torrents
# --------------------------------------------------------------------------- #

def test_count_reflects_active_torrents(client, db_session):
    """Active states should be counted; terminal states must not."""
    _make_torrent(db_session, "downloading", 40.0)
    _make_torrent(db_session, "queued", 0.0)
    _make_torrent(db_session, "finished", 100.0)   # terminal — must NOT count
    _make_torrent(db_session, "error", 50.0)        # terminal — must NOT count

    resp = client.get("/api/v1/activity/count")
    assert resp.status_code == 200
    data = resp.json()

    assert data["active_downloads"] == 2   # only downloading + queued
    assert data["aggregate_progress"] == pytest.approx(20.0, abs=0.1)  # (40+0)/2


def test_paused_torrent_not_counted(client, db_session):
    """A paused torrent must NOT increment the active-download badge."""
    from app.api.activity import ACTIVE_STATES

    # Baseline: wipe existing active rows so only our paused torrent exists
    db_session.query(DbTorrent).filter(DbTorrent.state.in_(ACTIVE_STATES)).delete(
        synchronize_session=False
    )
    db_session.query(DbTorrent).filter(DbTorrent.state == "paused").delete(
        synchronize_session=False
    )
    db_session.commit()

    _make_torrent(db_session, "paused", 60.0)

    resp = client.get("/api/v1/activity/count")
    assert resp.status_code == 200
    data = resp.json()
    assert data["active_downloads"] == 0, "paused torrent must not count as active"
    assert data["aggregate_progress"] == 0.0


def test_count_all_active_states(client, db_session):
    """Every active state should appear in the count."""
    from app.api.activity import ACTIVE_STATES

    # Wipe active rows from previous test first
    db_session.query(DbTorrent).filter(DbTorrent.state.in_(ACTIVE_STATES)).delete(
        synchronize_session=False
    )
    db_session.commit()

    for state in ACTIVE_STATES:
        _make_torrent(db_session, state, 50.0)

    resp = client.get("/api/v1/activity/count")
    assert resp.status_code == 200
    data = resp.json()
    assert data["active_downloads"] == len(ACTIVE_STATES)
    assert data["aggregate_progress"] == pytest.approx(50.0, abs=0.1)


def test_count_includes_max_active_downloads(client):
    resp = client.get("/api/v1/activity/count")
    assert resp.status_code == 200
    data = resp.json()
    assert "max_active_downloads" in data
    assert isinstance(data["max_active_downloads"], int)
    assert data["max_active_downloads"] >= 1
