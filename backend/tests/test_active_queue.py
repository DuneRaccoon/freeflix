import app.torrent.manager as mgr


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


def test_release_reverts_to_auto_managed():
    h = FakeHandle()
    inst = _mgr_with("t1", h)
    assert inst.release_stream_force_start("t1") is True
    assert h.flags_set  # auto_managed restored
