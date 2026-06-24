import os
os.environ.setdefault("DB_PATH", "/tmp/test_download_select.db")

import types
import pytest
from fastapi.testclient import TestClient

import app.api.torrents as torrents_api
from app.models import TorrentHit
from app.providers.quality import parse_quality
from app.main import app


def _hit(title, seeds, byts=1000):
    return TorrentHit(title=title, seeds=seeds, peers=0, bytes=byts,
                      magnet=f"magnet:?xt=urn:btih:{abs(hash(title)) % (16**16):016x}",
                      hash="", quality=parse_quality(title))


@pytest.fixture()
def client(monkeypatch):
    state = types.SimpleNamespace(added=[])

    async def fake_resolve(tmdb_id):
        return "Movie", 2020

    async def fake_torrents(name):
        # No 1080p; a healthy 720p exists (downgrade target) + a dead 1080p
        return [_hit("Movie.2020.720p.WEB", 30), _hit("Movie.2020.1080p.Dead", 0)]

    async def fake_add(dl_movie, dl_torrent, save_path=None):
        state.added.append(dl_torrent)
        return "tid-1"

    def fake_status(tid):
        return types.SimpleNamespace(
            id=tid, movie_title="Movie", quality="720p",
            state="downloading", magnet="magnet:?x", progress=0.0,
            download_rate=0.0, upload_rate=0.0, total_downloaded=0,
            total_uploaded=0, num_peers=0, save_path="/x",
            created_at=__import__("datetime").datetime.utcnow(),
            updated_at=__import__("datetime").datetime.utcnow(),
            eta=None, error_message=None, chosen_quality=None,
        )

    monkeypatch.setattr(torrents_api.movie_service, "resolve_title_year", fake_resolve)
    monkeypatch.setattr(torrents_api.catalog, "torrents", fake_torrents)
    monkeypatch.setattr(torrents_api.torrent_manager, "add_torrent", fake_add)
    monkeypatch.setattr(torrents_api.torrent_manager, "get_torrent_status", fake_status)
    with TestClient(app) as c:
        c.state = state
        yield c


def test_download_auto_downgrades_instead_of_422(client):
    # Asked for 1080p (only a dead 1080p + healthy 720p exist) -> 720p chosen, no 422
    r = client.post("/api/v1/torrents/download",
                    json={"tmdb_id": 1, "quality": "1080p", "media_type": "movie"})
    assert r.status_code == 200
    assert client.state.added[-1].quality == "720p"


def test_download_explicit_magnet_used_verbatim(client):
    r = client.post("/api/v1/torrents/download", json={
        "tmdb_id": 1, "quality": "1080p", "media_type": "movie",
        "magnet": "magnet:?xt=urn:btih:deadbeefcafebabe0000"})
    assert r.status_code == 200
    assert client.state.added[-1].magnet == "magnet:?xt=urn:btih:deadbeefcafebabe0000"
    assert client.state.added[-1].quality == "1080p"
