"""Pairing lifecycle, without HTTP.

The user_code alphabet is the interesting part: it must not be able to spell a word
(so a code can never look like an instruction) and must not contain glyphs that are
misread across a room.
"""
import datetime

import pytest

from app.database.models.accounts import (
    DevicePairing, PAIRING_PENDING, PAIRING_APPROVED, PAIRING_CONSUMED, PAIRING_DENIED,
)
from app.services import auth as auth_service
from app.services import device_pairing as dp


def test_alphabet_has_no_vowels_and_no_confusable_glyphs():
    assert set("AEIOU") & set(dp.USER_CODE_ALPHABET) == set()
    assert set("01OI") & set(dp.USER_CODE_ALPHABET) == set()
    assert len(dp.USER_CODE_ALPHABET) == len(set(dp.USER_CODE_ALPHABET))


def test_format_and_normalize_round_trip():
    assert dp.format_user_code("BCDFGHJK") == "BCDF-GHJK"
    assert dp.normalize_user_code("bcdf-ghjk") == "BCDFGHJK"
    assert dp.normalize_user_code("  BCDF GHJK  ") == "BCDFGHJK"
    assert dp.normalize_user_code("BCDF-GHJK") == dp.normalize_user_code("bcdfghjk")


def test_normalize_drops_characters_outside_the_alphabet():
    # A phone keyboard will happily offer O and 0; neither is in the alphabet, so a
    # code containing one was mistyped and must not silently match something else.
    assert dp.normalize_user_code("BCDF-GH0K") == "BCDFGHK"


def test_start_pairing_returns_a_raw_code_and_stores_only_its_hash(db_session):
    raw, row = dp.start_pairing(db_session, ttl_minutes=10)
    assert len(raw) > 30
    assert row.device_code_hash == auth_service.hash_token(raw)
    assert raw not in (row.device_code_hash or "")
    assert row.status == PAIRING_PENDING
    assert len(row.user_code) == dp.USER_CODE_LENGTH
    assert set(row.user_code) <= set(dp.USER_CODE_ALPHABET)


def test_start_pairing_sets_the_ttl(db_session):
    before = auth_service.utcnow()
    _, row = dp.start_pairing(db_session, ttl_minutes=10)
    delta = row.expires_at - before
    assert datetime.timedelta(minutes=9) < delta <= datetime.timedelta(minutes=10, seconds=5)


def test_two_pairings_do_not_share_a_user_code(db_session):
    _, a = dp.start_pairing(db_session, ttl_minutes=10)
    _, b = dp.start_pairing(db_session, ttl_minutes=10)
    assert a.user_code != b.user_code
    assert a.device_code_hash != b.device_code_hash


def test_user_code_collision_is_retried(db_session, monkeypatch):
    # Force the generator to repeat itself once, then differ. The retry loop must
    # notice the live row and try again rather than cross-wiring two devices.
    _, first = dp.start_pairing(db_session, ttl_minutes=10)
    db_session.flush()
    seq = iter([first.user_code, "ZZZZZZZZ"])
    monkeypatch.setattr(dp, "_random_user_code", lambda: next(seq))
    _, second = dp.start_pairing(db_session, ttl_minutes=10)
    assert second.user_code == "ZZZZZZZZ"


def test_consumed_or_expired_rows_do_not_force_retry(db_session, monkeypatch):
    # The collision detector filters on status (pending/approved) and expires_at > now.
    # If a consumed or expired row holds a code, the generator must NOT retry past it.
    # This test seeds a consumed row with a known code, forces the generator to return
    # that code on first attempt, and asserts it is accepted (not retried).

    # Consume a row with a known code.
    _, consumed = dp.start_pairing(db_session, ttl_minutes=10)
    dp.approve(db_session, consumed, account_id="a", device_name="TV")
    dp.consume(db_session, consumed)
    db_session.flush()

    # Force the generator to return the consumed row's code on first attempt.
    monkeypatch.setattr(dp, "_random_user_code", lambda: consumed.user_code)

    # start_pairing must succeed and use that code, not retry past the consumed row.
    raw, new = dp.start_pairing(db_session, ttl_minutes=10)
    assert new.user_code == consumed.user_code
    # They are different rows, proving the code was reused (not rejected).
    assert new.id != consumed.id


def test_find_by_device_code_matches_only_the_hash(db_session):
    raw, row = dp.start_pairing(db_session, ttl_minutes=10)
    db_session.flush()
    assert dp.find_by_device_code(db_session, raw) is not None
    assert dp.find_by_device_code(db_session, raw + "x") is None
    assert dp.find_by_device_code(db_session, "") is None


def test_find_pending_only_finds_live_pending_rows(db_session):
    _, row = dp.start_pairing(db_session, ttl_minutes=10)
    db_session.flush()
    assert dp.find_pending_by_user_code(db_session, row.user_code) is not None

    dp.approve(db_session, row, account_id="acct-1", device_name="TV")
    db_session.flush()
    # Approval moves it out of "pending".
    assert dp.find_pending_by_user_code(db_session, row.user_code) is None


def test_find_pending_ignores_an_expired_row(db_session):
    _, row = dp.start_pairing(db_session, ttl_minutes=10)
    row.expires_at = auth_service.utcnow() - datetime.timedelta(seconds=1)
    db_session.flush()
    assert dp.find_pending_by_user_code(db_session, row.user_code) is None


def test_approve_refuses_a_row_that_is_not_pending_and_live(db_session):
    _, row = dp.start_pairing(db_session, ttl_minutes=10)
    assert dp.approve(db_session, row, account_id="a", device_name="TV") is True
    # Already approved: a second approve must not rebind it.
    assert dp.approve(db_session, row, account_id="b", device_name="Other") is False
    assert row.approved_account_id == "a"

    _, stale = dp.start_pairing(db_session, ttl_minutes=10)
    stale.expires_at = auth_service.utcnow() - datetime.timedelta(seconds=1)
    assert dp.approve(db_session, stale, account_id="a", device_name="TV") is False
    assert stale.status == PAIRING_PENDING


def test_deny_burns_pending_and_approved_but_not_terminal_or_expired(db_session):
    _, pending = dp.start_pairing(db_session, ttl_minutes=10)
    assert dp.deny(db_session, pending) is True
    assert pending.status == PAIRING_DENIED

    # device_poll denies an APPROVED row whose account went inactive.
    _, approved = dp.start_pairing(db_session, ttl_minutes=10)
    dp.approve(db_session, approved, account_id="a", device_name="TV")
    assert dp.deny(db_session, approved) is True

    _, consumed = dp.start_pairing(db_session, ttl_minutes=10)
    dp.approve(db_session, consumed, account_id="a", device_name="TV")
    dp.consume(db_session, consumed)
    assert dp.deny(db_session, consumed) is False
    assert consumed.status == PAIRING_CONSUMED

    _, stale = dp.start_pairing(db_session, ttl_minutes=10)
    stale.expires_at = auth_service.utcnow() - datetime.timedelta(seconds=1)
    assert dp.deny(db_session, stale) is False


def test_approve_records_account_and_name(db_session):
    _, row = dp.start_pairing(db_session, ttl_minutes=10)
    dp.approve(db_session, row, account_id="acct-1", device_name="Living Room TV")
    assert row.status == PAIRING_APPROVED
    assert row.approved_account_id == "acct-1"
    assert row.device_name == "Living Room TV"


def test_approve_truncates_a_hostile_device_name(db_session):
    _, row = dp.start_pairing(db_session, ttl_minutes=10)
    dp.approve(db_session, row, account_id="a", device_name="x" * 5000)
    assert len(row.device_name) <= dp.DEVICE_NAME_MAX_LENGTH


def test_approve_falls_back_to_a_default_name(db_session):
    _, row = dp.start_pairing(db_session, ttl_minutes=10)
    dp.approve(db_session, row, account_id="a", device_name="   ")
    assert row.device_name == dp.DEFAULT_DEVICE_NAME


def test_consume_is_terminal(db_session):
    _, row = dp.start_pairing(db_session, ttl_minutes=10)
    dp.approve(db_session, row, account_id="a", device_name="TV")
    dp.consume(db_session, row)
    assert row.status == PAIRING_CONSUMED
    assert row.consumed_at is not None
    now = auth_service.utcnow()
    assert row.is_claimable(now) is False
    assert row.is_usable(now) is False
