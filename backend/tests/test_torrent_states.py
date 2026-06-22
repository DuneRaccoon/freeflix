from app.torrent.states import (
    ACTIVE_DOWNLOAD_STATES, RESUMABLE_STATES, TERMINAL_STATES, PAUSED,
)


def test_active_download_states_membership():
    assert "downloading" in ACTIVE_DOWNLOAD_STATES
    assert "queued" in ACTIVE_DOWNLOAD_STATES
    assert "paused" not in ACTIVE_DOWNLOAD_STATES
    assert "finished" not in ACTIVE_DOWNLOAD_STATES


def test_resumable_states():
    assert RESUMABLE_STATES == frozenset({"paused", "stopped"})
    assert PAUSED == "paused"


def test_state_groups_are_disjoint():
    assert not (ACTIVE_DOWNLOAD_STATES & RESUMABLE_STATES)
    assert not (ACTIVE_DOWNLOAD_STATES & TERMINAL_STATES)
    assert not (RESUMABLE_STATES & TERMINAL_STATES)
