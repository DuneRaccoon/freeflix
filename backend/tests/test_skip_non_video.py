"""Non-video files are skipped (priority 0) for guarded torrents."""
import types
from app.torrent.manager import torrent_manager


class _TI:
    def __init__(self, paths):
        self._paths = paths
    def num_files(self):
        return len(self._paths)
    def file_at(self, i):
        return types.SimpleNamespace(path=self._paths[i], size=1000)


class _Handle:
    def __init__(self, paths):
        self._ti = _TI(paths)
        self.applied = None
    def has_metadata(self):
        return True
    def get_torrent_info(self):
        return self._ti
    def prioritize_files(self, prios):
        self.applied = list(prios)


def test_skip_non_video_sets_zero_for_non_video():
    h = _Handle(["movie.mkv", "Setup.exe", "info.nfo", "subs.srt"])
    torrent_manager.skip_non_video_files("t-skip", h)
    # video -> 1, everything else -> 0
    assert h.applied == [1, 0, 0, 0]


def test_skip_non_video_no_metadata_is_noop():
    class _NoMeta(_Handle):
        def has_metadata(self):
            return False
    h = _NoMeta(["movie.mkv"])
    torrent_manager.skip_non_video_files("t-skip", h)
    assert h.applied is None
