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
    # The single casing witness for every extension set in Settings, including
    # stage 9's two subtitle sets. `blocked_extensions`/`video_extensions` are
    # compared against `content_guard.py:20`'s already-lowercased suffix, so one
    # capital letter there makes an extension unmatchable with no error anywhere.
    # The two subtitle sets have NO reader yet — stage 9 task 3 lands the lister
    # that compares against them — so for those two this pins the rule before the
    # comparison exists, rather than describing one that does.
    s = Settings()
    sets = (
        s.blocked_extensions
        | s.video_extensions
        | s.subtitle_extensions
        | s.subtitle_convertible_extensions
    )
    for ext in sets:
        assert ext.startswith(".") and ext == ext.lower()
