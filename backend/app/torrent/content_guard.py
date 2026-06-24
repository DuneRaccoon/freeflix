"""Heuristic torrent content guard — pure classification, no libtorrent.

Given a torrent's file list (path, size), decide whether it should be BLOCKED
before its content downloads. Returns a human-readable reason, or None if allowed.
Rules (first hard-fail wins):
  1. any file with a blocked (executable/installer/script/disc-image) extension
  2. no streamable video file at all
  3. (opt-in) a fake-torrent structural pattern
"""
import re
from pathlib import Path
from typing import Iterable, List, Optional, Tuple

_FAKE_COMPANION_RE = re.compile(r"password|how ?to|read ?me|install", re.IGNORECASE)
_FAKE_COMPANION_EXTS = {".txt", ".nfo", ".html", ".htm", ".url"}


def file_ext(path: str) -> str:
    """Lowercased file extension including the leading dot ('' if none)."""
    return Path(path).suffix.lower()


def is_video_file(path: str, video_extensions: Iterable[str]) -> bool:
    """True if `path`'s extension is in `video_extensions` (each like '.mp4')."""
    return file_ext(path) in set(video_extensions)


def classify_torrent_files(
    files: Iterable[Tuple[str, int]],
    *,
    blocked_extensions: Iterable[str],
    video_extensions: Iterable[str],
    fake_heuristics: bool = False,
) -> Optional[str]:
    """Return a block reason, or None if the torrent is allowed.

    `files` is an iterable of (path: str, size: int).
    """
    files_list: List[Tuple[str, int]] = list(files)
    blocked = set(blocked_extensions)
    videos = set(video_extensions)

    # Rule 1: any executable / installer / script / disc image present.
    for path, _size in files_list:
        if file_ext(path) in blocked:
            return f"Contains an executable file ({Path(path).name}) — blocked for safety."

    # Rule 2: no streamable video file at all.
    if not any(file_ext(p) in videos for p, _ in files_list):
        return "No playable video file found — likely a fake or archive-only release."

    # Rule 3 (opt-in): largest file is a non-video AND a fake-companion text file exists.
    # Note: empty file list is already handled by rule 2 (returns no-video reason), so max(...) is safe.
    if fake_heuristics and files_list:
        largest_path, _ = max(files_list, key=lambda f: f[1])
        if file_ext(largest_path) not in videos:
            for p, _ in files_list:
                if file_ext(p) in _FAKE_COMPANION_EXTS and _FAKE_COMPANION_RE.search(Path(p).name):
                    return "Matches a known fake-torrent pattern — blocked for safety."

    return None
