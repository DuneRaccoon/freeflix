"""GET/PUT /instance/owner-settings (owner only) and GET /instance/playback (any session)."""

import os

os.environ.setdefault("DB_PATH", "/tmp/test_owner_settings_api.db")

import pytest
from fastapi.testclient import TestClient

from app.config import settings
from app.database.models.accounts import Account, ROLE_MEMBER, ROLE_OWNER, STATUS_ACTIVE
from app.database.session import get_db
from app.main import app
from app.services import auth as auth_service

DEFAULTS = {"autovacuum_enabled": False, "autovacuum_days": 30, "autovacuum_watched_gate": True,
            "autovacuum_watched_pct": 80, "auto_next_enabled": True, "auto_next_pct": 80}
PUBLIC_KEYS = {"claimed", "needs_claim", "instance_name", "claimed_at"}

OWNER_SETTINGS = "/api/v1/instance/owner-settings"
PLAYBACK = "/api/v1/instance/playback"


@pytest.fixture
def world(db_session, override_get_db, auth_enabled, monkeypatch):
    """An owner and a member, each with a live session. ``auth_enabled`` is required:
    the suite-wide autouse fixture turns auth off, which would make every caller an owner."""
    monkeypatch.setattr("app.dependencies.auth.get_db", override_get_db)
    owner = Account(email="owner@example.com", role=ROLE_OWNER, status=STATUS_ACTIVE)
    member = Account(email="member@example.com", role=ROLE_MEMBER, status=STATUS_ACTIVE)
    db_session.add_all([owner, member])
    db_session.flush()
    owner_token, _ = auth_service.create_session(db_session, owner)
    member_token, _ = auth_service.create_session(db_session, member)
    db_session.commit()

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as client:
        yield {
            "client": client,
            "owner_cookie": {settings.cookie_name: owner_token},
            "member_cookie": {settings.cookie_name: member_token},
        }
    app.dependency_overrides.clear()


def _as(world, who):
    """The client acting as ``who`` (falsy: no session). Cookies go on the client, not on
    each request: httpx deprecates per-request ``cookies=``."""
    client = world["client"]
    client.cookies.clear()
    if who:
        client.cookies.update(world[f"{who}_cookie"])
    return client


def _get(world, path, who="owner"):
    return _as(world, who).get(path)


def _put(world, path, body, who="owner"):
    return _as(world, who).put(path, json=body)


def test_the_owner_reads_the_defaults(world):
    r = _get(world, OWNER_SETTINGS)
    assert r.status_code == 200
    assert r.json() == DEFAULTS


def test_a_member_can_neither_read_nor_write(world):
    assert _get(world, OWNER_SETTINGS, "member").status_code == 403
    assert _put(world, OWNER_SETTINGS, {"autovacuum_enabled": True}, "member").status_code == 403
    assert _get(world, OWNER_SETTINGS).json() == DEFAULTS


def test_signed_out_is_401(world):
    assert world["client"].get(OWNER_SETTINGS).status_code == 401
    assert world["client"].get(PLAYBACK).status_code == 401


def test_a_put_merges_rather_than_resets(world):
    r = _put(world, OWNER_SETTINGS, {"autovacuum_enabled": True, "autovacuum_days": 14})
    assert r.json()["autovacuum_days"] == 14
    _put(world, OWNER_SETTINGS, {"auto_next_pct": 65})
    assert _get(world, OWNER_SETTINGS).json() == {
        **DEFAULTS, "autovacuum_enabled": True, "autovacuum_days": 14, "auto_next_pct": 65}


CASES = [("autovacuum_days", 0, 422), ("autovacuum_days", 1, 200), ("autovacuum_days", 365, 200),
         ("autovacuum_days", 366, 422), ("autovacuum_watched_pct", 9, 422), ("autovacuum_watched_pct", 10, 200),
         ("autovacuum_watched_pct", 100, 200), ("autovacuum_watched_pct", 101, 422), ("auto_next_pct", 45, 422),
         ("auto_next_pct", 50, 200), ("auto_next_pct", 95, 200), ("auto_next_pct", 100, 422),
         ("auto_next_pct", 82, 422), ("auto_next_pct", 85, 200)]


def test_case_count_is_pinned():
    assert len(CASES) == 14


@pytest.mark.parametrize("field,value,code", CASES)
def test_bounds(world, field, value, code):
    assert _put(world, OWNER_SETTINGS, {field: value}).status_code == code


def test_an_unknown_key_is_422_not_silently_dropped(world):
    assert _put(world, OWNER_SETTINGS, {"autovacuum": True}).status_code == 422


def test_the_public_shapes_do_not_grow(world):
    r = _put(world, OWNER_SETTINGS, {"autovacuum_enabled": True, "auto_next_pct": 65})
    assert r.status_code == 200
    r = world["client"].get("/api/v1/instance/status")
    assert set(r.json()) == PUBLIC_KEYS and "autovacuum" not in r.text
    r = _put(world, "/api/v1/instance/settings", {"instance_name": "Den"})
    assert set(r.json()) == PUBLIC_KEYS


def test_a_member_reads_playback_and_only_playback(world):
    _put(world, OWNER_SETTINGS, {"auto_next_enabled": False, "auto_next_pct": 65})
    r = _get(world, PLAYBACK, "member")
    assert r.status_code == 200
    assert r.json() == {"auto_next_enabled": False, "auto_next_pct": 65}
