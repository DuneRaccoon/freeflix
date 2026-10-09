"""Media identity (tmdb_id / media_type / season / episode) on the torrent status wire shape.

The columns already exist on the ``torrents`` table. These fields let a client tell
"already downloading" from "never requested" -- POST /torrents/download mints a fresh
uuid4 and add_torrent does no magnet/infohash dedupe. They must be Optional: rows written
before the columns existed have them NULL and ``sync_columns`` never backfills.

Two conversion paths exist and both are covered: ``TorrentStatus.model_validate(row)``
(from_attributes) and ``Torrent.to_status()``, which builds the model field by field and
is what the manager and every endpoint actually use.
"""
import os
os.environ.setdefault("DB_PATH", "/tmp/test_torrent_identity_fields.db")

import types
from datetime import datetime

import pytest
from fastapi.testclient import TestClient

import app.api.torrents as torrents_api
from app.database.models.torrents import Torrent
from app.main import app
from app.models import TorrentStatus

KEYS = ("tmdb_id", "media_type", "season", "episode")


def _attrs(**identity):
    now = datetime(2026, 1, 1)
    return dict(
        id="t1", movie_title="Show S01E03", quality="1080p", state="downloading",
        magnet="magnet:?xt=urn:btih:abc", progress=0.5, save_path="/x",
        created_at=now, updated_at=now, error_message=None, block_reason=None,
        meta_data=None, **identity,
    )


def _row(**identity):
    return Torrent(**_attrs(**identity))


def test_model_validate_carries_identity():
    ns = types.SimpleNamespace(
        **{**_attrs(tmdb_id=1399, media_type="tv", season=1, episode=3),
           "state": "downloading"}
    )
    s = TorrentStatus.model_validate(ns)
    assert (s.tmdb_id, s.media_type, s.season, s.episode) == (1399, "tv", 1, 3)


def test_old_shaped_row_validates_with_none():
    # A row that predates the columns: no such attributes at all, not even None.
    ns = types.SimpleNamespace(
        id="t1", movie_title="Old", quality="720p", state="finished",
        save_path="/x", created_at=datetime(2020, 1, 1), updated_at=datetime(2020, 1, 1),
    )
    s = TorrentStatus.model_validate(ns)
    dumped = s.model_dump()
    assert all(k in dumped and dumped[k] is None for k in KEYS)


def test_to_status_carries_identity_for_tv_row():
    s = _row(tmdb_id=1399, media_type="tv", season=1, episode=3).to_status()
    assert (s.tmdb_id, s.media_type, s.season, s.episode) == (1399, "tv", 1, 3)


def test_to_status_movie_row_has_no_season_or_episode():
    s = _row(tmdb_id=603, media_type="movie", season=None, episode=None).to_status()
    assert (s.tmdb_id, s.media_type) == (603, "movie")
    assert s.season is None and s.episode is None


def test_to_status_null_identity_row_serialises_none():
    s = _row(tmdb_id=None, media_type=None, season=None, episode=None).to_status()
    dumped = s.model_dump()
    assert all(k in dumped and dumped[k] is None for k in KEYS)


@pytest.fixture()
def client(monkeypatch):
    fake = types.SimpleNamespace(rows={})
    fake.get_torrent_status = lambda tid: fake.rows.get(tid)
    fake.get_all_torrents = lambda: list(fake.rows.values())
    monkeypatch.setattr(torrents_api, "torrent_manager", fake)
    with TestClient(app) as c:
        c.fake = fake
        yield c


def test_status_endpoint_includes_identity_keys(client):
    client.fake.rows["t1"] = _row(
        tmdb_id=1399, media_type="tv", season=1, episode=3
    ).to_status()
    body = client.get("/api/v1/torrents/status/t1").json()
    assert {k: body[k] for k in KEYS} == {
        "tmdb_id": 1399, "media_type": "tv", "season": 1, "episode": 3,
    }


def test_status_endpoint_movie_row(client):
    client.fake.rows["m1"] = _row(tmdb_id=603, media_type="movie").to_status()
    body = client.get("/api/v1/torrents/status/m1").json()
    assert body["media_type"] == "movie" and body["tmdb_id"] == 603
    assert body["season"] is None and body["episode"] is None


def test_list_endpoint_includes_identity_keys_for_old_rows(client):
    client.fake.rows["old"] = _row().to_status()
    items = client.get("/api/v1/torrents/list").json()
    assert len(items) == 1
    assert all(k in items[0] and items[0][k] is None for k in KEYS)
