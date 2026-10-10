# Stage 7 — the TV player

Branch `feat/tv-stage7-player`, off `master` at `3cbeacd` (the stage 6 merge).

Spec: `docs/superpowers/specs/2026-09-22-webos-tv-app-design.md` — stage 7 is "TV player:
controls, 461, seek boundary, 401 handling", detailed in §7.3, §7.4, §7.6, §8.3 and §4.5.

**Read `2026-10-10-tv-stage7-design-notes.md` first.** It is the design record: a seven-area
recon of the real source, each area adversarially re-checked against its own citations, then
four competing designs scored by three judge panels. Every claim there carries a `file:line`.
**The spec's line numbers for the player are stale** — `handleError` is at `VideoPlayer.tsx:1020`,
not `:906`. Where the code and the spec disagree, the code wins, and the notes say where.

## Scope

In: the `/bigscreen/watch/{torrentId}` route and player, D-pad transport controls, the Back
escalation, the seek boundary, honouring `503` + `Retry-After`, and handling `401` — plus the
backend work those require.

Out, with owners: codec-aware selection / the 4K opt-in / a quality picker (**stage 8**);
subtitles and `<track>` (**stage 9**); the webOS shell and the real root exit (**stage 10**).
The full deferral table is §5 of the notes.

## Verification, every task

From `frontend/`: `npx vitest run`, `npm run test:tv`, `npx tsc --noEmit`, `npm run build`.
Backend, in a **one-off container with tests mounted** (they are baked into the image, not
bind-mounted):

```bash
docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest -q
```

**Never** `docker compose up`, `down`, `restart`, or anything with `-V` — recreating the running
`backend` mid-download leaves a torrent seeding at 100% with no files on disk and there is no
`force_recheck` path to recover it.

**Re-baseline all four counts at branch start and quote them in task 1's commit.** The stage-6
numbers (121 files / 1894, `test:tv` 38 / 983, backend 543) are the starting point, not a target.

**Neither frontend guard runs in any build or in CI.** `test:tv` is path-scoped
(`package.json:13`: `vitest run 'src/app/(bigscreen)'`). Every CSS ban, import rule, token pin,
drift pin and focus invariant in this stage is enforced only by someone typing those commands.
This repo's own standing note is that **one green run proves nothing** — a 24% flake passed
eight agents during stage 6. The mutations below are the real proof, and they are manual too.

## Corrections found while implementing (read these before your task)

**`response.content == b""` is vacuous on a HEAD response.** HTTP strips HEAD bodies, so the
assertion passes whatever the handler returns. Task 1 found this by mutation, twice: the one-byte-401
mutation turned the GET rows red while a `content == b""` HEAD row stayed green, and the same for the
unregistered-422 handler. **This plan originally insisted on that assertion and was wrong.** On a HEAD
route, assert `content-length` and the absence of a JSON content-type — a bodied response still
announces the type on a HEAD. Eleven tests that could not fail have now been found in this project;
this one was specified by the plan itself.

**`wait_for_first_chunk`'s override kwarg is `budget`, not `piece_timeout`.** No `piece_timeout`
exists anywhere in `manager.py`. Task 1 pins the name so the next reader hits a test rather than a
`TypeError`.

**"HEAD 200 with the full `Content-Length` at zero bytes on disk" was two fixtures.** A genuinely
0-byte file answers `Content-Length: 0`, and that is what makes the `file_size <= 0` mutation
discriminating; "full `Content-Length`" only holds for a **sparse preallocated** file, which is the
common live case. Both are pinned as separate rows.

**The 404 details are distinct across the set, not across the routes**, and two collisions matter:
`/info`'s video-missing detail (`streaming.py:363`) is byte-identical to `_resolve_video_file`'s
(`:173`), so **a client cannot tell `/video` from `/info` by the detail string** — only by which route
it called. Worse for task 9: that one string is *"Video file not found or not ready for streaming"*,
which conflates **not-yet-ready** with **genuinely deleted**. `/info`'s own two details still separate
"Torrent not found" (terminal) from the rest, so the polling discriminator survives — but **task 9
must not infer "still preparing" from the detail alone.** Use the torrent's own state from
`getTorrentStatus` together with `/files` answering `200 []`.

**The 404s are JSON-bodied** (`HTTPException`) on routes a decoder loads — a third escape from the
empty-body contract, alongside `error_handler.py`'s JSON 500. Task 1 changed no hand-built status, so
this stands; task 5's classifier reads those details and should know.

**Task 2's "DB fallback" is really a *resume-data* fallback, and gate 3's rationale was inverted.**
The plan specified `os.path.getsize(path) == stored_size`, but **`stored_size` does not exist in the
database** — no path column, no per-file size (`sizes` is two human strings like `"1.5 GB"`), and
nothing in `backend/app` walks a directory. The real source is `resume_data`:
`lt.read_resume_data(decode_resume_data(blob)).ti` yields a full `torrent_info` **without touching the
session**. A directory walk is the obvious shortcut and is **silently wrong on a season pack** —
`?file_index=N` is a libtorrent index, and libtorrent orders files lexicographically and inserts pad
files, so a video-only enumeration renumbers the episodes. Separately: a size check **cannot** detect a
partial file in sparse storage mode (a high-offset write extends the file to full length with
zero-reading holes), so the sparse case the plan used to justify gate 3 is caught by `progress >= 100`.
**Gate 3's unique job is the truncated-or-replaced-on-disk case.** Both are needed, for different
reasons, and both mutations fail independently.

**`/files` answering `200 []` now has a third meaning, and task 9 must discriminate on state.** Task 2
made a finished-and-evicted torrent streamable but deliberately did **not** fix `/files`, so after a
restart a finished pack plays while its episode list is empty. The rule for task 9: read the torrent's
state from `getTorrentStatus` alongside the empty list — `finished`/`seeding` + `200 []` means
**evicted but playable**; a `PREPARING` state + `200 []` means **genuinely preparing**. It still never
means "this pack has no episodes".

**`wait_for_first_chunk` was already prepared for the evicted case** — its contract is "Torrent absent
from the session AT ENTRY → True. It completed and was removed, so every byte is on disk" — so no
second production change was needed there. The design notes understate how ready the code was.

**Watch for test fixtures that stub one manager call and not the other.** `_resolve_video_file` now
makes two. Task 2 extended `test_stream_status_matrix.py`'s `no_video_file` fixture with the second
stub and a docstring, because otherwise those 404s would quietly be asserting that no row with that id
exists in whatever database the process reaches. Five neighbouring streaming suites carry the same
latent coupling, deliberately untouched and green.

**A long `advanceTimersByTime` inside ONE `act()` cannot observe a re-render, and silently makes a
dep-array mutation unfalsifiable.** React commits queued updates only when `act()` exits, so a host
that re-renders from a 200ms interval never actually re-runs its effects if the whole span is advanced
in a single `act()`. Task 5's single most important mutation — the callback moved into the interval
effect's dep array — was **green** because of this. Fix: **one `act()` per slice**, plus a non-vacuity
assertion that the hook really received many distinct closures (task 5 asserts >50). This is a general
trap for every fake-timer test of a React interval in this repo; a targeted audit of the other
fake-timer suites is **parked**, not done.

**Three more test-infrastructure facts task 5 measured**, all worth copying rather than rediscovering:
a listener tally must understand `{ once: true }`, because a naive add/remove count over-counts a
one-shot that already fired — which is the exact state being asserted (copy its `trackListeners`);
**React attaches its own listener for every media event to every `<video>` it creates**, whatever the
props (12 calls for 4 names, measured) and removes none on unmount, so "registered once" can never be
an absolute count; and **vitest unwinds `afterEach` in reverse registration order**, so a local
`vi.runOnlyPendingTimers()` runs before testing-library's cleanup and fires a timer `setState` outside
`act()` — wrap it.

**A getter-not-element test needs the getter to have already been called.** Task 5's element-getter
test was green under an element-caching mutation because it remounted the `<video>` before any
`attempt()`, so the cache simply picked up the new node. **Spend one rung on the first element before
the remount.**

**`git checkout -- <file>` on a file you are also editing is a destructive restore, not a mutation
undo.** It silently discarded task 1's own uncommitted handler, because HEAD had nothing to restore.
It also **cannot restore an untracked file at all**, which bit task 7 and left a mutation in place for
a full run. Every remaining task does mutation testing: snapshot with `cp` and restore from the
snapshot, for new files as well as edited ones.

**`nestedArrowClaim.test.tsx`, written on the layout task 8 specifies, CANNOT FAIL.** With the scrub
cell alone in its row, deleting `useFocusGrid.ts:248`'s `if (e.defaultPrevented) return` leaves the
whole suite green. `move` never wraps left/right between rows (`model.ts:95-97`), so on a one-cell row
an unclaimed arrow moves nothing, `go` returns early on `!changed && document.activeElement === el`,
and the hatch has **no observable effect**. Task 7 measured this, then gave the claiming row **two
cells** — the smallest shape that can see the hatch, and also the live defect class it prevents (the
web's ±20s double-seek, `VideoPlayer.tsx:728`/`:1619`: a window handler and a nested one both acting on
one press). The one-cell shape is kept as the suite's last test, labelled as the second, independent
defence it is. **Hazard 6's "the ring jumps off the bar" is therefore wrong about this code** for the
layout task 8 is told to build: a horizontal press at the boundary of a one-cell row moves nothing even
unclaimed. Task 8's unconditional claim is still right — it keeps `describeScrub`'s refusal the thing
the viewer sees, and it is what makes a future sibling cell in that row unreachable rather than
double-acting — but **do not write its "most important mutation" expecting the ring to move**; assert
the refusal reached the readout, and keep a two-cell fixture if you want the claim itself pinned.

---

**Standing guard from task 4 onward:** `npx vitest run src/components/player` reports its
baseline (4 VideoPlayer suites + `UpNextCard`) **unchanged, with no file edited but
`VideoPlayer.tsx`**. That is the cheapest proof the production web player stayed intact.

## Two decisions, settled before planning

**1. Making a finished download streamable is in scope (task 2).** Verified, not assumed:
`find_loadable_on_startup`'s docstring (`database/models/torrents.py:120-121`) says
"Paused/stopped/**finished**/seeding/error stay unloaded", and `_refresh_active_torrents`
(`manager.py:438`) evicts `finished` mid-session. So after a backend restart a completed torrent
is absent from `active_torrents`, `_resolve_video_file` 404s, and the title is unplayable. The
handler for exactly this case **is already written** — `manager.py:1337-1338`: "No live torrent
(e.g. completed and removed from the session) → every byte is already on disk; serve straight
through" — and is unreachable only because the resolve step 404s first. It is a live product bug
affecting the web too, and the TV's main content is finished downloads.

**2. Auto-seek on arrival, not a rebuilt resume prompt** — a deviation from §8.3, taken
deliberately. The detail screen's control already reads "Resume from 1:02:05" and then drops
`atSeconds` on navigation, so a player starting at 0:00 is a control whose label lied, which is
the defect class `_data/title.ts:33` says this surface refuses. A prompt is also a second
focusable region, meaning a fourth mutually exclusive child with its own grid, since only one
`useFocusGrid` may be live. §8.3's real point is "do not use `ui/fre/Modal.tsx`" — it traps Tab
and closes on Escape, neither of which a remote has — not "ask a question the previous screen
already asked". Cheap to add later as a fourth child; expensive to retrofit.

---

## The sharing decision

**Share the arithmetic. Copy the element driving. Pin both with a value-import test inside the
`test:tv` glob.** Full justification in §1 of the notes.

`frontend/src/lib/player/streamRecovery.ts` — pure, no React, no DOM, one import (`@/types`).
Exports the five tuning constants (today **component-body locals** at `VideoPlayer.tsx:122-141`,
re-created every render and therefore unimportable and invisible to every test) plus
`recoveryStep`, `stallStep` and `streamAdvice`. The TV surface may import `@/lib/*`: the guard
(`legacy-target.test.ts:194`) blocks only `@/components`, checked one hop deep, and a module
importing only `@/types` passes.

Three points that make it safe rather than merely small:

- **`expectingPlayback` is an input, not a predicate the module computes.** The web passes what
  it computes today (`playerState.isPlaying && !video.paused && !video.ended`), so its behaviour
  is byte-identical, race included. The TV passes a predicate that **never reads `video.paused`**,
  because `load()` sets `paused` with no `pause` event — which is what makes the web's escalation
  latch race the recovery it just triggered. The divergence lives in the callers.
- **`streamAdvice` takes `busy`.** The TV passes the real value and so does not inherit
  "Waiting for peers (0 connected)" on a finished 0-peer title playing perfectly from disk
  (`VideoPlayer.tsx:1317-1328` — a real bug, parked, not fixed here).
  **Corrected during task 4** — this originally read "the web passes `true` unconditionally, so its
  copy is unchanged", which is wrong. The web gated its **slow** branch on `isBuffering || isStalled`
  and its **noPeers** branch on nothing, so a web passing `true` and consuming the verdict directly
  would start showing "Buffering — slow connection" during healthy playback. `busy` must gate **both**
  branches inside the module (that is the only shape in which `busy: false` + 0 peers answers
  `'none'`, which is the row that stops the TV inheriting the lie), and the `isBuffering || isStalled`
  conjunct therefore **stays at the web call site, on the slow branch only**. Commented in both files.
- **The escalation latch is a field on the sample**, cleared only by an explicit reset. The
  reducer never clears its own latch from a predicate.

**Not shared, copied into `(bigscreen)/_player/`:** the element-driving sequence (~65 lines).
Capture the playhead **before** `v.load()`; restore on a **one-shot** `loadedmetadata` guarded
`if (t > 0)`; detach handle in a ref; resets on `playing` and on source change **including the
cleanup that clears the pending timeout and invokes the detach handle** (`VideoPlayer.tsx:716-721`
— drop it and a reload plus a stale listener leak across a title change, spending four rungs
across an evening). Also TV-local: **no audio-intent machine** (four refs, ~120 lines, for a
Chrome autoplay policy nobody has measured on this panel; the TV owns volume and §8.3 deletes the
slider). `preload="metadata"` on the TV element; the web's `"auto"` is **not** changed.

**Already shared — import, never re-derive:** `@/utils/streamHealth.ts` imports only `@/types`, so
`deriveStreamHealth` is TV-importable today. §7.6's claim that "the health logic" lives in
`VideoPlayer.tsx` is **wrong** — the component holds message copy and chips, and
`types/index.ts:132-134` explicitly forbids a second definition. Note `(bigscreen)/_data/httpStatus.ts`'s
`statusOf` is an **axios-rejection** reader and is the wrong helper for a `fetch` probe (`fetch`
does not throw on 401, so it answers `undefined`). Two mechanisms, deliberately not merged.

**The drift pin:** `(bigscreen)/_player/engineContract.test.ts`, inside the `test:tv` glob (a test
under `@/lib/player/` would sit outside the TV's only guard). Value-imports the constants and
asserts the TV engine reads them; source-pins that both recovery paths call `.load()`; and carries
`DELIBERATELY_DIFFERENT: Record<string, string>` naming every divergence with its reason, with a
self-check that the map is non-empty and every key names a real divergence.

**Non-vacuity, proved not argued:** `VideoPlayer.recovery.test.tsx:117-143` hard-codes
`const ladder = [1000, 2000, 4000, 8000]` and ticks `delay - 1` then `1`. Shorten a rung in the
shared module and that existing web test goes red. That is the only evidence the web **actually
adopted** the shared table rather than keeping a copy, and it costs nothing.

**Revisit trigger, binding:** if a fourth behavioural divergence accumulates — stage 9's `<track>`
handling landing on both surfaces, or a second shared recovery concern — extract the element
driving too.

---

## Task 1 — The stream status matrix, as an executable contract

**Files:** `backend/tests/test_stream_status_matrix.py`, `backend/app/main.py`

The whole stage's client logic is a switch over what these routes answer, and two careful recon
agents disagreed about that switch **in both directions**. Pin it first so every later branch
branches on something proved. One parametrised case per answer across `GET /video`, `HEAD /video`,
`GET /info`:

- **401** — assert `response.content == b""`, not merely the status. Needs the `auth_enabled`
  fixture (`conftest.py:52`): the suite pins it `False` session-wide and `require_session`
  short-circuits to `_DEV_CONTEXT` before reading a cookie, so **the 401 path is dark in the
  default dev compose as well as in tests**. Model on `test_owner_password.py:162`.
- **416** — `Content-Range: bytes */{size}`, and **no** `Accept-Ranges`.
- **503 × 3, separately** — unallocated file (`:269`) and first-chunk failure (`:316`) carry
  `Accept-Ranges`; the catch-all (`:337`) does not. Three meanings, identical status, identical
  `Retry-After: "2"`, identical empty body — and the catch-all covers permanent faults. This is
  why the ladder is bounded rather than retried forever.
- **404 × 4 distinct details** — the three from `_resolve_video_file` plus `/info`'s own
  "Torrent not found". Only the detail string separates "deleted" from "evicted", and `/info`
  does **not** route through `_resolve_video_file`.
- **422** — the one a recon agent said could not happen. `?file_index=null`, `NaN` and `` all hit
  FastAPI's default `RequestValidationError` handler and return `{"detail":[...]}` **JSON into a
  decoder**, via a raw `<video src>`.
- **HEAD 200 with the full `Content-Length` at zero bytes on disk** — `head_video` runs
  `os.path.getsize` with no guard while `parse_range_header`'s `if file_size <= 0` is consulted
  only by GET. So HEAD 200 is **not** evidence playback will start, and **HEAD structurally
  cannot see the 503**.
- **`wait_for_first_chunk`'s budget**, both ends, via the explicit `budget` kwarg (**not** `piece_timeout`, which does not exist): 2.0s at
  zero peers, reaching 60s only around 3.4 MB/s. The common TV failure — no peers — answers 503 in
  about two seconds, not sixty.
- **`quality` is accepted and never read** on both routes.

Then add the 422 handler, **scoped, not app-global**: an `@app.exception_handler(RequestValidationError)`
returning a bare `Response(status_code=422)` when `request.url.path` matches the two video routes,
otherwise reproducing FastAPI's default body. `main.py` has exactly one handler today, so a
mis-scoped one changes the 422 body for every router and breaks the three live readers of
`response.data.detail` (`_data/title.ts:362`, `(web)/claim/page.tsx:28`,
`(web)/auth/reset-password/page.tsx:19`). **Pin the default shape with a case on a non-video route.**

- [ ] **Step 1: write the matrix**, then add the scoped handler.

**Mutate** (this task *is* proof, so the mutations go into production code): change one
`Retry-After` to an HTTP-date; delete `Content-Range` from the 416; give the 401 a one-byte body →
the `content == b""` assertion fails, proving it checks the body and not just the code; remove the
new handler; add a `file_size <= 0` guard to `head_video` → the HEAD-200-at-zero-bytes case fails,
proving the asymmetry is pinned deliberately; add `Accept-Ranges` to the catch-all 503; **break the
non-video 422 shape** → the default-shape case fails.

**Does not:** no feature, no client code, no change to any status the endpoint hand-builds. Adds no
body or diagnostic header to the 401 or the 503s — whatever those return is fed straight to a decoder.

**Depends on:** nothing.

---

## Task 2 — A finished download is still streamable

**Files:** `backend/tests/test_finished_torrent_streamable.py`, `backend/app/api/streaming.py`,
`backend/app/torrent/manager.py`

First because it can invalidate the stage. See the settled decision above for the verified
mechanism. `skip_non_video_files` sets non-video priority 0 with `content_guard_enabled: bool = True`,
so a release with an nfo or a sample **never becomes a pure seeder** and libtorrent's terminal state
is `finished` — precisely the state `_refresh_active_torrents` pops (`seeding` is **absent** from
that filter, so steady-state eviction hits only `finished`, while a **restart** unloads both via
`find_loadable_on_startup`). Then `get_video_files` returns `[]`, `_resolve_video_file` 404s,
`/info` 404s separately, and `/files` answers a misleading `200 []`.

- [ ] **Step 1: a characterisation test, not a fix.** Build a `finished` row with a real temp file,
  absent from `active_torrents`, and assert exactly what all four endpoints answer **today**. Record it.
- [ ] **Step 2: the DB fallback** inside `_resolve_video_file`, which makes the already-written
  straight-through branch (`manager.py:1337-1353`) reachable. **Three guards, all load-bearing:**
  terminal DB state (`finished`/`seeding`), `progress >= 100`, **and
  `os.path.getsize(path) == stored_size`**. The straight-through branch does **no piece gating**, so
  an ungated fallback serves **sparse zero bytes** off a partial file into a decoder — which presents
  as corrupt media, not as an error. Honour the content guard. Keep the two `/info` 404 details
  distinguishable.

Do **not** touch `_refresh_active_torrents` or `find_loadable_on_startup` — that is the download
lifecycle and every other consumer of `active_torrents`. Record as follow-ups: the two disagree about
`seeding`, and `POST /torrents/action/{id}` with `resume` applies no state filter while the batch
endpoint honours `RESUMABLE_STATES`.

**Mutate:** make the gate unconditional and truncate the file → the sparse-file test must fail
(**the mutation that matters** — its failure mode is silent corruption, not an error); delete
`progress >= 100` with a half-downloaded row; delete the size check → a short body where it
previously 404'd; put the torrent back into `active_torrents` → the fallback must **not** fire,
proving it did not become the general path; delete the content-guard check; flip the
characterisation test's asserted status 404→200 → it must fail, proving it reads a real response
and not a swallowed exception.

**Does not:** reload completed torrents into the libtorrent session; change state-machine filters.

**Depends on:** nothing.

---

## Task 3 — `contiguous_available`: the run containing a byte offset, on `/info`

**Files:** `backend/app/torrent/manager.py`, `backend/app/api/streaming.py`,
`frontend/src/types/index.ts`, `backend/tests/test_contiguous_available.py`,
`backend/tests/test_streaming_info_boundary.py`

The seek boundary has no data source anywhere — `grep -rn "contiguous\|seekable\|available_bytes"`
over `backend/app` and `frontend/src` is empty. `/info`'s `downloaded`/`progress` are
`handle.file_progress()` **totals** counting scattered pieces, and each Range request re-anchors the
deadline window at a fresh mid-file offset, so holes ahead of the frontier are the normal state: a
bar drawn from `progress` permits exactly the seek the boundary exists to refuse.

`contiguous_available(torrent_id, file_index=None, at_bytes=0) -> Optional[dict]` next to
`_pieces_ready`, returning `{file_index, file_size, piece_length, run_start, run_end, complete,
measured_against}`.

**The run containing `at_bytes`, not a from-file-start scalar.** `prioritize_video_files` marks
**every** video file priority 7 while `set_sequential_download` is per-**torrent**, so for episode 5
of a pack libtorrent fills the lowest-index episode first and a from-file-start figure legitimately
sits near zero while playback runs off the deadline window — a scalar refuses every seek inside the
episode actually being watched. `at_bytes=0` degenerates to the prefix §7.4 literally asks for.

Arithmetic, each hazard with its own test: `fi.offset` (every file but the first in a pack has a
non-zero one); `max(0, …)` (a missing first piece makes the raw product **negative**);
`min(file_size, …)` (the last piece is partial and overshoots); integer `//`, never `int(a / b)`
(`manager.py:1286` still uses the float idiom and this is off-by-one-sensitive at multi-gigabyte
offsets); bound the walk (~3,800 pybind calls on a 30 GB file at 8 MiB pieces) and memoise ~1s;
**guard the whole body in one `try` returning `None`, and do not use `_safe_have`** — its per-piece
`False`-on-error silently turns an invalidated handle into a zero-length run, refusing all seeking
on a complete file.

**`None` means unknown.** Only a measured value may report a zero-length run. Three paths answer
`None`: absent from `active_torrents`, no metadata, `have_piece` raised. Do **not** short-circuit on
`file_progress()[idx] >= fi.size` alone — both call sites pass no granularity flag, so that counts
unverified blocks and would report `complete` at exactly the moment a tail seek still blocks; gate it
on `have_piece(last_piece)` too.

On `/info`: accept `at: Optional[int] = Query(None)`, add the block inside `video_file`, and **delete
the dead `file_progress = torrent_manager.get_file_progress(torrent_id)` at `streaming.py:366`** — a
wholly wasted full libtorrent pass, assigned once and never read, which partly pays for the walk.
Mirror as optional on `VideoFileInfo`. Keep `/info` a bare dict; no `response_model`.

**No seekable seconds server-side.** There is no duration anywhere in the backend, and `/info` has no
profile identity (its only gate is a decorator-level `require_session_silent`, which resolves an
*account*, and `require_profile` needs a `{user_id}` path param `/info` does not have). Ship bytes
plus `measured_against` and let the TV convert.

- [ ] **Step 1: the manager function**, then the endpoint field and the type.

**Mutate** (reuse `_FakeTI`/`_FakeHandle` from `test_first_chunk_precheck.py:42`): drop `max(0, …)`;
drop `min(fi.size, …)`; replace `fi.offset` with 0 → the pack case fails; swap the fake's `file_at`
for one ignoring its argument → the pack case fails, proving the test exercises file offsets at all;
use `_safe_have` with a raising handle → a zero-length run instead of `None`; drop the
`have_piece(last)` conjunct → byte-complete-but-tail-unverified reports `complete: true`; `//` →
`int(a/b)` with an offset and piece length chosen so rounding shifts the index. Endpoint: serialise
the unknown case as a zero run; omit the key; restore the `get_file_progress` line monkeypatched to
raise; point the block at `downloaded` → a deliberate-hole fixture must fail.

**Does not:** no seconds, no Pydantic model, no change to `downloaded`/`progress`.

**Depends on:** 1.

---

## Task 4 — `@/lib/player/streamRecovery.ts`, adopted by the web

**Files:** `frontend/src/lib/player/streamRecovery.ts`, `streamRecovery.test.ts`,
`frontend/src/components/player/VideoPlayer.tsx`

The whole of the sharing decision above. Move the five constants out of the component body and
substitute at three call sites: `checkForStall`'s body, `attemptRecovery`'s ladder arithmetic, and
the `healthMessage` IIFE. `expectingPlayback` and `busy` are **inputs**, and the web passes exactly
what reproduces today's behaviour.

**Hard stopping rule, applied per substitution site:** all existing VideoPlayer tests pass with
**zero edits**. If one needs editing, that substitution went too far and is reverted.

Nothing else in `VideoPlayer.tsx` is touched. The known defects stay live and are parked with their
lines: the interval's identity hostage to the unmemoized `onRecoveryExhausted` prop
(`:603 → :658 → :661`); the stale `isBuffering` reads (`:869`, `:1058`); `attemptRecovery` absent
from the listener effect's deps (`:1154`); the ±20s arrow double-seek (the window handler at `:728`
proceeds when focus is inside the player **or** the player is fullscreen — an AND of negatives, so
during a film it is a genuinely global claim — and never checks `defaultPrevented`).

- [ ] **Step 1: the module and its tests**, then substitute, then prove the web suites unedited.

**Mutate:** pure tables, no DOM. `stallStep` — a `timeupdate` landing immediately before the tick
does **not** read as frozen (the `.stall` suite's scenario, re-pinned as a value); a 6s freeze →
`buffering`; a 10s freeze → `escalate` **once**, latch holding across later ticks; a reset re-arms;
`expectingPlayback: false` clears without escalating. `recoveryStep` — rungs, then exhausted, and
exhausted stays exhausted. `streamAdvice` — all three branches plus `busy: false` + 0 peers →
`'none'`. Then shorten a rung → `VideoPlayer.recovery.test.tsx` must go red.

**Does not:** touch the web's `preload`, its audio machine, its JSX, or any parked defect.

**Depends on:** nothing.

---

## Task 5 — `(bigscreen)/_player/`: the TV engine and the drift pin

**Files:** `(bigscreen)/_player/recovery.ts`, `useStallWatch.ts`, `classify.ts`, their tests,
`engineContract.test.ts`

`createRecovery({ getVideo, onStatus, debug })` with `attempt(afterMs?)`, `noteHealthy()`,
`noteSourceChange()`, `dispose()` — a plain factory over an element **getter**, so a remount cannot
leave it holding a dead node. Imports the ladder from `@/lib/player/streamRecovery`. Owns its own
resets **and** the source-change cleanup's two jobs. **Exhaustion latches** (the web's `:542` returns
without a flag so it re-fires on every further error, and on the TV there is no source switcher at the
end of that loop). Attempts are **bounded**, not backed off forever.

`useStallWatch` — the interval lives in an effect with `[]` deps and a **ref-held callback**;
listeners registered once against a stable element ref; `expectingPlayback` **does not read
`video.paused`**; while a recovery is in flight the detector is **suspended**, not re-armed. Returns
a status value, not three setStates.

`classify.ts` — `classifyStreamFailure({ src, fetchImpl, signal })` → `{kind:'session'}` |
`{kind:'retry', afterMs}` | `{kind:'gone', detail}` | `{kind:'badRequest'}` | `{kind:'decode'}` |
`{kind:'unknown'}`. This finishes a contract `dependencies/auth.py:143-156` already *asserts* exists
("The player's error handler checks the status explicitly and routes to sign-in") and which does not:
`grep -rn 401 frontend/src/components/player/` is empty.

- **HEAD only.** Every `GET /video` runs `prioritize_video_files` + `force_start_for_stream` (a DB
  write) and then `_prioritize_window`/`_deadline_pieces` over 32 pieces at the file head,
  re-deadlining every 250ms — **unconditionally, even on a complete torrent**. A `Range: bytes=0-0`
  "cheap probe" hijacks libtorrent's deadline queue away from the live playhead. `head_video` touches
  only `os.path.getsize` and is registered above GET for exactly this reason. Pin it
  **structurally**, because no behavioural assertion can observe a DB write.
- **Plain `fetch`, not `apiClient`** — the interceptor would hard-navigate to `/bigscreen/pair` from
  inside the rejection handler before any player code ran. Same-origin through the Next rewrite, so
  `credentials: 'same-origin'` carries `ff_session`. **Always an `AbortController` with an explicit
  timeout**: neither `fetch` nor `apiClient` sets one, so a probe against a wedged backend hangs and
  stacks.
- **Not `statusOf`** (axios-rejection shape; answers `undefined` for a `fetch` Response).
- `Retry-After` parsed as seconds with a floor, a cap and a 2000ms default — **never `NaN`**.
- **Write the limit in the module header: HEAD cannot observe the far-seek 503.** It answers 200 from
  metadata whatever the download position. The 503 reaches the player two ways only — prevented by
  task 6's clamp, or inferred when the ladder exhausts while HEAD still says 200, which yields
  `decode` (HEVC and DTS at 1080p are both unverified on this panel, so saying so is truthful). A
  classifier documented to do something it structurally cannot is the kind of test-shaped lie this
  project tracks.

- [ ] **Step 1: `recovery.ts` + `useStallWatch`**, then `classify.ts`, then the drift pin.

**Mutate:** port the five recovery assertions onto a ~15-line host rendering a **real** `<video>`
(all five do `container.querySelector('video')`, so a stub will not do, and jsdom needs the
`load`/`play`/`pause` prototype stubs from `recovery.test.tsx:23-27`). `v.load()` → a `currentTime`
write; restore immediately rather than on `loadedmetadata`; drop `if (t > 0)`; remove the latch and
fire a fifth error → two exhausted callbacks; delete `noteSourceChange`'s cleanup → assert **no
pending timer and exactly zero attached `loadedmetadata` listeners after a source change, exactly one
after two `attempt()` calls, none after `dispose()`**; ignore `afterMs` → the `Retry-After` override
fails.

**The test no existing suite can have:** a host that re-renders every 200ms with a **fresh** callback
closure still escalates after a frozen playhead. Mutation: put the callback into the interval effect's
dep array → must fail. The web survives this bug only because its poll period is 5000/1500ms, above
1s; a TV page re-renders on a controls-auto-hide clock, a progress poll and a scrub readout.

`classify.test.ts` against a stubbed `fetchImpl`, one row per status from task 1's matrix. Mutations:
`method: 'HEAD'` → GET with a Range → `expect(fetchImpl.mock.calls[0][1].method).toBe('HEAD')` and
"no call carries a Range header" must fail; 404 → `retry`; absent `Retry-After` → `NaN`;
`statusOf(res)` instead of `res.status` → every case collapses to `unknown`; HEAD-200 → `retry`
instead of `decode`. Mutate the drift pin **both ways**: break the shared table → red; make the TV
re-inline a local copy → red. Empty `DELIBERATELY_DIFFERENT` → the self-check fails.

**Does not:** no audio-intent machine, no source switching, no `MediaError.code` branch ahead of the
status.

**Depends on:** 1, 4.

---

## Task 6 — The pure TV boundary modules

**Files:** `(bigscreen)/_player/fileIndex.ts`, `seekBoundary.ts`, `formatTime.ts`, and their tests

`fileIndex(raw: string | null) -> number | undefined` and `streamSrc(torrentId, fileIndex)`.
`watchHref` is **the only** builder of a watch URL on this surface and uses `!= null` deliberately,
because **file 0 is the first file of a season pack** (`watchHref.ts:3`, pinned at
`watchHref.test.ts:13`). The reader must mirror it: null check → `Number()` → `Number.isInteger()` →
non-negative, normalised to `number | undefined` and **never `null`**.

One `null` produces **two different** silent failures: `getStreamingUrl` gates on `!== undefined` and
emits the literal `?file_index=null` → a 422 with a JSON body fed to the decoder; `getStreamingInfo`
passes it to axios, which **drops null**, so `/info` silently resolves `max(files, key=size)` and
returns *that* file's `content_id`/`season`/`episode`, which the heartbeat then writes. The silent one
is worse. `?file=` empty → **undefined, not 0** (`Number('') === 0`; the web page maps it to 0, so a
truncated URL there plays the first file). Pass no `quality` (accepted and never read; it changes the
URL and any cache key for nothing). Never use `/info`'s `stream_url`, which appends `?file_index=`
only when the **caller** passed one while the sibling `file_index` reports the **resolved** index —
self-inconsistent on exactly the one arrival allowed to be bare.

`seekLimitSeconds` / `clampSeek`. **`null` run → unbounded, never 0** (three backend paths legitimately
answer unknown, and a ceiling of 0 refuses every seek on a complete file — the TV's main content).
`Math.floor(duration * run_end / size) - MARGIN_S`, floored at 0, then **raised to the playhead**: for
a pack episode the run can sit behind `currentTime`, and a clamp without that lift would yank the
viewer backwards or refuse to start. Refuse **forward** seeks only; never rewrite `currentTime`. Always
return a number **and a `reason`** — a press is never silently refused on this surface.

**The margin is not cosmetic:** a seek landing just *inside* the frontier passes `wait_for_first_chunk`,
the 206 is sent, and the next chunk sits in `stream_file_range`'s mid-stream poll — where `cap = 300.0`
and `waited = 0.0` are **both re-initialised inside the `while remaining > 0` loop**, so the hold is
300s *per chunk* and unbounded in total, with no status code left to signal with. Floor the
bytes→seconds fraction; VBR diverges. (For the record: §7.4's "a far seek holds the socket for up to
300s" is **stale** — stage 1 capped the pre-response wait at `_adaptive_piece_timeout`, 2-60s.)

`formatTime` — extracted from `_components/PrimaryAction.tsx:34` into its own module (the
`watchHref.ts` reason: a screen test that mocks one thing should not take the formatter with it) and
**padded against the total duration**. As written it returns `m:ss` below an hour, so a scrub readout
would show `4:12` beside `1:32:00` — two field counts in one ten-foot readout.

- [ ] **Step 1: tables and tests for all three.**

**Mutate:** `fileIndex` — `!= null` → truthiness → the `file=0` row fails; drop `Number.isInteger`;
return `null` for a miss → **a test that runs the result through `getStreamingUrl` and through
`getStreamingInfo`'s params shape, asserting no `null` and no `NaN` survives either**, must fail (one
test, both failure modes, pinned at the seam); drop the empty guard → `''` becomes 0; add `quality` →
the URL-shape assertion fails. `clampSeek` — remove the margin → a seek to exactly `run_end` is
allowed; `null` → 0 → the unbounded row fails; remove the playhead lift → the pack row fails; drop
`reason`; `Math.ceil` → the errs-low row fails. `formatTime` — pad against its own value → the
`4:12`-beside-`1:32:00` row fails.

**Does not:** no element, no network, no React.

**Depends on:** 3.

---

## Task 7 — The key layer

**Files:** `(bigscreen)/_focus/useMediaKeys.ts`, `useRevealOnKey.ts`, their tests,
`_focus/nestedArrowClaim.test.tsx`

Nothing in `frontend/src` recognises any media key under any spelling. Build `useMediaKeys` in the
`useBackKey` idiom: exported, test-pinned `MEDIA_KEYS` **and** `MEDIA_KEY_CODES`; rejects alt/ctrl/meta
chords; bails on `defaultPrevented`; `preventDefault`s **only** keys it acts on (`useBackKey.ts:35` —
"`preventDefault()` on a key this does not act on is how Back stops working on a device nobody can
attach a debugger to"); latest callback via a layout-effect ref. §7.4 rebinds Rewind/Fast-Forward to
**±60s jumps**, not continuous scan.

**The header must say which half is which:** `415/19/413/417/412` are **recalled platform
documentation, not a reading**, and that Chromium 120 on webOS 25 populates `e.key` at all is a
**guess**. The repo records exactly one number, 461 for Back, and records it as unverified.

`useRevealOnKey` — one `window` keydown with `{ capture: true }`, `[]` deps, the timer in a ref so a
key repeat costs no render. Claims nothing while visible, does **not** check `defaultPrevented` (it
must still hear arrows the grid claimed — those are activity), and while hidden swallows the first
press **except the Back spellings**, imported from `useBackKey`'s exported lists, or Back reveals and
collapses in one press and the escalation is unreachable. `{ capture: true }` beats an
earlier-registered bubble listener in **both** dispatch shapes (the device's, fired at the focused
element, and this repo's tests', fired at `window`) because the capture pass runs the whole path
including the target first — not declaration order, which is an accident.

`nestedArrowClaim.test.tsx` — **the missing test the whole "arrows seek only on the transport bar"
design rests on.** The two existing "already claimed" tests prove registration order
(`useFocusGrid.test.tsx:152`) and propagation order on `document` (`useBackKey.test.tsx:86`). Neither
proves React's **synthetic** path for an arrow.

- [ ] **Step 1: both hooks**, then the nested-claim test.

**Mutate:** fire at `document.activeElement`, **never with the house `arrow()` helper**, which
dispatches on `window` and which a React `onKeyDown` never sees — a test written with it passes while
asserting the wrong thing. Use the house real-remote fixture `{ key: 'Unidentified', keyCode: N }`
(five existing suites use it; it is the half most likely to be the live path). Drop
`MEDIA_KEY_CODES` → the keyCode-only row fails; add `'ArrowLeft'` to the forward list → the
arrow pass-through row fails; add `'Enter'` → the "Enter, Back and arrows all leave
`defaultPrevented === false`" row fails; add a `defaultPrevented` check to the reveal listener → the
claimed-arrow-is-activity row fails; remove the Back exemption; remove `{ capture: true }`; move the
timer into state → the render-count assertion fails. For the nested test: mutate away
`useFocusGrid.ts:248`'s `if (e.defaultPrevented) return` → it must fail, proving it exercises the
hatch and not a coincidence.

**Does not:** implement the media codes as a dependency — every media-key action gets a focusable
on-screen twin in task 8, so an unrecognised key is a missing shortcut, not a missing feature.

**Depends on:** nothing.

---

## Task 8 — The control surface: CSS, transport row, scrub cell

**Files:** `frontend/public/bigscreen.css`, `(bigscreen)/_player/TransportBar.tsx`, `ScrubBar.tsx`,
`describeScrub.ts`, their tests

**No reuse of the web JSX:** banned GPU CSS runs through six of its control clusters (`mixBlendMode`,
`feTurbulence`, five `backdropFilter` sites) **plus a Tailwind `backdrop-blur-md` on the health chip at
`:1405`**, and `backdrop-blur` is a pinned forbidden substring.

A self-contained `.bs-player__*` block. `.bs-player` is `position: fixed; inset: 0; isolation: isolate`
— **not decoration**: absolutely positioned children paint **over** their parent's own outline, which
already cost this stylesheet its one full-bleed focus stop. `.bs-player__video` absolute inset 0 at
`z-index: -1`, `object-fit: contain`, black. `.bs-player__scrim` a bottom-anchored `linear-gradient`
scoped to the **band**, not the viewport (fill rate over a decoding 1080p surface is the budget), with
`--ink` written out as `rgba(10,10,11,…)` as `.bs-hero__scrim` does. `.bs-player__bar` carries
`padding: var(--safe-y) var(--safe-x)` itself and gets a `--hidden` modifier setting **opacity only**,
with the house motion token. `.bs-player__row` is `flex-wrap: nowrap` — **do not borrow `.bs-controls`**
(`flex-wrap: wrap`); one focus row wrapping onto two visual lines is what the search block forbids.
`.bs-player__scrub` full-width, ≥60px, gold ring at `outline-offset: 2px`, **no `transform: scale()`**.
Three stacked track layers (played / run boundary / remainder) in the `.bs-card__bar` language with
widths as inline styles. Reuse `.bs-btn`/`.bs-btn--ghost` unchanged, and `.bs-msg` for the reserved
status line — mounted **outside** the band's padding, because `.bs-msg` carries `padding: 0 var(--safe-x)`
itself and would double-inset by 96px a side. **Do not widen `.bs-video`** (1280px; the diag harness
depends on it) or reuse `.bs-page` (`overflow-y: auto`; the grid calls `scrollIntoView` on every move
with no opt-out, so the player must not scroll). No new colour token. No positional selectors.

Both components are **dumb**, taking `focusProps` and a row offset — the `Keyboard.tsx` contract. A
`useFocusGrid` inside either is a defect: the listener is on `window` and checks no scope, and effects
register **child before parent**, so a child's grid silently wins.

**Every cell is a real `<button>`.** Neither hook claims Enter (`useFocusGrid.test.tsx:128` pins that),
so activation is the browser turning OK into a native click; the web's `div role="slider"` would be a
dead cell on a remote.

`TRANSPORT_CELLS` as an array so the count is `cells.length`: Play/Pause (**relabelled, never swapped**
— swapping the element type unmounts the focused control and drops focus to `<body>`), −10s, **+60s and
−60s as on-screen twins for the media keys**, and a Stop/way-home (the non-Back exit an unverified Back
key demands). A Retry cell is **appended last**: the grid calls `go` only when the clamped target
*changes*, so growth never refocuses, while a cell inserted at or before the focused column leaves DOM
focus on the element that just became column 1 while the model points at column 0 — which is why
`LoadStatus` gives its **prepended** retry `autoFocus`.

The scrub cell: **one** cell in its own row (the nested handler eats the arrow, so a sibling would be
unreachable), declared **first** so vertical movement starts on Play/Pause before `loadedmetadata`,
count `hasFiniteDuration ? 1 : 0` from the same condition that renders it. Its `onKeyDown`
**`preventDefault()`s Left/Right unconditionally while it holds focus**, then decides. The diag page is
the trap already in the repo: it claims the arrow only `if (target)`, so at either end nothing is
claimed — copied into a live grid, the press **at the seekable boundary** falls through and the ring
jumps off the bar at precisely the moment the viewer is pressing against the download edge: §7.4's
refusal dressed up as navigation. Match the numeric `keyCode` too. Scrubbing is **pending-position
arithmetic**: no network, no `currentTime` write per press — the grid has no `e.repeat` guard, so a held
arrow repeats many times a second and a per-press seek would be a Range storm re-anchoring the deadline
window each time. OK commits; moving off cancels.

`describeScrub(state)` — pure, exhaustive `switch`, `assertNever`, no `default`, returning the readout,
the hint and **what OK will do**. If Up/Down are held while an edit is pending, the hint **says so**, or
it is a claimed key that does nothing.

- [ ] **Step 1: the CSS block and its rule assertions**, then both components.

**Mutate:** `npm run test:tv` for the bans. Plus a `describe('bigscreen.css, as the player relies on it')`
block modelled on `profiles/page.test.tsx:952-976`, which reads the stylesheet and regex-asserts a named
rule's declarations — **jsdom cannot compute styles from a `<link>`ed sheet, so a class typo'd in the TSX
is otherwise invisible to every render test.** Assert `.bs-player__row` matches `flex-wrap:\s*nowrap` and
not `wrap`; `.bs-player` declares `isolation:\s*isolate`; `.bs-player__bar--hidden` sets `opacity` and
matches **neither** `display:\s*none` **nor** `visibility` **nor** `pointer-events`; `.bs-player__scrub`
declares no `transform`.

Then: `nowrap` → `wrap`; `pointer-events: none` on the hidden modifier → must fail (the §8.3 ban enforced
by a test, not by review); `transform: scale(1.06)` on the scrub focus rule; drop `isolation: isolate`;
`backdrop-filter: blur(8px)` on the band → `test:tv` fails, **including the camelCase and Tailwind
spellings**; a `:last-child` rule. Components: make the scrub `preventDefault` conditional → the
at-the-ceiling test fails — but **not** by the ring moving: task 7 proved that on a **one-cell** row a
horizontal press moves nothing whether it is claimed or not, because `move` never wraps left/right
between rows (`model.ts:95-97`) and `go` returns at `useFocusGrid.ts:232` before `focus()`. So assert
that **the refusal reached the readout** (`describeScrub`'s text), and pin the claim itself with a
**two-cell** fixture, which is the smallest shape that can observe the hatch. Writing this mutation the
way the plan originally described it produces a test that cannot fail (**still the most important
mutation in the task** — just not the assertion the plan first named);
`<button>` → `div role="slider"`; add a button without adding it to `TRANSPORT_CELLS` → count parity
fails; prepend the Retry cell → the column-stability test fails; delete a `describeScrub` case →
`npx tsc --noEmit` fails on `assertNever`; **delete the on-screen ±60s control → "every media-key action
has a focusable twin" fails**, which makes the unrecognised-key mitigation structural rather than a
principle.

**Guard trap for the commit checklist:** the GPU scan strips comments, but the `framer-motion` and
`globals.css` scans read **raw source**, so a comment saying "deliberately not framer-motion" **fails**
`test:tv`. `blur(` is a bare substring ban with only `.blur(` exempted. And `OPT_OUT_ALLOWED` is pinned
by equality to `bigscreen/diag/page.tsx` — the player cannot buy an exemption.

**Does not:** own no grid, no Back key, no data.

**Depends on:** 6, 7.

---

## Task 9 — The route: arrival states, hide-by-paint, Back escalation, progress, journeys

**Files:** `(bigscreen)/bigscreen/watch/[id]/page.tsx` + test, `_player/useWatchProgress.ts` + test,
`journeys.test.tsx`, `bigscreen/[...rest]/page.tsx`

Mutually exclusive children, each owning its own grid — the house pattern. `LoadStatus` for preparing
and failed (it already carries the 10s patience timer, a retry that re-arms after a hung retry, an
always-present Back and the "a press that is refused says so" label). `LockedRedirect` for 423. A `gone`
render for a terminal 404 with its own ways out — **not** `LoadStatus(failed)`; there is nothing to
retry. `Playing` for the player. One live `useFocusGrid`, `rowCounts = [scrubCount, cells.length]`.
**`error.tsx` is a tenth consumer of both hooks and wraps this screen**, so a throw inside the recovery
code lands on a boundary with its own grid and Back — name that in the source, since recovery code is
the most likely thing here to throw.

**Arriving mid-metadata is the default case.** `title.ts:92` puts `downloading_metadata`, `queued`,
`checking`, `checking_fastresume`, `allocating` all in `PREPARING`, and `preparing` **navigates**. So
`/info` 404s with "not ready" while `/files` answers **`200 []`** — which means "not ready, or evicted",
**never** "this pack has no episodes" (`title.ts:476` already reads it that way). `/info`'s detail string
discriminates **only** the terminal case: "Torrent not found" → terminal; anything else → keep polling
at ~3s (it opens two DB sessions plus the walk; not 1Hz, and stop on unmount). **Do not read the other
detail as "not ready"** — it is *"Video file not found or not ready for streaming"*, which conflates
not-yet-ready with genuinely deleted and is byte-identical to `_resolve_video_file`'s. Separate those
with the torrent's own state from `getTorrentStatus` plus `/files` answering `200 []`. See Corrections.

**A bare watch URL on a pack is legitimate.** It is the `unresolvedEpisode` path — the viewer read the
disclosure and chose to proceed. Play something, and re-resolve from `/files` (season/episode-sorted) now
that metadata may have landed, rather than omitting `file_index` and getting `max(files, key=size)`: the
**largest** file, not episode 1.

**Hide is paint only.** Band mounted, `rowCounts` unchanged, DOM focus untouched, `--hidden` sets
`opacity: 0`. Forbidden: unmounting, `display:none`, `visibility:hidden`, `hidden`, `inert`,
`aria-hidden` while it holds focus, `pointer-events:none`. Two verified reasons: a **zero-count** hide
does not restore the cell (the empty pass writes `NO_TARGET`, and the next reconcile clamps to
`firstTarget` — first populated row, column 0 — so every auto-hide dumps the viewer onto the scrub bar),
and a **constant-counts** unmount is **permanently** unrecoverable (the reconcile effect's deps are
`[shape, …]`, so with constant counts it never re-runs; the ref callback deleted the element; `go` bails
on `!el.isConnected`; the ring is nowhere, forever). The Magic Remote's gyro cursor can click an
`opacity: 0` control, so pointer activity reveals too; any `<a>` carries `draggable={false}`. Auto-hide
is suppressed while paused, while a pending edit exists, and while a message is on screen.

`preload="metadata"` on the element. **No `tabIndex` on the `<video>`** — `journeys.test.tsx:829` counts
every `[tabindex="0"]` and requires exactly one, which must be `document.activeElement`.

**Back: one state-scoped `useBackKey` on the page**, level **derived** from state, never counted (a
reveal resets the viewer's level but not a counter; `controlsVisible` is self-correcting). Pending edit →
cancel; visible → hide; hidden → `router.replace('/bigscreen')` (`replace`, per the catch-all's own
reason: "this is not somewhere to return to", and a pushed watch URL leaves a dead entry pointing at a
torrent that may be gone). A held Back acts once. **Not in a child** — effects register child before
parent. **Level 3 is not built**; home's Back is `const stayOnHome = () => {}` with "STAGE 10 OWES THIS A
REAL ANSWER" on it, and the source says so.

`useSearchParams` is the **first** on this surface: make the Suspense boundary (or
`dynamic = 'force-dynamic'`) deliberate — `next build` runs inside the Docker image build, so getting it
wrong breaks an **image**, not a test run.

`useWatchProgress`: **auto-seek, no prompt** (decision above). **POST every time, never the PUT** —
`StreamingProgressUpdate` has four fields, so a PUT never corrects `file_index`, `title` or `torrent_id`,
while the POST upserts on `(user_id, movie_id)`. **Always send `title`**: `progress_upsert` puts `title`,
`file_index` and `content_id` in `update_cols` **unconditionally**, so a POST with `title: null`
**erases** what the web wrote, taking Continue Watching's label with it; shape it as
`showNameFromTitle`'s regex can strip. `percentage` is 0-100. `completed` near the end, or the show
screen never says "all caught up". **Build the content id client-side** from `buildContentId` +
`getTorrentStatus`'s identity fields + `/files`' labels, and never under an `s0:` id —
`resolve_content_id`'s last resort mints `tv:{tmdb}:s0:e{file_index}`, which parses cleanly, matches
nothing the detail screens build, and draws as `S00 · E04`. **Never `getProgressByTorrent`** as a
fallback (filters on torrent+user only, so on a pack it resumes episode 5 at episode 3's timestamp —
what the web does). The written index is **sticky**: `title.ts:154` prefers the progress row's
`file_index` over its own lookup. 30s cadence, flush in the **unmount cleanup** (a Back press is a route
change that fires neither `beforeunload` nor `pagehide`, but it does unmount) and on `pagehide`.
**`__allow401: true`** so the interceptor cannot destroy the player from inside the rejection handler
before the flush. `statusOf` for the axios branches; note the resume read answers **200 with a null
body** for "no progress" and `streamingService` converts a real 404 to `null`, so it cannot detect a
stale profile — only 423 surfaces.

**Five `journeys.test.tsx` edits.** Delete `STAGE_7_WATCH` (`:257`) and its `expectBuiltRoute` branch
(`:271`); delete `watchIsStillTheCatchAll` (`:766`); **rewrite `:1015`** into an `expectBuiltRoute` call
(it tests the path, so deleting it leaves an undefined identifier — the in-file instruction names only
two of four sites); change the catch-all's own `ScreenCase` (`path: '/bigscreen/watch/t1'`, which now
resolves to the real route) to a genuinely unbuilt path; add the watch `ScreenCase` with a **`lock`
closure** — the 423 guard at `:924` derives its expected set from
`importsModule(src, '_data/useTvProfile')`, so the player owes a 423 branch whether or not the author
planned one. Extend `BackClaim` with a fourth **escalating** variant plus its assertion. Note
`useSearchParams` is mocked at `:90` as a fresh **empty** `URLSearchParams`, so the journey case only
exercises the bare arrival; `?file=` is covered in `page.test.tsx`. Fix the catch-all's doc comment,
already stale about `movie/{id}` and `show/{id}`.

- [ ] **Step 1: the route and its children**, then `useWatchProgress`, then the journeys edits.

**Mutate:** every reachable state has exactly one `[tabindex="0"]` and it **is**
`document.activeElement`. Auto-hide keeps `document.activeElement` **identical by reference** across the
transition. `?file=0` reaches the src as `file_index=0`. `/files === []` renders preparing **only when the torrent's state is a `PREPARING` one** — with
`finished`/`seeding` it means evicted-but-playable and must play, not poll (see Corrections). Back once
hides with `navCalls() === []`; twice replaces to `/bigscreen`; held acts once.

Then: `/files === []` with a `finished` state → renders preparing and polls forever (the regression
task 2 handed over); hide by `display:none` → identical-activeElement fails; hide by `rowCounts: [0]` → the **same-cell**
test fails (landing on row 0 col 0 — the mutation that distinguishes "restored" from "reset to
`firstTarget`"); constant-counts unmount → fails permanently; count Back presses → reveal-then-Back walks
two levels; `preload="auto"`; `tabIndex={0}` on the `<video>` → the one-ring count fails; delete the
`lock` → the derived 423 test fails with a set mismatch; `/files === []` → "no episodes"; `/info`'s
`stream_url` as the src; omit `title` → the don't-erase test fails; `updateProgress` after the first POST
→ the `file_index`-stays-current test fails; drop `__allow401` → the flush-before-navigate test fails
(**reset the api-client module between tests**: the interceptor reads `location.pathname`, mutates module
state and calls `location.replace`, so one trip poisons later tests in the file); trust `/info`'s
`content_id` with an `s0:` fixture; `getProgressByTorrent` fallback with a two-episode pack. **Relax
`expectBuiltRoute` instead of removing the branch → confirm the catch-all distinction still fails for a
genuinely unbuilt path** (the file's header calls that "the vacuity trap"). Mutate `watchHref` to emit
`&file=` → a journey test must catch it; that exact drift was live once.

Also `npm run build` must list `/bigscreen/watch/[id]`.

**Does not:** no source switcher, no resume prompt, no episode picker.

**Depends on:** 2, 5, 6, 7, 8.

---

## Task 10 — Make the instrument unable to lose its reading, then take it

**Files:** `(bigscreen)/bigscreen/diag/page.tsx` + test,
`docs/superpowers/plans/2026-10-10-tv-stage7-device-readings.md`

The Back key log **was run on the set and what it showed was never written down**
(`useBackKey.ts:8-11`). That is the failure this task exists to stop recurring, which is why the
instrument is fixed **before** the readings are taken.

Instrument: add a `keyup` listener (a media key arriving only on keyup currently reads as "the TV eats
it"); persist the log to `sessionStorage` so it survives the navigation Back itself causes; raise the
12-line cap; add a `navigator.mediaSession` presence probe; instruct pressing the keys with **no title
loaded first** (`<video controls>` means the native control UI may consume arrows and media keys and the
log under-reports). Keep `@allow-legacy-probes` — the opted-out set is pinned by equality. Leave
`probeFarRange` alone; it is the reference, including `res.body.cancel()` ("on a 206 it is the rest of the
film").

The sheet: one row per reading, **a blank is a failure**, raw strings transcribed rather than summarised,
in the stage-3-results shape. Thirteen rows — see "On the television" below.

- [ ] **Step 1: the instrument**, then write the empty sheet.

**Mutate:** remove the `sessionStorage` write → the survive-a-remount test fails (**the mutation that
pins the actual lesson**); keep the 12-line cap → logging 20 and asserting 20 fails; register keyup on the
video element; drain the probe's 206 body → the `cancel()` assertion fails; delete the
`@allow-legacy-probes` marker → `test:tv`'s set-equality assertion fails, confirming the pin survived.

**Does not:** the sheet gets no test; its failure mode is a visible blank. The readings prove nothing in
jsdom, and the plan says which is which.

**Depends on:** 7.

---

## On the television

**Everything in tasks 1-10 can be built, tested and merged without the television.** That is a design
property, not luck, and it is why this shape was chosen:

- The 503 story does **not** depend on reading `MediaError.code` on the set: the classifier branches on
  HTTP status from a HEAD probe, and the far-seek 503 is **prevented** by the clamp rather than detected.
- The key handling recognises **both** `key` names and numeric codes, both exported and test-pinned, and
  **every media-key action has a focusable on-screen twin** enforced by a test. A wrong recognition list
  is a one-line edit to two arrays; it is never a missing feature.
- Back recognises six names and four codes, so whichever of 461/8/27/166 the set sends the escalation
  works — and the transport row carries a non-Back way out regardless.

**Three readings gate *claiming the stage works*, not merging it:**

1. **Does the pipeline attach `ff_session` to `<video>` range requests?** Pair the TV, leave
   `AUTH_ENABLED=true`, press Play. **Largest blast radius in the stage, one press.** Diag's own
   instructions say to set `AUTH_ENABLED=false`, and `require_session` short-circuits to `_DEV_CONTEXT`
   when auth is off, so it is entirely possible playback has only ever been observed with the gate
   disabled. If negative, task 5's `session` verdict is unreachable (harmless) and the real problem is
   "how does the TV get an authenticated stream at all" — a stage-10 shell concern. Say so in the sheet
   rather than quietly shipping a dead branch.
2. **Does `video.load()` reset `networkState`, zero `currentTime` and re-issue the Range request?** The
   entire ladder rests on that contract and it has never run on the set.
3. **The far-seek probe readout** (`Probe far seek (HTTP)`, already written): does a seek past the
   download point produce the 503, does the set honour `Retry-After` on its own, and does the probe work
   from that browser at all? If the pipeline double-retries, the player's ladder is a second layer and
   the two must not fight — which changes `MARGIN_S` and possibly the attempt bound.

**Ten more rows, cheap in the same sitting**, each closing a named decision: key codes for
Back/OK/Play/Pause/Stop/RW/FF on keydown **and** keyup; whether a held arrow auto-repeats, at what rate,
and whether `e.repeat` is set (decides whether ±10s needs acceleration or the `list/page.tsx` heldKey
latch); whether media buttons reach the page at all or go to `mediaSession`; whether the set issues HEAD
before GET (readable from the backend access log during one playback); whether a **backward** seek inside
the downloaded region is reliable (if not, `clampSeek` needs a lower bound too); whether `<video>` reports
a finite `duration` for an in-progress stream (the scrub row's existence is conditioned on it); whether
the `opacity` transition on a 1728px band over a decoding 1080p surface holds frame; and whether
`isolation: isolate` actually keeps the ring **visible** over the video at 1920×1080 — the stylesheet test
proves it is *declared*, only a television proves it is *visible*.

**Posture: merge on green tests, hold the "done" claim until rows 1, 2 and 3 are transcribed.** Same as
stages 4 and 6 — but this time the instrument cannot lose the answer.

---

## Hazards

The full list with mechanisms and guards is §4 of the design notes. The ones most likely to be
reintroduced by a careless change:

1. **`file=0` is a real index.** `Number(raw) || undefined` maps it to `undefined`, the backend serves
   `max(files, key=size)`, and every episode of a pack plays the same arbitrary file.
2. **A `null` file index fails two different silent ways** — a 422 JSON body into the decoder, or axios
   dropping it so `/info` resolves the largest file and the heartbeat writes *that* identity.
3. **Arriving during `downloading_metadata`/`queued`/`checking`/`allocating` is normal**, and `/files`
   answers `200 []` — which is "not ready", never "no episodes".
4. **The auto-hide dropping focus to `<body>`** — three distinct mechanisms, one of them permanent.
5. **A second overlapping arrow handler.** First registered wins, and effects register child before
   parent, so the winner is not the one the author expects.
6. **A conditional claim at the boundary.** (Mechanism corrected by task 7 — see Corrections. On the
   one-cell scrub row the ring does **not** move, so the symptom is a silent refusal, not a visible
   jump; the unconditional claim is still right, because it keeps the refusal the thing the viewer sees
   and makes a future sibling in that row unreachable rather than double-acting.) Originally: the press
   at the ceiling falls through and the ring jumps
   off the bar at the exact moment §7.4's refusal fires.
7. **`api-client`'s 401 redirect taking the player out from under itself**, from inside the rejection
   interceptor, before any caller sees the error, with a module-scoped `redirecting` flag that is never
   reset. Note `rootClient` carries the same redirect.
8. **An unknown boundary turning into zero** and refusing all seeking on a complete film.
9. **A boundary drawn exactly at the frontier still hangs** — 300s *per chunk*, unbounded in total,
   with the 206 already sent and no status code left.
10. **The boundary sitting *behind* the playhead** — the normal case for a pack episode.
11. **The house `arrow()` helper fires at `window`**, which a React `onKeyDown` never sees: a test that
    passes while asserting the wrong thing.
12. **Copying the web's dep arrays** — the 1s interval's identity is hostage to an unmemoized prop, and a
    TV page re-rendering faster than 1Hz would have **no** stall detection.
13. **1080p is a preference, not a guarantee.** Health tier outranks bucket index and 2160p is the
    *first* fallback, and the selector never reads `codec`. Stage 8 owns it; stage 7 owes only a truthful
    `decode` verdict.

---

## Notes for whoever runs this

**The spec is stale in places and the design notes say where.** `handleError` is at `:1020`, not `:906`.
§7.4's "300s socket hold" was capped by stage 1 to 2-60s pre-response — the real unbounded hold is
mid-stream and per-chunk. §7.6's "health logic" is already in `@/utils/streamHealth.ts` and TV-importable
today. §7.3 plans a quality picker; the code comment that says there is none is the accurate one for this
stage.

**Four defects in the web player are deliberately left live**, because touching them is an untested
behaviour change on a surface this stage is not asked to fix: the interval-identity chain
(`:603/:658/:661`), the stale `isBuffering` reads (`:869`, `:1058`), `attemptRecovery` missing from the
listener deps (`:1154`), and the ±20s arrow double-seek (`:728`/`:1619`). The TV does not reproduce any
of them. Same for the health-chip copy — `streamAdvice`'s `busy` term exists so the TV does not inherit
"Waiting for peers (0 connected)" on a finished title playing fine.

**`journeys.test.tsx`'s stage-7 exemption is designed to fail the day this route lands**, with a message
naming what to delete. It names two of the four sites; task 9 lists all five edits.
