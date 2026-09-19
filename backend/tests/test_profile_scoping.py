"""Cross-account isolation for every {user_id}-scoped route.

These are regression tests for two real holes found by exercising a live stack:
``api/watchlist.py`` and the ``user_id`` query parameter on ``api/rails.py`` were gated
by the router-level session dependency but had NO ownership check, so any signed-in
member could read, add to, patch or delete another household member's watchlist — and
could pull back browse rails derived from another profile's viewing history — just by
passing that profile's id.

The shape of the bug is worth remembering: a session gate looks like authorization but
is only AUTHENTICATION. Every route whose subject comes from a caller-supplied id needs
the second check, and the cost of missing it is invisible because every response is a
perfectly valid 200.
"""

import os

os.environ.setdefault("DB_PATH", "/tmp/test_profile_scoping.db")

import pytest
from fastapi.testclient import TestClient

from app.config import settings
from app.database.models import User, UserSettings
from app.database.models.accounts import Account, ROLE_MEMBER, ROLE_OWNER, STATUS_ACTIVE
from app.database.session import get_db
from app.main import app
from app.services import auth as auth_service


@pytest.fixture
def world(db_session, override_get_db, auth_enabled, monkeypatch):
    """Two accounts, one profile each, plus a third locked profile under the owner.

    ``auth_enabled`` flips the kill switch back on for this module — the session-scoped
    autouse fixture in conftest turns it off so the pre-auth test files keep working.

    Note the monkeypatch below. ``app.dependency_overrides[get_db]`` only intercepts
    ``Depends(get_db)``; the auth dependencies deliberately CALL ``get_db()`` directly
    (they must — FastAPI caches sub-dependencies, so sharing the endpoint's single-use
    context manager would raise AttributeError). A direct call bypasses the override
    entirely and would query the real database, so every request would come back 401
    against an empty DB. Patching the module-level name is the only way to redirect it.
    """
    monkeypatch.setattr("app.dependencies.auth.get_db", override_get_db)
    owner = Account(email="owner@example.com", role=ROLE_OWNER, status=STATUS_ACTIVE)
    member = Account(email="member@example.com", role=ROLE_MEMBER, status=STATUS_ACTIVE)
    db_session.add_all([owner, member])
    db_session.flush()

    def profile(account, username, *, passcode=None):
        row = User(username=username, display_name=username, account_id=account.id)
        db_session.add(row)
        db_session.flush()
        cfg = UserSettings(user_id=row.id)
        if passcode:
            cfg.require_passcode = True
            cfg.passcode_hash = auth_service.hash_passcode(passcode)
            cfg.passcode_len = len(passcode)
        db_session.add(cfg)
        db_session.flush()
        return row

    owner_profile = profile(owner, "owner-profile")
    member_profile = profile(member, "member-profile")
    vault = profile(owner, "vault", passcode="4821")

    owner_token, _ = auth_service.create_session(db_session, owner)
    member_token, _ = auth_service.create_session(db_session, member)
    db_session.commit()

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as client:
        yield {
            "client": client,
            "owner_cookie": {settings.cookie_name: owner_token},
            "member_cookie": {settings.cookie_name: member_token},
            "owner_profile": owner_profile.id,
            "member_profile": member_profile.id,
            "vault": vault.id,
        }
    app.dependency_overrides.clear()


# --------------------------------------------------------------------- watchlist

WATCHLIST_ITEM = {
    "content_id": "movie:603",
    "tmdb_id": "603",
    "media_type": "movie",
    "title": "The Matrix",
}


def test_watchlist_read_is_refused_across_accounts(world):
    r = world["client"].get(
        f"/api/v1/watchlist/{world['member_profile']}", cookies=world["owner_cookie"]
    )
    assert r.status_code == 403


def test_watchlist_write_is_refused_across_accounts(world):
    r = world["client"].post(
        f"/api/v1/watchlist/{world['member_profile']}/add",
        json=WATCHLIST_ITEM,
        cookies=world["owner_cookie"],
    )
    assert r.status_code == 403


def test_watchlist_delete_is_refused_across_accounts(world):
    r = world["client"].delete(
        f"/api/v1/watchlist/{world['member_profile']}/movie%3A603",
        cookies=world["owner_cookie"],
    )
    assert r.status_code == 403


def test_watchlist_patch_is_refused_across_accounts(world):
    r = world["client"].patch(
        f"/api/v1/watchlist/{world['member_profile']}/movie%3A603",
        json={"poster_url": "/x.jpg"},
        cookies=world["owner_cookie"],
    )
    assert r.status_code == 403


def test_watchlist_still_works_on_your_own_profile(world):
    client, cookie, me = world["client"], world["owner_cookie"], world["owner_profile"]

    assert client.post(
        f"/api/v1/watchlist/{me}/add", json=WATCHLIST_ITEM, cookies=cookie
    ).status_code == 201
    listed = client.get(f"/api/v1/watchlist/{me}", cookies=cookie)
    assert listed.status_code == 200
    assert [i["content_id"] for i in listed.json()] == ["movie:603"]


def test_watchlist_requires_a_session_at_all(world):
    assert world["client"].get(
        f"/api/v1/watchlist/{world['owner_profile']}"
    ).status_code == 401


# ------------------------------------------------------------------------- rails


def test_rails_refuses_another_accounts_profile(world):
    """The rails ordering is derived from the profile's watch history and watchlist, so
    an unvalidated id leaks what that person watches."""
    r = world["client"].get(
        f"/api/v1/rails?mode=movie&user_id={world['member_profile']}",
        cookies=world["owner_cookie"],
    )
    assert r.status_code == 403


def test_rails_accepts_your_own_profile(world):
    r = world["client"].get(
        f"/api/v1/rails?mode=movie&user_id={world['owner_profile']}",
        cookies=world["owner_cookie"],
    )
    assert r.status_code == 200


def test_rails_without_a_profile_stays_legal(world):
    """Omitting user_id yields the anonymous rails — the parameter is optional and
    validating it must not make it mandatory."""
    r = world["client"].get("/api/v1/rails?mode=movie", cookies=world["owner_cookie"])
    assert r.status_code == 200


# ----------------------------------------------------------- streaming + profiles


def test_streaming_progress_is_refused_across_accounts(world):
    r = world["client"].get(
        f"/api/v1/streaming/progress/{world['member_profile']}",
        cookies=world["owner_cookie"],
    )
    assert r.status_code == 403


def test_profile_read_is_refused_across_accounts(world):
    r = world["client"].get(
        f"/api/v1/users/{world['member_profile']}", cookies=world["owner_cookie"]
    )
    assert r.status_code == 403


def test_profile_list_is_scoped_to_your_own_account(world):
    r = world["client"].get("/api/v1/users", cookies=world["owner_cookie"])
    assert r.status_code == 200
    names = {p["username"] for p in r.json()}
    assert names == {"owner-profile", "vault"}
    assert "member-profile" not in names


def test_profile_response_never_carries_the_passcode(world):
    r = world["client"].get("/api/v1/users", cookies=world["owner_cookie"])
    assert r.status_code == 200
    for profile in r.json():
        assert "passcode" not in profile["settings"]
        assert "passcode_hash" not in profile["settings"]


# ---------------------------------------------------------------- passcode lock


def test_locked_profile_is_refused_until_unlocked(world):
    client, cookie, vault = world["client"], world["owner_cookie"], world["vault"]

    assert client.get(f"/api/v1/users/{vault}", cookies=cookie).status_code == 423
    # The lock covers every profile-scoped route, not just the profile itself —
    # otherwise it would be trivially bypassed by reading the watchlist directly.
    assert client.get(f"/api/v1/watchlist/{vault}", cookies=cookie).status_code == 423

    assert client.post(
        f"/api/v1/users/{vault}/unlock", json={"passcode": "4821"}, cookies=cookie
    ).status_code == 200

    assert client.get(f"/api/v1/users/{vault}", cookies=cookie).status_code == 200
    assert client.get(f"/api/v1/watchlist/{vault}", cookies=cookie).status_code == 200


def test_wrong_passcode_does_not_unlock(world):
    client, cookie, vault = world["client"], world["owner_cookie"], world["vault"]

    assert client.post(
        f"/api/v1/users/{vault}/unlock", json={"passcode": "0000"}, cookies=cookie
    ).status_code == 403
    assert client.get(f"/api/v1/users/{vault}", cookies=cookie).status_code == 423


def test_another_account_gets_403_not_423_on_a_locked_profile(world):
    """Ownership is checked before the lock, so the 423 never becomes an oracle that
    confirms a given profile id exists on someone else's account."""
    r = world["client"].get(
        f"/api/v1/users/{world['vault']}", cookies=world["member_cookie"]
    )
    assert r.status_code == 403


def test_unlock_is_refused_for_another_accounts_profile(world):
    r = world["client"].post(
        f"/api/v1/users/{world['vault']}/unlock",
        json={"passcode": "4821"},
        cookies=world["member_cookie"],
    )
    assert r.status_code in (403, 404)


# ------------------------------------------------------------------- owner scope


def test_member_cannot_reach_owner_endpoints(world):
    client, cookie = world["client"], world["member_cookie"]

    assert client.get("/api/v1/instance/members", cookies=cookie).status_code == 403
    assert client.post(
        "/api/v1/instance/invites", json={"email": "x@y.com"}, cookies=cookie
    ).status_code == 403


def test_owner_can_reach_owner_endpoints(world):
    r = world["client"].get("/api/v1/instance/members", cookies=world["owner_cookie"])
    assert r.status_code == 200


def test_revoked_account_stops_authenticating_immediately(db_session, world):
    """Revocation is a status change plus a session sweep, NOT CRUDMixin.delete() — a
    soft delete only stamps deleted_at, which no query in this codebase filters on."""
    client, cookie = world["client"], world["member_cookie"]
    assert client.get("/api/v1/auth/me", cookies=cookie).status_code == 200

    account = (
        db_session.query(Account).filter(Account.email == "member@example.com").first()
    )
    from app.services import accounts as accounts_service

    accounts_service.revoke_account(db_session, account)
    db_session.commit()

    assert client.get("/api/v1/auth/me", cookies=cookie).status_code == 401


# --------------------------------------------- passcode lockout guards (review fixes)


@pytest.mark.parametrize("bad", ["hunter2", "12 34", "12a4", "abcd", "12", "123456789"])
def test_non_numeric_or_out_of_range_passcode_is_refused(world, bad):
    """The unlock screen is a numeric keypad, so a passcode it cannot reproduce would
    lock the profile for good — and with the lock on, settings are behind the same 423."""
    r = world["client"].put(
        f"/api/v1/users/{world['owner_profile']}/settings",
        json={"require_passcode": True, "passcode": bad},
        cookies=world["owner_cookie"],
    )
    assert r.status_code == 422


def test_setting_a_passcode_does_not_lock_out_the_session_that_set_it(world):
    """Otherwise every profile-scoped call 423s for the rest of the session with nothing
    in the UI asking for the code — My List and Continue Watching silently empty, which
    reads as data loss."""
    client, cookie, me = world["client"], world["owner_cookie"], world["owner_profile"]

    assert client.put(
        f"/api/v1/users/{me}/settings",
        json={"require_passcode": True, "passcode": "4821"},
        cookies=cookie,
    ).status_code == 200

    assert client.get(f"/api/v1/users/{me}", cookies=cookie).status_code == 200
    assert client.get(f"/api/v1/watchlist/{me}", cookies=cookie).status_code == 200


def test_a_locked_profile_can_still_be_deleted(world):
    """The recovery path for a forgotten passcode. Every other route on a locked profile
    423s, so without this exemption the only way back would be a database edit."""
    client, cookie, vault = world["client"], world["owner_cookie"], world["vault"]

    assert client.get(f"/api/v1/users/{vault}", cookies=cookie).status_code == 423
    assert client.delete(f"/api/v1/users/{vault}", cookies=cookie).status_code == 200


def test_turning_the_lock_off_still_requires_the_passcode(world):
    """Deleting is the recovery path, NOT 'switch the lock off' — exempting settings
    would let anyone holding the device disable it and defeat the lock entirely."""
    r = world["client"].put(
        f"/api/v1/users/{world['vault']}/settings",
        json={"require_passcode": False},
        cookies=world["owner_cookie"],
    )
    assert r.status_code == 423


def test_deleting_someone_elses_locked_profile_is_still_refused(world):
    """The delete exemption drops the PASSCODE gate, never the ownership check."""
    r = world["client"].delete(
        f"/api/v1/users/{world['vault']}", cookies=world["member_cookie"]
    )
    assert r.status_code == 403
