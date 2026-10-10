"""Every answer the three streaming routes can give, as one executable contract.

The TV player's whole error story is a switch over what ``GET /video``,
``HEAD /video`` and ``GET /info`` return, and two careful recon passes over this
code disagreed about that switch **in both directions**. This file is the matrix
itself, so every later branch branches on something proved rather than recalled.
It is deliberately a little redundant with ``test_streaming_endpoint_416.py``,
``test_streaming_head.py`` and ``test_first_chunk_precheck.py``: those pin one
behaviour each, this one pins the *set* and the distinctions between its rows.

What the matrix says, and why each row is load-bearing for a client:

* **401 is empty-bodied on all three routes.** Asserted as ``content == b""``,
  not merely as a status: two of the three are loaded by a raw ``<video src>``,
  which hands whatever arrives to the decoder, and the status is the only thing
  the player can branch on. Needs the ``auth_enabled`` fixture — conftest pins
  the kill switch OFF session-wide and ``require_session`` short-circuits to
  ``_DEV_CONTEXT`` before it ever reads a cookie, so **the 401 path is dark in
  the default dev compose as well as in the suite**.
* **416 carries the size and NOT ``Accept-Ranges``.**
* **503 means three different things with one status.** Unallocated file,
  first-chunk timeout, and the catch-all are identical in status, in
  ``Retry-After`` and in body; only the presence of ``Accept-Ranges`` separates
  the first two from the third, and even that collapses two meanings into one
  answer. The catch-all covers *permanent* faults, which is why a client ladder
  over 503 has to be bounded rather than retried forever.
* **404 comes in four distinct detail strings**, and the string is the only thing
  that separates "deleted from disk" from "evicted from the session" from "bad
  index". ``/info`` does **not** route through ``_resolve_video_file``, so it has
  no index-specific 404 — a client cannot read ``/info``'s 404 as if it were
  ``/video``'s. (These 404s are JSON-bodied ``HTTPException``s. That is an
  observation, not an endorsement: it is the one documented escape from the
  empty-body contract on a route a decoder loads. Nothing here changes it.)
* **422 happens**, contrary to one recon's claim. ``?file_index=null``, ``NaN``
  and the empty string all fail parameter validation, and before the scoped
  handler in ``main.py`` that meant a ``{"detail": [...]}`` JSON document fed to
  a decoder through a raw ``<video src>``. The handler is scoped to the two video
  paths, and the non-video rows below pin that scoping: three live frontend
  readers of ``response.data.detail`` depend on the default shape surviving.
* **HEAD answers 200 where GET answers 503**, every time. ``head_video`` runs
  ``os.path.getsize`` with no guard, while ``parse_range_header``'s
  ``if file_size <= 0`` is consulted only by GET. So a HEAD 200 is **not**
  evidence that playback will start, and a HEAD probe **structurally cannot see
  the 503**. Both halves of that asymmetry are pinned on purpose.
* **The first-chunk budget is 2s on a dead swarm**, not 60. The common TV
  failure — no peers — is answered in about two seconds.
* **``quality`` is accepted and never read** on both video routes.
"""
import asyncio
import inspect
import os
import re
import types

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.api import streaming as streaming_api
from app.torrent.manager import torrent_manager

client = TestClient(app)

VIDEO = "/api/v1/streaming/{tid}/video"
INFO = "/api/v1/streaming/{tid}/info"

# The four distinct 404 detail strings reachable across the three routes.
D_404_BAD_INDEX = "Video file index {n} not found in this torrent"
D_404_NOT_READY = "Video file not found or not ready for streaming"
D_404_NOT_ON_DISK = "Video file not found on disk"
D_404_NO_TORRENT = "Torrent not found"


# --------------------------------------------------------------------------
# Fixtures. Each one stubs exactly the manager calls the route under test makes,
# so a row that passes is a row about the endpoint and not about libtorrent.
# --------------------------------------------------------------------------

def _stub_info(monkeypatch, path, size, *, index=0, name="movie.mkv"):
    """Install a get_video_file_info that records every (tid, file_index) it gets."""
    info = {"index": index, "path": str(path), "size": size,
            "downloaded": size, "progress": 100.0, "name": name}
    calls = []

    def _get(tid, fi=None):
        calls.append((tid, fi))
        return info

    monkeypatch.setattr(streaming_api.torrent_manager, "get_video_file_info", _get)
    return info, calls


@pytest.fixture
def ready_video(tmp_path, monkeypatch):
    """A 1000-byte file, fully downloaded, first chunk available."""
    f = tmp_path / "movie.mkv"
    f.write_bytes(b"X" * 1000)
    info, calls = _stub_info(monkeypatch, f, 1000)
    monkeypatch.setattr(
        streaming_api.torrent_manager, "get_torrent_status",
        lambda tid: types.SimpleNamespace(
            progress=100.0, movie_title="A Film", quality="1080p", state="seeding"),
    )
    monkeypatch.setattr(
        streaming_api.torrent_manager, "prioritize_video_files", lambda *a, **k: True)
    monkeypatch.setattr(
        streaming_api.torrent_manager, "force_start_for_stream", lambda *a, **k: True)

    async def _ready(*a, **k):
        return True

    monkeypatch.setattr(streaming_api.torrent_manager, "wait_for_first_chunk", _ready)
    return types.SimpleNamespace(info=info, path=f, calls=calls)


@pytest.fixture
def unallocated_video(tmp_path, monkeypatch):
    """Metadata has arrived; libtorrent has not allocated the file. ZERO bytes."""
    f = tmp_path / "movie.mkv"
    f.write_bytes(b"")
    info, calls = _stub_info(monkeypatch, f, 0)
    monkeypatch.setattr(
        streaming_api.torrent_manager, "get_torrent_status",
        lambda tid: types.SimpleNamespace(
            progress=0.0, movie_title="A Film", quality="1080p", state="allocating"),
    )
    monkeypatch.setattr(
        streaming_api.torrent_manager, "prioritize_video_files", lambda *a, **k: True)
    monkeypatch.setattr(
        streaming_api.torrent_manager, "force_start_for_stream", lambda *a, **k: True)
    return types.SimpleNamespace(info=info, path=f, calls=calls)


@pytest.fixture
def sparse_video(tmp_path, monkeypatch):
    """The file is on disk at its FULL size (sparse allocation) but the pieces
    backing the requested range never arrive: the first-chunk 503."""
    f = tmp_path / "movie.mkv"
    f.write_bytes(b"\0" * 4096)
    info, calls = _stub_info(monkeypatch, f, 4096)
    monkeypatch.setattr(
        streaming_api.torrent_manager, "get_torrent_status",
        lambda tid: types.SimpleNamespace(
            progress=12.0, movie_title="A Film", quality="1080p", state="downloading"),
    )
    monkeypatch.setattr(
        streaming_api.torrent_manager, "prioritize_video_files", lambda *a, **k: True)
    monkeypatch.setattr(
        streaming_api.torrent_manager, "force_start_for_stream", lambda *a, **k: True)

    async def _never(*a, **k):
        return False

    monkeypatch.setattr(streaming_api.torrent_manager, "wait_for_first_chunk", _never)
    return types.SimpleNamespace(info=info, path=f, calls=calls)


@pytest.fixture
def exploding_video(tmp_path, monkeypatch):
    """Resolution succeeds, then something inside the try fails: the catch-all."""
    f = tmp_path / "movie.mkv"
    f.write_bytes(b"X" * 1000)
    info, calls = _stub_info(monkeypatch, f, 1000)

    def _boom(*a, **k):
        raise RuntimeError("invalid torrent handle")

    monkeypatch.setattr(streaming_api.torrent_manager, "get_torrent_status", _boom)
    return types.SimpleNamespace(info=info, path=f, calls=calls)


@pytest.fixture
def no_video_file(monkeypatch):
    """NOTHING resolves a video file: metadata not ready, or evicted.

    Two resolvers have to be stubbed, not one. Task 2 added a completed-on-disk
    fallback (`get_completed_video_file_info`) that `_resolve_video_file` consults
    when the live session answers nothing, so stubbing only `get_video_file_info`
    would leave these 404 rows asserting something about whatever database the
    process happens to reach rather than about the endpoint. The pinned answers
    below are unchanged — a finished torrent with a real file on disk is a 200
    now, and `test_finished_torrent_streamable.py` owns that row.
    """
    calls = []

    def _get(tid, fi=None):
        calls.append((tid, fi))
        return None

    monkeypatch.setattr(streaming_api.torrent_manager, "get_video_file_info", _get)
    monkeypatch.setattr(
        streaming_api.torrent_manager, "get_completed_video_file_info",
        lambda tid, fi=None: None)
    monkeypatch.setattr(
        streaming_api.torrent_manager, "get_torrent_status",
        lambda tid: types.SimpleNamespace(
            progress=0.0, movie_title="A Film", quality="1080p", state="queued"),
    )
    return calls


# ==========================================================================
# 401 — empty-bodied, on all three routes.
# ==========================================================================

@pytest.mark.parametrize("template", [VIDEO, INFO])
def test_401_has_an_empty_body_on_the_get_routes(auth_enabled, template):
    # content == b"" is the whole assertion, not the status. A JSON or HTML 401
    # reaches the decoder as corrupt media and PatchedVideoPlayer classifies a
    # network error during an active download as RECOVERABLE, so a body here
    # presents as a mysterious playback fault that never prompts a sign-in.
    r = client.get(template.format(tid="t-401"))
    assert r.status_code == 401
    assert r.content == b""
    assert "detail" not in r.text


def test_401_on_the_head_route_promises_no_body_either(auth_enabled):
    """HEAD needs its own row because ``content == b""`` is VACUOUS on a HEAD.

    The protocol strips the body from every HEAD response, so that assertion
    passes whatever ``bare_401`` returns — measured, not reasoned: giving the
    handler a one-byte body failed the two GET rows above while a
    ``content == b""`` row here stayed green. The headers are the only evidence
    available, and they are enough — a bodied 401 still announces its length and
    its media type on a HEAD, so this row fails under that same mutation.
    """
    r = client.head(VIDEO.format(tid="t-401"))
    assert r.status_code == 401
    assert int(r.headers.get("content-length", "0")) == 0
    assert "json" not in r.headers.get("content-type", "")


def test_the_401_is_reached_before_the_route_does_any_work(auth_enabled, monkeypatch):
    # The gate is the router-level dependency, so an unauthenticated request must
    # not resolve a file, touch the torrent, or distinguish a real torrent id from
    # a made-up one.
    def _must_not_run(*a, **k):
        raise AssertionError("an unauthenticated request reached the manager")

    monkeypatch.setattr(
        streaming_api.torrent_manager, "get_video_file_info", _must_not_run)
    monkeypatch.setattr(
        streaming_api.torrent_manager, "get_torrent_status", _must_not_run)

    assert client.get(VIDEO.format(tid="t-401")).status_code == 401


def test_auth_is_off_by_default_so_the_401_path_is_dark():
    # Not a tautology about the fixture: it is the reason every other row in this
    # file can be written without a cookie, and the reason nobody has ever seen a
    # 401 from these routes in the default dev compose.
    from app.config import settings
    assert settings.auth_enabled is False
    r = client.get(VIDEO.format(tid="t-nothing-here"))
    assert r.status_code != 401


# ==========================================================================
# 416 — the size, and no Accept-Ranges.
# ==========================================================================

def test_416_carries_the_resource_size_and_no_accept_ranges(ready_video):
    r = client.get(VIDEO.format(tid="t-416"), headers={"Range": "bytes=5000-"})
    assert r.status_code == 416
    assert r.headers["Content-Range"] == "bytes */1000"
    # RFC 7233 §4.4 asks for the size; this response deliberately does NOT
    # re-advertise range support, so Accept-Ranges is not a usable discriminator
    # between a 416 and the 503s below.
    assert "Accept-Ranges" not in r.headers
    assert r.content == b""


# ==========================================================================
# 503 × 3 — three meanings, one status.
# ==========================================================================

def test_503_unallocated_file_carries_accept_ranges(unallocated_video):
    r = client.get(VIDEO.format(tid="t-503a"))
    assert r.status_code == 503
    assert r.headers["Retry-After"] == "2"
    assert r.headers["Accept-Ranges"] == "bytes"
    assert r.content == b""


def test_503_first_chunk_timeout_carries_accept_ranges(sparse_video):
    r = client.get(VIDEO.format(tid="t-503b"), headers={"Range": "bytes=2048-"})
    assert r.status_code == 503
    assert r.headers["Retry-After"] == "2"
    assert r.headers["Accept-Ranges"] == "bytes"
    assert r.content == b""


def test_503_catch_all_does_not_carry_accept_ranges(exploding_video):
    r = client.get(VIDEO.format(tid="t-503c"))
    assert r.status_code == 503
    assert r.headers["Retry-After"] == "2"
    # The one asymmetry between the three. It is NOT a diagnostic the client can
    # rely on, because this branch covers both transient faults (a handle going
    # invalid) and permanent ones (the file deleted under the torrent).
    assert "Accept-Ranges" not in r.headers
    assert r.content == b""


def test_the_three_503s_are_otherwise_indistinguishable(
    tmp_path, monkeypatch, unallocated_video
):
    """Identical status, identical Retry-After, identical empty body.

    This is the row the client's retry ladder is designed against: a 503 cannot
    be read as "come back in two seconds and it will work", because one of the
    three paths is permanent. Hence a BOUNDED ladder ending in a terminal screen
    rather than an unbounded backoff.
    """
    unallocated = client.get(VIDEO.format(tid="t-u"))

    f = tmp_path / "sparse.mkv"
    f.write_bytes(b"\0" * 4096)
    _stub_info(monkeypatch, f, 4096)
    monkeypatch.setattr(
        streaming_api.torrent_manager, "get_torrent_status",
        lambda tid: types.SimpleNamespace(progress=12.0),
    )

    async def _never(*a, **k):
        return False

    monkeypatch.setattr(streaming_api.torrent_manager, "wait_for_first_chunk", _never)
    first_chunk = client.get(VIDEO.format(tid="t-f"), headers={"Range": "bytes=2048-"})

    def _boom(*a, **k):
        raise RuntimeError("invalid torrent handle")

    monkeypatch.setattr(streaming_api.torrent_manager, "get_torrent_status", _boom)
    catch_all = client.get(VIDEO.format(tid="t-c"))

    three = [unallocated, first_chunk, catch_all]
    assert [r.status_code for r in three] == [503, 503, 503]
    assert {r.headers["Retry-After"] for r in three} == {"2"}
    assert {r.content for r in three} == {b""}
    # ...and nothing else tells them apart either: no diagnostic header, no body.
    assert len({r.headers.get("Accept-Ranges") for r in three}) == 2


# ==========================================================================
# 404 × 4 distinct details.
# ==========================================================================

def test_404_bad_explicit_index_names_the_index(no_video_file):
    r = client.get(VIDEO.format(tid="t-404") + "?file_index=42")
    assert r.status_code == 404
    assert r.json()["detail"] == D_404_BAD_INDEX.format(n=42)


def test_404_no_index_means_not_ready_or_evicted(no_video_file):
    r = client.get(VIDEO.format(tid="t-404"))
    assert r.status_code == 404
    assert r.json()["detail"] == D_404_NOT_READY


def test_404_resolved_but_missing_from_disk_says_so(monkeypatch):
    # The ONLY thing separating "deleted out from under the torrent" from
    # "evicted from the libtorrent session" is this string.
    _stub_info(monkeypatch, "/nonexistent/path/movie.mkv", 4096)
    r = client.get(VIDEO.format(tid="t-404"))
    assert r.status_code == 404
    assert r.json()["detail"] == D_404_NOT_ON_DISK


def test_404_info_has_its_own_torrent_not_found(monkeypatch):
    monkeypatch.setattr(
        streaming_api.torrent_manager, "get_torrent_status", lambda tid: None)
    r = client.get(INFO.format(tid="t-404"))
    assert r.status_code == 404
    assert r.json()["detail"] == D_404_NO_TORRENT


def test_info_does_not_route_through_resolve_video_file(no_video_file):
    # /info raises its own 404 and therefore has NO index-specific detail, even
    # when an explicit file_index was passed. A client must not read /info's 404
    # as if it were /video's.
    r = client.get(INFO.format(tid="t-404") + "?file_index=42")
    assert r.status_code == 404
    assert r.json()["detail"] == D_404_NOT_READY
    assert "42" not in r.json()["detail"]


def test_the_four_404_details_are_four_distinct_strings():
    assert len({
        D_404_BAD_INDEX.format(n=42),
        D_404_NOT_READY,
        D_404_NOT_ON_DISK,
        D_404_NO_TORRENT,
    }) == 4


# ==========================================================================
# 422 — it happens, and the body is scoped.
# ==========================================================================

@pytest.mark.parametrize("raw", ["null", "NaN", "", "undefined", "1.5", "abc"])
def test_422_on_the_video_route_has_an_empty_body(ready_video, raw):
    # A client that stringifies a missing index emits ?file_index=null. Parameter
    # validation fails before any endpoint code runs, and FastAPI's default
    # handler would answer {"detail": [...]} — JSON, through a raw <video src>,
    # into a decoder. main.py's scoped handler makes it bare.
    r = client.get(VIDEO.format(tid="t-422") + f"?file_index={raw}")
    assert r.status_code == 422
    assert r.content == b""
    assert "application/json" not in r.headers.get("Content-Type", "")


def test_422_on_the_head_route_promises_no_body_either(ready_video):
    # Header-asserted for the same measured reason as the HEAD 401 row: a
    # `content == b""` assertion here stayed green with the scoped handler
    # unregistered, because the protocol strips HEAD bodies.
    r = client.head(VIDEO.format(tid="t-422") + "?file_index=null")
    assert r.status_code == 422
    assert int(r.headers.get("content-length", "0")) == 0
    assert "json" not in r.headers.get("content-type", "")


def test_a_valid_file_index_is_not_a_422(ready_video):
    # Non-vacuity for the rows above: file_index=0 is a REAL index (the first
    # file of a season pack), so the 422 rows must be about validation and not
    # about the parameter being present at all.
    r = client.get(VIDEO.format(tid="t-422") + "?file_index=0")
    assert r.status_code == 200
    assert ("t-422", 0) in ready_video.calls


@pytest.mark.parametrize("url", [
    INFO.format(tid="t-422") + "?file_index=null",
    "/api/v1/streaming/progress/u-422?limit=abc",
])
def test_422_elsewhere_in_the_streaming_router_keeps_the_default_shape(
    no_video_file, url
):
    # Two sibling routes in the SAME router, both read as JSON by axios rather
    # than by a decoder. Blanking their 422 body would be a silent regression for
    # every JSON caller, and the scope lives one path segment away.
    r = client.get(url)
    assert r.status_code == 422
    _assert_default_422_shape(r)


def test_422_on_a_different_router_keeps_fastapis_default_body():
    """The scoping pin. Three live frontend readers take ``response.data.detail``
    off a 422: ``(bigscreen)/_data/title.ts``, ``(web)/claim/page.tsx`` and
    ``(web)/auth/reset-password/page.tsx``. This is that last one's own endpoint.
    An app-global bare-422 handler would break all three silently.
    """
    r = client.post("/api/v1/auth/reset-password", json={})
    assert r.status_code == 422
    _assert_default_422_shape(r)


def _assert_default_422_shape(r):
    body = r.json()
    assert isinstance(body, dict)
    assert isinstance(body["detail"], list)
    assert body["detail"], "FastAPI's default 422 names the offending fields"
    for entry in body["detail"]:
        assert {"loc", "msg", "type"} <= set(entry)


def test_the_bare_422_is_scoped_to_exactly_the_video_path():
    # Pinned against the compiled pattern, not re-derived, so a widened scope is
    # visible here rather than only at whichever route breaks first.
    from app.main import _BARE_422_PATHS

    assert _BARE_422_PATHS.match("/api/v1/streaming/abc/video")
    assert _BARE_422_PATHS.match("/api/v1/streaming/abc/video/")
    assert not _BARE_422_PATHS.match("/api/v1/streaming/abc/info")
    assert not _BARE_422_PATHS.match("/api/v1/streaming/abc/files")
    assert not _BARE_422_PATHS.match("/api/v1/streaming/abc/video/extra")
    assert not _BARE_422_PATHS.match("/api/v1/auth/reset-password")
    assert not _BARE_422_PATHS.match("/api/v1/movies/video")


# ==========================================================================
# HEAD 200 where GET says 503 — the asymmetry, pinned deliberately.
# ==========================================================================

def test_head_200s_at_zero_bytes_on_disk_where_get_503s(unallocated_video):
    """``head_video`` calls ``os.path.getsize`` with NO guard, while
    ``parse_range_header``'s ``if file_size <= 0`` is consulted only by GET.

    So a 200 from a HEAD probe is not evidence that playback will start. This is
    pinned as a *fact about the code*, not as desirable behaviour: a client that
    probes with HEAD and then plays must be ready for the GET to 503 anyway.
    """
    assert os.path.getsize(unallocated_video.path) == 0

    head = client.head(VIDEO.format(tid="t-head"))
    assert head.status_code == 200
    assert head.headers["Content-Length"] == "0"
    assert head.headers["Accept-Ranges"] == "bytes"
    assert head.headers["Content-Type"] == "video/x-matroska"
    assert head.content == b""

    assert client.get(VIDEO.format(tid="t-head")).status_code == 503


def test_head_200s_with_the_full_length_while_get_503s_on_the_first_chunk(sparse_video):
    # The sparse-allocation case: the file is at its full size on disk and zero
    # of it is verified. HEAD reports the full Content-Length from metadata.
    head = client.head(VIDEO.format(tid="t-head2"))
    assert head.status_code == 200
    assert head.headers["Content-Length"] == "4096"

    got = client.get(VIDEO.format(tid="t-head2"), headers={"Range": "bytes=2048-"})
    assert got.status_code == 503


def test_head_cannot_see_the_catch_all_503_either(exploding_video):
    # head_video never calls get_torrent_status, so the branch that explodes for
    # GET is not on HEAD's path at all.
    assert client.head(VIDEO.format(tid="t-head3")).status_code == 200
    assert client.get(VIDEO.format(tid="t-head3")).status_code == 503


def test_head_structurally_cannot_answer_503():
    """The behavioural rows prove three scenarios; this proves the general claim.

    Source-pinned because it is a claim about reachability, which no response can
    demonstrate: there is no input to ``head_video`` that produces a 503, because
    nothing on its path can emit one.
    """
    src = inspect.getsource(streaming_api.head_video)
    # Scan the body only, with comments stripped: the decorator above it carries a
    # long rationale comment, and a future sentence mentioning "503" there must
    # not fail this test or tempt anyone to delete it.
    body = src[src.index("async def head_video"):]
    body = re.sub(r"#.*", "", body)
    for forbidden in ("503", "Retry-After", "wait_for_first_chunk",
                      "parse_range_header", "StreamingResponse"):
        assert forbidden not in body, f"head_video now touches {forbidden}"


# ==========================================================================
# The first-chunk budget, both ends.
# ==========================================================================

class _SwarmHandle:
    def __init__(self, num_peers, download_rate):
        self._st = types.SimpleNamespace(
            num_peers=num_peers, download_rate=download_rate)

    def status(self):
        return self._st


@pytest.mark.parametrize("num_peers,rate,expected", [
    (0, 0, 2.0),            # the common TV failure: no peers -> ~2s, not 60
    (0, 9_999_999, 2.0),    # a stale rate cannot buy patience with no peers
    (4, 0, 8.0),            # peers but idle -> base
    (4, 65_536, 9.0),       # +1s of patience per ~64 kB/s
    (4, 52 * 65_536, 60.0),  # the cap is reached at ~3.4 MB/s
    (4, 999 * 65_536, 60.0),  # ...and never exceeded
])
def test_the_adaptive_budget_at_both_ends(num_peers, rate, expected):
    got = torrent_manager._adaptive_piece_timeout(_SwarmHandle(num_peers, rate))
    assert got == pytest.approx(expected)


def test_a_dead_swarm_is_refused_in_about_two_seconds_not_sixty(monkeypatch):
    # The row above, read as a client sees it: the budget the endpoint actually
    # spends before answering 503 comes from the live swarm, and on the common TV
    # failure — a title with no peers — it is the 2s end of the range, not the
    # 60s end. Spied rather than slept through, so the suite does not pay for it.
    seen = []

    class _Stuck:
        def has_metadata(self):
            return True

        def get_torrent_info(self):
            return types.SimpleNamespace(
                file_at=lambda i: types.SimpleNamespace(offset=0),
                piece_length=lambda: 64,
                num_pieces=lambda: 16,
            )

        def have_piece(self, _p):
            return False

        def piece_priority(self, _p, _pr):
            pass

        def set_piece_deadline(self, _p, _d):
            pass

        def reset_piece_deadline(self, _p):
            pass

        def set_sequential_download(self, _v):
            pass

        def status(self):
            return types.SimpleNamespace(num_peers=0, download_rate=0)

    # The real budget for this handle is the 2s end, not the 60s end.
    assert torrent_manager._adaptive_piece_timeout(_Stuck()) == 2.0

    def _spy(handle, **kw):
        seen.append(handle)
        return 0.01

    monkeypatch.setattr(torrent_manager, "_adaptive_piece_timeout", _spy)
    torrent_manager.active_torrents["t-budget"] = (_Stuck(), {})
    try:
        ok = asyncio.run(torrent_manager.wait_for_first_chunk("t-budget", 0, 0, 128))
    finally:
        torrent_manager.active_torrents.pop("t-budget", None)
    assert ok is False
    assert len(seen) == 1, "the default budget must come from the live swarm"


def test_the_explicit_override_kwarg_is_named_budget(monkeypatch):
    # The design notes call this `piece_timeout`; the real keyword is `budget`,
    # and an explicit one must bypass the swarm read entirely.
    sig = inspect.signature(torrent_manager.wait_for_first_chunk)
    assert "budget" in sig.parameters
    assert "piece_timeout" not in sig.parameters

    def _must_not_run(*a, **k):
        raise AssertionError("an explicit budget must not consult the swarm")

    monkeypatch.setattr(torrent_manager, "_adaptive_piece_timeout", _must_not_run)
    ok = asyncio.run(
        torrent_manager.wait_for_first_chunk("t-absent-budget", 0, 0, 128, budget=0.01)
    )
    # Absent from the session -> True before the budget is ever consulted.
    assert ok is True


# ==========================================================================
# `quality` is accepted and never read.
# ==========================================================================

def test_quality_changes_nothing_on_the_get_route(ready_video):
    plain = client.get(VIDEO.format(tid="t-q"))
    qualified = client.get(VIDEO.format(tid="t-q") + "?quality=2160p")

    assert plain.status_code == qualified.status_code == 200
    assert plain.content == qualified.content
    for h in ("Content-Length", "Content-Type", "Accept-Ranges"):
        assert plain.headers[h] == qualified.headers[h]
    # And nothing downstream ever saw it: every resolution call is (tid, index).
    assert ready_video.calls == [("t-q", None), ("t-q", None)]


def test_quality_changes_nothing_on_the_head_route(ready_video):
    plain = client.head(VIDEO.format(tid="t-q"))
    qualified = client.head(VIDEO.format(tid="t-q") + "?quality=720p&file_index=0")

    assert plain.status_code == qualified.status_code == 200
    assert plain.headers["Content-Length"] == qualified.headers["Content-Length"]
    assert plain.headers["Content-Type"] == qualified.headers["Content-Type"]
    assert ready_video.calls == [("t-q", None), ("t-q", 0)]


def test_quality_is_not_validated_so_garbage_is_not_a_422(ready_video):
    # It is declared Optional[str], so there is no value a client can send that
    # turns into a 422 here. Only file_index can do that.
    assert client.get(
        VIDEO.format(tid="t-q") + "?quality=%E2%98%A0&file_index=0"
    ).status_code == 200
