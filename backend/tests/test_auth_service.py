"""Unit tests for app/services/auth.py — tokens, passcodes, sessions, rate limiting."""

import os

os.environ.setdefault("DB_PATH", "/tmp/test_auth_service.db")

import datetime

import pytest

from app.config import settings
from app.database.models.accounts import (
    Account,
    AuthSession,
    PURPOSE_LOGIN,
    STATUS_ACTIVE,
)
from app.services import auth as auth_service


# ------------------------------------------------------------------ token hashing


def test_generated_tokens_are_unique_and_opaque():
    tokens = {auth_service.generate_token() for _ in range(200)}
    assert len(tokens) == 200
    assert all(len(t) >= 32 for t in tokens)


def test_only_the_hash_is_comparable():
    raw = auth_service.generate_token()
    stored = auth_service.hash_token(raw)

    assert stored != raw
    assert len(stored) == 64  # sha256 hex
    assert auth_service.tokens_match(raw, stored)
    assert not auth_service.tokens_match(raw + "x", stored)


def test_tokens_match_tolerates_empty_stored_hash():
    # A row whose hash column is NULL must fail closed, not raise.
    assert not auth_service.tokens_match("anything", None)
    assert not auth_service.tokens_match("anything", "")


# -------------------------------------------------------------------- claim codes


def test_claim_code_shape_and_alphabet():
    code = auth_service.generate_claim_code()
    groups = code.split("-")

    assert len(groups) == 3
    assert all(len(g) == 4 for g in groups)
    # No I, O, 0 or 1 — a code read off a terminal must not be mistypeable.
    assert not set(code) & set("IO01")


@pytest.mark.parametrize(
    "typed",
    ["ABCD-EFGH-JKLM", "abcd-efgh-jklm", "ABCDEFGHJKLM", " abcd efgh jklm "],
)
def test_claim_code_normalisation_accepts_however_it_was_pasted(typed):
    assert auth_service.normalize_claim_code(typed) == "ABCD-EFGH-JKLM"


def test_claim_code_verification_is_hash_based():
    code = auth_service.generate_claim_code()
    stored = auth_service.hash_token(code)

    assert auth_service.tokens_match(auth_service.normalize_claim_code(code), stored)
    assert not auth_service.tokens_match("ZZZZ-ZZZZ-ZZZZ", stored)


# ---------------------------------------------------------------------- passcodes


def test_passcode_round_trip():
    stored = auth_service.hash_passcode("4821")

    assert stored.startswith("pbkdf2_sha256$")
    assert "4821" not in stored
    assert auth_service.verify_passcode("4821", stored)
    assert not auth_service.verify_passcode("4822", stored)


def test_passcode_hashes_are_salted():
    assert auth_service.hash_passcode("1234") != auth_service.hash_passcode("1234")


@pytest.mark.parametrize("stored", [None, "", "garbage", "pbkdf2_sha256$notanint$a$b"])
def test_malformed_passcode_hash_fails_closed(stored):
    # A corrupt hash column must be a failed verification, never a 500.
    assert not auth_service.verify_passcode("1234", stored)


def test_empty_passcode_never_verifies():
    stored = auth_service.hash_passcode("1234")
    assert not auth_service.verify_passcode("", stored)


# ------------------------------------------------------------------ email handling


@pytest.mark.parametrize(
    "raw,expected",
    [("  Ben@Example.COM ", "ben@example.com"), ("a@b.c", "a@b.c"), ("", "")],
)
def test_email_normalisation(raw, expected):
    assert auth_service.normalize_email(raw) == expected


# ------------------------------------------------------------------ rate limiting


def test_rate_limiter_allows_up_to_the_limit_then_blocks():
    limiter = auth_service.RateLimiter()

    assert all(limiter.check("k", limit=3, window_seconds=60) for _ in range(3))
    assert not limiter.check("k", limit=3, window_seconds=60)


def test_rate_limiter_buckets_are_independent():
    limiter = auth_service.RateLimiter()

    for _ in range(3):
        limiter.check("a@x.com", limit=3, window_seconds=60)

    # One address being throttled must not lock out the rest of the household.
    assert limiter.check("b@x.com", limit=3, window_seconds=60)


def test_rate_limiter_window_expires():
    limiter = auth_service.RateLimiter()
    limiter.check("k", limit=1, window_seconds=60)
    assert not limiter.check("k", limit=1, window_seconds=60)

    # A zero-length window means every prior hit is already outside it.
    assert limiter.check("k", limit=1, window_seconds=0)


# ----------------------------------------------------------------------- the clock


def test_utcnow_is_naive():
    """Every DateTime column is declared without timezone=True, so Postgres reads back
    a NAIVE value. Mixing an aware now() into an expiry comparison raises TypeError."""
    now = auth_service.utcnow()

    assert now.tzinfo is None
    # Comparing against a stored-style naive value must not raise.
    assert now > now - datetime.timedelta(seconds=1)


# ------------------------------------------------------- tokens and sessions on a DB


def _account(db_session, email="owner@example.com"):
    account = Account(email=email, role="owner", status=STATUS_ACTIVE)
    db_session.add(account)
    db_session.flush()
    return account


def test_auth_token_is_single_use(db_session):
    account = _account(db_session)
    raw, _ = auth_service.issue_auth_token(
        db_session, email=account.email, purpose=PURPOSE_LOGIN, account_id=account.id
    )

    assert auth_service.consume_auth_token(db_session, raw, purpose=PURPOSE_LOGIN)
    # Second click on the same emailed link must fail.
    assert auth_service.consume_auth_token(db_session, raw, purpose=PURPOSE_LOGIN) is None


def test_auth_token_rejects_wrong_purpose(db_session):
    account = _account(db_session)
    raw, _ = auth_service.issue_auth_token(
        db_session, email=account.email, purpose=PURPOSE_LOGIN, account_id=account.id
    )

    assert auth_service.consume_auth_token(db_session, raw, purpose="claim_verify") is None
    # ...and the token is still unburnt for its real purpose.
    assert auth_service.consume_auth_token(db_session, raw, purpose=PURPOSE_LOGIN)


def test_expired_auth_token_is_rejected(db_session):
    account = _account(db_session)
    raw, row = auth_service.issue_auth_token(
        db_session, email=account.email, purpose=PURPOSE_LOGIN, account_id=account.id
    )
    row.expires_at = auth_service.utcnow() - datetime.timedelta(seconds=1)
    db_session.flush()

    assert auth_service.consume_auth_token(db_session, raw) is None


def test_issuing_a_new_link_invalidates_the_old_one(db_session):
    account = _account(db_session)
    first, _ = auth_service.issue_auth_token(
        db_session, email=account.email, purpose=PURPOSE_LOGIN, account_id=account.id
    )

    auth_service.invalidate_tokens_for(
        db_session, email=account.email, purpose=PURPOSE_LOGIN
    )
    second, _ = auth_service.issue_auth_token(
        db_session, email=account.email, purpose=PURPOSE_LOGIN, account_id=account.id
    )

    # A forwarded stale link must stop working the moment a fresh one is requested.
    assert auth_service.consume_auth_token(db_session, first) is None
    assert auth_service.consume_auth_token(db_session, second)


def test_session_round_trip(db_session):
    account = _account(db_session)
    raw, row = auth_service.create_session(db_session, account, user_agent="pytest")

    found = auth_service.lookup_session(db_session, raw)
    assert found is not None and found.id == row.id
    assert account.last_login_at is not None


def test_revoked_session_stops_resolving(db_session):
    account = _account(db_session)
    raw, row = auth_service.create_session(db_session, account)

    auth_service.revoke_session(db_session, row)
    db_session.flush()

    assert auth_service.lookup_session(db_session, raw) is None


def test_expired_session_stops_resolving(db_session):
    account = _account(db_session)
    raw, row = auth_service.create_session(db_session, account)
    row.expires_at = auth_service.utcnow() - datetime.timedelta(seconds=1)
    db_session.flush()

    assert auth_service.lookup_session(db_session, raw) is None


def test_revoke_all_sessions_kills_every_device(db_session):
    account = _account(db_session)
    raws = [auth_service.create_session(db_session, account)[0] for _ in range(3)]
    db_session.flush()

    killed = auth_service.revoke_all_sessions_for_account(db_session, account.id)
    db_session.flush()

    assert killed == 3
    assert all(auth_service.lookup_session(db_session, r) is None for r in raws)


def test_unlocked_profiles_are_reassigned_not_mutated(db_session):
    """SQLAlchemy does not track in-place mutation of a plain JSON column, so an
    append would never be flushed and the profile would appear locked forever."""
    account = _account(db_session)
    _, row = auth_service.create_session(db_session, account)

    auth_service.mark_profile_unlocked(db_session, row, "profile-1")
    auth_service.mark_profile_unlocked(db_session, row, "profile-1")  # idempotent
    auth_service.mark_profile_unlocked(db_session, row, "profile-2")
    db_session.commit()

    refreshed = db_session.query(AuthSession).filter(AuthSession.id == row.id).first()
    assert refreshed.unlocked_profiles == ["profile-1", "profile-2"]


def test_cookie_attributes_match_the_proxy_topology():
    kwargs = auth_service.cookie_kwargs()

    assert kwargs["httponly"] is True
    # Path must be "/" — next.config.ts also exposes the whole backend under
    # /_backend/*, which a Path=/api cookie would never reach.
    assert kwargs["path"] == "/"
    # Lax, not Strict: the magic-link click is a top-level cross-site navigation and
    # Strict would drop the cookie on exactly the one flow that has to work.
    assert kwargs["samesite"] == "lax"
    # No Domain — FastAPI answers through the Next proxy and any Domain attribute
    # makes the browser reject the cookie outright.
    assert "domain" not in kwargs
    assert kwargs["secure"] is settings.cookie_secure


# ------------------------------------------------- rate limiter, hardened (review fix)


def test_rate_limiter_key_length_is_bounded():
    """POST /auth/request-link is unauthenticated and its body is attacker-supplied, so
    the raw address must never become a dict key — 100 requests carrying 10 MB each
    would pin ~1 GB for the life of the process."""
    limiter = auth_service.RateLimiter()
    huge = "a" * 5_000_000

    limiter.check(huge, limit=3, window_seconds=60)

    stored = list(limiter._buckets.keys())
    assert len(stored) == 1
    assert len(stored[0]) == 64  # sha256 hex, whatever came in


def test_rate_limiter_evicts_expired_buckets_instead_of_growing():
    limiter = auth_service.RateLimiter()
    limiter.MAX_BUCKETS = 8

    # Fill past the ceiling with keys whose window has already closed.
    for i in range(20):
        limiter.check(f"stale-{i}", limit=1, window_seconds=0)

    assert len(limiter._buckets) <= limiter.MAX_BUCKETS


def test_rate_limiter_fails_closed_when_every_bucket_is_live():
    """Under a genuine flood the table cannot be pruned, and growing without bound would
    OOM the Raspberry Pi target along with the libtorrent session."""
    limiter = auth_service.RateLimiter()
    limiter.MAX_BUCKETS = 4

    for i in range(4):
        assert limiter.check(f"live-{i}", limit=5, window_seconds=600)

    assert not limiter.check("one-too-many", limit=5, window_seconds=600)


def test_rate_limiter_reset_matches_the_hashed_key():
    limiter = auth_service.RateLimiter()
    limiter.check("a@b.c", limit=1, window_seconds=600)
    assert not limiter.check("a@b.c", limit=1, window_seconds=600)

    limiter.reset("a@b.c")

    assert limiter.check("a@b.c", limit=1, window_seconds=600)


# ---------------------------------------- token invalidation by account (review fix)


def test_tokens_can_be_invalidated_by_account_not_just_email(db_session):
    """POST /claim overwrites the owner's email on every submission, so invalidating by
    the NEW address would leave a link already sent to a mistyped one live — and it
    points at the same owner account."""
    account = _account(db_session, email="typo@gmial.com")
    stale, _ = auth_service.issue_auth_token(
        db_session,
        email="typo@gmial.com",
        purpose="claim_verify",
        account_id=account.id,
    )
    account.email = "real@gmail.com"
    db_session.flush()

    # Scoped by the corrected address: misses the stale token entirely.
    assert auth_service.invalidate_tokens_for(
        db_session, email="real@gmail.com", purpose="claim_verify"
    ) == 0
    assert auth_service.consume_auth_token(db_session, stale) is not None

    # Scoped by account: burns it.
    stale2, _ = auth_service.issue_auth_token(
        db_session, email="typo@gmial.com", purpose="claim_verify", account_id=account.id
    )
    assert auth_service.invalidate_tokens_for(
        db_session, account_id=account.id, purpose="claim_verify"
    ) == 1
    assert auth_service.consume_auth_token(db_session, stale2) is None
