"""Content-guard settings: kill switch + extension lists with sane defaults."""
from app.config import settings, Settings


def test_guard_enabled_by_default():
    assert Settings().content_guard_enabled is True


def test_default_extension_lists():
    s = Settings()
    # executables are blocked; common video containers are allowed
    assert ".exe" in s.blocked_extensions
    assert ".iso" in s.blocked_extensions and ".bin" in s.blocked_extensions
    assert {".mp4", ".mkv", ".m4v", ".ts"} <= s.video_extensions
    # no overlap between the two lists
    assert not (s.blocked_extensions & s.video_extensions)


def test_fake_heuristics_off_by_default():
    assert Settings().fake_torrent_heuristics is False


def test_extensions_are_lowercased_with_dot():
    s = Settings()
    for ext in s.blocked_extensions | s.video_extensions:
        assert ext.startswith(".") and ext == ext.lower()
