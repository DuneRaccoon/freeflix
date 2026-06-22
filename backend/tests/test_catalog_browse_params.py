"""catalog.browse must emit feed vs discover request shapes correctly."""
import asyncio
import app.providers.catalog as catalog


def _capture(monkeypatch):
    captured = {}

    async def fake_get(params):
        captured.clear()
        captured.update(params)
        return {"page": 1, "results": [], "total_pages": 0, "total_results": 0}

    monkeypatch.setattr(catalog, "_get", fake_get)
    return captured


def test_popular_stays_a_feed(monkeypatch):
    cap = _capture(monkeypatch)
    asyncio.run(catalog.browse(api="popular", mode="movie"))
    assert cap["api"] == "popular"
    assert "genres" not in cap and "genre" not in cap


def test_genre_forces_discover_plural(monkeypatch):
    cap = _capture(monkeypatch)
    asyncio.run(catalog.browse(api="popular", genres="28", mode="movie"))
    assert cap["api"] == "discover"
    assert cap["genres"] == "28"


def test_provider_movie_uses_provider(monkeypatch):
    cap = _capture(monkeypatch)
    asyncio.run(catalog.browse(provider="8", mode="movie"))
    assert cap["api"] == "discover" and cap["provider"] == "8" and "network" not in cap


def test_provider_tv_uses_network(monkeypatch):
    cap = _capture(monkeypatch)
    asyncio.run(catalog.browse(provider="8", mode="tv"))
    assert cap["api"] == "discover" and cap["network"] == "8" and "provider" not in cap


def test_anime_origin_is_genre16_plus_lang_ja(monkeypatch):
    cap = _capture(monkeypatch)
    asyncio.run(catalog.browse(origin="anime", mode="tv"))
    assert cap["api"] == "discover" and cap["genres"] == "16" and cap["lang"] == "ja"
    assert "origin" not in cap


def test_country_origin_passthrough(monkeypatch):
    cap = _capture(monkeypatch)
    asyncio.run(catalog.browse(origin="KR", mode="movie"))
    assert cap["api"] == "discover" and cap["origin"] == "KR"


def test_collection_uses_collection_api_and_id(monkeypatch):
    cap = _capture(monkeypatch)
    asyncio.run(catalog.browse(collection="86311", mode="movie"))
    assert cap["api"] == "collection" and cap["id"] == "86311"


def test_year_forces_discover(monkeypatch):
    cap = _capture(monkeypatch)
    asyncio.run(catalog.browse(api="popular", year=2024, mode="movie"))
    assert cap["api"] == "discover" and cap["year"] == 2024


def test_multi_genre_and_company(monkeypatch):
    cap = _capture(monkeypatch)
    asyncio.run(catalog.browse(genres="28,12", company="420", mode="movie"))
    assert cap["genres"] == "28,12" and cap["company"] == "420"


def test_merge_genre_dedups():
    assert catalog._merge_genre("16", 16) == "16"
    assert catalog._merge_genre(None, 16) == "16"
    assert catalog._merge_genre("28", 16) == "28,16"


def test_collection_response_reads_parts(monkeypatch):
    """The api=collection endpoint returns movies under `parts`, not `results`."""
    async def fake_get(params):
        return {
            "id": 87359, "name": "Mission: Impossible Collection",
            "parts": [
                {"id": 954, "title": "Mission: Impossible", "release_date": "1996-05-22"},
                {"id": 955, "title": "Mission: Impossible II", "release_date": "2000-05-24"},
                {"title": "no id — dropped"},
            ],
        }

    monkeypatch.setattr(catalog, "_get", fake_get)
    page = asyncio.run(catalog.browse(collection="87359", mode="movie"))
    assert page.total_results == 2          # the id-less part is dropped
    assert page.total_pages == 1
    assert page.results[0].tmdb_id == 954
    assert {i.title for i in page.results} == {"Mission: Impossible", "Mission: Impossible II"}
