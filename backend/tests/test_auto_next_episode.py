"""The per-profile "start the next episode downloading" switch, as the wire sees it.

WHAT IS ACTUALLY AT RISK HERE, and it is not the happy path. The column is
``nullable=True`` with no server default because this project has no migration framework:
``init_db()`` runs ``create_all()`` and then ``sync_columns()``, an additive pass that can
only emit a bare ``ALTER TABLE ... ADD COLUMN``. It cannot emit NOT NULL, a DEFAULT or a
backfill. So on every database that already exists — which is every household's — this
column arrives holding NULL on every row.

The setting is specified to default ON. ``bool(None)`` is False. So the one line that
decides whether this feature ships on or off for an existing install is
``api/users.py``'s ``row.auto_next_episode is not False``, and the obvious tidy-up of it
(``bool(row.auto_next_episode)``, or a plain ``row.auto_next_episode``) silently flips the
default for everyone who is not a brand-new install. ``test_null_column_reads_as_on``
is the row that refuses that edit; the rest of this file is the ordinary read/write
contract around it.

The write path's hazard is the other half: the handler loops
``for key, value in data.items(): if value is not None: setattr(...)`` over
``model_dump(exclude_unset=True)``. That shape makes "turn it off" and "do not touch it"
indistinguishable unless False survives the ``is not None`` test — it does — and unless an
omitted key really is absent from the dump — it is. Both are pinned below, because a
future field added with a non-Optional type, or a dump without ``exclude_unset``, breaks
one of them without touching this feature's own code.
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
from app.models import UserSettingsUpdate
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


def test_null_column_reads_as_on(world):
    """THE ROW THIS FILE EXISTS FOR. NULL is "never chosen", and the feature is on."""
    assert world["settings_row"].auto_next_episode is None
    assert _get(world)["auto_next_episode"] is True


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


def test_turning_it_off_is_an_explicit_false(world):
    assert _put(world, {"auto_next_episode": False})["auto_next_episode"] is False
    # Read back through a second request, so the answer is the stored column and not the
    # handler's own echo of the body it was handed.
    assert _get(world)["auto_next_episode"] is False


def test_turning_it_back_on_sticks(world):
    _put(world, {"auto_next_episode": False})
    assert _put(world, {"auto_next_episode": True})["auto_next_episode"] is True
    assert _get(world)["auto_next_episode"] is True


def test_an_unrelated_update_leaves_it_alone(world):
    """The handler's loop skips a None, and an omitted key is not in the dump at all.

    Without ``exclude_unset`` the dump carries ``auto_next_episode: None`` for a body that
    never mentioned it; the loop would then skip it anyway — which is why this is asserted
    through a body that changes something else and comes back with the switch intact,
    rather than through the dump alone.
    """
    _put(world, {"auto_next_episode": False})
    assert _put(world, {"default_quality": "720p"})["auto_next_episode"] is False
    assert _get(world)["default_quality"] == "720p"


def test_false_survives_the_handler_loop_and_omission_is_absent(world):
    """The two properties of the request model the loop above depends on."""
    assert UserSettingsUpdate(auto_next_episode=False).model_dump(exclude_unset=True) == {
        "auto_next_episode": False
    }
    assert "auto_next_episode" not in UserSettingsUpdate(theme="dark").model_dump(
        exclude_unset=True
    )
