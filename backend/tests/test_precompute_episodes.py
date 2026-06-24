from app.torrent.manager import TorrentManager


class _FakeMgr(TorrentManager):
    """Subclass that bypasses libtorrent: stub get_video_files + persistence."""
    def __init__(self, files):
        self._files = files
        self.persisted = None

    def get_video_files(self, torrent_id):  # override, no libtorrent
        return self._files

    def _persist_episode_map(self, torrent_id, mapping):  # capture instead of DB write
        self.persisted = mapping


def test_precompute_maps_parseable_files():
    mgr = _FakeMgr([
        {"index": 0, "name": "Show.S01E01.1080p.mkv"},
        {"index": 1, "name": "Show.S01E02.1080p.mkv"},
        {"index": 5, "name": "random_no_episode.mkv"},
    ])
    mapping = mgr.precompute_episode_map("t1")
    assert mapping == {
        "0": {"season": 1, "episode": 1},
        "1": {"season": 1, "episode": 2},
    }
    assert mgr.persisted == mapping  # also persisted


def test_precompute_empty_when_nothing_parses():
    mgr = _FakeMgr([{"index": 0, "name": "movie_release.mkv"}])
    assert mgr.precompute_episode_map("t1") == {}
