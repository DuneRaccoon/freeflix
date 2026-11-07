"""Downloads are per-account (spec 2026-11-06 section 3.2).

A member sees and manages only the downloads their account started; the owner sees all;
a NULL ``account_id`` (pre-change rows, schedule-cron downloads) is the owner's. The Play
path -- resume, status, streaming -- is deliberately unscoped, because a member pressing
Play on a film the owner already holds must still play it.

Two members, so "a member sees their own" is distinguishable from "a member sees every
row that is not the owner's".
"""

import os

os.environ.setdefault("DB_PATH", "/tmp/test_torrent_scope_api.db")

import datetime

import pytest
from fastapi.testclient import TestClient

import app.api.torrents as torrents_api
from app.config import settings
from app.database.models import Torrent as DbTorrent
from app.database.models.accounts import Account, ROLE_MEMBER, ROLE_OWNER, STATUS_ACTIVE
from app.database.session import get_db
from app.main import app
from app.models import TorrentHit
from app.providers.quality import parse_quality
from app.services import auth as auth_service
from app.torrent.manager import torrent_manager

ALL_IDS = {"t-owner", "t-member", "t-other", "t-legacy"}


def _row(torrent_id, account_id, **kw):
    return DbTorrent(
        **kw,
        id=torrent_id,
        movie_title=f"Title {torrent_id}",
        quality="1080p",
        magnet=f"magnet:?xt=urn:btih:{torrent_id}",
        url=f"magnet:?xt=urn:btih:{torrent_id}",
        save_path=f"/tmp/{torrent_id}",
        state="downloading",
        account_id=account_id,
    )


@pytest.fixture
def tworld(db_session, override_get_db, auth_enabled, monkeypatch, session_factory):
    monkeypatch.setattr("app.dependencies.auth.get_db", override_get_db)
    monkeypatch.setattr("app.torrent.manager.get_db", override_get_db)
    owner = Account(email="owner@example.com", role=ROLE_OWNER, status=STATUS_ACTIVE)
    member = Account(email="member@example.com", role=ROLE_MEMBER, status=STATUS_ACTIVE)
    other = Account(email="other@example.com", role=ROLE_MEMBER, status=STATUS_ACTIVE)
    db_session.add_all([owner, member, other])
    db_session.flush()
    db_session.add_all([
        _row("t-owner", owner.id, tmdb_id=603, media_type="movie"),
        _row("t-member", member.id),
        _row("t-other", other.id),
        _row("t-legacy", None),
    ])
    owner_token, _ = auth_service.create_session(db_session, owner)
    member_token, _ = auth_service.create_session(db_session, member)
    member_id = member.id
    db_session.commit()

    def state_of(torrent_id):
        s = session_factory()
        try:
            row = s.query(DbTorrent).filter(DbTorrent.id == torrent_id).first()
            return None if row is None else row.state
        finally:
            s.close()

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as client:
        yield {
            "client": client,
            "owner": {settings.cookie_name: owner_token},
            "member": {settings.cookie_name: member_token},
            "member_id": member_id,
            "state_of": state_of,
        }
    app.dependency_overrides.clear()


def _as(world, who):
    """The client acting as ``who``. Cookies go on the client, not on each request:
    httpx deprecates per-request ``cookies=``."""
    client = world["client"]
    client.cookies.clear()
    client.cookies.update(world[who])
    return client


def _ids(resp):
    assert resp.status_code == 200, resp.text
    return {t["id"] for t in resp.json()}


def test_member_lists_only_their_own_downloads(tworld):
    assert _ids(_as(tworld, "member").get("/api/v1/torrents/list")) == {"t-member"}
    assert _ids(_as(tworld, "owner").get("/api/v1/torrents/list")) == ALL_IDS
    # Every row is downloading, so the state filter alone would let all four through.
    assert _ids(_as(tworld, "member").get("/api/v1/torrents/list",
                                          params={"state": "downloading"})) == {"t-member"}


def test_member_activity_count_is_scoped(tworld):
    member = _as(tworld, "member").get("/api/v1/activity/count")
    owner = _as(tworld, "owner").get("/api/v1/activity/count")
    assert member.status_code == 200 and owner.status_code == 200
    assert member.json()["active_downloads"] == 1
    assert owner.json()["active_downloads"] == 4


def test_member_cannot_delete_another_accounts_download(tworld):
    state_of = tworld["state_of"]

    r = _as(tworld, "member").delete("/api/v1/torrents/t-other")
    assert r.status_code == 404
    assert r.json()["detail"] == "Torrent not found or deletion failed"
    assert state_of("t-other") == "downloading"

    r = _as(tworld, "member").delete("/api/v1/torrents/t-legacy")
    assert r.status_code == 404
    assert state_of("t-legacy") == "downloading"

    r = _as(tworld, "member").delete("/api/v1/torrents/t-member")
    assert r.status_code == 200, r.text
    assert state_of("t-member") is None

    r = _as(tworld, "owner").delete("/api/v1/torrents/t-other")
    assert r.status_code == 200, r.text
    assert state_of("t-other") is None


def test_not_visible_and_missing_are_indistinguishable(tworld):
    hidden = _as(tworld, "member").delete("/api/v1/torrents/t-other")
    missing = _as(tworld, "member").delete("/api/v1/torrents/nope")
    assert hidden.status_code == 404
    assert (hidden.status_code, hidden.json()) == (missing.status_code, missing.json())


def test_member_cannot_pause_another_accounts_download(tworld):
    state_of = tworld["state_of"]
    # t-legacy is the owner's (NULL account_id): a member may not touch it either.
    for target in ("t-other", "t-legacy"):
        for action in ("pause", "stop"):
            r = _as(tworld, "member").post(f"/api/v1/torrents/action/{target}",
                                           json={"action": action})
            assert r.status_code == 404, (target, action)
            assert r.json()["detail"] == "Torrent not found or action failed"
            assert state_of(target) == "downloading"

    r = _as(tworld, "member").post("/api/v1/torrents/action/t-member", json={"action": "pause"})
    assert r.status_code == 200, r.text
    assert state_of("t-member") == "paused"


def test_resume_is_not_scoped(tworld, monkeypatch):
    calls = []
    monkeypatch.setattr(torrent_manager, "resume_torrent",
                        lambda tid: calls.append(tid) or True)

    r = _as(tworld, "member").post("/api/v1/torrents/action/t-other", json={"action": "resume"})
    assert r.status_code == 200, r.text
    assert calls == ["t-other"]

    r = _as(tworld, "member").get("/api/v1/torrents/status/t-other")
    assert r.status_code == 200, r.text
    assert r.json()["id"] == "t-other"


def test_batch_acts_only_on_the_visible_set(tworld):
    state_of = tworld["state_of"]
    r = _as(tworld, "member").post("/api/v1/torrents/batch", json={"action": "pause"})
    assert r.status_code == 200, r.text
    assert [res["id"] for res in r.json()["results"]] == ["t-member"]
    assert state_of("t-other") == "downloading"
    assert state_of("t-owner") == "downloading"
    assert state_of("t-legacy") == "downloading"
    assert state_of("t-member") == "paused"


def test_download_records_the_starting_account(tworld, monkeypatch):
    recorded = []

    async def fake_resolve(tmdb_id):
        return "Movie", 2020

    async def fake_torrents(name):
        title = "Movie.2020.1080p.WEB"
        return [TorrentHit(title=title, seeds=30, peers=0, bytes=1000,
                           magnet="magnet:?xt=urn:btih:00000000000000aa", hash="",
                           quality=parse_quality(title))]

    async def fake_add(m, t, save_path=None, account_id=None):
        recorded.append(account_id)
        return "t-new"

    def fake_status(tid):
        now = datetime.datetime(2026, 11, 7, 12, 0, 0)
        return DbTorrent(
            id="t-new", movie_title="Movie", quality="1080p", state="downloading",
            magnet="magnet:?xt=urn:btih:00000000000000aa", progress=0.0,
            save_path="/tmp/t-new", created_at=now, updated_at=now,
        ).to_status()

    monkeypatch.setattr(torrents_api.movie_service, "resolve_title_year", fake_resolve)
    monkeypatch.setattr(torrents_api.catalog, "torrents", fake_torrents)
    monkeypatch.setattr(torrents_api.torrent_manager, "add_torrent", fake_add)
    monkeypatch.setattr(torrents_api.torrent_manager, "get_torrent_status", fake_status)

    r = _as(tworld, "member").post("/api/v1/torrents/download", json={"tmdb_id": 1})
    assert r.status_code == 200, r.text
    assert recorded == [tworld["member_id"]]


def test_a_member_reusing_a_legacy_row_does_not_adopt_it(tworld, monkeypatch, session_factory):
    s = session_factory()
    try:
        s.query(DbTorrent).filter(DbTorrent.id == "t-legacy").update({
            DbTorrent.tmdb_id: 604, DbTorrent.media_type: "movie",
            DbTorrent.quality: "1080p", DbTorrent.state: "finished",
        }, synchronize_session=False)
        s.commit()
    finally:
        s.close()

    searched, added = [], []

    async def fake_torrents(name):
        searched.append(name)
        title = "Movie.2020.1080p.WEB"
        return [TorrentHit(title=title, seeds=30, peers=0, bytes=1000,
                           magnet="magnet:?xt=urn:btih:00000000000000bb", hash="",
                           quality=parse_quality(title))]

    async def fake_add(m, t, save_path=None, account_id=None):
        added.append(account_id)
        return "t-new"

    monkeypatch.setattr(torrents_api.catalog, "torrents", fake_torrents)
    monkeypatch.setattr(torrents_api.torrent_manager, "add_torrent", fake_add)

    r = _as(tworld, "member").post("/api/v1/torrents/download", json={"tmdb_id": 604})
    assert r.status_code == 200, r.text
    assert r.json()["id"] == "t-legacy"
    assert added == [] and searched == []

    s = session_factory()
    try:
        assert s.query(DbTorrent).filter(DbTorrent.id == "t-legacy").one().account_id is None
    finally:
        s.close()
    assert "t-legacy" not in _ids(_as(tworld, "member").get("/api/v1/torrents/list"))


def test_for_title_is_not_scoped(tworld):
    r = _as(tworld, "member").get("/api/v1/torrents/for-title",
                                  params={"tmdb_id": 603, "media_type": "movie"})
    assert _ids(r) == {"t-owner"}


# --- who watched (owner only) and the disk totals ------------------------------------------

from types import SimpleNamespace  # noqa: E402

from app.database.models.streaming import UserStreamingProgress  # noqa: E402
from app.database.models.users import User  # noqa: E402


@pytest.fixture
def wworld(tworld, db_session):
    ann = User(username="ann", display_name="Ann", account_id=tworld["member_id"])
    db_session.add(ann)
    db_session.flush()
    db_session.add(UserStreamingProgress(
        user_id=ann.id, torrent_id="t-member", movie_id="movie:1", percentage=60.0,
    ))
    for tid, size in (("t-owner", 100), ("t-member", 50)):
        db_session.query(DbTorrent).filter(DbTorrent.id == tid).update({"size_bytes": size})
    ann_id = ann.id
    db_session.commit()
    tworld["ann_id"] = ann_id
    return tworld


def _by_id(resp):
    assert resp.status_code == 200, resp.text
    return {t["id"]: t for t in resp.json()}


def test_owner_sees_who_watched(wworld):
    rows = _by_id(_as(wworld, "owner").get("/api/v1/torrents/list"))
    assert rows["t-member"]["watched_by"] == [
        {"profile_id": wworld["ann_id"], "display_name": "Ann", "avatar": None, "percent": 60.0}
    ]
    assert rows["t-other"]["watched_by"] == []


def test_member_never_sees_watched_by(wworld):
    rows = _by_id(_as(wworld, "member").get("/api/v1/torrents/list"))
    assert rows["t-member"]["watched_by"] is None


def test_disk_totals_are_the_same_for_everyone(wworld, monkeypatch):
    monkeypatch.setattr(torrents_api.shutil, "disk_usage",
                        lambda p: SimpleNamespace(total=1000, used=400, free=600))
    want = {"used_by_downloads_bytes": 150, "free_bytes": 600, "total_bytes": 1000}
    for who in ("owner", "member"):
        r = _as(wworld, who).get("/api/v1/torrents/disk")
        assert r.status_code == 200, r.text
        assert r.json() == want


def test_disk_unavailable_is_503(wworld, monkeypatch):
    def boom(p):
        raise OSError("gone")
    monkeypatch.setattr(torrents_api.shutil, "disk_usage", boom)
    r = _as(wworld, "owner").get("/api/v1/torrents/disk")
    assert r.status_code == 503
