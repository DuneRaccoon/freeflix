# backend/tests/test_torrent_action_schema.py
import os
os.environ.setdefault("DB_PATH", "/tmp/test_torrent_action_schema.db")

import pytest
from pydantic import ValidationError
from app.models import (
    TorrentAction, TorrentBatchAction, TorrentBatchResponse, ActivityCountResponse,
)


def test_action_rejects_remove():
    with pytest.raises(ValidationError):
        TorrentAction(action="remove")


def test_action_allows_pause_resume_stop():
    for a in ("pause", "resume", "stop"):
        assert TorrentAction(action=a).action == a


def test_batch_action_defaults_delete_files_false():
    b = TorrentBatchAction(action="resume")
    assert b.delete_files is False


def test_batch_action_rejects_unknown():
    with pytest.raises(ValidationError):
        TorrentBatchAction(action="explode")


def test_batch_response_shape():
    r = TorrentBatchResponse(action="pause", succeeded=1, failed=0,
                             results=[{"id": "t1", "success": True}])
    assert r.results[0].id == "t1"
    assert r.results[0].success is True


def test_activity_response_has_max():
    r = ActivityCountResponse(active_downloads=0, aggregate_progress=0.0, max_active_downloads=2)
    assert r.max_active_downloads == 2


def test_streaming_progress_response_allows_null_torrent_id():
    """After a torrent is removed, surviving watch-history rows have
    torrent_id=NULL (FK ON DELETE SET NULL); the response model must serialize
    them instead of raising ValidationError (would 500 continue-watching)."""
    from datetime import datetime
    from app.models import StreamingProgressResponse

    now = datetime(2026, 1, 1, 0, 0, 0)
    resp = StreamingProgressResponse(
        id="p1", user_id="u1", torrent_id=None, movie_id="movie:438631",
        current_time=120.0, percentage=10.0, completed=False,
        last_watched_at=now, created_at=now, updated_at=now,
    )
    assert resp.torrent_id is None
    assert resp.movie_id == "movie:438631"
