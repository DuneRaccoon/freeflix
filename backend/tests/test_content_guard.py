"""Pure content-guard classifier: block executables / no-video / fake patterns."""
from app.torrent.content_guard import classify_torrent_files, is_video_file, file_ext

BLOCKED = {".exe", ".iso", ".bin", ".msi", ".dll"}
VIDEO = {".mp4", ".mkv", ".m4v", ".ts"}


def classify(files, fake=False):
    return classify_torrent_files(
        files, blocked_extensions=BLOCKED, video_extensions=VIDEO, fake_heuristics=fake
    )


def test_single_exe_blocked():
    reason = classify([("Setup.exe", 1_000_000)])
    assert reason and "executable" in reason.lower()


def test_video_plus_exe_blocked_by_rule1():
    reason = classify([("movie.mkv", 2_000_000_000), ("codec.exe", 500_000)])
    assert reason and "executable" in reason.lower()


def test_archive_only_blocked_no_video():
    reason = classify([("movie.rar", 2_000_000_000), ("movie.r01", 1_000_000)])
    assert reason and "no playable video" in reason.lower()


def test_document_only_blocked_no_video():
    reason = classify([("readme.txt", 500), ("poster.jpg", 50_000)])
    assert reason and "no playable video" in reason.lower()


def test_video_with_subs_and_nfo_allowed():
    assert classify([
        ("The.Movie.2026.1080p.mkv", 2_000_000_000),
        ("The.Movie.2026.1080p.srt", 80_000),
        ("info.nfo", 1_200),
    ]) is None


def test_expanded_extensions_allowed():
    assert classify([("ep.m4v", 1_000_000_000)]) is None
    assert classify([("ep.ts", 1_000_000_000)]) is None


def test_structural_fake_blocked_only_when_enabled():
    files = [
        ("Movie.mp4", 800_000),
        ("Movie_FULL.dat", 2_000_000_000),      # .dat not blocked, not video
        ("password.txt", 300),
    ]
    assert classify(files, fake=False) is None
    reason = classify(files, fake=True)
    assert reason and "fake" in reason.lower()


def test_helpers():
    assert file_ext("A/B/c.MKV") == ".mkv"
    assert file_ext("noext") == ""
    assert is_video_file("x.mp4", VIDEO) is True
    assert is_video_file("x.exe", VIDEO) is False
