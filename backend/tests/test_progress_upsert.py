import datetime

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from sqlalchemy.exc import IntegrityError

from app.database.session import Base, sync_indexes
from app.database.models import UserStreamingProgress
from app.services.progress_upsert import upsert_progress


def _engine(tmp_path):
    # StaticPool + check_same_thread=False: all sessions share one DBAPI connection,
    # avoiding the cross-connection "database is locked" issue that SQLite raises when
    # two file-based connections try to write concurrently in a single-threaded test.
    eng = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    # Only create the progress table (avoid FK deps on users/torrents in this unit test).
    UserStreamingProgress.__table__.create(bind=eng)
    sync_indexes(eng)
    return eng

def _kwargs(**over):
    base = dict(
        user_id="u1", movie_id="movie:1", torrent_id=None,
        current_time=10.0, duration=100.0, percentage=10.0,
        completed=False, file_index=None, title="X", content_id="movie:1",
    )
    base.update(over)
    return base


def test_upsert_inserts_then_updates_same_row(tmp_path):
    eng = _engine(tmp_path)
    Session = sessionmaker(bind=eng)

    s1 = Session()
    row = upsert_progress(s1, **_kwargs(current_time=10.0))
    s1.commit()
    first_id = row.id
    s1.close()

    s2 = Session()
    row2 = upsert_progress(s2, **_kwargs(current_time=55.0, percentage=55.0))
    s2.commit()
    s2.close()

    s3 = Session()
    all_rows = s3.query(UserStreamingProgress).all()
    assert len(all_rows) == 1                 # upsert, not a second insert
    assert all_rows[0].id == first_id         # same row reused
    assert all_rows[0].current_time == 55.0   # value updated
    s3.close()


def test_upsert_survives_concurrent_insert(tmp_path):
    """Two sessions racing the SAME (user, movie) must end with exactly one row."""
    eng = _engine(tmp_path)
    Session = sessionmaker(bind=eng)

    sa = Session()
    sb = Session()
    # Both prepare an insert for the same key before either commits.
    ra = upsert_progress(sa, **_kwargs(current_time=1.0))
    rb = upsert_progress(sb, **_kwargs(current_time=2.0))
    sa.commit()
    sb.commit()
    sa.close()
    sb.close()

    sc = Session()
    rows = sc.query(UserStreamingProgress).all()
    assert len(rows) == 1
    sc.close()


def test_upsert_fallback_returns_persisted_row_on_integrity_error(tmp_path):
    """Regression: the IntegrityError fallback must return a NON-None persisted row.

    Drives control into the `except (IntegrityError, OperationalError)` branch by
    forcing the primary atomic ON CONFLICT statement to raise IntegrityError once.
    The fallback then re-queries/updates and the helper re-queries the row under
    `no_autoflush`. Without the `session.flush()` after the fallback, that re-query
    returns None (the staged row is never persisted) and the endpoint's
    `session.refresh(None)` crashes with AttributeError. This test guards that flush.
    """
    eng = _engine(tmp_path)
    Session = sessionmaker(bind=eng)

    # Seed an existing row so the fallback's re-query has a row to find and update.
    s_seed = Session()
    upsert_progress(s_seed, **_kwargs(current_time=10.0, percentage=10.0))
    s_seed.commit()
    s_seed.close()

    s = Session()
    # Force the FIRST session.execute (the atomic ON CONFLICT upsert) to raise
    # IntegrityError, simulating a concurrent writer winning the unique-key race.
    # Subsequent executes (the fallback re-query / flush) behave normally.
    real_execute = s.execute
    state = {"raised": False}

    def flaky_execute(statement, *args, **kwargs):
        if not state["raised"]:
            state["raised"] = True
            raise IntegrityError("forced", None, Exception("forced concurrent conflict"))
        return real_execute(statement, *args, **kwargs)

    s.execute = flaky_execute

    row = upsert_progress(s, **_kwargs(current_time=77.0, percentage=77.0))

    # Pre-fix this is None (staged row invisible under no_autoflush) → caller's
    # session.refresh(row) would raise AttributeError. Post-fix it's the persisted row.
    assert row is not None
    # The endpoint calls session.refresh(row) next — must not raise.
    s.refresh(row)
    assert row.current_time == 77.0
    assert row.percentage == 77.0
    s.commit()
    s.close()

    # Still exactly one row for the key — fallback updated in place, did not duplicate.
    s_check = Session()
    rows = s_check.query(UserStreamingProgress).all()
    assert len(rows) == 1
    assert rows[0].current_time == 77.0
    s_check.close()
