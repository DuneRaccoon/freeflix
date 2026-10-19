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

    KNOWN LIMIT, same shape as `legacy-target.test.ts:98-103` records for its own scan:
    a name assembled at runtime is invisible. `getattr(handle, 'prioritize' + '_files')`
    walks straight past this, and so does a name arriving through a variable. Not chased
    — defeating that needs a real evaluator, and the gate's job is to stop the spellings
    an author actually writes, not to resist deliberate evasion. Measured, with a probe
    module carrying both forms: `getattr(handle, 'prioritize_files')(prios)` IS caught,
    because a literal survives unparse and that pattern is a bare name; `getattr(h,
    "file_" "priority")(idx, 1)` is NOT, because the plan's spelling of that one carries
    a trailing `(`. This is also why plan D2 makes admission a POST — structural
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
_PACKAGE_FORBIDDEN = ("prioritize_files", "prioritize_video_files", "file_priority(")

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
    wrapped in `except Exception: pass` (`_deadline_pieces` at `:1933-1939` is the idiom
    task 7 copies), so an `Exception` raised here would be SWALLOWED by the code under
    test. Measured against a stand-in that did exactly that: with `BaseException` the
    raise escapes and names the offence; with `Exception` the raise is swallowed and the
    `prioritize_files_calls == []` assertion below catches it instead. The two are
    INDEPENDENTLY SUFFICIENT, which is why both are kept — the raise gives the better
    message, the recorder is the one that cannot be swallowed.
    """


TID = "t-stage9-gate"
SUB_INDEX = 1


class _GateTI:
    """Two files: a video at index 0 and a sidecar at index 1, the sidecar at a NON-ZERO
    offset so a dropped `fi.offset` term computes the wrong span."""

    PATHS = ["Show.S01E01/E01.mkv", "Show.S01E01/Subs/E01.en.srt"]
    SIZES = [8 * 1024 * 1024, 40 * 1024]
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
        return [7, 0]

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
    inst.admit_sidecar_pieces(TID, SUB_INDEX)
    inst.flush_sidecar_file(TID, SUB_INDEX)

    assert handle.prioritize_files_calls == [], (
        "stage 9 re-shaped a whole file-priority vector — see plan D1"
    )
    assert handle.file_priority_calls == [(SUB_INDEX, 1), (SUB_INDEX, 0)], (
        "the flush is exactly file_priority(idx, 1) then file_priority(idx, 0) on the "
        "ONE sidecar index (C1 phase 2)"
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
