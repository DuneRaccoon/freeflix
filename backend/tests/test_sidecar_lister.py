"""`TorrentManager.list_sidecars`: live session only, readiness measured, emptiness
unambiguous.

Four properties are as load-bearing as the rows themselves, and each one is here
because the obvious implementation gets it wrong in a way no green run would show.

* **The envelope carries `coverage`, never a bare list.** `/files` already answers
  `200 []` with three meanings and this suite records in its own words that it
  "means 'not ready, or evicted' and never 'this pack has no episodes'"
  (`test_finished_torrent_streamable.py:226-230`) — RECORDED, NOT FIXED. A fourth
  bare empty list would inherit a meaning this repo has already declared unusable,
  and the television renders the three differently: `unavailable` for an evicted
  torrent, `none` for a release that ships no `.srt`, a picker for the rest.
* **The index is the torrent's own.** `?file_index=` is a libtorrent file index
  (`api/streaming.py:256`) and a filtered position renumbers. Measured in the
  design round: `lt.create_torrent` interleaved `.pad/N` entries so a 3-file tree
  became `num_files() == 6` with the sidecar at index 4, and the same tree built
  `v1_only` came out with 0 pads — the order is derivable from the filenames in
  neither direction.
* **Readiness is two conjuncts and neither can see the other's lie** (plan D7 as
  correction C1 rewrote it). `file_progress()` is called with no granularity flag
  anywhere in this repo, so it counts unverified blocks: byte-completeness alone
  reports `complete` at exactly the moment a tail seek still blocks. And a HELD
  piece is not a readable file — libtorrent 2.0 routes a priority-0 file's bytes
  into a `.<infohash>.parts` file and only moves them into place when the priority
  rises, so `contiguous_available` and `file_progress` both report completion while
  `open()` raises FileNotFoundError. Hence three separate readiness fixtures below:
  each conjunct has a mutation the others cannot see.
* **The listed extension set is hard-coded and only NARROWED by settings.**
  `SUBTITLE_EXTENSIONS` is a declared pydantic field and therefore env-overridable
  the moment it exists, and this route hands a file's contents back as readable
  text.

The fakes are hand-written here rather than imported from
`test_first_chunk_precheck.py`, because this file needs per-file sizes, pad flags,
a `files()` accessor and a `status().save_path` that none of the shared fakes
carry, and because `test_stage9_leaves_the_selectors_alone.py` deliberately copies
rather than imports for the same reason. One test uses a REAL `lt.torrent_info`:
the memo-isolation row cannot be written any other way (see its docstring).
"""
import contextlib
import os
import types

import libtorrent as lt
import pytest

from app.config import settings
from app.database.models import Torrent as DbTorrent
from app.torrent import manager as manager_mod
from app.torrent.manager import torrent_manager
from app.torrent.storage import encode_resume_data

PIECE_LENGTH = 16 * 1024


# --------------------------------------------------------------------------
# Fakes
# --------------------------------------------------------------------------

class _FS:
    """`ti.files()`, for the one thing the lister asks it: the pad-file flag.

    The flag is read from libtorrent's own enum rather than from a literal 1, so
    this fixture keeps meaning what it says if the binding's value ever changes.
    """

    def __init__(self, rows):
        self._rows = rows

    def file_flags(self, i):
        return lt.file_flags_t.flag_pad_file if self._rows[i][2] else 0

    def file_path(self, i):
        return self._rows[i][0]


class _TI:
    """A torrent's metadata: paths, sizes, pad flags and REAL offsets.

    Offsets accumulate, so every file but the first sits at a non-zero offset — the
    property `contiguous_available`'s own note calls out at `manager.py:1816-1818`,
    and the reason a sidecar-at-index-0 fixture proves nothing about piece
    arithmetic.
    """

    def __init__(self, rows, piece_length=PIECE_LENGTH):
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
    """A live handle. `have` is a bool or a predicate over piece indices.

    `file_progress` defaults to every file's full declared size, which is the
    state that matters here: it is what a HELD-but-unflushed sidecar reports, and
    it is why a lister that believed `file_progress` alone would call a part file
    ready.
    """

    def __init__(self, ti, save_path, *, have=True, progress=None,
                 metadata=True, raises=False):
        self._ti = ti
        self._save_path = str(save_path)
        self._have = have
        self._progress = progress
        self._metadata = metadata
        self._raises = raises

    def has_metadata(self):
        return self._metadata

    def get_torrent_info(self):
        if self._raises:
            raise RuntimeError("the torrent handle was invalidated")
        return self._ti

    def status(self):
        return types.SimpleNamespace(save_path=self._save_path)

    def file_progress(self):
        if self._progress is not None:
            return list(self._progress)
        return [self._ti.file_at(i).size for i in range(self._ti.num_files())]

    def have_piece(self, piece):
        if callable(self._have):
            return bool(self._have(piece))
        return bool(self._have)


@pytest.fixture(autouse=True)
def clean_memos():
    """The manager is a process-wide singleton and so are both of its memos."""
    torrent_manager._contiguous_runs.clear()
    torrent_manager._resume_video_files.clear()
    yield
    torrent_manager._contiguous_runs.clear()
    torrent_manager._resume_video_files.clear()


@contextlib.contextmanager
def loaded(tid, handle):
    torrent_manager.active_torrents[tid] = (handle, {})
    try:
        yield handle
    finally:
        torrent_manager.active_torrents.pop(tid, None)


def _write(save_path, rel, size):
    p = save_path / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(b"\0" * size)
    return p


def _call(tid):
    """Call the lister and pin the ENVELOPE shape before unpacking it.

    The explicit tuple assertion is not ceremony: `(coverage, entries)` and a bare
    two-element list unpack identically, so without it the "return a bare list in
    the `get_video_files` shape" mutation survives in any row that happens to carry
    two sidecars.
    """
    result = torrent_manager.list_sidecars(tid)
    assert isinstance(result, tuple) and len(result) == 2, (
        f"list_sidecars must answer (coverage, entries), not {type(result).__name__} "
        f"— plan D6: a bare list inherits /files' three-way-ambiguous 200 []"
    )
    coverage, entries = result
    assert isinstance(entries, list)
    return coverage, entries


# A pack whose sidecars sit under Subs/ and whose video is NOT file 0, with pads
# interleaved exactly as libtorrent's own create_torrent produced them.
PACK = [
    ("Pack.S01/info.nfo", 1024, False),
    ("Pack.S01/.pad/16320", 16320, True),
    ("Pack.S01/Pack.S01E01.mkv", 2 * PIECE_LENGTH, False),
    ("Pack.S01/.pad/14336", 14336, True),
    ("Pack.S01/Subs/Pack.S01E01.en.srt", 2048, False),
    ("Pack.S01/Subs/Pack.S01E01.es.srt", 3072, False),
]


def _pack_on_disk(tmp_path, rows=PACK, short=(), absent=()):
    """Write every non-pad file at its declared size, with named exceptions."""
    save_path = tmp_path / "pack"
    for rel, size, pad in rows:
        if pad or rel in absent:
            continue
        _write(save_path, rel, size - 1 if rel in short else size)
    return save_path


# ==========================================================================
# (a) Coverage discriminates three states, and none of them is an empty list
# ==========================================================================

def test_a_live_torrent_with_sidecars_is_listed_and_ready(tmp_path):
    """The positive row, and it carries the only `ready: true` in the file.

    Without it, "hard-code `ready: false`" is green across all three readiness
    fixtures below — every one of them expects False.
    """
    save_path = _pack_on_disk(tmp_path)
    ti = _TI(PACK)
    with loaded("t-listed", _Handle(ti, save_path)):
        coverage, entries = _call("t-listed")

    assert coverage == "listed"
    assert [e["index"] for e in entries] == [4, 5]
    assert all(e["ready"] is True for e in entries), entries
    assert all(e["convertible"] is True for e in entries)
    assert [e["format"] for e in entries] == ["srt", "srt"]
    assert all(e["reason"] is None for e in entries)
    assert entries[0]["size"] == 2048
    assert entries[0]["rel_path"] == "Pack.S01/Subs/Pack.S01E01.en.srt"
    assert entries[0]["path"] == str(save_path / "Pack.S01/Subs/Pack.S01E01.en.srt")
    # Not /files' shape: progress and downloaded are CLAIMS, and the one place
    # this repo hard-codes them (`_video_files_from_resume_data:1187-1188`) says so
    # in its own docstring. `ready` is the measured answer and the only one.
    assert "progress" not in entries[0] and "downloaded" not in entries[0]


def test_a_live_torrent_with_no_sidecars_is_none_not_unknown(tmp_path):
    """The common outcome, per §7.5's own acknowledged gap, and it must not 404.

    The television's one status->copy map renders 404 as "The box doesn't recognise
    this title." (`_data/title.ts:488`) — a false sentence about a release that
    simply ships no `.srt`.
    """
    rows = [r for r in PACK if not r[0].endswith(".srt")]
    save_path = _pack_on_disk(tmp_path, rows=rows)
    with loaded("t-bare", _Handle(_TI(rows), save_path)):
        coverage, entries = _call("t-bare")

    assert coverage == "none"
    assert entries == []


def test_an_evicted_torrent_is_unknown_even_though_its_row_exists(
        tmp_path, monkeypatch, override_get_db):
    """The permanent answer for everything already in the library.

    `_refresh_active_torrents` evicts `finished` mid-session (`manager.py:470-478`) and
    `find_loadable_on_startup` never re-adds it, and the file list is not
    enumerable without a handle (D5: every resume blob this application writes
    carries no `info` dict, so `read_resume_data(...).ti` is None). The DB row is
    present and the files are on disk — the ONLY thing missing is the session, which
    is exactly what makes this row discriminate a coverage computed from
    `len(entries) > 0` or from `handle.has_metadata()`.
    """
    monkeypatch.setattr(manager_mod, "get_db", override_get_db)
    save_path = _pack_on_disk(tmp_path)
    with override_get_db() as db:
        db.add(DbTorrent(
            id="t-evicted", movie_title="A Pack", quality="1080p",
            magnet="magnet:?xt=urn:btih:deadbeef", url="magnet:?xt=urn:btih:deadbeef",
            save_path=str(save_path), state="finished", progress=100.0,
        ))
    assert "t-evicted" not in torrent_manager.active_torrents

    coverage, entries = _call("t-evicted")
    assert coverage == "unknown"
    assert entries == []


def test_no_metadata_yet_is_unknown_not_none(tmp_path):
    """A magnet whose metadata has not arrived knows nothing about its own files.

    `has_metadata()` False is the one case `coverage` exists to describe and the one
    it may not be COMPUTED from — D6 says so in as many words, and the evicted row
    above is where computing it that way reddens.
    """
    save_path = _pack_on_disk(tmp_path)
    with loaded("t-meta", _Handle(_TI(PACK), save_path, metadata=False)):
        coverage, entries = _call("t-meta")
    assert coverage == "unknown"
    assert entries == []


def test_a_raising_handle_is_unknown_and_never_raises(tmp_path):
    """A handle invalidated mid-call answers "unknown", not a 500.

    Same posture as `contiguous_available`'s single guarding try: this runs inside a
    GET the television polls, and an exception here reaches the error middleware as
    an opaque 500 that the TV's copy map renders as a sentence about the title.
    """
    save_path = _pack_on_disk(tmp_path)
    with loaded("t-raise", _Handle(_TI(PACK), save_path, raises=True)):
        coverage, entries = _call("t-raise")
    assert coverage == "unknown"
    assert entries == []


# ==========================================================================
# (b) The index is the torrent's own, not the position in this list
# ==========================================================================

def test_the_index_is_the_torrents_own_not_the_list_position(tmp_path):
    """Indices 4 and 5, past an .nfo and two pad files.

    A fixture whose sidecar is file 0 cannot discriminate this, and the consequence
    of getting it wrong is not a cosmetic one: the VTT route and task 7's admission
    both resolve `{index}` as a libtorrent index, so list positions would serve —
    or raise the pieces of — whatever file happens to sit at 0 and 1. Here that is
    `info.nfo` and a pad.
    """
    save_path = _pack_on_disk(tmp_path)
    with loaded("t-idx", _Handle(_TI(PACK), save_path)):
        _coverage, entries = _call("t-idx")

    assert [e["index"] for e in entries] == [4, 5]
    assert [e["name"] for e in entries] == [
        "Pack.S01E01.en.srt", "Pack.S01E01.es.srt"]
    # No second `sorted(...)` witness to the ordering: the equality above already
    # pins it (measured — reversing the sort reddens exactly these two rows), and
    # a second witness to one rule is this repo's own documented anti-pattern.


# ==========================================================================
# (c) Readiness is measured, and each conjunct has its own fixture
# ==========================================================================

def test_unverified_bytes_are_not_ready_even_at_the_declared_size(tmp_path):
    """(c1) `file_progress` says complete, `have_piece(last)` says no.

    The file is on disk at exactly its declared size, so the on-disk conjunct is
    SATISFIED and this row isolates the other one. libtorrent writes at offsets in
    sparse storage mode and `file_progress()` counts unverified blocks, so this is
    the shape of a file that reads back as zeros; a bare
    `file_progress()[i] >= size` would call it ready.
    """
    save_path = _pack_on_disk(tmp_path)
    handle = _Handle(_TI(PACK), save_path, have=False)
    with loaded("t-unverified", handle):
        coverage, entries = _call("t-unverified")

    assert coverage == "listed"
    assert handle.file_progress()[4] >= 2048, "the fixture must satisfy the byte count"
    assert os.path.getsize(save_path / PACK[4][0]) == 2048, (
        "the fixture must satisfy the on-disk conjunct, or it tests the wrong one")
    assert all(e["ready"] is False for e in entries), entries
    assert all(e["reason"] is None for e in entries), (
        "not-ready is not an error; the reason field is for formats and faults")


def test_a_held_but_unflushed_sidecar_is_not_ready(tmp_path):
    """(c2) C1's whole finding: a held piece is not a readable file.

    `contiguous_available` reports `complete` and `file_progress` reports the full
    size, and the bytes are in a `.<infohash>.parts` file that nothing can read —
    measured, five probe runs. Until task 7's flush moves them,
    `open()` on this path raises FileNotFoundError. What the second conjunct
    prevents is a `<track>` spending its one and only load on a path that does not
    exist, which is indistinguishable at the element from the bodiless 401.
    """
    absent = {PACK[4][0]}
    save_path = _pack_on_disk(tmp_path, absent=absent)
    assert not (save_path / PACK[4][0]).exists()
    with loaded("t-parts", _Handle(_TI(PACK), save_path)):
        coverage, entries = _call("t-parts")

    by_index = {e["index"]: e for e in entries}
    assert coverage == "listed"
    assert by_index[4]["ready"] is False, "a part file is not a readable sidecar"
    assert by_index[4]["reason"] is None
    # Its sibling IS on disk and IS ready, in the same answer: a blanket
    # `ready: false` cannot pass this row.
    assert by_index[5]["ready"] is True


def test_a_short_file_is_not_ready(tmp_path):
    """(c3) Present is not enough — the size must match the metadata.

    Stage 7's gate 3 shape (`manager.py:1274-1285`), reused by shape rather than by
    call. A truncated sidecar fails SILENTLY downstream: a WebVTT parser discards a
    malformed trailing cue and renders what precedes it, so the viewer loses the
    last stretch of the film and nobody files a bug.
    """
    save_path = _pack_on_disk(tmp_path, short={PACK[4][0]})
    assert (save_path / PACK[4][0]).exists()
    assert os.path.getsize(save_path / PACK[4][0]) == 2047
    with loaded("t-short", _Handle(_TI(PACK), save_path)):
        _coverage, entries = _call("t-short")

    by_index = {e["index"]: e for e in entries}
    assert by_index[4]["ready"] is False
    assert by_index[5]["ready"] is True


def test_an_unreadable_sidecar_is_reported_not_raised(tmp_path, monkeypatch):
    """A per-entry OSError costs that row's readiness and nothing else.

    The dev database holds a `seeding`/100 row whose `save_path` does not exist at
    all, so this path is not hypothetical. `PermissionError` is the instrument
    because it is the one OSError a test can provoke without root: a directory
    standing where the file should be would answer NotADirectoryError from the
    parent instead.
    """
    save_path = _pack_on_disk(tmp_path)
    target = save_path / PACK[4][0]

    real_getsize = os.path.getsize

    def _boom(path, *a, **k):
        if str(path) == str(target):
            raise PermissionError(13, "Permission denied")
        return real_getsize(path, *a, **k)

    monkeypatch.setattr(os.path, "getsize", _boom)
    with loaded("t-oserror", _Handle(_TI(PACK), save_path)):
        coverage, entries = _call("t-oserror")
    monkeypatch.undo()

    by_index = {e["index"]: e for e in entries}
    assert coverage == "listed"
    assert by_index[4]["ready"] is False
    assert by_index[4]["reason"] == "unreadable"
    assert by_index[5]["ready"] is True and by_index[5]["reason"] is None


# ==========================================================================
# (d) The extension filter is a request-time guard, not a settings read
# ==========================================================================

EXTRAS = [
    ("Rel/Rel.mkv", 2 * PIECE_LENGTH, False),
    ("Rel/.pad/16320", 16320, True),
    ("Rel/Rel.en.ass", 4096, False),
    ("Rel/Rel.en.sub", 4096, False),
    ("Rel/Setup.exe", 4096, False),
    ("Rel/info.nfo", 4096, False),
]


def test_settings_can_narrow_the_listed_set_but_never_widen_it(tmp_path, monkeypatch):
    """A hostile or careless `.env` cannot make this route read `Setup.exe`.

    `SUBTITLE_EXTENSIONS` is a declared pydantic field, so it is env-overridable the
    moment it exists (`extra='forbid'` applies only to UNdeclared keys) — which is
    why plan task 2 calls its own assertions settings assertions and points the
    request-time guard here. `.sub` is in NEITHER configured set, deliberately:
    VobSub is an IMAGE format, the extension cannot tell text from image, and a
    latin-1 decode of it never raises.
    """
    monkeypatch.setattr(
        settings, "subtitle_extensions",
        set(settings.subtitle_extensions) | {".exe", ".sub"})
    save_path = _pack_on_disk(tmp_path, rows=EXTRAS)
    with loaded("t-extras", _Handle(_TI(EXTRAS), save_path)):
        coverage, entries = _call("t-extras")

    assert coverage == "listed"
    assert [e["rel_path"] for e in entries] == ["Rel/Rel.en.ass"]
    # Listed, and a visible row with effect NONE: the format is carried so the
    # picker can say it out loud instead of staying silent about a file the viewer
    # can see in the release (D17).
    assert entries[0]["format"] == "ass"
    assert entries[0]["convertible"] is False
    assert entries[0]["reason"] == "unsupported-format"
    assert entries[0]["ready"] is True, (
        "convertibility and readiness are orthogonal: the bytes are there")


def test_narrowing_the_configured_set_drops_a_listed_extension(tmp_path, monkeypatch):
    """The other direction, which is the half an owner is allowed to have.

    Both directions are needed: with only the widening row above, "ignore
    `settings.subtitle_extensions` and use the hard-coded set alone" stays green.
    """
    monkeypatch.setattr(settings, "subtitle_extensions", {".vtt"})
    save_path = _pack_on_disk(tmp_path)
    with loaded("t-narrow", _Handle(_TI(PACK), save_path)):
        coverage, entries = _call("t-narrow")

    assert coverage == "none"
    assert entries == []


def test_an_oversized_sidecar_is_not_listed(tmp_path, monkeypatch):
    """Over `subtitle_max_bytes` the entry is EXCLUDED, not listed-and-refused.

    That is the reading the converter already took in its own docstring ("the lister
    already refuses an oversized file by its on-disk size", `vtt.py:272-273`), and it
    leaves the route's 415-by-size reachable from the converter instead — on a body
    whose DECODED UTF-8 form outgrew the cap, which a cp1252 file does on the way
    through. Not a prescribed mutation; written because the production code makes
    the choice and a choice nothing tests is a choice nobody can see.
    """
    monkeypatch.setattr(settings, "subtitle_max_bytes", 2047)
    save_path = _pack_on_disk(tmp_path)
    with loaded("t-big", _Handle(_TI(PACK), save_path)):
        coverage, entries = _call("t-big")

    assert coverage == "none", "both sidecars are 2048 and 3072 bytes"
    assert entries == []


# ==========================================================================
# (e) Containment, on the resolved path
# ==========================================================================

ESCAPE = [
    ("Rel/Rel.mkv", 2 * PIECE_LENGTH, False),
    ("Rel/../../etc/passwd.srt", 2048, False),
    ("Rel/Subs/ok.srt", 2048, False),
]


def test_a_path_escaping_the_save_path_is_never_listed(tmp_path):
    """`fi.path` is metadata from a stranger, and this route returns READABLE TEXT.

    Nothing on the existing resolution path asserts containment —
    `_resolve_video_file` checks only `os.path.exists` (`api/streaming.py:200`) — so
    without this an entry the lister produced is an arbitrary-file-read primitive
    for whoever authored the torrent. Both sides resolved, the `safe_rmtree` idiom
    (`app/torrent/storage.py:33-42`): a string `startswith` is defeated by
    `/downloads/../etc` and a one-sided check by a symlinked save path.
    """
    save_path = tmp_path / "pack"
    _write(save_path, "Rel/Rel.mkv", 2 * PIECE_LENGTH)
    _write(save_path, "Rel/Subs/ok.srt", 2048)
    # `Rel/../../etc/passwd.srt` under `<tmp>/pack` resolves to `<tmp>/etc/passwd.srt`.
    # The escaping file really exists, at exactly its declared size, so the row can
    # only be absent because the containment assert refused it — not because the
    # readiness stat happened to fail.
    outside = _write(tmp_path / "etc", "passwd.srt", 2048)
    assert outside.exists() and os.path.getsize(outside) == 2048
    assert (save_path / "Rel/../../etc/passwd.srt").resolve() == outside.resolve()

    with loaded("t-escape", _Handle(_TI(ESCAPE), save_path)):
        coverage, entries = _call("t-escape")

    assert coverage == "listed"
    assert [e["index"] for e in entries] == [2]
    assert all("passwd" not in e["rel_path"] for e in entries), entries
    assert all("passwd" not in e["path"] for e in entries), entries


# ==========================================================================
# (f) Memo isolation: the lister never serves the Range path's cached list
# ==========================================================================

def test_the_lister_does_not_answer_from_the_resume_video_file_memo(
        tmp_path, monkeypatch, override_get_db):
    """One test, two calls, same torrent id — and it has to be one test.

    `_resume_video_files` is keyed on the torrent id with a fingerprint that carries
    NO predicate (`manager.py:1165`) and is evicted by a whole-dict `.clear()` above
    16 entries (`:1195-1196`), so a predicate parameter there would serve the other
    caller's cached list and halve the depth protecting the Range hot path. Two
    separate tests cannot discriminate that: `test_finished_torrent_streamable.py:164`
    pops the memo per test, and this file's own autouse fixture clears it.

    The real `lt.torrent_info` is not decoration. The memo is only ever POPULATED by
    a blob whose `info` dict is present, and the only way to get one is the
    hand-built `add_torrent_params` of `test_finished_torrent_streamable.py:144` —
    which is also the measurement behind D5: `save_resume_data()` as shipped at all
    three sites produces a blob whose `.ti` is None, so the memo is empty in
    production for a different reason than it is empty here.
    """
    monkeypatch.setattr(manager_mod, "get_db", override_get_db)
    save_path = tmp_path / "memo"
    content = {
        "Pack.S01/Pack.S01E01.mkv": 2 * PIECE_LENGTH,
        "Pack.S01/Subs/Pack.S01E01.en.srt": 2048,
    }
    fs = lt.file_storage()
    for rel, size in content.items():
        _write(save_path, rel, size)
        fs.add_file(rel, size)
    t = lt.create_torrent(fs, piece_size=PIECE_LENGTH)
    lt.set_piece_hashes(t, str(save_path))
    ti = lt.torrent_info(t.generate())

    atp = lt.add_torrent_params()
    atp.ti = ti
    atp.save_path = str(save_path)
    blob = encode_resume_data(lt.write_resume_data_buf(atp))
    with override_get_db() as db:
        db.add(DbTorrent(
            id="t-memo", movie_title="A Pack", quality="1080p",
            magnet="magnet:?xt=urn:btih:deadbeef", url="magnet:?xt=urn:btih:deadbeef",
            save_path=str(save_path), state="finished", progress=100.0,
            resume_data=blob,
        ))

    sub_index = next(i for i in range(ti.num_files())
                     if ti.file_at(i).path.endswith(".srt"))

    with loaded("t-memo", _Handle(ti, save_path)):
        # Fills the memo with the VIDEO-only list, under this same torrent id.
        assert torrent_manager.get_completed_video_file_info("t-memo") is not None
        assert torrent_manager._resume_video_files.get("t-memo") is not None, (
            "the memo must really be populated, or this test measures nothing")
        assert all(not f["path"].endswith(".srt")
                   for f in torrent_manager._resume_video_files["t-memo"][1])

        coverage, entries = _call("t-memo")

    assert coverage == "listed"
    assert [e["index"] for e in entries] == [sub_index]
    assert entries[0]["format"] == "srt"
    assert entries[0]["ready"] is True
