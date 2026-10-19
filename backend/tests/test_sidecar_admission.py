"""Piece admission, the flush, gate 4, and the two retraction exits.

Stage 9 admits a sidecar's bytes in TWO PHASES on TWO DIFFERENT MECHANISMS, and
every row here exists because correction C1 measured that the one-phase shape
both the spec and the design round proposed does not work:

* **Phase 1 is piece-level and touches no file priority.** Measured: a
  `file_priority(sub, 1)` admission is undone by `prioritize_video_files`' very
  next call — which every ranged `GET /video` makes — and that recompute takes
  `_prioritize_window`'s raised window with it, so fetching a subtitle costs the
  playhead. A piece-level admission survives the same call untouched, because the
  selector's vector is a pure function of the file set and libtorrent does not
  recompute from an identical list.
* **Phase 2 is a FLUSH, and without it there is no file at all.** `piece_priority
  (p, 7)` alone leaves the bytes in libtorrent 2.0's `.<infohash>.parts` part
  file: `have_piece` is True, `file_progress` reports the declared size,
  `contiguous_available` reports `complete`, and `open()` on the sidecar's own
  path raises FileNotFoundError. One `file_priority(idx, 1)` once the span is
  held moves them (`redownloaded=0`), and one `file_priority(idx, 0)` puts the
  priority back.
* **The two retraction exits differ in exactly the call that is unsafe, and
  GATE 4 GUARDS BOTH OF THEM FIRST.** A gate-4 refusal makes the whole call a
  true no-op, deadlines included — resetting a deadline is NOT unconditionally
  safe, because on a span gate 4 has just declared off-limits the deadline may
  be the playhead's own (`_deadline_pieces`, whose `read_ahead=4` reaches past
  the video's last piece on an unpadded torrent). With the gate passed: on
  success, `reset_piece_deadline` and nothing else; on budget expiry,
  `piece_priority(p, 0)` as well — the only one in the stage.
  Measured on an unpadded layout where the sidecar shares the video's
  last piece: `retract=file` gave residual 0, the shared piece left at
  libtorrent's default 4 and the torrent `seeding`/100%; `retract=piece` gave
  residual **-3048**, the shared piece at priority **0**, and the torrent back to
  `downloading`/46.78%. A negative residual is the torrent wanting less than its
  own video — an unplayable episode reported complete. **One retraction test
  cannot cover this**, which is why there are six: the two exits, each exit's
  gate-4 refusal, idempotence, and the off-session no-op.

**Why the fixtures are shaped the way they are.** The sidecar sits at a NON-ZERO
offset mid-torrent in every layout: a sidecar-at-offset-0 fixture cannot tell the
correct span from one computed without the `fi.offset` term, because both answer
piece 0. The padded layout carries a pad file at libtorrent's DEFAULT priority 4
(the value D1 reason 2 measured a short `prioritize_files` list re-admitting a
tail to) positioned so it overlaps the sidecar's last piece, which is what makes
gate 4's pad exclusion load-bearing rather than decorative. And the unpadded
layout's sidecar shares a piece with the video's 1000-byte tail, which is the
only shape in which gate 4 has anything to refuse.

The fakes are hand-written rather than imported, the same choice
`test_sidecar_lister.py` and `test_stage9_leaves_the_selectors_alone.py` made:
this file needs a mutable priority vector (a real handle's next
`get_file_priorities()` reflects a `file_priority` call, and a second flush
depends on it) that no shared fake carries.
"""
import asyncio
import types

import libtorrent as lt
import pytest

from app.config import settings
from app.torrent import manager as mgr
from app.torrent.manager import torrent_manager

PIECE = 32 * 1024
TID = "t-sidecar-admit"
SUB = 2  # the sidecar's index in the padded layout

# (path, size, is_pad). Offsets accumulate, so the sidecar is at 131072.
#
#   i  path                       bytes    offset   pieces
#   0  Show.S01/E01.mkv          100000         0   0..3
#   1  .pad/31072                 31072    100000   3
#   2  Show.S01/Subs/E01.en.srt   40960    131072   4..5   <- the sidecar
#   3  .pad/24576                 24576    172032   5
#   4  Show.S01/info.nfo           1024    196608   6
#
# Pad 3 OVERLAPS the sidecar's last piece and is given priority 4 below, so a
# gate 4 that forgot to exclude pads would refuse the whole admission.
PADDED = [
    ("Show.S01/E01.mkv", 100000, False),
    (".pad/31072", 31072, True),
    ("Show.S01/Subs/E01.en.srt", 40960, False),
    (".pad/24576", 24576, True),
    ("Show.S01/info.nfo", 1024, False),
]
PADDED_PRIOS = [7, 0, 0, 4, 0]
PADDED_SPAN = (4, 5)

# The unpadded layout: the video's last piece (3) holds its final 1000 bytes AND
# the whole sidecar. This is the layout gate 4 exists for.
UNPADDED = [
    ("Movie/Movie.mkv", 99304, False),
    ("Movie/Movie.en.srt", 2048, False),
]
UNPADDED_PRIOS = [7, 0]

# The last-piece layout. The sidecar's span is TWO pieces and the file sharing it
# is a WANTED video that occupies only the span's LAST piece; the video BEFORE it
# ends exactly on the span's first boundary, so it is not what gate 4 catches.
#
#   i  path               bytes   offset   pieces
#   0  Show/E01.mkv       98304        0   0..2   (ends exactly on a boundary)
#   1  Show/E01.en.srt    40960    98304   3..4   <- the sidecar
#   2  Show/E02.mkv       50000   139264   4..5   <- WANTED, shares piece 4 ONLY
#
# Neither layout above has this shape: UNPADDED's span is a single piece, and the
# only non-pad file PADDED offers gate 4 overlaps the span's FIRST piece. So gate
# 4's `span_end = (last_piece + 1) * piece_length` had no row, and dropping that
# `+ 1` — which makes the gate blind to the last piece of every multi-piece span
# — was MEASURED green across all 28 rows in review. What it would ship is the
# catastrophe gate 4 exists for: residual -3048, the shared piece de-wanted, the
# torrent back from `seeding`/100% to `downloading`/46.78%.
SHARED_LAST_PIECE = [
    ("Show/E01.mkv", 98304, False),
    ("Show/E01.en.srt", 40960, False),
    ("Show/E02.mkv", 50000, False),
]
SHARED_LAST_PIECE_PRIOS = [7, 0, 7]


# --------------------------------------------------------------------------
# Fakes
# --------------------------------------------------------------------------

class _FS:
    """`ti.files()`, for the one thing admission asks it: the pad-file flag.

    Read from libtorrent's own enum rather than a literal, so the fixture keeps
    meaning what it says if the binding's value ever changes.
    """

    def __init__(self, rows):
        self._rows = rows

    def file_flags(self, i):
        return lt.file_flags_t.flag_pad_file if self._rows[i][2] else 0

    def file_path(self, i):
        return self._rows[i][0]


class _TI:
    """Metadata with REAL accumulated offsets."""

    def __init__(self, rows, piece_length=PIECE):
        self._rows = []
        offset = 0
        for rel, size, pad in rows:
            self._rows.append((rel, size, pad, offset))
            offset += size
        self._pl = piece_length

    def num_files(self):
        return len(self._rows)

    def file_at(self, i):
        rel, size, _pad, offset = self._rows[i]
        return types.SimpleNamespace(path=rel, size=size, offset=offset)

    def piece_length(self):
        return self._pl

    def total_size(self):
        return sum(r[1] for r in self._rows)

    def files(self):
        return _FS(self._rows)


class _Handle:
    """A live handle that RECORDS every priority-shaped call.

    `priorities` is mutable and `file_priority` writes to it, because a real
    handle's next `get_file_priorities()` reflects the call — which is what makes
    the flush's own "is it still at 0?" precondition meaningful on a second pass.

    `have` is a bool or a set of held piece indices.
    """

    def __init__(self, ti, save_path, priorities, *, have=False, metadata=True):
        self._ti = ti
        self._save_path = str(save_path)
        self._metadata = metadata
        self.priorities = list(priorities)
        self.have = have
        self.piece_priority_calls = []
        self.deadline_calls = []
        self.reset_deadline_calls = []
        self.file_priority_calls = []
        self.prioritize_files_calls = []

    # ---- reads
    def has_metadata(self):
        return self._metadata

    def get_torrent_info(self):
        return self._ti

    def status(self):
        return types.SimpleNamespace(save_path=self._save_path)

    def get_file_priorities(self):
        return list(self.priorities)

    def file_progress(self):
        return [self._ti.file_at(i).size for i in range(self._ti.num_files())]

    def have_piece(self, piece):
        if self.have is True or self.have is False:
            return bool(self.have)
        return piece in self.have

    # ---- writes, all recorded
    def prioritize_files(self, prios):
        self.prioritize_files_calls.append(list(prios))

    def file_priority(self, index, priority):
        self.file_priority_calls.append((index, priority))
        self.priorities[index] = priority

    def piece_priority(self, piece, priority):
        self.piece_priority_calls.append((piece, priority))

    def set_piece_deadline(self, piece, deadline):
        self.deadline_calls.append((piece, deadline))

    def reset_piece_deadline(self, piece):
        self.reset_deadline_calls.append(piece)


@pytest.fixture(autouse=True)
def clean_state():
    """The manager and the fetch registry are both process-wide."""
    mgr._sidecar_fetch_tasks.clear()
    torrent_manager._contiguous_runs.clear()
    yield
    mgr._sidecar_fetch_tasks.clear()
    torrent_manager._contiguous_runs.clear()
    torrent_manager.active_torrents.pop(TID, None)


def _load(tmp_path, rows=PADDED, prios=PADDED_PRIOS, **kw):
    handle = _Handle(_TI(rows), tmp_path, prios, **kw)
    torrent_manager.active_torrents[TID] = (handle, {})
    return handle


def _write(tmp_path, rel, size):
    p = tmp_path / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(b"\0" * size)
    return p


# --------------------------------------------------------------------------
# (a) Phase 1: the span, and nothing but the span
# --------------------------------------------------------------------------

def test_admission_raises_the_span_and_touches_no_file_priority(tmp_path):
    """The whole of phase 1, with its blast radius pinned in the same test.

    Three mutations redden this one row and each one is a shape somebody would
    actually write: admitting with `file_priority(idx, 1)` (the spec's own
    reading, and the shape C1 measured the selector undoing), admitting with
    `prioritize_files(vector)` (which also re-admits a short list's tail at
    libtorrent's default 4), and dropping the `fi.offset` term (which raises some
    other file's pieces — here the video's, which gate 4 then refuses, so the
    wrong span is caught twice over).
    """
    handle = _load(tmp_path)

    result = torrent_manager.admit_sidecar_pieces(TID, SUB)

    assert result.pieces == (4, 5), (
        "the span is computed from fi.offset // piece_length, so a sidecar at "
        "131072 with a 32 KiB piece spans pieces 4-5"
    )
    assert result.admitted == 2
    assert result.refusal is None
    assert handle.piece_priority_calls == [(4, 7), (5, 7)]
    assert handle.deadline_calls == [(4, 0), (5, 0)]
    assert handle.prioritize_files_calls == [], (
        "a changed prioritize_files vector is undone by the selector's next call "
        "and takes _prioritize_window's raised window with it (C1 [A]/[B])"
    )
    assert handle.file_priority_calls == [], (
        "admission is PIECE level; file_priority belongs to the flush alone"
    )


def test_a_piece_already_held_is_not_raised_again(tmp_path):
    """Only the unheld half of the span is raised.

    Not hygiene: `_deadline_pieces` makes the same check at `:2194`, and
    re-deadlining a piece already on disk is how a read turns into a probe that
    hijacks libtorrent's deadline queue.
    """
    handle = _load(tmp_path, have={4})

    result = torrent_manager.admit_sidecar_pieces(TID, SUB)

    assert result.admitted == 1
    assert handle.piece_priority_calls == [(5, 7)]
    assert handle.deadline_calls == [(5, 0)]


def test_admission_is_idempotent(tmp_path):
    """A second POST for the same sidecar does the same safe thing.

    The television's remote double-fires; the picker's OK press is one keyup.
    """
    handle = _load(tmp_path)

    first = torrent_manager.admit_sidecar_pieces(TID, SUB)
    second = torrent_manager.admit_sidecar_pieces(TID, SUB)

    assert first == second
    assert handle.piece_priority_calls == [(4, 7), (5, 7), (4, 7), (5, 7)]
    assert handle.file_priority_calls == []


# --------------------------------------------------------------------------
# (b) Gate 4
# --------------------------------------------------------------------------

def test_gate_4_refuses_a_piece_shared_with_a_wanted_file(tmp_path):
    """The sharpest edge in the stage, and it is a NO-OP rather than a refusal.

    On the unpadded layout the sidecar shares piece 3 with the video's last 1000
    bytes. Raising it is pointless (those bytes are already wanted) and
    retracting it is the measured catastrophe: `total_wanted` fell to residual
    -3048, the shared piece went to priority 0, and the torrent fell from
    `seeding`/100% back to `downloading`/46.78% — an unplayable episode reported
    complete. So nothing is raised, and `admitted: 0` with no refusal is the
    answer, because the POST must not tell the television it refused a sidecar
    whose bytes are already on their way.
    """
    handle = _load(tmp_path, rows=UNPADDED, prios=UNPADDED_PRIOS)

    result = torrent_manager.admit_sidecar_pieces(TID, 1)

    assert result.pieces == (3,), "the sidecar at 99304 sits inside piece 3"
    assert result.admitted == 0
    assert result.refusal is None, (
        "a shared piece is a measured no-op, not a 409: the bytes are already "
        "wanted and the television must not be told its request was refused"
    )
    assert handle.piece_priority_calls == []
    assert handle.deadline_calls == []


def test_gate_4_excludes_pad_files(tmp_path):
    """A pad at libtorrent's default priority 4 may not block an admission.

    The padded layout's second pad overlaps the sidecar's last piece, and D1's
    reason 2 measured a short `prioritize_files` list leaving exactly such a tail
    at 4. Without the pad exclusion every pad-aligned torrent — which is every
    torrent libtorrent 2.0 or qBittorrent builds by default, and every v2 or
    hybrid torrent — would answer `admitted: 0` forever, which looks identical to
    a release that ships no subtitles.
    """
    handle = _load(tmp_path)
    assert handle.priorities[3] == 4, "the fixture's pad must be at a non-zero priority"

    result = torrent_manager.admit_sidecar_pieces(TID, SUB)

    assert result.admitted == 2
    assert handle.piece_priority_calls == [(4, 7), (5, 7)]


def test_gate_4_sees_the_last_piece_of_a_multi_piece_span(tmp_path):
    """Gate 4 inspects the WHOLE span, including its last piece.

    Found in review by mutation: `span_end = last_piece * piece_length` — the
    same line with its `+ 1` dropped — left every other row in this file green.
    Both other layouts miss it, which is why `SHARED_LAST_PIECE` exists: here the
    video before the sidecar ends exactly on the span's first boundary, so the
    only thing that can refuse the admission is `Show/E02.mkv` starting inside
    piece 4, the span's last. The offender is asserted directly for that reason —
    `admitted == 0` alone cannot say WHICH file refused it.

    What the mutation would ship is the measured catastrophe: the budget exit
    would lower a piece a wanted file shares, driving `total_wanted` to residual
    -3048, de-wanting the shared piece and taking the torrent from
    `seeding`/100% back to `downloading`/46.78% — an unplayable episode reported
    complete.
    """
    handle = _load(tmp_path, rows=SHARED_LAST_PIECE, prios=SHARED_LAST_PIECE_PRIOS)

    ok, offender = torrent_manager._span_is_exclusively_deselected(
        _TI(SHARED_LAST_PIECE), list(SHARED_LAST_PIECE_PRIOS), 3, 4)
    assert (ok, offender) == (False, 2), (
        "the refusal must come from the file inside the span's LAST piece, not "
        "from the video that ends exactly on its first boundary"
    )

    result = torrent_manager.admit_sidecar_pieces(TID, 1)

    assert result.pieces == (3, 4), "a 40960-byte sidecar at 98304 spans pieces 3-4"
    assert result.admitted == 0
    assert result.refusal is None
    assert handle.piece_priority_calls == []
    assert handle.deadline_calls == []


def test_the_done_callback_never_unregisters_a_later_task(tmp_path):
    """`_forget_sidecar_fetch`'s identity check, which no other row reaches.

    Found in review by mutation: replacing it with a blind `pop` left all 28 rows
    green. The window it covers is NORMAL and not a bug — `add_done_callback`
    fires through `loop.call_soon`, so a task that already reports `done()` has a
    window in which its callback has not yet run. A second POST arriving in that
    window passes `start_sidecar_fetch`'s `not existing.done()` check and
    registers a NEW task under the same key; the first task's callback then runs,
    and a blind `pop` would unregister the live one — after which the next POST
    starts a second driver racing it to flush and re-zero the same file, which is
    the exact collision the registry exists to prevent.

    Plain sentinels, not tasks: the function compares identity and reads nothing
    else, and a real task here would need a loop to prove nothing extra.
    """
    key = (TID, SUB)
    finished, live = object(), object()
    mgr._sidecar_fetch_tasks[key] = live

    mgr._forget_sidecar_fetch(key, finished)
    assert mgr._sidecar_fetch_tasks[key] is live, (
        "the loser's done callback unregistered the winner"
    )

    mgr._forget_sidecar_fetch(key, live)
    assert key not in mgr._sidecar_fetch_tasks, "the owner's callback must drop it"


# --------------------------------------------------------------------------
# (c), (e) and the remaining gates
# --------------------------------------------------------------------------

def test_the_span_cap_refuses_a_sidecar_too_big_to_admit(tmp_path):
    """`subtitle_admit_max_pieces` forecloses the padded worst case STRUCTURALLY.

    `total_wanted` rises by only the file's bytes, but the download cost is whole
    pieces: a 20-language `Subs/` tree on a pad-aligned torrent at an 8 MiB piece
    is 1.6 GiB, so §7.5's "(kilobytes)" is wrong by four orders of magnitude. A
    kilobyte fixture cannot discriminate the cap, so this one is 40 MB.
    """
    rows = [
        ("Movie/Movie.mkv", 4 * PIECE, False),
        ("Movie/Movie.en.srt", 40 * 1024 * 1024, False),
    ]
    handle = _load(tmp_path, rows=rows, prios=[7, 0])

    result = torrent_manager.admit_sidecar_pieces(TID, 1)

    assert result.refusal == mgr.SIDECAR_REFUSAL_SPAN_TOO_LARGE
    assert result.admitted == 0
    assert handle.piece_priority_calls == []
    assert settings.subtitle_admit_max_pieces == 4, (
        "the fixture spans 1280 pieces; this assertion is here so a settings "
        "change that made the cap enormous cannot quietly make the row vacuous"
    )


def test_an_absent_torrent_admits_nothing_and_raises_nothing(tmp_path):
    """An evicted torrent is the NORMAL case, not an error.

    `_refresh_active_torrents` evicts `finished` mid-session and
    `find_loadable_on_startup` never re-adds it, so every title already in the
    library answers here. Indexing `active_torrents` directly would raise
    KeyError, which the error middleware turns into an opaque 500 on a POST the
    television made in good faith.
    """
    assert TID not in torrent_manager.active_torrents

    result = torrent_manager.admit_sidecar_pieces(TID, SUB)

    assert result == mgr.SidecarAdmission(0, (), mgr.SIDECAR_REFUSAL_NOT_LOADED)


def test_a_torrent_without_metadata_admits_nothing(tmp_path):
    """Metadata is still arriving: there is no file list to resolve an index in."""
    _load(tmp_path, metadata=False)

    result = torrent_manager.admit_sidecar_pieces(TID, SUB)

    assert result.refusal == mgr.SIDECAR_REFUSAL_NOT_LOADED


def test_a_file_already_wanted_is_refused_rather_than_admitted(tmp_path):
    """Gate 3. A file at a non-zero priority has nothing to admit.

    Its bytes are already wanted, so an admission would mean a retraction that
    DE-WANTS them — the same catastrophe gate 4 refuses, arrived at from the
    other side. Named separately from gate 4's no-op because the POST answers
    409 here and 202 there.
    """
    handle = _load(tmp_path, prios=[7, 0, 1, 4, 0])

    result = torrent_manager.admit_sidecar_pieces(TID, SUB)

    assert result.refusal == mgr.SIDECAR_REFUSAL_NOT_DESELECTED
    assert handle.piece_priority_calls == []


def test_an_index_that_is_not_a_listed_sidecar_is_refused(tmp_path):
    """NOT in the plan's list of five gates, and here on purpose.

    `{index}` is a raw integer in the URL and the flush WRITES BYTES TO DISK at a
    path taken from torrent metadata. Every gate above would pass for
    `Setup.exe`: it sits at priority 0, inside its own piece, well under the span
    cap. The route resolves through the lister (D9) so it cannot arrive today,
    but admission is the thing that fetches, and the hard-coded listed set — the
    one a `.env` can only NARROW — is the gate that makes "fetch me index 4" mean
    only what it says. Here the fixture's index 4 is `info.nfo` at priority 0.
    """
    handle = _load(tmp_path)
    assert handle.priorities[4] == 0, "the .nfo must be deselected, or another gate catches it"

    result = torrent_manager.admit_sidecar_pieces(TID, 4)

    assert result.refusal == mgr.SIDECAR_REFUSAL_NO_SUCH_SIDECAR
    assert handle.piece_priority_calls == []


def test_a_pad_file_index_is_refused(tmp_path):
    """A pad index gets the same refusal as anything else that is not a sidecar.

    CHARACTERISATION, NOT A TEST OF THE PAD-FLAG CHECK, and measured rather than
    assumed: deleting `_resolve_sidecar`'s `flag_pad_file` branch leaves this row
    GREEN, because a pad is named `.pad/<size>` and so carries no subtitle
    extension — the extension gate excludes it incidentally. That is the same
    dead mutation the plan recorded for the lister's own pad check, in its own
    words ("a pad carries no subtitle extension ... 'drop the `flag_pad_file`
    check' is a dead mutation"), and the fixture that would discriminate it —
    a pad named `something.srt` — is fiction libtorrent does not produce. The
    row is kept because `{index}` is a raw integer in the URL and a pad's index
    is a thing a client can name; the mechanism claim is not made.

    GATE 4's pad exclusion is a different check and is NOT dead — see
    `test_gate_4_excludes_pad_files`, where dropping it reddens eight rows.
    """
    _load(tmp_path)

    result = torrent_manager.admit_sidecar_pieces(TID, 3)

    assert result.refusal == mgr.SIDECAR_REFUSAL_NO_SUCH_SIDECAR


def test_an_out_of_range_index_is_refused(tmp_path):
    """Also a characterisation. Measured: deleting the explicit bound check
    leaves this row green, because `_TI.file_at(99)` raises and the `except`
    answers the same refusal, while `file_at(-1)` returns the last row — whose
    extension is not a subtitle. The bound check stays because a real
    `lt.file_storage.file_at` out of range is not required to raise anything in
    particular, and because `idx >= len(priorities)` is what keeps the later
    `priorities[index]` read from an IndexError.
    """
    _load(tmp_path)

    assert torrent_manager.admit_sidecar_pieces(TID, 99).refusal == \
        mgr.SIDECAR_REFUSAL_NO_SUCH_SIDECAR
    assert torrent_manager.admit_sidecar_pieces(TID, -1).refusal == \
        mgr.SIDECAR_REFUSAL_NO_SUCH_SIDECAR


# --------------------------------------------------------------------------
# (a2) The flush
# --------------------------------------------------------------------------

def test_the_flush_is_exactly_one_then_zero_on_the_sidecars_own_index(tmp_path):
    """C1's own row: the flush is `file_priority(idx, 1)` then `file_priority(idx, 0)`.

    NEVER 7 — that is `prioritize_video_files`' own video value and would put a
    40 KB text file in competition with the playhead — and never left at 1,
    because the selector's next call would then be a CHANGED list, which
    recomputes and takes `_prioritize_window`'s raised window with it. The
    trailing re-zero is asserted on the path where the file never arrives,
    because that is the path where an implementation that re-zeroed only on
    success would be wrong.
    """
    handle = _load(tmp_path, have=True)

    landed = torrent_manager.flush_sidecar_file(TID, SUB, wait_s=0.05)

    assert landed is False, "nothing was written to the save path"
    assert handle.file_priority_calls == [(SUB, 1), (SUB, 0)]
    assert handle.piece_priority_calls == [], "the flush raises no piece"
    assert handle.prioritize_files_calls == []


def test_the_flush_reports_the_file_landing_at_its_declared_size(tmp_path):
    """The success case: the bytes left the part file and are readable."""
    _write(tmp_path, "Show.S01/Subs/E01.en.srt", 40960)
    handle = _load(tmp_path, have=True)

    assert torrent_manager.flush_sidecar_file(TID, SUB, wait_s=0.05) is True
    assert handle.file_priority_calls == [(SUB, 1), (SUB, 0)]


def test_a_short_file_is_not_a_landed_file(tmp_path):
    """Sparse storage means a partial file can already report its full length.

    Stage 7's gate 3 (`manager.py:1375-1391`, the `on_disk != match["size"]`
    arm) exists for exactly this: libtorrent
    writes at offsets, so a half-written file has holes that read back as zeros.
    A flush that tested only `os.path.exists` would hand the `<track>` a
    truncated cue list.
    """
    _write(tmp_path, "Show.S01/Subs/E01.en.srt", 40959)
    _load(tmp_path, have=True)

    assert torrent_manager.flush_sidecar_file(TID, SUB, wait_s=0.05) is False


def test_the_flush_refuses_before_the_span_is_held(tmp_path):
    """The precondition that keeps a file-level admission from wearing a flush's name.

    `file_priority(idx, 1)` on an UNHELD span is exactly the admission shape C1
    measured as broken: the selector's next call undoes it and takes the
    playhead's raised window with it. The flush may only ever move bytes that are
    already here.
    """
    handle = _load(tmp_path, have={4})

    assert torrent_manager.flush_sidecar_file(TID, SUB, wait_s=0.05) is False
    assert handle.file_priority_calls == [], (
        "a flush before the span is held is a file-level admission"
    )


def test_the_flush_refuses_a_file_that_is_not_deselected(tmp_path):
    """Already at a non-zero priority: either genuinely wanted, or mid-flush.

    Without this, a second flush racing the first would re-zero a file the first
    one had just raised, and the bytes would stop moving half way.
    """
    handle = _load(tmp_path, prios=[7, 0, 1, 4, 0], have=True)

    assert torrent_manager.flush_sidecar_file(TID, SUB, wait_s=0.05) is False
    assert handle.file_priority_calls == []


def test_the_flush_is_a_no_op_off_session(tmp_path):
    assert torrent_manager.flush_sidecar_file(TID, SUB, wait_s=0.05) is False


# --------------------------------------------------------------------------
# (f) The two retraction exits
# --------------------------------------------------------------------------

def test_the_success_exit_resets_deadlines_and_lowers_nothing(tmp_path):
    """(f1) The exit taken after a flush, and it must not lower a thing.

    The pieces are held, so libtorrent has already dropped their raised priority
    (measured: two probe runs sampled held pieces and both cells were void) and
    the flush has already put the file priority back to 0. Using the
    budget-expiry call here is the measured catastrophe — residual -3048, the
    shared piece de-wanted, the torrent back from `seeding`/100% to
    `downloading`/46.78%.

    Gate 4 PASSES on this fixture, which is what makes the deadline reset below
    an instrument for the reset itself rather than for the gate: a production
    change that skipped the reset on this exit reddens this row (measured).
    """
    handle = _load(tmp_path, have=True)

    lowered = torrent_manager.retract_sidecar_pieces(TID, SUB, expired=False)

    assert lowered == 0
    assert handle.reset_deadline_calls == [4, 5]
    assert handle.piece_priority_calls == [], (
        "piece_priority(p, 0) on the success path de-wants bytes a wanted file "
        "may share — the one call in stage 9 that can mark an unplayable episode "
        "complete"
    )
    assert handle.file_priority_calls == []


def test_the_budget_exit_lowers_the_span_after_rechecking_gate_4(tmp_path):
    """(f2) The dangerous exit. An admission nobody can finish must be withdrawn.

    The span is not held, so there is nothing to flush, and leaving the pieces
    raised holds the torrent below 100% forever: `downloading` is in
    `ACTIVE_DOWNLOAD_STATES` so one of the Pi's two slots stays held, the nav
    badge never clears, `torrent_finished_alert` never fires, and
    `get_completed_video_file_info`'s gate 2 (`progress < 100`) takes away the
    only path that serves the title after a restart.
    """
    handle = _load(tmp_path, have=False)

    lowered = torrent_manager.retract_sidecar_pieces(TID, SUB, expired=True)

    assert lowered == 2
    assert handle.reset_deadline_calls == [4, 5]
    assert handle.piece_priority_calls == [(4, 0), (5, 0)]


def test_the_budget_exit_lowers_nothing_when_the_file_became_wanted_underneath(tmp_path):
    """(f2, second half) Gate 4 is RE-CHECKED, and a refusal is a TRUE no-op.

    The span's composition can change under an in-flight admission:
    `_prioritize_window` raises a 32-piece window from the playhead, which near
    the end of a file spills into the next file's pieces, and its backward-seek
    branch sets `piece_priority(p, 1)` — "low, not zero (still wanted)" — and is
    re-asserted per chunk. Here the sidecar's own file priority has risen to 7
    underneath, so lowering its pieces would de-want bytes the session now wants.

    **This row's `reset_deadline_calls` used to be `[4, 5]`, on the claim that
    "resetting a deadline is always safe". It is not, and that assertion pinned
    the bug** (task 7 review, finding 5). Gate 4 has just said the span's bytes
    belong to a file somebody else wants, and a deadline on such a piece is
    quite possibly the PLAYHEAD's own: `_deadline_pieces` sets
    `set_piece_deadline(p, 0)` across `[first_piece, last_piece]` plus
    `read_ahead=4`, from `wait_for_first_chunk` and from `stream_file_range` on
    every ranged `GET /video`, and on an unpadded torrent that read-ahead reaches
    past the video's last piece into the sidecar's own span. So gate 4 now runs
    BEFORE the reset and a refusal touches nothing whatsoever. The effect of the
    old shape was bounded — the streaming path re-asserts its deadlines per
    chunk — but it was an untested de-prioritisation of the television's main
    content inside a call documented as doing nothing.
    """
    handle = _load(tmp_path, prios=[7, 0, 7, 4, 0], have=False)

    lowered = torrent_manager.retract_sidecar_pieces(TID, SUB, expired=True)

    assert lowered == 0
    assert handle.reset_deadline_calls == [], (
        "a gate-4 refusal must not clear deadlines on a span gate 4 has just "
        "declared off-limits — those are the pieces _deadline_pieces gives the "
        "playhead, and this call has no admission of its own to withdraw"
    )
    assert handle.piece_priority_calls == []


def test_the_success_exit_is_also_a_true_no_op_when_gate_4_refuses(tmp_path):
    """(f1, second half) ONE rule, not two: gate 4 guards BOTH exits.

    This is the gate-4 no-op reaching the SUCCESS exit, and it is the reachable
    production path rather than a contrived one. On `SHARED_LAST_PIECE` the
    sidecar's span is shared with a WANTED video (`Show/E02.mkv` starts inside
    piece 4), so `admit_sidecar_pieces` raises nothing and reports
    `admitted: 0` with no refusal — but `start_sidecar_fetch` still starts a
    driver, the shared pieces arrive anyway because the video wants them, the
    flush lands the file, and the driver's `finally` arrives here with
    `expired=False`. Nothing in that sequence is ours to undo.

    Without this row, "gate 4 is re-checked on both exits" is unfalsifiable: a
    production change that ran the gate only inside the `if expired` branch
    would leave every other row in this file green (measured).
    """
    handle = _load(tmp_path, rows=SHARED_LAST_PIECE,
                   prios=SHARED_LAST_PIECE_PRIOS, have=True)

    lowered = torrent_manager.retract_sidecar_pieces(TID, 1, expired=False)

    assert lowered == 0
    assert handle.reset_deadline_calls == [], (
        "piece 4 belongs to a wanted video too, and the deadline on it may be "
        "the playhead's own"
    )
    assert handle.piece_priority_calls == []
    assert handle.file_priority_calls == []


def test_both_retraction_exits_are_idempotent(tmp_path):
    """(f3) Called twice, each exit does the same thing twice and nothing else.

    The driver retracts in a `finally`, and a cancelled task can reach it after
    another path already has. What must never happen is a second call taking the
    OTHER exit's shape.
    """
    handle = _load(tmp_path, have=True)
    torrent_manager.retract_sidecar_pieces(TID, SUB, expired=False)
    torrent_manager.retract_sidecar_pieces(TID, SUB, expired=False)
    assert handle.reset_deadline_calls == [4, 5, 4, 5]
    assert handle.piece_priority_calls == []

    expired = _Handle(_TI(PADDED), tmp_path, PADDED_PRIOS, have=False)
    torrent_manager.active_torrents[TID] = (expired, {})
    assert torrent_manager.retract_sidecar_pieces(TID, SUB, expired=True) == 2
    assert torrent_manager.retract_sidecar_pieces(TID, SUB, expired=True) == 2
    assert expired.reset_deadline_calls == [4, 5, 4, 5]
    assert expired.piece_priority_calls == [(4, 0), (5, 0), (4, 0), (5, 0)]
    assert 7 not in [p for _piece, p in expired.piece_priority_calls]


def test_retraction_is_a_no_op_off_session(tmp_path):
    assert torrent_manager.retract_sidecar_pieces(TID, SUB, expired=True) == 0
    assert torrent_manager.retract_sidecar_pieces(TID, SUB, expired=False) == 0


# --------------------------------------------------------------------------
# (g) The driver and its registry
# --------------------------------------------------------------------------

def _with_loop(coro_fn):
    """Run `coro_fn` with the manager's `_loop` pointed at the running loop.

    `_register_piece_waiter` builds its Futures on `self._loop`, which
    `start_update_task` sets in production and nothing sets in a test. The house
    idiom for this area is `asyncio.run` inside a sync test
    (`test_await_pieces_async.py`, `test_first_chunk_precheck.py`), not an
    asyncio marker.
    """
    async def _runner():
        previous = torrent_manager._loop
        torrent_manager._loop = asyncio.get_running_loop()
        try:
            return await coro_fn()
        finally:
            torrent_manager._loop = previous
            torrent_manager._piece_waiters.pop(TID, None)

    return asyncio.run(_runner())


def test_two_fetches_for_one_sidecar_create_one_task(tmp_path):
    """(g) One driver per `(torrent_id, index)`.

    A TV remote's OK press double-fires, and two drivers racing to flush and
    retract the same file would have one re-zeroing the file priority the other
    had just raised. The assertion is TASK IDENTITY and not registry size: a
    registry that was written to but never read would keep exactly one entry
    while leaking an orphan task on every press.
    """
    _load(tmp_path, have=False)
    key = (TID, SUB)

    async def _body():
        first = torrent_manager.start_sidecar_fetch(TID, SUB, budget_ms=5000)
        assert first.refusal is None
        task = mgr._sidecar_fetch_tasks[key]

        second = torrent_manager.start_sidecar_fetch(TID, SUB, budget_ms=5000)
        assert second.refusal is None
        assert mgr._sidecar_fetch_tasks[key] is task, "a second task was created"
        assert len(mgr._sidecar_fetch_tasks) == 1

        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass
        await asyncio.sleep(0)
        assert key not in mgr._sidecar_fetch_tasks, (
            "the done callback must drop the key, or the first fetch for a "
            "sidecar is the only one this process ever runs"
        )

    _with_loop(_body)


def test_the_driver_waits_flushes_and_takes_the_success_exit(tmp_path):
    """The four steps, in order, on the happy path.

    The span is already held and the file is on disk, so the wait returns
    immediately, the flush moves it, and the retraction is deadlines-only.
    """
    _write(tmp_path, "Show.S01/Subs/E01.en.srt", 40960)
    handle = _load(tmp_path, have=True)

    async def _body():
        result = torrent_manager.start_sidecar_fetch(TID, SUB, budget_ms=5000)
        assert result.refusal is None
        await mgr._sidecar_fetch_tasks[(TID, SUB)]

    _with_loop(_body)

    assert handle.file_priority_calls == [(SUB, 1), (SUB, 0)], "the flush ran once"
    assert handle.piece_priority_calls == [], (
        "every piece was already held, so nothing was raised — and the success "
        "exit lowers nothing"
    )
    assert handle.reset_deadline_calls == [4, 5]


def test_the_driver_takes_the_budget_exit_when_the_span_never_arrives(tmp_path):
    """The exit that keeps a dead admission from stranding the torrent.

    50 ms of budget rather than 45 s: the value is `settings`-driven and the
    row is about which exit the driver takes, not how long it waits.
    """
    handle = _load(tmp_path, have=False)

    async def _body():
        torrent_manager.start_sidecar_fetch(TID, SUB, budget_ms=50)
        await mgr._sidecar_fetch_tasks[(TID, SUB)]

    _with_loop(_body)

    assert handle.piece_priority_calls == [(4, 7), (5, 7), (4, 0), (5, 0)], (
        "admitted, then withdrawn: leaving the pieces raised holds the torrent "
        "below 100% forever"
    )
    assert handle.file_priority_calls == [], "nothing was held, so nothing to flush"
    assert handle.reset_deadline_calls == [4, 5]


def test_a_refused_admission_starts_no_driver(tmp_path):
    """A 409 must not leave a task behind waiting for pieces nobody raised."""
    _load(tmp_path, prios=[7, 0, 1, 4, 0], have=False)

    async def _body():
        result = torrent_manager.start_sidecar_fetch(TID, SUB, budget_ms=5000)
        assert result.refusal == mgr.SIDECAR_REFUSAL_NOT_DESELECTED
        assert mgr._sidecar_fetch_tasks == {}

    _with_loop(_body)


def test_a_fetch_with_no_running_loop_withdraws_its_own_admission(tmp_path):
    """No loop, no driver — so the admission is withdrawn on the spot.

    Unreachable from the POST handler, which is async. It exists because the
    alternative is the worst failure in the stage: pieces raised with nothing to
    retract them hold the torrent below 100% forever.
    """
    handle = _load(tmp_path, have=False)

    result = torrent_manager.start_sidecar_fetch(TID, SUB, budget_ms=5000)

    assert result.refusal == mgr.SIDECAR_REFUSAL_NO_DRIVER
    assert mgr._sidecar_fetch_tasks == {}
    assert handle.piece_priority_calls == [(4, 7), (5, 7), (4, 0), (5, 0)], (
        "the admission must not outlive the request that made it"
    )
