"""Sidecar subtitles: listing, pairing, decoding and WebVTT conversion.

Deliberately a package of PURE modules plus one lister. Nothing here calls
`prioritize_files`, `prioritize_video_files` or `file_priority` — piece
admission and the flush live on `TorrentManager` (see the stage 9 plan's D1 and
its Corrections entry C1), and `backend/tests/test_stage9_leaves_the_selectors_alone.py`
is the gate that keeps it that way.

`sidecars` is the lister's POLICY half — the hard-coded listed extension set,
the containment assertion and the on-disk half of readiness. The libtorrent
reads it composes with live on `TorrentManager.list_sidecars`, which is the only
thing in stage 9 that can see a handle at all (plan D5: resolution is the live
session only, because every resume blob this application writes carries no
`info` dict).
"""
from app.subtitles.sidecars import (
    COVERAGE_LISTED,
    COVERAGE_NONE,
    COVERAGE_UNKNOWN,
    SOURCE_SESSION,
)

__all__ = [
    "COVERAGE_LISTED",
    "COVERAGE_NONE",
    "COVERAGE_UNKNOWN",
    "SOURCE_SESSION",
]
