"""`GET /{tid}/subtitles/{index}` — the WebVTT body a `<track>` actually loads.

What this file defends, in order of how badly it fails when wrong:

* **The content type, which no body assertion can see.** A `<track>` served
  `text/plain` loads nothing and fires NO event the television could print. The
  type is hard-coded (D10) because the container's own table maps
  `.srt -> text/plain` and `.ass -> audio/aac` — re-measured in this image — and
  that table belongs to the BASE IMAGE, so a `python:3.10-slim` bump can change
  it with nothing noticing.
* **Never a 200 with an empty VTT.** Measured (D19): a body of `WEBVTT\\n\\n`
  loads at `readyState 2` with zero cues and fires no event at all, while a raw
  empty or header-less file fires a real `error`. So every refusal here is a
  status, and **"200 and the body starts with WEBVTT" is forbidden as a success
  criterion by name** — every 200 row below asserts a cue COUNT and a cue's
  TEXT.
* **Resolution through the lister and nowhere else (D9).** `index` is the
  torrent's own libtorrent index. A route that resolved it itself would serve a
  video file's bytes on request, would have to re-derive the extension
  allow-list, the size cap and the containment assertion, and would drift from
  the list the picker is built out of.
* **Retryable and permanent refusals are different statuses.** 503 +
  `Retry-After: 2` while the bytes are not here (including the window between a
  held piece and task 7's flush, where the path does not exist at all — C1), 415
  for the four things waiting cannot fix, 404 for an index the lister did not
  produce. 416 was rejected for the same reason `stream_video` rejected it
  (`api/streaming.py:286-292`): it "would tell <video> to stop for good".

**Two deliberate divergences from the plan's task 9, both recorded in the
commit message.** (1) Plan rows (d2) and (g) prescribe DIFFERENT statuses for
the same state — (d2) says a `ready: true` row whose file is absent is a 503,
(g) says "a fixture whose file is missing on disk" is a 404. They are the same
fixture: the lister cannot report `ready: true` for a file it could not stat, so
the only way to reach a read of an absent path is a stale or hand-made lister
answer. This file takes (d2)'s 503 (it is C1's own row, it is the later and
measured reading, and the state really does clear when the flush runs) and keeps
(g)'s status for the case that is NOT absence: a path that is present and
unreadable. (2) (g)'s stated motivation — "the dev DB holds a `seeding`/100 row
whose `save_path` does not exist" — is answered with (g)'s own 404 by an earlier
gate, and that row is here too: such a torrent has no live handle, so the lister
answers `unknown` and the route 404s before any read.

The fakes are hand-written rather than imported from `test_subtitles_list.py` or
`test_sidecar_lister.py`, which is this stage's own precedent — the list file's
header and `test_stage9_leaves_the_selectors_alone.py` both say they copy rather
than import, for the same reason: the handles there carry no file CONTENT, and
every row below turns on the bytes on disk. This file's handle carries no
`piece_priority`, no `file_priority` and no recorder either, which is its own
small gate: a route that reached for one would raise `AttributeError` here
rather than pass.
"""
import contextlib
import os
import types
from pathlib import Path

import libtorrent as lt
import pytest
from fastapi.testclient import TestClient

from app.api import subtitles as subtitles_api
from app.config import settings
from app.database.models.torrents import Torrent as DbTorrent
from app.main import app
from app.subtitles import sidecars
from app.torrent import manager as manager_mod
from app.torrent.manager import torrent_manager

client = TestClient(app)

VTT = "/api/v1/streaming/{tid}/subtitles/{index}"

PL = 16 * 1024


# --------------------------------------------------------------------------
# Bodies. Every one of them is hand-typed; nothing here was captured from a run
# of the code under test (`test_release_corpus.py:35` records why: a corpus
# produced by the code under test "proves only that the parser is
# deterministic").
# --------------------------------------------------------------------------

# CRLF endings, numeric ids, an `<i>`, a bare `<`, an `&`, two accents, and a
# brace run — the six payload rules in one file, so the 200 row can assert the
# whole body rather than a prefix.
SRT_SOURCE = (
    "1\r\n"
    "00:00:01,000 --> 00:00:04,000\r\n"
    "5 < 6 and <i>7</i> & 8\r\n"
    "Café fermé\r\n"
    "\r\n"
    "2\r\n"
    "00:00:05,500 --> 00:00:07,000\r\n"
    "{\\an8}Top line\r\n"
).encode("utf-8")

SRT_EXPECTED = (
    "WEBVTT\n"
    "\n"
    "00:00:01.000 --> 00:00:04.000\n"
    "5 &lt; 6 and <i>7</i> &amp; 8\n"
    "Café fermé\n"
    "\n"
    "00:00:05.500 --> 00:00:07.000\n"
    "Top line\n"
)

# Never read: the row says `convertible: false` and the refusal comes from the
# ROW. Real-ish anyway, so that a reader which did open it would get a body the
# SRT parser answers `no-cues` to rather than crashing — i.e. so the `.ass` row
# below fails for the right reason under its mutation.
ASS_SOURCE = (
    "[Script Info]\nScriptType: v4.00+\n\n[Events]\n"
    "Format: Layer, Start, End, Style, Text\n"
    "Dialogue: 0,0:00:01.00,0:00:04.00,Default,,Hello\n"
).encode("utf-8")

# Decodes cleanly and contains no timing line at all -> `no-cues`.
NO_CUES_SOURCE = (
    "These are the uploader's notes.\nNo timings anywhere in here.\n"
).encode("utf-8")

# cp1251 Cyrillic: invalid UTF-8, decodable as cp1252, and a non-ASCII letter
# density of 1.0 -> refused rather than mojibaked (D18).
CP1251_SOURCE = (
    "1\r\n00:00:01,000 --> 00:00:02,000\r\nПривет, "
    "мир\r\n"
).encode("cp1251")

# 200 cp1252 bytes that become 250 UTF-8 bytes: a body the lister lists by its
# ON-DISK size and the converter refuses by the size of what would be SERVED.
# 50 of 200 letters are non-ASCII (0.25), under the decode gate's 0.35.
GROWS_SOURCE = ("Café" * 50).encode("cp1252")
GROWS_CAP = len(GROWS_SOURCE)


# --------------------------------------------------------------------------
# Fakes
# --------------------------------------------------------------------------

class _FS:
    """`ti.files()`. The pad flag is read off libtorrent's own enum, never a 1."""

    def __init__(self, rows):
        self._rows = rows

    def file_flags(self, i):
        return lt.file_flags_t.flag_pad_file if self._rows[i][2] else 0


class _TI:
    """Metadata with REAL accumulated offsets, so every file but the first sits
    at a non-zero offset — which is what makes `contiguous_available`'s piece
    arithmetic (and therefore `ready`) answer from this file's own pieces."""

    def __init__(self, rows, piece_length=PL):
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
    """A live handle. Read-only: this route mutates nothing, and the absence of
    `piece_priority`/`file_priority` on this fake is deliberate — a route that
    reached for either would raise AttributeError here rather than pass."""

    def __init__(self, ti, save_path, *, have=True, metadata=True):
        self._ti = ti
        self._save_path = str(save_path)
        self._have = have
        self._metadata = metadata

    def has_metadata(self):
        return self._metadata

    def get_torrent_info(self):
        return self._ti

    def status(self):
        """The four rate/peer fields are here because `get_torrent_status`
        overlays them for any torrent in `active_torrents` and swallows an
        AttributeError into a None — which this route would then answer as a 404
        for a perfectly live torrent."""
        return types.SimpleNamespace(
            save_path=self._save_path,
            download_rate=0, upload_rate=0, num_peers=3,
            total_wanted=self._ti.total_size(), total_wanted_done=0,
        )

    def file_progress(self):
        return [self._ti.file_at(i).size for i in range(self._ti.num_files())]

    def have_piece(self, piece):
        if callable(self._have):
            return bool(self._have(piece))
        return bool(self._have)


# --------------------------------------------------------------------------
# Layouts
# --------------------------------------------------------------------------

# The sidecar whose body is served sits at libtorrent index 4 and at LIST
# POSITION 0, which is the whole point of the index-space pair below: a
# `rows[index]` implementation answers 200 for the wrong number and 404 for the
# right one. The pad is index 1 so the two numbers cannot coincide by accident.
PACK = [
    ("Pack.S01/info.nfo", 1024, False),                                 # 0
    ("Pack.S01/.pad/15360", 15360, True),                               # 1
    ("Pack.S01/Pack.S01E01.mkv", 2 * PL, False),                        # 2
    ("Pack.S01/Pack.S01E02.mkv", 2 * PL, False),                        # 3
    ("Pack.S01/Subs/Pack.S01E01.en.srt", len(SRT_SOURCE), False),       # 4
    ("Pack.S01/Subs/Pack.S01E02.en.ass", len(ASS_SOURCE), False),       # 5
    ("Pack.S01/Subs/Pack.S01E02.en.srt", len(NO_CUES_SOURCE), False),   # 6
    ("Pack.S01/Subs/Pack.S01E02.ru.srt", len(CP1251_SOURCE), False),    # 7
]
GOOD, ASS, NO_CUES, UNDECODABLE = 4, 5, 6, 7
VIDEO = 2
PACK_CONTENT = {
    "Pack.S01/Subs/Pack.S01E01.en.srt": SRT_SOURCE,
    "Pack.S01/Subs/Pack.S01E02.en.ass": ASS_SOURCE,
    "Pack.S01/Subs/Pack.S01E02.en.srt": NO_CUES_SOURCE,
    "Pack.S01/Subs/Pack.S01E02.ru.srt": CP1251_SOURCE,
}

# `fi.path` is metadata from a stranger's torrent and this route returns file
# contents as READABLE TEXT, which turns incidental cover into a disclosure
# primitive (D9). The escaping file EXISTS, at its declared size, with a body
# this route would happily convert — so the 404 below is the containment
# assertion and nothing else.
ESCAPE = [
    ("Show/Show.S01E01.mkv", 2 * PL, False),                  # 0
    ("Show/../../escape.en.srt", len(SRT_SOURCE), False),     # 1
]
ESCAPE_SUB = 1
ESCAPE_CONTENT = {"Show/../../escape.en.srt": SRT_SOURCE}

GROWS = [
    ("Show/Show.S01E01.mkv", 2 * PL, False),                   # 0
    ("Show/Subs/E01.fr.srt", len(GROWS_SOURCE), False),        # 1
]
GROWS_SUB = 1
GROWS_CONTENT = {"Show/Subs/E01.fr.srt": GROWS_SOURCE}


@pytest.fixture(autouse=True)
def isolate(monkeypatch, override_get_db):
    """Every row through a throwaway SQLite, and no memo carried between tests.

    `get_db` is patched on the MANAGER module, because that is where
    `get_torrent_status` calls it. Hazard 4: the test container talks to the real
    Postgres, which already holds a leaked `t-block-1` row and a `seeding`/100
    row whose `save_path` does not exist.
    """
    monkeypatch.setattr(manager_mod, "get_db", override_get_db)
    torrent_manager._contiguous_runs.clear()
    yield
    torrent_manager._contiguous_runs.clear()


@pytest.fixture(autouse=True)
def reads(monkeypatch):
    """Record every sidecar read, so "does not read a file the lister did not
    return" is an assertion rather than a `Does not` line.

    Three rows assert this list is EMPTY — the `.ass` refusal, the containment
    refusal and the 401 — and each of them is the only instrument for a
    different mutation: a route that resolved the index itself would have to open
    the file to discover the `.ass` refusal from the converter, and would open
    the escaping path before discovering nothing at all.
    """
    original = subtitles_api._read_sidecar_bytes
    recorded = []

    def _spy(path):
        recorded.append(str(path))
        return original(path)

    monkeypatch.setattr(subtitles_api, "_read_sidecar_bytes", _spy)
    return recorded


@contextlib.contextmanager
def loaded(tid, handle):
    torrent_manager.active_torrents[tid] = (handle, {})
    try:
        yield handle
    finally:
        torrent_manager.active_torrents.pop(tid, None)


def _row(db_cm, tid, save_path, *, state="downloading", progress=42.0,
         block_reason=None):
    with db_cm() as db:
        db.add(DbTorrent(
            id=tid, movie_title="A Pack", quality="1080p",
            magnet="magnet:?xt=urn:btih:deadbeef",
            url="magnet:?xt=urn:btih:deadbeef",
            save_path=str(save_path), state=state, progress=progress,
            block_reason=block_reason,
        ))


def _write(save_path, rows, content):
    """Lay the tree down with REAL bodies for the sidecars.

    `os.path.normpath` rather than `Path.mkdir(parents=True)` on the raw join,
    because one layout's `fi.path` deliberately contains `..` and the parents of
    such a path are not creatable in order.
    """
    for rel, size, pad in rows:
        if pad:
            continue
        target = Path(os.path.normpath(str(save_path / rel)))
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content.get(rel, b"\0" * size))


@pytest.fixture
def pack(tmp_path, override_get_db):
    @contextlib.contextmanager
    def _build(tid="t-vtt", *, rows=PACK, content=None, state="downloading",
               progress=42.0, block_reason=None, have=True, loaded_=True,
               on_disk=True):
        if content is None:
            content = PACK_CONTENT
        save_path = tmp_path / tid
        if on_disk:
            _write(save_path, rows, content)
        else:
            save_path.mkdir(parents=True, exist_ok=True)
        _row(override_get_db, tid, save_path, state=state, progress=progress,
             block_reason=block_reason)
        handle = _Handle(_TI(rows), save_path, have=have)
        if not loaded_:
            assert tid not in torrent_manager.active_torrents
            yield types.SimpleNamespace(tid=tid, handle=None,
                                        save_path=save_path)
            return
        with loaded(tid, handle):
            yield types.SimpleNamespace(tid=tid, handle=handle,
                                        save_path=save_path)

    return _build


def _get(tid, index):
    return client.get(VTT.format(tid=tid, index=index))


def _cue_count(body: str) -> int:
    """Cues counted from TIMING LINES, the way the browser finds them.

    `body.count('-->')` would be a different number: a payload line containing
    an arrow is escaped to `--&gt;` precisely because an unescaped one yields a
    cue whose text is the empty string, which PASSES a cue-count check (D19).
    """
    return sum(1 for line in body.split("\n") if " --> " in line)


# ==========================================================================
# (a)/(b)/(f) The 200: its type, its caching, and its actual text
# ==========================================================================

def test_the_body_is_the_converted_cues_and_not_a_header(pack, reads):
    """The whole body, hand-typed, with the cue count asserted separately.

    "200 and the body starts with WEBVTT" is FORBIDDEN as a success criterion in
    this stage (D19): measured, `WEBVTT\\n\\n` loads at `readyState 2` with zero
    cues and fires no event at all, so it is the one failure the television
    cannot see. The cue containing `<`, `&` and two accented characters is here
    because escaping has to be wrong in BOTH directions to be caught —
    `html.escape()` would put the literal text `<i>` on screen, and escaping
    nothing would lose the `&` to a legacy semicolon-less entity.
    """
    with pack() as p:
        r = _get(p.tid, GOOD)
    assert r.status_code == 200, r.text
    body = r.text
    assert _cue_count(body) == 2, body
    assert body == SRT_EXPECTED, body
    # Named separately, because the whole-body equality above would still pass if
    # SRT_EXPECTED itself had been captured from a run rather than typed.
    assert "5 &lt; 6 and <i>7</i> &amp; 8" in body
    assert "Café fermé" in body
    assert "{" not in body and "," not in body.split("\n")[2]
    # THE POSITIVE CONTROL for the three `reads == []` rows below. Measured in
    # review: replacing `_read_sidecar_bytes(...)` with an inline
    # `open(row["path"], "rb")` — the very thing that function's docstring says
    # it is deliberately not — leaves all 22 rows green, because nothing else in
    # this file asserts that the spy ever records anything. Without this line the
    # `.ass`, containment and 401 rows can go vacuous under a refactor, and they
    # are the sole instrument for "resolution goes through the lister" on the
    # `.ass` row (measured by the implementer). Resolved on both sides because
    # the row's own `path` comes back through `sidecars.contained_path`'s
    # `resolve()` and `tmp_path` may sit under a symlink.
    expected_read = Path(os.path.normpath(
        str(p.save_path / "Pack.S01/Subs/Pack.S01E01.en.srt"))).resolve()
    assert [Path(x) for x in reads] == [expected_read], reads


def test_the_content_type_is_hard_coded_webvtt(pack):
    """The assertion no body check can make for it.

    A `<track>` served `text/plain` loads nothing and fires no event. `.srt`
    maps to exactly `text/plain` on this image's own table (D10, re-measured),
    so `get_mime_type` is not a near-miss here, it is the near-miss.
    """
    with pack() as p:
        r = _get(p.tid, GOOD)
    assert r.status_code == 200, r.text
    assert r.headers["content-type"] == "text/vtt; charset=utf-8"
    # The charset is load-bearing and separately mutable: the body carries
    # multi-byte UTF-8, and a `text/vtt` with no charset leaves the television
    # guessing at it.
    assert r.content.decode("utf-8") == SRT_EXPECTED


def test_the_200_is_never_cached(pack):
    """A partial and a complete `.srt` live at the SAME URL, and `ready` flips
    underneath it while a download runs. `avatars.py:85`'s
    `public, max-age=31536000, immutable` is the copy-paste that is wrong twice
    over: it is also `public` on a session-gated resource."""
    with pack() as p:
        r = _get(p.tid, GOOD)
    assert r.status_code == 200, r.text
    assert r.headers["Cache-Control"] == "no-store"


# ==========================================================================
# (e) Index space: the torrent's index, never the row's position
# ==========================================================================

def test_the_torrents_own_index_is_served(pack):
    """Index 4 is the sidecar. Its position in the list is 0."""
    with pack() as p:
        r = _get(p.tid, GOOD)
    assert r.status_code == 200, r.text


def test_a_list_position_is_not_an_index(pack):
    """The arm that makes the pair discriminate.

    The 200 arm alone passes whenever the two numbers coincide, which they do on
    a single-file torrent — the most likely fixture and the one that would have
    shipped a `rows[index]` implementation. Index 0 here is the `.nfo`: listable
    by nobody, so the lister never produced it.
    """
    with pack() as p:
        r = _get(p.tid, 0)
    assert r.status_code == 404
    assert "0" in r.json()["detail"]


# ==========================================================================
# (d) The refusals, one fixture each
# ==========================================================================

def test_a_sidecar_whose_span_is_not_held_is_a_retryable_503(pack):
    """503 + `Retry-After: 2` + an EMPTY body.

    The shape `stream_video` already chose for the same question
    (`api/streaming.py:286-292`), in its own words: 416 "would tell <video> to
    stop for good" over a condition that clears itself in seconds. The file is on
    disk at its declared size here and the piece span is not held — the half of
    D7's conjunction that `present_at_declared_size` cannot see on its own.
    """
    with pack("t-notready", have=False) as p:
        r = _get(p.tid, GOOD)
    assert r.status_code == 503
    assert r.headers["Retry-After"] == "2"
    # `_not_ready`'s docstring argues for this header by name ("the very next
    # second may answer 200 from the same URL") and nothing claimed it: measured
    # in review, deleting `Cache-Control` from BOTH refusal helpers left all 22
    # rows green. A cached 503 is a `Retry-After` the television obeys and then
    # gets the stale refusal back from its own cache.
    assert r.headers["Cache-Control"] == "no-store"
    assert r.content == b"", (
        "the 503 must be bodiless: a body here reaches a <track> as a malformed "
        "cue file, and the one thing it must not look like is a successful load"
    )


def test_a_video_files_index_is_a_404(pack, reads):
    """Resolution goes through the lister and nowhere else (D9).

    An implementation that resolved `index` against `ti.file_at(index)` would
    serve the film's own bytes on request — and the bytes of a `.mkv` are not a
    404 under such an implementation, they are a 415 (`b"\\0" * n` decodes as
    valid UTF-8 into a NUL-riddled string, which D18's second conjunct refuses).
    So this row discriminates it.
    """
    with pack() as p:
        r = _get(p.tid, VIDEO)
    assert r.status_code == 404
    assert str(VIDEO) in r.json()["detail"]
    assert reads == [], "a video file was opened by the subtitle route"


def test_an_out_of_range_index_is_a_404(pack):
    with pack() as p:
        r = _get(p.tid, 99)
    assert r.status_code == 404
    assert "99" in r.json()["detail"]


def test_an_ass_sidecar_is_a_415_naming_the_format_without_reading_it(
        pack, reads):
    """D17: `.ass`/`.ssa` are LISTED and never converted, and the refusal comes
    from the ROW.

    The no-read assertion is the instrument, not decoration. A route that
    resolved the index itself would reach the same 415 with the same reason — the
    converter refuses `.ass` by format too — so the status and the reason alone
    cannot tell the two implementations apart. What can is that the lister
    already knows this file is not convertible, so the answer costs no disk read
    at all.
    """
    with pack() as p:
        r = _get(p.tid, ASS)
    assert r.status_code == 415
    assert r.json() == {"reason": "unsupported-format"}
    # The 415's own `no-store`, for the same reason as the 503's: a refusal that
    # a later `fetch` or a wider `subtitle_convertible_extensions` can turn into
    # a 200 lives at this URL, and nothing else in this file claimed the header.
    assert r.headers["Cache-Control"] == "no-store"
    assert reads == [], (
        "the .ass refusal must come from the lister's row, not from opening the "
        "file: the row is the only thing that knows the stage refuses the format"
    )


def test_a_sidecar_with_no_cues_is_a_415(pack):
    """The refusal that exists because the alternative is unobservable.

    A body with no timing lines is not served as `WEBVTT\\n\\n`: measured, the
    raw file fires a real `error` event while the wrapped one loads with zero
    cues and no event at all, so wrapping converts a loud failure into a silent
    one (D19, and task 6's most important mutation).
    """
    with pack() as p:
        r = _get(p.tid, NO_CUES)
    assert r.status_code == 415
    assert r.json() == {"reason": "no-cues"}


def test_an_undecodable_sidecar_is_a_415_naming_the_encoding(pack):
    """cp1251 Cyrillic: invalid UTF-8, decodable as cp1252, refused by the
    density gate at 1.0 (D18). The viewer gets one sentence they can act on —
    set `SUBTITLE_ENCODING` — instead of two hours of nonsense, and a `latin-1`
    or `errors='replace'` rung anywhere in the ladder would turn this row into a
    200 full of garbage."""
    with pack() as p:
        r = _get(p.tid, UNDECODABLE)
    assert r.status_code == 415
    assert r.json() == {"reason": "encoding-unknown"}


def test_a_body_that_outgrows_the_cap_on_the_way_through_is_a_415(pack,
                                                                  monkeypatch):
    """The fourth 415, and the reason the route does not hard-code a size rule.

    The lister refuses an oversized sidecar by its ON-DISK size, so this body is
    listable at exactly the cap — and then grows past it when the cp1252 text is
    re-encoded as the UTF-8 that would actually be served. Only the converter can
    see that, which is why the reason is passed through rather than invented
    here.
    """
    monkeypatch.setattr(settings, "subtitle_max_bytes", GROWS_CAP)
    with pack("t-grows", rows=GROWS, content=GROWS_CONTENT) as p:
        r = _get(p.tid, GROWS_SUB)
    assert r.status_code == 415
    assert r.json() == {"reason": "too-large"}


# ==========================================================================
# (c) Containment
# ==========================================================================

def test_a_path_escaping_the_save_path_is_a_404_with_no_read(pack, reads):
    """`fi.path` is attacker-supplied metadata and this route returns file
    contents as READABLE TEXT.

    The escaping file exists, at its declared size, holding a body this route
    would convert without complaint — so a well-formed fixture cannot catch this
    and the only thing standing between the two is
    `sidecars.contained_path`'s resolved-parents assertion. Both sides resolved
    (the `safe_rmtree` idiom at `app/torrent/storage.py:33-42`): a one-sided
    check is defeated by a symlinked save path and a string `startswith` by
    `/downloads/../etc`.
    """
    with pack("t-escape", rows=ESCAPE, content=ESCAPE_CONTENT) as p:
        escaped = Path(os.path.normpath(str(p.save_path / ESCAPE[1][0])))
        # Non-vacuity: if the file were not there, this row would pass against an
        # implementation with no containment check at all.
        assert escaped.exists() and escaped.read_bytes() == SRT_SOURCE
        assert escaped.parent == p.save_path.parent
        r = _get(p.tid, ESCAPE_SUB)
    assert r.status_code == 404
    assert reads == [], "the route opened a path outside the save path"


# ==========================================================================
# (d2)/(g) A ready row whose bytes are not where it says
# ==========================================================================

def _stale_row(save_path, rel, *, ready=True, reason=None):
    """A lister answer that is no longer true, in the lister's own row shape.

    Hand-made on purpose. The real lister CANNOT produce `ready: true` for a file
    it could not stat — `present_at_declared_size` is the second conjunct of
    readiness — so the only way to reach a read of an absent path in production
    is for the answer to go stale between the lister's stat and this read, or for
    the bytes to be held but not yet flushed. Both are races, and a hand-made row
    is the instrument for a race.
    """
    path = Path(os.path.normpath(str(save_path / rel)))
    return {
        "index": 4,
        "rel_path": rel,
        "path": str(path),
        "name": path.name,
        "size": len(SRT_SOURCE),
        "format": "srt",
        "convertible": True,
        "ready": ready,
        "reason": reason,
    }


def test_a_ready_row_whose_file_is_absent_is_a_503_and_not_a_500(pack,
                                                                 monkeypatch):
    """C1's own row: a HELD PIECE IS NOT A READABLE FILE.

    Until task 7's flush runs, libtorrent 2.0 keeps a priority-0 file's bytes in
    a `.<infohash>.parts` file and the sidecar's own path does not exist — while
    `contiguous_available` reports `complete` and `file_progress` reports the
    full size (measured). So this state is real, it is transient, and it clears
    by itself: 503, not the error middleware's
    `{"detail": "Internal server error", "error": ...}`, which reaches a
    `<track>` as a load failure with no reason anywhere.

    This is the row where the plan contradicts itself — (g) calls the same
    fixture a 404 — and this file takes (d2)'s 503, for the reason in its header.
    """
    rel = "Pack.S01/Subs/Pack.S01E01.en.srt"
    with pack("t-held", on_disk=False) as p:
        monkeypatch.setattr(torrent_manager, "list_sidecars",
                            lambda tid: ("listed", [_stale_row(p.save_path, rel)]))
        assert not Path(os.path.normpath(str(p.save_path / rel))).exists()
        r = _get(p.tid, 4)
    assert r.status_code == 503, r.text
    assert r.headers["Retry-After"] == "2"
    assert r.content == b""
    assert "Internal server error" not in r.text


def test_a_ready_row_whose_path_is_unreadable_is_a_404_and_not_a_500(
        pack, monkeypatch):
    """(g)'s status, for the case that is NOT absence: present and unreadable.

    A directory sitting where the sidecar should be is the reachable shape — the
    tree below `save_path` is built from a stranger's metadata and a previous
    download's junk is still there. `open()` raises `IsADirectoryError`, an
    `OSError` that no amount of waiting fixes, so it is a 404 rather than the
    503 above. Either way it is never a 500: the dev database holds a
    `seeding`/100 row whose `save_path` does not exist at all, and one unreadable
    sidecar may not present as a server fault.
    """
    rel = "Pack.S01/Subs/Pack.S01E01.en.srt"
    with pack("t-isdir", on_disk=False) as p:
        target = Path(os.path.normpath(str(p.save_path / rel)))
        target.mkdir(parents=True)
        monkeypatch.setattr(torrent_manager, "list_sidecars",
                            lambda tid: ("listed", [_stale_row(p.save_path, rel)]))
        r = _get(p.tid, 4)
    assert r.status_code == 404, r.text
    assert "Internal server error" not in r.text


def test_an_unreadable_row_is_a_404_rather_than_a_retry(pack, monkeypatch):
    """The lister's own `unreadable` reason is permanent, so it is not a 503.

    `present_at_declared_size` reports `(False, "unreadable")` for an `OSError`
    that is not absence, which also makes `ready` False — so without this branch
    the answer would be the retryable 503 above, and the television would poll a
    file that is never going to open.
    """
    rel = "Pack.S01/Subs/Pack.S01E01.en.srt"
    with pack("t-unreadable", on_disk=False) as p:
        monkeypatch.setattr(
            torrent_manager, "list_sidecars",
            lambda tid: ("listed", [_stale_row(
                p.save_path, rel, ready=False,
                reason=sidecars.REASON_UNREADABLE)]))
        r = _get(p.tid, 4)
    assert r.status_code == 404, r.text
    assert str(4) in r.json()["detail"]


# ==========================================================================
# The 404s that come before any of it
# ==========================================================================

def test_an_unknown_torrent_is_a_404(pack):
    r = _get("t-does-not-exist", GOOD)
    assert r.status_code == 404
    assert r.json()["detail"] == "Torrent not found"


def test_a_blocked_row_is_a_404(pack):
    """`_block_torrent` removed the torrent and DELETED its files with no unblock
    path, so every byte this route could serve from it is gone. One such row
    (`t-block-1`) is live in the dev database right now."""
    with pack("t-blocked", state="blocked", block_reason="an executable") as p:
        r = _get(p.tid, GOOD)
    assert r.status_code == 404


def test_an_evicted_torrent_is_a_404_with_no_read(pack, reads):
    """The PERMANENT answer for everything already in this library (D5), and
    (g)'s own motivating row: the dev database holds a `seeding`/100 torrent
    whose `save_path` does not exist. With no live handle the file list is not
    enumerable at all, so the route refuses before it can be tempted to stat
    anything — the 404 (g) asked for, from the gate that can actually produce
    it."""
    with pack("t-evicted", loaded_=False, on_disk=False) as p:
        r = _get(p.tid, GOOD)
    assert r.status_code == 404
    assert reads == []


# ==========================================================================
# The inherited edges: 422, 405, 401
# ==========================================================================

def test_a_non_integer_index_keeps_fastapis_default_422_body(pack):
    """The decision, pinned rather than left an omission.

    `_BARE_422_PATHS` blanks the body only for the two routes a media decoder
    loads directly. A subtitle error body is never handed to a parser and is the
    one thing a sibling `fetch` can actually read (D11), so this path is
    deliberately NOT in that set.
    """
    with pack() as p:
        r = client.get(f"/api/v1/streaming/{p.tid}/subtitles/abc")
    assert r.status_code == 422
    assert r.content, "the 422 body must not be blank on a subtitle route"
    assert isinstance(r.json()["detail"], list)


def test_the_vtt_route_answers_no_head(pack):
    """FastAPI never auto-adds HEAD to a GET route, and `classify.ts` is
    HEAD-only — so someone will try it on the one URL a media element loads.
    405 is the answer, recorded here rather than discovered on the set."""
    with pack() as p:
        r = client.head(VTT.format(tid=p.tid, index=GOOD))
    assert r.status_code == 405


def test_the_401_is_bodiless_and_reaches_nothing(auth_enabled, pack, reads,
                                                 monkeypatch):
    """Inherited from the router's `STREAM_GATED`, not invented here (D11).

    `content == b""` is the assertion, not the status: a JSON 401 reaches a
    `<track>` as a malformed cue file, and the television cannot tell that from
    a decode failure — which is exactly why readiness is learned from the LIST
    and never from mounting one of these.
    """
    def _must_not_run(*a, **k):
        raise AssertionError("an unauthenticated request reached the manager")

    monkeypatch.setattr(torrent_manager, "list_sidecars", _must_not_run)
    monkeypatch.setattr(torrent_manager, "get_torrent_status", _must_not_run)
    r = _get("t-401", GOOD)
    assert r.status_code == 401
    assert r.content == b""
    assert "detail" not in r.text
    assert reads == []
