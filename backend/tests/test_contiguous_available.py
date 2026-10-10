"""`contiguous_available`: the downloaded run CONTAINING a byte offset.

The seek boundary had no data source anywhere in this codebase. /info's
`downloaded`/`progress` are `file_progress()` TOTALS counting scattered pieces,
and every Range request re-anchors the deadline window at a fresh mid-file
offset, so holes behind the frontier are the normal state — a bar drawn from
`progress` permits exactly the seek the boundary exists to refuse.

Three properties of this function are as load-bearing as the numbers:

* **It answers the run containing `at_bytes`, not a from-file-start scalar.**
  `prioritize_video_files` marks EVERY video file priority 7 while
  `set_sequential_download` is per-TORRENT, so on a season pack libtorrent fills
  the lowest-index episode first: for episode 5 a from-file-start figure
  legitimately sits near zero while playback runs off the deadline window, and a
  scalar would refuse every seek inside the episode being watched. `at_bytes=0`
  degenerates to the prefix case.
* **None means UNKNOWN, and only a measured answer may report a zero-length
  run.** An evicted-but-finished torrent — the television's main content — has no
  live handle and therefore answers None, which the client maps to UNBOUNDED
  seeking. A zero there would refuse every seek on a file whose every byte is on
  disk. This is also why the walk must not use `_safe_have`: its per-piece
  False-on-error turns an invalidated handle into a measured zero-length run.
* **The arithmetic has four separate ways to be wrong** — the file's offset, the
  negative first product, the overshooting last piece, and the division idiom —
  and each one has its own case below.

`_FakeTI`/`_FakeHandle` come from `test_first_chunk_precheck.py`, deliberately:
that fake's `file_at()` honours its argument because an earlier one did not, and
the subclasses here route through it, so swapping it for one that ignores its
argument still fails the pack cases.
"""
import contextlib

import pytest

from app.torrent import manager as manager_mod
from app.torrent.manager import torrent_manager

from test_first_chunk_precheck import _FakeTI, _FakeHandle


# --------------------------------------------------------------------------
# Fakes. Thin subclasses of the shared ones: sizes and a per-piece have_piece.
# --------------------------------------------------------------------------

class _TI(_FakeTI):
    """`_FakeTI` plus the per-file SIZES this arithmetic needs.

    `file_at()` calls the shared fake's own implementation and only adds `size`,
    so the mutation that proves these cases exercise file offsets at all —
    swapping `_FakeTI.file_at` for one that ignores its argument — reaches every
    test in this file.
    """

    def __init__(self, *, offsets, sizes, piece_length, num_pieces=1 << 24):
        super().__init__(offsets, piece_length, num_pieces)
        self._sizes = dict(sizes)

    def file_at(self, i):
        f = super().file_at(i)
        f.size = self._sizes[i]
        return f

    def num_files(self):
        return max(self._sizes) + 1


class _Pieces(_FakeHandle):
    """`_FakeHandle` with per-piece availability, a call log, and two faults.

    `file_progress` defaults to all-zero, i.e. "this file claims no completed
    bytes", which sends every case through the walk rather than the fast path.
    """

    def __init__(self, ti, have=(), *, file_progress=None, raises=False,
                 metadata=True):
        super().__init__(ti, False)
        self._have = set(have)
        self._fp = file_progress
        self._raises = raises
        self._metadata = metadata
        self.calls = []

    def has_metadata(self):
        return self._metadata

    def have_piece(self, p):
        self.calls.append(p)
        if self._raises:
            raise RuntimeError("the torrent handle was invalidated")
        return p in self._have

    def file_progress(self):
        if self._fp is not None:
            return self._fp
        return [0] * self._ti.num_files()


@pytest.fixture(autouse=True)
def clean_memo():
    """The manager is a process-wide singleton and so is its memo."""
    torrent_manager._contiguous_runs.clear()
    yield
    torrent_manager._contiguous_runs.clear()


@contextlib.contextmanager
def loaded(tid, handle):
    torrent_manager.active_torrents[tid] = (handle, {})
    try:
        yield handle
    finally:
        torrent_manager.active_torrents.pop(tid, None)


# A season pack: two 1000-byte episodes at a 64-byte piece length, so the second
# episode starts at a non-zero offset INSIDE a piece shared with the first.
def _pack_ti():
    return _TI(offsets={0: 0, 1: 1000}, sizes={0: 1000, 1: 1000},
               piece_length=64, num_pieces=32)


def _single_ti(size=300, piece_length=64):
    return _TI(offsets={0: 0}, sizes={0: size},
               piece_length=piece_length, num_pieces=64)


# ==========================================================================
# None means unknown. Three paths, none of them a zero-length run.
# ==========================================================================

def test_absent_from_the_session_is_unknown_not_zero():
    """The evicted-finished case task 2 handed over, and the one that matters most.

    `find_loadable_on_startup` never re-adds a finished or seeding torrent and
    `_refresh_active_torrents` evicts `finished` mid-session, so a completed
    download — the television's main content — has NO live handle while every one
    of its bytes is on disk. `_lookup_video_file`'s resume-data fallback makes it
    playable; there is nothing to measure a piece map against, so the honest
    answer is "unknown" and the client reads that as unbounded seeking. A zero
    here would refuse every seek on a complete film.
    """
    assert "t-not-loaded" not in torrent_manager.active_torrents
    assert torrent_manager.contiguous_available("t-not-loaded", 0, 0) is None


def test_a_torrent_without_metadata_is_unknown():
    h = _Pieces(_single_ti(), have=range(0, 64), metadata=False)
    with loaded("t-nometa", h):
        assert torrent_manager.contiguous_available("t-nometa", 0, 0) is None
    assert h.calls == []


def test_a_raising_handle_is_unknown_not_a_zero_length_run():
    """The reason the walk may not use `_safe_have`.

    `_safe_have` answers False for a piece whose `have_piece` raised, so an
    invalidated handle would walk out as a measured zero-length run — a ceiling
    of zero on a file that may be complete. One try around the whole body,
    answering None, is the only shape that keeps "unknown" and "nothing here"
    apart.
    """
    h = _Pieces(_single_ti(), have=range(0, 64), raises=True)
    with loaded("t-raising", h):
        assert torrent_manager.contiguous_available("t-raising", 0, 0) is None


def test_an_out_of_range_file_index_is_unknown():
    with loaded("t-range", _Pieces(_pack_ti(), have=range(0, 32))):
        assert torrent_manager.contiguous_available("t-range", 7, 0) is None
        assert torrent_manager.contiguous_available("t-range", -1, 0) is None


# ==========================================================================
# The runs themselves.
# ==========================================================================

def test_the_prefix_run_at_offset_zero():
    # at_bytes=0 degenerates to the prefix the spec literally asks for: pieces 0
    # and 1 are here, piece 2 is not, so the run ends at the end of piece 1.
    with loaded("t-prefix", _Pieces(_single_ti(), have={0, 1})):
        run = torrent_manager.contiguous_available("t-prefix", 0, 0)
    assert run == {
        "file_index": 0,
        "file_size": 300,
        "piece_length": 64,
        "run_start": 0,
        "run_end": 128,
        "complete": False,
        "measured_against": "metadata",
    }


def test_the_run_containing_the_playhead_in_a_season_pack():
    """The case a from-file-start scalar gets wrong, and the `fi.offset` pin.

    Episode 2 starts 1000 bytes into the torrent. The pieces around its playhead
    are here while its own first bytes are not — exactly what the per-torrent
    sequential flag plus a mid-file deadline window produces. The run is measured
    where the viewer is, and it legitimately does not start at zero.
    """
    with loaded("t-pack", _Pieces(_pack_ti(), have={16, 17, 18})):
        run = torrent_manager.contiguous_available("t-pack", 1, 100)
    # piece 16 covers global 1024-1087, piece 18 ends at global 1215.
    assert run["run_start"] == 24
    assert run["run_end"] == 216
    assert run["complete"] is False
    assert run["file_index"] == 1
    # And the same measurement from file 0's point of view is a different answer,
    # so the index is not decoration.
    with loaded("t-pack", _Pieces(_pack_ti(), have={16, 17, 18})):
        other = torrent_manager.contiguous_available("t-pack", 0, 100)
    assert other["run_start"] == other["run_end"] == 100


def test_a_files_first_piece_starts_before_the_file_does():
    """The `max(0, …)` pin: the raw product here is -40, not 0.

    Pieces are torrent-global, so the piece holding a pack file's first byte
    begins inside the PREVIOUS file. Without the clamp the run starts at a
    negative offset, which a client turns into a negative seek ceiling.
    """
    with loaded("t-neg", _Pieces(_pack_ti(), have={15, 16})):
        run = torrent_manager.contiguous_available("t-neg", 1, 0)
    assert 15 * 64 - 1000 == -40, "the raw product this clamp exists for"
    assert run["run_start"] == 0
    assert run["run_end"] == 88


def test_the_last_piece_overshoots_the_file_end():
    """The `min(file_size, …)` pin: the raw product here is 1048 on a 1000-byte file.

    The final piece is partial and, in a pack, shared with whatever follows. An
    unclamped run_end promises bytes past EOF and the client's seek ceiling lands
    outside the media.
    """
    with loaded("t-over", _Pieces(_pack_ti(), have={29, 30, 31})):
        run = torrent_manager.contiguous_available("t-over", 1, 900)
    assert 32 * 64 - 1000 == 1048, "the raw product this clamp exists for"
    assert run["run_start"] == 856
    assert run["run_end"] == 1000
    assert run["run_end"] <= run["file_size"]


def test_a_missing_piece_under_the_playhead_is_a_measured_zero_length_run():
    # Measured, and zero-length: distinct from None, which means not measured.
    # The client refuses forward seeks here but keeps playing.
    with loaded("t-hole", _Pieces(_single_ti(), have={0, 4})):
        run = torrent_manager.contiguous_available("t-hole", 0, 100)
    assert run is not None
    assert run["run_start"] == run["run_end"] == 100
    assert run["complete"] is False


def test_the_piece_index_is_integer_division_not_a_float_quotient():
    """`//`, never `int(a / b)` — with the offset it actually takes to show it.

    MEASURED, and it corrects the plan: at multi-gigabyte offsets the two idioms
    agree EXACTLY. `a / b` is a double, and for a and b both exact the quotient's
    absolute error is at most q*2^-53, so a quotient can only round up across an
    integer boundary once a exceeds 2^53 — about 9 PB. A realistic fixture here
    would make the `int(a/b)` mutation undetectable, so this one is deliberately
    absurd: offset 9007199254757275, where `(offset+100)//16384` is 549755813888
    and `int((offset+100)/16384)` is 549755813889. One piece apart, and the piece
    map answers differently for each.
    """
    off = 9007199254757275
    assert (off + 100) // 16384 == 549755813888
    assert int((off + 100) / 16384) == 549755813889

    ti = _TI(offsets={0: off}, sizes={0: 65536}, piece_length=16384,
             num_pieces=549755813893)
    with loaded("t-div", _Pieces(ti, have={549755813888})):
        run = torrent_manager.contiguous_available("t-div", 0, 100)
    assert run["run_start"] == 0
    assert run["run_end"] == 101
    # Under the float idiom the playhead lands one piece later, which this map
    # does not have, and the answer collapses to a zero-length run at 100.
    assert run["run_end"] != 100


def test_the_files_first_piece_index_is_integer_division_too():
    """The same idiom at the other site where it is observable: `first_piece`.

    `first_piece` bounds the BACKWARD walk, so a quotient that rounds up stops
    the walk one piece early and the run starts one byte late — 1 instead of 0 on
    a file whose first piece is shared with the file before it.

    MEASURED: the third site, `last_piece`, is NOT independently observable
    through this return value. It bounds the forward walk, whose
    `min(file_size, …)` clamps whatever it produces back to the file's end, and
    beyond that it only changes which piece the fast path consults. Pinning it
    would take a test that cannot fail, so it is not pinned — it is written the
    same way as its two neighbours and this comment is the record of why.
    """
    off = 9007199254757375
    assert off // 16384 == 549755813888
    assert int(off / 16384) == 549755813889

    ti = _TI(offsets={0: off}, sizes={0: 65536}, piece_length=16384,
             num_pieces=549755813893)
    with loaded("t-div2", _Pieces(ti, have={549755813888, 549755813889})):
        run = torrent_manager.contiguous_available("t-div2", 0, 1)
    assert run["run_start"] == 0, "the walk reaches the file's own first piece"
    assert run["run_end"] == 16385


def test_at_bytes_is_clamped_at_both_ends():
    # A player can send a playhead past the end of a file it is still loading,
    # and a negative one is a bug waiting to happen. Neither may raise, and
    # neither may escape the file.
    with loaded("t-clamp", _Pieces(_single_ti(), have={0, 1, 4})):
        past = torrent_manager.contiguous_available("t-clamp", 0, 10 ** 9)
        under = torrent_manager.contiguous_available("t-clamp", 0, -5000)
    # 10**9 clamps to byte 299, which is in piece 4.
    assert past["run_start"] == 256 and past["run_end"] == 300
    # -5000 clamps to 0, the prefix.
    assert under["run_start"] == 0 and under["run_end"] == 128


def test_a_file_index_of_none_resolves_the_way_the_byte_routes_do(monkeypatch):
    # Not a second resolution rule: it defers to get_video_file_info, whose own
    # contract is "the largest video file".
    monkeypatch.setattr(
        torrent_manager, "get_video_file_info",
        lambda tid, fi=None: {"index": 1, "size": 1000, "name": "e2.mkv"})
    with loaded("t-none", _Pieces(_pack_ti(), have={16, 17, 18})):
        run = torrent_manager.contiguous_available("t-none", None, 100)
    assert run["file_index"] == 1
    assert (run["run_start"], run["run_end"]) == (24, 216)


def test_measured_against_names_the_size_the_run_was_measured_against():
    # 'metadata' is torrent_info.file_at(idx).size. It is the only value today
    # because the walk makes no stat call; it is reported so a client reads what
    # it is given rather than assuming.
    with loaded("t-against", _Pieces(_single_ti(), have={0})):
        run = torrent_manager.contiguous_available("t-against", 0, 0)
    assert run["measured_against"] == "metadata"


# ==========================================================================
# `complete`, and the fast path that may not claim it on byte counts alone.
# ==========================================================================

def test_a_fully_downloaded_file_is_complete_without_a_walk():
    ti = _single_ti()
    h = _Pieces(ti, have=range(0, 5), file_progress=[300])
    with loaded("t-done", h):
        run = torrent_manager.contiguous_available("t-done", 0, 0)
    assert run["complete"] is True
    assert (run["run_start"], run["run_end"]) == (0, 300)
    # One have_piece call — the tail check — and no walk at all. The fast path is
    # what keeps /info's polling affordable on a finished 30 GB pack.
    assert h.calls == [4]


def test_byte_complete_with_an_unverified_tail_is_not_complete():
    """The `have_piece(last_piece)` conjunct, and why the fast path needs it.

    Neither call site passes a granularity flag to `file_progress()`, so it counts
    downloaded-but-unverified blocks: a file can report every byte while its last
    piece is still not readable, which is exactly the moment a tail seek blocks
    in `stream_file_range`. Byte-completeness alone would answer `complete: true`
    there and the client would allow a seek that hangs with the 206 already sent.
    """
    ti = _single_ti()
    h = _Pieces(ti, have={0, 1, 2, 3}, file_progress=[300])
    with loaded("t-tail", h):
        run = torrent_manager.contiguous_available("t-tail", 0, 0)
    assert run["complete"] is False
    assert run["run_end"] == 256, "the run stops at the start of the missing tail"
    assert 4 in h.calls, "the tail piece is consulted"


def test_complete_requires_the_run_to_start_at_zero_too():
    # Measured the long way (no byte-completeness claim): the whole file is here,
    # so the run is the file.
    with loaded("t-all", _Pieces(_single_ti(), have=range(0, 5))):
        run = torrent_manager.contiguous_available("t-all", 0, 100)
    assert run["complete"] is True
    assert (run["run_start"], run["run_end"]) == (0, 300)


# ==========================================================================
# The walk is bounded, and the answer is memoised.
# ==========================================================================

def test_the_walk_is_bounded_and_running_out_errs_low(monkeypatch):
    # Read before patching: the shipped bound covers a 30 GB pack at libtorrent's
    # 8 MiB piece length in one pass, so the conservative answer below is not the
    # normal one.
    shipped_bound = manager_mod._CONTIGUOUS_MAX_PIECES
    assert shipped_bound >= (30 * 1024 ** 3) // (8 * 1024 ** 2)

    monkeypatch.setattr(manager_mod, "_CONTIGUOUS_MAX_PIECES", 4)
    ti = _single_ti(size=64 * 20)
    h = _Pieces(ti, have=range(0, 20))
    with loaded("t-bound", h):
        run = torrent_manager.contiguous_available("t-bound", 0, 0)
    # Four pieces of forward budget: the run is reported SHORTER than it really
    # is, which refuses a seek that would have worked. The opposite error would
    # permit a seek that hangs the socket with the 206 already sent.
    assert run["run_end"] == 320
    assert run["complete"] is False
    assert len(h.calls) <= 6


def test_the_answer_is_memoised_for_about_a_second(monkeypatch):
    assert manager_mod._CONTIGUOUS_TTL_S == pytest.approx(1.0)

    ti = _single_ti()
    h = _Pieces(ti, have={0, 1})
    monkeypatch.setattr(manager_mod, "_CONTIGUOUS_TTL_S", 1000.0)
    with loaded("t-memo", h):
        first = torrent_manager.contiguous_available("t-memo", 0, 0)
        spent = len(h.calls)
        second = torrent_manager.contiguous_available("t-memo", 0, 0)
        assert second == first
        assert len(h.calls) == spent, "the second answer cost no pybind calls"

        # A different piece is a different question, so the memo may not answer it.
        third = torrent_manager.contiguous_available("t-memo", 0, 200)
        assert len(h.calls) > spent
        assert third["run_start"] == third["run_end"] == 200

        # Expiry re-measures: pieces arrive while a title is on screen.
        monkeypatch.setattr(manager_mod, "_CONTIGUOUS_TTL_S", 0.0)
        h._have = {0, 1, 2}
        spent = len(h.calls)
        again = torrent_manager.contiguous_available("t-memo", 0, 0)
        assert len(h.calls) > spent
        assert again["run_end"] == 192


def test_the_memo_is_scoped_to_the_torrent_and_the_file(monkeypatch):
    monkeypatch.setattr(manager_mod, "_CONTIGUOUS_TTL_S", 1000.0)
    with loaded("t-a", _Pieces(_pack_ti(), have={0, 1, 2})), \
            loaded("t-b", _Pieces(_pack_ti(), have=())):
        a = torrent_manager.contiguous_available("t-a", 0, 0)
        b = torrent_manager.contiguous_available("t-b", 0, 0)
        pack_file_1 = torrent_manager.contiguous_available("t-a", 1, 0)
    assert a["run_end"] == 192
    assert b["run_start"] == b["run_end"] == 0, "a different torrent, measured"
    assert pack_file_1["run_start"] == pack_file_1["run_end"] == 0
