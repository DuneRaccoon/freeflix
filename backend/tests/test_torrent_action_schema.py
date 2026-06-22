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
