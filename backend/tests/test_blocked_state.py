"""'blocked' torrent state + block_reason plumbing."""
from app.models import TorrentState, TorrentStatus
from app.torrent.states import ACTIVE_DOWNLOAD_STATES, TERMINAL_STATES


def test_blocked_state_value():
    assert TorrentState("blocked") is TorrentState.BLOCKED
    assert TorrentState.BLOCKED.value == "blocked"


def test_blocked_not_resumable_on_startup():
    # not an active-download state -> find_loadable_on_startup won't re-add it
    assert "blocked" not in ACTIVE_DOWNLOAD_STATES
    assert "blocked" in TERMINAL_STATES


def test_torrent_status_carries_block_reason():
    from datetime import datetime
    s = TorrentStatus(
        id="t1", movie_title="X", quality="1080p", state=TorrentState.BLOCKED,
        save_path="/x", created_at=datetime.now(), updated_at=datetime.now(),
        block_reason="No playable video file found.",
    )
    assert s.block_reason == "No playable video file found."


def test_torrent_status_block_reason_defaults_none():
    from datetime import datetime
    s = TorrentStatus(
        id="t1", movie_title="X", quality="1080p", state=TorrentState.DOWNLOADING,
        save_path="/x", created_at=datetime.now(), updated_at=datetime.now(),
    )
    assert s.block_reason is None
