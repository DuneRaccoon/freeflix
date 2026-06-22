"""Movie/TV browse routers must forward discover params and fold the legacy `genre` alias."""
import os
os.environ.setdefault("DB_PATH", "/tmp/test_browse_params_api.db")

import pytest
from fastapi.testclient import TestClient

import app.providers.catalog as catalog
from app.models import CatalogPage
from app.main import app


@pytest.fixture()
def client(monkeypatch):
    captured = {}

    async def fake_browse(**kwargs):
        captured.clear()
        captured.update(kwargs)
        return CatalogPage(page=1, results=[], total_pages=0, total_results=0)

    monkeypatch.setattr(catalog, "browse", fake_browse)
    with TestClient(app) as c:
        c.captured = captured
        yield c


def test_movie_genre_alias_folds_to_genres(client):
    r = client.get("/api/v1/movies?genre=28")
    assert r.status_code == 200
    assert client.captured["genres"] == "28"


def test_movie_explicit_genres_wins_over_alias(client):
    r = client.get("/api/v1/movies?genre=28&genres=35")
    assert r.status_code == 200
    assert client.captured["genres"] == "35"


def test_movie_forwards_company_and_collection(client):
    r = client.get("/api/v1/movies?company=420&collection=86311")
    assert r.status_code == 200
    assert client.captured["company"] == "420"
    assert client.captured["collection"] == "86311"


def test_movie_best_year_feed_allowed(client):
    r = client.get("/api/v1/movies?api=best_2025")
    assert r.status_code == 200
    assert client.captured["api"] == "best_2025"


def test_tv_forwards_provider_and_origin(client):
    r = client.get("/api/v1/tv?provider=8&origin=KR")
    assert r.status_code == 200
    assert client.captured["provider"] == "8"
    assert client.captured["origin"] == "KR"
    assert client.captured["mode"] == "tv"


def test_movie_invalid_api_rejected(client):
    r = client.get("/api/v1/movies?api=bogus")
    assert r.status_code == 422


def test_tv_genre_alias_folds_to_genres(client):
    r = client.get("/api/v1/tv?genre=18")
    assert r.status_code == 200
    assert client.captured["genres"] == "18"
    assert client.captured["mode"] == "tv"


def test_tv_invalid_api_rejected(client):
    r = client.get("/api/v1/tv?api=bogus")
    assert r.status_code == 422
