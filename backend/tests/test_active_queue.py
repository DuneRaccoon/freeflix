import app.torrent.manager as mgr
from unittest.mock import patch


class FakeHandle:
    def __init__(self):
        self.flags_set = []
        self.flags_unset = []
        self.resumed = False

    def set_flags(self, f):
        self.flags_set.append(f)

    def unset_flags(self, f):
        self.flags_unset.append(f)

    def resume(self):
        self.resumed = True


def _mgr_with(torrent_id, handle):
    inst = mgr.TorrentManager.__new__(mgr.TorrentManager)
    inst.active_torrents = {torrent_id: (handle, {})}
    return inst


def test_set_auto_managed_true_sets_flag():
    h = FakeHandle()
    inst = _mgr_with("t1", h)
    inst._set_auto_managed(h, True)
    assert h.flags_set and not h.flags_unset


def test_set_auto_managed_false_unsets_flag():
    h = FakeHandle()
    inst = _mgr_with("t1", h)
    inst._set_auto_managed(h, False)
    assert h.flags_unset and not h.flags_set


def test_force_start_unsets_auto_managed_and_resumes():
    h = FakeHandle()
    inst = _mgr_with("t1", h)
    assert inst.force_start_for_stream("t1") is True
    assert h.flags_unset  # auto_managed removed
    assert h.resumed is True


def test_force_start_unknown_torrent_returns_false():
    inst = _mgr_with("t1", FakeHandle())
    assert inst.force_start_for_stream("nope") is False


# --- Regression test: default config must NOT set auto_managed on add_torrent ---
# RED before the fix (code always called _set_auto_managed(handle, True));
# GREEN after gating on settings.lt_auto_managed_queue (default False).
def test_add_torrent_does_not_set_auto_managed_by_default(monkeypatch, tmp_path):
    """With lt_auto_managed_queue=False (default), _add_torrent must never call
    _set_auto_managed(handle, True) — the torrent must stay always-active."""
    import libtorrent as lt
    from app.config import settings

    monkeypatch.setattr(settings, "lt_auto_managed_queue", False)

    flags_set_calls = []

    class TrackedHandle:
        sequential_download = False
        max_connections = None

        def set_sequential_download(self, v):
            self.sequential_download = v

        def set_max_connections(self, v):
            self.max_connections = v

        def set_flags(self, f):
            flags_set_calls.append(f)

        def unset_flags(self, f):
            pass

    tracked = TrackedHandle()

    # Patch session.add_torrent to return our tracked handle
    class FakeSession:
        def add_torrent(self, atp):
            return tracked

    inst = mgr.TorrentManager.__new__(mgr.TorrentManager)
    inst.session = FakeSession()
    inst.active_torrents = {}

    magnet = "magnet:?xt=urn:btih:0000000000000000000000000000000000000000&dn=test"
    inst._add_torrent("t1", magnet, tmp_path, {})

    # auto_managed flag must NOT have been set
    try:
        am_flag = lt.torrent_flags.auto_managed
        assert am_flag not in flags_set_calls, (
            "auto_managed was set on the handle even though lt_auto_managed_queue=False"
        )
    except AttributeError:
        # Build lacks torrent_flags.auto_managed — skip the assertion
        pass


# --- Queue-enabled path: with flag=True, add_torrent DOES set auto_managed ---
def test_add_torrent_sets_auto_managed_when_queue_enabled(monkeypatch, tmp_path):
    """With lt_auto_managed_queue=True, _add_torrent must call
    _set_auto_managed(handle, True) so the download queue is enforced."""
    import libtorrent as lt
    from app.config import settings

    monkeypatch.setattr(settings, "lt_auto_managed_queue", True)

    flags_set_calls = []

    class TrackedHandle:
        def set_sequential_download(self, v):
            pass

        def set_max_connections(self, v):
            pass

        def set_flags(self, f):
            flags_set_calls.append(f)

        def unset_flags(self, f):
            pass

    tracked = TrackedHandle()

    class FakeSession:
        def add_torrent(self, atp):
            return tracked

    inst = mgr.TorrentManager.__new__(mgr.TorrentManager)
    inst.session = FakeSession()
    inst.active_torrents = {}

    magnet = "magnet:?xt=urn:btih:0000000000000000000000000000000000000000&dn=test"
    inst._add_torrent("t1", magnet, tmp_path, {})

    try:
        am_flag = lt.torrent_flags.auto_managed
        assert am_flag in flags_set_calls, (
            "auto_managed was NOT set even though lt_auto_managed_queue=True"
        )
    except AttributeError:
        pass  # Build lacks flag enum — nothing to assert


# --- release_stream_force_start: default (queue off) is a no-op (no set_flags) ---
def test_release_no_op_when_queue_disabled(monkeypatch):
    from app.config import settings
    monkeypatch.setattr(settings, "lt_auto_managed_queue", False)

    h = FakeHandle()
    inst = _mgr_with("t1", h)
    result = inst.release_stream_force_start("t1")
    assert result is True
    assert not h.flags_set  # auto_managed must NOT be restored


# --- release_stream_force_start: with queue enabled, auto_managed IS restored ---
def test_release_reverts_to_auto_managed(monkeypatch):
    from app.config import settings
    monkeypatch.setattr(settings, "lt_auto_managed_queue", True)

    h = FakeHandle()
    inst = _mgr_with("t1", h)
    assert inst.release_stream_force_start("t1") is True
    assert h.flags_set  # auto_managed restored
