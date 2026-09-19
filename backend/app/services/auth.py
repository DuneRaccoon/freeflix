"""Token, session, passcode and rate-limit primitives for the instance-claim model.

Stdlib only — ``secrets`` + ``hashlib`` + ``hmac`` cover everything here, so none of
passlib/bcrypt/argon2/pyjwt/itsdangerous is needed (each would be a Poetry dependency
and therefore an image rebuild).

Two invariants the rest of the auth code depends on:

* **Only hashes are stored.** Every token — magic link, invite, session cookie — is a
  ``secrets.token_urlsafe(32)`` whose sha256 goes in the database. A database read
  cannot impersonate anyone, and a leaked backup cannot be replayed.
* **Naive UTC everywhere.** Every ``DateTime`` column in this schema is declared
  without ``timezone=True``, so Postgres drops the tzinfo and reads back a NAIVE value.
  Comparing that to an aware ``datetime.now(timezone.utc)`` raises
  ``TypeError: can't compare offset-naive and offset-aware datetimes``. :func:`utcnow`
  is the only clock the auth code is allowed to use.
"""

from __future__ import annotations

import base64
import datetime
import hashlib
import hmac
import secrets
import threading
from dataclasses import dataclass, field
from typing import Iterable, Optional, Union

from loguru import logger
from sqlalchemy.orm import Session

from app.config import settings
from app.database.models.accounts import (
    Account,
    AuthSession,
    AuthToken,
    STATUS_ACTIVE,
)

# Crockford-ish: no I, O, 0 or 1, so a code read off a terminal cannot be mistyped.
_CLAIM_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"

_PBKDF2_ITERATIONS = 260_000
_PBKDF2_PREFIX = "pbkdf2_sha256"


# --------------------------------------------------------------------------- time


def utcnow() -> datetime.datetime:
    """Naive UTC — the only clock the auth layer uses. See the module docstring."""
    return datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)


# ------------------------------------------------------------------------- tokens


def generate_token() -> str:
    """A fresh opaque token. Returned to the caller ONCE; only its hash is stored."""
    return secrets.token_urlsafe(32)


def hash_token(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def tokens_match(raw: str, stored_hash: str) -> bool:
    return hmac.compare_digest(hash_token(raw), stored_hash or "")


def generate_claim_code() -> str:
    """``XXXX-XXXX-XXXX`` — long enough to be unguessable, short enough to retype."""
    groups = [
        "".join(secrets.choice(_CLAIM_ALPHABET) for _ in range(4)) for _ in range(3)
    ]
    return "-".join(groups)


def normalize_claim_code(raw: str) -> str:
    """Accept the code however the operator pastes it: spaces, lowercase, no dashes."""
    cleaned = "".join(ch for ch in (raw or "").upper() if ch.isalnum())
    return "-".join(cleaned[i:i + 4] for i in range(0, len(cleaned), 4))


def normalize_email(raw: str) -> str:
    return (raw or "").strip().lower()


# ----------------------------------------------------------------------- passcodes


def _hash_secret(secret: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac(
        "sha256", secret.encode("utf-8"), salt, _PBKDF2_ITERATIONS
    )
    return "{}${}${}${}".format(
        _PBKDF2_PREFIX,
        _PBKDF2_ITERATIONS,
        base64.b64encode(salt).decode("ascii"),
        base64.b64encode(digest).decode("ascii"),
    )


def _verify_secret(secret: str, stored: Optional[str]) -> bool:
    if not stored or not secret:
        return False
    try:
        prefix, iterations, salt_b64, hash_b64 = stored.split("$")
        if prefix != _PBKDF2_PREFIX:
            return False
        digest = hashlib.pbkdf2_hmac(
            "sha256",
            secret.encode("utf-8"),
            base64.b64decode(salt_b64),
            int(iterations),
        )
        return hmac.compare_digest(digest, base64.b64decode(hash_b64))
    except Exception:
        # A malformed hash is a failed verification, never a 500.
        return False


# A profile passcode and an owner password are different things with different threat
# models — a 4-digit household PIN versus the key to the whole instance — so they keep
# separate names even though the KDF is shared.

def hash_passcode(passcode: str) -> str:
    return _hash_secret(passcode)


def verify_passcode(passcode: str, stored: Optional[str]) -> bool:
    return _verify_secret(passcode, stored)


def hash_password(password: str) -> str:
    return _hash_secret(password)


def verify_password(password: str, stored: Optional[str]) -> bool:
    return _verify_secret(password, stored)


# Long enough to be worth having, with no composition rules — those push people toward
# predictable substitutions. The upper bound is a DoS guard: PBKDF2 cost scales with
# input length and this endpoint is unauthenticated.
PASSWORD_MIN_LENGTH = 10
PASSWORD_MAX_LENGTH = 128


def password_problem(password: str, *, email: Optional[str] = None) -> Optional[str]:
    """Human-readable reason the password is unacceptable, or None if it is fine."""
    if not password or len(password) < PASSWORD_MIN_LENGTH:
        return f"Use at least {PASSWORD_MIN_LENGTH} characters."
    if len(password) > PASSWORD_MAX_LENGTH:
        return f"Use at most {PASSWORD_MAX_LENGTH} characters."
    if password.strip() != password:
        return "Remove the leading or trailing spaces."
    if email and password.lower() == normalize_email(email):
        return "Choose something other than your email address."
    return None


# -------------------------------------------------------------------- rate limiting


@dataclass
class _Bucket:
    hits: list = field(default_factory=list)


class RateLimiter:
    """In-process sliding-window limiter, keyed by a caller-supplied string.

    Deliberately NOT keyed by IP: every browser request reaches FastAPI from the
    `frontend` container's address (the Next rewrite proxy) and uvicorn is started
    without ``proxy_headers``, so a per-IP bucket would collapse into one global bucket
    and let a single attacker lock out the whole household. Auth endpoints key on the
    normalized email instead.

    Single-process only (compose runs ``workers=1``). If the backend is ever scaled
    out, this needs to move to the database or a shared cache.
    """

    # Hard ceiling on retained buckets. Reached only under attack; a household instance
    # never comes close.
    MAX_BUCKETS = 4096

    def __init__(self) -> None:
        self._buckets: dict[str, _Bucket] = {}
        self._lock = threading.Lock()

    @staticmethod
    def _digest(key: str) -> str:
        """Bound the key.

        ``POST /auth/request-link`` is unauthenticated and its body is attacker-supplied,
        so using the raw address as a dict key lets anyone pin arbitrary bytes in this
        process for its lifetime — 100 requests carrying 10 MB each is ~1 GB, and the
        Raspberry Pi target is OOM-killed along with the libtorrent session. Hashing
        makes every key 64 bytes regardless of input.
        """
        return hashlib.sha256(key.encode("utf-8", "ignore")).hexdigest()

    def _prune(self, cutoff: datetime.datetime) -> None:
        """Drop buckets with no live hits. Caller must hold the lock."""
        dead = [k for k, b in self._buckets.items()
                if not [h for h in b.hits if h > cutoff]]
        for k in dead:
            del self._buckets[k]

    def check(self, key: str, *, limit: int, window_seconds: int) -> bool:
        """True if the call is allowed (and records it); False if over the limit."""
        now = utcnow()
        cutoff = now - datetime.timedelta(seconds=window_seconds)
        digest = self._digest(key)
        with self._lock:
            if digest not in self._buckets and len(self._buckets) >= self.MAX_BUCKETS:
                # Sweep expired entries before admitting a new key. If the table is
                # still full every bucket is live, which means a flood — fail CLOSED so
                # the endpoint throttles rather than growing without bound.
                self._prune(cutoff)
                if len(self._buckets) >= self.MAX_BUCKETS:
                    return False
            bucket = self._buckets.setdefault(digest, _Bucket())
            bucket.hits = [h for h in bucket.hits if h > cutoff]
            if len(bucket.hits) >= limit:
                return False
            bucket.hits.append(now)
            return True

    def reset(self, key: str) -> None:
        with self._lock:
            self._buckets.pop(self._digest(key), None)

    def clear(self) -> None:
        with self._lock:
            self._buckets.clear()


rate_limiter = RateLimiter()


# ----------------------------------------------------------------- magic-link tokens


def issue_auth_token(
    session: Session,
    *,
    email: str,
    purpose: str,
    account_id: Optional[str] = None,
    ttl_minutes: Optional[int] = None,
) -> tuple[str, AuthToken]:
    """Mint a single-use magic-link token. Returns ``(raw_token, row)``.

    The raw token is returned exactly once, for the email body. It is never logged and
    never stored.
    """
    raw = generate_token()
    ttl = ttl_minutes if ttl_minutes is not None else settings.magic_link_ttl_minutes
    row = AuthToken(
        token_hash=hash_token(raw),
        email=normalize_email(email),
        account_id=account_id,
        purpose=purpose,
        expires_at=utcnow() + datetime.timedelta(minutes=ttl),
    )
    session.add(row)
    session.flush()
    return raw, row


def consume_auth_token(
    session: Session,
    raw: str,
    *,
    purpose: Optional[Union[str, Iterable[str]]] = None,
) -> Optional[AuthToken]:
    """Validate and burn a magic-link token in one step.

    ``consumed_at`` is stamped inside the caller's transaction, so two concurrent
    clicks on the same link cannot both succeed. Returns None for unknown, expired,
    already-consumed or wrong-purpose tokens — the caller maps that to a 410 without
    distinguishing the cases.

    ``purpose`` accepts one value or several. ALWAYS pass it: the purpose is checked
    BEFORE the token is stamped, so an endpoint that consumes first and filters
    afterwards would let anyone destroy a link simply by POSTing it to the wrong
    endpoint — it survives only as long as the surrounding transaction happens to roll
    back, which is not a property to depend on.
    """
    if not raw:
        return None
    row = (
        session.query(AuthToken)
        .filter(AuthToken.token_hash == hash_token(raw))
        .first()
    )
    if row is None:
        return None
    if purpose is not None:
        allowed = {purpose} if isinstance(purpose, str) else set(purpose)
        if row.purpose not in allowed:
            return None
    if not row.is_usable(utcnow()):
        return None
    row.consumed_at = utcnow()
    session.flush()
    return row


def invalidate_tokens_for(
    session: Session,
    *,
    purpose: str,
    email: Optional[str] = None,
    account_id: Optional[str] = None,
) -> int:
    """Burn every outstanding token of one purpose, by address OR by account.

    Called before minting a new one so an old link in an inbox stops working the
    moment a fresh one is requested.

    Scoping by ``account_id`` matters for the claim: ``POST /claim`` overwrites the
    owner account's email with each submission, so filtering on the NEW address would
    miss the token already sent to a mistyped one — and that link still points at the
    same owner account, so whoever controls the typo'd mailbox could claim the instance.
    """
    now = utcnow()
    query = session.query(AuthToken).filter(
        AuthToken.purpose == purpose,
        AuthToken.consumed_at.is_(None),
    )
    if account_id is not None:
        query = query.filter(AuthToken.account_id == account_id)
    if email is not None:
        query = query.filter(AuthToken.email == normalize_email(email))
    rows = query.all()
    for row in rows:
        row.consumed_at = now
    return len(rows)


# --------------------------------------------------------------------- sessions


def create_session(
    session: Session,
    account: Account,
    *,
    user_agent: Optional[str] = None,
) -> tuple[str, AuthSession]:
    """Start a signed-in session. Returns ``(raw_cookie_value, row)``."""
    raw = generate_token()
    row = AuthSession(
        token_hash=hash_token(raw),
        account_id=account.id,
        expires_at=utcnow() + datetime.timedelta(days=settings.session_ttl_days),
        last_seen_at=utcnow(),
        user_agent=(user_agent or "")[:512] or None,
        unlocked_profiles=[],
    )
    session.add(row)
    account.last_login_at = utcnow()
    session.flush()
    return raw, row


def lookup_session(session: Session, raw: str) -> Optional[AuthSession]:
    """Resolve a cookie value to a live session row, or None."""
    if not raw:
        return None
    row = (
        session.query(AuthSession)
        .filter(AuthSession.token_hash == hash_token(raw))
        .first()
    )
    if row is None or not row.is_usable(utcnow()):
        return None
    return row


def touch_session(session: Session, row: AuthSession) -> None:
    """Sliding ``last_seen_at``, written at most once a minute.

    Without the throttle every request on every page would issue an UPDATE, which on
    a Raspberry Pi instance is real write amplification for no benefit.
    """
    now = utcnow()
    if row.last_seen_at is None or (now - row.last_seen_at).total_seconds() > 60:
        row.last_seen_at = now


def revoke_session(session: Session, row: AuthSession) -> None:
    row.revoked_at = utcnow()


def revoke_all_sessions_for_account(session: Session, account_id: str) -> int:
    """Kill every session of one account — used by revoke, remove and transfer.

    A soft ``CRUDMixin.delete()`` would NOT do this: it only stamps ``deleted_at``, and
    nothing in the codebase filters on that column, so a "revoked" account would keep
    authenticating.
    """
    now = utcnow()
    rows = (
        session.query(AuthSession)
        .filter(
            AuthSession.account_id == account_id,
            AuthSession.revoked_at.is_(None),
        )
        .all()
    )
    for row in rows:
        row.revoked_at = now
    return len(rows)


def mark_profile_unlocked(session: Session, row: AuthSession, profile_id: str) -> None:
    """Record that this session entered the profile's passcode.

    Reassigning the list (rather than appending in place) is required: SQLAlchemy does
    not track mutations inside a plain JSON column, so an in-place append would never
    be flushed.
    """
    current = list(row.unlocked_profiles or [])
    if profile_id not in current:
        current.append(profile_id)
        row.unlocked_profiles = current


def purge_expired(session: Session) -> dict[str, int]:
    """Housekeeping: drop dead tokens and sessions. Safe to call on any schedule."""
    now = utcnow()
    tokens = (
        session.query(AuthToken)
        .filter(AuthToken.expires_at < now - datetime.timedelta(days=1))
        .delete(synchronize_session=False)
    )
    sessions = (
        session.query(AuthSession)
        .filter(AuthSession.expires_at < now - datetime.timedelta(days=1))
        .delete(synchronize_session=False)
    )
    if tokens or sessions:
        logger.info(f"Purged {tokens} expired auth tokens and {sessions} sessions")
    return {"tokens": tokens, "sessions": sessions}


# ------------------------------------------------------------------ cookie helpers


def cookie_kwargs() -> dict:
    """Attributes for ``response.set_cookie``.

    * ``path="/"`` — next.config.ts also exposes the entire backend under
      ``/_backend/*``; a ``Path=/api`` cookie would not be sent there and the Settings
      system panel would break.
    * no ``domain`` — FastAPI answers through the Next proxy, so any Domain attribute
      makes the browser reject the cookie outright.
    * ``samesite="lax"`` — ``strict`` would drop the cookie on the top-level navigation
      that follows a magic-link click, which is the one flow that must work.
    * ``secure`` is configurable because dev serves plain http://localhost:3001, where
      a Secure cookie is silently discarded.
    """
    return {
        "httponly": True,
        "samesite": "lax",
        "secure": settings.cookie_secure,
        "path": "/",
    }
