"""The pairing table must reach Base.metadata, and AuthSession must carry device columns.

A model imported only by a router never reaches Base.metadata and silently does not
exist in production — accounts.py's own module docstring warns about exactly this. The
first test is the guard for it.
"""
import datetime

from app.database.session import Base
from app.database.models import DevicePairing, AuthSession
from app.database.models.accounts import (
    PAIRING_PENDING, PAIRING_APPROVED, PAIRING_DENIED, PAIRING_CONSUMED,
)


def test_table_is_registered_on_the_metadata():
    assert "auth_device_pairings" in Base.metadata.tables


def test_pairing_columns_exist():
    cols = {c.name for c in DevicePairing.__table__.columns}
    assert {
        "id", "device_code_hash", "user_code", "status", "device_name",
        "approved_account_id", "created_at", "expires_at", "consumed_at",
        "poll_count", "approve_attempts",
    } <= cols


def test_device_code_hash_is_unique_and_indexed():
    col = DevicePairing.__table__.columns["device_code_hash"]
    assert col.unique is True
    assert col.index is True


def test_user_code_is_indexed_but_not_unique():
    # Uniqueness among LIVE rows is enforced in application code; a partial unique
    # index is not expressible through sync_indexes, and a full unique index would
    # make a consumed row block its code forever.
    col = DevicePairing.__table__.columns["user_code"]
    assert col.index is True
    assert not col.unique


def test_timestamp_defaults_are_callables():
    # Model.created_at's default is evaluated once at class-definition time, so every
    # row written by a process would share a timestamp. Defaults must be callables.
    for name in ("created_at", "expires_at"):
        default = DevicePairing.__table__.columns[name].default
        assert default is not None and callable(default.arg), name


def test_status_constants():
    assert (PAIRING_PENDING, PAIRING_APPROVED, PAIRING_DENIED, PAIRING_CONSUMED) == (
        "pending", "approved", "denied", "consumed",
    )


def test_auth_session_gained_nullable_device_columns():
    cols = AuthSession.__table__.columns
    assert "device_name" in cols and cols["device_name"].nullable
    assert "device_kind" in cols and cols["device_kind"].nullable


def test_is_usable_requires_pending_and_unexpired():
    now = datetime.datetime(2026, 1, 1, 12, 0, 0)
    row = DevicePairing(
        status=PAIRING_PENDING, expires_at=now + datetime.timedelta(minutes=5)
    )
    assert row.is_usable(now) is True
    row.status = PAIRING_CONSUMED
    assert row.is_usable(now) is False
    row.status = PAIRING_PENDING
    row.expires_at = now - datetime.timedelta(seconds=1)
    assert row.is_usable(now) is False
