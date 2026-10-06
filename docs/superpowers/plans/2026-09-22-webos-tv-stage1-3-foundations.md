# webOS TV app — Stages 1–3 (foundations & the on-TV gate) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the streaming byte path safe for a TV media pipeline, stand up an empty `/bigscreen` surface with its own hand-authored stylesheet, and run the one on-TV test that can invalidate the rest of the design.

**Status: complete, and the gate changed the plan.** Task 8 ran on 2026-10-06 and returned the
**"Proceed, simplified"** verdict (see Task 8). The set reports Chromium 120 / webOS 25, not the
Chromium 87 this plan was written against, so the engine-driven constructs are no longer forbidden
and the `browserslist` pin is reverted. The performance-driven bans stay. Every "Chromium 87" below
is left in place as the record of what was built and why, with a correction note.

**Architecture:** Tasks 1–5 fix `backend/app/api/streaming.py` and `backend/app/torrent/manager.py` — all pure-Python, all unit-tested, all valuable to the existing web client. Tasks 6–7 split the Next.js app into two root layouts (`(web)` and `(bigscreen)`) so the TV surface can escape the Tailwind v4 global stylesheet, and ship a diagnostic page that doubles as the stage-3 instrument. Task 8 runs the gate on the real TV and records the result.

**Tech Stack:** FastAPI + libtorrent (Python 3.10, SQLAlchemy 1.4), pytest; Next.js 15 App Router / React 19 / TypeScript, vitest; hand-authored CSS (no Tailwind on the TV surface).

**Spec:** `docs/superpowers/specs/2026-09-22-webos-tv-app-design.md`

## Global Constraints

- **Branch:** `feat/webos-tv-app` (already created; the spec is committed there).
- ~~**Target engine: Chromium 87** (webOS TV 22).~~ **Corrected after the Task 8 gate — the engine is Chromium 120 (webOS 25).** As originally written, this constraint forbade, in anything under `(bigscreen)` or `public/bigscreen.css`: `@layer`, `@property`, `oklch()`, `oklab()`, `color-mix()`, `:has()`, `@container`, native CSS nesting, `backdrop-filter`, `mix-blend-mode`, SVG filters, `aspect-ratio`; and in JS `Array.prototype.at`, `Object.hasOwn`, `structuredClone`, top-level `await`. Everything in that list that was banned **because Chromium 87 cannot parse it** is now allowed. What remains forbidden, on **performance** grounds (spec §9 — TV GPU, not browser engine): `backdrop-filter`, `mix-blend-mode` / `background-blend-mode`, `filter: blur()`, SVG filters, plus `framer-motion`, `globals.css` and `@/components` imports. `legacy-target.test.ts` now states that split in its own comments so a future engine reassessment cannot take the performance bans with it.
- **No transcoding, no remuxing, no HLS, no ffmpeg.** The host is a Raspberry Pi.
- **SQLAlchemy 1.4 style**, not 2.0.
- **Conventional Commits** (`feat:`, `fix:`, `refactor:`, `test:`, `docs:`).
- **Backend tests are baked into the image, not bind-mounted.** A new or edited test file is invisible until `make build`, or run with an explicit mount:
  `docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest tests/<file> -v`
  Every test command in this plan uses that mount so no rebuild is needed.
- **Never add a `.env` key without adding the `Settings` field first** — `pydantic-settings` runs `extra='forbid'` and would crash the backend at import.
- **An auth dependency must never declare `Depends(get_db)`.** Not touched by this plan; do not introduce it.
- **Do not copy `api/schedules.py`'s session handling** — it is wrong and 500s.

---

## File Structure

| File | Responsibility | Task |
| --- | --- | --- |
| `backend/app/api/streaming.py` | Range parsing (`parse_range_header`, sentinels), `HEAD`/`GET /{id}/video`, MIME table | 1–5 |
| `backend/app/torrent/manager.py` | `wait_for_first_chunk` — piece availability for the first chunk, before the response starts | 5 |
| `backend/tests/test_range_header.py` | Existing unit tests for `parse_range_header`; extended | 1, 2 |
| `backend/tests/test_range_suffix.py` | NEW — suffix-range correctness in isolation | 1 |
| `backend/tests/test_streaming_endpoint_416.py` | Existing endpoint tests; extended with the malformed-range → 200 case | 2 |
| `backend/tests/test_streaming_head.py` | NEW — `HEAD` returns headers without entering the generator | 3 |
| `backend/tests/test_video_mime_types.py` | NEW — every configured video extension has an explicit MIME entry | 4 |
| `backend/tests/test_first_chunk_precheck.py` | NEW — unavailable first chunk yields 503, not a truncated 206 | 5 |
| `frontend/src/app/(web)/**` | Every existing route, moved. URLs unchanged | 6 |
| `frontend/src/app/(bigscreen)/layout.tsx` | TV root layout: own `<html>`/`<body>`, links `bigscreen.css`, no Tailwind | 7 |
| `frontend/src/app/(bigscreen)/bigscreen/diag/page.tsx` | The stage-3 diagnostic instrument, kept permanently at `/bigscreen/diag` | 7 |
| `frontend/src/app/(bigscreen)/error.tsx` | TV error boundary — the device has no console | 7 |
| `frontend/public/bigscreen.css` | Hand-authored TV stylesheet (tokens + base + diagnostic styles) | 7 |
| `frontend/src/app/(bigscreen)/legacy-target.test.ts` | Guard: greps the TV surface for forbidden constructs, bans `@/components` imports, pins the opt-out set | 7 |
| `frontend/src/app/(bigscreen)/bigscreen-tokens.test.ts` | Pins the ten TV colour tokens to their `globals.css` originals | 7 |
| `frontend/package.json` | ~~`browserslist` pinned to chrome 87~~ — added in Task 7, **reverted after the Task 8 gate** | 7, 8 |
| `docs/superpowers/plans/2026-09-22-webos-tv-stage3-results.md` | The gate's recorded findings + decision branches | 8 |

---

## Task 1: Suffix ranges (`bytes=-N`) return the LAST N bytes

A media pipeline issues `Range: bytes=-N` to locate a container index at EOF. Today
`backend/app/api/streaming.py:62-64` splits on `-`, gets `['', '500']`, and produces
`start=0, end=500` — **the first 501 bytes, served as a 206 claiming they are the last
ones.** Silently wrong data with a success status.

**Files:**
- Modify: `backend/app/api/streaming.py:45-71` (sentinels + `parse_range_header`)
- Test: `backend/tests/test_range_suffix.py` (create)

**Interfaces:**
- Consumes: nothing.
- Produces: `parse_range_header(range_header: Optional[str], file_size: int) -> tuple` returning either `(start, end)` inclusive, or the module sentinel `RANGE_NOT_SATISFIABLE`, or (added in Task 2) `RANGE_MALFORMED`. Compared with `is`, so always return the module-level constant, never a fresh `(-1, -1)`.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_range_suffix.py`:

```python
"""RFC 7233 suffix ranges: `bytes=-N` means the LAST N bytes.

Regression: the header was split on "-" and an empty first field became start=0,
so `bytes=-500` served the FIRST 501 bytes under a 206 claiming `bytes 0-500/size`.
TV media pipelines use a suffix range to find a container index at EOF, so this
handed the decoder the wrong bytes with a success status.
"""
from app.api.streaming import parse_range_header, RANGE_NOT_SATISFIABLE


def test_suffix_range_returns_tail_not_head():
    # last 500 bytes of a 1000-byte file == bytes 500..999
    assert parse_range_header("bytes=-500", 1000) == (500, 999)


def test_suffix_range_larger_than_file_is_whole_file():
    assert parse_range_header("bytes=-5000", 1000) == (0, 999)


def test_suffix_range_of_one_byte():
    assert parse_range_header("bytes=-1", 1000) == (999, 999)


def test_suffix_range_of_zero_is_unsatisfiable():
    # "the last 0 bytes" cannot be satisfied
    assert parse_range_header("bytes=-0", 1000) is RANGE_NOT_SATISFIABLE


def test_bare_dash_is_not_a_suffix_range():
    assert parse_range_header("bytes=-", 1000) is not None
    assert parse_range_header("bytes=-", 1000) != (0, 999)


def test_whitespace_tolerated():
    assert parse_range_header("bytes= 500 - 799 ", 1000) == (500, 799)
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" \
  backend python -m pytest tests/test_range_suffix.py -v
```

Expected: `test_suffix_range_returns_tail_not_head` FAILS with `assert (0, 500) == (500, 999)`.

- [ ] **Step 3: Rewrite `parse_range_header`**

In `backend/app/api/streaming.py`, replace the whole function body (currently lines 51-71) with:

```python
def parse_range_header(range_header: Optional[str], file_size: int) -> tuple:
    """Parse a Range header into (start, end) inclusive byte positions.

    Returns RANGE_NOT_SATISFIABLE when the range cannot be satisfied (HTTP 416),
    and RANGE_MALFORMED when the header is syntactically invalid or asks for
    something we do not implement (RFC 7233 §3.1: ignore it and serve the whole
    body). end past EOF is clamped; an out-of-bounds start is a client error.
    """
    if not range_header or not range_header.startswith('bytes='):
        if file_size <= 0:
            return RANGE_NOT_SATISFIABLE
        return 0, file_size - 1

    if file_size <= 0:
        return RANGE_NOT_SATISFIABLE

    spec = range_header[len('bytes='):].strip()

    if '-' not in spec:
        return RANGE_MALFORMED

    first, _, last = spec.partition('-')
    first, last = first.strip(), last.strip()

    try:
        if not first:
            # SUFFIX range: "bytes=-N" is the LAST N bytes, not the first N.
            # Media pipelines use this to find a container index at EOF, so
            # treating the empty first field as start=0 serves the wrong bytes
            # under a 206 that claims otherwise.
            if not last:
                return RANGE_MALFORMED          # "bytes=-" means nothing
            n = int(last)
            if n <= 0:
                return RANGE_NOT_SATISFIABLE    # "the last 0 bytes"
            return max(0, file_size - n), file_size - 1

        start = int(first)
        end = int(last) if last else file_size - 1
    except ValueError:
        return RANGE_MALFORMED

    if start < 0:
        return RANGE_MALFORMED
    if start >= file_size:
        return RANGE_NOT_SATISFIABLE
    # Checked after the out-of-bounds start: an open-ended range ("bytes=5000-")
    # defaults end to file_size - 1, which is < start whenever start is past EOF.
    # Checking end < start first would misreport that as malformed instead of
    # unsatisfiable and break test_start_beyond_filesize_is_unsatisfiable.
    if end < start:
        return RANGE_MALFORMED

    return start, min(end, file_size - 1)
```

Directly above it, extend the sentinel block (currently lines 45-48) to:

```python
# Sentinel returned by parse_range_header for an unsatisfiable range
# (start >= file_size, or a zero-length suffix). The endpoint maps this to HTTP 416.
RANGE_NOT_SATISFIABLE = (-1, -1)

# Sentinel for a syntactically invalid range, or one we do not implement
# (multipart). RFC 7233 §3.1 requires such a header to be IGNORED, so the
# endpoint serves 200 with the full body rather than 416 — a 416 invites a
# client to give up instead of retrying with a single range.
RANGE_MALFORMED = (-2, -2)
```

- [ ] **Step 4: Teach the endpoint both sentinels**

The new sentinel must be handled in the same task that introduces it — otherwise a malformed
range leaves `start, end = -2, -2` and the endpoint emits `Content-Range: bytes -2--2/{size}`.

In `stream_video`, replace the block currently at `backend/app/api/streaming.py:128-135`:

```python
        range_header = request.headers.get("Range")
        parsed = parse_range_header(range_header, file_size)
        if parsed is RANGE_NOT_SATISFIABLE:
            # RFC 7233 §4.4 — unsatisfiable range: 416 + the resource size.
            return Response(
                status_code=416,
                headers={"Content-Range": f"bytes */{file_size}"},
            )
        if parsed is RANGE_MALFORMED:
            # RFC 7233 §3.1 — ignore an invalid range and serve the whole body.
            # Clearing range_header is what makes the status 200 below, and what
            # keeps Content-Range out of the response.
            range_header = None
            start, end = 0, file_size - 1
        else:
            start, end = parsed
```

Then change the header construction (currently `:143-148`) so `Content-Range` is only sent for a
real range response:

```python
        headers = {
            "Accept-Ranges": "bytes",
            "Content-Length": str(content_length),
            "Content-Type": content_type,
        }
        if range_header:
            headers["Content-Range"] = f"bytes {start}-{end}/{file_size}"
```

`status_code = 206 if range_header else 200` at `:150` needs no change.

- [ ] **Step 5: Run the new and existing range tests**

```bash
docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" \
  backend python -m pytest tests/test_range_suffix.py tests/test_range_header.py -v
```

Expected: all PASS. The seven pre-existing tests in `test_range_header.py` must be
untouched and still green — they cover no-header, normal, open-ended, end-past-EOF,
start-at-EOF, start-past-EOF and empty-file.

- [ ] **Step 6: Commit**

```bash
git add backend/app/api/streaming.py backend/tests/test_range_suffix.py
git commit -m "fix(streaming): bytes=-N is the last N bytes, not the first N

A suffix range split on '-' produced start=0, so bytes=-500 served the
FIRST 501 bytes under a 206 claiming bytes 0-500/size. TV media pipelines
issue a suffix range to locate a container index at EOF, so this handed
the decoder wrong bytes with a success status."
```

---

## Task 2: Malformed and multipart ranges are ignored, not 500

`bytes=0-99,200-299` currently makes `int('99,200')` raise inside the `try` at
`backend/app/api/streaming.py:118`, caught at `:170-172` and returned as **HTTP 500 with a
JSON body** — which `<video>` hands to the decoder as corrupt media. Any non-numeric range
does the same.

Task 1 already routes both to `RANGE_MALFORMED`. This task teaches the endpoint to honour it.

**Files:**
- Modify: `backend/app/api/streaming.py` (`parse_range_header` multipart guard; `stream_video` sentinel handling)
- Test: `backend/tests/test_range_header.py` (extend), `backend/tests/test_streaming_endpoint_416.py` (extend)

**Interfaces:**
- Consumes: `parse_range_header`, `RANGE_NOT_SATISFIABLE`, `RANGE_MALFORMED` from Task 1.
- Produces: `GET /{torrent_id}/video` semantics — 416 for unsatisfiable, **200 with the full body** for malformed/multipart, 206 for a valid single range.

- [ ] **Step 1: Write the failing tests**

In `backend/tests/test_range_header.py`, extend the existing import on line 3 to:

```python
from app.api.streaming import parse_range_header, RANGE_NOT_SATISFIABLE, RANGE_MALFORMED
```

then append:

```python
def test_multipart_range_is_malformed_not_parsed():
    # Legal HTTP we do not implement. int('99,200') used to raise -> HTTP 500.
    assert parse_range_header("bytes=0-99,200-299", 1000) is RANGE_MALFORMED


def test_non_numeric_range_is_malformed():
    assert parse_range_header("bytes=abc-def", 1000) is RANGE_MALFORMED
    assert parse_range_header("bytes=10-abc", 1000) is RANGE_MALFORMED


def test_end_before_start_is_malformed():
    assert parse_range_header("bytes=500-100", 1000) is RANGE_MALFORMED


def test_missing_dash_is_malformed():
    assert parse_range_header("bytes=500", 1000) is RANGE_MALFORMED
```

Append to `backend/tests/test_streaming_endpoint_416.py`:

```python
def test_multipart_range_serves_full_body_200(stub_video):
    # RFC 7233 §3.1: an unimplementable/invalid Range must be IGNORED, not 500,
    # and not 416 (which invites the client to give up rather than retry).
    r = client.get(
        "/api/v1/streaming/tid-1/video",
        headers={"Range": "bytes=0-99,200-299"},
    )
    assert r.status_code == 200
    assert "Content-Range" not in r.headers
    assert r.headers["Content-Length"] == "1000"


def test_garbage_range_serves_full_body_200(stub_video):
    r = client.get(
        "/api/v1/streaming/tid-1/video",
        headers={"Range": "bytes=abc-def"},
    )
    assert r.status_code == 200
    assert "Content-Range" not in r.headers
```

- [ ] **Step 2: Run to verify they fail**

```bash
docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" \
  backend python -m pytest tests/test_range_header.py tests/test_streaming_endpoint_416.py -v
```

Expected: the four `parse_range_header` tests fail with `ImportError`/`AssertionError` on the
multipart case; the two endpoint tests fail with `500 != 200`.

- [ ] **Step 3: Add the multipart guard**

In `parse_range_header`, immediately after `spec = range_header[len('bytes='):].strip()`, insert:

```python
    # A multipart range ("0-99,200-299") is legal HTTP we do not implement.
    # Answering it with a single-part 206 would be a lie, so ignore the header.
    if ',' in spec:
        return RANGE_MALFORMED
```

- [ ] **Step 4: Run the tests**

```bash
docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" \
  backend python -m pytest tests/test_range_header.py tests/test_range_suffix.py \
  tests/test_streaming_endpoint_416.py -v
```

Expected: all PASS, including the two pre-existing 416/206 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/app/api/streaming.py backend/tests/test_range_header.py \
  backend/tests/test_streaming_endpoint_416.py
git commit -m "fix(streaming): ignore malformed and multipart ranges instead of 500

int('99,200') raised inside the handler's try and came back as a JSON 500,
which <video> feeds to the decoder as corrupt media. RFC 7233 3.1 requires
an invalid Range to be ignored, so serve 200 with the full body. 416 stays
for genuinely unsatisfiable ranges only."
```

---

## Task 3: `HEAD /{id}/video` returns headers without entering the generator

**Corrected during implementation.** Starlette's `Route.__init__` adds `HEAD` to every `GET`
route, but FastAPI's `APIRoute.__init__` overrides it — it never calls `super().__init__()` and
sets `self.methods` directly (verified against the pinned fastapi 0.104.1 / starlette 0.27.0). So
`HEAD /{id}/video` does **not** reach `stream_video`; it matches no method and returns a bare
**405**. The defect is milder than first described but still real: a TV media pipeline that probes
with HEAD before GET is refused instead of being told the size and type, and may not fall back.
The fix is unchanged — and registering above the GET route stays correct, both because it is
required if FastAPI's method handling ever changes and because it documents the intent.

Starlette matches routes in **registration order** and cannot be stopped from adding HEAD to a
GET route, so the explicit HEAD route must be declared **above** the GET route in the file.

**Files:**
- Modify: `backend/app/api/streaming.py` (new route immediately above `@router.get("/{torrent_id}/video")`)
- Test: `backend/tests/test_streaming_head.py` (create)

**Interfaces:**
- Consumes: `get_mime_type`, `torrent_manager.get_video_file_info`.
- Produces: `HEAD /api/v1/streaming/{torrent_id}/video` → 200 with `Accept-Ranges: bytes`, `Content-Length` (full file size), `Content-Type`, empty body. 404 on the same conditions as GET.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_streaming_head.py`:

```python
"""A HEAD probe must answer from metadata only.

Starlette auto-adds HEAD to GET routes, so HEAD /video used to run the full GET
handler: prioritize_video_files + force_start_for_stream (a DB write) and then the
piece-gated generator, which can block for up to 300s before the body is thrown
away. TV media pipelines probe with HEAD before GET.
"""
import types
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.api import streaming as streaming_api

client = TestClient(app)


@pytest.fixture
def stub_video(tmp_path, monkeypatch):
    f = tmp_path / "movie.mkv"
    f.write_bytes(b"X" * 4096)
    info = {"index": 0, "path": str(f), "size": 4096,
            "downloaded": 1024, "progress": 25.0, "name": "movie.mkv"}
    calls = {"prioritize": 0, "force_start": 0}

    monkeypatch.setattr(
        streaming_api.torrent_manager, "get_video_file_info",
        lambda tid, fi=None: info,
    )
    monkeypatch.setattr(
        streaming_api.torrent_manager, "get_torrent_status",
        lambda tid: types.SimpleNamespace(progress=25.0),
    )

    def _prioritize(*a, **k):
        calls["prioritize"] += 1
        return True

    def _force_start(*a, **k):
        calls["force_start"] += 1
        return True

    monkeypatch.setattr(streaming_api.torrent_manager, "prioritize_video_files", _prioritize)
    monkeypatch.setattr(streaming_api.torrent_manager, "force_start_for_stream", _force_start)
    return calls


def test_head_returns_metadata_headers(stub_video):
    r = client.head("/api/v1/streaming/tid-head/video")
    assert r.status_code == 200
    assert r.headers["Accept-Ranges"] == "bytes"
    assert r.headers["Content-Length"] == "4096"
    assert r.headers["Content-Type"] == "video/x-matroska"
    assert r.content == b""


def test_head_does_not_touch_the_torrent(stub_video):
    client.head("/api/v1/streaming/tid-head/video")
    assert stub_video["prioritize"] == 0, "HEAD must not recompute file priorities"
    assert stub_video["force_start"] == 0, "HEAD must not force-start the torrent"


def test_head_404s_for_unknown_file_index(stub_video, monkeypatch):
    monkeypatch.setattr(
        streaming_api.torrent_manager, "get_video_file_info",
        lambda tid, fi=None: None,
    )
    r = client.head("/api/v1/streaming/tid-head/video?file_index=7")
    assert r.status_code == 404
```

- [ ] **Step 2: Run to verify it fails**

```bash
docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" \
  backend python -m pytest tests/test_streaming_head.py -v
```

Expected: `test_head_does_not_touch_the_torrent` FAILS with `assert 1 == 0`.

- [ ] **Step 3: Add the HEAD route above the GET route**

Insert this **immediately before** the existing `@router.get("/{torrent_id}/video", ...)`
decorator in `backend/app/api/streaming.py`. Registration order is what makes HEAD match here
rather than falling through to the GET route.

```python
@router.head(
    "/{torrent_id}/video",
    summary="Metadata-only probe for a video stream",
    # Registered ABOVE the GET route on purpose. Starlette adds HEAD to every GET
    # route and cannot be told not to, and it matches routes in registration
    # order — so this must come first or a HEAD probe runs the full GET handler:
    # prioritize_video_files + force_start_for_stream (a DB write) and then the
    # piece-gated generator, which can block for up to 300s before the body is
    # discarded. TV media pipelines probe with HEAD before GET.
    dependencies=[Depends(require_session_silent)],
)
async def head_video(
    torrent_id: str = Path(..., description="ID of the torrent"),
    quality: Optional[str] = Query(None, description="Accepted for parity with GET; unused"),
    file_index: Optional[int] = Query(None, description="Index of the file to probe (season packs)"),
):
    """Answer a HEAD probe from metadata alone: no prioritisation, no piece waiting."""
    video_info = torrent_manager.get_video_file_info(torrent_id, file_index)
    if not video_info:
        if file_index is not None:
            raise HTTPException(
                status_code=404,
                detail=f"Video file index {file_index} not found in this torrent",
            )
        raise HTTPException(
            status_code=404,
            detail="Video file not found or not ready for streaming",
        )

    file_path = video_info["path"]
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Video file not found on disk")

    file_size = os.path.getsize(file_path)
    return Response(
        status_code=200,
        headers={
            "Accept-Ranges": "bytes",
            "Content-Length": str(file_size),
            "Content-Type": get_mime_type(file_path),
        },
    )
```

- [ ] **Step 4: Run the tests**

```bash
docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" \
  backend python -m pytest tests/test_streaming_head.py tests/test_streaming_endpoint_416.py -v
```

Expected: all PASS. The 416/206 GET tests must still pass — confirming the new HEAD route did
not shadow the GET route.

- [ ] **Step 5: Commit**

```bash
git add backend/app/api/streaming.py backend/tests/test_streaming_head.py
git commit -m "feat(streaming): answer HEAD from metadata, not the piece generator

Starlette adds HEAD to every GET route, so a HEAD probe ran the full GET
handler: file-priority recomputation, a DB write, force_start, and then a
piece wait that can hold for 300s before the body is discarded. Declared
above the GET route because Starlette matches in registration order."
```

---

## Task 4: Every configured video extension has an explicit MIME type

`VIDEO_MIME_TYPES` (`backend/app/api/streaming.py:29-38`) covers 8 extensions, but
`settings.video_extensions` (`backend/app/config.py:132-136`) admits 16. The other 8 fall
through to `mimetypes.guess_type()` on the container's **Python 3.10** (`backend/Dockerfile:1`),
whose table is smaller than a dev machine's — anything it does not know becomes
`application/octet-stream`, which most media stacks refuse outright.

**Files:**
- Modify: `backend/app/api/streaming.py:29-38`
- Test: `backend/tests/test_video_mime_types.py` (create)

**Interfaces:**
- Consumes: `settings.video_extensions`.
- Produces: `get_mime_type(path) -> str` never returns `application/octet-stream` for a configured video extension.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_video_mime_types.py`:

```python
"""Every extension the app accepts as video must have an explicit MIME type.

The 8 uncovered extensions fell through to mimetypes.guess_type() on the
container's Python 3.10, whose table is smaller than a dev machine's, so some
became application/octet-stream — which most media stacks refuse outright.
"""
from app.api.streaming import VIDEO_MIME_TYPES, get_mime_type
from app.config import settings


def test_every_configured_video_extension_is_mapped_explicitly():
    missing = sorted(settings.video_extensions - set(VIDEO_MIME_TYPES))
    assert not missing, (
        f"these accepted video extensions have no explicit MIME entry and would "
        f"depend on the container's mimetypes table: {missing}"
    )


def test_no_configured_extension_degrades_to_octet_stream():
    for ext in sorted(settings.video_extensions):
        assert get_mime_type(f"/tmp/sample{ext}") != "application/octet-stream", ext


def test_transport_stream_extensions_map_to_mp2t():
    assert get_mime_type("/tmp/a.ts") == "video/mp2t"
    assert get_mime_type("/tmp/a.m2ts") == "video/mp2t"
    assert get_mime_type("/tmp/a.mts") == "video/mp2t"


def test_matroska_still_maps_to_x_matroska():
    # The common torrent case; webOS 22 lists .mkv as a supported container.
    assert get_mime_type("/tmp/a.mkv") == "video/x-matroska"


def test_unknown_extension_still_falls_back():
    assert get_mime_type("/tmp/a.zzz") == "application/octet-stream"
```

- [ ] **Step 2: Run to verify it fails**

```bash
docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" \
  backend python -m pytest tests/test_video_mime_types.py -v
```

Expected: `test_every_configured_video_extension_is_mapped_explicitly` FAILS listing
`['.3gp', '.m2ts', '.m4v', '.mpeg', '.mpg', '.mts', '.ts', '.vob']`.

- [ ] **Step 3: Complete the table**

Replace `VIDEO_MIME_TYPES` in `backend/app/api/streaming.py:29-38` with:

```python
# Mapping of video file extensions to MIME types. This must cover every extension
# in settings.video_extensions: anything left to mimetypes.guess_type() depends on
# the container's Python 3.10 table and can degrade to application/octet-stream,
# which most media stacks refuse. test_video_mime_types.py enforces the coverage.
VIDEO_MIME_TYPES = {
    '.mp4': 'video/mp4',
    '.m4v': 'video/x-m4v',
    '.mkv': 'video/x-matroska',
    '.webm': 'video/webm',
    '.avi': 'video/x-msvideo',
    '.mov': 'video/quicktime',
    '.ogv': 'video/ogg',
    '.wmv': 'video/x-ms-wmv',
    '.flv': 'video/x-flv',
    '.ts': 'video/mp2t',
    '.m2ts': 'video/mp2t',
    '.mts': 'video/mp2t',
    '.vob': 'video/mpeg',
    '.mpg': 'video/mpeg',
    '.mpeg': 'video/mpeg',
    '.3gp': 'video/3gpp',
}
```

- [ ] **Step 4: Run the test**

```bash
docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" \
  backend python -m pytest tests/test_video_mime_types.py -v
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/api/streaming.py backend/tests/test_video_mime_types.py
git commit -m "fix(streaming): give every accepted video extension a MIME type

Eight of the sixteen extensions in settings.video_extensions had no entry
and fell through to the container's Python 3.10 mimetypes table, where some
degrade to application/octet-stream. A coverage test now pins the two lists
together."
```

---

## Task 5: An unavailable first chunk returns 503, not a truncated 206

`stream_file_range` (`backend/app/torrent/manager.py:1309-1413`) documents "NEVER truncate below
Content-Length" and then does exactly that: past `cap = 300.0` it `return`s
(`:1396-1401`), having already sent the full `Content-Length`. Once `StreamingResponse` has
begun, the status code is spent — a mid-body failure can only truncate.

The fix is to move the **first** chunk's wait *before* the response starts, where a real status
code is still available. A seek into a not-yet-downloaded region then produces a retryable 503
instead of 300 seconds of silence followed by a short body. The mid-stream cap stays as-is;
this task does not change behaviour once playback is under way.

**Files:**
- Modify: `backend/app/torrent/manager.py` (new `wait_for_first_chunk`, placed next to `_pieces_ready`)
- Modify: `backend/app/api/streaming.py` (`stream_video`, before constructing `StreamingResponse`)
- Test: `backend/tests/test_first_chunk_precheck.py` (create)

**Interfaces:**
- Consumes: `self.active_torrents`, `self._prioritize_window`, `self._deadline_pieces`, `self._pieces_ready` (all existing on `TorrentManager`).
- Produces: `async TorrentManager.wait_for_first_chunk(torrent_id: str, file_index: int, start: int, length: int, budget: float = 10.0) -> bool` — `True` when the pieces backing `[start, start+length-1]` are on disk (or there is no live torrent, so every byte is already there), `False` when `budget` seconds elapsed first.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_first_chunk_precheck.py`:

```python
"""A seek into a not-yet-downloaded region must fail with a status code, not a
truncated body.

stream_file_range holds the 206 open for up to 300s and then returns, truncating
below the Content-Length it already promised. A desktop browser re-requests; a TV
media pipeline reports a generic playback failure. Waiting for the FIRST chunk
before the response starts is the only point at which a real status code is still
available.
"""
import asyncio
import types
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.api import streaming as streaming_api
from app.torrent.manager import torrent_manager

client = TestClient(app)


class _FakeFile:
    def __init__(self, offset):
        self.offset = offset


class _FakeTI:
    def __init__(self, offset, piece_length, num_pieces):
        self._offset, self._pl, self._np = offset, piece_length, num_pieces

    def file_at(self, i):
        return _FakeFile(self._offset)

    def piece_length(self):
        return self._pl

    def num_pieces(self):
        return self._np


class _FakeHandle:
    """have_piece always returns `available` — no piece ever arrives when False."""
    def __init__(self, ti, available):
        self._ti, self._available = ti, available

    def has_metadata(self):
        return True

    def get_torrent_info(self):
        return self._ti

    def set_sequential_download(self, _v):
        pass

    def have_piece(self, _p):
        return self._available

    def piece_priority(self, _p, _pr):
        pass

    def set_piece_deadline(self, _p, _d):
        pass

    def reset_piece_deadline(self, _p):
        pass

    def status(self):
        return types.SimpleNamespace(num_peers=0, download_rate=0)


def test_wait_for_first_chunk_true_when_pieces_present():
    ti = _FakeTI(offset=0, piece_length=64, num_pieces=16)
    torrent_manager.active_torrents["t-ready"] = (_FakeHandle(ti, True), {})
    try:
        ok = asyncio.run(
            torrent_manager.wait_for_first_chunk("t-ready", 0, 0, 128, budget=0.5)
        )
    finally:
        del torrent_manager.active_torrents["t-ready"]
    assert ok is True


def test_wait_for_first_chunk_false_when_pieces_never_arrive():
    ti = _FakeTI(offset=0, piece_length=64, num_pieces=16)
    torrent_manager.active_torrents["t-stuck"] = (_FakeHandle(ti, False), {})
    try:
        ok = asyncio.run(
            torrent_manager.wait_for_first_chunk("t-stuck", 0, 0, 128, budget=0.5)
        )
    finally:
        del torrent_manager.active_torrents["t-stuck"]
    assert ok is False


def test_wait_for_first_chunk_true_when_torrent_not_in_session():
    # Completed and removed from the session: every byte is already on disk.
    ok = asyncio.run(
        torrent_manager.wait_for_first_chunk("t-absent", 0, 0, 128, budget=0.5)
    )
    assert ok is True


@pytest.fixture
def stub_video(tmp_path, monkeypatch):
    f = tmp_path / "movie.mkv"
    f.write_bytes(b"X" * 4096)
    info = {"index": 0, "path": str(f), "size": 4096,
            "downloaded": 512, "progress": 12.0, "name": "movie.mkv"}
    monkeypatch.setattr(
        streaming_api.torrent_manager, "get_video_file_info",
        lambda tid, fi=None: info,
    )
    monkeypatch.setattr(
        streaming_api.torrent_manager, "get_torrent_status",
        lambda tid: types.SimpleNamespace(progress=12.0),
    )
    monkeypatch.setattr(
        streaming_api.torrent_manager, "prioritize_video_files", lambda *a, **k: True)
    monkeypatch.setattr(
        streaming_api.torrent_manager, "force_start_for_stream", lambda *a, **k: True)
    return info


def test_endpoint_503s_when_first_chunk_unavailable(stub_video, monkeypatch):
    async def _never(*a, **k):
        return False

    monkeypatch.setattr(streaming_api.torrent_manager, "wait_for_first_chunk", _never)
    r = client.get("/api/v1/streaming/tid-1/video", headers={"Range": "bytes=2048-"})
    assert r.status_code == 503
    assert r.headers["Retry-After"] == "2"


def test_endpoint_206s_when_first_chunk_available(stub_video, monkeypatch):
    async def _ready(*a, **k):
        return True

    monkeypatch.setattr(streaming_api.torrent_manager, "wait_for_first_chunk", _ready)
    r = client.get("/api/v1/streaming/tid-1/video", headers={"Range": "bytes=0-99"})
    assert r.status_code == 206
    assert r.headers["Content-Range"] == "bytes 0-99/4096"
```

- [ ] **Step 2: Run to verify it fails**

```bash
docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" \
  backend python -m pytest tests/test_first_chunk_precheck.py -v
```

Expected: FAIL with `AttributeError: 'TorrentManager' object has no attribute 'wait_for_first_chunk'`.

- [ ] **Step 3: Add `wait_for_first_chunk` to `TorrentManager`**

Insert immediately **after** `_pieces_ready` (which ends at `backend/app/torrent/manager.py:1424`):

```python
    async def wait_for_first_chunk(self, torrent_id: str, file_index: int,
                                   start: int, length: int,
                                   budget: float = 10.0) -> bool:
        """True once the pieces backing [start, start+length-1] are on disk.

        Called by the streaming endpoint BEFORE it starts the response body. Once
        StreamingResponse begins emitting, the status code is already sent, so a
        later failure can only truncate below the promised Content-Length — which a
        browser retries and a TV media pipeline reports as a generic playback
        failure. Answering the first chunk up front is the only point at which a
        seek into a not-yet-downloaded region can still become a retryable 503.

        Returns True immediately when the torrent is not in the session (completed
        and removed: every byte is already on disk). Returns False if `budget`
        seconds elapse with the pieces still missing; the mid-stream wait inside
        stream_file_range is unchanged.
        """
        entry = self.active_torrents.get(torrent_id)
        handle = entry[0] if entry else None
        if handle is None or not handle.has_metadata():
            return True

        try:
            ti = handle.get_torrent_info()
            file_offset = ti.file_at(file_index).offset
            piece_length = ti.piece_length()
            num_pieces = ti.num_pieces()
        except Exception:
            # No usable metadata: let the generator deal with it rather than
            # refusing a request that might well succeed.
            return True

        first_piece = (file_offset + start) // piece_length
        last_piece = (file_offset + start + max(length, 1) - 1) // piece_length

        self._prioritize_window(handle, first_piece, num_pieces, first_piece)
        self._deadline_pieces(handle, first_piece, last_piece, num_pieces)

        waited = 0.0
        while not self._pieces_ready(handle, first_piece, last_piece):
            if torrent_id not in self.active_torrents:
                return False
            if waited >= budget:
                logger.info(
                    f"First chunk for {torrent_id} pieces {first_piece}-{last_piece} "
                    f"not available within {budget:.0f}s; answering 503"
                )
                return False
            await asyncio.sleep(0.25)
            waited += 0.25
            self._deadline_pieces(handle, first_piece, last_piece, num_pieces)

        return True
```

- [ ] **Step 4: Call it from the endpoint**

In `backend/app/api/streaming.py`, in `stream_video`, insert this **directly before** the
`return StreamingResponse(...)` statement (currently at `:160`):

```python
        # Wait for the FIRST chunk here, not inside the generator: after
        # StreamingResponse starts, the status code is spent and a failure can only
        # truncate below the Content-Length above. A seek into a not-yet-downloaded
        # region is then a retryable 503 rather than a silent stall.
        if not await torrent_manager.wait_for_first_chunk(
            torrent_id, video_info["index"], start, min(chunk_size, content_length)
        ):
            return Response(
                status_code=503,
                headers={"Retry-After": "2", "Accept-Ranges": "bytes"},
            )
```

- [ ] **Step 5: Run the new tests plus the whole streaming set**

```bash
docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" \
  backend python -m pytest tests/test_first_chunk_precheck.py tests/test_streaming_pieces.py \
  tests/test_streaming_endpoint_416.py tests/test_streaming_head.py \
  tests/test_async_stream_endpoint.py tests/test_stream_no_garbage.py \
  tests/test_await_pieces_async.py tests/test_pieces_ready.py tests/test_stream_force_start.py -v
```

Expected: all PASS.

- [ ] **Step 6: Run the full backend suite for regressions**

```bash
docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" \
  backend python -m pytest tests/ -q
```

Expected: no new failures versus a pre-task baseline. If anything else in the suite was relying
on a HEAD request reaching the GET handler, or on a malformed range returning 500, fix the test
— those were both bugs.

- [ ] **Step 7: Commit**

```bash
git add backend/app/torrent/manager.py backend/app/api/streaming.py \
  backend/tests/test_first_chunk_precheck.py
git commit -m "feat(streaming): 503 an unavailable first chunk instead of truncating

stream_file_range promised a full Content-Length and then returned past its
300s cap, truncating the body. Once StreamingResponse starts, the status is
spent, so the first chunk's piece wait moves into the endpoint where a
retryable 503 is still possible. Mid-stream behaviour is unchanged."
```

---

## Task 6: Split the app into two root layouts

> **Superseded in part — do not replay verbatim.** The code blocks below target
> Chromium 87, which the Task 8 gate disproved: the set measured **Chromium 120 /
> webOS 25**. They are kept as the record of what was written and why. The shipped
> files have since been corrected — read them, not these blocks. See "Gate outcome,
> recorded 2026-10-06" at the end of this document.

`app/layout.tsx` imports `globals.css` for every route, and Tailwind v4 wraps its output in
`@layer` — an at-rule Chromium 87 does not understand, which makes it discard the whole block.
The TV surface therefore cannot share the stylesheet, and the App Router only allows a second
root layout when **no** `app/layout.tsx` exists and every route lives in a group. Branching the
root layout on pathname would need `headers()`, forcing dynamic rendering app-wide.

URLs do not change. Navigating between the two root layouts triggers a full page reload, which
is fine and even desirable here.

**Files:**
- Move: every child of `frontend/src/app/` into `frontend/src/app/(web)/`
- Test: `npx tsc --noEmit`, `npm run build`, `npx vitest run`

**Interfaces:**
- Consumes: nothing.
- Produces: `frontend/src/app/(web)/layout.tsx` (the existing root layout, unmodified except its CSS import path stays `./globals.css` because `globals.css` moves with it). No `frontend/src/app/layout.tsx`.

- [ ] **Step 1: Record a baseline**

```bash
cd frontend && npx tsc --noEmit && npx vitest run 2>&1 | tail -5
```

Expected: clean typecheck; note the vitest pass/fail counts — Step 5 must match them.

- [ ] **Step 2: Move everything into `(web)`**

```bash
cd /Users/benjaminherro/github/freeflix/frontend/src/app
mkdir -p '(web)'
git mv api auth claim downloads invite members movies my-list schedules search \
       settings signin streaming tv users '(web)/'
git mv page.tsx layout.tsx loading.tsx globals.css '(web)/'
```

- [ ] **Step 3: Verify the tree**

```bash
cd /Users/benjaminherro/github/freeflix/frontend
ls src/app          # expect exactly: (web)
ls 'src/app/(web)'  # expect layout.tsx globals.css page.tsx loading.tsx + 15 dirs
test ! -e src/app/layout.tsx && echo "OK: no root layout"
grep -n "globals.css" 'src/app/(web)/layout.tsx'   # must still be './globals.css'
```

- [ ] **Step 4: Typecheck and build**

```bash
cd /Users/benjaminherro/github/freeflix/frontend
npx tsc --noEmit
npm run build
```

Expected: both clean. The build output should list the same 20 routes as before with the same
paths — `/`, `/movies`, `/movies/[id]`, `/tv`, `/tv/[id]`, `/search`, `/my-list`, `/downloads`,
`/settings`, `/members`, `/schedules`, `/signin`, `/signin/owner`, `/claim`, `/invite`,
`/auth/verify`, `/auth/reset-password`, `/streaming/[id]`, `/users/[id]/settings`, plus
`/api/internal/mail`. **If any URL changed, the move was wrong** — a route group's parentheses
must not appear in a path.

Known failure mode: if Next reports "Cannot find the root layout", a file was left directly
under `src/app/`. Re-run Step 3.

- [ ] **Step 5: Run the frontend tests**

```bash
cd /Users/benjaminherro/github/freeflix/frontend && npx vitest run 2>&1 | tail -5
```

Expected: the same counts as Step 1. The ~85 colocated test files moved with their components,
and `@/*` path aliases resolve from `src/`, so nothing should need editing. If a test imports
via a relative path that crossed the moved boundary, fix that import.

- [ ] **Step 6: Smoke the running app**

```bash
cd /Users/benjaminherro/github/freeflix && make up d=1 && sleep 20
for p in / /movies /tv /search /my-list /settings /signin; do
  printf '%s -> %s\n' "$p" "$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:3001$p")"
done
```

Expected: every path returns 200 (or 307/308 to `/signin` if unclaimed — not 404 or 500).

- [ ] **Step 7: Commit**

```bash
cd /Users/benjaminherro/github/freeflix
git add -A frontend/src/app
git commit -m "refactor(frontend): move every route into a (web) route group

A second root layout is the only way to keep the Tailwind v4 global
stylesheet off the TV surface, and the App Router only allows one when no
app/layout.tsx exists and every route sits in a group. Tailwind v4 wraps its
output in @layer, which Chromium 87 discards wholesale. URLs are unchanged."
```

---

## Task 7: `/bigscreen` skeleton, its stylesheet, and the diagnostic instrument

> **Superseded in part — do not replay verbatim.** The code blocks below target
> Chromium 87, which the Task 8 gate disproved: the set measured **Chromium 120 /
> webOS 25**. They are kept as the record of what was written and why. The shipped
> files have since been corrected — read them, not these blocks. See "Gate outcome,
> recorded 2026-10-06" at the end of this document.

The stage-3 instrument lives at **`/bigscreen/diag`**, not at `/bigscreen`. Spec §5.1 assigns
`/bigscreen` to the TV home screen, so leaving the instrument there would mean stage 4 deletes or
overwrites it — on a device where you cannot open devtools without Developer Mode. On `/diag` it
survives as a permanent field tool. It reports the engine version, probes the CSS and JS features
the design depends on, renders every FRÈ token at TV sizes so we can see whether the hand-written
stylesheet works, logs remote key codes, plays a real library file through a plain `<video>`, and
reads back the raw HTTP status of a far-seek Range request.

**Files:**
- Create: `frontend/src/app/(bigscreen)/layout.tsx`
- Create: `frontend/src/app/(bigscreen)/bigscreen/diag/page.tsx`
- Create: `frontend/src/app/(bigscreen)/error.tsx`
- Create: `frontend/public/bigscreen.css`
- Create: `frontend/src/app/(bigscreen)/legacy-target.test.ts`
- Create: `frontend/src/app/(bigscreen)/bigscreen-tokens.test.ts`
- Modify: `frontend/package.json` (add `browserslist` and the `test:tv` script)

**Interfaces:**
- Consumes: nothing from earlier tasks (deliberately — it must work before pairing exists).
- Produces: the route `/bigscreen/diag`, served with no Tailwind, no providers and no auth gate.

- [ ] **Step 1: Write the failing guard test**

Create `frontend/src/app/(bigscreen)/legacy-target.test.ts`. The sketch below is the
forbidden-construct scan only; the shipped file also bans `@/components` imports (the guard is
directory-scoped, so one such import puts Tailwind on the TV with the guard still green) and pins
the set of files allowed to carry `@allow-legacy-probes` to exactly the diagnostics page. Read the
committed file, not this block, when changing it.

```ts
/**
 * The TV surface targets Chromium 87 (webOS TV 22). Tailwind v4's own output is
 * already disqualified there — it wraps everything in @layer, which Chromium 87
 * discards wholesale — so this guard exists to stop us reintroducing the same
 * class of problem by hand in the TV stylesheet or its components.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const FORBIDDEN_CSS = [
  '@layer',
  '@property',
  'oklch(',
  'oklab(',
  'color-mix(',
  ':has(',
  '@container',
  'backdrop-filter',
  'backdrop-blur',
  'mix-blend',
  'aspect-ratio',
];

const FORBIDDEN_JS = [
  '.at(',
  'Object.hasOwn',
  'structuredClone',
];

/** Comments legitimately name the banned constructs; only real code counts. */
function stripCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/**
 * A file may opt out by carrying this marker. Exactly one file does: the
 * diagnostics page, whose whole job is to probe for post-87 features by name via
 * CSS.supports() and typeof checks. Without the escape hatch the guard would fail
 * on the very page that tells us whether the guard is needed.
 */
const OPT_OUT = '@allow-legacy-probes';

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const BIGSCREEN_DIR = join(process.cwd(), 'src/app/(bigscreen)');
const TV_STYLESHEET = join(process.cwd(), 'public/bigscreen.css');

describe('Chromium 87 target', () => {
  it('the TV stylesheet uses no post-87 CSS', () => {
    const css = stripCssComments(readFileSync(TV_STYLESHEET, 'utf8'));
    const found = FORBIDDEN_CSS.filter((f) => css.includes(f));
    expect(found, `public/bigscreen.css uses ${found.join(', ')}`).toEqual([]);
  });

  it('the TV components use no post-87 CSS or JS', () => {
    const offences: string[] = [];
    for (const file of walk(BIGSCREEN_DIR)) {
      if (file.endsWith('.test.ts') || file.endsWith('.test.tsx')) continue;
      const src = readFileSync(file, 'utf8');
      if (src.includes(OPT_OUT)) continue;
      for (const f of [...FORBIDDEN_CSS, ...FORBIDDEN_JS]) {
        if (src.includes(f)) offences.push(`${file}: ${f}`);
      }
    }
    expect(offences).toEqual([]);
  });

  it('does not import framer-motion or tailwind on the TV surface', () => {
    const offences: string[] = [];
    for (const file of walk(BIGSCREEN_DIR)) {
      if (file.endsWith('.test.ts') || file.endsWith('.test.tsx')) continue;
      const src = readFileSync(file, 'utf8');
      // No opt-out here: nothing on the TV surface may pull in Tailwind or framer-motion.
      if (src.includes('framer-motion')) offences.push(`${file}: framer-motion`);
      if (src.includes('globals.css')) offences.push(`${file}: globals.css`);
    }
    expect(offences).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd /Users/benjaminherro/github/freeflix/frontend && npx vitest run 'src/app/(bigscreen)' 2>&1 | tail -20
```

Expected: FAIL — `ENOENT` for `public/bigscreen.css` and the `(bigscreen)` directory.

- [ ] **Step 3: Write the TV stylesheet**

Create `frontend/public/bigscreen.css`. Served from `public/` and linked directly so it never
enters PostCSS — that is what keeps Tailwind out of it. Tokens are copied from
`src/app/(web)/globals.css:8-28`, where they are already plain hex.

```css
/* ============================================================
   Freeflix — big-screen (10-foot) stylesheet.
   TARGET: Chromium 87 (webOS TV 22). Plain CSS only, no build step.
   legacy-target.test.ts holds the list of constructs banned here and fails the
   build if any appears. Tokens mirror the FRE Editorial-Noir set, which is
   already plain hex, so they need no translation.
   ============================================================ */

:root {
  --ink: #0A0A0B;
  --surface: #111113;
  --surface-2: #16161A;
  --text: #F4F1EA;
  --muted: #8C8884;
  --hairline: #26242A;
  --gold: #C9A86A;
  --gold-lite: #E7D6AE;
  --danger: #E5564B;
  --success: #7BDCA0;

  --font-display: Georgia, "Times New Roman", serif;
  --font-ui: "Inter Tight", system-ui, -apple-system, Arial, sans-serif;

  /* 1920x1080 CSS px regardless of panel resolution; 5% safe area. */
  --safe-x: 96px;
  --safe-y: 54px;
  --radius: 12px;
  --focus-ring: 4px;
}

* { box-sizing: border-box; }

html, body {
  margin: 0;
  padding: 0;
  width: 100%;
  height: 100%;
  background: var(--ink);
  color: var(--text);
  font-family: var(--font-ui);
  /* A TV app never scrolls by pointer; overflow is managed per-surface. */
  overflow: hidden;
}

body {
  /* Body copy floor for a 10-foot viewing distance. */
  font-size: 24px;
  line-height: 1.45;
}

.bs-page {
  padding: var(--safe-y) var(--safe-x);
  height: 100%;
  overflow-y: auto;
}

h1 { font-family: var(--font-display); font-size: 56px; margin: 0 0 24px; font-weight: 600; }
h2 { font-family: var(--font-display); font-size: 40px; margin: 40px 0 16px; font-weight: 600; }
h3 { font-size: 28px; margin: 24px 0 12px; font-weight: 600; color: var(--gold-lite); }
p  { margin: 0 0 16px; }
code, pre { font-family: "SF Mono", Menlo, Consolas, monospace; font-size: 20px; }

/* --- verdict banner ------------------------------------------------- */
.bs-verdict {
  border: 2px solid var(--hairline);
  border-radius: var(--radius);
  padding: 24px 32px;
  margin: 0 0 32px;
  background: var(--surface);
}
.bs-verdict--legacy { border-color: var(--gold); }
.bs-verdict--modern { border-color: var(--success); }
.bs-verdict--unknown { border-color: var(--danger); }
.bs-verdict strong { font-size: 32px; display: block; margin-bottom: 8px; }

/* --- fact table ----------------------------------------------------- */
.bs-facts { width: 100%; border-collapse: collapse; margin-bottom: 32px; }
.bs-facts th, .bs-facts td {
  text-align: left;
  padding: 10px 16px;
  border-bottom: 1px solid var(--hairline);
  font-size: 22px;
}
.bs-facts th { color: var(--muted); font-weight: 400; width: 40%; }
.bs-yes { color: var(--success); }
.bs-no  { color: var(--danger); }

/* --- token swatches ------------------------------------------------- */
.bs-swatches { display: flex; flex-wrap: wrap; gap: 16px; margin-bottom: 32px; }
.bs-swatch {
  width: 200px;
  padding: 16px;
  border: 1px solid var(--hairline);
  border-radius: var(--radius);
  font-size: 18px;
}
.bs-swatch span { display: block; height: 64px; border-radius: 8px; margin-bottom: 8px; }

/* --- focus demo ----------------------------------------------------- */
.bs-tiles { display: flex; gap: 24px; margin-bottom: 32px; }
.bs-tile {
  width: 240px;
  height: 135px;
  border: 1px solid var(--hairline);
  border-radius: var(--radius);
  background: var(--surface-2);
  color: var(--text);
  font-size: 24px;
  font-family: var(--font-ui);
  cursor: pointer;
  transition: transform 180ms cubic-bezier(0.4, 0, 0.2, 1);
}
/* The focus ring is the whole navigation model on a remote; never remove it. */
.bs-tile:focus {
  outline: var(--focus-ring) solid var(--gold);
  outline-offset: 2px;
  transform: scale(1.06);
}

/* --- key log -------------------------------------------------------- */
.bs-keylog {
  background: var(--surface);
  border: 1px solid var(--hairline);
  border-radius: var(--radius);
  padding: 16px 24px;
  min-height: 160px;
  margin-bottom: 32px;
}
.bs-keylog div { font-family: "SF Mono", Menlo, monospace; font-size: 20px; }

/* --- video harness -------------------------------------------------- */
.bs-video { width: 100%; max-width: 1280px; background: #000; border-radius: var(--radius); }
.bs-controls { display: flex; gap: 16px; flex-wrap: wrap; margin: 16px 0 32px; }
.bs-btn {
  padding: 14px 28px;
  min-height: 60px;
  font-size: 24px;
  font-family: var(--font-ui);
  color: var(--ink);
  background: var(--gold);
  border: 0;
  border-radius: 8px;
  cursor: pointer;
}
.bs-btn:focus { outline: var(--focus-ring) solid var(--gold-lite); outline-offset: 2px; }
.bs-btn--ghost { background: transparent; color: var(--text); border: 1px solid var(--hairline); }
```

- [ ] **Step 4: Write the TV root layout**

Create `frontend/src/app/(bigscreen)/layout.tsx`. No providers, no `AuthenticatedLayout`, no
`next/font` (which would inject Tailwind-adjacent CSS variables we do not need), and the
stylesheet arrives as a plain `<link>`.

```tsx
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Freeflix — Big Screen',
  description: 'Freeflix on the television.',
};

/**
 * Second root layout, for the TV surface only.
 *
 * It deliberately imports NO stylesheet: Tailwind v4 wraps its output in cascade
 * layers, which Chromium 87 (webOS TV 22) does not understand and therefore
 * discards wholesale, leaving an unstyled page. public/bigscreen.css is
 * hand-authored plain CSS and is linked directly so it never passes through
 * PostCSS. (Do not name the at-rule literally here — legacy-target.test.ts
 * scans component files without stripping comments, so the token itself would
 * fail the guard. Only the diagnostics page may name banned constructs.)
 *
 * It also mounts none of the app's providers — the TV surface must render before
 * device pairing exists.
 */
export default function BigScreenLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link rel="stylesheet" href="/bigscreen.css" />
      </head>
      <body>{children}</body>
    </html>
  );
}
```

- [ ] **Step 5: Write the diagnostic page**

Create `frontend/src/app/(bigscreen)/bigscreen/diag/page.tsx`. This is the stage-3 instrument.

```tsx
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * The stage-3 gate, rendered on the TV itself.
 *
 * Reports the web-engine version (the single fact that decides the CSS target —
 * Settings > Support shows firmware only, never the engine), probes the CSS and JS
 * features the design depends on, renders the FRE tokens at TV sizes so we can see
 * whether the hand-written stylesheet actually works, logs remote key codes, and
 * plays a real library file through a plain <video>.
 *
 * Runs unauthenticated, so browse it with AUTH_ENABLED=false set temporarily on the
 * backend (revert immediately afterwards).
 *
 * @allow-legacy-probes — this file names post-Chromium-87 CSS and JS features on
 * purpose, to probe for them. legacy-target.test.ts skips any file with this marker;
 * no other file on the TV surface may carry it.
 */

type Probe = { label: string; ok: boolean };
type TorrentRow = { torrent_id?: string; id?: string; movie_title?: string; name?: string };

function chromeMajor(ua: string): number | null {
  const m = /Chrome\/(\d+)/.exec(ua);
  return m ? parseInt(m[1], 10) : null;
}

const TOKENS: Array<[string, string]> = [
  ['--ink', 'ink'],
  ['--surface', 'surface'],
  ['--surface-2', 'surface-2'],
  ['--text', 'text'],
  ['--muted', 'muted'],
  ['--hairline', 'hairline'],
  ['--gold', 'gold'],
  ['--gold-lite', 'gold-lite'],
  ['--danger', 'danger'],
  ['--success', 'success'],
];

export default function BigScreenDiagnostics() {
  const [ua, setUa] = useState('');
  const [facts, setFacts] = useState<Array<[string, string]>>([]);
  const [probes, setProbes] = useState<Probe[]>([]);
  const [keys, setKeys] = useState<string[]>([]);
  const [torrents, setTorrents] = useState<TorrentRow[]>([]);
  const [listError, setListError] = useState('');
  const [videoSrc, setVideoSrc] = useState('');
  const [videoState, setVideoState] = useState('idle');
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const tilesRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setUa(navigator.userAgent);
    setFacts([
      ['innerWidth x innerHeight', `${window.innerWidth} x ${window.innerHeight}`],
      ['screen.width x height', `${window.screen.width} x ${window.screen.height}`],
      ['devicePixelRatio', String(window.devicePixelRatio)],
      ['language', navigator.language],
      ['MediaSource present', String(typeof window.MediaSource !== 'undefined')],
    ]);

    const s = (prop: string, value: string) =>
      typeof CSS !== 'undefined' && CSS.supports ? CSS.supports(prop, value) : false;

    setProbes([
      { label: 'CSS custom properties', ok: s('color', 'var(--x)') },
      { label: 'CSS grid', ok: s('display', 'grid') },
      { label: 'position: sticky', ok: s('position', 'sticky') },
      { label: 'object-fit', ok: s('object-fit', 'contain') },
      { label: 'oklch() — Tailwind v4 needs this', ok: s('color', 'oklch(50% 0.1 200)') },
      { label: 'color-mix() — Tailwind v4 needs this', ok: s('color', 'color-mix(in srgb, red, blue)') },
      { label: ':has()', ok: typeof CSS !== 'undefined' && CSS.supports ? CSS.supports('selector(:has(*))') : false },
      { label: 'container queries', ok: s('container-type', 'inline-size') },
      { label: 'aspect-ratio', ok: s('aspect-ratio', '16 / 9') },
      { label: 'backdrop-filter', ok: s('backdrop-filter', 'blur(4px)') },
      { label: 'CSS.registerProperty (@property)', ok: typeof (CSS as unknown as { registerProperty?: unknown }).registerProperty !== 'undefined' },
      { label: 'JS: Array.prototype.at', ok: typeof (Array.prototype as unknown as { at?: unknown }).at === 'function' },
      { label: 'JS: Object.hasOwn', ok: typeof (Object as unknown as { hasOwn?: unknown }).hasOwn === 'function' },
      { label: 'JS: structuredClone', ok: typeof (window as unknown as { structuredClone?: unknown }).structuredClone === 'function' },
    ]);
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const line = `key=${JSON.stringify(e.key)} keyCode=${e.keyCode} code=${e.code || '-'}`;
      setKeys((prev) => [line, ...prev].slice(0, 12));
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    const first = tilesRef.current?.querySelector('button');
    if (first instanceof HTMLElement) first.focus();
  }, []);

  // Roving focus across the demo tiles, so the real remote's D-pad can be verified.
  const onTilesKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const buttons = Array.from(tilesRef.current?.querySelectorAll('button') ?? []);
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (i === -1) return;
    const next = e.key === 'ArrowRight' ? i + 1 : i - 1;
    const target = buttons[next];
    if (target) {
      e.preventDefault();
      target.focus();
      target.scrollIntoView({ block: 'nearest', inline: 'center' });
    }
  }, []);

  const loadTorrents = useCallback(async () => {
    setListError('');
    try {
      const res = await fetch('/api/v1/torrents/list');
      if (!res.ok) {
        setListError(`GET /api/v1/torrents/list -> ${res.status}. Set AUTH_ENABLED=false on the backend for this test.`);
        return;
      }
      const body = await res.json();
      setTorrents(Array.isArray(body) ? body : (body.torrents ?? []));
    } catch (err) {
      setListError(`fetch failed: ${String(err)}`);
    }
  }, []);

  const play = useCallback((row: TorrentRow) => {
    const id = row.torrent_id ?? row.id;
    if (!id) return;
    setVideoSrc(`/api/v1/streaming/${id}/video`);
    setVideoState('loading');
  }, []);

  const seek = useCallback((delta: number) => {
    const v = videoRef.current;
    if (v) v.currentTime = Math.max(0, v.currentTime + delta);
  }, []);

  const seekFraction = useCallback((f: number) => {
    const v = videoRef.current;
    if (v && Number.isFinite(v.duration)) v.currentTime = v.duration * f;
  }, []);

  const major = chromeMajor(ua);
  const verdictClass =
    major === null ? 'bs-verdict bs-verdict--unknown'
      : major >= 111 ? 'bs-verdict bs-verdict--modern'
        : 'bs-verdict bs-verdict--legacy';

  return (
    <div className="bs-page">
      <h1>Freeflix — big-screen diagnostics</h1>

      <div className={verdictClass}>
        <strong>
          {major === null
            ? 'Engine version not detected'
            : major >= 111
              ? `Chromium ${major} — modern target`
              : `Chromium ${major} — legacy target`}
        </strong>
        {major !== null && major >= 111
          ? 'At or above Tailwind v4’s Chrome 111 floor. The existing web stylesheet would render here.'
          : 'Below Tailwind v4’s Chrome 111 floor. The TV surface needs this hand-written stylesheet.'}
        <div style={{ marginTop: 12, color: 'var(--muted)', fontSize: 20, wordBreak: 'break-all' }}>{ua}</div>
      </div>

      <h2>Device</h2>
      <table className="bs-facts">
        <tbody>
          {facts.map(([k, v]) => (
            <tr key={k}><th>{k}</th><td>{v}</td></tr>
          ))}
        </tbody>
      </table>

      <h2>Feature probes</h2>
      <table className="bs-facts">
        <tbody>
          {probes.map((p) => (
            <tr key={p.label}>
              <th>{p.label}</th>
              <td className={p.ok ? 'bs-yes' : 'bs-no'}>{p.ok ? 'yes' : 'no'}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Tokens</h2>
      <p>Every swatch must show a distinct colour, and both type families must differ.</p>
      <div className="bs-swatches">
        {TOKENS.map(([varName, label]) => (
          <div className="bs-swatch" key={varName}>
            <span style={{ background: `var(${varName})`, border: '1px solid var(--hairline)' }} />
            {label}
          </div>
        ))}
      </div>
      <p style={{ fontFamily: 'var(--font-display)', fontSize: 40 }}>Display face — 40px</p>
      <p style={{ fontFamily: 'var(--font-ui)', fontSize: 24 }}>UI face — 24px body floor</p>

      <h2>Focus & D-pad</h2>
      <p>Left/Right should move the gold ring. If it does not, spatial navigation needs the library.</p>
      <div className="bs-tiles" ref={tilesRef} onKeyDown={onTilesKeyDown}>
        {[1, 2, 3, 4, 5, 6].map((n) => (
          <button className="bs-tile" key={n} type="button">Tile {n}</button>
        ))}
      </div>

      <h2>Remote key codes</h2>
      <p>Press Back, Play, Pause, Rewind, Fast-Forward and the arrows. Back should report keyCode 461.</p>
      <div className="bs-keylog">
        {keys.length === 0 ? <div style={{ color: 'var(--muted)' }}>waiting for a key…</div>
          : keys.map((k, i) => <div key={`${k}-${i}`}>{k}</div>)}
      </div>

      <h2>Playback</h2>
      <div className="bs-controls">
        <button className="bs-btn" type="button" onClick={loadTorrents}>List torrents</button>
        <button className="bs-btn bs-btn--ghost" type="button" onClick={() => seek(-10)}>-10s</button>
        <button className="bs-btn bs-btn--ghost" type="button" onClick={() => seek(60)}>+60s</button>
        <button className="bs-btn bs-btn--ghost" type="button" onClick={() => seekFraction(0.9)}>Seek to 90%</button>
      </div>
      {listError ? <p className="bs-no">{listError}</p> : null}
      <div className="bs-controls">
        {torrents.map((t) => (
          <button className="bs-btn bs-btn--ghost" type="button" key={t.torrent_id ?? t.id}
                  onClick={() => play(t)}>
            {t.movie_title ?? t.name ?? t.torrent_id ?? t.id}
          </button>
        ))}
      </div>
      {videoSrc ? (
        <>
          <video
            className="bs-video"
            ref={videoRef}
            src={videoSrc}
            preload="metadata"
            controls
            onLoadedMetadata={() => {
              const v = videoRef.current;
              setVideoState(v ? `metadata: ${v.videoWidth}x${v.videoHeight}, duration ${Math.round(v.duration)}s` : 'metadata');
            }}
            onPlaying={() => setVideoState('playing')}
            onWaiting={() => setVideoState('waiting (buffering)')}
            onError={() => {
              const code = videoRef.current?.error?.code;
              setVideoState(`ERROR MediaError.code=${code ?? 'unknown'}`);
            }}
          />
          <p><code>{videoState}</code></p>
          <p style={{ color: 'var(--muted)', fontSize: 20, wordBreak: 'break-all' }}>{videoSrc}</p>
        </>
      ) : null}
    </div>
  );
}
```

- [ ] ~~**Step 6: Pin the JS target**~~ — **done, then reverted. Do not re-apply.**

As written, this step added a top-level `browserslist` key to `frontend/package.json`
(sibling of `"scripts"`):

```json
  "browserslist": [
    "chrome 87"
  ],
```

> **REVERTED — do not apply this step.** This pin was removed on 2026-10-06 after the gate
> measured Chromium 120. It downlevels the whole *web* bundle for a constraint that does not
> exist: re-adding it costs `/downloads` +4.3 kB, `/members` +4.3 kB, `/streaming/[id]` +4.4 kB
> and buys nothing. Skip this step entirely.

```json
```

The rationale was that it downlevels SWC output app-wide, costing "a few KB on the web bundle" and
removing a whole category of "the TV is blank" syntax-error debugging. The Task 8 gate disproved the
premise: the engine is Chromium 120. The pin was removed on 2026-10-06. The cost was not a few KB
and it was not TV-only — it was the whole **web** bundle: `/downloads` 8.71 → 4.45 kB, `/members`
8.8 → 4.55 kB, `/streaming/[id]` 24.6 → 20.2 kB on the revert.

- [ ] **Step 7: Run the guard test and typecheck**

```bash
cd /Users/benjaminherro/github/freeflix/frontend
npm run test:tv 2>&1 | tail -20
npx tsc --noEmit
npm run build
```

`test:tv` is `vitest run 'src/app/(bigscreen)'`. It is deliberately NOT part of `build`:
`next build` runs inside the Docker image build, and an unrelated test failure must not be able to
break an image. Nothing in CI runs it either — running it before committing TV work is the
enforcement.

Expected: guard test PASSES, typecheck clean, build lists a new `/bigscreen/diag` route.

If the guard fails **on the diagnostics page**, its `@allow-legacy-probes` marker is missing or
misspelled — that page names banned features deliberately. If it fails on any *other* file, fix
the file, never the rule. If it fails on a false positive such as `.at(` inside an unrelated
identifier, tighten the pattern rather than dropping the entry.

- [ ] **Step 8: Verify locally in a browser**

```bash
cd /Users/benjaminherro/github/freeflix && make up d=1 && sleep 20
curl -s -o /dev/null -w 'diag -> %{http_code}\n' http://localhost:3001/bigscreen/diag
curl -s -o /dev/null -w 'stylesheet -> %{http_code}\n' http://localhost:3001/bigscreen.css
```

Expected: both 200. Open `http://localhost:3001/bigscreen/diag` in a desktop browser: the verdict
banner should report your desktop Chrome major (≥111, green), every swatch distinct, Left/Right
moving the gold ring, and the key log responding.

- [ ] **Step 9: Commit**

```bash
cd /Users/benjaminherro/github/freeflix
git add frontend/src/app/\(bigscreen\) frontend/public/bigscreen.css frontend/package.json
git commit -m "feat(bigscreen): TV root layout, legacy stylesheet and diagnostics page

A second root layout with no Tailwind and no providers, a hand-authored
Chromium-87-safe stylesheet linked straight from public/ so it bypasses
PostCSS, and a diagnostics page that reports the engine version, probes the
CSS/JS features the design depends on, logs remote key codes and plays a
library file through a plain <video>. A vitest guard (npm run test:tv) fails if
post-87 CSS or JS reaches the TV surface, if anything there imports
@/components, or if the TV colour tokens drift from globals.css."
```

---

## Task 8: Run the on-TV gate and record the result

Everything after this task depends on facts only the television can supply. This is deliberately
the cheapest possible test: the TV's **built-in browser**, no LG developer account, no Developer
Mode, no packaging.

**Files:**
- Create: `docs/superpowers/plans/2026-09-22-webos-tv-stage3-results.md`

**Interfaces:**
- Consumes: `/bigscreen/diag` from Task 7; the backend fixes from Tasks 1–5.
- Produces: recorded findings that decide the CSS strategy, the codec profile and whether the design needs revising.

- [ ] **Step 1: Prepare the instance**

```bash
cd /Users/benjaminherro/github/freeflix
ipconfig getifaddr en0 || ipconfig getifaddr en1     # the LAN address of the host
```

Make sure at least two titles exist in the library: one **1080p H.264 with AC3 or AAC** and one
**MKV/HEVC**, ideally one still downloading so the seek-into-undownloaded case is exercised. If a
DTS release is available, include it — §7.2 of the spec leaves DTS-at-1080p unresolved
deliberately.

Temporarily set `AUTH_ENABLED=false` in `.env` and `make up d=1`, so the diagnostics page can
list torrents before pairing exists. **Revert this immediately after the test.**

- [ ] **Step 2: Read the engine version off the TV**

On the TV: Home → Web Browser → `http://<host-ip>:3001/bigscreen/diag`.

Record the full user-agent string and the `Chrome/NN` major from the verdict banner. Also note the
model number from Settings → Support → TV Information (firmware only — it does **not** show the
engine).

- [ ] **Step 3: Record the feature probes and token rendering**

Photograph or transcribe the two probe tables. Confirm: all ten swatches distinct, the two type
families visibly different, body text comfortably readable from the sofa.

- [ ] **Step 4: Record the remote behaviour**

Press each of: the four arrows, OK, **Back**, Play, Pause, Stop, Rewind, Fast-Forward, and a
number key. Record every `key` / `keyCode` from the log. Confirm whether Left/Right move the gold
focus ring, and whether the Magic Remote pointer produces a cursor and hover.

- [ ] **Step 5: Record playback**

For each test title: press List torrents, select it, and record

- whether it plays at all, and `MediaError.code` if not;
- the `videoWidth x videoHeight` and duration from the metadata line;
- whether audio is present (the AC3 case is the one that matters);
- `-10s`, `+60s` and `Seek to 90%` — does each seek land and resume;
- for a still-downloading title, whether `Seek to 90%` produces the new **503** from Task 5
  rather than a silent stall. Press **Probe far seek (HTTP)** on the diagnostics page and record
  the whole readout (HEAD status, GET status, `Retry-After`, `Content-Range`) — a `<video>`
  element only ever reports `MediaError.code`, which cannot tell a 503 from a decode failure, so
  the status is otherwise unobservable on a TV with no devtools.

- [ ] **Step 6: Write up the results**

Create `docs/superpowers/plans/2026-09-22-webos-tv-stage3-results.md`:

```markdown
# webOS TV — stage 3 gate results

Run: <date>. Instance at http://<host>:3001/bigscreen/diag, TV built-in browser.

## Device
| Fact | Value |
| --- | --- |
| Model number | |
| Firmware | |
| User-agent | |
| Chromium major | |
| Inferred webOS version | |
| innerWidth x innerHeight | |
| devicePixelRatio | |

## Feature probes
| Probe | Result |
| --- | --- |
| oklch() | |
| color-mix() | |
| :has() | |
| container queries | |
| aspect-ratio | |
| backdrop-filter | |
| CSS.registerProperty | |
| Array.prototype.at | |
| Object.hasOwn | |
| structuredClone | |
| MediaSource | |

## Stylesheet
- All ten token swatches distinct: yes / no
- Display and UI faces visibly different: yes / no
- Body text readable from the sofa: yes / no
- Anything visibly broken:

## Remote
| Button | key | keyCode |
| --- | --- | --- |
| Up / Down / Left / Right | | |
| OK | | |
| Back | | |
| Play / Pause / Stop | | |
| Rewind / Fast-Forward | | |
| Number key | | |

- Left/Right moved the focus ring: yes / no
- Magic Remote pointer produced a cursor and hover: yes / no

## Playback
| Title | Container / video / audio | Plays | Resolution | Audio | -10s | +60s | 90% | MediaError |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| | | | | | | | | |

- Seek into an undownloaded region returned 503 (not a silent stall): yes / no

## Verdict

Pick one and say why:

- **Proceed as designed.** Engine below 111, hand-written stylesheet renders, MKV/HEVC
  direct-plays, seeking works. Continue to stage 4 (focus manager, rails, cards, home).
- **→ TAKEN, 2026-10-06. Proceed, simplified.** Engine at or above 111 — the existing Tailwind v4 stylesheet
  renders. Keep the separate `(bigscreen)` surface (the focus, layout and player work is
  unchanged) but the TV surface may use the normal build, and the guard test relaxes.
  **Also revert `browserslist: ["chrome 87"]` in `frontend/package.json` on this branch.**
  That pin is app-wide and permanently downlevels the *web* bundle for a TV-only reason
  this gate has just disproved (measured cost: `/downloads` 4.45→8.71 kB, `/members`
  4.55→8.8 kB, `/streaming/[id]` 20.1→24.5 kB).
- **Revise the codec strategy.** Rendering and remote fine, but direct play or seeking failed.
  Record exactly which files failed and how, then revisit spec §7.2/§7.4 — remember an HLS
  remux is unavailable on a Pi, so the lever is torrent selection, not transcoding.
- **Revise the approach.** Something fundamental failed. Reopen the spec's approach choice;
  fallback C (Jellyfin sidecar / DLNA) is the documented alternative.

## Follow-ups discovered
-
```

### Gate outcome, recorded 2026-10-06

`/bigscreen/diag`, opened in the TV's own browser, reported:

| Fact | Value |
| --- | --- |
| Verdict banner | `Chromium 120 — modern target` |
| Inferred webOS version | 25 (the 75-inch QNED99 8K — the one upgrade-eligible exception spec §3.1 named) |
| Feature probes | **all yes**, including `oklch()`, `color-mix()`, `:has()`, container queries, `@property` |
| Token swatches | all ten distinct |
| Remote key codes | as expected |

**Verdict: "Proceed, simplified"** — the second branch above. The design survives; the Chromium-87
assumption does not. Actions taken on master:

1. `"browserslist": ["chrome 87"]` removed from `frontend/package.json` — the explicit requirement of
   this branch. Measured recovery: `/downloads` 8.71 → 4.45 kB, `/members` 8.8 → 4.55 kB,
   `/streaming/[id]` 24.6 → 20.2 kB.
2. `legacy-target.test.ts` **split by rationale** rather than relaxed wholesale. The engine-driven
   bans are gone; the performance-driven ones (`backdrop-filter`, `mix-blend-mode`, `filter: blur()`,
   SVG filters, and the `framer-motion` / `globals.css` / `@/components` import bans) are kept in a
   separately commented list naming spec §9 as their authority, because TV silicon is not the browser
   engine. Every structural assertion — the pinned `@allow-legacy-probes` set, the import rules, the
   token-drift test — is unchanged.
3. **Not** done, deliberately: the `(web)` / `(bigscreen)` split stays, `public/bigscreen.css` stays
   hand-authored and outside PostCSS. "The TV surface may use the normal build" is permission, not
   instruction, and taking it would drag the hover-driven rails and the §9 blur stacks onto TV
   silicon. The 10-foot layout, focus management, remote handling and TV player are unchanged work.

Spec §3.1, §4.8, §5.3, §11.5, §12 and §14 and the "Two root layouts" paragraph in `CLAUDE.md` are
corrected to match, with the history preserved.

- [ ] **Step 7: Restore the instance and commit**

```bash
cd /Users/benjaminherro/github/freeflix
# Revert AUTH_ENABLED in .env, then:
make up d=1
git add docs/superpowers/plans/2026-09-22-webos-tv-stage3-results.md
git commit -m "docs(tv): record the stage-3 on-TV gate results"
```

- [ ] **Step 8: Stop and report before stage 4**

Do not begin the focus manager or any UI work until the verdict above is recorded and reviewed.
The whole point of sequencing this third is that it can change what stage 4 should be.

---

## Notes for whoever executes this

- **The spec is the argument; this plan is the mechanics.** Read
  `docs/superpowers/specs/2026-09-22-webos-tv-app-design.md` §3 and §4 before starting — §4 is a
  list of things that will silently break if ignored.
- **Tasks 1–5 stand on their own.** They fix real defects in the byte path and are worth merging
  even if the TV work stops at Task 8. The suffix-range bug in particular serves wrong bytes with
  a 200-series status today.
- **Task 6 is the only irreversible-feeling step.** It is a pure `git mv` with no URL changes; if
  the build complains about a missing root layout, a file was left directly under `src/app/`.
- **Do not add the pairing flow, the focus library, the codec profile or subtitles here.** They
  are stages 5, 4, 8 and 9 and each gets its own plan.
