"""`GET /{tid}/subtitles` and `POST /{tid}/subtitles/{index}/fetch`.

What this file is really defending, in order of how badly it fails when wrong:

* **The envelope, not a bare array and not a 404.** `/files` already answers
  `200 []` with three meanings and this suite records in its own words that it
  "means 'not ready, or evicted' and never 'this pack has no episodes'"
  (`test_finished_torrent_streamable.py:226-230`) — RECORDED, NOT FIXED. A fourth
  bare empty list inherits a meaning this repo has already declared unusable, and
  a 404 is worse: the television's single status->copy map renders 404 as "The box
  doesn't recognise this title." (`(bigscreen)/_data/title.ts:488`) — a false
  sentence about a release that simply ships no `.srt`, which is the COMMON
  outcome. So `coverage` is `listed` / `none` / `unknown` and 404 means exactly
  two things: no row, or content-guard blocked.
* **`admitted: 0` is a 202.** It is the gate-4 no-op correction C1 measured: the
  sidecar shares a piece with a WANTED video file, so its bytes are already on
  their way and there was nothing to raise. A 409 there would have the television
  refuse a subtitle that is already coming.
* **The POST does not wait.** The admission is synchronous (a handful of
  libtorrent calls) but the span, the flush and the retraction are a background
  task, so the response must arrive while `have_piece` is still False. A handler
  that awaited it would hold a request open for `subtitle_admit_budget_ms`.
* **No `mime_type`, ever.** `/files` carries one from `get_mime_type`, whose table
  was RE-MEASURED in this very image as `.srt -> text/plain`,
  `.ass -> audio/aac`, `.ssa -> application/octet-stream`. Telling the television
  an `.ass` sidecar is AAC audio is a lie it would act on. (D10 and this file's
  first draft both said `.ssa -> None`; that is `mimetypes.guess_type`'s answer,
  not `get_mime_type`'s — `streaming.py:53` ends in
  `or 'application/octet-stream'`, so it never returns None and the wrong value
  arrives as a plausible string rather than as a validation error.)

Both halves of task 8(d) are here in spirit and apart in fact: the behavioural
spy below watches `prioritize_video_files` / `force_start_for_stream` through a
monkeypatch, and the SOURCE half lives in
`test_stage9_leaves_the_selectors_alone.py::test_module_level_forbidden_calls`,
whose `api/subtitles.py` row was skipped until this task landed the file and goes
live by itself now. Not duplicated here — a second witness to one rule is this
repo's own documented anti-pattern, and the two instruments catch different
things: the spy cannot see a call this module makes under a name it did not
monkeypatch, and the scan cannot see a call assembled at runtime.

The fakes are hand-written rather than imported from `test_sidecar_lister.py`.
That file's `_Handle` carries no `get_file_priorities`, no `piece_priority` and no
recorder, which the POST needs; and `test_stage9_leaves_the_selectors_alone.py`
copies rather than imports for the same reason.
"""
import asyncio
import contextlib
import time
import types

import libtorrent as lt
import pytest
from fastapi.testclient import TestClient
from httpx import ASGITransport, AsyncClient

from app.config import settings
from app.database.models.torrents import Torrent as DbTorrent
from app.main import app
from app.models import SubtitleList, SubtitleTrack
from app.torrent import manager as manager_mod
from app.torrent.manager import torrent_manager

client = TestClient(app)

LIST = "/api/v1/streaming/{tid}/subtitles"
FETCH = "/api/v1/streaming/{tid}/subtitles/{index}/fetch"

PL = 16 * 1024


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
    """Metadata with REAL accumulated offsets, so every file but the first sits at
    a non-zero offset — the property that makes the piece arithmetic falsifiable."""

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
    """A live handle that RECORDS every mutating libtorrent call it is asked for.

    `priorities` defaults to 7 for every video file and 0 for everything else —
    `prioritize_video_files`' own vector (`manager.py:1663`/`:1669`), which is the
    state a sidecar is really admitted from. (Those two line numbers were
    `:1404`/`:1410` in the plan, which measured them against `master`; task 7 added
    ~260 lines above them in this file.)
    """

    def __init__(self, ti, save_path, *, have=True, priorities=None,
                 metadata=True):
        self._ti = ti
        self._save_path = str(save_path)
        self._have = have
        self._metadata = metadata
        if priorities is None:
            priorities = [
                7 if str(ti.file_at(i).path).lower().endswith((".mkv", ".mp4"))
                else 0
                for i in range(ti.num_files())
            ]
        self._priorities = list(priorities)
        self.piece_priority_calls = []
        self.deadline_calls = []
        self.reset_calls = []
        self.file_priority_calls = []

    def has_metadata(self):
        return self._metadata

    def get_torrent_info(self):
        return self._ti

    def status(self):
        """The four rate/peer fields are here because `get_torrent_status`
        overlays them for any torrent in `active_torrents` (`manager.py:1027-1038`)
        and swallows the AttributeError into a None — which this route would then
        answer as a 404 "Torrent not found" for a perfectly live torrent. That is
        the shape of this fake's one previous bug."""
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

    def get_file_priorities(self):
        return list(self._priorities)

    def piece_priority(self, piece, prio):
        self.piece_priority_calls.append((piece, prio))

    def set_piece_deadline(self, piece, ms):
        self.deadline_calls.append((piece, ms))

    def reset_piece_deadline(self, piece):
        self.reset_calls.append(piece)

    def file_priority(self, index, prio):
        self.file_priority_calls.append((index, prio))
        self._priorities[index] = prio


@pytest.fixture(autouse=True)
def isolate(monkeypatch, override_get_db):
    """Every row through a throwaway SQLite, and no fetch task left running.

    `get_db` is patched on the MANAGER module, because that is where
    `get_torrent_status` calls it (the endpoint never opens a session of its own).
    Hazard 4: the test container talks to the real Postgres, which already holds a
    leaked `t-block-1` row from an earlier run.
    """
    monkeypatch.setattr(manager_mod, "get_db", override_get_db)
    torrent_manager._contiguous_runs.clear()
    torrent_manager._resume_video_files.clear()
    manager_mod._sidecar_fetch_tasks.clear()
    yield
    for task in list(manager_mod._sidecar_fetch_tasks.values()):
        # The TestClient closes its event loop with the request, so a pending
        # driver may have no loop left to cancel on. Best-effort by design.
        with contextlib.suppress(Exception):
            task.cancel()
    manager_mod._sidecar_fetch_tasks.clear()
    torrent_manager._contiguous_runs.clear()
    torrent_manager._resume_video_files.clear()


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


def _write(save_path, rows):
    for rel, size, pad in rows:
        if pad:
            continue
        p = save_path / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(b"\0" * size)


# A two-episode pack, pads interleaved exactly as libtorrent's own create_torrent
# produced them in the design round, and FOUR sidecars chosen so that three
# separate properties are falsifiable at once:
#   - E01 and E02 each have an English .srt, so a dedup that collapses a language
#     across the PACK rather than per episode loses one of them;
#   - E02 has a Spanish .srt, so the per-episode filter has more than one row to
#     keep;
#   - E02 has an English .ass of the SAME path length whose extension sorts BEFORE
#     `.srt`, which is the exact shape that makes an unconvertible row supersede a
#     servable one under dedup's `(forced, len(path), path)` tie-break.
PACK = [
    ("Pack.S01/info.nfo", 1024, False),                       # 0
    ("Pack.S01/.pad/15360", 15360, True),                     # 1
    ("Pack.S01/Pack.S01E01.mkv", 2 * PL, False),              # 2
    ("Pack.S01/Pack.S01E02.mkv", 2 * PL, False),              # 3
    ("Pack.S01/Subs/Pack.S01E01.en.srt", 2048, False),        # 4
    ("Pack.S01/Subs/Pack.S01E02.en.srt", 2048, False),        # 5
    ("Pack.S01/Subs/Pack.S01E02.es.srt", 3072, False),        # 6
    ("Pack.S01/Subs/Pack.S01E02.en.ass", 2048, False),        # 7
]
E01_INDEX, E02_INDEX = 2, 3


# A SECOND layout, added in review, because PACK above holds no two sidecars that
# share a language INSIDE one `(video_index, convertible)` group. Against PACK the
# two mis-grouping mutations redden — but so does nothing else: MEASURED, replacing
# `_deduped`'s whole body with `return sorted(described, ...)` left all 26 rows
# green, and so did grouping on `entry["index"]` (one row per group, so dedup can
# never collapse anything). Three `.srt` for one language in one `Subs/` folder is
# the ordinary shape of a packed Blu-ray rip, and D21 is the decision that the
# picker offers ONE row per language.
#
# Two videos on purpose: with one, the pairing ladder's `single` rung catches
# everything and no sidecar can ever report the `none` rung.
DUPES = [
    ("Show/Show.S01E01.mkv", 2 * PL, False),                 # 0
    ("Show/Show.S01E02.mkv", 2 * PL, False),                 # 1
    ("Show/Subs/Show.S01E01.en.srt", 2048, False),           # 2 shortest -> kept
    ("Show/Subs/alt/Show.S01E01.en.srt", 2048, False),       # 3 longer -> superseded
    ("Show/Subs/Show.S01E01.es.forced.srt", 3072, False),    # 4 only Spanish -> kept
    ("Show/Subs/stray.de.srt", 1024, False),                 # 5 pairs with nothing
]
DUPES_VIDEO = 0


@pytest.fixture
def pack(tmp_path, override_get_db):
    """The pack above, on disk, with a DB row and a live handle."""
    @contextlib.contextmanager
    def _build(tid="t-subs", *, rows=PACK, state="downloading", progress=42.0,
               block_reason=None, have=True, priorities=None, loaded_=True,
               on_disk=True):
        save_path = tmp_path / tid
        if on_disk:
            _write(save_path, rows)
        else:
            save_path.mkdir(parents=True, exist_ok=True)
        _row(override_get_db, tid, save_path, state=state, progress=progress,
             block_reason=block_reason)
        handle = _Handle(_TI(rows), save_path, have=have, priorities=priorities)
        if not loaded_:
            assert tid not in torrent_manager.active_torrents
            yield types.SimpleNamespace(tid=tid, handle=None,
                                        save_path=save_path)
            return
        with loaded(tid, handle):
            yield types.SimpleNamespace(tid=tid, handle=handle,
                                        save_path=save_path)

    return _build


def _get(tid, **params):
    r = client.get(LIST.format(tid=tid), params=params)
    return r


def _envelope(r):
    """Pin the ENVELOPE before reading anything out of it.

    Not ceremony: a handler that returned the rows as a bare array would satisfy
    every per-entry assertion in this file, so the shape is asserted once, here,
    and every row goes through it.
    """
    assert r.status_code == 200, r.text
    body = r.json()
    assert isinstance(body, dict), (
        f"the list must answer an ENVELOPE, not {type(body).__name__} — plan D6: "
        f"a bare array inherits /files' three-way-ambiguous 200 []"
    )
    assert "coverage" in body and "subtitles" in body
    assert isinstance(body["subtitles"], list)
    return body


# ==========================================================================
# (a) Three coverage rows, one fixture each
# ==========================================================================

def test_a_live_pack_with_sidecars_is_listed_with_every_field(pack):
    """The positive row, and the only one in this file carrying `ready: true`.

    Without it, "hard-code `ready: false`" is green everywhere else.
    """
    with pack() as p:
        r = _get(p.tid)
    body = _envelope(r)

    assert body["coverage"] == "listed"
    assert body["source"] == "session"
    assert body["state"] == "downloading"
    assert body["torrent_id"] == p.tid
    assert body["paired_to"] is None
    assert r.headers["Cache-Control"] == "no-store"

    entries = body["subtitles"]
    assert [e["index"] for e in entries] == [4, 5, 6, 7]
    first = entries[0]
    assert first == {
        "index": 4,
        "video_index": E01_INDEX,
        "pair_source": "stem",
        "season": 1,
        "episode": 1,
        "lang": "en",
        "label": "English",
        "flags": [],
        "format": "srt",
        "size": 2048,
        "ready": True,
        "convertible": True,
        "reason": None,
        "url": f"/api/v1/streaming/{p.tid}/subtitles/4",
    }
    # The URL carries the TORRENT's index, not the row's position. Asserted as a
    # whole string: `toContain('/subtitles/')`-shaped checks are satisfied by every
    # index, which is the mutation that matters here.
    assert [e["url"] for e in entries] == [
        f"/api/v1/streaming/{p.tid}/subtitles/{i}" for i in (4, 5, 6, 7)
    ]
    # Every other size in this file is 2048, so the whole-entry equality above
    # cannot tell a pass-through from a constant. Index 6 is the 3072-byte one.
    assert [e["size"] for e in entries] == [2048, 2048, 3072, 2048]


def test_a_live_pack_with_no_sidecars_is_none_and_not_a_404(pack):
    """The common outcome, per §7.5's own acknowledged gap.

    404 here makes the television say "The box doesn't recognise this title."
    about a release that simply ships no `.srt`.
    """
    rows = [r for r in PACK if not r[0].endswith((".srt", ".ass"))]
    with pack("t-bare", rows=rows) as p:
        r = _get(p.tid)
    body = _envelope(r)
    assert body["coverage"] == "none"
    assert body["source"] == "session"
    assert body["subtitles"] == []


def test_an_evicted_torrent_is_unknown_with_a_null_source(pack):
    """The PERMANENT answer for everything already in this library.

    The row is present and the files are on disk; the only thing missing is the
    session, and without a handle the file list is not enumerable at all (D5 —
    every resume blob this application writes carries no `info` dict). This is the
    row where a coverage computed from `len(entries) > 0`, or from
    `has_metadata()`, reddens.
    """
    with pack("t-evicted", loaded_=False) as p:
        r = _get(p.tid)
    body = _envelope(r)
    assert body["coverage"] == "unknown"
    assert body["source"] is None
    assert body["subtitles"] == []


def test_an_evicted_torrent_with_a_file_index_is_still_a_200(pack):
    """The filter is validated where there is metadata, and only there.

    The television passes the `?file_index=` of whatever it is watching, so
    404ing an evicted torrent's own index would replace `Subtitles · unavailable`
    with "The box doesn't recognise this title." — exactly the sentence the
    envelope exists to avoid.
    """
    with pack("t-evicted-idx", loaded_=False) as p:
        r = _get(p.tid, file_index=E02_INDEX)
    body = _envelope(r)
    assert body["coverage"] == "unknown"
    assert body["paired_to"] == E02_INDEX
    assert body["subtitles"] == []


def test_an_unknown_torrent_is_a_404(pack):
    r = _get("t-does-not-exist")
    assert r.status_code == 404
    assert r.json()["detail"] == "Torrent not found"


# ==========================================================================
# (b) A content-guard block is the other 404
# ==========================================================================

def test_a_blocked_row_is_a_404(pack):
    """`_block_torrent` removed the torrent and DELETED its files, with no unblock
    path (`manager.py:1567`), so every row it could list is about bytes that are
    gone. One such row (`t-block-1`) is live in the dev database right now."""
    with pack("t-blocked", state="blocked",
              block_reason="Contains an executable file") as p:
        r = _get(p.tid)
    assert r.status_code == 404


# ==========================================================================
# (c) ?file_index=N filters, and a bad one is refused rather than ignored
# ==========================================================================

def test_file_index_filters_to_that_episodes_sidecars(pack):
    with pack() as p:
        r = _get(p.tid, file_index=E02_INDEX)
    body = _envelope(r)
    assert body["paired_to"] == E02_INDEX
    assert [e["index"] for e in body["subtitles"]] == [5, 6, 7]
    assert {e["video_index"] for e in body["subtitles"]} == {E02_INDEX}
    assert {e["episode"] for e in body["subtitles"]} == {2}


def test_the_other_episodes_filter_keeps_only_its_own_row(pack):
    """The second arm, because one filter row cannot tell filtering from a
    coincidence: E01 has exactly one sidecar and E02 has three."""
    with pack() as p:
        r = _get(p.tid, file_index=E01_INDEX)
    body = _envelope(r)
    assert [e["index"] for e in body["subtitles"]] == [4]


def test_a_file_index_naming_a_non_video_file_is_refused(pack):
    """Index 0 is the `.nfo`. Silently answering the unfiltered list there would
    caption whichever episode sorts first."""
    with pack() as p:
        r = _get(p.tid, file_index=0)
    assert r.status_code == 404
    assert "0" in r.json()["detail"]


def test_an_out_of_range_file_index_is_refused(pack):
    with pack() as p:
        r = _get(p.tid, file_index=99)
    assert r.status_code == 404
    assert "99" in r.json()["detail"]


# ==========================================================================
# Dedup composes per episode and per convertibility class
# ==========================================================================

def test_english_survives_on_both_episodes(pack):
    """Dedup is per PAIRED VIDEO. `dedupe_by_language` collapses a language across
    whatever list it is handed, so one pass over a pack keeps ONE English sidecar
    and silently discards the other episodes' — and the television cannot recover,
    because the row it needs for the episode on screen is simply absent."""
    with pack() as p:
        body = _envelope(_get(p.tid))
    english = [(e["index"], e["video_index"]) for e in body["subtitles"]
               if e["lang"] == "en" and e["convertible"]]
    assert english == [(4, E01_INDEX), (5, E02_INDEX)]


def test_an_unconvertible_row_never_supersedes_a_servable_one(pack):
    """Both English entries for E02 survive, in different classes.

    Dedup's tie-break is `(forced, len(path), path)` and knows nothing about
    format: `Subs/Pack.S01E02.en.ass` and `Subs/Pack.S01E02.en.srt` are the same
    length and `.ass` sorts first, so deduping the two classes TOGETHER supersedes
    the only servable English track with one stage 9 refuses to convert (D17) and
    the viewer loses English for that episode with nothing to show why.
    """
    with pack() as p:
        body = _envelope(_get(p.tid, file_index=E02_INDEX))
    by_index = {e["index"]: e for e in body["subtitles"]}
    assert 5 in by_index and by_index[5]["convertible"] is True
    assert 7 in by_index and by_index[7]["convertible"] is False
    assert by_index[5]["lang"] == by_index[7]["lang"] == "en"


def test_two_english_sidecars_for_one_episode_collapse_to_one(pack):
    """`_deduped` must actually DEDUPE, not merely group the right way.

    The two rows above pin that the grouping key is not too COARSE. Nothing pinned
    that any grouping happens at all, and review measured the consequence: with
    PACK as the only fixture, `_deduped` reduced to `return sorted(described, ...)`
    is green on every other row in this file, and the picker would then show one
    "English" row per duplicate file.
    """
    with pack("t-dupes", rows=DUPES) as p:
        body = _envelope(_get(p.tid, file_index=DUPES_VIDEO))
    assert [e["index"] for e in body["subtitles"]] == [2, 4]
    assert [e["lang"] for e in body["subtitles"]] == ["en", "es"]
    # The SHORTER path wins (D21), so which of the two survives is decided rather
    # than incidental: index 3 is the same file one directory deeper.
    assert all(e["index"] != 3 for e in body["subtitles"])


def test_a_surviving_forced_track_carries_its_flag(pack):
    """`flags` is a pass-through and PACK never populates one.

    Measured: with PACK alone, `"flags": []` hard-coded in `_describe` is green on
    all 26 rows. The Spanish track is forced and is the ONLY Spanish one, so
    dedup's prefer-non-forced rule cannot hide it from this assertion.
    """
    with pack("t-forced", rows=DUPES) as p:
        body = _envelope(_get(p.tid, file_index=DUPES_VIDEO))
    spanish = [e for e in body["subtitles"] if e["lang"] == "es"]
    assert spanish, "the forced Spanish sidecar was dropped from the list"
    assert spanish[0]["flags"] == ["forced"]


def test_an_unpairable_sidecar_reports_the_none_rung_and_says_so_in_its_label(
        pack):
    """`pair_source` and `label` are pass-throughs too.

    Every PACK row pairs by `stem` and resolves to English, so measured, both
    `"pair_source": "stem"` and `"label": "English"` hard-coded in `_describe` are
    green on all 26 rows. D20's whole point is that the row CONFESSES which rung
    the pairing took, and `track_label` is what puts that confession on screen.
    This is also the only row that exercises `_deduped`'s unpaired group.
    """
    with pack("t-unpaired", rows=DUPES) as p:
        body = _envelope(_get(p.tid))
    stray = [e for e in body["subtitles"] if e["index"] == 5]
    assert stray, "the unpairable sidecar was dropped from the list"
    assert stray[0]["video_index"] is None
    assert stray[0]["pair_source"] == "none"
    assert stray[0]["label"] == "German (unmatched)"
    assert stray[0]["season"] is None and stray[0]["episode"] is None


def test_a_sidecar_whose_span_is_not_held_is_listed_with_ready_false(pack):
    """`ready` is the field the television mounts a `<track>` on.

    D7 makes it MEASURED rather than claimed, but every list row in this file was
    `ready: true` — so measured, `"ready": True` hard-coded in `_describe` was
    green on all 26, and the television would mount a track on a file that is not
    there. `have=False` leaves the piece span unheld while the file itself sits in
    `save_path` at its declared size: the half of D7's conjunction that
    `present_at_declared_size` cannot see on its own.
    """
    with pack("t-notready", rows=DUPES, have=False) as p:
        body = _envelope(_get(p.tid))
    assert body["subtitles"], "the fixture listed no sidecars"
    assert all(e["ready"] is False for e in body["subtitles"])
    # Not ready is not the same as not convertible: the row is still an offer.
    assert all(e["convertible"] is True for e in body["subtitles"])


def test_the_envelope_state_is_the_rows_own_state(pack):
    """`state` is read off the DB row and every other row here is `downloading`,
    so measured, hard-coding that one string was green on all 26."""
    with pack("t-seeding", rows=DUPES, state="seeding", progress=100.0) as p:
        body = _envelope(_get(p.tid))
    assert body["state"] == "seeding"


# ==========================================================================
# (d) The read reaches for none of the streaming path's machinery
# ==========================================================================

def test_the_list_calls_neither_selector_nor_force_start(pack, monkeypatch):
    """A spy, not a "no DB write" assertion — this one is falsifiable.

    `prioritize_video_files` rebuilds the whole priority vector and
    `force_start_for_stream` pins a torrent started; either on a polled GET would
    make reading the subtitle list cost the playhead its raised window. The source
    half of this gate is `test_stage9_leaves_the_selectors_alone.py`'s
    `api/subtitles.py` row, which went live when this task landed the file.
    """
    calls = []
    monkeypatch.setattr(torrent_manager, "prioritize_video_files",
                        lambda *a, **k: calls.append(("prioritize", a)))
    monkeypatch.setattr(torrent_manager, "force_start_for_stream",
                        lambda *a, **k: calls.append(("force", a)))
    with pack() as p:
        body = _envelope(_get(p.tid))
    # Non-vacuity: a spy over a list that answered nothing proves nothing.
    assert body["subtitles"], "the fixture listed no sidecars"
    assert calls == []


# ==========================================================================
# (e)/(f) An .ass is LISTED, and nothing carries a mime type
# ==========================================================================

def test_an_ass_sidecar_is_listed_with_its_format_and_refusal(pack):
    """Silence about a file the viewer can see in the release is a lie, and the
    picker's row depends on knowing the format (D17: a visible row with effect
    NONE, which is stage 8's own shape)."""
    with pack() as p:
        body = _envelope(_get(p.tid))
    ass = [e for e in body["subtitles"] if e["index"] == 7]
    assert ass, "the .ass sidecar was dropped from the list"
    assert ass[0]["format"] == "ass"
    assert ass[0]["convertible"] is False
    assert ass[0]["reason"] == "unsupported-format"


def test_no_entry_carries_a_mime_type(pack):
    """Re-measured in this image: `.srt -> text/plain`, `.ass -> audio/aac`,
    `.ssa -> application/octet-stream` (D10 says `None` for the last one, which is
    `mimetypes.guess_type`'s answer rather than `get_mime_type`'s — the latter ends
    in `or 'application/octet-stream'` at `streaming.py:53` and never returns None).
    `/files` hands its rows a `mime_type` from exactly that table
    (`api/streaming.py:497`); copying it here would tell the television an `.ass`
    sidecar is AAC audio.

    THREE assertions, and the third is the one that keeps the other two
    falsifiable. MEASURED: with pydantic's default `extra='ignore'` on
    `SubtitleTrack`, a handler that passes `mime_type=get_mime_type(...)` to
    every row is green on all 26 tests in this file — the value is silently
    dropped, so neither the wire check nor the schema check can see it. The
    guard only has teeth because the model FORBIDS extras, which turns that
    construction into a loud 500. Deleting `extra='forbid'` would therefore
    disarm this test without failing it, which is why the config itself is
    pinned here.
    """
    with pack() as p:
        body = _envelope(_get(p.tid))
    assert body["subtitles"]
    for entry in body["subtitles"]:
        assert "mime_type" not in entry, entry
    assert "mime_type" not in SubtitleTrack.model_fields
    assert SubtitleTrack.model_config.get("extra") == "forbid", (
        "SubtitleTrack must forbid extra fields, or the two assertions above "
        "cannot fail: pydantic's default silently drops an unexpected kwarg"
    )
    # The ENVELOPE's config was unpinned until review measured it: deleting
    # `extra='forbid'` from `SubtitleList` alone left all 26 rows green, so the
    # same silent-drop hazard applied to every envelope field.
    assert SubtitleList.model_config.get("extra") == "forbid", (
        "SubtitleList must forbid extra fields for the same reason"
    )


# ==========================================================================
# (g) The POST's matrix
# ==========================================================================

# A layout whose sidecar's piece span is its OWN: every file before it is
# piece-aligned, so piece 3 holds the two sidecars and nothing else.
ALIGNED = [
    ("Show/info.nfo", PL, False),              # 0  piece 0
    ("Show/Show.S01E01.mkv", 2 * PL, False),   # 1  pieces 1-2
    ("Show/Subs/E01.en.srt", 2048, False),     # 2  piece 3
    ("Show/Subs/E01.es.srt", 2048, False),     # 3  piece 3
]
ALIGNED_SUB = 2

# The unpadded layout gate 4 exists for: the video's 1000-byte tail shares the
# sidecar's first piece, so admitting it would mean a retraction that de-wants
# video bytes. Measured consequence (C1): residual -3048, the shared piece at
# priority 0, and the torrent back from seeding/100% to downloading/46.78%.
SHARED = [
    ("Show/Show.S01E01.mkv", 2 * PL - 1000, False),   # 0  pieces 0-1
    ("Show/Subs/E01.en.srt", 2048, False),            # 1  pieces 1-2
]
SHARED_SUB = 1

# A 4 MiB sidecar at a 16 KiB piece length spans 256 pieces, far over
# `subtitle_admit_max_pieces`. Listable (it is exactly at `subtitle_max_bytes`),
# and refused at admission — which is the only place a span cap can live, because
# `total_wanted` rises by the file's bytes while the download cost is whole pieces.
HUGE = [
    ("Show/Show.S01E01.mkv", 2 * PL, False),          # 0
    ("Show/Subs/E01.en.srt", 4 * 1024 * 1024, False),  # 1
]
HUGE_SUB = 1


def _fetch(tid, index):
    return client.post(FETCH.format(tid=tid, index=index))


async def _afetch(tid, index):
    """POST through an ASGI transport on the TEST's OWN event loop.

    `TestClient` is the wrong instrument for every row that looks at the driver,
    and the reason is measured rather than stylistic: its blocking portal closes
    the loop with the request, which CANCELS the fetch task before the sync test
    body resumes — the task runs its `finally`, retracts, and drops itself from
    the registry, so `_sidecar_fetch_tasks` reads empty and the admission
    recorder has picked up the retraction's `piece_priority(p, 0)`. Both of those
    look exactly like a handler that never started a task at all.

    On the test's own loop the task is still parked where the response left it,
    which is the state production is in the instant the 202 reaches the
    television.
    """
    async with AsyncClient(transport=ASGITransport(app=app),
                           base_url="http://testserver") as ac:
        return await ac.post(FETCH.format(tid=tid, index=index))


def _capture_loop(monkeypatch):
    """Do for the driver what `start_update_task` does in production.

    `TorrentManager._loop` is captured there (`manager.py:387`) and
    `await_pieces_async`'s wait begins with `self._loop.create_future()`, so
    without this the driver raises `'NoneType' object has no attribute
    'create_future'` the moment it is scheduled — the same line
    `test_await_pieces_async.py:35` writes for the same reason. Through
    `monkeypatch`, so this process-wide singleton is put back.
    """
    monkeypatch.setattr(torrent_manager, "_loop", asyncio.get_running_loop())


async def _drain(key):
    """Cancel the parked driver on the live loop, so its `finally` runs here."""
    task = manager_mod._sidecar_fetch_tasks.get(key)
    if task is None:
        return
    task.cancel()
    with contextlib.suppress(BaseException):
        await task


@pytest.mark.asyncio
async def test_the_post_admits_the_span_and_answers_202(pack, monkeypatch):
    _capture_loop(monkeypatch)
    with pack("t-admit", rows=ALIGNED, have=False, on_disk=False) as p:
        r = await _afetch(p.tid, ALIGNED_SUB)
        assert r.status_code == 202, r.text
        assert r.json() == {"admitted": 1,
                            "budget_ms": settings.subtitle_admit_budget_ms}
        # The admission really is piece-level, and it is the whole span.
        assert p.handle.piece_priority_calls == [(3, 7)]
        assert p.handle.deadline_calls == [(3, 0)]
        # Phase 1 touches NO file priority. C1: a file-level admission is undone
        # by `prioritize_video_files`' very next call and takes the playhead's
        # raised window with it.
        assert p.handle.file_priority_calls == []
        await _drain((p.tid, ALIGNED_SUB))


@pytest.mark.asyncio
async def test_the_gate_4_no_op_is_a_202_with_admitted_zero(pack, monkeypatch):
    """`admitted: 0` is a SUCCESS. The sidecar shares a piece with a wanted video
    file, so its bytes are already on their way; a 409 here would have the
    television refuse a subtitle that is already coming."""
    _capture_loop(monkeypatch)
    with pack("t-noop", rows=SHARED, have=False, on_disk=False) as p:
        r = await _afetch(p.tid, SHARED_SUB)
        assert r.status_code == 202, r.text
        assert r.json()["admitted"] == 0
        assert p.handle.piece_priority_calls == []
        await _drain((p.tid, SHARED_SUB))


def test_a_sidecar_already_wanted_is_a_409_naming_the_gate(pack):
    with pack("t-wanted", rows=ALIGNED, have=False, on_disk=False,
              priorities=[0, 7, 1, 0]) as p:
        r = _fetch(p.tid, ALIGNED_SUB)
    assert r.status_code == 409
    assert r.json() == {"reason": "not-deselected"}


def test_a_span_over_the_cap_is_a_409_naming_the_gate(pack):
    with pack("t-huge", rows=HUGE, have=False, on_disk=False) as p:
        r = _fetch(p.tid, HUGE_SUB)
    assert r.status_code == 409
    assert r.json() == {"reason": "span-too-large"}


def test_a_torrent_that_left_the_session_mid_request_is_a_409(pack,
                                                              monkeypatch):
    """The one reachable race: the list resolved the index and the session lost
    the handle before the admission ran. `_refresh_active_torrents` evicts
    `finished` mid-session, so this is a real sequence and not a contrivance."""
    with pack("t-raced", rows=ALIGNED, have=False, on_disk=False,
              loaded_=False) as p:
        rows = [{"index": ALIGNED_SUB, "rel_path": "Show/Subs/E01.en.srt",
                 "size": 2048, "format": "srt", "ready": False,
                 "convertible": True, "reason": None,
                 "path": str(p.save_path / "Show/Subs/E01.en.srt"),
                 "name": "E01.en.srt"}]
        monkeypatch.setattr(torrent_manager, "list_sidecars",
                            lambda tid: ("listed", rows))
        r = _fetch(p.tid, ALIGNED_SUB)
    assert r.status_code == 409
    assert r.json() == {"reason": "not-loaded"}


@pytest.mark.parametrize("index", [99, 1])
def test_an_index_the_list_did_not_produce_is_a_404(pack, index):
    """Both arms matter: 99 is out of range, and 1 is the VIDEO file. Resolution
    goes through the lister and nowhere else (D9), so a video index is as
    unfetchable as a missing one — and an implementation that resolved the index
    itself would admit pieces of the film on request."""
    with pack("t-404", rows=ALIGNED, have=False, on_disk=False) as p:
        r = _fetch(p.tid, index)
    assert r.status_code == 404
    assert str(index) in r.json()["detail"]


def test_the_post_404s_an_unknown_torrent_and_a_blocked_one(pack):
    assert _fetch("t-nothing", 2).status_code == 404
    with pack("t-blocked-post", rows=ALIGNED, block_reason="nope") as p:
        assert _fetch(p.tid, ALIGNED_SUB).status_code == 404


# (g2) ---------------------------------------------------------------------

@pytest.mark.asyncio
async def test_the_post_returns_before_the_span_is_held(pack, monkeypatch):
    """The response must arrive while `have_piece` is still False.

    The budget is shortened to 1.5 s for this row ONLY so the mutation is cheap to
    run: a handler that awaited the admission would answer in `budget_ms` rather
    than at once, which at the real 45 s default is a test that looks hung rather
    than failed. The elapsed bound is deliberately far from both numbers.
    """
    _capture_loop(monkeypatch)
    monkeypatch.setattr(settings, "subtitle_admit_budget_ms", 1500)
    with pack("t-async", rows=ALIGNED, have=False, on_disk=False) as p:
        started = time.monotonic()
        r = await _afetch(p.tid, ALIGNED_SUB)
        elapsed = time.monotonic() - started
        assert r.status_code == 202, r.text
        assert r.json()["budget_ms"] == 1500
        assert elapsed < 1.0, (
            f"the POST took {elapsed:.2f}s — it must not wait for the span; the "
            f"television learns the outcome by polling the list"
        )
        # One driver per (torrent_id, index), and it is still in flight: a double
        # OK press on the picker is the TV remote's normal failure mode, and two
        # drivers racing to flush and retract one file is what that would cost.
        assert list(manager_mod._sidecar_fetch_tasks) == [(p.tid, ALIGNED_SUB)]
        await _drain((p.tid, ALIGNED_SUB))


# (h) ---------------------------------------------------------------------

def test_a_non_integer_index_keeps_fastapis_default_422_body(pack):
    """The decision, pinned rather than left an omission.

    `_BARE_422_PATHS` (`main.py:223-225` — `:211-213` before this task's own
    `include_router` block moved it) blanks the body for the two routes a
    media decoder loads directly, because FastAPI's `{"detail": [...]}` reaches a
    `<video>` as corrupt media. A subtitle error body is never handed to a parser
    — it is the one thing a sibling `fetch` can actually read (D11) — so this path
    is NOT in that set.
    """
    with pack("t-422", rows=ALIGNED) as p:
        r = client.post(f"/api/v1/streaming/{p.tid}/subtitles/abc/fetch")
    assert r.status_code == 422
    assert r.content, "the 422 body must not be blank on a subtitle route"
    assert isinstance(r.json()["detail"], list)


def test_the_list_route_answers_no_head():
    """FastAPI never auto-adds HEAD to a GET route (pinned independently by
    `test_streaming_head.py:119-127`), and `classify.ts` is HEAD-only, so someone
    will try it. 405 is the answer, and it is recorded here rather than
    discovered on the set."""
    r = client.head(LIST.format(tid="t-anything"))
    assert r.status_code == 405
