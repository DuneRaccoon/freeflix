"""Device sessions slide; browser sessions do not.

A person can sign in again. A television cannot — it has no keyboard and the person
who paired it may not be in the room. So a device session renews on use, while a
browser session keeps the absolute 30-day expiry it has always had.
"""
import datetime

from app.config import settings
from app.database.models.accounts import Account, AuthSession, ROLE_OWNER, STATUS_ACTIVE
from app.services import auth as auth_service


def _account(db_session):
    a = Account(email="slide@example.com", role=ROLE_OWNER, status=STATUS_ACTIVE)
    db_session.add(a)
    db_session.flush()
    return a


def test_browser_session_has_the_absolute_ttl(db_session):
    _, row = auth_service.create_session(db_session, _account(db_session))
    delta = row.expires_at - auth_service.utcnow()
    assert abs(delta.days - settings.session_ttl_days) <= 1
    assert row.device_kind is None
    assert row.device_name is None


def test_device_session_has_the_long_ttl_and_its_metadata(db_session):
    _, row = auth_service.create_session(
        db_session, _account(db_session), device_name="Living Room TV", device_kind="tv"
    )
    delta = row.expires_at - auth_service.utcnow()
    assert abs(delta.days - settings.device_session_ttl_days) <= 1
    assert row.device_kind == "tv"
    assert row.device_name == "Living Room TV"


def test_touch_slides_a_device_session(db_session):
    _, row = auth_service.create_session(
        db_session, _account(db_session), device_name="TV", device_kind="tv"
    )
    row.expires_at = auth_service.utcnow() + datetime.timedelta(days=1)
    row.last_seen_at = auth_service.utcnow() - datetime.timedelta(minutes=5)
    auth_service.touch_session(db_session, row)
    assert row.expires_at - auth_service.utcnow() > datetime.timedelta(days=100)


def test_touch_does_not_slide_a_browser_session(db_session):
    _, row = auth_service.create_session(db_session, _account(db_session))
    row.expires_at = auth_service.utcnow() + datetime.timedelta(days=1)
    row.last_seen_at = auth_service.utcnow() - datetime.timedelta(minutes=5)
    auth_service.touch_session(db_session, row)
    assert row.expires_at - auth_service.utcnow() < datetime.timedelta(days=2)


def test_touch_still_throttles_the_last_seen_write(db_session):
    # The throttle exists because an unguarded UPDATE on every request is real write
    # amplification on the Raspberry Pi target. Sliding must not defeat it.
    _, row = auth_service.create_session(
        db_session, _account(db_session), device_name="TV", device_kind="tv"
    )
    row.last_seen_at = auth_service.utcnow()
    before = row.expires_at
    auth_service.touch_session(db_session, row)
    assert row.expires_at == before
