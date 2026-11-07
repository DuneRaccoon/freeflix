"""Server-side reuse of a covering download (spec 2026-11-06 section 3.2).

``POST /torrents/download`` without a ``magnet`` returns an existing download of the same
title at the same quality instead of starting another, and ``GET /torrents/for-title``
lists the rows the television may play. Both share ``covers_title`` and ``pack_contains``.
"""

import os

os.environ.setdefault("DB_PATH", "/tmp/test_torrent_reuse.db")

import asyncio
import datetime
import types

import httpx
import pytest
from fastapi.testclient import TestClient

import app.api.torrents as torrents_api
from app.database.models import Torrent
from app.database.session import get_db
from app.main import app
from app.models import TorrentHit
from app.providers.quality import parse_quality
from app.services.torrent_reuse import (
    covers_title, find_reusable, pack_contains, pack_file_index,
)

S1E1 = {"season": 1, "episode": 1}
S1E2 = {"season": 1, "episode": 2}
TWO_EPISODES = {"0": S1E1, "3": S1E2}

OLD = datetime.datetime(2026, 10, 1, 4, 0, 0)
FROZEN = datetime.datetime(2026, 11, 7, 3, 59, 0)


def _row(torrent_id, **kw):
    fields = dict(
        id=torrent_id,
        movie_title=f"Title {torrent_id}",
        quality="1080p",
        magnet=f"magnet:?xt=urn:btih:{torrent_id}",
        url=f"magnet:?xt=urn:btih:{torrent_id}",
        save_path=f"/tmp/{torrent_id}",
        state="finished",
        tmdb_id=1399,
        media_type="tv",
    )
    fields.update(kw)
    return Torrent(**fields)


def _find(session, **kw):
    req = dict(tmdb_id=1399, media_type="tv", season=None, episode=None, quality="1080p")
    req.update(kw)
    return find_reusable(session, **req)


def _pack(torrent_id, episodes, **kw):
    return _row(torrent_id, season=1, episode=None, precomputed_episodes=episodes, **kw)


# ── unit: find_reusable and its predicates ────────────────────────────────────


def test_movie_reuse_requires_the_same_quality(db_session):
    db_session.add(_row("m", tmdb_id=603, media_type="movie"))
    db_session.flush()
    assert _find(db_session, tmdb_id=603, media_type="movie").id == "m"
    assert _find(db_session, tmdb_id=603, media_type="movie", quality="2160p") is None


def test_reuse_matches_the_requested_quality_as_well_as_the_release(db_session):
    db_session.add_all([
        _row("down", tmdb_id=603, media_type="movie", quality="720p",
             requested_quality="1080p"),
        # Legacy: no requested bucket stored, so only its own quality matches.
        _row("legacy", tmdb_id=604, media_type="movie", quality="720p"),
    ])
    db_session.flush()
    assert _find(db_session, tmdb_id=603, media_type="movie", quality="1080p").id == "down"
    assert _find(db_session, tmdb_id=603, media_type="movie", quality="720p").id == "down"
    assert _find(db_session, tmdb_id=603, media_type="movie", quality="2160p") is None
    assert _find(db_session, tmdb_id=604, media_type="movie", quality="1080p") is None
    assert _find(db_session, tmdb_id=604, media_type="movie", quality="720p").id == "legacy"


def test_error_and_blocked_rows_are_never_reused(db_session):
    db_session.add_all([
        _row("e", tmdb_id=603, media_type="movie", state="error"),
        _row("b", tmdb_id=603, media_type="movie", state="blocked"),
    ])
    db_session.flush()
    assert _find(db_session, tmdb_id=603, media_type="movie") is None


def test_pack_covers_an_episode_it_contains(db_session):
    db_session.add(_pack("p", TWO_EPISODES))
    db_session.flush()
    assert _find(db_session, season=1, episode=2).id == "p"
    assert _find(db_session, season=1, episode=3) is None
    assert _find(db_session, season=2, episode=1) is None


def test_pack_without_metadata_is_reused_optimistically(db_session):
    db_session.add(_pack("p", None))
    db_session.flush()
    assert _find(db_session, season=1, episode=3).id == "p"

    db_session.query(Torrent).filter(Torrent.id == "p").update(
        {Torrent.precomputed_episodes: {}}, synchronize_session=False)
    db_session.flush()
    db_session.expire_all()
    assert _find(db_session, season=1, episode=3) is None


def test_single_episode_row_does_not_cover_a_different_episode(db_session):
    db_session.add(_row("e2", season=1, episode=2))
    db_session.flush()
    assert _find(db_session, season=1, episode=3) is None


def test_media_type_must_agree(db_session):
    db_session.add(_row("m", media_type="movie"))
    db_session.flush()
    assert _find(db_session, season=1, episode=1) is None


def test_a_ready_row_beats_a_newer_paused_one(db_session):
    db_session.add(_row("paused", tmdb_id=603, media_type="movie", state="paused",
                        added_at=datetime.datetime(2026, 11, 5)))
    db_session.flush()
    db_session.add(_row("ready", tmdb_id=603, media_type="movie", state="finished",
                        added_at=datetime.datetime(2026, 11, 1)))
    db_session.flush()
    assert _find(db_session, tmdb_id=603, media_type="movie").id == "ready"


def test_newest_ready_row_wins_within_a_rank(db_session):
    # The ids sort against the dates ("a-old" < "b-new"), so the id tie-break alone
    # would pick the older row: only the added_at key picks the newer one.
    db_session.add(_row("a-old", tmdb_id=603, media_type="movie",
                        added_at=datetime.datetime(2026, 11, 1)))
    db_session.flush()
    db_session.add(_row("b-new", tmdb_id=603, media_type="movie",
                        added_at=datetime.datetime(2026, 11, 5)))
    db_session.flush()
    assert _find(db_session, tmdb_id=603, media_type="movie").id == "b-new"


def test_an_undated_row_ranks_below_a_dated_one(db_session):
    # Legacy rows have NULL added_at until the startup stamp; NULL sorts last. The id
    # "a-undated" sorts first, so only the NULL-last key picks the dated row.
    db_session.add(_row("a-undated", tmdb_id=603, media_type="movie", added_at=None))
    db_session.add(_row("b-dated", tmdb_id=603, media_type="movie",
                        added_at=datetime.datetime(2026, 11, 1)))
    db_session.flush()
    assert _find(db_session, tmdb_id=603, media_type="movie").id == "b-dated"


def _ns(**kw):
    fields = dict(tmdb_id=1399, media_type="tv", season=1, episode=None,
                  precomputed_episodes=None)
    fields.update(kw)
    return types.SimpleNamespace(**fields)


def test_pack_contains():
    assert pack_contains(_ns(precomputed_episodes={"0": S1E1}), 1, 1) is True
    assert pack_contains(_ns(precomputed_episodes={"0": S1E1}), 1, 2) is False
    assert pack_contains(_ns(precomputed_episodes=None), 1, 2) is True
    assert pack_contains(_ns(precomputed_episodes={}), 1, 2) is False
    # Only a pack is judged: a single-episode row passes whatever its map says.
    assert pack_contains(_ns(episode=2, precomputed_episodes={}), 1, 2) is True
    assert pack_contains(_ns(episode=2, precomputed_episodes={"0": S1E1}), 1, 2) is True


def test_pack_file_index():
    assert pack_file_index(_ns(precomputed_episodes=TWO_EPISODES), 1, 2) == 3
    assert pack_file_index(_ns(precomputed_episodes={"3": S1E2, "4": S1E2}), 1, 2) is None


# Row identity, request, expected -- one row per branch of covers_title.
_MOVIE = dict(tmdb_id=603, media_type="movie", season=None, episode=None)
COVERS_TABLE = [
    # tmdb_id disagrees
    (dict(_MOVIE, tmdb_id=604), dict(tmdb_id=603, media_type="movie"), False),
    # media_type disagrees
    (dict(_MOVIE, media_type="tv"), dict(tmdb_id=603, media_type="movie"), False),
    # NULL media_type never matches, whatever the request
    (dict(_MOVIE, media_type=None), dict(tmdb_id=603, media_type="movie"), False),
    # a movie row has no season or episode
    (_MOVIE, dict(tmdb_id=603, media_type="movie"), True),
    (dict(_MOVIE, season=1), dict(tmdb_id=603, media_type="movie"), False),
    (dict(_MOVIE, episode=1), dict(tmdb_id=603, media_type="movie"), False),
    # tv, no season requested: any row of the show
    (dict(tmdb_id=1399, media_type="tv", season=2, episode=5),
     dict(tmdb_id=1399, media_type="tv"), True),
    # season must match
    (dict(tmdb_id=1399, media_type="tv", season=2, episode=None),
     dict(tmdb_id=1399, media_type="tv", season=1), False),
    # the season itself is covered only by a pack
    (dict(tmdb_id=1399, media_type="tv", season=1, episode=None),
     dict(tmdb_id=1399, media_type="tv", season=1), True),
    (dict(tmdb_id=1399, media_type="tv", season=1, episode=1),
     dict(tmdb_id=1399, media_type="tv", season=1), False),
    # an episode is covered by a pack or by that very episode
    (dict(tmdb_id=1399, media_type="tv", season=1, episode=None),
     dict(tmdb_id=1399, media_type="tv", season=1, episode=2), True),
    (dict(tmdb_id=1399, media_type="tv", season=1, episode=2),
     dict(tmdb_id=1399, media_type="tv", season=1, episode=2), True),
    (dict(tmdb_id=1399, media_type="tv", season=1, episode=3),
     dict(tmdb_id=1399, media_type="tv", season=1, episode=2), False),
]


@pytest.mark.parametrize("identity,request_,expected", COVERS_TABLE)
def test_covers_title_matches_the_tv_rule(identity, request_, expected):
    req = dict(season=None, episode=None)
    req.update(request_)
    assert covers_title(types.SimpleNamespace(**identity), **req) is expected


# ── endpoints ─────────────────────────────────────────────────────────────────


@pytest.fixture
def world(db_session, override_get_db, session_factory, monkeypatch):
    """Auth off; both get_db seams on the test database; every outward call recorded."""
    rec = types.SimpleNamespace(catalog=[], resolve=[], add=[], resume=[], add_returns="r-new")
    monkeypatch.setattr("app.torrent.manager.get_db", override_get_db)
    # A fresh lock table per test: a lock that once waited is bound to that test's loop.
    monkeypatch.setattr(torrents_api, "_DOWNLOAD_LOCKS", {})

    async def fake_catalog(name):
        rec.catalog.append(name)
        title = "Movie.2020.1080p.WEB"
        return [TorrentHit(title=title, seeds=30, peers=0, bytes=1000,
                           magnet="magnet:?xt=urn:btih:" + "ab" * 20, hash="",
                           quality=parse_quality(title))]

    async def fake_title_year(tmdb_id):
        rec.resolve.append(("movie", tmdb_id))
        return "Movie", 2020

    async def fake_show_name(tmdb_id):
        rec.resolve.append(("tv", tmdb_id))
        return "Show"

    async def fake_add(m, t, save_path=None, account_id=None):
        rec.add.append((m, t, account_id))
        return rec.add_returns

    def fake_resume(tid):
        rec.resume.append(tid)
        return True

    monkeypatch.setattr(torrents_api.catalog, "torrents", fake_catalog)
    monkeypatch.setattr(torrents_api.movie_service, "resolve_title_year", fake_title_year)
    monkeypatch.setattr(torrents_api.tv_service, "resolve_show_name", fake_show_name)
    monkeypatch.setattr(torrents_api.torrent_manager, "add_torrent", fake_add)
    monkeypatch.setattr(torrents_api.torrent_manager, "resume_torrent", fake_resume)

    def read(torrent_id):
        s = session_factory()
        try:
            return s.query(Torrent).filter(Torrent.id == torrent_id).first()
        finally:
            s.close()

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as client:
        yield types.SimpleNamespace(client=client, rec=rec, db=db_session, read=read,
                                    override_get_db=override_get_db,
                                    monkeypatch=monkeypatch)
    app.dependency_overrides.clear()


def _ids(resp):
    assert resp.status_code == 200, resp.text
    return {t["id"] for t in resp.json()}


def test_download_reuses_a_paused_row_and_resumes_it(world):
    world.db.add(_row("r1", tmdb_id=603, media_type="movie", state="paused",
                      account_id="acc-starter"))
    world.db.commit()

    r = world.client.post("/api/v1/torrents/download", json={"tmdb_id": 603})
    assert r.status_code == 200, r.text
    assert r.json()["id"] == "r1"
    assert world.rec.resume == ["r1"]
    assert world.rec.add == [] and world.rec.catalog == [] and world.rec.resolve == []
    assert world.read("r1").account_id == "acc-starter"


def test_explicit_magnet_never_reuses(world):
    world.db.add(_row("r1", tmdb_id=603, media_type="movie", state="paused",
                      account_id="acc-starter"))
    world.db.commit()
    world.rec.add_returns = "r1"

    r = world.client.post("/api/v1/torrents/download", json={
        "tmdb_id": 603, "magnet": "magnet:?xt=urn:btih:" + "ef" * 20})
    assert r.status_code == 200, r.text
    assert len(world.rec.add) == 1
    assert world.rec.resume == []


def test_reused_pack_reports_the_episode_file(world):
    world.db.add(_pack("p1", TWO_EPISODES))
    world.db.commit()

    r = world.client.post("/api/v1/torrents/download", json={
        "tmdb_id": 1399, "media_type": "tv", "season": 1, "episode": 2})
    assert r.status_code == 200, r.text
    assert r.json()["id"] == "p1"
    assert r.json()["file_index"] == 3
    assert world.rec.add == []


def test_a_pack_whose_names_did_not_parse_is_not_reused_for_an_episode(world):
    # {} is what precompute_episode_map saves when the metadata is in and no file name
    # parses: the pack is known not to list the episode, so the press starts its own.
    world.db.add(_pack("p-blind", {}))
    world.db.commit()
    world.monkeypatch.setattr(torrents_api.torrent_manager, "add_torrent",
                              _storing_add(world.rec, world.override_get_db))

    r = world.client.post("/api/v1/torrents/download", json={
        "tmdb_id": 1399, "media_type": "tv", "season": 1, "episode": 5})
    assert r.status_code == 200, r.text
    assert len(world.rec.add) == 1
    assert r.json()["id"] == "r-1"
    movie = world.rec.add[0][0]
    assert (movie.season, movie.episode) == (1, 5)
    assert world.rec.resume == []


def test_for_title_returns_covering_rows_only(world):
    world.db.add_all([
        _row("movie-603", tmdb_id=603, media_type="movie"),
        _pack("pack-s1", None),
        _row("s1e2", season=1, episode=2),
        # Listed although reuse would skip it: the TV ranks states itself.
        _row("s1e2-error", season=1, episode=2, state="error"),
        _row("s1e3", season=1, episode=3),
        _row("pack-s2", season=2, episode=None),
    ])
    world.db.commit()

    c = world.client
    assert _ids(c.get("/api/v1/torrents/for-title", params={
        "tmdb_id": 1399, "media_type": "tv", "season": 1, "episode": 2,
    })) == {"pack-s1", "s1e2", "s1e2-error"}
    assert _ids(c.get("/api/v1/torrents/for-title", params={
        "tmdb_id": 603, "media_type": "movie",
    })) == {"movie-603"}


def test_for_title_and_reuse_agree_on_a_pack_without_the_episode(world):
    world.db.add_all([_pack("pA", {"0": S1E1}), _pack("pN", None)])
    world.db.commit()

    assert _ids(world.client.get("/api/v1/torrents/for-title", params={
        "tmdb_id": 1399, "media_type": "tv", "season": 1, "episode": 2,
    })) == {"pN"}
    assert _find(world.db, season=1, episode=2).id == "pN"


def test_reuse_counts_as_a_play_and_resets_the_clock(world):
    world.monkeypatch.setattr(torrents_api, "utcnow", lambda: FROZEN)
    world.db.add(_row("r1", tmdb_id=603, media_type="movie", last_touched_at=OLD))
    world.db.commit()

    r = world.client.post("/api/v1/torrents/download", json={"tmdb_id": 603})
    assert r.status_code == 200, r.text
    assert r.json()["id"] == "r1"
    assert world.read("r1").last_touched_at == FROZEN


def _storing_add(rec, override_get_db):
    """An add_torrent stub that writes the row the way the real one does: the release's
    own quality, plus the bucket the request asked for."""
    async def adding(m, t, save_path=None, account_id=None):
        n = len(rec.add) + 1
        rec.add.append((m, t, account_id))
        with override_get_db() as s:
            s.add(Torrent(id=f"r-{n}", movie_title="Movie", tmdb_id=m.tmdb_id,
                          media_type=m.media_type, season=m.season, episode=m.episode,
                          quality=t.quality,
                          requested_quality=getattr(t, "requested_quality", None),
                          state="downloading",
                          magnet=t.magnet, url=t.magnet, save_path=f"/tmp/r-{n}"))
        return f"r-{n}"
    return adding


def test_a_downgraded_download_is_reused_at_the_quality_it_was_asked_for(world):
    # A 1080p press whose best source is a 720p release: the second press must find it.
    async def downgrade_only(name):
        world.rec.catalog.append(name)
        title = "Movie.2020.720p.WEB"
        return [TorrentHit(title=title, seeds=30, peers=0, bytes=1000,
                           magnet="magnet:?xt=urn:btih:" + "ee" * 20, hash="",
                           quality=parse_quality(title))]

    world.monkeypatch.setattr(torrents_api.catalog, "torrents", downgrade_only)
    world.monkeypatch.setattr(torrents_api.torrent_manager, "add_torrent",
                              _storing_add(world.rec, world.override_get_db))

    body = {"tmdb_id": 603, "quality": "1080p"}
    first = world.client.post("/api/v1/torrents/download", json=body)
    assert first.status_code == 200, first.text
    second = world.client.post("/api/v1/torrents/download", json=body)
    assert second.status_code == 200, second.text

    assert len(world.rec.add) == 1
    assert first.json()["id"] == second.json()["id"] == "r-1"
    row = world.read("r-1")
    assert (row.quality, row.requested_quality) == ("720p", "1080p")
    # The release's own bucket still answers too, and an unrelated one does not.
    assert _find(world.db, tmdb_id=603, media_type="movie", quality="720p").id == "r-1"
    assert _find(world.db, tmdb_id=603, media_type="movie", quality="2160p") is None


def test_two_identical_presses_racing_start_one_download(world):
    # TestClient serialises requests, so it cannot race; two requests on one loop can.
    rec, override_get_db = world.rec, world.override_get_db

    async def slow_catalog(name):
        rec.catalog.append(name)
        await asyncio.sleep(0.05)
        # The only source is a downgrade: the row's quality (720p) is not the request's.
        title = "Movie.2020.720p.WEB"
        return [TorrentHit(title=title, seeds=30, peers=0, bytes=1000,
                           magnet="magnet:?xt=urn:btih:" + "cd" * 20, hash="",
                           quality=parse_quality(title))]

    adding = _storing_add(rec, override_get_db)

    world.monkeypatch.setattr(torrents_api.catalog, "torrents", slow_catalog)
    world.monkeypatch.setattr(torrents_api.torrent_manager, "add_torrent", adding)

    async def race():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),
                                     base_url="http://t") as ac:
            body = {"tmdb_id": 603, "quality": "1080p"}
            return await asyncio.gather(
                ac.post("/api/v1/torrents/download", json=body),
                ac.post("/api/v1/torrents/download", json=body),
            )

    first, second = asyncio.run(race())
    assert first.status_code == 200, first.text
    assert second.status_code == 200, second.text
    assert len(rec.add) == 1
    assert first.json()["id"] == second.json()["id"] == "r-1"
    assert world.read("r-1").quality == "720p"
