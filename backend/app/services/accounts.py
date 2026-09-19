"""Instance claim, the upgrade migration, and account/profile lifecycle.

Everything here is written against two hard constraints of this codebase:

* There is no migration framework. ``sync_columns()`` only ever ADDs columns, so all
  DATA movement (the users -> accounts backfill) has to be explicit, idempotent Python
  that is safe to run on every boot.
* ``init_db()`` executes at *import* time — ``app/cron/jobs.py`` ends with
  ``schedule_manager = ScheduleManager()`` whose ``__init__`` calls it, and
  ``app/main.py`` imports that module BEFORE ``settings.initialize()`` creates the
  runtime directories. So nothing in this module may run from ``init_db()``; the
  bootstrap is invoked from the FastAPI ``startup`` event instead, where the
  directories exist and failures can be reported loudly.
"""

from __future__ import annotations

import datetime
import os
import re
import secrets
from dataclasses import dataclass, field
from typing import Optional

from loguru import logger
from sqlalchemy.orm import Session

from app.config import settings
from app.database.models import User, UserSettings
from app.database.models.accounts import (
    Account,
    AuthSession,
    INSTANCE_SINGLETON_ID,
    Instance,
    Invite,
    ROLE_MEMBER,
    ROLE_OWNER,
    STATUS_ACTIVE,
    STATUS_INVITED,
    STATUS_PENDING_EMAIL,
    STATUS_REVOKED,
)
from app.services import auth as auth_service


# ------------------------------------------------------------------ instance row


def get_instance(session: Session, *, create: bool = True) -> Optional[Instance]:
    row = session.query(Instance).filter(Instance.id == INSTANCE_SINGLETON_ID).first()
    if row is None and create:
        row = Instance(id=INSTANCE_SINGLETON_ID)
        session.add(row)
        session.flush()
    return row


def is_claimed(session: Session) -> bool:
    row = get_instance(session, create=False)
    return bool(row and row.claimed_at is not None)


# --------------------------------------------------------------------- migration


@dataclass
class MigrationReport:
    accounts_created: int = 0
    settings_created: int = 0
    passcodes_hashed: int = 0
    owner_account_id: Optional[str] = None
    owner_profile_name: Optional[str] = None
    already_migrated: bool = False
    problems: list[str] = field(default_factory=list)


def migrate_users_to_accounts(session: Session) -> MigrationReport:
    """Give every pre-auth profile an account, oldest profile becoming the owner.

    Idempotent: a profile that already has an ``account_id`` is skipped, and no second
    owner is ever minted. Safe to run on every boot and in every test that starts the
    app.

    Ordering caveat: ``Model.created_at`` is declared
    ``default=datetime.datetime.now(timezone.utc)`` — the call is evaluated ONCE at
    class-definition time, so every row written by a single process shares a timestamp,
    and ids are random uuid4 with no sequence to fall back on. "Oldest" can therefore be
    a genuine tie. We order by ``(created_at, id)`` so the choice is at least
    DETERMINISTIC across reruns, and the chosen owner's profile name is printed in the
    boot banner so the operator can see who is about to be handed the instance.
    """
    report = MigrationReport()

    unmigrated = (
        session.query(User)
        .filter(User.account_id.is_(None))
        .order_by(User.created_at.asc(), User.id.asc())
        .all()
    )

    existing_owner = (
        session.query(Account).filter(Account.role == ROLE_OWNER).first()
    )

    if not unmigrated:
        report.already_migrated = True
        if existing_owner is not None:
            report.owner_account_id = existing_owner.id
        _ensure_instance_owner(session, report)
        return report

    for index, profile in enumerate(unmigrated):
        is_first_owner = existing_owner is None and index == 0
        account = Account(
            email=None,
            role=ROLE_OWNER if is_first_owner else ROLE_MEMBER,
            status=STATUS_PENDING_EMAIL,
            display_name=profile.display_name,
        )
        session.add(account)
        session.flush()

        profile.account_id = account.id
        report.accounts_created += 1

        if is_first_owner:
            existing_owner = account
            report.owner_account_id = account.id
            report.owner_profile_name = profile.display_name

        # A profile with no settings row makes GET /api/v1/users 500 for the WHOLE
        # list (`user.settings.to_dict()` has no None guard), which would lock everyone
        # out of the picker — the only way into the app. Heal it here.
        if profile.settings is None:
            session.add(UserSettings(user_id=profile.id))
            report.settings_created += 1
        else:
            if _migrate_plaintext_passcode(profile.settings):
                report.passcodes_hashed += 1

    session.flush()
    _ensure_instance_owner(session, report)
    return report


def _migrate_plaintext_passcode(row: UserSettings) -> bool:
    """Hash a surviving plaintext passcode and blank the legacy column.

    The old ``passcode`` column was returned verbatim by ``GET /api/v1/users`` through
    ``UserResponse.settings``, so treat every value in it as already compromised — but
    preserve the user's intent rather than silently unlocking their profile.
    """
    plaintext = (row.passcode or "").strip()
    if not plaintext or row.passcode_hash:
        row.passcode = None
        return False
    row.passcode_hash = auth_service.hash_passcode(plaintext)
    row.passcode_len = len(plaintext)
    row.passcode = None
    return True


def _ensure_instance_owner(session: Session, report: MigrationReport) -> None:
    instance = get_instance(session)
    if instance.owner_account_id is None:
        owner = session.query(Account).filter(Account.role == ROLE_OWNER).first()
        if owner is not None:
            instance.owner_account_id = owner.id
            report.owner_account_id = owner.id
    session.flush()


def verify_migration(session: Session) -> list[str]:
    """Postconditions, checked explicitly.

    ``sync_columns`` and ``sync_indexes`` swallow every failure as a log warning, and
    ``startup_event`` wraps ``init_db()`` in a try/except that only logs — so a
    half-migrated schema boots normally and 500s on the first query that touches it.
    This is the loud check that turns that silent failure into an actionable error.
    """
    problems: list[str] = []

    orphans = session.query(User).filter(User.account_id.is_(None)).count()
    if orphans:
        problems.append(f"{orphans} profile(s) still have no account_id")

    owners = session.query(Account).filter(Account.role == ROLE_OWNER).count()
    if owners > 1:
        problems.append(f"{owners} owner accounts exist — there must be exactly one")

    settingless = (
        session.query(User)
        .outerjoin(UserSettings, UserSettings.user_id == User.id)
        .filter(UserSettings.id.is_(None))
        .count()
    )
    if settingless:
        problems.append(f"{settingless} profile(s) have no settings row")

    for problem in problems:
        logger.error(f"Instance-claim migration postcondition failed: {problem}")
    return problems


# ------------------------------------------------------------------- claim code


def ensure_claim_code(session: Session) -> Optional[str]:
    """Mint a fresh claim code when the instance is unclaimed. Returns the plaintext.

    Regenerated on every boot while unclaimed, so an operator who loses the code just
    restarts the container. Cleared the instant the instance is claimed.
    """
    instance = get_instance(session)
    if instance.claimed_at is not None:
        clear_claim_code(session)
        return None

    code = auth_service.generate_claim_code()
    instance.claim_code_hash = auth_service.hash_token(code)
    session.flush()
    _write_claim_code_file(code)
    return code


def clear_claim_code(session: Session) -> None:
    instance = get_instance(session)
    instance.claim_code_hash = None
    session.flush()
    try:
        if settings.claim_code_file.exists():
            settings.claim_code_file.unlink()
    except Exception as e:  # pragma: no cover - filesystem edge
        logger.warning(f"Could not remove claim code file: {e}")


def _write_claim_code_file(code: str) -> None:
    """Persist the plaintext code where the operator can read it.

    ``settings.claim_code_file`` resolves under the ``logs`` named volume — the only
    writable, PERSISTED path the backend container has besides downloads. Writing to
    ``base_app_path`` would put it in the image's writable layer, where it vanishes on
    every ``make build`` while the Postgres volume survives, leaving the instance
    unclaimed with an unrecoverable code.
    """
    try:
        settings.claim_code_file.parent.mkdir(parents=True, exist_ok=True)
        settings.claim_code_file.write_text(code + "\n", encoding="utf-8")
        os.chmod(settings.claim_code_file, 0o600)
    except Exception as e:
        logger.warning(f"Could not write claim code file: {e}")


def log_claim_banner(code: str, owner_profile_name: Optional[str]) -> None:
    claim_url = f"{settings.app_public_url.rstrip('/')}/claim"
    owner_line = (
        f"  Owner will be: {owner_profile_name}"
        if owner_profile_name
        else "  Owner will be: the first person to claim"
    )
    banner = (
        "\n"
        "  ┌──────────────────────────────────────────────────────┐\n"
        "  │  THIS FRÈ INSTANCE IS UNCLAIMED                      │\n"
        "  ├──────────────────────────────────────────────────────┤\n"
        f"  │  Claim code:  {code:<39}│\n"
        f"  │  Claim at:    {claim_url:<39}│\n"
        "  └──────────────────────────────────────────────────────┘\n"
        f"{owner_line}\n"
        f"  Also written to: {settings.claim_code_file}\n"
        "  A new code is generated on every restart until the instance is claimed.\n"
    )
    logger.warning(banner)


def verify_claim_code(session: Session, submitted: str) -> bool:
    instance = get_instance(session, create=False)
    if instance is None or not instance.claim_code_hash:
        return False
    normalized = auth_service.normalize_claim_code(submitted)
    return auth_service.tokens_match(normalized, instance.claim_code_hash)


# ----------------------------------------------------------------------- claiming


def account_for_email(session: Session, email: str) -> Optional[Account]:
    normalized = auth_service.normalize_email(email)
    if not normalized:
        return None
    return session.query(Account).filter(Account.email == normalized).first()


def attach_owner_email(session: Session, email: str) -> Account:
    """Bind the claimer's address to the instance's owner account.

    On an upgraded deploy the migration has already created an owner account (linked to
    the oldest profile, status ``pending_email``), so claiming ATTACHES the email to
    that account and the owner keeps every profile, watch position and watchlist entry.
    On a brand-new deploy there is nothing to attach to, so an owner account is created.
    """
    normalized = auth_service.normalize_email(email)
    owner = session.query(Account).filter(Account.role == ROLE_OWNER).first()

    if owner is None:
        owner = Account(
            email=normalized,
            role=ROLE_OWNER,
            status=STATUS_PENDING_EMAIL,
        )
        session.add(owner)
        session.flush()
    else:
        owner.email = normalized

    instance = get_instance(session)
    instance.owner_account_id = owner.id
    session.flush()
    return owner


def finalize_claim(session: Session, account: Account) -> None:
    account.status = STATUS_ACTIVE
    instance = get_instance(session)
    instance.claimed_at = auth_service.utcnow()
    session.flush()
    clear_claim_code(session)
    logger.info(f"Instance claimed by {account.email}")


# ------------------------------------------------------------------------ invites


def create_invite(
    session: Session, *, email: str, invited_by: Account, role: str = ROLE_MEMBER
) -> tuple[str, Invite, Account]:
    """Mint an invite, reusing a pending account so migrated data survives.

    Returns ``(raw_token, invite_row, target_account)``. Raises ValueError with a stable
    reason string the router maps to a 409.
    """
    normalized = auth_service.normalize_email(email)
    if not normalized or "@" not in normalized:
        raise ValueError("invalid_email")

    existing = account_for_email(session, normalized)
    if existing is not None and existing.status == STATUS_ACTIVE:
        raise ValueError("already_a_member")

    if existing is not None:
        target = existing
        target.status = STATUS_INVITED
    else:
        # Reuse an un-emailed account from the migration if the owner is re-inviting a
        # household member whose profiles already exist. The owner picks which one via
        # the account_id argument on the router; with no hint we create a new account.
        target = Account(
            email=normalized,
            role=role,
            status=STATUS_INVITED,
            invited_by_id=invited_by.id,
        )
        session.add(target)
        session.flush()

    # Any outstanding invite for this address stops working the moment a new one is
    # issued, so a forwarded old link cannot be redeemed after a resend.
    revoke_open_invites(session, normalized)

    raw = auth_service.generate_token()
    invite = Invite(
        token_hash=auth_service.hash_token(raw),
        email=normalized,
        role=role,
        invited_by_id=invited_by.id,
        account_id=target.id,
        expires_at=auth_service.utcnow()
        + datetime.timedelta(hours=settings.invite_ttl_hours),
    )
    session.add(invite)
    session.flush()
    return raw, invite, target


def adopt_pending_account(
    session: Session, *, account_id: str, email: str
) -> Account:
    """Attach an address to a specific migrated ``pending_email`` account.

    This is how an existing household member keeps their profiles, progress and
    watchlist through the upgrade: the owner picks their row on /members and sends the
    invite to that account rather than creating a fresh one.
    """
    account = session.query(Account).filter(Account.id == account_id).first()
    if account is None:
        raise ValueError("unknown_account")
    if account.status == STATUS_ACTIVE:
        raise ValueError("already_a_member")

    normalized = auth_service.normalize_email(email)
    clash = account_for_email(session, normalized)
    if clash is not None and clash.id != account.id:
        raise ValueError("email_in_use")

    account.email = normalized
    account.status = STATUS_INVITED
    session.flush()
    return account


def revoke_open_invites(session: Session, email: str) -> int:
    now = auth_service.utcnow()
    rows = (
        session.query(Invite)
        .filter(
            Invite.email == auth_service.normalize_email(email),
            Invite.accepted_at.is_(None),
            Invite.revoked_at.is_(None),
        )
        .all()
    )
    for row in rows:
        row.revoked_at = now
    return len(rows)


def lookup_invite(session: Session, raw: str) -> Optional[Invite]:
    if not raw:
        return None
    row = (
        session.query(Invite)
        .filter(Invite.token_hash == auth_service.hash_token(raw))
        .first()
    )
    if row is None or not row.is_usable(auth_service.utcnow()):
        return None
    return row


def accept_invite(
    session: Session, invite: Invite, *, display_name: str, avatar: Optional[str]
) -> tuple[Account, User]:
    """Burn the invite, activate the account, and create its first profile."""
    account = (
        session.query(Account).filter(Account.id == invite.account_id).first()
        if invite.account_id
        else None
    )
    if account is None:
        account = Account(
            email=invite.email, role=invite.role, invited_by_id=invite.invited_by_id
        )
        session.add(account)
        session.flush()

    account.email = invite.email
    account.status = STATUS_ACTIVE
    if not account.display_name:
        account.display_name = display_name

    invite.accepted_at = auth_service.utcnow()

    # A migrated account already owns profiles; do not mint a duplicate.
    existing_profiles = (
        session.query(User).filter(User.account_id == account.id).count()
    )
    if existing_profiles:
        profile = (
            session.query(User)
            .filter(User.account_id == account.id)
            .order_by(User.created_at.asc(), User.id.asc())
            .first()
        )
    else:
        profile = create_profile(
            session, account=account, display_name=display_name, avatar=avatar
        )

    session.flush()
    return account, profile


# ----------------------------------------------------------------------- profiles


_SLUG_RE = re.compile(r"[^a-z0-9]+")


def _unique_username(session: Session, display_name: str) -> str:
    """Generate a collision-free username.

    ``users.username`` is ``unique=True`` instance-globally, and the old client-side
    generator (``slug-${Date.now().toString(36).slice(-4)}``) could collide and surface
    only as a generic "Could not create the profile" toast. Generating server-side with
    a retry loop makes that impossible.
    """
    base = _SLUG_RE.sub("-", (display_name or "").lower()).strip("-")[:24] or "profile"
    for _ in range(10):
        candidate = f"{base}-{secrets.token_hex(3)}"
        exists = session.query(User).filter(User.username == candidate).first()
        if exists is None:
            return candidate
    return f"{base}-{secrets.token_hex(8)}"


def create_profile(
    session: Session,
    *,
    account: Account,
    display_name: str,
    avatar: Optional[str] = None,
) -> User:
    """Create a profile AND its settings row.

    Always paired: a profile with no ``user_settings`` row makes ``GET /api/v1/users``
    raise for the entire list, which blanks the profile picker for that whole account.
    """
    profile = User(
        username=_unique_username(session, display_name),
        display_name=display_name,
        avatar=avatar,
        account_id=account.id,
    )
    session.add(profile)
    session.flush()
    session.add(UserSettings(user_id=profile.id))
    session.flush()
    return profile


def profiles_for_account(session: Session, account_id: str) -> list[User]:
    return (
        session.query(User)
        .filter(User.account_id == account_id)
        .order_by(User.created_at.asc(), User.id.asc())
        .all()
    )


# ---------------------------------------------------------------- member lifecycle


def revoke_account(session: Session, account: Account) -> None:
    """Stop an account signing in, without destroying anything.

    Deliberately a ``status`` change plus a session sweep, NOT ``CRUDMixin.delete()``:
    that would only stamp ``deleted_at``, and no query in this codebase filters on that
    column, so the "revoked" member would keep authenticating.
    """
    account.status = STATUS_REVOKED
    auth_service.revoke_all_sessions_for_account(session, account.id)
    auth_service.invalidate_tokens_for(
        session, email=account.email or "", purpose="login"
    )
    revoke_open_invites(session, account.email or "")
    session.flush()


def restore_account(session: Session, account: Account) -> None:
    account.status = STATUS_ACTIVE if account.email else STATUS_PENDING_EMAIL
    session.flush()


def remove_account(session: Session, account: Account) -> None:
    """Hard-delete an account and everything hanging off it.

    ``hard_delete`` matters: the soft path would leave a fully functional row. The
    cascade takes profiles -> settings/progress/watchlist. ``torrents.user_id`` and
    ``schedules.user_id`` are NULL on every row in every deployment (nothing has ever
    written them), so no download or schedule is orphaned or destroyed.
    """
    auth_service.revoke_all_sessions_for_account(session, account.id)
    session.delete(account)
    session.flush()


def transfer_ownership(session: Session, *, current: Account, target: Account) -> None:
    if target.status != STATUS_ACTIVE:
        raise ValueError("target_not_active")
    current.role = ROLE_MEMBER
    target.role = ROLE_OWNER
    instance = get_instance(session)
    instance.owner_account_id = target.id
    session.flush()
    logger.info(f"Instance ownership transferred to {target.email}")


def bootstrap(session: Session) -> MigrationReport:
    """The whole first-run/upgrade sequence. Called from the startup event only.

    Never from ``init_db()``: that runs at import time, before ``settings.initialize()``
    has created the log directory the claim code file lives in.
    """
    report = migrate_users_to_accounts(session)
    report.problems = verify_migration(session)

    instance = get_instance(session)
    if instance.claimed_at is None:
        code = ensure_claim_code(session)
        if code:
            log_claim_banner(code, report.owner_profile_name)
    else:
        clear_claim_code(session)

    auth_service.purge_expired(session)
    return report
