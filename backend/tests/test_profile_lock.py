"""The profile lock: a session holds at most one open profile.

``POST /users/{id}/select`` replaces the session's open profile, asking for the code on
every pick of a locked profile; ``POST /users/deselect`` clears it when the UI returns to
"Who's watching?". ``/unlock`` is an alias of ``/select`` for one release.
"""

import os

os.environ.setdefault("DB_PATH", "/tmp/test_profile_lock.db")

from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app.config import settings
from app.database.models import User, UserSettings
from app.database.models.accounts import Account, ROLE_MEMBER, ROLE_OWNER, STATUS_ACTIVE
from app.database.session import get_db
from app.main import app
from app.services import auth as auth_service


OWNER_PASSWORD = "correct-horse-battery"


def _fresh(db):
    db.rollback()
    db.expire_all()
    return db


@pytest.fixture
def home(db_session, override_get_db, auth_enabled, monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "log_path", tmp_path)
    monkeypatch.setattr("app.dependencies.auth.get_db", override_get_db)
    owner = Account(email="owner@example.com", role=ROLE_OWNER, status=STATUS_ACTIVE,
                    password_hash=auth_service.hash_password(OWNER_PASSWORD))
    member = Account(email="member@example.com", role=ROLE_MEMBER, status=STATUS_ACTIVE)
    db_session.add_all([owner, member]); db_session.flush()

    def profile(account, name, code=None):
        row = User(username=name, display_name=name, account_id=account.id)
        db_session.add(row); db_session.flush()
        cfg = UserSettings(user_id=row.id)
        if code:
            cfg.require_passcode = True
            cfg.passcode_hash = auth_service.hash_passcode(code)
            cfg.passcode_len = len(code)
        db_session.add(cfg); db_session.flush()
        return row.id

    ids = dict(plain=profile(owner, "plain"), plain2=profile(owner, "plain2"),   # Review Focus 1
               vault=profile(owner, "vault", "4821"),
               legacy=profile(owner, "legacy", "48213579"),       # 8 digits: pre-change code
               kid=profile(member, "kid", "1357"),
               kid2=profile(member, "kid2", "8642"))   # A7: a reset must clear only its own profile
    tok = lambda acct: {settings.cookie_name: auth_service.create_session(db_session, acct)[0]}
    cookies = dict(owner=tok(owner), owner2=tok(owner), member=tok(member))
    db_session.commit()
    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as client:
        yield SimpleNamespace(client=client, db=db_session, owner_id=owner.id,
                              member_id=member.id, **ids, **cookies)
    app.dependency_overrides.clear()


def select(h, pid, code=None, who="owner", path="select"):
    body = {} if code is None else {"passcode": code}
    return h.client.post(f"/api/v1/users/{pid}/{path}", json=body, cookies=getattr(h, who))


def opened(h, pid, who="owner"):
    return h.client.get(f"/api/v1/users/{pid}", cookies=getattr(h, who)).status_code


# ---------------------------------------------------------------- select / unlock


@pytest.mark.parametrize("path", ["select", "unlock"])
def test_a_locked_profile_asks_on_every_pick(home, path):
    r = select(home, home.vault, "4821", path=path)
    assert r.status_code == 200
    assert r.json() == {"ok": True}
    assert opened(home, home.vault) == 200

    # Already open, and still the code is asked for: no code is a wrong code.
    r = select(home, home.vault, path=path)
    assert r.status_code == 403
    assert r.json() == {"detail": "Incorrect passcode"}

    assert select(home, home.vault, "4821", path=path).status_code == 200


@pytest.mark.parametrize("path", ["select", "unlock"])
def test_picking_another_profile_relocks_the_open_one(home, path):
    assert select(home, home.vault, "4821", path=path).status_code == 200
    assert select(home, home.plain, path=path).status_code == 200

    assert opened(home, home.vault) == 423
    assert opened(home, home.plain) == 200


def test_picking_a_second_locked_profile_relocks_the_first(home):
    assert select(home, home.vault, "4821").status_code == 200
    # An 8-digit code set before the 4-6 rule still verifies.
    assert select(home, home.legacy, "48213579").status_code == 200

    assert opened(home, home.legacy) == 200
    assert opened(home, home.vault) == 423


def test_two_tabs_on_unlocked_profiles_never_relock_each_other(home):
    """One cookie is one browser, so two tabs share it. Only LOCKED profiles relock."""
    assert select(home, home.plain).status_code == 200
    assert select(home, home.plain2).status_code == 200  # the second tab's pick

    assert opened(home, home.plain) == 200
    assert opened(home, home.plain2) == 200
    r = home.client.get(f"/api/v1/users/{home.plain}/settings", cookies=home.owner)
    assert r.status_code == 200


def test_deselect_relocks(home):
    assert select(home, home.vault, "4821").status_code == 200

    r = home.client.post("/api/v1/users/deselect", cookies=home.owner)
    assert r.status_code == 200
    assert r.json() == {"ok": True}

    assert opened(home, home.vault) == 423


def test_select_takes_no_body_for_an_unlocked_profile(home):
    r = home.client.post(f"/api/v1/users/{home.plain}/select", cookies=home.owner)
    assert r.status_code == 200


def test_the_sixth_attempt_is_throttled_even_with_the_right_code(home):
    for _ in range(5):
        assert select(home, home.vault, "0000").status_code == 403
    assert select(home, home.vault, "4821").status_code == 429


def test_a_right_code_resets_the_budget(home):
    for _ in range(4):
        select(home, home.vault, "0000")
    assert select(home, home.vault, "4821").status_code == 200

    codes = [select(home, home.vault, "0000").status_code for _ in range(5)]
    assert codes == [403] * 5


def test_select_checks_ownership_before_the_code(home):
    r = select(home, home.vault, "4821", who="member")
    assert r.status_code == 403
    assert r.json() == {"detail": "Not your profile"}

    # With the owner's cookie: without a session require_session would answer 401.
    assert select(home, "no-such-id").status_code == 404
