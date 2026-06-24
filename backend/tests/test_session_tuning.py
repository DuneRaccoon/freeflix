import types
import app.torrent.manager as mgr


def test_apply_session_tuning_calls_apply_settings(monkeypatch):
    captured = {}

    class FakeSession:
        def apply_settings(self, d):
            captured["dict"] = d

    inst = mgr.TorrentManager.__new__(mgr.TorrentManager)  # no __init__ side effects
    inst.session = FakeSession()
    inst._apply_session_tuning()

    assert "dict" in captured
    assert isinstance(captured["dict"], dict)


def test_apply_session_tuning_swallows_errors(monkeypatch):
    class BoomSession:
        def apply_settings(self, d):
            raise RuntimeError("bad key")

    inst = mgr.TorrentManager.__new__(mgr.TorrentManager)
    inst.session = BoomSession()
    # Must not raise — a bad setting cannot block startup.
    inst._apply_session_tuning()
