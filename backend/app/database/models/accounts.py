"""Instance-claim identity tables: Instance, Account, Invite, AuthToken, AuthSession.

These are all BRAND-NEW tables, which `Base.metadata.create_all()` creates in full
(columns, NOT NULL, defaults, indexes, FKs) on every deploy — fresh or upgraded —
provided this module is imported from `app/database/models/__init__.py`. A model that
is only imported by a router never reaches `Base.metadata` and silently does not exist
in production.

Two mixin traps this module deliberately avoids:

1. ``Model.created_at`` is declared ``default=datetime.datetime.now(...)`` — the call
   is evaluated ONCE at class-definition time, so every row written by a process shares
   a timestamp. Every timestamp column here therefore passes a CALLABLE default.
2. Columns are declared plain ``DateTime`` (no ``timezone=True``) to match the rest of
   the schema. Postgres drops the tzinfo on write, so values read back are naive and
   comparing them to an aware ``now()`` raises TypeError. All auth code reads and writes
   NAIVE UTC via ``app.services.auth.utcnow()``.
"""

import datetime
from sqlalchemy import (
    Column, DateTime, ForeignKey, Integer, JSON, String, Index
)
from sqlalchemy.orm import relationship

from app.database.mixins import Model, generate_uuid


def _utcnow() -> datetime.datetime:
    """Naive UTC. Mirrors app.services.auth.utcnow(); duplicated here so the model
    layer has no import cycle with the service layer."""
    return datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)


# Account.status
STATUS_PENDING_EMAIL = "pending_email"  # migrated from a pre-auth profile, no email yet
STATUS_INVITED = "invited"              # invite sent, not yet accepted
STATUS_ACTIVE = "active"
STATUS_REVOKED = "revoked"

# Account.role
ROLE_OWNER = "owner"
ROLE_MEMBER = "member"

# AuthToken.purpose
PURPOSE_LOGIN = "login"
PURPOSE_CLAIM_VERIFY = "claim_verify"
PURPOSE_INVITE = "invite"
# Sets a NEW password. Never grants a session on its own — only
# POST /auth/reset-password consumes it, and only together with a new password.
PURPOSE_PASSWORD_RESET = "password_reset"

INSTANCE_SINGLETON_ID = "singleton"


class Instance(Model):
    """One row, id='singleton'. Holds claim state for this deployment."""
    __tablename__ = "instance"

    id = Column(String, primary_key=True, default=lambda: INSTANCE_SINGLETON_ID)

    # NULL => unclaimed. Set once, at the moment the owner verifies their email.
    claimed_at = Column(DateTime, nullable=True)
    # sha256 of the current boot's claim code. Regenerated on every boot while
    # unclaimed, cleared the moment the instance is claimed.
    claim_code_hash = Column(String, nullable=True)
    owner_account_id = Column(
        String, ForeignKey("accounts.id", ondelete="SET NULL"), nullable=True
    )
    instance_name = Column(String, nullable=True)

    owner = relationship("Account", foreign_keys=[owner_account_id])

    @property
    def is_claimed(self) -> bool:
        return self.claimed_at is not None


class Account(Model):
    """An email-bearing identity. Owns one or more profiles (`users` rows)."""
    __tablename__ = "accounts"

    id = Column(String, primary_key=True, default=generate_uuid)

    # Nullable because migrated pre-auth profiles get an account before they have an
    # email. Postgres and SQLite both allow multiple NULLs under a UNIQUE index.
    # Always stored lowercased — see app.services.auth.normalize_email.
    email = Column(String, nullable=True, unique=True, index=True)
    role = Column(String, nullable=False, default=ROLE_MEMBER, index=True)
    status = Column(String, nullable=False, default=STATUS_PENDING_EMAIL, index=True)
    display_name = Column(String, nullable=True)

    # OWNERS ONLY. The owner signs in with a password; members are magic-link only and
    # must never have one set. pbkdf2_sha256$... — nullable because it arrives via
    # sync_columns on an upgraded database, and because an owner created by an ownership
    # transfer has none until they follow the "set your password" email.
    password_hash = Column(String, nullable=True)

    invited_by_id = Column(
        String, ForeignKey("accounts.id", ondelete="SET NULL"), nullable=True
    )
    last_login_at = Column(DateTime, nullable=True)

    # selectin, not the default lazy="select": these are read inside a `with db as
    # session:` block and serialized after it closes, where a lazy load would raise
    # DetachedInstanceError. `User.settings` is the existing precedent.
    profiles = relationship(
        "User",
        back_populates="account",
        cascade="all, delete-orphan",
        lazy="selectin",
    )
    invited_by = relationship("Account", remote_side=[id], foreign_keys=[invited_by_id])

    @property
    def is_owner(self) -> bool:
        return self.role == ROLE_OWNER

    @property
    def can_sign_in(self) -> bool:
        return self.status == STATUS_ACTIVE and bool(self.email)


class Invite(Model):
    """A pending invitation. Only the sha256 of the token is ever stored."""
    __tablename__ = "invites"

    id = Column(String, primary_key=True, default=generate_uuid)

    token_hash = Column(String, nullable=False, unique=True, index=True)
    email = Column(String, nullable=False, index=True)
    role = Column(String, nullable=False, default=ROLE_MEMBER)

    # Two FKs to the same table, so every relationship below must name its
    # foreign_keys explicitly (same shape as Torrent.movie_cache).
    invited_by_id = Column(
        String, ForeignKey("accounts.id", ondelete="SET NULL"), nullable=True
    )
    account_id = Column(
        String, ForeignKey("accounts.id", ondelete="CASCADE"), nullable=True, index=True
    )

    expires_at = Column(DateTime, nullable=False, default=_utcnow)
    accepted_at = Column(DateTime, nullable=True)
    revoked_at = Column(DateTime, nullable=True)

    invited_by = relationship("Account", foreign_keys=[invited_by_id])
    account = relationship("Account", foreign_keys=[account_id])

    def is_usable(self, now: datetime.datetime) -> bool:
        return (
            self.accepted_at is None
            and self.revoked_at is None
            and self.expires_at is not None
            and self.expires_at > now
        )


class AuthToken(Model):
    """Single-use magic link. Covers sign-in, claim verification and invite links."""
    __tablename__ = "auth_tokens"

    id = Column(String, primary_key=True, default=generate_uuid)

    token_hash = Column(String, nullable=False, unique=True, index=True)
    email = Column(String, nullable=False, index=True)
    account_id = Column(
        String, ForeignKey("accounts.id", ondelete="CASCADE"), nullable=True, index=True
    )
    purpose = Column(String, nullable=False)
    expires_at = Column(DateTime, nullable=False, default=_utcnow)
    consumed_at = Column(DateTime, nullable=True)

    account = relationship("Account", foreign_keys=[account_id])

    def is_usable(self, now: datetime.datetime) -> bool:
        return (
            self.consumed_at is None
            and self.expires_at is not None
            and self.expires_at > now
        )


class AuthSession(Model):
    """A signed-in browser session. The cookie carries the raw token; only its
    sha256 is stored, so a database read cannot impersonate anyone."""
    __tablename__ = "auth_sessions"

    id = Column(String, primary_key=True, default=generate_uuid)

    token_hash = Column(String, nullable=False, unique=True, index=True)
    account_id = Column(
        String, ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False, index=True
    )
    expires_at = Column(DateTime, nullable=False, default=_utcnow, index=True)
    last_seen_at = Column(DateTime, nullable=True)
    user_agent = Column(String, nullable=True)

    # Set only for a session minted by device pairing. device_kind drives the sliding
    # expiry in touch_session: a television cannot re-authenticate by itself, so its
    # session renews on use, while a browser session keeps its absolute expiry.
    device_name = Column(String, nullable=True)
    device_kind = Column(String, nullable=True)

    # list[str] of profile ids whose passcode has been entered in this session.
    # This is what makes the per-profile lock real rather than a client-side hint.
    unlocked_profiles = Column(JSON, nullable=True)

    revoked_at = Column(DateTime, nullable=True)

    account = relationship("Account", foreign_keys=[account_id])

    def is_usable(self, now: datetime.datetime) -> bool:
        return (
            self.revoked_at is None
            and self.expires_at is not None
            and self.expires_at > now
        )


# Pairing statuses. A row moves pending -> approved -> consumed, or pending -> denied.
# "consumed" is terminal and is what makes a device_code single-use.
PAIRING_PENDING = "pending"
PAIRING_APPROVED = "approved"
PAIRING_DENIED = "denied"
PAIRING_CONSUMED = "consumed"


class DevicePairing(Model):
    """One in-flight attempt to put a session on a device that has no keyboard.

    Two secrets with different jobs. ``device_code`` is long, random and stays on the
    device; it is the thing that receives the session, so only its sha256 is stored.
    ``user_code`` is short enough to read off a television across a room, so it is NOT
    a secret — it is an index into a pending request. Guessing one lets an attacker
    approve somebody else's device, which requires them to already hold a valid account
    and gains them nothing.
    """

    __tablename__ = "auth_device_pairings"

    id = Column(String, primary_key=True, default=generate_uuid)

    device_code_hash = Column(String, nullable=False, unique=True, index=True)

    # Indexed but NOT unique: uniqueness is enforced among live rows in application
    # code (generate, check, retry). A full unique index would let one consumed row
    # reserve its code forever, and a partial index is not expressible via sync_indexes.
    user_code = Column(String, nullable=False, index=True)

    status = Column(String, nullable=False, default=PAIRING_PENDING, index=True)
    device_name = Column(String, nullable=True)
    approved_account_id = Column(
        String, ForeignKey("accounts.id", ondelete="CASCADE"), nullable=True, index=True
    )

    created_at = Column(DateTime, nullable=False, default=_utcnow)
    expires_at = Column(DateTime, nullable=False, default=_utcnow, index=True)
    consumed_at = Column(DateTime, nullable=True)

    # Abuse counters. poll_count is also how a stuck device shows up in the logs.
    poll_count = Column(Integer, nullable=False, default=0)
    approve_attempts = Column(Integer, nullable=False, default=0)

    account = relationship("Account", foreign_keys=[approved_account_id])

    def is_usable(self, now: datetime.datetime) -> bool:
        """Still awaiting approval. Approved rows are NOT usable — see is_claimable."""
        return (
            self.status == PAIRING_PENDING
            and self.expires_at is not None
            and self.expires_at > now
        )

    def is_claimable(self, now: datetime.datetime) -> bool:
        """Approved and not yet exchanged for a session."""
        return (
            self.status == PAIRING_APPROVED
            and self.consumed_at is None
            and self.expires_at is not None
            and self.expires_at > now
        )


# Composite index for the hot path of the members page.
Index("ix_accounts_role_status", Account.role, Account.status)
