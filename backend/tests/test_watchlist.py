"""Tests for the UserWatchlist model and /watchlist endpoints."""
import os
os.environ.setdefault("DB_PATH", "/tmp/test_watchlist.db")

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database.session import Base, get_db
from app.database.models.watchlist import UserWatchlist
from app.database.models.users import User
from app.main import app

# --------------------------------------------------------------------------- #
# Fixtures
# --------------------------------------------------------------------------- #

@pytest.fixture(scope="module")
def db_engine(tmp_path_factory):
    """Create an in-memory SQLite engine for the test session."""
    db_file = tmp_path_factory.mktemp("data") / "watchlist_test.db"
    engine = create_engine(
        f"sqlite:///{db_file}",
        connect_args={"check_same_thread": False},
    )
    Base.metadata.create_all(bind=engine)
    yield engine
    engine.dispose()


@pytest.fixture(scope="module")
def db_session(db_engine):
    """Return a single session for the entire test module."""
    SessionLocal = sessionmaker(bind=db_engine, autocommit=False, autoflush=False)
    session = SessionLocal()
    yield session
    session.close()


@pytest.fixture(scope="module")
def test_user(db_session):
    """Create a user row and return its id."""
    from app.database.mixins import generate_uuid
    uid = generate_uuid()
    user = User(id=uid, username="wl_test_user", display_name="Watchlist Tester")
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user


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
# Model-level tests (no HTTP)
# --------------------------------------------------------------------------- #

def test_watchlist_table_has_expected_columns():
    cols = {c.name for c in UserWatchlist.__table__.columns}
    assert {"id", "user_id", "content_id", "tmdb_id", "media_type", "title", "added_at"} <= cols


def test_watchlist_find_returns_none_when_missing(db_session, test_user):
    result = UserWatchlist.find(db_session, test_user.id, "movie:99999")
    assert result is None


def test_watchlist_add_and_find(db_session, test_user):
    entry = UserWatchlist(
        user_id=test_user.id,
        content_id="movie:603",
        tmdb_id="603",
        media_type="movie",
        title="The Matrix",
    )
    db_session.add(entry)
    db_session.commit()

    found = UserWatchlist.find(db_session, test_user.id, "movie:603")
    assert found is not None
    assert found.tmdb_id == "603"
    assert found.media_type == "movie"
    assert found.title == "The Matrix"


def test_added_at_callable_default_produces_distinct_timestamps(db_session, test_user):
    """added_at default must be a callable so two separate inserts get different timestamps."""
    import time

    e1 = UserWatchlist(
        user_id=test_user.id,
        content_id="movie:777",
        tmdb_id="777",
        media_type="movie",
        title="First",
    )
    db_session.add(e1)
    db_session.commit()
    db_session.refresh(e1)
    ts1 = e1.added_at

    # Small sleep to ensure OS clock advances
    time.sleep(0.01)

    e2 = UserWatchlist(
        user_id=test_user.id,
        content_id="movie:888",
        tmdb_id="888",
        media_type="movie",
        title="Second",
    )
    db_session.add(e2)
    db_session.commit()
    db_session.refresh(e2)
    ts2 = e2.added_at

    # If default were evaluated once at import, both timestamps would be equal
    assert ts1 != ts2, "added_at default must be a callable, not a pre-evaluated value"


def test_watchlist_get_for_user_returns_entries(db_session, test_user):
    entries = UserWatchlist.get_for_user(db_session, test_user.id)
    assert len(entries) >= 1
    assert all(e.user_id == test_user.id for e in entries)


def test_watchlist_ordering_newest_first_with_tiebreaker(db_session, test_user):
    """Entries with the same added_at timestamp must be stable (id desc tiebreaker)."""
    import datetime

    # Insert two entries with an identical timestamp to exercise the tiebreaker
    shared_ts = datetime.datetime(2024, 1, 1, 0, 0, 0)
    e1 = UserWatchlist(
        user_id=test_user.id,
        content_id="movie:11",
        tmdb_id="11",
        media_type="movie",
        title="Star Wars",
        added_at=shared_ts,
    )
    e2 = UserWatchlist(
        user_id=test_user.id,
        content_id="movie:22",
        tmdb_id="22",
        media_type="movie",
        title="Empire Strikes Back",
        added_at=shared_ts,
    )
    db_session.add(e1)
    db_session.add(e2)
    db_session.commit()
    db_session.refresh(e1)
    db_session.refresh(e2)

    entries = UserWatchlist.get_for_user(db_session, test_user.id)
    tied = [e for e in entries if e.added_at == shared_ts]
    assert len(tied) == 2

    # id desc: whichever id sorts later should appear first
    ids = [e.id for e in tied]
    assert ids == sorted(ids, reverse=True), "tied entries must be ordered by id desc"


# --------------------------------------------------------------------------- #
# HTTP endpoint tests
# --------------------------------------------------------------------------- #

def test_add_to_watchlist(client, test_user):
    resp = client.post(
        f"/api/v1/watchlist/{test_user.id}/add",
        json={
            "content_id": "tv:1399",
            "tmdb_id": "1399",
            "media_type": "tv",
            "title": "Game of Thrones",
        },
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["content_id"] == "tv:1399"
    assert data["media_type"] == "tv"
    assert data["user_id"] == test_user.id


def test_add_dedupe_returns_409(client, test_user):
    resp = client.post(
        f"/api/v1/watchlist/{test_user.id}/add",
        json={
            "content_id": "tv:1399",
            "tmdb_id": "1399",
            "media_type": "tv",
            "title": "Game of Thrones",
        },
    )
    assert resp.status_code == 409


def test_get_watchlist_returns_items(client, test_user):
    resp = client.get(f"/api/v1/watchlist/{test_user.id}")
    assert resp.status_code == 200
    items = resp.json()
    assert isinstance(items, list)
    content_ids = [i["content_id"] for i in items]
    assert "tv:1399" in content_ids


def test_remove_from_watchlist(client, test_user):
    resp = client.delete(f"/api/v1/watchlist/{test_user.id}/tv:1399")
    assert resp.status_code == 200

    # Confirm it's gone
    resp2 = client.get(f"/api/v1/watchlist/{test_user.id}")
    assert resp2.status_code == 200
    content_ids = [i["content_id"] for i in resp2.json()]
    assert "tv:1399" not in content_ids


def test_remove_nonexistent_returns_404(client, test_user):
    resp = client.delete(f"/api/v1/watchlist/{test_user.id}/tv:1399")
    assert resp.status_code == 404


def test_get_watchlist_unknown_user_returns_404(client):
    resp = client.get("/api/v1/watchlist/no-such-user")
    assert resp.status_code == 404


def test_add_unknown_user_returns_404(client):
    resp = client.post(
        "/api/v1/watchlist/no-such-user/add",
        json={
            "content_id": "movie:123",
            "tmdb_id": "123",
            "media_type": "movie",
        },
    )
    assert resp.status_code == 404


def test_watchlist_table_has_metadata_columns():
    cols = {c.name for c in UserWatchlist.__table__.columns}
    assert {"poster_url", "year", "vote_average"} <= cols


def test_add_persists_and_returns_metadata(client, test_user):
    resp = client.post(
        f"/api/v1/watchlist/{test_user.id}/add",
        json={
            "content_id": "movie:550",
            "tmdb_id": "550",
            "media_type": "movie",
            "title": "Fight Club",
            "poster_url": "https://image.tmdb.org/t/p/w500/fc.jpg",
            "year": 1999,
            "vote_average": 8.4,
        },
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["poster_url"] == "https://image.tmdb.org/t/p/w500/fc.jpg"
    assert data["year"] == 1999
    assert data["vote_average"] == 8.4


def test_patch_updates_metadata(client, test_user):
    client.post(
        f"/api/v1/watchlist/{test_user.id}/add",
        json={"content_id": "movie:680", "tmdb_id": "680",
              "media_type": "movie", "title": "Pulp Fiction"},
    )
    resp = client.patch(
        f"/api/v1/watchlist/{test_user.id}/movie:680",
        json={"poster_url": "https://image.tmdb.org/t/p/w500/pf.jpg",
              "year": 1994, "vote_average": 8.5},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["poster_url"] == "https://image.tmdb.org/t/p/w500/pf.jpg"
    assert data["year"] == 1994
    assert data["vote_average"] == 8.5
    assert data["title"] == "Pulp Fiction"
    assert data["content_id"] == "movie:680"
    assert data["media_type"] == "movie"


def test_patch_unknown_returns_404(client, test_user):
    resp = client.patch(
        f"/api/v1/watchlist/{test_user.id}/movie:000000",
        json={"poster_url": "x"},
    )
    assert resp.status_code == 404
