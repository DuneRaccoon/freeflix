import pytest
from app.models import TorrentHit, TorrentCandidate
from app.providers.quality import parse_quality
from app.services import movies as movie_service
from app.services import tv as tv_service


def _hit(title, seeds, byts=1000):
    return TorrentHit(title=title, seeds=seeds, peers=0, bytes=byts,
                      magnet=f"magnet:?xt=urn:btih:{abs(hash(title)) % (16**16):016x}",
                      hash="", quality=parse_quality(title))


@pytest.mark.asyncio
async def test_get_candidates_returns_ranked(monkeypatch):
    async def fake_resolve(tmdb_id):
        return "Movie Name", 2020

    async def fake_torrents(name):
        assert name == "Movie Name 2020"
        return [_hit("Movie.2020.1080p.A", 3), _hit("Movie.2020.1080p.B", 40)]

    monkeypatch.setattr(movie_service, "resolve_title_year", fake_resolve)
    monkeypatch.setattr(movie_service.catalog, "torrents", fake_torrents)

    out = await movie_service.get_candidates(123, "1080p")
    assert all(isinstance(c, TorrentCandidate) for c in out)
    assert out[0].seeds == 40 and out[0].health == "healthy"
    assert out[1].seeds == 3 and out[1].health == "low"


@pytest.mark.asyncio
async def test_get_candidates_empty_when_unresolved(monkeypatch):
    async def fake_resolve(tmdb_id):
        return None, None
    monkeypatch.setattr(movie_service, "resolve_title_year", fake_resolve)
    assert await movie_service.get_candidates(999, "1080p") == []


@pytest.mark.asyncio
async def test_episode_candidates_ranked(monkeypatch):
    async def fake_show(tmdb_id):
        return "Show"

    async def fake_torrents(name):
        assert name == "Show S01E04"
        return [_hit("Show.S01E04.720p", 10), _hit("Show.S01E04.1080p", 2)]

    monkeypatch.setattr(tv_service, "resolve_show_name", fake_show)
    monkeypatch.setattr(tv_service.catalog, "torrents", fake_torrents)

    out = await tv_service.episode_candidates(5, 1, 4, "1080p")
    # 1080p is "low" (seeds=2), 720p is "healthy" (seeds=10) -> healthy downgrade first
    assert out[0].quality == "720p" and out[0].is_season_pack is False
