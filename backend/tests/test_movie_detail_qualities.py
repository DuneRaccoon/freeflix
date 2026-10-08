"""movie_service.detail(with_qualities=...) and the route's `with_qualities` parameter."""
import os
os.environ.setdefault("DB_PATH", "/tmp/test_movie_detail_qualities.db")

import pytest
from fastapi.testclient import TestClient

import app.api.movies as movies_api
from app.database.models.catalog import CatalogItemCache
from app.main import app
from app.models import MovieDetail, TorrentHit
from app.providers.quality import parse_quality
from app.services import movies as movie_service

TMDB_ID = 700123


def _hit(title, seeds=10):
    return TorrentHit(title=title, seeds=seeds, peers=0, bytes=1000,
                      magnet=f"magnet:?xt=urn:btih:{abs(hash(title)) % (16**16):016x}",
                      hash="", quality=parse_quality(title))


def _tmdb_detail():
    return MovieDetail(tmdb_id=TMDB_ID, title="Heat", year=1995, overview="o",
                       poster_url="p", backdrop_url="https://img.test/heat.jpg")


@pytest.fixture
def stubs(monkeypatch, override_get_db):
    """Fake TMDB + torrent provider on a throwaway DB; records torrent searches."""
    calls = []

    async def fake_movie_details(tmdb_id):
        return _tmdb_detail()

    async def fake_torrents(name):
        calls.append(name)
        return [_hit("Heat.1995.1080p.BluRay"), _hit("Heat.1995.720p.WEB")]

    monkeypatch.setattr(movie_service.tmdb, "movie_details", fake_movie_details)
    monkeypatch.setattr(movie_service.catalog, "torrents", fake_torrents)
    monkeypatch.setattr(movie_service, "get_db", override_get_db)
    return calls


@pytest.mark.asyncio
async def test_default_searches_torrents_and_fills_qualities(stubs):
    out = await movie_service.detail(TMDB_ID)
    assert stubs == ["Heat 1995"]
    assert set(out.available_qualities) == {"1080p", "720p"}


@pytest.mark.asyncio
async def test_explicit_true_matches_default(stubs):
    out = await movie_service.detail(TMDB_ID, with_qualities=True)
    assert stubs == ["Heat 1995"] and out.available_qualities


@pytest.mark.asyncio
async def test_opt_out_makes_no_torrent_search_but_returns_tmdb_fields(stubs):
    out = await movie_service.detail(TMDB_ID, with_qualities=False)
    assert stubs == []
    assert out.available_qualities == []
    assert out.backdrop_url == "https://img.test/heat.jpg"
    assert out.title == "Heat" and out.year == 1995


@pytest.mark.asyncio
async def test_opt_out_does_not_clobber_cached_torrents_or_detail(stubs, override_get_db):
    await movie_service.detail(TMDB_ID)  # populate the cache the normal way
    await movie_service.detail(TMDB_ID, with_qualities=False)
    with override_get_db() as db:
        row = CatalogItemCache.get_one(db, "movie", TMDB_ID)
        assert len(row.torrents_json) == 2
        assert set(row.detail_json["available_qualities"]) == {"1080p", "720p"}


@pytest.mark.asyncio
async def test_opt_out_still_caches_the_base_item(stubs, override_get_db):
    await movie_service.detail(TMDB_ID, with_qualities=False)
    with override_get_db() as db:
        row = CatalogItemCache.get_one(db, "movie", TMDB_ID)
        assert row is not None and row.backdrop_url == "https://img.test/heat.jpg"
        assert row.torrents_json is None


@pytest.fixture
def route_calls(monkeypatch):
    seen = []

    async def fake_detail(tmdb_id, **kwargs):
        seen.append(kwargs)
        return _tmdb_detail()

    monkeypatch.setattr(movies_api.movie_service, "detail", fake_detail)
    with TestClient(app) as c:
        yield c, seen


def test_route_defaults_to_qualities(route_calls):
    client, seen = route_calls
    assert client.get(f"/api/v1/movies/{TMDB_ID}").status_code == 200
    assert seen == [{"with_qualities": True}]


def test_route_opt_out(route_calls):
    client, seen = route_calls
    assert client.get(f"/api/v1/movies/{TMDB_ID}", params={"with_qualities": "false"}).status_code == 200
    assert seen == [{"with_qualities": False}]
