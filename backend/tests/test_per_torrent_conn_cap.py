import app.torrent.manager as mgr
from app.config import settings


class FakeInfo:
    def num_files(self):
        return 0


class FakeHandle:
    def __init__(self):
        self.max_conn = None
        self.seq = None

    def has_metadata(self):
        return True

    def set_sequential_download(self, v):
        self.seq = v

    def get_torrent_info(self):
        return FakeInfo()

    def prioritize_files(self, prios):
        pass

    def set_max_connections(self, n):
        self.max_conn = n


def test_prioritize_applies_per_torrent_connection_cap():
    h = FakeHandle()
    inst = mgr.TorrentManager.__new__(mgr.TorrentManager)
    inst.active_torrents = {"t1": (h, {})}
    inst.prioritize_video_files("t1")
    assert h.max_conn == settings.lt_per_torrent_connections()
