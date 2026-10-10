"""A finished download, absent from the libtorrent session, is still streamable.

STEP 1 OF THIS FILE WAS A CHARACTERISATION TEST, NOT A FIX, and this is what it
recorded on `b9eccc6` for a `finished` torrent with a real complete file on disk
and no entry in `active_torrents` — the state a backend restart leaves behind:

    GET  /{id}/video                 404 {"detail": "Video file not found or not
                                          ready for streaming"}
    GET  /{id}/video?file_index=N    404 {"detail": "Video file index N not found
                                          in this torrent"}
    HEAD /{id}/video                 404, JSON content-type (body stripped by HTTP)
    GET  /{id}/info                  404 {"detail": "Video file not found or not
                                          ready for streaming"}
    GET  /{id}/files                 200 []

...while `get_torrent_status` answered `finished` at 100%. The mechanism, verified
rather than assumed:

* `Torrent.find_loadable_on_startup` loads only `ACTIVE_DOWNLOAD_STATES`
  ("Paused/stopped/finished/seeding/error stay unloaded"), so a restart never
  re-adds a finished torrent to the session.
* `_refresh_active_torrents` evicts `finished` mid-session as well (`seeding` is
  absent from that filter, so steady-state eviction hits only `finished`).
* `get_video_files` returns `[]` for anything not in `active_torrents`, so
  `get_video_file_info` answers `None` and `_resolve_video_file` 404s.
* And the handler for exactly this case was already written: `stream_file_range`'s
  "No live torrent (e.g. completed and removed from the session) -> every byte is
  already on disk; serve straight through" branch was unreachable only because
  resolution 404ed first.

STEP 2 made it reachable with a fallback in `_resolve_video_file` gated on four
conditions, each of which has its own row below:

1. a terminal, complete DB state (`finished` / `seeding` — NOT `error`/`blocked`);
2. `progress >= 100`;
3. `os.path.getsize(path) ==` the size the torrent metadata records;
4. the content guard: no `block_reason`, and video extensions only.

Guard 3 is the one that matters most, and guards 1-2 are why it is not enough on
its own: the straight-through branch does NO piece gating, so an ungated fallback
serves sparse zero bytes off a partial file into a decoder, which presents as
CORRUPT MEDIA rather than as an error. libtorrent writes at offsets in sparse
storage mode, so a half-finished file can already report its FULL length with
holes inside that read back as zeros — `test_a_sparse_full_length_file_is_refused`
is that case, and it is why the progress gate cannot be traded for a size check.

The file list comes from the stored resume data, not from a directory walk, and
the reason is the INDEX: `?file_index=N` is a libtorrent file index, which the
position of a file in a listing (or in a video-only sub-list) is not. The pack
built here has a non-video file sorting FIRST, so its video files do not start at
index 0 and `test_the_index_is_the_torrents_own_not_a_video_list_position` fails
for any implementation that renumbers them.

What this file does NOT claim: `/files` still answers `200 []` for an evicted
torrent (pinned below, deliberately unchanged), so a season pack streams while its
episode list remains unavailable after a restart. Recorded as a follow-up, not
fixed here — widening `get_video_files` is the download lifecycle, not this seam.
"""
import os
import types

import libtorrent as lt
import pytest
from fastapi.testclient import TestClient

from app.api import streaming as streaming_api
from app.database.models.torrents import Torrent as DbTorrent
from app.main import app
from app.torrent import manager as manager_mod
from app.torrent.manager import torrent_manager
from app.torrent.storage import encode_resume_data

client = TestClient(app)

VIDEO = "/api/v1/streaming/{tid}/video"
INFO = "/api/v1/streaming/{tid}/info"
FILES = "/api/v1/streaming/{tid}/files"

D_404_BAD_INDEX = "Video file index {n} not found in this torrent"
D_404_NOT_READY = "Video file not found or not ready for streaming"
D_404_NO_TORRENT = "Torrent not found"

# The pack every fixture builds. Two deliberate properties:
#   - E02 is the LARGEST file, so a bare request (no file_index) must resolve to
#     it and not to E01, exactly as the live path's "largest video file" rule does.
#   - `00-notes.nfo` sorts BEFORE both episodes (libtorrent orders a torrent's
#     files lexicographically), so the video files do not begin at index 0.
PACK = "Pack.S01"
NFO = f"{PACK}/00-notes.nfo"
E01 = f"{PACK}/Pack.S01E01.mkv"
E02 = f"{PACK}/Pack.S01E02.mkv"
CONTENT = {NFO: b"N" * 64, E01: b"A" * 2048, E02: b"B" * 4096}


# --------------------------------------------------------------------------
# The fixture: a real pack on disk, its REAL libtorrent resume data, a DB row,
# and nothing in active_torrents.
# --------------------------------------------------------------------------

def _write_pack(save_path, content):
    for rel, blob in content.items():
        p = save_path / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(blob)


def _torrent_info(save_path, content):
    """A real torrent over the files just written, so its resume data carries them."""
    fs = lt.file_storage()
    for rel, blob in content.items():
        fs.add_file(rel, len(blob))
    t = lt.create_torrent(fs, piece_size=16384)
    lt.set_piece_hashes(t, str(save_path))
    return lt.torrent_info(t.generate())


def _index_of(ti, rel):
    for i in range(ti.num_files()):
        if ti.file_at(i).path == rel:
            return i
    raise AssertionError(f"{rel} is not in the generated torrent")


@pytest.fixture
def pack(tmp_path, monkeypatch, session_factory, override_get_db):
    """A finished pack on disk plus a throwaway SQLite row.

    `get_db` is patched on BOTH modules that call it directly — the manager (for
    `get_torrent_status` and the fallback) and `streaming` (for /info's content_id
    block) — so the live Postgres is never read or written.
    """
    monkeypatch.setattr(manager_mod, "get_db", override_get_db)
    monkeypatch.setattr(streaming_api, "get_db", override_get_db)

    def _build(*, tid="t-done", state="finished", progress=100.0,
               block_reason=None, resume=True, content=None, after=None):
        save_path = tmp_path / tid
        content = dict(CONTENT if content is None else content)
        _write_pack(save_path, content)
        ti = _torrent_info(save_path, content)
        blob = None
        if resume:
            atp = lt.add_torrent_params()
            atp.ti = ti
            atp.save_path = str(save_path)
            blob = encode_resume_data(lt.write_resume_data_buf(atp))
        # `after` edits the bytes on disk AFTER the metadata was sealed, which is
        # how a truncated, hole-punched or deleted file is modelled.
        if after is not None:
            after(save_path)
        with override_get_db() as db:
            db.add(DbTorrent(
                id=tid, movie_title="A Pack", quality="1080p",
                magnet="magnet:?xt=urn:btih:deadbeef",
                url="magnet:?xt=urn:btih:deadbeef",
                save_path=str(save_path), state=state, progress=progress,
                block_reason=block_reason, resume_data=blob,
                tmdb_id=1399, media_type="tv",
            ))
        # The whole point of the fixture: the session knows nothing about it.
        assert tid not in torrent_manager.active_torrents
        # The manager memoises file lists per torrent id, so clear the entry
        # rather than let one test's blob answer another test's request.
        torrent_manager._resume_video_files.pop(tid, None)
        return types.SimpleNamespace(
            tid=tid, save_path=save_path, ti=ti,
            index=lambda rel: _index_of(ti, rel),
            path=lambda rel: str(save_path / rel),
        )

    return _build


# ==========================================================================
# The characterisation, inverted: what used to 404 is what the television plays.
# ==========================================================================

@pytest.mark.parametrize("state", ["finished", "seeding"])
def test_the_bare_get_serves_the_largest_video_file(pack, state):
    p = pack(state=state)
    r = client.get(VIDEO.format(tid=p.tid))
    assert r.status_code == 200
    assert r.content == CONTENT[E02]
    assert r.headers["Content-Length"] == str(len(CONTENT[E02]))
    assert r.headers["Content-Type"] == "video/x-matroska"
    assert r.headers["Accept-Ranges"] == "bytes"


def test_an_explicit_index_serves_that_exact_episode(pack):
    p = pack()
    r = client.get(VIDEO.format(tid=p.tid) + f"?file_index={p.index(E01)}")
    assert r.status_code == 200
    assert r.content == CONTENT[E01]


def test_a_range_request_is_a_206_read_straight_off_disk(pack):
    p = pack()
    r = client.get(VIDEO.format(tid=p.tid), headers={"Range": "bytes=10-19"})
    assert r.status_code == 206
    assert r.content == CONTENT[E02][10:20]
    assert r.headers["Content-Range"] == f"bytes 10-19/{len(CONTENT[E02])}"


def test_head_answers_the_size_of_the_file_on_disk(pack):
    p = pack()
    r = client.head(VIDEO.format(tid=p.tid))
    assert r.status_code == 200
    assert r.headers["Content-Length"] == str(len(CONTENT[E02]))
    assert r.headers["Accept-Ranges"] == "bytes"


def test_info_answers_the_video_file_block(pack):
    p = pack()
    r = client.get(INFO.format(tid=p.tid) + f"?file_index={p.index(E01)}")
    assert r.status_code == 200
    body = r.json()
    assert body["video_file"]["name"] == "Pack.S01E01.mkv"
    assert body["video_file"]["size"] == len(CONTENT[E01])
    assert body["video_file"]["progress"] == 100.0
    assert body["file_index"] == p.index(E01)
    assert body["state"] == "finished"
    # The watch identity still resolves, so a heartbeat is not orphaned.
    assert body["content_id"] == "tv:1399:s1:e1"


def test_files_still_answers_an_empty_list(pack):
    # RECORDED, NOT FIXED. /files reads get_video_files, which is session-only.
    # `200 []` therefore still means "not ready, or evicted" and never "this pack
    # has no episodes" — but a finished pack now streams while its episode list is
    # unavailable, which is this task's headline follow-up.
    p = pack()
    r = client.get(FILES.format(tid=p.tid))
    assert r.status_code == 200
    assert r.json() == []


def test_the_index_is_the_torrents_own_not_a_video_list_position(pack):
    """`?file_index=N` is a libtorrent file index, and nothing else.

    The nfo sorts before both episodes, so the video files do not start at index
    0. Any implementation that renumbered them (a directory walk, or an index into
    a video-only list) would serve E01 for index 0 instead of refusing it.
    """
    p = pack()
    assert p.index(NFO) < p.index(E01) < p.index(E02)
    assert p.index(E01) != 0
    assert client.get(VIDEO.format(tid=p.tid) + "?file_index=0").status_code == 404
    r = client.get(VIDEO.format(tid=p.tid) + f"?file_index={p.index(E01)}")
    assert r.status_code == 200
    assert r.content == CONTENT[E01]


def test_nothing_is_loaded_back_into_the_libtorrent_session(pack):
    # The fallback reads metadata out of the stored resume blob. It must not add
    # the torrent back: that would restart a download and, on ARM, spend one of
    # the two active slots the backend allows.
    p = pack()
    assert client.get(VIDEO.format(tid=p.tid)).status_code == 200
    assert p.tid not in torrent_manager.active_torrents


# ==========================================================================
# The four gates, one row each. All of these are still 404.
# ==========================================================================

@pytest.mark.parametrize("state", ["downloading", "queued", "downloading_metadata",
                                   "checking", "allocating", "paused", "stopped",
                                   "error", "blocked"])
def test_only_a_terminal_complete_state_falls_back(pack, state):
    # 'error' and 'blocked' are in states.TERMINAL_STATES and are still refused:
    # an errored download stopped at an arbitrary percentage, and a blocked one
    # had its files deleted by the content guard.
    p = pack(state=state)
    r = client.get(VIDEO.format(tid=p.tid))
    assert r.status_code == 404
    assert r.json()["detail"] == D_404_NOT_READY


def test_a_sparse_full_length_file_is_refused(pack):
    """The silent-corruption case, and the reason the progress gate exists.

    libtorrent writes at offsets in sparse storage mode, so a partially
    downloaded file can already report its FULL length with holes inside that read
    back as zeros. The size gate cannot see that; `progress >= 100` can. Serving
    this is not an error a player can report — it is corrupt media.
    """
    def _hole_punch(save_path):
        with open(save_path / E02, "r+b") as f:
            f.truncate(0)
            f.truncate(len(CONTENT[E02]))  # full length, every byte a hole

    p = pack(state="finished", progress=42.0, after=_hole_punch)
    # The trap is real: the file passes a size check and reads back as zeros.
    assert os.path.getsize(p.path(E02)) == len(CONTENT[E02])
    with open(p.path(E02), "rb") as f:
        assert f.read(16) == b"\x00" * 16
    r = client.get(VIDEO.format(tid=p.tid))
    assert r.status_code == 404
    assert r.json()["detail"] == D_404_NOT_READY


def test_a_truncated_file_is_refused(pack):
    """A `finished` row at 100% whose file is SHORT of what the metadata records.

    This is the gate the other three cannot cover, and the mutation that matters:
    make it unconditional and the endpoint answers 200 off a partial file.
    """
    def _truncate(save_path):
        with open(save_path / E02, "r+b") as f:
            f.truncate(1000)

    p = pack(after=_truncate)
    r = client.get(VIDEO.format(tid=p.tid))
    assert r.status_code == 404
    assert r.json()["detail"] == D_404_NOT_READY
    # Not a 200 with a short body, and not a HEAD 200 promising 1000 bytes either.
    assert client.head(VIDEO.format(tid=p.tid)).status_code == 404


def test_a_block_reason_is_refused_even_on_a_finished_row(pack):
    # The content guard, isolated from the state check: a row reading 'finished'
    # at 100% that carries a block_reason gets no fallback.
    p = pack(state="finished", progress=100.0, block_reason="executable payload")
    assert client.get(VIDEO.format(tid=p.tid)).status_code == 404


def test_a_non_video_file_index_is_refused(pack):
    # The content guard at the file level: the nfo is on disk, complete, and
    # addressable by index — and must not be streamable.
    p = pack()
    nfo = p.index(NFO)
    r = client.get(VIDEO.format(tid=p.tid) + f"?file_index={nfo}")
    assert r.status_code == 404
    assert r.json()["detail"] == D_404_BAD_INDEX.format(n=nfo)


def test_a_deleted_file_is_refused(pack):
    def _delete(save_path):
        (save_path / E02).unlink()

    # And NOT silently answered with E01, which is still intact: resolution never
    # falls back to a different file.
    p = pack(after=_delete)
    assert client.get(VIDEO.format(tid=p.tid)).status_code == 404


def test_without_resume_data_the_fallback_cannot_fire(pack):
    # A documented limit, not an accident: the resume blob is the only place a
    # torrent's file list survives eviction. A row that never saved one keeps the
    # 404 it has today.
    p = pack(resume=False)
    r = client.get(VIDEO.format(tid=p.tid))
    assert r.status_code == 404
    assert r.json()["detail"] == D_404_NOT_READY


def test_an_index_outside_the_torrent_still_names_the_index(pack):
    p = pack()
    r = client.get(VIDEO.format(tid=p.tid) + "?file_index=99")
    assert r.status_code == 404
    assert r.json()["detail"] == D_404_BAD_INDEX.format(n=99)


def test_info_keeps_its_two_404_details_distinguishable(pack):
    p = pack(state="downloading", progress=12.0)
    # Row present, nothing resolvable -> the video detail.
    r = client.get(INFO.format(tid=p.tid))
    assert r.status_code == 404
    assert r.json()["detail"] == D_404_NOT_READY
    # Row absent -> /info's own terminal detail, still a different string.
    r2 = client.get(INFO.format(tid="t-no-such-row"))
    assert r2.status_code == 404
    assert r2.json()["detail"] == D_404_NO_TORRENT
    assert r.json()["detail"] != r2.json()["detail"]


def test_a_row_the_database_does_not_have_is_unchanged(pack):
    pack()  # installs the patched get_db; the id below is simply not in it
    r = client.get(VIDEO.format(tid="t-no-such-row"))
    assert r.status_code == 404
    assert r.json()["detail"] == D_404_NOT_READY


# ==========================================================================
# The seam: a LIVE torrent must never reach the fallback.
# ==========================================================================

class _LiveTI:
    def __init__(self, files):  # [(path, size)]
        self._files = files

    def num_files(self):
        return len(self._files)

    def file_at(self, i):
        path, size = self._files[i]
        return types.SimpleNamespace(path=path, size=size, offset=0)

    def piece_length(self):
        return 16384

    def num_pieces(self):
        return 1


class _LiveHandle:
    """Enough of a libtorrent handle for get_video_files and the gated generator."""

    def __init__(self, files, save_path):
        self._ti = _LiveTI(files)
        self._save_path = str(save_path)

    def has_metadata(self):
        return True

    def get_torrent_info(self):
        return self._ti

    def file_progress(self):
        return [size for _, size in self._ti._files]

    def have_piece(self, _p):
        return True

    def set_sequential_download(self, _v):
        pass

    def piece_priority(self, _p, _pr):
        pass

    def set_piece_deadline(self, _p, _d):
        pass

    def reset_piece_deadline(self, _p):
        pass

    def status(self):
        return types.SimpleNamespace(
            save_path=self._save_path, num_peers=0, download_rate=0)


def _spy_on_fallback(monkeypatch):
    calls = []
    real = torrent_manager.get_completed_video_file_info

    def _spy(tid, file_index=None):
        calls.append((tid, file_index))
        return real(tid, file_index)

    monkeypatch.setattr(
        streaming_api.torrent_manager, "get_completed_video_file_info", _spy)
    return calls


def test_a_live_torrent_never_consults_the_fallback(pack, monkeypatch):
    """Proof the fallback stayed a narrow seam instead of becoming the path.

    The torrent is back in `active_torrents` with a live listing naming a
    DIFFERENT file, so "which file was served" distinguishes the two sources —
    and the fallback is spied on and must never be called at all.
    """
    p = pack()
    live_only = f"{PACK}/live-only.mkv"
    (p.save_path / live_only).write_bytes(b"L" * 777)
    calls = _spy_on_fallback(monkeypatch)

    torrent_manager.active_torrents[p.tid] = (
        _LiveHandle([(live_only, 777)], p.save_path), {})
    try:
        r = client.get(VIDEO.format(tid=p.tid))
    finally:
        del torrent_manager.active_torrents[p.tid]

    assert r.status_code == 200
    assert r.content == b"L" * 777   # the LIVE listing's file, not the metadata's
    assert calls == []               # and the fallback never ran


def test_the_fallback_runs_only_when_the_live_lookup_answers_nothing(pack, monkeypatch):
    # The same shape with the torrent absent. Without this row the test above
    # would pass for the wrong reason — a spy that was never installed.
    p = pack()
    calls = _spy_on_fallback(monkeypatch)
    r = client.get(VIDEO.format(tid=p.tid))
    assert r.status_code == 200
    assert calls == [(p.tid, None)]


def test_the_file_list_is_memoised_on_the_resume_blob(pack, monkeypatch):
    """The lookup runs on every Range request and on every /info poll.

    Parsing the blob once per request is wasted work on a Pi; parsing it once and
    then trusting the cache past a re-saved blob would be a stale file list. The
    cache key is the blob itself, so both are covered.
    """
    p = pack()
    reads = []
    real_read = lt.read_resume_data

    def _counting_read(buf):
        reads.append(len(buf))
        return real_read(buf)

    monkeypatch.setattr(manager_mod.lt, "read_resume_data", _counting_read)

    for _ in range(3):
        assert client.get(VIDEO.format(tid=p.tid)).status_code == 200
    assert len(reads) == 1

    # A re-saved resume blob must not be answered out of the old entry.
    torrent_manager._resume_video_files[p.tid] = (
        ("stale-fingerprint",),
        [{"index": 0, "path": "/nowhere", "size": 1, "downloaded": 1,
          "progress": 100.0, "name": "x.mkv"}])
    assert client.get(VIDEO.format(tid=p.tid)).status_code == 200
    assert len(reads) == 2
