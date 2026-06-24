import types
import app.torrent.manager as mgr


class FakeHandle:
    pass


def test_finish_alert_releases_force_start(monkeypatch):
    h = FakeHandle()
    inst = mgr.TorrentManager.__new__(mgr.TorrentManager)
    inst.active_torrents = {"t1": (h, {})}

    released = []
    inst.release_stream_force_start = lambda tid: released.append(tid) or True

    # No DB writes in this unit test: stub get_db to a no-op context manager.
    class _NoDb:
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def query(self, *a, **k): return self
        def filter(self, *a, **k): return self
        def first(self): return None
        def add(self, *a, **k): pass
        def commit(self): pass
    monkeypatch.setattr(mgr, "get_db", lambda: _NoDb())

    alert = types.SimpleNamespace(handle=h)
    # Make isinstance(alert, lt.torrent_finished_alert) True via the type the code checks.
    monkeypatch.setattr(mgr.lt, "torrent_finished_alert", types.SimpleNamespace)

    inst._handle_alert(alert)
    assert released == ["t1"]
