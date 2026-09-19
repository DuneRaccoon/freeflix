"""Shared pytest fixtures.

This file did not exist before the instance-claim work. It has to, because gating
``/api/v1`` behind a session would otherwise 401 twelve existing HTTP test files at once
with no single place to fix it.

**How the existing suite keeps passing.** :func:`auth_disabled` is autouse and
session-scoped: it pins ``settings.auth_enabled = False`` for the whole run, which makes
``require_session`` hand back a synthetic owner context and ``require_profile`` a pure
pass-through that never opens a session. That is byte-identical to the pre-auth app, so
every pre-existing test file runs unchanged. Tests that actually exercise auth opt back
in with the :func:`auth_enabled` fixture.

Overriding ``app.dependency_overrides[require_session]`` instead would be fragile here:
most existing HTTP test files end their own module-scoped fixture with
``app.dependency_overrides.clear()``, which would wipe the auth override too, and the
resulting failures would depend on test ordering.

**Reminder:** backend tests are baked into the image, not bind-mounted (the dev override
mounts only ``backend/app`` and ``serve.py``). This file is invisible to the container
until ``make build``, or run the suite with an explicit mount::

    docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" \\
        backend python -m pytest tests/
"""

import os
from contextlib import contextmanager

import pytest

# Must be set before app.config.Settings is instantiated at import time, and before
# app.database.session builds its module-level engine.
os.environ.setdefault("DB_PATH", "/tmp/test_freeflix_conftest.db")

from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402

from app.config import settings  # noqa: E402
from app.database.session import Base  # noqa: E402


@pytest.fixture(scope="session", autouse=True)
def auth_disabled():
    """Run the whole suite with the auth kill switch off unless a test opts in."""
    original = settings.auth_enabled
    settings.auth_enabled = False
    yield
    settings.auth_enabled = original


@pytest.fixture
def auth_enabled():
    """Opt a single test back into real session enforcement."""
    original = settings.auth_enabled
    settings.auth_enabled = True
    yield
    settings.auth_enabled = original


@pytest.fixture(autouse=True)
def clean_rate_limiter():
    """The limiter is a process-wide singleton; leaking hits between tests makes
    unrelated auth tests fail with a 429 depending on execution order."""
    from app.services.auth import rate_limiter

    rate_limiter.clear()
    yield
    rate_limiter.clear()


@pytest.fixture
def sqlite_engine(tmp_path_factory):
    """A throwaway SQLite database with the full schema.

    Note SQLite does NOT enforce foreign keys unless ``PRAGMA foreign_keys=ON`` is set
    (only one test in the suite does). So a cascade that passes here proves nothing
    about Postgres — assert cascade behaviour explicitly rather than relying on the DB.
    """
    db_file = tmp_path_factory.mktemp("data") / "auth_test.db"
    engine = create_engine(
        f"sqlite:///{db_file}", connect_args={"check_same_thread": False}
    )
    # Importing the package registers every model on Base.metadata. Without it the new
    # auth tables are absent and every query raises "no such table".
    import app.database.models  # noqa: F401

    Base.metadata.create_all(bind=engine)
    yield engine
    engine.dispose()


@pytest.fixture
def session_factory(sqlite_engine):
    return sessionmaker(bind=sqlite_engine, autocommit=False, autoflush=False)


@pytest.fixture
def db_session(session_factory):
    session = session_factory()
    try:
        yield session
    finally:
        session.rollback()
        session.close()


@pytest.fixture
def override_get_db(session_factory):
    """A drop-in for ``get_db`` that keeps the @contextmanager shape.

    It MUST stay a context manager: endpoints do ``with db as session:`` on the injected
    object, so a plain generator dependency would break every one of them.

    **Installing it takes TWO steps when auth is on.**
    ``app.dependency_overrides[get_db] = override_get_db`` only intercepts
    ``Depends(get_db)``. The auth dependencies in ``app/dependencies/auth.py`` deliberately
    CALL ``get_db()`` directly — they have to, because FastAPI caches sub-dependency
    results and sharing the endpoint's single-use context manager raises AttributeError —
    and a direct call bypasses the override entirely, hitting the real database. The
    symptom is every request returning 401 against a perfectly well-seeded fixture DB.
    So also patch the module-level name::

        monkeypatch.setattr("app.dependencies.auth.get_db", override_get_db)

    See ``test_profile_scoping.py`` for the full fixture.
    """
    @contextmanager
    def _override():
        session = session_factory()
        try:
            yield session
            session.commit()
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()

    return _override
