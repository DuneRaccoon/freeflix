"""Lifecycle + ownership columns on torrents and the widened TorrentStatus wire shape."""
import os
os.environ.setdefault("DB_PATH", "/tmp/test_torrent_lifecycle_fields.db")

from datetime import datetime, timedelta

import pytest
from pydantic import ValidationError
from sqlalchemy import BigInteger, create_engine, inspect, text

from app.database.models.torrents import Torrent
from app.database.session import sync_columns
from app.models import VacuumInfo

LIFECYCLE = {"account_id", "added_at", "finished_at", "last_touched_at", "size_bytes"}


def test_sync_columns_adds_the_lifecycle_columns_to_an_old_torrents_table(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path/'old.db'}")
    with engine.begin() as c:
        c.execute(text("CREATE TABLE torrents (id VARCHAR PRIMARY KEY)"))
    sync_columns(engine, [Torrent.__table__])
    assert LIFECYCLE <= {c["name"] for c in inspect(engine).get_columns("torrents")}


def test_size_bytes_is_a_bigint():
    # A 4K film is > 2**31 bytes; Integer would overflow on Postgres.
    assert isinstance(Torrent.__table__.c.size_bytes.type, BigInteger)


def test_to_status_carries_the_lifecycle_fields():
    t = datetime(2026, 11, 5, 10, 0, 0)
    row = Torrent(id="t1", movie_title="M", quality="1080p", state="finished", magnet="m",
                  url="m", save_path="/x", progress=100.0, created_at=t, updated_at=t,
                  size_bytes=5_000_000_000, added_at=t, finished_at=t + timedelta(hours=1),
                  last_touched_at=t + timedelta(hours=2), account_id="acc-1")
    s = row.to_status()
    assert (s.size_bytes, s.added_at, s.finished_at, s.last_touched_at) == (
        5_000_000_000, t, t + timedelta(hours=1), t + timedelta(hours=2))
    assert s.watched_by is None and s.vacuum is None and s.file_index is None
    assert "account_id" not in s.model_dump()   # never on the wire


@pytest.mark.parametrize("state,expected", [("downloading", 120), ("paused", None),
                                            ("finished", None), ("seeding", None)])
def test_to_status_reports_eta_only_while_downloading(state, expected):
    row = Torrent(id="t1", movie_title="M", quality="1080p", state=state, magnet="m", url="m",
                  save_path="/x", progress=50.0, created_at=datetime(2026, 1, 1),
                  updated_at=datetime(2026, 1, 1), meta_data={"eta": 120})
    assert row.to_status().eta == expected


def test_vacuum_status_vocabulary_is_pinned():
    for ok in ("off", "scheduled", "kept_watching", "active"):
        VacuumInfo(status=ok)
    with pytest.raises(ValidationError):
        VacuumInfo(status="deleting")
