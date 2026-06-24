import app.torrent.manager as mgr


class FakeHandle:
    def __init__(self):
        self.reannounced = 0
        self.dht = 0

    def force_reannounce(self):
        self.reannounced += 1

    def force_dht_announce(self):
        self.dht += 1


def _inst(torrent_id, handle):
    inst = mgr.TorrentManager.__new__(mgr.TorrentManager)
    inst.active_torrents = {torrent_id: (handle, {})}
    inst._tracker_recovery = {}
    return inst


def test_first_error_triggers_reannounce(monkeypatch):
    monkeypatch.setattr(mgr.time, "time", lambda: 1000.0)
    h = FakeHandle()
    inst = _inst("t1", h)
    inst._schedule_tracker_recovery("t1", h)
    assert h.reannounced == 1 and h.dht == 1
    assert inst._tracker_recovery["t1"]["attempts"] == 1


def test_second_error_within_backoff_is_suppressed(monkeypatch):
    t = {"now": 1000.0}
    monkeypatch.setattr(mgr.time, "time", lambda: t["now"])
    h = FakeHandle()
    inst = _inst("t1", h)
    inst._schedule_tracker_recovery("t1", h)   # fires (attempt 1), next_at = 1015
    t["now"] = 1005.0                            # still inside backoff window
    inst._schedule_tracker_recovery("t1", h)   # suppressed
    assert h.reannounced == 1


def test_error_after_backoff_fires_again(monkeypatch):
    t = {"now": 1000.0}
    monkeypatch.setattr(mgr.time, "time", lambda: t["now"])
    h = FakeHandle()
    inst = _inst("t1", h)
    inst._schedule_tracker_recovery("t1", h)   # attempt 1, next_at = 1015
    t["now"] = 1020.0                            # past next_at
    inst._schedule_tracker_recovery("t1", h)   # attempt 2
    assert h.reannounced == 2
    assert inst._tracker_recovery["t1"]["attempts"] == 2


def test_max_attempts_caps_reannounce(monkeypatch):
    t = {"now": 1000.0}
    monkeypatch.setattr(mgr.time, "time", lambda: t["now"])
    h = FakeHandle()
    inst = _inst("t1", h)
    for i in range(10):
        inst._schedule_tracker_recovery("t1", h)
        t["now"] += 1000.0  # always past backoff
    assert h.reannounced == 5  # capped at max attempts
