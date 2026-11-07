from app.torrent.manager import TorrentManager


class _Handle:
    def __init__(self, has_metadata):
        self._has_metadata = has_metadata

    def has_metadata(self):
        return self._has_metadata


class _FakeMgr(TorrentManager):
    """Subclass that bypasses libtorrent: stub get_video_files + persistence."""
    def __init__(self, files, has_metadata=True):
        self._files = files
        self.persisted = None
        self.active_torrents = {"t1": (_Handle(has_metadata), {})}

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
    # Metadata is in and no name parses: {} is SAVED, so pack_contains reads every
    # episode as missing and a Play starts that episode's own download (spec 3.2),
    # instead of NULL reusing the pack forever and opening its first file.
    mgr = _FakeMgr([{"index": 0, "name": "movie_release.mkv"}])
    assert mgr.precompute_episode_map("t1") == {}
    assert mgr.persisted == {}


def test_precompute_saves_nothing_before_the_metadata():
    # No metadata yet: NULL stays NULL ("not known"), never {} ("known, not there").
    mgr = _FakeMgr([], has_metadata=False)
    assert mgr.precompute_episode_map("t1") == {}
    assert mgr.persisted is None

    gone = _FakeMgr([])
    gone.active_torrents = {}
    assert gone.precompute_episode_map("t1") == {}
    assert gone.persisted is None
