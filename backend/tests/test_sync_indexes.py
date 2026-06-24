import datetime

from sqlalchemy import create_engine, text, inspect

from app.database.session import sync_indexes


def _make_progress_table(engine):
    with engine.begin() as conn:
        conn.execute(text(
            "CREATE TABLE user_streaming_progress ("
            "id VARCHAR PRIMARY KEY, "
            "user_id VARCHAR NOT NULL, "
            "movie_id VARCHAR NOT NULL, "
            "current_time FLOAT, "
            "last_watched_at TIMESTAMP NOT NULL)"
        ))

def _insert(engine, id_, user_id, movie_id, ct, watched):
    with engine.begin() as conn:
        conn.execute(
            text("INSERT INTO user_streaming_progress "
                 "(id, user_id, movie_id, current_time, last_watched_at) "
                 "VALUES (:id, :u, :m, :ct, :w)"),
            {"id": id_, "u": user_id, "m": movie_id, "ct": ct, "w": watched},
        )

def _rows(engine):
    with engine.connect() as conn:
        # Quote "current_time" to avoid SQLite treating it as the CURRENT_TIME function.
        return conn.execute(text(
            'SELECT id, "current_time" FROM user_streaming_progress '
            "ORDER BY id")).fetchall()


def test_sync_indexes_dedup_keeps_latest(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'idx.db'}")
    _make_progress_table(engine)
    old = datetime.datetime(2026, 1, 1, 0, 0, 0)
    new = datetime.datetime(2026, 6, 1, 0, 0, 0)
    # Two duplicate rows for the SAME (user, movie); the newer one (current_time=99) must survive.
    _insert(engine, "a", "u1", "movie:1", 10.0, old)
    _insert(engine, "b", "u1", "movie:1", 99.0, new)
    # An unrelated row must be untouched.
    _insert(engine, "c", "u2", "movie:2", 5.0, new)

    sync_indexes(engine)

    rows = _rows(engine)
    # 'a' (older dup) removed; 'b' (latest) and 'c' (unrelated) remain.
    assert {r[0] for r in rows} == {"b", "c"}
    kept = {r[0]: r[1] for r in rows}
    assert kept["b"] == 99.0

    indexes = {ix["name"] for ix in inspect(engine).get_indexes("user_streaming_progress")}
    assert "uq_user_movie_progress" in indexes


def test_sync_indexes_is_idempotent(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'idx.db'}")
    _make_progress_table(engine)
    now = datetime.datetime(2026, 6, 1, 0, 0, 0)
    _insert(engine, "a", "u1", "movie:1", 10.0, now)

    sync_indexes(engine)
    sync_indexes(engine)  # second run must not raise and must not drop the row

    rows = _rows(engine)
    assert {r[0] for r in rows} == {"a"}


def test_sync_indexes_skips_missing_table(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'idx.db'}")
    # No table created -> must be a clean no-op.
    sync_indexes(engine)
    assert "user_streaming_progress" not in set(inspect(engine).get_table_names())
