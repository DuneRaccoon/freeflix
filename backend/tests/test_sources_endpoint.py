import os
os.environ.setdefault("DB_PATH", "/tmp/test_sources_endpoint.db")

import pytest
from fastapi.testclient import TestClient

import app.api.torrents as torrents_api
from app.models import TorrentCandidate
from app.main import app


def _cand(quality, seeds, health, src):
    return TorrentCandidate(
        source_id=src, magnet=f"magnet:?xt=urn:btih:{src}", quality=quality,
        seeds=seeds, peers=0, bytes=1000, health=health,
        is_season_pack=False, release_title=f"R.{quality}",
    )


@pytest.fixture()
def client(monkeypatch):
    async def fake_movie(tmdb_id, quality):
        return [_cand("1080p", 40, "healthy", "aaa"), _cand("720p", 2, "low", "bbb")]

    async def fake_episode(tmdb_id, season, episode, quality):
        return [_cand("1080p", 10, "healthy", "ccc")]

    monkeypatch.setattr(torrents_api.movie_service, "get_candidates", fake_movie)
    monkeypatch.setattr(torrents_api.tv_service, "episode_candidates", fake_episode)
    with TestClient(app) as c:
        yield c


def test_sources_movie(client):
    r = client.get("/api/v1/torrents/sources", params={"tmdb_id": 1, "quality": "1080p"})
    assert r.status_code == 200
    body = r.json()
    assert body[0]["source_id"] == "aaa" and body[0]["health"] == "healthy"
    assert body[1]["health"] == "low"


def test_sources_episode(client):
    r = client.get("/api/v1/torrents/sources", params={
        "tmdb_id": 5, "quality": "1080p", "media_type": "tv", "season": 1, "episode": 4})
    assert r.status_code == 200
    assert r.json()[0]["source_id"] == "ccc"


def test_sources_tv_requires_season(client):
    r = client.get("/api/v1/torrents/sources", params={
        "tmdb_id": 5, "quality": "1080p", "media_type": "tv"})
    assert r.status_code == 422
