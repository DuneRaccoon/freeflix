"""Characterisation of `prioritize_video_files`' priority loop.

Nothing in this suite has ever executed that loop's body. Seven files monkeypatch the
method away (``test_stream_force_start.py:24``, ``test_streaming_head.py:53``,
``test_first_chunk_precheck.py:136``, ``test_async_stream_endpoint.py:29``,
``test_streaming_endpoint_416.py:41`` and ``:102``, ``test_prioritize_endpoint.py:26``,
``test_stream_status_matrix.py:105``/``:128``/``:147``), and the one file that calls it
for real feeds it ``FakeInfo.num_files() -> 0``
(``test_per_torrent_conn_cap.py:5-7``, call at ``:35``) — so
``for i in range(torrent_info.num_files())`` has never run a single iteration.

Stage 9 rests on two properties of that loop (plan D1, and correction C1):

1. The applied vector is ``7`` for video and ``0`` for everything else, over EVERY file
   index. A sidecar therefore sits at priority 0, which is the whole reason stage 9
   admits subtitles at PIECE level instead of widening this vector.
2. The vector is a pure function of the file set. ``file_index`` picks the piece
   prioritisation target only, never a priority. So the per-request call at
   ``api/streaming.py:280`` re-applies an IDENTICAL list on every ranged ``GET /video``,
   which libtorrent does not recompute piece priorities from — measured in C1 as
   ``[C] piece-level admission [7,7] -> after the same selector call [7,7]``, against
   ``[A]/[B]`` where a file-level admission is undone by the very next call and takes
   ``_prioritize_window``'s raised window with it.

**Every test here asserts the recorder is non-empty before asserting its contents.** The
house reflex for this method is to stub it out; a stubbed fake records nothing, and an
``applied == [...]``-shaped assertion written against ``None``/``[]`` would stay green
against a method that never ran.

The fake is COPIED from ``test_skip_non_video.py:6-24`` rather than imported, and
extended with the handle members stage 9's own paths touch. Importing it would couple the
two files, and ``test_skip_non_video.py`` is itself the zero-touch gate for
``skip_non_video_files`` (plan task 1, mutation (e)): it must stay exactly as it is.
"""
import types

import pytest

import app.torrent.manager as mgr
from app.config import settings


class _TI:
    """`test_skip_non_video.py:6-24`'s fake, plus `offset`/`piece_length` so
    `_prioritize_streaming_pieces` takes its real span arithmetic rather than its
    `except` fallback.

    NOT load-bearing, measured in review: delete both and all three tests here stay
    GREEN, because the fallback (`first_piece = 0`, `num_pieces = 10`,
    `manager.py:1471-1474`) still calls `piece_priority` and the method still returns
    True, and nothing in this file asserts the span. `handle.piece_priority_calls` and
    `handle.deadlines` are therefore recorded and never read. Pinning the span would
    characterise `_prioritize_streaming_pieces`, which plan task 1 does not ask for —
    leave that to whoever needs it, and do not read these two members as a guard."""

    def __init__(self, paths, size=1_000_000, piece_length=16384):
        self._paths = list(paths)
        self._size = size
        self._piece_length = piece_length

    def num_files(self):
        return len(self._paths)

    def file_at(self, i):
        return types.SimpleNamespace(
            path=self._paths[i], size=self._size, offset=i * self._size
        )

    def piece_length(self):
        return self._piece_length

    def total_size(self):
        return self._size * len(self._paths)


class _Handle:
    def __init__(self, paths, **ti_kwargs):
        self._ti = _TI(paths, **ti_kwargs)
        self.applied = None
        # Stage 9's own members. `file_priority` RECORDS rather than raises: C1 makes it
        # the flush mechanism, so a handle that refused it would forbid the stage's code.
        self.file_priority_calls = []
        self.piece_priority_calls = []
        self.deadlines = []
        self.seq = None
        self.max_conn = None

    def has_metadata(self):
        return True

    def get_torrent_info(self):
        return self._ti

    def prioritize_files(self, prios):
        self.applied = list(prios)

    def file_priority(self, index, priority):
        self.file_priority_calls.append((index, priority))

    def get_file_priorities(self):
        return list(self.applied or [0] * self._ti.num_files())

    def set_sequential_download(self, v):
        self.seq = v

    def set_max_connections(self, n):
        self.max_conn = n

    def piece_priorities(self):
        n = (self._ti.total_size() // self._ti.piece_length()) + 1
        return [4] * n

    def piece_priority(self, piece, priority):
        self.piece_priority_calls.append((piece, priority))

    def set_piece_deadline(self, piece, deadline):
        self.deadlines.append((piece, deadline))

    def have_piece(self, piece):
        return False

    def file_progress(self):
        return [0] * self._ti.num_files()

    def status(self):
        return types.SimpleNamespace(save_path="/tmp/does-not-matter")


@pytest.fixture
def selector(monkeypatch, override_get_db):
    """A `TorrentManager` with no libtorrent session and no real database.

    `prioritize_video_files` writes `streaming_optimized` through `get_db()` once it has
    applied a non-empty vector — the branch `test_per_torrent_conn_cap.py` never reaches,
    because its `num_files() == 0` leaves the vector empty. Unpatched, that would talk to
    the real dev Postgres from a one-off container.
    """
    monkeypatch.setattr(mgr, "get_db", override_get_db)

    def _build(paths, **ti_kwargs):
        handle = _Handle(paths, **ti_kwargs)
        inst = mgr.TorrentManager.__new__(mgr.TorrentManager)
        inst.active_torrents = {"t-prio": (handle, {})}
        inst._contiguous_runs = {}
        return inst, handle

    return _build


def test_video_is_seven_and_every_other_index_is_zero(selector):
    # The fixture carries BOTH a sidecar (index 1) and a non-video non-subtitle
    # (index 2 `.exe`, index 3 `.nfo`). A one-non-video fixture cannot tell
    # "admit everything" from "admit subtitles too".
    inst, handle = selector(["E01.mkv", "E01.en.srt", "Setup.exe", "info.nfo"])

    assert inst.prioritize_video_files("t-prio") is True

    # Non-empty FIRST: the method swallows every exception and returns False, and the
    # house reflex is to stub it away entirely. Both leave `applied` at None.
    assert handle.applied, "prioritize_files was never called — nothing was measured"
    assert handle.applied == [7, 0, 0, 0]
    # A SHORT list does not deselect the tail: it re-admits it at libtorrent's default 4,
    # silently and with no error (plan D1, reason 2). This line is NOT the instrument that
    # catches it, and the plan's "that is the only instrument there is" is wrong twice over
    # (plan C2.3): measured in review, the short-list mutation reddens the equality above
    # AND the equality in the next test, and it is the equality above that fires — this
    # assertion cannot be the one that fails while `== [7, 0, 0, 0]` stands, because that
    # already fixes the length. Kept as the named pin for a later edit that relaxes the
    # equality, not as a live instrument.
    assert len(handle.applied) == handle.get_torrent_info().num_files()


def test_the_vector_does_not_depend_on_file_index(selector):
    # Two videos, so `file_index` has something to choose between. This is the property
    # that keeps the per-request call at `api/streaming.py:280` from recomputing piece
    # priorities: libtorrent does not recompute from an IDENTICAL list, and C1 measured
    # that a piece-level sidecar admission survives such a call while a file-level one
    # is undone by it.
    inst, handle = selector(["S01E01.mkv", "S01E02.mkv", "Subs/S01E01.en.srt", "info.nfo"])

    assert inst.prioritize_video_files("t-prio", file_index=0) is True
    assert handle.applied, "prioritize_files was never called — nothing was measured"
    first = list(handle.applied)

    assert inst.prioritize_video_files("t-prio", file_index=1) is True
    assert handle.applied, "prioritize_files was never called — nothing was measured"
    second = list(handle.applied)

    assert first == second == [7, 7, 0, 0]


def test_video_extensions_is_the_sixteen_entry_set(selector):
    """Pinned verbatim, because D8 refuses to widen it and every refusal in that
    decision is a consequence of this exact set: a `.srt` must not satisfy "has playable
    video", must not double a pack's `/files`, must not resolve as the streamable file,
    must not mint a content_id nobody watched, and — via `manager.py:1402`, the loop the
    tests above characterise — must not be handed priority 7 against the playhead.

    `test_video_mime_types.py:12` already reddens on an addition here, independently and
    for an unrelated reason (no explicit MIME entry). Two witnesses to one rule is this
    repo's anti-pattern, so this assertion is not about MIME coverage: it is the pin that
    stage 9 added NO extension to this set.
    """
    assert settings.video_extensions == {
        ".mp4", ".mkv", ".avi", ".mov", ".webm", ".ogv", ".wmv", ".flv", ".m4v",
        ".mpg", ".mpeg", ".ts", ".m2ts", ".vob", ".3gp", ".mts",
    }
    # And nothing stage 9 lists as a subtitle may be in it. Implied by the equality above
    # — none of the sixteen is a subtitle extension — so this cannot redden on its own
    # either; it is here to name the rule the equality enforces anonymously.
    assert not settings.video_extensions & {".srt", ".vtt", ".ass", ".ssa"}
