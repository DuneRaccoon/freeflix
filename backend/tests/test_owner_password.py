"""The owner's password credential, end to end over HTTP.

The instance has two entrances and they are deliberately disjoint: the OWNER signs in
with a password and nothing else, MEMBERS sign in with a magic link and nothing else.
Most of what is asserted here is not "does it work" but "does it stay indistinguishable"
— an instance-claim box is on the public internet by definition, so any response that
differs between an unknown address, a member's address and the owner's address is an
oracle for *who owns this machine*, which is the address worth attacking.

Three fixture gotchas, all of which present as an unexplained 401 or an empty database:

* ``app.dependency_overrides[get_db]`` reaches ``Depends(get_db)`` and nothing else. The
  auth dependencies CALL ``get_db()`` directly (they must — see §2.1 of the design), so
  the module-level name has to be monkeypatched too.
* ``conftest.auth_disabled`` is autouse and session-scoped, pinning the kill switch OFF
  so the twelve pre-auth HTTP test files keep passing. Requesting ``auth_enabled`` opts
  back in.
* ``rate_limiter`` is a process-wide singleton. conftest clears it around every test;
  without that, five failed sign-ins here would throttle an unrelated file.
"""

import os

os.environ.setdefault("DB_PATH", "/tmp/test_owner_password.db")

import pytest
from fastapi.testclient import TestClient

from app.config import settings
from app.database.models.accounts import (
    Account,
    AuthToken,
    PURPOSE_LOGIN,
    PURPOSE_PASSWORD_RESET,
    ROLE_MEMBER,
    ROLE_OWNER,
    STATUS_ACTIVE,
)
from app.database.session import get_db
from app.main import app
from app.services import accounts as accounts_service
from app.services import auth as auth_service

OWNER_EMAIL = "owner@example.com"
OWNER_PASSWORD = "correct-horse-battery"
MEMBER_EMAIL = "member@example.com"
STRANGER_EMAIL = "stranger@example.com"


def _fresh(db):
    """Read what the REQUEST committed, not what this session already loaded.

    ``db_session`` and the session behind the endpoint are two connections onto the same
    SQLite file. Without dropping the open transaction and expiring the identity map, an
    assertion can read the row as it looked before the request ran.
    """
    db.rollback()
    db.expire_all()
    return db


def _signin(client, email=OWNER_EMAIL, password=OWNER_PASSWORD):
    return client.post(
        "/api/v1/auth/password-signin", json={"email": email, "password": password}
    )


def _as(client, cookie):
    """Make the NEXT request carry exactly one session cookie.

    Any response that set ``ff_session`` leaves a copy in the client's jar, and httpx
    merges that with a per-request ``cookies=`` under a different jar key — so both go out
    and the server reads whichever it likes. An assertion that a revoked cookie is dead
    then silently exercises the live one and passes for the wrong reason.
    """
    client.cookies.clear()
    return {settings.cookie_name: cookie}


@pytest.fixture
def claimed(db_session, override_get_db, auth_enabled, monkeypatch, tmp_path):
    """A claimed instance: one owner with a password, one active member without."""
    from app.config import settings as app_settings

    # The startup event's bootstrap writes logs/claim_code.txt; keep it in a tmp dir.
    monkeypatch.setattr(app_settings, "log_path", tmp_path)
    monkeypatch.setattr("app.dependencies.auth.get_db", override_get_db)

    owner = Account(
        email=OWNER_EMAIL,
        role=ROLE_OWNER,
        status=STATUS_ACTIVE,
        password_hash=auth_service.hash_password(OWNER_PASSWORD),
    )
    member = Account(email=MEMBER_EMAIL, role=ROLE_MEMBER, status=STATUS_ACTIVE)
    db_session.add_all([owner, member])
    db_session.flush()

    instance = accounts_service.get_instance(db_session)
    instance.owner_account_id = owner.id
    instance.claimed_at = auth_service.utcnow()
    db_session.commit()

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as client:
        yield {
            "client": client,
            "db": db_session,
            "owner_id": owner.id,
            "member_id": member.id,
        }
    app.dependency_overrides.clear()


@pytest.fixture
def unclaimed(db_session, override_get_db, auth_enabled, monkeypatch, tmp_path):
    """A fresh, unclaimed instance with a known claim code."""
    from app.config import settings as app_settings

    monkeypatch.setattr(app_settings, "log_path", tmp_path)
    monkeypatch.setattr("app.dependencies.auth.get_db", override_get_db)

    code = accounts_service.ensure_claim_code(db_session)
    db_session.commit()

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as client:
        yield {"client": client, "code": code, "db": db_session}
    app.dependency_overrides.clear()


# ------------------------------------------------------------------ the happy path


def test_the_owner_signs_in_with_a_password(claimed):
    client = claimed["client"]

    r = _signin(client)

    assert r.status_code == 200
    assert r.json()["ok"] is True
    assert settings.cookie_name in r.cookies

    me = client.get("/api/v1/auth/me", cookies=_as(client, r.cookies[settings.cookie_name]))
    assert me.status_code == 200
    account = me.json()["account"]
    assert account["email"] == OWNER_EMAIL
    assert account["role"] == "owner"


def test_capabilities_publishes_the_minimum_length(claimed):
    """The UI mirrors the server's rule rather than hard-coding 10 in two places."""
    r = claimed["client"].get("/api/v1/auth/capabilities")

    assert r.status_code == 200
    assert r.json()["password_min_length"] == auth_service.PASSWORD_MIN_LENGTH


# ------------------------------------------------------- one refusal, five failures


def test_every_password_failure_is_the_same_401(claimed):
    """Unknown address, a member's address, an owner with no password, and a wrong
    password must be BYTE-IDENTICAL. Any difference between them names the owner."""
    client, db = claimed["client"], claimed["db"]

    wrong_password = _signin(client, password="not-the-password")
    unknown_address = _signin(client, email=STRANGER_EMAIL)
    a_members_address = _signin(client, email=MEMBER_EMAIL, password="anything-at-all")

    # The owner of an instance claimed before passwords existed, or one created by an
    # ownership transfer, has no hash yet. Even the RIGHT password must not confirm that.
    owner = db.query(Account).filter(Account.id == claimed["owner_id"]).one()
    owner.password_hash = None
    db.commit()
    no_password_set = _signin(client)

    responses = [wrong_password, unknown_address, a_members_address, no_password_set]
    assert [r.status_code for r in responses] == [401, 401, 401, 401]
    assert len({r.content for r in responses}) == 1
    assert all(settings.cookie_name not in r.cookies for r in responses)


def test_the_throttled_refusal_is_that_same_401_and_never_a_429(claimed):
    """A 429 on one address and a 401 on another would say which address is worth
    attacking, so the limiter refuses in the vocabulary of a bad password."""
    client = claimed["client"]

    refusals = [_signin(client, password="wrong") for _ in range(5)]
    assert [r.status_code for r in refusals] == [401] * 5

    # The sixth attempt carries the CORRECT password and is still refused — proof the
    # throttle is real — and is indistinguishable from the five wrong ones.
    throttled = _signin(client)
    assert throttled.status_code == 401
    assert throttled.status_code != 429
    assert throttled.content == refusals[0].content
    assert settings.cookie_name not in throttled.cookies


def test_a_successful_sign_in_clears_the_throttle(claimed):
    """Otherwise a forgotten-then-remembered password locks the owner out of their own
    instance for fifteen minutes."""
    client = claimed["client"]

    for _ in range(4):
        assert _signin(client, password="wrong").status_code == 401
    assert _signin(client).status_code == 200

    # Without the reset the window would now hold 4 + 1 + 4 = 9 hits against a limit of
    # 5, and this second correct password would be throttled.
    for _ in range(4):
        assert _signin(client, password="wrong").status_code == 401
    assert _signin(client).status_code == 200


# ------------------------------------------------- the owner is password-ONLY


def test_request_link_mints_nothing_for_the_owner(claimed):
    """A magic link for the owner would be a second, weaker key to the whole instance:
    mailbox access alone would be enough. The response stays constant, so refusing to
    mint is not observable from outside."""
    client, db = claimed["client"], claimed["db"]

    for_owner = client.post("/api/v1/auth/request-link", json={"email": OWNER_EMAIL})
    for_member = client.post("/api/v1/auth/request-link", json={"email": MEMBER_EMAIL})

    assert for_owner.status_code == for_member.status_code == 200
    assert for_owner.json()["sent"] is True
    assert for_owner.content == for_member.content

    _fresh(db)
    login_tokens = (
        db.query(AuthToken).filter(AuthToken.purpose == PURPOSE_LOGIN).all()
    )
    assert [t.email for t in login_tokens] == [MEMBER_EMAIL]


def test_a_login_token_for_an_owner_is_refused_at_verify(claimed):
    """Enforced at mint AND at consumption. A login token minted before an ownership
    transfer would otherwise still let the new owner in by link."""
    client, db = claimed["client"], claimed["db"]

    raw, _ = auth_service.issue_auth_token(
        db, email=OWNER_EMAIL, purpose=PURPOSE_LOGIN, account_id=claimed["owner_id"]
    )
    db.commit()

    r = client.post("/api/v1/auth/verify", json={"token": raw})

    assert r.status_code == 410
    assert settings.cookie_name not in r.cookies


def test_a_password_reset_token_is_not_a_session_on_its_own(claimed):
    """This is what keeps the owner password-only rather than password-OR-link: the
    emailed link is worthless unless a new password is chosen at the same time."""
    client, db = claimed["client"], claimed["db"]

    raw, _ = auth_service.issue_auth_token(
        db,
        email=OWNER_EMAIL,
        purpose=PURPOSE_PASSWORD_RESET,
        account_id=claimed["owner_id"],
    )
    db.commit()

    refused = client.post("/api/v1/auth/verify", json={"token": raw})
    assert refused.status_code == 410
    assert settings.cookie_name not in refused.cookies

    # get_db rolls back on the 410, so the rejected attempt does not burn the link —
    # otherwise anyone could kill a reset in flight by POSTing it to the wrong endpoint.
    accepted = client.post(
        "/api/v1/auth/reset-password",
        json={"token": raw, "password": "a-brand-new-secret"},
    )
    assert accepted.status_code == 200


# ---------------------------------------------------------------- forgot password


def test_request_password_reset_is_constant_and_mints_only_for_the_owner(claimed):
    client, db = claimed["client"], claimed["db"]

    def ask(email):
        return client.post("/api/v1/auth/request-password-reset", json={"email": email})

    for_owner = ask(OWNER_EMAIL)
    for_member = ask(MEMBER_EMAIL)
    for_stranger = ask(STRANGER_EMAIL)

    responses = [for_owner, for_member, for_stranger]
    assert [r.status_code for r in responses] == [200, 200, 200]
    assert len({r.content for r in responses}) == 1
    assert for_owner.json() == {"sent": True, "delivered": False, "action_url": None}

    _fresh(db)
    tokens = (
        db.query(AuthToken).filter(AuthToken.purpose == PURPOSE_PASSWORD_RESET).all()
    )
    assert len(tokens) == 1
    assert tokens[0].email == OWNER_EMAIL
    assert tokens[0].account_id == claimed["owner_id"]


def test_reset_password_signs_in_and_revokes_every_other_session(claimed):
    """A reset is what someone does when they think the old password leaked, so leaving
    the other cookies live would defeat the point."""
    client, db = claimed["client"], claimed["db"]
    owner = db.query(Account).filter(Account.id == claimed["owner_id"]).one()

    stale_cookie, _ = auth_service.create_session(db, owner)
    raw, _ = auth_service.issue_auth_token(
        db, email=OWNER_EMAIL, purpose=PURPOSE_PASSWORD_RESET, account_id=owner.id
    )
    db.commit()
    assert client.get("/api/v1/auth/me", cookies=_as(client, stale_cookie)).status_code == 200

    new_password = "a-brand-new-secret"
    reset = client.post(
        "/api/v1/auth/reset-password", json={"token": raw, "password": new_password}
    )

    assert reset.status_code == 200
    fresh_cookie = reset.cookies[settings.cookie_name]
    assert client.get("/api/v1/auth/me", cookies=_as(client, fresh_cookie)).status_code == 200
    assert client.get("/api/v1/auth/me", cookies=_as(client, stale_cookie)).status_code == 401

    _fresh(db)
    owner = db.query(Account).filter(Account.id == claimed["owner_id"]).one()
    assert auth_service.verify_password(new_password, owner.password_hash)
    assert not auth_service.verify_password(OWNER_PASSWORD, owner.password_hash)

    client.cookies.clear()
    assert _signin(client, password=new_password).status_code == 200
    assert _signin(client, password=OWNER_PASSWORD).status_code == 401

    # Single use: a forwarded email cannot be redeemed behind the owner's back.
    replay = client.post(
        "/api/v1/auth/reset-password", json={"token": raw, "password": "another-secret"}
    )
    assert replay.status_code == 410


def test_reset_password_refuses_a_weak_password(claimed):
    client, db = claimed["client"], claimed["db"]

    raw, _ = auth_service.issue_auth_token(
        db,
        email=OWNER_EMAIL,
        purpose=PURPOSE_PASSWORD_RESET,
        account_id=claimed["owner_id"],
    )
    db.commit()

    r = client.post("/api/v1/auth/reset-password", json={"token": raw, "password": "short"})

    assert r.status_code == 422
    _fresh(db)
    owner = db.query(Account).filter(Account.id == claimed["owner_id"]).one()
    assert auth_service.verify_password(OWNER_PASSWORD, owner.password_hash)


# ------------------------------------------------------------ the password at claim


def test_a_weak_password_is_refused_before_the_wrong_code_budget_is_spent(unclaimed):
    """Validation order matters. The global wrong-code budget is what actually protects
    a 12-character code, and it is shared by everyone — if a rejected password spent one,
    anyone could burn the operator's own claim window with malformed submissions."""
    client = unclaimed["client"]

    def attempt(code, password):
        return client.post(
            "/api/v1/claim",
            json={"claim_code": code, "email": "ben@example.com", "password": password},
        )

    # More attempts than the 10-failure global budget, every one with a wrong code.
    for _ in range(12):
        assert attempt("ZZZZ-ZZZZ-ZZZZ", "short").status_code == 422

    # Still 403 rather than 429: none of those twelve counted as a wrong-code failure.
    assert attempt("ZZZZ-ZZZZ-ZZZZ", "a-perfectly-fine-password").status_code == 403
    # And the per-email budget is intact, so the operator can still claim.
    assert attempt(unclaimed["code"], "a-perfectly-fine-password").status_code == 200


def test_after_claim_and_verify_the_owner_signs_in_with_the_claim_time_password(unclaimed):
    client, db = unclaimed["client"], unclaimed["db"]

    claim = client.post(
        "/api/v1/claim",
        json={
            "claim_code": unclaimed["code"],
            "email": OWNER_EMAIL,
            "password": OWNER_PASSWORD,
        },
    )
    assert claim.status_code == 200
    token = claim.json()["action_url"].split("token=")[1]

    verified = client.post("/api/v1/auth/verify", json={"token": token})
    assert verified.status_code == 200
    assert verified.json()["claimed"] is True

    client.cookies.clear()
    signed_in = _signin(client)
    assert signed_in.status_code == 200
    assert settings.cookie_name in signed_in.cookies

    _fresh(db)
    owner = db.query(Account).filter(Account.role == ROLE_OWNER).one()
    assert auth_service.verify_password(OWNER_PASSWORD, owner.password_hash)


# -------------------------------------------------------------------- transfer


def test_transfer_swaps_the_credentials_as_well_as_the_roles(claimed):
    """The two roles authenticate differently, so a handover has to move the credential
    too: the incoming owner gets a set-a-new-password link, the outgoing one is left with
    no password at all — but keeps their session, because a handover is not a lockout."""
    client, db = claimed["client"], claimed["db"]
    old_owner = db.query(Account).filter(Account.id == claimed["owner_id"]).one()
    owner_cookie, _ = auth_service.create_session(db, old_owner)
    db.commit()

    r = client.post(
        "/api/v1/instance/transfer",
        json={"account_id": claimed["member_id"]},
        cookies=_as(client, owner_cookie),
    )
    assert r.status_code == 200

    _fresh(db)
    old_owner = db.query(Account).filter(Account.id == claimed["owner_id"]).one()
    new_owner = db.query(Account).filter(Account.id == claimed["member_id"]).one()
    assert old_owner.role == ROLE_MEMBER and new_owner.role == ROLE_OWNER
    assert old_owner.password_hash is None
    assert new_owner.password_hash is None

    # The incoming owner has no password, so they are mailed a link that sets a first one.
    reset_tokens = (
        db.query(AuthToken).filter(AuthToken.purpose == PURPOSE_PASSWORD_RESET).all()
    )
    assert [t.account_id for t in reset_tokens] == [claimed["member_id"]]

    # The outgoing owner's password is no longer a way in...
    client.cookies.clear()
    assert _signin(client).status_code == 401
    # ...but their existing session keeps working: require_session re-reads the role on
    # every request, so there is no stale privilege to revoke.
    me = client.get("/api/v1/auth/me", cookies=_as(client, owner_cookie))
    assert me.status_code == 200
    assert me.json()["account"]["role"] == "member"


def test_the_demoted_owner_cannot_reach_owner_only_routes(claimed):
    """Ownership is read from the database per request, so the swap is effective the
    instant it commits — no session churn required."""
    client, db = claimed["client"], claimed["db"]
    old_owner = db.query(Account).filter(Account.id == claimed["owner_id"]).one()
    owner_cookie, _ = auth_service.create_session(db, old_owner)
    db.commit()

    members = "/api/v1/instance/members"
    assert client.get(members, cookies=_as(client, owner_cookie)).status_code == 200

    client.post(
        "/api/v1/instance/transfer",
        json={"account_id": claimed["member_id"]},
        cookies=_as(client, owner_cookie),
    )

    assert client.get(members, cookies=_as(client, owner_cookie)).status_code == 403
