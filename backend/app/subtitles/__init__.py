"""Sidecar subtitles: listing, pairing, decoding and WebVTT conversion.

Deliberately a package of PURE modules plus one lister. Nothing here calls
`prioritize_files`, `prioritize_video_files` or `file_priority` — piece
admission and the flush live on `TorrentManager` (see the stage 9 plan's D1 and
its Corrections entry C1), and `backend/tests/test_stage9_leaves_the_selectors_alone.py`
is the gate that keeps it that way.
"""
