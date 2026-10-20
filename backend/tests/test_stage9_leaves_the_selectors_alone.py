"""Stage 9's zero-touch gates: nothing in this stage may re-shape a file-priority vector.

Both existing file-priority selectors are shared with the web player and with
`/torrents/{id}/prioritize`, and plan D1 measured four reasons to touch neither:

* a CHANGED `prioritize_files` list (or a `file_priority` call) recomputes the whole
  torrent's piece priorities and wipes `_prioritize_window`'s raised window;
* a SHORT list re-admits the tail at libtorrent's default 4 instead of deselecting it;
* a widened wanted set whose bytes never arrive holds the torrent below 100% forever,
  which costs the television `get_completed_video_file_info`'s gate 2
  (`manager.py:1250`) — i.e. it trades subtitles for the main content;
* the marginal cost is `extra_pieces x piece_length`, not "(kilobytes)".

**Correction C1 changed the shape of one gate, and this file is written to it.** A fake
that REFUSED `file_priority` would forbid stage 9's own code: `piece_priority(p, 7)`
alone leaves the bytes in libtorrent 2.0's `.<infohash>.parts` part file, which nothing
can read, so the second phase is a flush — one `file_priority(idx, 1)` once the span is
held, then `file_priority(idx, 0)` to put it back. So the gate RECORDS `file_priority`
and pins the recorded set to exactly `[(idx, 1), (idx, 0)]`: one index, two priorities,
in that order, and never 7. That is a stronger gate than a ban, because it pins the
flush's shape as well as its blast radius.

`test_skip_non_video.py:31` is the other half of the gate and is deliberately NOT
duplicated here: it already pins `[1, 0, 0, 0]` for a fixture naming `subs.srt` at index
3, so a stage that widened `skip_non_video_files` reddens there. A second witness to one
rule is this repo's own documented anti-pattern. The done-check for this task is
`git diff --quiet backend/tests/test_skip_non_video.py`.
"""
import ast
import types
from pathlib import Path

import pytest

import app
import app.torrent.manager as mgr

APP_DIR = Path(app.__file__).resolve().parent


# ---------------------------------------------------------------- source-text gates

def _code_text(path: Path) -> str:
    """The file's CODE, with comments and docstrings removed.

    `app/subtitles/__init__.py`'s own docstring names all three forbidden calls in order
    to say that nothing there may make them — a good thing to write, and a raw substring
    scan would redden on it. Parsing and re-unparsing drops comments (they are not AST
    nodes) and every docstring-position string expression, leaving the executable text.

    KNOWN LIMIT, same shape as `legacy-target.test.ts:91-96` records for its own scan:
    a name assembled at runtime is invisible. `getattr(handle, 'prioritize' + '_files')`
    walks straight past this, and so does a name arriving through a variable. Not chased
    — defeating that needs a real evaluator, and the gate's job is to stop the spellings
    an author actually writes, not to resist deliberate evasion. Measured, with a probe
    module carrying both forms: `getattr(handle, 'prioritize_files')(prios)` IS caught,
    because a literal survives unparse and that pattern is a bare name; `getattr(h,
    "file_" "priority")(idx, 1)` IS caught too, because adjacent string literals are one
    `Constant` and unparse emits `'file_priority'`; the plan's spelling of that forbidden
    name carried a trailing `(`, which missed both that and a bound-method alias
    (`cb = handle.file_priority; cb(idx, 0)`) — measured in review, and dropped. What the
    scan still CANNOT see is a name built from non-adjacent pieces or arriving in a
    variable. It can also false-positive on an assigned string or f-string naming a
    forbidden call, because only docstring-position strings are stripped; spell such a
    message without the call's name. This is also why plan D2 makes admission a POST — structural
    unreachability from a `<track>` is a guarantee no source scan can give — and why the
    recorder gate below, which watches calls rather than text, is the primary instrument.
    """
    tree = ast.parse(path.read_text(), filename=str(path))
    for node in ast.walk(tree):
        body = getattr(node, "body", None)
        if isinstance(body, list):
            node.body = [
                stmt for stmt in body
                if not (
                    isinstance(stmt, ast.Expr)
                    and isinstance(stmt.value, ast.Constant)
                    and isinstance(stmt.value.value, str)
                )
            ] or [ast.Pass()]
    return ast.unparse(tree)


def _offences(path: Path, forbidden) -> list:
    code = _code_text(path)
    return [name for name in forbidden if name in code]


# The package's own rule: nothing under app/subtitles/ re-shapes priorities at all.
# Piece admission and the flush live on TorrentManager (task 7), not here.
# No trailing `(` on `file_priority`: measured in review, the paren missed both
# `getattr(h, "file_" "priority")(idx, 1)` and `cb = handle.file_priority`, and it
# buys nothing — `get_file_priorities` does not contain the bare name.
_PACKAGE_FORBIDDEN = ("prioritize_files", "prioritize_video_files", "file_priority")

# Per-module rules for files that later tasks create. Each is SKIPPED (visibly, with the
# task named) until its file exists, and goes live by itself the moment it does.
_MODULE_FORBIDDEN = [
    # The lister is a read. A GET that re-deadlines pieces hijacks libtorrent's deadline
    # queue (plan D2), and a lister that flushed would make the read mutating.
    ("subtitles/sidecars.py", ("piece_priority", "set_piece_deadline"), "task 3"),
    # The list and VTT handlers answer from metadata and from disk. Neither may lean on
    # the streaming path's own machinery.
    ("api/subtitles.py", ("prioritize_video_files", "force_start_for_stream"), "tasks 8-9"),
]


def test_nothing_in_the_subtitles_package_reshapes_file_priorities():
    scanned = sorted((APP_DIR / "subtitles").rglob("*.py"))
    # Non-vacuity first, and in this test rather than in a second one of its own: a gate
    # that scans an empty file list passes forever, and the glob grows by itself as
    # tasks 3-6 land their modules. Same reflex as the recorder-non-empty assertions in
    # `test_prioritize_video_files_list.py`.
    assert scanned, "app/subtitles/ has no Python files — this gate measured nothing"
    offences = {
        str(p.relative_to(APP_DIR)): _offences(p, _PACKAGE_FORBIDDEN)
        for p in scanned
    }
    offences = {k: v for k, v in offences.items() if v}
    assert not offences, (
        f"app/subtitles/ may not re-shape file priorities (plan D1/C1): {offences}. "
        f"Piece admission and the flush belong on TorrentManager."
    )


@pytest.mark.parametrize("rel,forbidden,owner", _MODULE_FORBIDDEN,
                         ids=[m[0] for m in _MODULE_FORBIDDEN])
def test_module_level_forbidden_calls(rel, forbidden, owner):
    path = APP_DIR / rel
    if not path.exists():
        pytest.skip(f"app/{rel} lands in {owner}; this gate goes live with the file")
    offences = _offences(path, forbidden)
    assert not offences, f"app/{rel} may not name {offences} (plan D1/D2)"


# ------------------------------------------------- the forbidden-call / flush-shape gate

class _ForbiddenCall(BaseException):
    """Raised by the fake's `prioritize_files`.

    `BaseException` on purpose. Every libtorrent call in `manager.py` is individually
    wrapped in `except Exception: pass` (`_deadline_pieces` at `:2249-2255` is the idiom
    task 7 copies), so an `Exception` raised here would be SWALLOWED by the code under
    test. Measured against a stand-in that did exactly that: with `BaseException` the
    raise escapes and names the offence; with `Exception` the raise is swallowed and the
    `prioritize_files_calls == []` assertion below catches it instead. The two are
    INDEPENDENTLY SUFFICIENT, which is why both are kept — the raise gives the better
    message, the recorder is the one that cannot be swallowed.
    """


TID = "t-stage9-gate"

# FOUR files, and the sidecar under test is index 2. Every term of that is a
# measurement, because the two-file fixture this replaced could not see an
# argument swap (task 1 review findings 5/6):
#
# * `SUB_INDEX != 1` and `!= 0`, i.e. the index differs from BOTH priorities the
#   flush passes, so the asserted `(index, priority)` tuples are not degenerate.
#   Measured on the old `SUB_INDEX = 1` fixture: swapping the arguments of the
#   flush's raising call (`file_priority(1, idx)`) left all 4 rows GREEN, because
#   `(1, 1)` is its own transpose.
# * MID-torrent — neither the first file nor the last. Measured on the old
#   fixture, where the sidecar was last: hard-coding the flushed index to
#   `num_files() - 1` left all 4 rows GREEN, so "the flush touches the sidecar's
#   own index" and "the flush touches the last index" were the same claim.
# * A NON-ZERO, piece-UNALIGNED offset, so a dropped `fi.offset` term computes
#   some other file's pieces. This is also the shape task 7's own mutate list
#   demands, and the 20000-byte sidecar in front of it is what makes that offset
#   unaligned rather than a multiple of the piece length.
#
# The video stays OUT of the sidecar's span on purpose — it is the one file at a
# non-zero priority, so a span touching it is gate 4's refusal rather than an
# admission. 8 MiB at a 32 KiB piece ends exactly on a piece boundary, which is
# what keeps it clear. NOTHING IN THIS FILE WOULD NOTICE IF IT DID NOT, and that
# is measured rather than assumed: with `SIZES[0]` a thousand bytes longer, so
# the film reaches into piece 256, gate 4 refuses and all 5 rows stay GREEN —
# because a gate-4 refusal is a measured NO-OP reported as `admitted == 0` with
# NO refusal reason (C1), and the flush, which has no gate 4, still records its
# two calls. Gate 4's own row lives in `test_sidecar_admission.py`, where it
# belongs; this comment is here so the next reader does not mistake this gate
# for a second witness to it.
SUB_INDEX = 2


class _GateTI:
    """A realistic four-file release: the film, two sidecars and a release note.

    Layout, with a 32 KiB piece (offsets are cumulative, as `file_at` computes):

        idx 0  Show.S01E01/E01.mkv            8 MiB   offset 0          pieces 0-255
        idx 1  Show.S01E01/Subs/E01.fr.srt    20000 B offset 8388608    piece  256
        idx 2  Show.S01E01/Subs/E01.en.srt    40960 B offset 8408608    pieces 256-257
        idx 3  Show.S01E01/RARBG.txt          1024 B  offset 8449568    piece  257

    So the sidecar under test spans two pieces (inside
    `subtitle_admit_max_pieces`), starts at an offset that is neither zero nor a
    multiple of the piece length, shares its first piece with another
    priority-0 file and its last with a third, and the only file at a non-zero
    priority (the film) is clear of the span. See the SUB_INDEX comment above
    for which mutation each of those properties exists to redden.
    """

    PATHS = [
        "Show.S01E01/E01.mkv",
        "Show.S01E01/Subs/E01.fr.srt",
        "Show.S01E01/Subs/E01.en.srt",
        "Show.S01E01/RARBG.txt",
    ]
    SIZES = [8 * 1024 * 1024, 20000, 40 * 1024, 1024]
    PIECE_LENGTH = 32 * 1024

    def num_files(self):
        return len(self.PATHS)

    def file_at(self, i):
        offset = sum(self.SIZES[:i])
        return types.SimpleNamespace(path=self.PATHS[i], size=self.SIZES[i], offset=offset)

    def piece_length(self):
        return self.PIECE_LENGTH

    def total_size(self):
        return sum(self.SIZES)

    def files(self):
        return types.SimpleNamespace(file_flags=lambda i: 0, file_path=lambda i: self.PATHS[i])


class _GateHandle:
    """Records every priority-shaped call; refuses the two that are bans."""

    def __init__(self, save_path):
        self._ti = _GateTI()
        self.save_path = save_path
        self.prioritize_files_calls = []
        self.file_priority_calls = []
        self.piece_priority_calls = []
        self.deadline_calls = []
        self.reset_deadline_calls = []

    def has_metadata(self):
        return True

    def get_torrent_info(self):
        return self._ti

    def prioritize_files(self, prios):
        self.prioritize_files_calls.append(list(prios))
        raise _ForbiddenCall(
            "prioritize_files is forbidden to stage 9: a changed vector is undone by "
            "prioritize_video_files' next call and takes _prioritize_window's raised "
            "window with it (C1 [A]/[B])"
        )

    def file_priority(self, index, priority):
        self.file_priority_calls.append((index, priority))

    def get_file_priorities(self):
        # The film is wanted; both sidecars and the release note are deselected,
        # which is what `prioritize_video_files` leaves behind (and what gate 3
        # and gate 4 both read).
        return [7, 0, 0, 0]

    def piece_priority(self, piece, priority):
        self.piece_priority_calls.append((piece, priority))

    def set_piece_deadline(self, piece, deadline):
        self.deadline_calls.append((piece, deadline))

    def reset_piece_deadline(self, piece):
        self.reset_deadline_calls.append(piece)

    def have_piece(self, piece):
        # The span is held: the flush's own precondition is satisfied, so a correct
        # implementation reaches `file_priority(idx, 1)`.
        return True

    def file_progress(self):
        return list(self._ti.SIZES)

    def status(self):
        return types.SimpleNamespace(save_path=str(self.save_path))


_ADMISSION_API = ("list_sidecars", "admit_sidecar_pieces", "flush_sidecar_file")


def _missing_admission_api():
    return [n for n in _ADMISSION_API if not hasattr(mgr.TorrentManager, n)]


@pytest.mark.skipif(
    bool(_missing_admission_api()),
    reason=(
        f"TorrentManager.{{{','.join(_ADMISSION_API)}}} land in plan tasks 3 and 7 "
        f"(missing: {_missing_admission_api()}); this gate goes live with them, and its "
        f"skip is the visible record that it has not run yet. Task 1 adds no app/ file, "
        f"so the four mutations below were measured against temporary stand-in "
        f"implementations and recorded in the commit message."
    ),
)
def test_admission_and_flush_make_exactly_two_file_priority_calls(tmp_path, monkeypatch):
    """The whole stage's blast radius on file priorities, in one assertion.

    `prioritize_files` raises; `file_priority` records. Both arms matter: the raise
    catches the admission shape C1 measured as broken, and the recorded set pins the
    flush — one index, 1 then 0, never 7. 7 is `prioritize_video_files`' own video value
    and would put a 40 KB text file in competition with the playhead; leaving the
    priority at 1 would make the selector's next call a CHANGED list, which recomputes
    and takes `_prioritize_window`'s raised window with it.
    """
    monkeypatch.setattr(mgr, "get_db", _no_db)
    handle = _GateHandle(tmp_path)
    inst = mgr.TorrentManager.__new__(mgr.TorrentManager)
    inst.active_torrents = {TID: (handle, {})}
    inst._contiguous_runs = {}
    inst._resume_video_files = {}

    inst.list_sidecars(TID)
    admission = inst.admit_sidecar_pieces(TID, SUB_INDEX)
    inst.flush_sidecar_file(TID, SUB_INDEX)

    # Non-vacuity for the ADMISSION arm, and new with the four-file fixture: an
    # admission that bailed at a gate makes no priority call of any kind, so
    # "it called neither" would pass on a fixture the widening had broken. The
    # refusal reason is the one thing that distinguishes the two. Its reach is
    # measured and partial: gates 1, 2, 3 and 5 name a reason here (`SUB_INDEX`
    # out of the file list reddens it with `no-such-sidecar`, a non-zero priority
    # on the sidecar with `not-deselected`), while GATE 4 does not, because its
    # refusal is C1's measured no-op and carries no reason at all. See the
    # SUB_INDEX comment above for that measurement.
    assert admission.refusal is None, (
        f"the fixture tripped an admission gate ({admission.refusal}), so the two "
        f"assertions below would hold for a reason that has nothing to do with "
        f"stage 9's blast radius"
    )
    assert handle.prioritize_files_calls == [], (
        "stage 9 re-shaped a whole file-priority vector — see plan D1"
    )
    assert handle.file_priority_calls == [(SUB_INDEX, 1), (SUB_INDEX, 0)], (
        "the flush is exactly file_priority(idx, 1) then file_priority(idx, 0) on the "
        "ONE sidecar index (C1 phase 2)"
    )


def test_the_gate_fixture_can_see_an_argument_swap():
    """Non-degeneracy of the fixture itself, in its own row rather than trusted.

    THE MUTATION THIS ROW ANSWERS IS A FIXTURE EDIT, not a production change, and
    that is exactly why it is here: the fixture is the only thing that gives the
    assertion above its discriminating power, and nothing else in the file would
    notice it being weakened. Measured on the two-file `SUB_INDEX = 1` fixture
    this replaced, which is the review finding that produced this row: swapping
    the arguments of the flush's raising call (`file_priority(1, idx)`) left all
    4 rows GREEN, because `(1, 1)` is its own transpose; hard-coding the flushed
    index to `num_files() - 1` left all 4 rows GREEN, because the sidecar WAS the
    last file. Only the third of the three, hard-coding the index to 0, reddened
    there.

    Measured both arms of this row too: `SUB_INDEX = 1`, `SUB_INDEX = 0`, a
    `SUB_INDEX` at the last file and a piece-ALIGNED sidecar offset each redden
    exactly one of the assertions below.
    """
    ti = _GateTI()
    assert ti.num_files() >= 3, "a mid-torrent index needs at least three files"
    assert SUB_INDEX not in (0, 1), (
        "the sidecar's index must differ from BOTH priorities the flush passes "
        "(1, then 0), or an asserted (index, priority) tuple cannot see a swap"
    )
    assert 0 < SUB_INDEX < ti.num_files() - 1, (
        "the sidecar must be neither the first file nor the last, or 'the flush "
        "touches the sidecar's index' and 'the flush touches index 0 / the last "
        "index' are the same claim"
    )
    fi = ti.file_at(SUB_INDEX)
    assert fi.offset > 0, "a sidecar at offset 0 cannot discriminate a dropped offset"
    # Not a mutation of THIS file — the span arithmetic lives in task 7 and its
    # own suite mutates it. This clause pins the layout the class docstring
    # describes, so a later size edit cannot quietly align the sidecar to a piece
    # boundary and leave that paragraph a claim with nothing behind it.
    assert fi.offset % ti.piece_length() != 0, (
        "the sidecar's offset must not be a multiple of the piece length"
    )


def _no_db():
    """A `get_db()` stand-in for paths that may touch the DB. Nothing in this gate needs
    a row, and the one-off container's `get_db` talks to the real dev Postgres."""
    import contextlib

    @contextlib.contextmanager
    def _cm():
        yield types.SimpleNamespace(
            query=lambda *a, **k: types.SimpleNamespace(
                filter=lambda *a, **k: types.SimpleNamespace(first=lambda: None)
            ),
            commit=lambda: None,
            add=lambda *a, **k: None,
        )

    return _cm()
