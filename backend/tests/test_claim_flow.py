"""The first-run claim, end to end over HTTP.

Regression coverage for two review findings that both end in a permanently unclaimable
or wrongly-owned instance:

* the owner account was bound to the LAST address typed into /claim rather than the one
  actually proven by clicking the emailed link, so two submissions (a typo, or a race
  with someone else who read the boot banner) could hand ownership to the wrong person;
* a claim-verify link minted for a mistyped address stayed live after the operator
  re-claimed with the correct one, because invalidation filtered on the new address
  while the stale token still pointed at the same owner account.

Since the owner became password-authenticated, ``POST /claim`` also carries the password
the owner is choosing — it is written onto the account immediately and, like the address,
only takes effect once the emailed link proves the mailbox. Every submission here must
send one or the request is a 422 before any claim logic runs. ``test_owner_password.py``
covers the credential itself.
"""

import os

os.environ.setdefault("DB_PATH", "/tmp/test_claim_flow.db")

import pytest
from fastapi.testclient import TestClient

from app.config import settings
from app.database.models.accounts import (
    Account,
    PURPOSE_CLAIM_VERIFY,
    ROLE_OWNER,
    STATUS_ACTIVE,
)
from app.database.session import get_db
from app.main import app
from app.services import accounts as accounts_service
from app.services import auth as auth_service

# Any value that clears app.services.auth.password_problem(): 10-128 characters, no
# leading or trailing spaces, not equal to the address.
CLAIM_PASSWORD = "a-perfectly-fine-password"


@pytest.fixture
def unclaimed(db_session, override_get_db, auth_enabled, monkeypatch, tmp_path):
    """A fresh, unclaimed instance with a known claim code."""
    from app.config import settings as app_settings

    # settings.claim_code_file resolves under log_path; keep the write in a tmp dir.
    monkeypatch.setattr(app_settings, "log_path", tmp_path)
    # The auth dependencies CALL get_db() directly, which dependency_overrides cannot
    # reach — see conftest.override_get_db.
    monkeypatch.setattr("app.dependencies.auth.get_db", override_get_db)

    code = accounts_service.ensure_claim_code(db_session)
    db_session.commit()

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as client:
        yield {"client": client, "code": code, "db": db_session}
    app.dependency_overrides.clear()


def test_status_is_public_and_never_leaks_the_code(unclaimed):
    r = unclaimed["client"].get("/api/v1/instance/status")

    assert r.status_code == 200
    body = r.json()
    assert body["claimed"] is False and body["needs_claim"] is True
    assert unclaimed["code"] not in r.text


def test_wrong_claim_code_is_refused(unclaimed):
    r = unclaimed["client"].post(
        "/api/v1/claim",
        json={
            "claim_code": "ZZZZ-ZZZZ-ZZZZ",
            "email": "a@b.c",
            "password": CLAIM_PASSWORD,
        },
    )
    assert r.status_code == 403


def test_claim_then_verify_makes_the_submitter_the_owner(unclaimed):
    client = unclaimed["client"]

    claim = client.post(
        "/api/v1/claim",
        json={
            "claim_code": unclaimed["code"],
            "email": "ben@example.com",
            "password": CLAIM_PASSWORD,
        },
    )
    assert claim.status_code == 200
    # No mail provider is configured in tests, so the link comes back in the response —
    # the documented self-hosted fallback.
    token = claim.json()["action_url"].split("token=")[1]

    verified = client.post("/api/v1/auth/verify", json={"token": token})
    assert verified.status_code == 200
    assert verified.json()["claimed"] is True
    assert settings.cookie_name in verified.cookies

    owner = unclaimed["db"].query(Account).filter(Account.role == ROLE_OWNER).one()
    assert owner.email == "ben@example.com"
    assert owner.status == STATUS_ACTIVE
    assert accounts_service.is_claimed(unclaimed["db"])
    # The password chosen at claim time is the owner's only credential from here on —
    # there is no second "set a password" step, and no magic link will ever sign them in.
    assert auth_service.verify_password(CLAIM_PASSWORD, owner.password_hash)


def test_a_second_claim_submission_invalidates_the_first_link(unclaimed):
    """The operator mistypes, notices, and re-claims with the correct address. The link
    already sent to the typo'd mailbox must be dead — it points at the same owner
    account, so whoever controls that mailbox could otherwise take the instance."""
    client = unclaimed["client"]

    typo = client.post(
        "/api/v1/claim",
        json={
            "claim_code": unclaimed["code"],
            "email": "alice@gmial.com",
            "password": CLAIM_PASSWORD,
        },
    ).json()["action_url"].split("token=")[1]

    corrected = client.post(
        "/api/v1/claim",
        json={
            "claim_code": unclaimed["code"],
            "email": "alice@gmail.com",
            "password": CLAIM_PASSWORD,
        },
    ).json()["action_url"].split("token=")[1]

    assert client.post("/api/v1/auth/verify", json={"token": typo}).status_code == 410
    assert client.post("/api/v1/auth/verify", json={"token": corrected}).status_code == 200

    owner = unclaimed["db"].query(Account).filter(Account.role == ROLE_OWNER).one()
    assert owner.email == "alice@gmail.com"


def test_the_verified_address_wins_over_the_last_one_submitted(unclaimed):
    """If a stale link somehow survives, the account must still end up bound to the
    address that was actually proven — never to whatever was typed most recently."""
    client, db = unclaimed["client"], unclaimed["db"]

    client.post(
        "/api/v1/claim",
        json={
            "claim_code": unclaimed["code"],
            "email": "ben@example.com",
            "password": CLAIM_PASSWORD,
        },
    )

    # Re-mint the token by hand to model a stale link that dodged invalidation, then
    # let a second submission overwrite the account's email.
    owner = db.query(Account).filter(Account.role == ROLE_OWNER).one()
    raw, _ = auth_service.issue_auth_token(
        db, email="ben@example.com", purpose=PURPOSE_CLAIM_VERIFY, account_id=owner.id
    )
    owner.email = "someone-else@example.com"
    db.commit()

    assert client.post("/api/v1/auth/verify", json={"token": raw}).status_code == 200

    db.refresh(owner)
    assert owner.email == "ben@example.com"


def test_claiming_twice_is_refused_and_the_code_is_destroyed(unclaimed):
    client, db = unclaimed["client"], unclaimed["db"]

    token = client.post(
        "/api/v1/claim",
        json={
            "claim_code": unclaimed["code"],
            "email": "ben@example.com",
            "password": CLAIM_PASSWORD,
        },
    ).json()["action_url"].split("token=")[1]
    client.post("/api/v1/auth/verify", json={"token": token})

    replay = client.post(
        "/api/v1/claim",
        json={
            "claim_code": unclaimed["code"],
            "email": "attacker@evil.com",
            "password": CLAIM_PASSWORD,
        },
    )
    assert replay.status_code == 409

    instance = accounts_service.get_instance(db, create=False)
    assert instance.claim_code_hash is None
    assert not settings.claim_code_file.exists()


def test_a_stale_claim_link_cannot_re_finalise_a_claimed_instance(unclaimed):
    """Holding an unspent claim-verify token must not mint a session once someone else
    already owns the box."""
    client, db = unclaimed["client"], unclaimed["db"]

    owner = accounts_service.attach_owner_email(db, "ben@example.com")
    stale, _ = auth_service.issue_auth_token(
        db, email="ben@example.com", purpose=PURPOSE_CLAIM_VERIFY, account_id=owner.id
    )
    accounts_service.finalize_claim(db, owner)
    db.commit()

    r = client.post("/api/v1/auth/verify", json={"token": stale})

    assert r.status_code == 410
    assert settings.cookie_name not in r.cookies
