"""The device-pairing endpoints.

The flow is an RFC 8628-shaped device authorization grant: a device with no keyboard
gets a long secret and a short human code, and a signed-in phone approves it.
"""
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services import device_pairing as dp

client = TestClient(app)


def test_start_is_public_and_returns_both_codes():
    r = client.post("/api/v1/auth/device/start")
    assert r.status_code == 200
    body = r.json()
    assert len(body["device_code"]) > 30
    assert len(dp.normalize_user_code(body["user_code"])) == dp.USER_CODE_LENGTH
    assert body["expires_in"] == 600
    assert body["interval"] >= 1
    assert body["verification_uri"].endswith("/link")


def test_start_returns_the_user_code_already_formatted():
    body = client.post("/api/v1/auth/device/start").json()
    assert "-" in body["user_code"]


def test_two_starts_differ():
    a = client.post("/api/v1/auth/device/start").json()
    b = client.post("/api/v1/auth/device/start").json()
    assert a["device_code"] != b["device_code"]
    assert a["user_code"] != b["user_code"]


def test_start_never_puts_the_device_code_in_the_path():
    # middleware/error_handler.py logs request.url.path to stdout and to a retained
    # file. A secret in a path is a secret in the logs.
    r = client.post("/api/v1/auth/device/start")
    assert r.request.url.path == "/api/v1/auth/device/start"


from app.database.models.accounts import (
    Account, DevicePairing, PAIRING_APPROVED, PAIRING_CONSUMED,
    ROLE_OWNER, STATUS_ACTIVE,
)
from app.database.session import get_db
from app.services import auth as auth_service


def _approve_directly(device_code: str, *, account_id: str, name: str = "Living Room TV"):
    """Approve without going through the HTTP approve endpoint (that is Task 5)."""
    with get_db() as session:
        row = dp.find_by_device_code(session, device_code)
        dp.approve(session, row, account_id=account_id, device_name=name)
        session.commit()


@pytest.fixture
def an_account():
    with get_db() as session:
        acct = Account(
            email="pairing-test@example.com", role=ROLE_OWNER, status=STATUS_ACTIVE
        )
        session.add(acct)
        session.commit()
        yield acct.id
        session.query(Account).filter(Account.id == acct.id).delete()
        session.commit()


def test_poll_is_pending_before_approval():
    start = client.post("/api/v1/auth/device/start").json()
    r = client.post("/api/v1/auth/device/poll", json={"device_code": start["device_code"]})
    assert r.status_code == 200
    assert r.json()["status"] == "pending"
    assert "set-cookie" not in {k.lower() for k in r.headers}


def test_poll_mints_a_session_once_approved(an_account):
    start = client.post("/api/v1/auth/device/start").json()
    _approve_directly(start["device_code"], account_id=an_account)
    r = client.post("/api/v1/auth/device/poll", json={"device_code": start["device_code"]})
    assert r.status_code == 200
    assert r.json()["status"] == "approved"
    assert "ff_session=" in r.headers.get("set-cookie", "")


def test_a_consumed_device_code_mints_nothing_on_replay(an_account):
    """REVIEW FOCUS 1 — a replayed device_code must not mint a second session."""
    start = client.post("/api/v1/auth/device/start").json()
    _approve_directly(start["device_code"], account_id=an_account)
    first = client.post("/api/v1/auth/device/poll", json={"device_code": start["device_code"]})
    assert "ff_session=" in first.headers.get("set-cookie", "")

    second = client.post("/api/v1/auth/device/poll", json={"device_code": start["device_code"]})
    assert second.status_code == 200
    assert second.json()["status"] == "expired"
    assert "ff_session=" not in second.headers.get("set-cookie", "")


def test_three_hundred_polls_do_not_throttle_the_device():
    """REVIEW FOCUS 2 — a device polls every 2s for 10 minutes. That is the flow
    working, not abuse, and it must not throttle itself into failure."""
    start = client.post("/api/v1/auth/device/start").json()
    for _ in range(300):
        r = client.post("/api/v1/auth/device/poll", json={"device_code": start["device_code"]})
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "pending"


def test_a_suspended_account_receives_no_session(an_account):
    """REVIEW FOCUS 3 — STATUS_ACTIVE is re-checked at poll time, never trusted
    from the moment of approval."""
    start = client.post("/api/v1/auth/device/start").json()
    _approve_directly(start["device_code"], account_id=an_account)
    with get_db() as session:
        acct = session.query(Account).filter(Account.id == an_account).first()
        acct.status = "suspended"
        session.commit()

    r = client.post("/api/v1/auth/device/poll", json={"device_code": start["device_code"]})
    assert r.json()["status"] == "denied"
    assert "ff_session=" not in r.headers.get("set-cookie", "")


def test_a_pairing_that_expired_after_approval_mints_nothing(an_account):
    """REVIEW FOCUS 5 — approved but expired must fail closed."""
    start = client.post("/api/v1/auth/device/start").json()
    _approve_directly(start["device_code"], account_id=an_account)
    with get_db() as session:
        row = dp.find_by_device_code(session, start["device_code"])
        row.expires_at = auth_service.utcnow() - __import__("datetime").timedelta(seconds=1)
        session.commit()

    r = client.post("/api/v1/auth/device/poll", json={"device_code": start["device_code"]})
    assert r.json()["status"] == "expired"
    assert "ff_session=" not in r.headers.get("set-cookie", "")


def test_an_unknown_device_code_is_indistinguishable_from_an_expired_one():
    r = client.post("/api/v1/auth/device/poll", json={"device_code": "not-a-real-code"})
    assert r.status_code == 200
    assert r.json()["status"] == "expired"


def test_the_minted_session_is_tagged_as_a_device(an_account):
    start = client.post("/api/v1/auth/device/start").json()
    _approve_directly(start["device_code"], account_id=an_account, name="Living Room TV")
    client.post("/api/v1/auth/device/poll", json={"device_code": start["device_code"]})
    with get_db() as session:
        from app.database.models.accounts import AuthSession
        row = (
            session.query(AuthSession)
            .filter(AuthSession.account_id == an_account)
            .order_by(AuthSession.id.desc())
            .first()
        )
        assert row.device_kind == "tv"
        assert row.device_name == "Living Room TV"
