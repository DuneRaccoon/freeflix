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


# ---------------------------------------------------------------- PUT /passcode


def put_code(h, pid, who="owner", **body):
    return h.client.put(f"/api/v1/users/{pid}/passcode", json=body, cookies=getattr(h, who))


def test_a_first_code_turns_the_lock_on_and_keeps_this_session_on_it(home):
    r = put_code(home, home.plain, new_passcode="2468")
    assert r.status_code == 200
    body = r.json()
    assert body["require_passcode"] is True
    assert body["has_passcode"] is True
    assert body["passcode_len"] == 4

    assert opened(home, home.plain) == 200
    assert opened(home, home.plain, who="owner2") == 423


def test_setting_a_code_relocks_whatever_else_was_open(home):
    assert select(home, home.vault, "4821").status_code == 200
    assert put_code(home, home.plain, new_passcode="2468").status_code == 200

    assert opened(home, home.vault) == 423


def test_changing_a_code_needs_the_current_one(home):
    assert select(home, home.vault, "4821").status_code == 200

    r = put_code(home, home.vault, new_passcode="1111")
    assert r.status_code == 403
    assert r.json() == {"detail": "Incorrect passcode"}
    r = put_code(home, home.vault, current_passcode="0000", new_passcode="1111")
    assert r.status_code == 403
    r = put_code(home, home.vault, current_passcode="4821", new_passcode="1111")
    assert r.status_code == 200

    assert home.client.post("/api/v1/users/deselect", cookies=home.owner).status_code == 200
    assert select(home, home.vault, "4821").status_code == 403
    assert select(home, home.vault, "1111").status_code == 200


@pytest.mark.parametrize(
    "body",
    [{"current_passcode": "4821"}, {"current_passcode": "4821", "new_passcode": ""}],
)
def test_removing_a_code_needs_the_current_one_and_turns_the_lock_off(home, body):
    assert select(home, home.vault, "4821").status_code == 200

    assert put_code(home, home.vault, new_passcode="").status_code == 403

    r = put_code(home, home.vault, **body)
    assert r.status_code == 200
    assert r.json()["require_passcode"] is False
    assert r.json()["has_passcode"] is False
    assert r.json()["passcode_len"] is None

    assert opened(home, home.vault, who="owner2") == 200


@pytest.mark.parametrize(
    "code,expected",
    [("123", 422), ("1234567", 422), ("12345678", 422), ("12a4", 422), ("12 34", 422),
     ("abcd", 422), ("١٢٣٤", 422),   # Arabic-Indic digits: isdigit() says yes
     ("1234", 200), ("123456", 200)],
)
def test_new_codes_are_4_to_6_digits(home, code, expected):
    r = put_code(home, home.plain, new_passcode=code)
    assert r.status_code == expected
    if expected == 422:
        assert r.json() == {"detail": "Passcode must be 4 to 6 digits"}


def test_a_legacy_code_can_still_be_changed_and_removed(home):
    assert select(home, home.legacy, "48213579").status_code == 200

    r = put_code(home, home.legacy, current_passcode="48213579", new_passcode="2468")
    assert r.status_code == 200
    assert r.json()["passcode_len"] == 4

    r = put_code(home, home.legacy, current_passcode="2468")
    assert r.status_code == 200
    assert r.json()["has_passcode"] is False


def test_a_wrong_current_code_spends_the_select_budget(home):
    assert select(home, home.vault, "4821").status_code == 200

    for _ in range(5):
        r = put_code(home, home.vault, current_passcode="0000", new_passcode="1111")
        assert r.status_code == 403
    assert select(home, home.vault, "4821").status_code == 429


def test_a_malformed_new_code_spends_no_attempt(home):
    """The new code is validated before the current one is checked."""
    assert select(home, home.vault, "4821").status_code == 200

    for _ in range(5):
        r = put_code(home, home.vault, current_passcode="0000", new_passcode="12a4")
        assert r.status_code == 422
    assert select(home, home.vault, "4821").status_code == 200


def test_settings_no_longer_change_the_lock(home):
    assert select(home, home.vault, "4821").status_code == 200

    r = home.client.put(
        f"/api/v1/users/{home.vault}/settings",
        json={"require_passcode": False, "passcode": "", "maturity_restriction": "pg13"},
        cookies=home.owner,
    )
    assert r.status_code == 200
    assert r.json()["require_passcode"] is True
    assert r.json()["has_passcode"] is True
    assert r.json()["maturity_restriction"] == "pg13"
    assert opened(home, home.vault, who="owner2") == 423

    r = home.client.put(
        f"/api/v1/users/{home.plain}/settings",
        json={"require_passcode": True, "passcode": "2468"},
        cookies=home.owner,
    )
    assert r.status_code == 200
    assert r.json()["require_passcode"] is False
    assert r.json()["has_passcode"] is False
    assert opened(home, home.plain, who="owner2") == 200


def test_the_passcode_response_carries_no_secret(home):
    """A pin: ``response_model=UserSettingsResponse`` strips unknown keys, so this catches
    dropping it and returning ``row.to_dict()``, which carries ``passcode_hash``."""
    r = put_code(home, home.plain, new_passcode="2468")
    assert r.status_code == 200
    keys = set(r.json())
    assert not keys & {"passcode", "passcode_hash", "new_passcode", "current_passcode"}


def test_the_startup_event_runs_the_pass(db_session, override_get_db, monkeypatch, tmp_path):
    """The seam: the pass must be reached from the startup event, on the app's own
    ``get_db`` (not ``init_db()``, which runs at import time on the real engine)."""
    monkeypatch.setattr(settings, "log_path", tmp_path)
    monkeypatch.setattr("app.main.get_db", override_get_db)
    owner = Account(email="owner@example.com", role=ROLE_OWNER, status=STATUS_ACTIVE)
    db_session.add(owner); db_session.flush()
    profile = User(username="ben", display_name="Ben", account_id=owner.id)
    db_session.add(profile); db_session.flush()
    db_session.add(UserSettings(user_id=profile.id, require_passcode=False,
                                passcode_hash=auth_service.hash_passcode("4821"), passcode_len=4))
    db_session.commit()
    pid = profile.id

    with TestClient(app):
        pass

    row = _fresh(db_session).query(UserSettings).filter_by(user_id=pid).one()
    assert row.passcode_hash is None
