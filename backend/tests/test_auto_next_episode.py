"""The per-profile "start the next episode" switch is retired; the column is not.

Spec 2026-11-06 section 5.1 retired the per-profile switch. The global switch is
``Instance.auto_next_enabled`` (Part D). The ``user_settings.auto_next_episode`` column
stays because ``sync_columns()`` only adds columns and there is no migration framework to
drop one, so it is nullable, unread and unwritten.

What is pinned here: the settings API no longer carries the key in either direction, a
stale client (cached TV JS from before the change) that still PUTs it is processed rather
than refused and the column is not written, and the ORM column was not dropped.
"""

import os

os.environ.setdefault("DB_PATH", "/tmp/test_auto_next_episode.db")

import pytest
from fastapi.testclient import TestClient

from app.config import settings
from app.database.models import User, UserSettings
from app.database.models.accounts import Account, ROLE_OWNER, STATUS_ACTIVE
from app.database.session import get_db
from app.main import app
from app.services import auth as auth_service


@pytest.fixture
def world(db_session, override_get_db, auth_enabled, monkeypatch):
    """One account, one profile, and a settings row with the column left NULL.

    The monkeypatch is the same one ``test_profile_scoping.py`` explains at length:
    ``dependency_overrides[get_db]`` only intercepts ``Depends(get_db)``, and the auth
    dependencies deliberately CALL ``get_db()`` themselves, so without it every request
    would query the real database and come back 401.
    """
    monkeypatch.setattr("app.dependencies.auth.get_db", override_get_db)
    account = Account(email="owner@example.com", role=ROLE_OWNER, status=STATUS_ACTIVE)
    db_session.add(account)
    db_session.flush()

    profile = User(username="viewer", display_name="Viewer", account_id=account.id)
    db_session.add(profile)
    db_session.flush()
    # The column is left alone, which is NULL: the state ``sync_columns()`` leaves every
    # pre-existing row in, and the state the default-on rule is about. The ORM declares no
    # Python-side default for exactly this reason — one with ``default=True`` would store
    # True here and leave the migrated case untestable (measured, before it was removed:
    # the row below came back True).
    row = UserSettings(user_id=profile.id)
    db_session.add(row)
    db_session.flush()

    token, _ = auth_service.create_session(db_session, account)
    db_session.commit()

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as client:
        yield {
            "client": client,
            "cookie": {settings.cookie_name: token},
            "profile": profile.id,
            "settings_row": row,
            "db": db_session,
        }
    app.dependency_overrides.clear()


def _get(world):
    r = world["client"].get(
        f"/api/v1/users/{world['profile']}/settings", cookies=world["cookie"]
    )
    assert r.status_code == 200, r.text
    return r.json()


def _put(world, body):
    r = world["client"].put(
        f"/api/v1/users/{world['profile']}/settings",
        json=body,
        cookies=world["cookie"],
    )
    assert r.status_code == 200, r.text
    return r.json()


def test_the_column_is_nullable_so_sync_columns_can_add_it(world):
    """Not a tautology: a NOT NULL column cannot reach an existing table at all.

    ``sync_columns()`` emits a bare ADD COLUMN, so a column declared ``nullable=False``
    here fails at startup on every database that already has a ``user_settings`` table —
    and passes every test that only ever creates a fresh one, which is all of them.
    """
    column = UserSettings.__table__.columns["auto_next_episode"]
    assert column.nullable is True
    assert column.server_default is None
    # And no Python-side default, so a fresh row is NULL too and "default on" has ONE
    # implementation (the read rule) rather than two that can drift apart.
    assert column.default is None


def test_settings_no_longer_carry_it(world):
    assert "auto_next_episode" not in _get(world)


def test_a_stale_client_cannot_write_it(world):
    """Cached TV JS from before this change may still PUT the old toggle."""
    r = world["client"].put(
        f"/api/v1/users/{world['profile']}/settings",
        json={"auto_next_episode": False, "theme": "light"},
        cookies=world["cookie"],
    )
    assert r.status_code == 200, r.text
    world["db"].expire_all()
    assert world["settings_row"].auto_next_episode is None
    assert world["settings_row"].theme == "light"  # the request was processed, not refused
