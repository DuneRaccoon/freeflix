"""`/info` ships the seek boundary: `video_file.contiguous`, measured around `at`.

What this file pins, beyond "the key is there":

* **The boundary is NOT `downloaded`.** `downloaded`/`progress` in the same block
  are `file_progress()` totals counting scattered pieces, so a client drawing a
  bar from them permits exactly the seek the boundary exists to refuse. The
  deliberate-hole row below has a 90%-downloaded file whose run under the
  playhead is 216 bytes long.
* **Unknown serialises as `null`, with the key always present.** A stand-in zero
  run would be read as a ceiling of zero, which refuses every seek on a complete
  film — and a completed, evicted download is exactly the case that answers
  unknown. The client maps `null` to unbounded.
* **`at` reaches the manager as an integer, with the RESOLVED file index**, so a
  bare arrival on a season pack measures the file it is actually going to play.
* **No seekable seconds, and no `response_model`.** There is no duration anywhere
  in the backend and this route has no profile identity (its only gate is a
  decorator-level `require_session_silent`, which resolves an account). Bytes
  plus `measured_against` go over the wire; the television converts.

`get_db` is patched on `streaming` throughout: /info's content_id block calls it
directly, and in the test container that reaches the live Postgres. The fakes come
from `test_contiguous_available.py`, so the walk these rows exercise is the real
one.
"""
import types

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.api import streaming as streaming_api
from app.torrent.manager import torrent_manager

from test_contiguous_available import _TI, _Pieces, loaded, clean_memo  # noqa: F401

client = TestClient(app)

VIDEO = "/api/v1/streaming/{tid}/video"
INFO = "/api/v1/streaming/{tid}/info"

TID = "t-boundary"


@pytest.fixture
def info_ready(tmp_path, monkeypatch, override_get_db):
    """A /info request that resolves a 1000-byte video file at pack index 1.

    `downloaded`/`progress` are settable: the point of several rows below is that
    they and the contiguous run disagree.
    """
    monkeypatch.setattr(streaming_api, "get_db", override_get_db)
    f = tmp_path / "Pack.S01E02.mkv"
    f.write_bytes(b"X" * 1000)

    def _build(*, downloaded=120, progress=12.0, index=1, state="downloading"):
        info = {"index": index, "path": str(f), "size": 1000,
                "downloaded": downloaded, "progress": progress,
                "name": "Pack.S01E02.mkv"}
        monkeypatch.setattr(
            streaming_api.torrent_manager, "get_video_file_info",
            lambda tid, fi=None: info)
        monkeypatch.setattr(
            streaming_api.torrent_manager, "get_torrent_status",
            lambda tid: types.SimpleNamespace(
                progress=progress, movie_title="A Pack", quality="1080p",
                state=state),
        )
        return types.SimpleNamespace(info=info, path=f)

    return _build


def _pack_handle():
    ti = _TI(offsets={0: 0, 1: 1000}, sizes={0: 1000, 1: 1000},
             piece_length=64, num_pieces=32)
    return _Pieces(ti, have={16, 17, 18})


# ==========================================================================
# The run itself, measured through the endpoint.
# ==========================================================================

def test_the_video_file_block_carries_the_run_containing_at(info_ready):
    info_ready()
    with loaded(TID, _pack_handle()):
        r = client.get(INFO.format(tid=TID) + "?file_index=1&at=100")
    assert r.status_code == 200
    assert r.json()["video_file"]["contiguous"] == {
        "file_index": 1,
        "file_size": 1000,
        "piece_length": 64,
        "run_start": 24,
        "run_end": 216,
        "complete": False,
        "measured_against": "metadata",
    }


def test_the_boundary_is_not_the_downloaded_total(info_ready):
    """The deliberate hole: 90% downloaded, 216 bytes contiguous under the playhead.

    A bar drawn from `downloaded` (or from `progress`) would permit a seek 900
    bytes in. The run under the playhead ends at 216, because the pieces ahead of
    the deadline window are not here yet — holes behind the frontier are the
    normal state while each Range request re-anchors the window.
    """
    info_ready(downloaded=900, progress=90.0)
    with loaded(TID, _pack_handle()):
        body = client.get(INFO.format(tid=TID) + "?file_index=1&at=100").json()
    block = body["video_file"]
    assert block["downloaded"] == 900
    assert block["progress"] == 90.0
    assert block["contiguous"]["run_end"] == 216
    assert block["contiguous"]["run_end"] != block["downloaded"]
    assert block["contiguous"]["complete"] is False


def test_a_complete_file_says_so(info_ready):
    info_ready(downloaded=1000, progress=100.0, state="seeding")
    ti = _TI(offsets={0: 0, 1: 1000}, sizes={0: 1000, 1: 1000},
             piece_length=64, num_pieces=32)
    with loaded(TID, _Pieces(ti, have=range(0, 32), file_progress=[1000, 1000])):
        block = client.get(
            INFO.format(tid=TID) + "?file_index=1&at=500").json()["video_file"]
    assert block["contiguous"]["complete"] is True
    assert block["contiguous"]["run_start"] == 0
    assert block["contiguous"]["run_end"] == 1000


# ==========================================================================
# Unknown is null, and the key is always present.
# ==========================================================================

def test_the_unknown_case_is_null_and_never_a_zero_run(info_ready):
    # Nothing in the session: the measurement cannot be made. A zero run here
    # would be read as "no seeking at all".
    info_ready()
    assert TID not in torrent_manager.active_torrents
    block = client.get(INFO.format(tid=TID) + "?at=100").json()["video_file"]
    assert "contiguous" in block, "the key is part of the contract, always"
    assert block["contiguous"] is None


def test_an_evicted_finished_torrent_answers_null_while_it_still_plays(
    tmp_path, monkeypatch, override_get_db
):
    """Task 2's handover, as /info sees it.

    A completed download is unloaded from the libtorrent session — by
    `find_loadable_on_startup` after a restart, by `_refresh_active_torrents`
    mid-session — and `_lookup_video_file`'s resume-data fallback is what keeps it
    playable. There is no live handle to measure a piece map against, so the
    boundary is `null`, and that is the DESIRABLE answer: the client reads it as
    unbounded, which is exactly right for a title whose every byte is on disk.

    The live resolver is stubbed to None and the completed-on-disk resolver to a
    real file, which is the shape task 2 built; `test_finished_torrent_streamable.py`
    owns the end-to-end version with real resume data.
    """
    monkeypatch.setattr(streaming_api, "get_db", override_get_db)
    f = tmp_path / "Finished.mkv"
    f.write_bytes(b"X" * 2048)
    info = {"index": 0, "path": str(f), "size": 2048, "downloaded": 2048,
            "progress": 100.0, "name": "Finished.mkv"}
    monkeypatch.setattr(
        streaming_api.torrent_manager, "get_video_file_info",
        lambda tid, fi=None: None)
    monkeypatch.setattr(
        streaming_api.torrent_manager, "get_completed_video_file_info",
        lambda tid, fi=None: info)
    monkeypatch.setattr(
        streaming_api.torrent_manager, "get_torrent_status",
        lambda tid: types.SimpleNamespace(
            progress=100.0, movie_title="A Film", quality="1080p",
            state="finished"),
    )

    r = client.get(INFO.format(tid="t-evicted") + "?at=1000")
    assert r.status_code == 200
    block = r.json()["video_file"]
    assert block["contiguous"] is None
    assert block["progress"] == 100.0
    # ...and it really is playable: HEAD answers the size off the same resolution.
    head = client.head(VIDEO.format(tid="t-evicted"))
    assert head.status_code == 200
    assert head.headers["Content-Length"] == "2048"


# ==========================================================================
# `at`: forwarded, defaulted, clamped, validated.
# ==========================================================================

@pytest.fixture
def spy(info_ready, monkeypatch):
    """Records every (torrent_id, file_index, at_bytes) the endpoint measures."""
    calls = []

    def _spy(tid, fi=None, at=0):
        calls.append((tid, fi, at))
        return None

    monkeypatch.setattr(
        streaming_api.torrent_manager, "contiguous_available", _spy)
    return calls


def test_at_is_forwarded_as_an_integer(spy, info_ready):
    info_ready()
    client.get(INFO.format(tid=TID) + "?file_index=1&at=123456")
    assert spy == [(TID, 1, 123456)]
    assert isinstance(spy[0][2], int)


def test_an_absent_at_is_the_prefix(spy, info_ready):
    info_ready()
    client.get(INFO.format(tid=TID) + "?file_index=1")
    assert spy == [(TID, 1, 0)], "no `at` means measure from the file's start"


def test_a_bare_request_measures_the_resolved_index(spy, info_ready):
    # The unresolved-episode arrival: no ?file_index, so the index measured must
    # be the one /info resolved and reported, never None and never 0 by accident.
    info_ready(index=3)
    body = client.get(INFO.format(tid=TID) + "?at=50").json()
    assert body["file_index"] == 3
    assert spy == [(TID, 3, 50)]


def test_a_negative_at_is_clamped_rather_than_refused(info_ready):
    info_ready()
    with loaded(TID, _pack_handle()):
        r = client.get(INFO.format(tid=TID) + "?file_index=1&at=-5")
    assert r.status_code == 200
    # Clamped to the file's first byte, whose piece is not here: a MEASURED
    # zero-length run, which is not the same answer as null.
    assert r.json()["video_file"]["contiguous"]["run_start"] == 0
    assert r.json()["video_file"]["contiguous"]["run_end"] == 0


def test_a_non_numeric_at_keeps_fastapis_default_422_body(info_ready):
    # /info is read by axios, not by a decoder, and main.py's bare-422 handler is
    # scoped to the two /video paths. A client that sends at=undefined must still
    # get the field-naming body three live frontend readers depend on.
    info_ready()
    r = client.get(INFO.format(tid=TID) + "?at=abc")
    assert r.status_code == 422
    body = r.json()
    assert isinstance(body["detail"], list) and body["detail"]
    assert {"loc", "msg", "type"} <= set(body["detail"][0])


# ==========================================================================
# What the walk replaced, and what /info stays.
# ==========================================================================

def test_info_makes_no_full_file_progress_pass_any_more(info_ready, monkeypatch):
    """`file_progress = torrent_manager.get_file_progress(torrent_id)` is gone.

    It was a full libtorrent pass over every file in the torrent, assigned once
    and never read — and /info is polled while a title is on screen. Deleting it
    partly pays for the contiguous walk. Asserted by making the call fatal: if
    anything restores that line, this row goes red instead of the cost going
    quietly back on.
    """
    info_ready()

    def _must_not_run(*a, **k):
        raise AssertionError("/info called get_file_progress again")

    monkeypatch.setattr(
        streaming_api.torrent_manager, "get_file_progress", _must_not_run)
    with loaded(TID, _pack_handle()):
        r = client.get(INFO.format(tid=TID) + "?file_index=1&at=100")
    assert r.status_code == 200
    assert r.json()["video_file"]["contiguous"]["run_end"] == 216


def test_info_is_still_a_bare_dict_with_no_response_model():
    # A response_model would have to declare `contiguous`, and a Pydantic model
    # here is the thing that would start dropping or coercing it. The route is
    # deliberately unmodelled; the frontend mirrors the shape in types/index.ts.
    route = next(r for r in app.routes
                 if getattr(r, "path", None) == "/api/v1/streaming/{torrent_id}/info")
    assert route.response_model is None


def test_no_seconds_are_shipped(info_ready):
    # There is no duration anywhere in the backend, so any "seekable seconds"
    # here would be invented. The client converts bytes against its own element.
    info_ready()
    with loaded(TID, _pack_handle()):
        block = client.get(
            INFO.format(tid=TID) + "?file_index=1&at=100").json()["video_file"]
    assert set(block["contiguous"]) == {
        "file_index", "file_size", "piece_length", "run_start", "run_end",
        "complete", "measured_against",
    }
    for key in block["contiguous"]:
        assert "second" not in key and "duration" not in key
