"""Listing and revoking individual sessions.

Before this, the only options were self-signout and account-wide revocation, so
un-pairing a television meant signing every browser out too.
"""
import uuid

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.database.models.accounts import Account, AuthSession, ROLE_OWNER, STATUS_ACTIVE
from app.database.session import get_db
from app.services import auth as auth_service

client = TestClient(app)


@pytest.fixture
def account_with_two_sessions(auth_enabled):
    with get_db() as session:
        acct = Account(email=f"revoke-{uuid.uuid4().hex[:8]}@example.com", role=ROLE_OWNER, status=STATUS_ACTIVE)
        session.add(acct)
        session.flush()
        browser_raw, browser = auth_service.create_session(session, acct)
        tv_raw, tv = auth_service.create_session(
            session, acct, device_name="Living Room TV", device_kind="tv"
        )
        ids = (acct.id, browser_raw, browser.id, tv_raw, tv.id)
        session.commit()
    yield ids
    with get_db() as session:
        session.query(Account).filter(Account.id == ids[0]).delete()
        session.commit()


def test_list_shows_both_and_marks_the_current_one(account_with_two_sessions):
    _, browser_raw, browser_id, _, tv_id = account_with_two_sessions
    c = TestClient(app)
    c.cookies.set("ff_session", browser_raw)
    r = c.get("/api/v1/auth/devices")
    assert r.status_code == 200
    rows = {row["id"]: row for row in r.json()}
    assert rows[browser_id]["current"] is True
    assert rows[tv_id]["current"] is False
    assert rows[tv_id]["device_name"] == "Living Room TV"
    assert rows[tv_id]["device_kind"] == "tv"


def test_list_never_returns_a_token_hash(account_with_two_sessions):
    _, browser_raw, _, _, _ = account_with_two_sessions
    c = TestClient(app)
    c.cookies.set("ff_session", browser_raw)
    body = c.get("/api/v1/auth/devices").text
    assert "token_hash" not in body


def test_revoking_the_tv_leaves_the_browser_signed_in(account_with_two_sessions):
    _, browser_raw, _, tv_raw, tv_id = account_with_two_sessions
    c = TestClient(app)
    c.cookies.set("ff_session", browser_raw)
    assert c.delete(f"/api/v1/auth/devices/{tv_id}").status_code == 200
    assert c.get("/api/v1/auth/me").status_code == 200

    tv = TestClient(app)
    tv.cookies.set("ff_session", tv_raw)
    assert tv.get("/api/v1/auth/me").status_code == 401


def test_cannot_revoke_a_session_belonging_to_another_account(account_with_two_sessions):
    _, browser_raw, _, _, _ = account_with_two_sessions
    with get_db() as session:
        other = Account(email=f"other-{uuid.uuid4().hex[:8]}@example.com", role=ROLE_OWNER, status=STATUS_ACTIVE)
        session.add(other)
        session.flush()
        _, other_session = auth_service.create_session(session, other)
        other_id = other_session.id
        other_account_id = other.id
        session.commit()

    try:
        c = TestClient(app)
        c.cookies.set("ff_session", browser_raw)
        assert c.delete(f"/api/v1/auth/devices/{other_id}").status_code == 404
    finally:
        with get_db() as session:
            session.query(Account).filter(Account.id == other_account_id).delete()
            session.commit()


def test_devices_requires_a_session(auth_enabled):
    assert TestClient(app).get("/api/v1/auth/devices").status_code in (401, 403)
