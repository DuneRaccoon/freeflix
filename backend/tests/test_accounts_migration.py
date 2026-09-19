"""The upgrade migration: existing profiles become account-owned, nothing is lost.

This is the test that protects decision 6 of the design — an existing household must
survive the upgrade with its watch progress, watchlists and settings intact.
"""

import os

os.environ.setdefault("DB_PATH", "/tmp/test_accounts_migration.db")

import datetime

import pytest

from app.database.models import User, UserSettings
from app.database.models.accounts import (
    Account,
    INSTANCE_SINGLETON_ID,
    Instance,
    ROLE_MEMBER,
    ROLE_OWNER,
    STATUS_ACTIVE,
    STATUS_PENDING_EMAIL,
)
from app.services import accounts as accounts_service
from app.services import auth as auth_service


def _legacy_profile(db, name, *, created_at=None, settings_kwargs=None):
    """A pre-auth profile: no account_id, exactly as an upgraded database has it."""
    profile = User(username=name.lower(), display_name=name)
    if created_at is not None:
        profile.created_at = created_at
    db.add(profile)
    db.flush()
    if settings_kwargs is not None:
        db.add(UserSettings(user_id=profile.id, **settings_kwargs))
        db.flush()
    return profile


# ------------------------------------------------------------------ the happy path


def test_oldest_profile_becomes_the_owner(db_session):
    base = datetime.datetime(2024, 1, 1)
    _legacy_profile(db_session, "Ben", created_at=base)
    _legacy_profile(db_session, "Sam", created_at=base + datetime.timedelta(days=1))
    _legacy_profile(db_session, "Kids", created_at=base + datetime.timedelta(days=2))

    report = accounts_service.migrate_users_to_accounts(db_session)

    assert report.accounts_created == 3
    assert report.owner_profile_name == "Ben"

    owners = db_session.query(Account).filter(Account.role == ROLE_OWNER).all()
    members = db_session.query(Account).filter(Account.role == ROLE_MEMBER).all()
    assert len(owners) == 1
    assert len(members) == 2


def test_every_profile_gets_an_account_and_no_data_moves(db_session):
    ben = _legacy_profile(db_session, "Ben")
    sam = _legacy_profile(db_session, "Sam")

    accounts_service.migrate_users_to_accounts(db_session)
    db_session.commit()

    assert ben.account_id is not None
    assert sam.account_id is not None
    assert ben.account_id != sam.account_id
    # Profile rows are updated in place — never deleted and recreated, which would
    # cascade away user_streaming_progress and user_watchlist via ondelete=CASCADE.
    assert db_session.query(User).count() == 2


def test_accounts_start_pending_with_no_email(db_session):
    _legacy_profile(db_session, "Ben")

    accounts_service.migrate_users_to_accounts(db_session)

    account = db_session.query(Account).first()
    assert account.status == STATUS_PENDING_EMAIL
    assert account.email is None
    assert account.display_name == "Ben"


def test_ordering_is_deterministic_when_created_at_ties(db_session):
    """Model.created_at's default is evaluated once at class-definition time, so every
    row written by one process shares a timestamp and 'oldest' is a genuine tie. The
    migration must still pick the SAME owner on every run."""
    same = datetime.datetime(2024, 5, 5, 12, 0, 0)
    a = _legacy_profile(db_session, "Aaa", created_at=same)
    b = _legacy_profile(db_session, "Bbb", created_at=same)
    c = _legacy_profile(db_session, "Ccc", created_at=same)

    accounts_service.migrate_users_to_accounts(db_session)
    db_session.commit()

    expected_owner_id = min(a.id, b.id, c.id)
    owner = db_session.query(Account).filter(Account.role == ROLE_OWNER).one()
    owner_profile = db_session.query(User).filter(User.account_id == owner.id).one()
    assert owner_profile.id == expected_owner_id


# ----------------------------------------------------------------------- healing


def test_profiles_without_settings_get_one(db_session):
    """A settings-less profile makes GET /api/v1/users raise for the WHOLE list
    (user.settings.to_dict() has no None guard), blanking the only way into the app."""
    _legacy_profile(db_session, "Ben")  # no settings row at all

    report = accounts_service.migrate_users_to_accounts(db_session)
    db_session.commit()

    assert report.settings_created == 1
    assert db_session.query(UserSettings).count() == 1


def test_plaintext_passcodes_are_hashed_and_blanked(db_session):
    _legacy_profile(
        db_session,
        "Kids",
        settings_kwargs={"require_passcode": True, "passcode": "4821"},
    )

    report = accounts_service.migrate_users_to_accounts(db_session)
    db_session.commit()

    row = db_session.query(UserSettings).one()
    assert report.passcodes_hashed == 1
    assert row.passcode is None           # legacy column emptied
    assert row.passcode_hash              # and rehomed
    assert row.passcode_len == 4
    assert auth_service.verify_passcode("4821", row.passcode_hash)
    # The user's intent survives — the profile is still locked.
    assert row.require_passcode is True


def test_profile_without_a_passcode_is_untouched(db_session):
    _legacy_profile(db_session, "Ben", settings_kwargs={"require_passcode": False})

    report = accounts_service.migrate_users_to_accounts(db_session)

    assert report.passcodes_hashed == 0
    assert db_session.query(UserSettings).one().passcode_hash is None


# --------------------------------------------------------------------- idempotency


def test_migration_is_idempotent(db_session):
    _legacy_profile(db_session, "Ben")
    _legacy_profile(db_session, "Sam")

    accounts_service.migrate_users_to_accounts(db_session)
    db_session.commit()
    second = accounts_service.migrate_users_to_accounts(db_session)
    db_session.commit()

    assert second.accounts_created == 0
    assert second.already_migrated is True
    assert db_session.query(Account).count() == 2


def test_a_second_owner_is_never_minted(db_session):
    """A profile added after the upgrade must become a member, not a rival owner."""
    _legacy_profile(db_session, "Ben")
    accounts_service.migrate_users_to_accounts(db_session)
    db_session.commit()

    _legacy_profile(db_session, "LateArrival")
    accounts_service.migrate_users_to_accounts(db_session)
    db_session.commit()

    assert db_session.query(Account).filter(Account.role == ROLE_OWNER).count() == 1
    assert db_session.query(Account).filter(Account.role == ROLE_MEMBER).count() == 1


def test_empty_database_migrates_cleanly(db_session):
    report = accounts_service.migrate_users_to_accounts(db_session)

    assert report.accounts_created == 0
    assert report.already_migrated is True
    # The instance row is still created so the claim flow has something to write to.
    assert db_session.query(Instance).filter(
        Instance.id == INSTANCE_SINGLETON_ID
    ).first() is not None


# ------------------------------------------------------------------- verification


def test_verify_migration_is_quiet_on_a_healthy_database(db_session):
    _legacy_profile(db_session, "Ben")
    accounts_service.migrate_users_to_accounts(db_session)
    db_session.commit()

    assert accounts_service.verify_migration(db_session) == []


def test_verify_migration_reports_orphans(db_session):
    """sync_columns and startup both swallow failures as log lines, so a half-migrated
    schema boots fine and 500s later. This is the loud check."""
    _legacy_profile(db_session, "Ben")  # never migrated
    db_session.commit()

    problems = accounts_service.verify_migration(db_session)

    assert any("no account_id" in p for p in problems)


def test_verify_migration_reports_a_second_owner(db_session):
    db_session.add(Account(role=ROLE_OWNER, status=STATUS_PENDING_EMAIL))
    db_session.add(Account(role=ROLE_OWNER, status=STATUS_PENDING_EMAIL))
    db_session.commit()

    problems = accounts_service.verify_migration(db_session)

    assert any("owner accounts exist" in p for p in problems)


# --------------------------------------------------------------------- claim state


def test_unclaimed_instance_gets_a_verifiable_code(db_session, tmp_path, monkeypatch):
    from app.config import settings as app_settings

    monkeypatch.setattr(app_settings, "log_path", tmp_path)

    code = accounts_service.ensure_claim_code(db_session)
    db_session.commit()

    assert code is not None
    assert accounts_service.verify_claim_code(db_session, code)
    assert not accounts_service.verify_claim_code(db_session, "ZZZZ-ZZZZ-ZZZZ")
    # Written where the operator can actually read it — a persisted volume, not the
    # image's writable layer, which vanishes on every `make build`.
    assert (tmp_path / "claim_code.txt").read_text().strip() == code


def test_claiming_clears_the_code(db_session, tmp_path, monkeypatch):
    from app.config import settings as app_settings

    monkeypatch.setattr(app_settings, "log_path", tmp_path)

    accounts_service.ensure_claim_code(db_session)
    account = accounts_service.attach_owner_email(db_session, "ben@example.com")
    accounts_service.finalize_claim(db_session, account)
    db_session.commit()

    instance = accounts_service.get_instance(db_session)
    assert instance.claimed_at is not None
    assert instance.claim_code_hash is None
    assert account.status == STATUS_ACTIVE
    assert not (tmp_path / "claim_code.txt").exists()
    assert accounts_service.is_claimed(db_session)


def test_claiming_attaches_to_the_migrated_owner_rather_than_creating_a_new_one(db_session):
    """The whole point of decision 6: the claimer keeps the oldest profile's data."""
    # created_at MUST be pinned. Left to the mixin default it is a process-wide constant
    # (evaluated once at class-definition time), so both profiles tie and the tiebreak
    # falls to a random uuid4 id — making the assertion below a coin flip.
    ben = _legacy_profile(db_session, "Ben", created_at=datetime.datetime(2024, 1, 1))
    _legacy_profile(db_session, "Sam", created_at=datetime.datetime(2024, 6, 1))
    accounts_service.migrate_users_to_accounts(db_session)
    db_session.commit()

    account = accounts_service.attach_owner_email(db_session, "ben@example.com")
    db_session.commit()

    assert db_session.query(Account).count() == 2  # no third account appeared
    assert account.role == ROLE_OWNER
    assert ben.account_id == account.id
    assert accounts_service.get_instance(db_session).owner_account_id == account.id


def test_claiming_a_brand_new_instance_creates_the_owner(db_session):
    account = accounts_service.attach_owner_email(db_session, "new@example.com")
    db_session.commit()

    assert account.role == ROLE_OWNER
    assert account.email == "new@example.com"


def test_email_is_normalised_on_claim(db_session):
    account = accounts_service.attach_owner_email(db_session, "  Ben@EXAMPLE.com ")
    assert account.email == "ben@example.com"
