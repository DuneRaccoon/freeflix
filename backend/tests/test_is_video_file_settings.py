"""_is_video_file is settings-driven and recognizes the expanded extension list."""
from app.torrent.manager import torrent_manager


def test_recognizes_expanded_extensions():
    assert torrent_manager._is_video_file("Show.S01E01.m4v") is True
    assert torrent_manager._is_video_file("clip.ts") is True
    assert torrent_manager._is_video_file("movie.mkv") is True


def test_rejects_executables_and_unknowns():
    assert torrent_manager._is_video_file("Setup.exe") is False
    assert torrent_manager._is_video_file("notes.txt") is False
