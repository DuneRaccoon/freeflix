# Stage 7 design notes — the TV player

Design record behind `2026-10-10-tv-stage7-player.md`. Produced 2026-10-10 from a seven-area
recon of the real source, each area adversarially re-checked against its own citations, then
four competing designs scored by three judge panels (drift / risk-to-working-software /
TV-fitness) and synthesised.

Kept because the citations are the valuable part: every claim here carries a `file:line`, and
several correct the spec, whose line numbers for the player are stale. **Where this document and
the spec disagree, this document was checked against the code and the spec was not.**

---

# Stage 7 — the TV player: recommendation

Branch `feat/tv-stage7-player`, off `master` at `3cbeacd`. Everything below is verified against the files, not the spec: where the spec's line numbers or claims disagree with the code, the code wins and I say so.

**Facts I re-checked before deciding** (all confirmed, in this working tree):
- `VideoPlayer.tsx:122–141` — `maxStallTime`, `STALL_EPSILON_S`, `STALL_SPINNER_MS`, `RECOVERY_BACKOFF_MS`, `MAX_RECOVERY_ATTEMPTS` are **component-body locals**, re-created every render, therefore unimportable and invisible to every test.
- `VideoPlayer.recovery.test.tsx:117–143` — hard-codes `const ladder = [1000, 2000, 4000, 8000]` and ticks `delay - 1` then `1` against `toHaveBeenCalledTimes`. **A shortened rung fires early and this existing test goes red.** This is the free drift pin; it is the keystone of the sharing decision.
- `package.json:13` — `"test:tv": "vitest run 'src/app/(bigscreen)'"`. Path-scoped, as claimed.
- `legacy-target.test.ts:194` — `escapesToComponents` blocks only `@/components/*`, `@/components`, and relative climbs into `components/`. `readAliased` (`:227`) resolves `@/`-rooted specs one hop deep. **`@/lib/player/*` importing only `@/types` passes.** `tvSourceFiles()` (`:203`) filters out `*.test.ts(x)`, so a test file under `(bigscreen)` **may** import `@/components` — which is what makes a two-sided drift test possible at all. `OPT_OUT_ALLOWED = ['bigscreen/diag/page.tsx']` and the set is pinned by equality.
- Four VideoPlayer suites, not three: `VideoPlayer.test.tsx`, `.audio`, `.recovery`, `.stall`.
- `VideoPlayer.tsx:1317–1328` — the health copy returns `'Waiting for peers (0 connected)'` whenever `health === 'dead' || num_peers === 0`, **with no busy term**. A finished 0-peer torrent playing perfectly from disk reads as broken. The bug is real.
- `journeys.test.tsx` — **four** `STAGE_7_WATCH` sites: `:257`, `:271`, `:766`, `:1015`. The delete instruction at `:766` names two; following it leaves an undefined identifier at `:1015`.
- `streaming.py` — `head_video` at `:201`; three `Retry-After: "2"` paths at `:269`, `:316`, `:337`; and `file_progress = torrent_manager.get_file_progress(torrent_id)` at `:366`, assigned once and never read.

---

## 1. The sharing decision, settled

**Share the arithmetic. Copy the element driving. Pin both with a value-import test inside the `test:tv` glob.**

### The module

`frontend/src/lib/player/streamRecovery.ts` — pure, no React, no DOM, **one import: `@/types`** (for `StreamHealthState`). Roughly 80 lines.

```ts
// Tuning, now module-scope and importable by both surfaces.
export const RECOVERY_BACKOFF_MS = [1000, 2000, 4000, 8000] as const;
export const MAX_RECOVERY_ATTEMPTS = RECOVERY_BACKOFF_MS.length;
export const STALL_EPSILON_S = 0.25;
export const STALL_SPINNER_MS = 2000;
export const STALL_ESCALATE_MS = 10000;

export function recoveryStep(attempt: number):
  | { exhausted: true }
  | { exhausted: false; delayMs: number; next: number };

export type StallSample = { position: number; frozenSinceMs: number | null; escalated: boolean };
export function stallStep(
  prev: StallSample,
  input: { position: number; expectingPlayback: boolean; nowMs: number },
): { next: StallSample; phase: 'ok' | 'frozen' | 'buffering' | 'escalate' };

export function streamAdvice(
  health: StreamHealthState | null | undefined,
  busy: boolean,
): 'none' | 'noPeers' | 'slow';
```

Three design points that make this safe rather than merely small:

1. **`expectingPlayback` is an input, not a predicate the reducer computes.** The web passes exactly what it computes today (`playerState.isPlaying && !video.paused && !video.ended`), so its behaviour — race included — is byte-identical. The TV passes a predicate that **never reads `video.paused`**, because `load()` sets `paused` without firing `pause`, which is what makes the web's escalation latch race the recovery it just triggered. The divergence lives in the callers, not the shared code. This is the correction to the "minimum sharing" proposal that the risk panel rightly called its fatal flaw.
2. **`streamAdvice` takes `busy`.** The web passes `busy: true` unconditionally, so its (wrong) copy is unchanged and no existing test moves; the TV passes the real value and does not inherit the "Waiting for peers" lie on a finished title. The web's chip bug is parked as a finding, not fixed here.
3. **The escalation latch is a field on the sample** (`escalated`), cleared only by an explicit reset. The reducer never clears its own latch from a predicate.

### What is deliberately NOT shared, and copied into `(bigscreen)/_player/`

`recovery.ts` — the element-driving sequence, ~65 lines: capture the playhead **before** `v.load()` (only `load()` re-fetches once `networkState` is `NETWORK_NO_SOURCE`, which is exactly what the backend's 503 produces); restore it on a **one-shot** `loadedmetadata`, guarded `if (t > 0)`; the detach handle in a ref; resets on `playing` and on source change, **including the cleanup that clears the pending timeout and invokes the detach handle** (`VideoPlayer.tsx:716–721` — drop it and a reload plus a stale listener leak across a title change, and four rungs get spent across an evening).

Also TV-local, deliberately: the audio-intent machine is **not carried** (four refs, ~120 lines, for a Chrome autoplay policy nobody has measured on this set; the TV owns volume and §8.3 deletes the slider). The TV keeps "never mute" and re-establishes only enough of the `loadstart`/`canplay` contract that a recovery does not leave the element silent — **and if `play()` rejects it routes to a focusable "Press OK to play" rather than silently playing muted**, which is the right failure on an unmeasured panel. `preload="metadata"` on the TV element (it is on the element, so it travels with no module; the web's `"auto"` is **not** changed). No `sources`/`currentSourceId`/`onSelectSource`. Listeners registered **once** against a stable element ref, and the 1s interval in an effect with `[]` deps and a ref-held callback.

### Already shared — import it, never re-derive

`@/utils/streamHealth.ts` imports only `@/types`, so `deriveStreamHealth` is TV-importable **today**. §7.6's claim that "the health logic" lives in `VideoPlayer.tsx` is wrong — the component holds message copy and chips. `types/index.ts:132–134` explicitly forbids a second definition. Same for `streamingService.getStreamingUrl`, `@/lib/contentId`, `@/services/api-client` (for `__allow401`), and `(bigscreen)/_data/httpStatus.ts`'s `statusOf` — which is the **axios-rejection** reader and is therefore the wrong helper for a `fetch` probe (`fetch` never throws on a 401, so `statusOf` answers `undefined`). `statusOf` stays correct for the screen's axios calls. Two mechanisms, deliberately not merged.

### The test that keeps them honest

`frontend/src/app/(bigscreen)/_player/engineContract.test.ts` — **inside the `test:tv` glob**, which is the only guard the TV has, and which a test under `@/lib/player/` would sit outside of.

- Value-imports `RECOVERY_BACKOFF_MS`, `MAX_RECOVERY_ATTEMPTS` and the three stall constants from `@/lib/player/streamRecovery` and asserts the TV engine reads them (not a local copy).
- Source-level pin: both recovery paths call `.load()` — the one line whose absence makes the whole ladder a no-op on either surface.
- `DELIBERATELY_DIFFERENT: Record<string, string>` naming every divergence with its reason (`preload` on the element; no audio-intent machine; the classifier ahead of `MediaError.code`; the exhaustion latch; `expectingPlayback` not reading `video.paused`; no source switcher), plus a **self-check that the map is non-empty and every key names a real divergence** — the `railsDrift.test.ts` "knows every rail the web has that the TV does not carry" shape. This is the only mechanism proposed anywhere that forces *tomorrow's* divergence to be named rather than silently added.

**Non-vacuity, proved and not argued:** shorten a rung in `@/lib/player/streamRecovery.ts` and `src/components/player/VideoPlayer.recovery.test.tsx` must go red. I verified that test hard-codes the ladder and ticks `delay - 1` / `1`, so it will. That is the only evidence that the web *actually adopted* the shared table rather than keeping a copy, and it costs nothing.

### Justified against the three lenses

- **Drift:** the constants and the three decisions reach tier 1 (one definition). The residual duplication is the element-driving sequence, pinned at tier 2 with an asserted-complete hatch. Better than copy-everything (tier 3, which `httpStatus.ts`'s own header names as a defect class this repo has been bitten by twice — four copies, and a journey test that caught a live `&file=` drift).
- **Risk to working software:** the web change is **substitution at three call sites** — `checkForStall`'s body, `attemptRecovery`'s ladder arithmetic, the `healthMessage` IIFE. No effect shape, dep array, ref, element access or JSX moves. The hard gate: **all 23 existing VideoPlayer tests pass with zero edits, applied per substitution site**; if one needs editing, that substitution went too far and is reverted. Far smaller than extracting `attemptRecovery` across the `load()` → `loadstart` seam that three of the nine audio tests cross.
- **TV fitness:** the TV owns its own element driving, so every divergence the television needs (`preload`, no audio machine, status-first classification, a deterministic latch, bounded attempts, `Retry-After`) is a local decision rather than a flag in a shared module serving two contracts.

### What I am trading away

The load/restore/play sequence exists twice, and the drift test catches a changed constant or a disappeared `.load()` — **not a reordering or a new guard inside the web's recovery**. A fix to the one-shot detach has to be made in two places and nothing compares them. I accept that because the sequence is ~65 lines, each side is pinned by its own five assertions, and the hatch names the seam. **Revisit trigger, written into the plan:** if a fourth behavioural divergence accumulates — stage 9's `<track>` handling landing on both surfaces, or a second shared recovery concern — extract the element driving too.

---

## 2. Task breakdown

Verification commands for every task, from `frontend/`: `npx vitest run`, `npm run test:tv`, `npx tsc --noEmit`. Backend: `docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest -q` (tests are baked into the image, not bind-mounted). **Re-baseline all four counts at branch start and quote them in the task's commit; the stage-6 plan's numbers are stale.** Neither test command runs in any build or CI — type them by hand.

**Standing guard, restated in every task from 4 onward:** `npx vitest run src/components/player` must report its baseline (4 VideoPlayer suites + `UpNextCard`) **unchanged, with no file edited but `VideoPlayer.tsx`**. That is the cheapest proof the production player stayed intact.

---

### Task 1 — The stream status matrix, as an executable contract (no production feature)

**Files:** `backend/tests/test_stream_status_matrix.py`, `backend/app/main.py`

**Behaviour.** The whole stage's client logic is a switch over what these routes answer, and two careful recon agents disagreed about that switch **in both directions**. Pin it first so every later branch branches on something proved. One parametrised case per answer across `GET /video`, `HEAD /video`, `GET /info`:

- **401** — asserted as `response.content == b""`, not merely the status. Needs the `auth_enabled` fixture (`conftest.py:52`): the suite pins `auth_enabled = False` session-wide and `require_session` short-circuits to `_DEV_CONTEXT` before reading a cookie, so **the 401 path is dark in the default dev compose as well as in tests**. Model on `test_owner_password.py:162`'s uniform-401 suite.
- **416** — `Content-Range: bytes */{size}`, and **no** `Accept-Ranges`.
- **503 × 3, separately** — unallocated file (`:269`) and first-chunk failure (`:316`) carry `Accept-Ranges`; the catch-all (`:337`) does **not**. Three different meanings, identical status, identical `Retry-After: "2"`, identical empty body — and the catch-all covers permanent faults (deleted file, invalid handle). This is why the ladder is bounded rather than backed off forever.
- **404 × 4 distinct details** — the three from `_resolve_video_file` plus `/info`'s own `"Torrent not found"`. Only the detail string separates "deleted" from "evicted", and `/info` does **not** route through `_resolve_video_file`, so it has no index-specific 404.
- **422** — the one the recon said could not happen. `?file_index=null`, `NaN`, `` all hit FastAPI's default `RequestValidationError` handler and return `{"detail":[...]}` JSON, into a decoder, via a raw `<video src>`.
- **HEAD 200 with the FULL `Content-Length` at zero bytes on disk** — `head_video` runs `os.path.getsize` with no guard while `parse_range_header` has `if file_size <= 0`, which only GET consults. So HEAD 200 is **not** evidence playback will start, and **HEAD structurally cannot see the 503**.
- **`wait_for_first_chunk`'s budget**, both ends, via the explicit `piece_timeout` kwarg: 2.0s with zero peers, reaching 60s only around 3.4 MB/s. The common TV failure — no peers — answers 503 in about two seconds, not sixty.
- **`quality` is accepted and never read** on both routes.

Then add the 422 handler, **scoped, not app-global**: an `@app.exception_handler(RequestValidationError)` that returns a bare `Response(status_code=422)` when `request.url.path` matches the two video routes and otherwise reproduces FastAPI's default body (`JSONResponse({"detail": jsonable_encoder(exc.errors())}, status_code=422)`). `main.py` has exactly one handler today, so a mis-scoped one would change the 422 body for every router and break the three live readers of `response.data.detail` (`(bigscreen)/_data/title.ts:362`, `(web)/claim/page.tsx:28`, `(web)/auth/reset-password/page.tsx:19`). **Pin the default shape with a case on a non-video route.**

**Proved by / mutate.** This task *is* proof, so the mutations go into production code: change one `Retry-After` to an HTTP-date → that case fails; delete `Content-Range` from the 416; give the 401 a one-byte body → the `content == b""` assertion fails (proving it checks the body, not the code); remove the new handler → the 422 case fails; add a `file_size <= 0` guard to `head_video` → the HEAD-200-at-zero-bytes case fails (proving the asymmetry is pinned deliberately); add `Accept-Ranges` to the catch-all 503; **break the non-video 422 shape → the default-shape case fails.**

**Does not.** No feature, no client code, no change to any status the endpoint hand-builds. Does not add a body or a diagnostic header to the 401 or the 503s — whatever those return is fed straight to a decoder.

**Depends on:** nothing. Start it first.

---

### Task 2 — A finished download is still streamable

**Files:** `backend/tests/test_finished_torrent_streamable.py`, `backend/app/api/streaming.py`, `backend/app/torrent/manager.py`

**Behaviour.** First because it can invalidate the stage: the TV's main content is finished downloads and the code path says they are unplayable. `skip_non_video_files` sets non-video priority 0 with `content_guard_enabled: bool = True`, so a release with an nfo or a sample **never becomes a pure seeder** and libtorrent's terminal state is `finished` — which is precisely the state `_refresh_active_torrents` pops (`manager.py:438`; note `seeding` is **absent** from that filter, so steady-state eviction hits only `finished`, while a **restart** unloads both unconditionally via `find_loadable_on_startup`). Then `get_video_files` returns `[]`, `_resolve_video_file` 404s, `/info` 404s separately, and `/files` answers a misleading `200 []`.

**Step 1 is a characterisation test, not a fix.** Build a `finished` row with a real temp file, absent from `active_torrents`, and assert exactly what all four endpoints answer today. Record it.

**Step 2** adds a DB fallback inside `_resolve_video_file`, which makes `stream_file_range`'s already-written "No live torrent → every byte is on disk; serve straight through" branch (`manager.py:1341–1353`) reachable — it is dead only because the resolve step 404s first. **Three guards, all load-bearing:** terminal DB state (`finished`/`seeding`), `progress >= 100`, **and `os.path.getsize(path) == stored_size`**. The straight-through branch does no piece gating, so an ungated fallback serves **sparse zero bytes** off a partial file into a decoder — which presents as corrupt media, not as an error. Honour the content guard. Keep the two `/info` 404 details distinguishable.

Do **not** touch `_refresh_active_torrents` or `find_loadable_on_startup`; that is the download lifecycle and every other consumer of `active_torrents`. Record as follow-ups: the two disagree about `seeding`, and `POST /torrents/action/{id}` with `resume` applies no state filter while the batch endpoint honours `RESUMABLE_STATES`.

**Proved by / mutate.** Make the gate unconditional and truncate the file → the sparse-file test must fail (this is the mutation that matters: its failure mode is silent corruption, not an error). Delete the `progress >= 100` condition with a half-downloaded row → refused. Delete the size check → a short body served where it previously 404'd. Put the torrent back into `active_torrents` → the fallback must **not** fire, proving it did not become the general path. Delete the content-guard check → blocked-stays-404 fails. Flip the characterisation test's asserted status 404→200 → it must fail, proving it reads a real response and not a swallowed exception.

**Does not.** Does not reload completed torrents into the libtorrent session. Does not change state-machine filters.

**Depends on:** nothing (runs alongside Task 1).

---

### Task 3 — `contiguous_available`: the run containing a byte offset, on `/info`

**Files:** `backend/app/torrent/manager.py`, `backend/app/api/streaming.py`, `frontend/src/types/index.ts`, `backend/tests/test_contiguous_available.py`, `backend/tests/test_streaming_info_boundary.py`

**Behaviour.** The seek boundary has no data source anywhere (`grep -rn "contiguous\|seekable\|available_bytes"` over `backend/app` and `frontend/src` is empty). `/info`'s `downloaded`/`progress` are `handle.file_progress()` **totals** counting scattered pieces, and each Range request re-anchors the deadline window at a fresh mid-file offset, so holes ahead of the frontier are the normal state — a bar drawn from `progress` permits exactly the seek the boundary exists to refuse.

`contiguous_available(torrent_id, file_index=None, at_bytes=0) -> Optional[dict]` next to `_pieces_ready`, returning `{file_index, file_size, piece_length, run_start, run_end, complete, measured_against}`.

**The run containing `at_bytes`, not a from-file-start scalar.** `prioritize_video_files` marks **every** video file priority 7 while `set_sequential_download` is per-**torrent** (re-asserted three times), so for episode 5 of a pack libtorrent fills the lowest-index episode first and the from-file-start figure legitimately sits near zero while playback runs off the deadline window. A scalar refuses every seek inside the episode actually being watched. `at_bytes=0` degenerates to the prefix §7.4 literally asks for. (This API shape was chosen by a UI argument, and the plan says so.)

Arithmetic, each hazard with its own test: `fi.offset` (every file but the first in a pack has a non-zero one — `test_first_chunk_precheck.py:36` exists because an earlier fake ignored the argument); `max(0, …)` (a missing first piece makes the raw product **negative**); `min(file_size, …)` (the last piece is partial and overshoots); integer `//`, never `int(a / b)` (`manager.py:1286` still uses the float idiom and this is off-by-one-sensitive on multi-gigabyte offsets); bound the walk (~3,800 pybind calls on a 30 GB file at 8 MiB pieces) and memoise ~1 s, the status loop's own cadence; **guard the whole body in one try returning `None` and do not use `_safe_have`** — its per-piece `False`-on-error silently turns an invalidated handle into a zero-length run, refusing all seeking on a complete file.

**`None` means unknown.** Only a measured value may report a zero-length run. Three paths answer `None`: absent from `active_torrents`, no metadata, `have_piece` raised. Do **not** short-circuit on `file_progress()[idx] >= fi.size` alone — both call sites pass no granularity flag, so that counts unverified blocks and would report `complete` at exactly the moment a tail seek still blocks; gate it on `have_piece(last_piece)` too.

On `/info`: accept `at: Optional[int] = Query(None)`, add the block inside `video_file`, and **delete the dead `file_progress = torrent_manager.get_file_progress(torrent_id)` at `streaming.py:366`** — a wholly wasted full libtorrent pass that partly pays for the walk. Mirror as optional on `VideoFileInfo`. Keep `/info` a bare dict; no `response_model`.

**No seekable seconds server-side.** There is no duration anywhere in the backend (no column, `movie_cache_id` is declared and never assigned) and `/info` has no profile identity — its only gate is a decorator-level `require_session_silent`, which resolves an *account*, and `require_profile` needs a `{user_id}` path param `/info` does not have. Ship bytes plus `measured_against` (so the client can detect the metadata-size vs `os.path.getsize` disagreement during allocation) and let the TV convert.

**Proved by / mutate.** `_FakeTI`/`_FakeHandle` from `test_first_chunk_precheck.py:42`. Mutations: drop `max(0, …)` → negative; drop `min(fi.size, …)` → overshoot; replace `fi.offset` with 0 → the pack case fails; swap the fake's `file_at` for one ignoring its argument → the pack case fails (proving the test exercises file offsets at all); `_safe_have` per piece with a raising handle → returns a zero-length run instead of `None`; drop the `have_piece(last)` conjunct → byte-complete-but-tail-unverified reports `complete: true`; `//` → `int(a/b)` with an offset and piece length chosen so rounding shifts the index. Endpoint: serialise the unknown case as a zero run → must fail; omit the key → must fail; restore the `get_file_progress` line (monkeypatched to raise) → must fail; point the block at `downloaded` → a deliberate-hole fixture must fail.

**Does not.** No seconds, no Pydantic model, no change to `downloaded`/`progress`.

**Depends on:** 1.

---

### Task 4 — `@/lib/player/streamRecovery.ts`, adopted by the web

**Files:** `frontend/src/lib/player/streamRecovery.ts`, `frontend/src/lib/player/streamRecovery.test.ts`, `frontend/src/components/player/VideoPlayer.tsx`

**Behaviour.** The whole of the sharing, per §1. Move the five constants out of the component body into the module (they are currently re-created every render, so this also removes pointless work) and substitute at three call sites. `expectingPlayback` and `busy` are **inputs**, and the web passes exactly what reproduces today's behaviour.

**Hard stopping rule, applied per substitution site:** all 23 existing VideoPlayer tests pass with **zero edits**. If one needs editing, that substitution went too far and is reverted. Nothing else in `VideoPlayer.tsx` is touched — the known defects stay live and are parked with their line numbers: the interval's identity hostage to the unmemoized `onRecoveryExhausted` prop (`:603 → :658 → :661`); the stale `isBuffering` reads at `:869` and `:1058`; `attemptRecovery` absent from the listener effect's deps at `:1154`; the ±20 s arrow double-seek (the window handler at `:728` proceeds when focus is inside the player **or** the player is fullscreen — an AND of negatives, so during a film it is a genuinely global claim — and never checks `defaultPrevented`).

**Proved by / mutate.** Pure tables, no DOM. `stallStep`: a `timeupdate` landing immediately before the tick does **not** read as frozen (the `.stall` suite's scenario, re-pinned as a value); a 6 s freeze → `buffering`; a 10 s freeze → `escalate` **once**, latch holding across later ticks; a reset re-arms; `expectingPlayback: false` clears without escalating. `recoveryStep`: rungs, then exhausted, and exhausted stays exhausted. `streamAdvice`: all three branches plus `busy: false` + 0 peers → `'none'`.

**The mutation that matters:** change `RECOVERY_BACKOFF_MS` to `[1000,1000,1000,1000]` and confirm **`src/components/player/VideoPlayer.recovery.test.tsx:117` fails**. Verified it will. That is the only proof the web reads the shared table rather than keeping a copy. Also: `>` → `>=` on the epsilon → the boundary row fails; make `streamAdvice` ignore `busy` → the new row fails; delete `escalated` → escalate-once fails.

**Does not.** Does not extract `attemptRecovery`, the eleven-listener effect, or the audio-intent machine. Does not change `preload`. Does not fix the web's four parked defects or its health-chip copy.

**Depends on:** nothing (frontend-only; can run alongside 1–3).

---

### Task 5 — `(bigscreen)/_player/`: the TV engine and the drift pin

**Files:** `frontend/src/app/(bigscreen)/_player/recovery.ts`, `useStallWatch.ts`, `classify.ts`, their tests, `engineContract.test.ts`

**Behaviour.** `createRecovery({ getVideo, onStatus, debug })` with `attempt(afterMs?)`, `noteHealthy()`, `noteSourceChange()`, `dispose()` — a plain factory over an element **getter**, so a remount cannot leave it holding a dead node. Imports the ladder from `@/lib/player/streamRecovery`. Owns its own resets **and** the source-change cleanup's two jobs. **Exhaustion latches** (the web's `:542` returns without a flag, so it re-fires on every further error, and on the TV there is no source switcher at the end of that loop). Attempts are **bounded** rather than backed off forever.

`useStallWatch` — the React wrapper. The interval lives in an effect with `[]` deps and a ref-held callback; listeners registered once against a stable element ref; `expectingPlayback` **does not read `video.paused`**; while a recovery is in flight the detector is **suspended**, not re-armed. Returns a status value, not three setStates.

`classify.ts` — `classifyStreamFailure({ src, fetchImpl, signal })` → `{kind:'session'}` | `{kind:'retry', afterMs}` | `{kind:'gone', detail}` | `{kind:'badRequest'}` | `{kind:'decode'}` | `{kind:'unknown'}`. This finishes a contract `dependencies/auth.py:143–156` already *asserts* exists ("The player's error handler checks the status explicitly and routes to sign-in") and which does not: `grep -rn 401 frontend/src/components/player/` is empty.

- **HEAD only.** Every `GET /video` runs `prioritize_video_files` + `force_start_for_stream` (a DB write) and then `_prioritize_window`/`_deadline_pieces` over 32 pieces at the file head, re-deadlining every 250 ms — **unconditionally, even on a complete torrent**. A `Range: bytes=0-0` "cheap probe" hijacks libtorrent's deadline queue away from the live playhead. `head_video` touches only `os.path.getsize` and is registered above GET for exactly this reason. Pin it **structurally**, because no behavioural assertion can observe a DB write.
- **Plain `fetch`, not `apiClient`** — the interceptor would hard-navigate to `/bigscreen/pair` from inside the rejection handler before any player code ran. Same-origin through the Next rewrite, so `credentials: 'same-origin'` carries `ff_session`. **Always an `AbortController` with an explicit timeout**: neither `fetch` nor `apiClient` sets one, so a probe against a wedged backend hangs and stacks.
- **Not `statusOf`** (axios-rejection shape; would answer `undefined`).
- `Retry-After` parsed as seconds with a floor, a cap and a 2000 ms default — **never `NaN`**.
- **Write the limit in the module header: HEAD cannot observe the far-seek 503.** It answers 200 from metadata whatever the download position. The 503 reaches the player two ways only — prevented by Task 6's clamp, or inferred when the ladder exhausts while HEAD still says 200, which yields `decode` (HEVC and DTS at 1080p are both unverified on this panel, so saying so is truthful). A classifier documented to do something it structurally cannot is the kind of test-shaped lie this project tracks.

`engineContract.test.ts` — per §1: value imports, the `.load()` source pin, the `DELIBERATELY_DIFFERENT` map with its non-empty/real-divergence self-check.

**Proved by / mutate.** Port the five recovery assertions onto a ~15-line host rendering a **real** `<video>` (all five do `container.querySelector('video')`, so a stub will not do). Mutations: `v.load()` → a `currentTime` write; restore immediately rather than on `loadedmetadata`; drop `if (t > 0)`; remove the latch and fire a fifth error → two exhausted callbacks; delete `noteSourceChange`'s cleanup → **assert no pending timer and exactly zero attached `loadedmetadata` listeners after a source change, and exactly one after two `attempt()` calls, none after `dispose()`**; ignore `afterMs` → the `Retry-After` override fails.

**The test no existing suite can have:** a host that re-renders every 200 ms with a **fresh** callback closure still escalates after a frozen playhead. Mutation: put the callback into the interval effect's dep array → must fail. The web survives this bug only because its poll period is 5000/1500 ms, above 1 s; a TV page re-renders on a controls-auto-hide clock, a progress poll and a scrub readout.

`classify.test.ts` against a stubbed `fetchImpl`, one row per status from Task 1's matrix. Mutations: `method: 'HEAD'` → GET with a Range → `expect(fetchImpl.mock.calls[0][1].method).toBe('HEAD')` and "no call carries a Range header" must fail; 404 → `retry` → the terminal-404 test fails; absent `Retry-After` → `NaN`; `statusOf(res)` instead of `res.status` → every case collapses to `unknown`; HEAD-200 → `retry` instead of `decode`.

Also mutate the drift pin **both ways**: break the shared table → red; make the TV re-inline a local copy → red. Empty the `DELIBERATELY_DIFFERENT` map → the self-check fails.

**Does not.** No audio-intent machine. No source switching. No `MediaError.code` branch ahead of the status.

**Depends on:** 1, 4.

---

### Task 6 — The pure TV boundary modules

**Files:** `frontend/src/app/(bigscreen)/_player/fileIndex.ts`, `seekBoundary.ts`, `formatTime.ts`, and their tests

**Behaviour.**

`fileIndex(raw: string | null) -> number | undefined` and `streamSrc(torrentId, fileIndex)`. `watchHref` is **the only** builder of a watch URL on this surface and uses `!= null` deliberately, because **file 0 is the first file of a season pack** (`watchHref.ts:3`, pinned at `watchHref.test.ts:13`). The reader must mirror it: null check → `Number()` → `Number.isInteger()` → non-negative, normalised to `number | undefined` and **never `null`**. One `null` produces **two different** silent failures: `getStreamingUrl` gates on `!== undefined` and emits the literal `?file_index=null` → a 422 with a JSON body fed to the decoder; `getStreamingInfo` passes it to axios, which **drops null**, so `/info` silently resolves `max(files, key=size)` and returns *that* file's `content_id`/`season`/`episode`, which the heartbeat then writes. The silent one is worse. `?file=` empty → **undefined, not 0** (`Number('') === 0`; the web page maps it to 0, so a truncated URL there plays the first file). Pass no `quality` (accepted and never read; it changes the URL and any cache key for nothing). Never use `/info`'s `stream_url`, which appends `?file_index=` only when the **caller** passed one while the sibling `file_index` reports the **resolved** index — self-inconsistent on exactly the one arrival allowed to be bare.

`seekLimitSeconds` / `clampSeek`. **`null` run → unbounded, never 0** (three backend paths legitimately answer unknown, and a ceiling of 0 refuses every seek on a complete file — the TV's main content). `Math.floor(duration * run_end / size) - MARGIN_S`, floored at 0, then **raised to the playhead**: for a pack episode the run can sit behind `currentTime`, and a clamp without that lift would yank the viewer backwards or refuse to start. Refuse **forward** seeks only; never rewrite `currentTime`. Always return a number **and a `reason`** — a press is never silently refused on this surface. **The margin is not cosmetic:** a seek landing just *inside* the frontier passes `wait_for_first_chunk`, the 206 is sent, and the next chunk sits in `stream_file_range`'s mid-stream poll — where `cap = 300.0` and `waited = 0.0` are **both re-initialised inside the `while remaining > 0` loop**, so the hold is 300 s *per chunk* and unbounded in total, with no status code left to signal with. Floor the bytes→seconds fraction; VBR diverges. (For the record: §7.4's "a far seek holds the socket for up to 300 s" is **stale** — stage 1 capped the pre-response wait at `_adaptive_piece_timeout`, 2–60 s.)

`formatTime` — extracted from `_components/PrimaryAction.tsx:34` into its own module (the `watchHref.ts` reason: a screen test that mocks one thing should not take the formatter with it) and **padded against the total duration**. As written it returns `m:ss` below an hour, so a scrub readout would show `4:12` beside `1:32:00` — two field counts in one ten-foot readout.

**Proved by / mutate.** Tables. `fileIndex`: `!= null` → truthiness → the `file=0` row fails; drop `Number.isInteger`; return `null` for a miss → **a test that runs the result through `getStreamingUrl` and through `getStreamingInfo`'s params shape, asserting no `null` and no `NaN` survives either**, must fail (one test, both failure modes, pinned at the seam); drop the empty guard → `''` becomes 0; add `quality` → the URL-shape assertion fails. `clampSeek`: remove the margin → a seek to exactly `run_end` is allowed; `null` → 0 → the unbounded row fails; remove the playhead lift → the pack row fails; drop `reason` → the every-refusal-is-sayable row fails; `Math.ceil` → the errs-low row fails. `formatTime`: pad against its own value → the `4:12`-beside-`1:32:00` row fails.

**Does not.** No element, no network, no React.

**Depends on:** 3.

---

### Task 7 — The key layer

**Files:** `frontend/src/app/(bigscreen)/_focus/useMediaKeys.ts`, `useRevealOnKey.ts`, their tests, `_focus/nestedArrowClaim.test.tsx`

**Behaviour.** Nothing in `frontend/src` recognises any media key under any spelling. Build `useMediaKeys` in the `useBackKey` idiom: exported, test-pinned `MEDIA_KEYS` **and** `MEDIA_KEY_CODES`; rejects alt/ctrl/meta chords; bails on `defaultPrevented`; `preventDefault`s **only** keys it acts on (`useBackKey.ts:35` — "`preventDefault()` on a key this does not act on is how Back stops working on a device nobody can attach a debugger to"); latest callback via a layout-effect ref. §7.4 rebinds Rewind/Fast-Forward to **±60 s jumps**, not continuous scan. The header must say which half is which: `415/19/413/417/412` are **recalled platform documentation, not a reading**, and that Chromium 120 on webOS 25 populates `e.key` at all is a **guess** — the repo records exactly one number, 461 for Back, and records it as unverified.

`useRevealOnKey` — one `window` keydown with `{ capture: true }`, `[]` deps, the timer in a ref so a key repeat costs no render. Claims nothing while visible, does **not** check `defaultPrevented` (it must still hear arrows the grid claimed — those are activity), and while hidden swallows the first press **except the Back spellings**, imported from `useBackKey`'s exported lists, or Back reveals and collapses in one press and the escalation is unreachable. `{ capture: true }` beats an earlier-registered bubble listener in **both** dispatch shapes (the device's, fired at the focused element, and this repo's tests', fired at `window`) because the capture pass runs the whole path including the target first — not declaration order, which is an accident.

`nestedArrowClaim.test.tsx` — **the missing test the whole "arrows seek only on the transport bar" design rests on.** The two existing "already claimed" tests prove registration order (`useFocusGrid.test.tsx:152`, a window listener registered first) and propagation order on `document` (`useBackKey.test.tsx:86`, dispatched from a descendant). Neither proves React's **synthetic** path for an arrow.

**Proved by / mutate.** Fire at `document.activeElement`, **never with the house `arrow()` helper**, which dispatches on `window` and which a React `onKeyDown` never sees — a test written with it passes while asserting the wrong thing. Use the house real-remote fixture `{ key: 'Unidentified', keyCode: N }` (five existing suites use it; it is the half most likely to be the live path).

Mutations: drop `MEDIA_KEY_CODES` → the keyCode-only row fails; add `'ArrowLeft'` to the forward list → the arrow pass-through row fails (proving the hook does not swallow navigation); add `'Enter'` → the "Enter, Back and arrows all leave `defaultPrevented === false`" row fails; add a `defaultPrevented` check to the reveal listener → the claimed-arrow-is-activity row fails; remove the Back exemption → "Back while hidden leaves, it does not reveal" fails; remove `{ capture: true }` → the pre-registered-listener row fails; move the timer into state → the render-count assertion fails. For the nested test: mutate away `useFocusGrid.ts:248`'s `if (e.defaultPrevented) return` → it must fail, proving it exercises the hatch and not a coincidence.

**Does not.** Does not implement the media codes as a dependency — every media-key action gets a focusable on-screen twin in Task 8, so an unrecognised key is a missing shortcut, not a missing feature.

**Depends on:** nothing (can run alongside 4–6).

---

### Task 8 — The control surface: CSS, transport row, scrub cell

**Files:** `frontend/public/bigscreen.css`, `frontend/src/app/(bigscreen)/_player/TransportBar.tsx`, `ScrubBar.tsx`, `describeScrub.ts`, their tests

**Behaviour.** No reuse of the web JSX: banned GPU CSS runs through six of its control clusters (`mixBlendMode`, `feTurbulence`, five `backdropFilter` sites) **plus a Tailwind `backdrop-blur-md` on the health chip at `:1405`**, and `backdrop-blur` is a pinned forbidden substring.

A self-contained `.bs-player__*` block. `.bs-player` is `position: fixed; inset: 0; isolation: isolate` — **not decoration**: absolutely positioned children paint **over** their parent's own outline, which already cost this stylesheet its one full-bleed focus stop ("found by rendering this in Chromium at 1920x1080, not by reading it"). `.bs-player__video` absolute inset 0 at `z-index: -1`, `object-fit: contain`, black. `.bs-player__scrim` a bottom-anchored `linear-gradient` scoped to the **band**, not the viewport (fill rate over a decoding 1080p surface is the budget), with `--ink` written out as `rgba(10,10,11,…)` as `.bs-hero__scrim` does. `.bs-player__bar` carries `padding: var(--safe-y) var(--safe-x)` itself and gets a `--hidden` modifier setting **opacity only**, with the house motion token. `.bs-player__row` is `flex-wrap: nowrap` — **do not borrow `.bs-controls`** (`flex-wrap: wrap`); one focus row wrapping onto two visual lines is what the search block forbids. `.bs-player__scrub` full-width, ≥60 px, gold ring at `outline-offset: 2px`, **no `transform: scale()`** (the hero rule rejects scale for a full-bleed stop; at 1728 px it also crosses the inset). Three stacked track layers (played / run boundary / remainder) in the `.bs-card__bar` language with widths as inline styles. Reuse `.bs-btn`/`.bs-btn--ghost` unchanged, and `.bs-msg` for the reserved status line — mounted **outside** the band's padding, because `.bs-msg` carries `padding: 0 var(--safe-x)` itself and would double-inset by 96 px a side; its `min-height` is why it is reused, since a line appearing unreserved nudges the control the ring is sitting on. **Do not widen `.bs-video`** (1280 px, the diag harness depends on it) or reuse `.bs-page` (`overflow-y: auto`; the grid calls `scrollIntoView` on every move with no opt-out, so the player must not scroll). No new colour token; a geometry token is the precedented kind. No positional selectors — banned outright.

Both components are **dumb**, taking `focusProps` and a row offset — the `Keyboard.tsx` contract ("IT OWNS NO FOCUS GRID, AND THAT IS THE WHOLE DESIGN"). A `useFocusGrid` inside either is a defect: the listener is on `window` and checks no scope, and effects register **child before parent**, so a child's grid silently wins.

**Every cell is a real `<button>`.** Neither hook claims Enter (`useFocusGrid.test.tsx:128` pins that it leaves Enter alone), so activation is the browser turning OK into a native click; the web's `div role="slider"` would be a dead cell on a remote.

`TRANSPORT_CELLS` as an array so the count is `cells.length`: Play/Pause (**relabelled, never swapped** — swapping the element type unmounts the focused control and drops focus to `<body>`), −10 s, **+60 s and −60 s as on-screen twins for the media keys**, and a Stop/way-home (the non-Back exit an unverified Back key demands). A Retry cell is **appended last**: the grid calls `go` only when the clamped target *changes*, so growth never refocuses, and a cell inserted at or before the focused column leaves DOM focus on the element that just became column 1 while the model points at column 0 — which is exactly why `LoadStatus` gives its **prepended** retry `autoFocus`. The house rule is "declared count equals cells rendered", not "never a literal" (`search/page.tsx:56` is `ACTION_CELLS = 2`); derive where the row varies, name a constant where it is fixed.

The scrub cell: **one** cell in its own row (the nested handler eats the arrow, so a sibling would be unreachable), declared **first** so vertical movement starts on Play/Pause before `loadedmetadata`, count `hasFiniteDuration ? 1 : 0` from the same condition that renders it. Its `onKeyDown` **`preventDefault()`s Left/Right unconditionally while it holds focus**, then decides. The diag page is the trap already in the repo: it claims the arrow only `if (target)`, so at either end nothing is claimed — copied into a live grid, the press **at the seekable boundary** falls through and the ring jumps off the bar at precisely the moment the viewer is pressing against the download edge: §7.4's refusal dressed up as navigation. Match the numeric `keyCode` too. Scrubbing is **pending-position arithmetic**: no network, no `currentTime` write per press — the grid has no `e.repeat` guard, so a held arrow repeats many times a second and a per-press seek would be a Range storm re-anchoring the deadline window each time. OK commits; moving off cancels.

`describeScrub(state)` — pure, exhaustive `switch`, `assertNever`, no `default` (the `describeAction` shape), returning the readout, the hint and **what OK will do**. If Up/Down are held while an edit is pending, the hint **says so**, or it is a claimed key that does nothing.

**Proved by / mutate.** `npm run test:tv` for the bans. Plus a `describe('bigscreen.css, as the player relies on it')` block modelled exactly on `profiles/page.test.tsx:952–976`, which reads the stylesheet and regex-asserts a named rule's declarations — **jsdom cannot compute styles from a `<link>`ed sheet, so a class typo'd in the TSX is otherwise invisible to every render test.** Assert: `.bs-player__row` matches `flex-wrap:\s*nowrap` and not `wrap`; `.bs-player` declares `isolation:\s*isolate`; `.bs-player__bar--hidden` sets `opacity` and matches **neither** `display:\s*none` **nor** `visibility` **nor** `pointer-events`; `.bs-player__scrub` declares no `transform`.

Mutations: `nowrap` → `wrap`; `pointer-events: none` on the hidden modifier → must fail (the §8.3 ban enforced by a test, not by review); `transform: scale(1.06)` on the scrub focus rule; drop `isolation: isolate`; `backdrop-filter: blur(8px)` on the band → `test:tv` fails, **including the camelCase and Tailwind spellings**; a `:last-child` rule → the positional ban fails. Components: make the scrub `preventDefault` conditional → the at-the-ceiling test fails with the ring off the bar (**the most important mutation in the task**); `<button>` → `div role="slider"` → the click test fails; add a button without adding it to `TRANSPORT_CELLS` → count parity fails; prepend the Retry cell → the column-stability test fails; delete a `describeScrub` case → `npx tsc --noEmit` fails on `assertNever`; **delete the on-screen ±60 s control → "every media-key action has a focusable twin" fails**, which makes the unrecognised-key mitigation structural rather than a principle.

Guard trap to write into the commit checklist: the GPU scan strips comments, but the `framer-motion` and `globals.css` scans read **raw source**, so a comment saying "deliberately not framer-motion" **fails** `test:tv`. `blur(` is a bare substring ban with only `.blur(` exempted. And `OPT_OUT_ALLOWED` is pinned by equality to `bigscreen/diag/page.tsx` — the player cannot buy an exemption.

**Does not.** Owns no grid, no Back key, no data.

**Depends on:** 6, 7.

---

### Task 9 — The route: arrival states, hide-by-paint, Back escalation, progress, journeys

**Files:** `frontend/src/app/(bigscreen)/bigscreen/watch/[id]/page.tsx` + test, `_player/useWatchProgress.ts` + test, `journeys.test.tsx`, `bigscreen/[...rest]/page.tsx`

**Behaviour.** Mutually exclusive children, each owning its own grid — the house pattern. `LoadStatus` for preparing and failed (it already carries the 10 s patience timer, a retry that re-arms after a hung retry, an always-present Back and the "a press that is refused says so" label — a ready answer to "the first paint has no focus stop"). `LockedRedirect` for 423. A `gone` render for a terminal 404 with its own ways out — **not** `LoadStatus(failed)`; there is nothing to retry. `Playing` for the player. One live `useFocusGrid`, `rowCounts = [scrubCount, cells.length]`. **`error.tsx` is a tenth consumer of both hooks and wraps this screen**, so a throw inside the recovery code lands on a boundary with its own grid and Back — name that in the source, since recovery code is the most likely thing here to throw.

**Arriving mid-metadata is the default case.** `title.ts:92` puts `downloading_metadata`, `queued`, `checking`, `checking_fastresume`, `allocating` all in `PREPARING`, and `preparing` **navigates**. So `/info` 404s with "not ready" while `/files` answers **`200 []`** — which means "not ready, or evicted", **never** "this pack has no episodes" (`title.ts:476` already reads it that way). `/info`'s detail string is the discriminator: "not ready" → keep polling at ~3 s (it opens two DB sessions plus the walk; not 1 Hz, and stop on unmount); "Torrent not found" → terminal.

**A bare watch URL on a pack is legitimate.** It is the `unresolvedEpisode` path — the viewer read "this plays a file from the season, which may be a different episode" and chose to proceed. Play something, and re-resolve from `/files` (season/episode-sorted) now that metadata may have landed, rather than omitting `file_index` and getting `max(files, key=size)` — the **largest** file, not episode 1.

**Hide is paint only.** Band mounted, `rowCounts` unchanged, DOM focus untouched, `--hidden` sets `opacity: 0`. Forbidden: unmounting, `display:none`, `visibility:hidden`, `hidden`, `inert`, `aria-hidden` while it holds focus, `pointer-events:none`. Two verified reasons: a **zero-count** hide does not restore the cell (the empty pass writes `NO_TARGET`, and the next reconcile clamps to `firstTarget` — **first populated row, column 0**, so every auto-hide dumps the viewer onto the scrub bar), and a **constant-counts** unmount is **permanently** unrecoverable (the reconcile effect's deps are `[shape, …]`, so with constant counts it never re-runs; the ref callback deleted the element; `go` bails on `!el.isConnected`; the ring is nowhere, forever). The Magic Remote's gyro cursor can click an `opacity: 0` control, so pointer activity reveals too; any `<a>` carries `draggable={false}`. Auto-hide is suppressed while paused, while a pending edit exists, and while a message is on screen.

`preload="metadata"` on the element. **No `tabIndex` on the `<video>`** — `journeys.test.tsx:829` counts every `[tabindex="0"]` and requires exactly one, which must be `document.activeElement`.

**Back: one state-scoped `useBackKey` on the page**, level **derived** from state, never counted (a reveal resets the viewer's level but not a counter; `controlsVisible` is self-correcting). Pending edit → cancel; visible → hide; hidden → `router.replace('/bigscreen')` (`replace`, per the catch-all's own reason: "this is not somewhere to return to", and a pushed watch URL leaves a dead entry pointing at a torrent that may be gone). A held Back acts once. **Not in a child** — effects register child before parent. **Level 3 is not built**; home's Back is `const stayOnHome = () => {}` with "STAGE 10 OWES THIS A REAL ANSWER" on it, and the source says so.

`useSearchParams` is the **first** on this surface: make the Suspense boundary (or `dynamic = 'force-dynamic'`) deliberate — `next build` runs inside the Docker image build, so getting it wrong breaks an **image**, not a test run.

`useWatchProgress`: **auto-seek, no prompt** (see §6). **POST every time, never the PUT** — `StreamingProgressUpdate` has four fields, so a PUT never corrects `file_index`, `title` or `torrent_id`, while the POST upserts on `(user_id, movie_id)`. **Always send `title`**: `progress_upsert` puts `title`, `file_index` and `content_id` in `update_cols` **unconditionally**, so a POST with `title: null` **erases** what the web wrote, taking Continue Watching's label with it; shape it as `showNameFromTitle`'s regex can strip. `percentage` is 0–100. `completed` near the end, or the show screen never says "all caught up". **Build the content id client-side** from `buildContentId` + `getTorrentStatus`'s identity fields + `/files`' labels, and never under an `s0:` id — `resolve_content_id`'s last resort mints `tv:{tmdb}:s0:e{file_index}`, which parses cleanly, matches nothing the detail screens build, and draws as `S00 · E04`. **Never `getProgressByTorrent`** as a fallback (filters on torrent+user only, so on a pack it resumes episode 5 at episode 3's timestamp — what the web does). The written index is **sticky**: `title.ts:154` prefers the progress row's `file_index` over its own lookup. 30 s cadence, flush in the **unmount cleanup** (a Back press is a route change that fires neither `beforeunload` nor `pagehide`, but it does unmount) and on `pagehide`. **`__allow401: true`** so the interceptor cannot destroy the player from inside the rejection handler before the flush. `statusOf` for the axios branches; note the resume read answers **200 with a null body** for "no progress" and `streamingService` converts a real 404 to `null`, so it cannot detect a stale profile — only 423 surfaces.

**Five journeys edits.** Delete `STAGE_7_WATCH` (`:257`) and its `expectBuiltRoute` branch (`:271`); delete `watchIsStillTheCatchAll` (`:766`); **rewrite `:1015`** into an `expectBuiltRoute` call (it tests the path, so deleting it leaves an undefined identifier — the in-file instruction names only two sites); change the catch-all's own `ScreenCase` (`path: '/bigscreen/watch/t1'`, which now resolves to the real route) to a genuinely unbuilt path; add the watch `ScreenCase` with a **`lock` closure** — the 423 guard at `:924` derives its expected set from `importsModule(src, '_data/useTvProfile')`, so the player owes a 423 branch whether or not the author planned one. Extend `BackClaim` with a fourth **escalating** variant plus its assertion. Note `useSearchParams` is mocked at `:90` as a fresh **empty** `URLSearchParams`, so the journey case only exercises the bare arrival; `?file=` is covered in `page.test.tsx`. Fix the catch-all's doc comment, already stale about `movie/{id}` and `show/{id}`.

**Proved by / mutate.** Every reachable state has exactly one `[tabindex="0"]` and it **is** `document.activeElement`. Auto-hide keeps `document.activeElement` **identical by reference** across the transition. `?file=0` reaches the src as `file_index=0`. `/files === []` renders preparing. Back once hides with `navCalls() === []`; twice replaces to `/bigscreen`; held acts once.

Mutations: hide by `display:none` → identical-activeElement fails; hide by `rowCounts: [0]` → the **same-cell** test fails (landing on row 0 col 0 — the mutation that distinguishes "restored" from "reset to `firstTarget`"); constant-counts unmount → fails permanently; count Back presses → reveal-then-Back walks two levels; `preload="auto"`; `tabIndex={0}` on the `<video>` → the one-ring count fails; delete the `lock` → the derived 423 test fails with a set mismatch; `/files === []` → "no episodes"; `/info`'s `stream_url` as the src; omit `title` → the don't-erase test fails; `updateProgress` after the first POST → the `file_index`-stays-current test fails; drop `__allow401` → the flush-before-navigate test fails (**reset the api-client module between tests**: the interceptor reads `location.pathname`, mutates module state and calls `location.replace`, so one trip poisons later tests in the file); trust `/info`'s `content_id` with an `s0:` fixture; `getProgressByTorrent` fallback with a two-episode pack. **Relax `expectBuiltRoute` instead of removing the branch → confirm the catch-all distinction still fails for a genuinely unbuilt path** (the file's header calls that "the vacuity trap"). Mutate `watchHref` to emit `&file=` → a journey test must catch it; that exact drift was live once.

Also `npm run build` must list `/bigscreen/watch/[id]`.

**Does not.** No source switcher. No resume prompt. No episode picker.

**Depends on:** 2, 5, 6, 7, 8.

---

### Task 10 — Make the instrument unable to lose its reading, then take it

**Files:** `frontend/src/app/(bigscreen)/bigscreen/diag/page.tsx` + test, `docs/superpowers/plans/2026-10-10-tv-stage7-device-readings.md`

**Behaviour.** The Back key log **was run on the set and what it showed was never written down** (`useBackKey.ts:8–11`). That is the failure this task exists to stop recurring, which is why the instrument is fixed **before** the readings are taken.

Instrument: add a `keyup` listener (a media key arriving only on keyup currently reads as "the TV eats it"); persist the log to `sessionStorage` so it survives the navigation Back itself causes; raise the 12-line cap; add a `navigator.mediaSession` presence probe; instruct pressing the keys with **no title loaded first** (`<video controls>` means the native control UI may consume arrows and media keys and the log under-reports). Keep `@allow-legacy-probes` — the opted-out set is pinned by equality. Leave `probeFarRange` alone; it is the reference, including `res.body.cancel()` ("on a 206 it is the rest of the film").

The sheet: one row per reading, **a blank is a failure**, raw strings transcribed rather than summarised, in the stage-3-results shape. Thirteen rows — see §3.

**Proved by / mutate.** jsdom: the keyup listener records a line; the log survives a remount; the mediaSession probe renders without throwing when the API is absent. Mutations: remove the `sessionStorage` write → the survive-a-remount test fails (**the mutation that pins the actual lesson**); keep the 12-line cap → logging 20 and asserting 20 fails; register keyup on the video element → fails; drain the probe's 206 body → the `cancel()` assertion fails; delete the `@allow-legacy-probes` marker → `test:tv`'s set-equality assertion fails, confirming the pin survived the edit.

**Does not.** The sheet gets no test; its failure mode is a visible blank. The readings themselves prove nothing in jsdom, and the plan says which is which.

**Depends on:** 7 (the instrument can land any time; the sheet is written early and filled whenever the television is available — see §3 for which rows gate which tasks).

---

## 3. What must be settled on the television, and when

The spec says the far-seek HTTP probe must settle the 503 behaviour **before stage 7 ships**, and that reading has never been taken. The user has chosen to proceed without the stage 4/6 on-TV verification. Here is the honest sequencing.

**Everything in Tasks 1–10 can be built, tested and merged without the television.** That is a design property, not luck, and it is why I chose this shape:

- The 503 story does **not** depend on reading `MediaError.code` on the set, because the classifier branches on **HTTP status from a HEAD probe**, and the far-seek 503 is **prevented** by the boundary clamp rather than detected. If the panel reports a code nobody predicted, no branch changes.
- The key handling recognises **both** `key` names and numeric codes, both exported and test-pinned, and **every media-key action has a focusable on-screen twin** enforced by a test. A wrong recognition list is a one-line edit to two arrays; it is never a missing feature.
- The Back key recognises six names and four codes, so whichever of 461/8/27/166 the set sends, the escalation works — and the transport row carries a non-Back way out regardless.
- The focus invariants, the counts, the hide mechanism and the CSS rules are all verified in jsdom and by stylesheet-rule assertions.

**Three readings gate *claiming the stage works*, not merging it.** Take them before the branch is declared done, and if the television is available earlier, take them earlier:

1. **Does the pipeline attach `ff_session` to `<video>` range requests?** Pair the TV, leave `AUTH_ENABLED=true`, press Play. This is the **largest blast radius in the stage** and costs one press. The 2026-10-07 playback run is the evidence playback works at all — and diag's own instructions say to set `AUTH_ENABLED=false`, while `require_session` short-circuits to `_DEV_CONTEXT` when auth is off, so it is entirely possible playback has only ever been observed with the gate disabled. **If this is negative**, Task 5's `session` verdict becomes unreachable (harmless — it fires only on a 401 that never arrives), and the real problem becomes "how does the TV get an authenticated stream at all", which is a stage-10 shell concern, not a player one. Say so in the sheet rather than quietly shipping a dead branch.
2. **Does `video.load()` reset `networkState`, zero `currentTime` and re-issue the Range request?** The entire ladder rests on that contract and it has never run on the set. If it does not re-fetch, the ladder is a no-op there exactly as it was in the browser before the web fix — and the stall path's suspension makes that a visible spinner rather than a silent loop, which is the right failure.
3. **The far-seek probe readout** (`Probe far seek (HTTP)`, already written): does a seek past the download point produce the 503, does the set honour `Retry-After` on its own, and does the probe work from that browser at all? If the pipeline double-retries, the player's ladder is a second layer and the two must not fight — and that changes the `MARGIN_S` constant and possibly the attempt bound.

**The remaining ten rows** are cheap to read in the same sitting and each closes a named decision: the key codes for Back/OK/Play/Pause/Stop/RW/FF on keydown **and** keyup; whether a held arrow auto-repeats, at what rate, and whether `e.repeat` is set (decides whether ±10 s needs acceleration or the `list/page.tsx` heldKey latch); whether media buttons reach the page at all or go to `mediaSession`; whether the set issues HEAD before GET (readable from the backend access log during one playback); whether a **backward** seek inside the downloaded region is reliable (if not, `clampSeek` needs a lower bound too); whether `<video>` reports a finite `duration` for an in-progress stream (the scrub row's existence is conditioned on it; the fallback is transport-only and has never been seen); whether the `opacity` transition on a 1728 px band over a decoding 1080p surface holds frame; and whether `isolation: isolate` actually keeps the ring **visible** over the video at 1920×1080 — the stylesheet test proves it is *declared*, only a television proves it is *visible*.

**Recommendation:** merge on green tests, then hold the stage "done" claim until rows 1, 2 and 3 are transcribed. That is the same posture stages 4 and 6 are in, and this time the instrument cannot lose the answer.

---

## 4. Hazard list

The named traps, each with the mechanism and the guard:

1. **`file=0` is a real index.** `Number(raw) || undefined` maps it to `undefined`, the backend serves `max(files, key=size)`, and every episode of a pack plays the same arbitrary file. `Number('')` is `0`, so a truncated `?file=` silently plays the first file. **Guard:** Task 6's table plus the seam test that no `null`/`NaN` survives into either `getStreamingUrl` or `getStreamingInfo`.
2. **A `null` file index has two different silent failures.** `getStreamingUrl` emits `?file_index=null` → a **422 with a JSON body** fed to the decoder (one of the two escapes from the empty-body contract; the other is `error_handler.py`'s JSON 500). `getStreamingInfo` lets axios **drop** it → `/info` resolves the largest file and returns that file's `content_id`, which the heartbeat writes. **Guard:** Task 1's handler plus Task 6's normalisation. Defence in depth, because any future caller bypassing `fileIndex` reopens it.
3. **Arriving during `downloading_metadata`/`queued`/`checking`/`allocating` is normal.** `preparing` navigates. `/info` 404s, `/video` 404s or 503s, and `/files` answers **`200 []`** — read as "no episodes" and the screen lies. Treat the first 404 as fatal and the viewer is stranded on a title that was about to play. **Guard:** Task 9's detail-string discriminator and the `200 []` test.
4. **The auto-hide dropping focus to `<body>`.** Three distinct mechanisms: `display:none`/`visibility`/`inert`/unmount **blur** the element and with constant counts the reconcile effect **never re-runs**, so it is permanent; a zero-count hide **resets** to `firstTarget` rather than restoring; and `pointer-events:none` is banned by §8.3 while a descendant has focus. **Guard:** opacity only, plus the identical-`activeElement`-by-reference test and the stylesheet-rule assertion.
5. **A second overlapping arrow handler.** First registered wins, and effects register **child before parent**, so the winner is not the one the author expects. The live web bug: the window handler proceeds when focus is inside the player **or** fullscreen — an AND of negatives, so during a film it is global — and never checks `defaultPrevented`, while the scrubber also calls `skip(10)`: ±20 s per press. **Guard:** Task 7's `nestedArrowClaim.test.tsx` and the "nothing claims the arrow twice" assertion; the TV has exactly one window arrow consumer (the grid) and one nested claimant (the scrub cell).
6. **The conditional claim at the boundary.** `preventDefault()` only when a seek is possible — the diag page's shape — means the press **at the ceiling** falls through and the ring jumps off the bar at the exact moment §7.4's refusal fires. **Guard:** unconditional claim, with the mutation that proves it.
7. **`api-client`'s 401 redirect taking the player out from under itself.** It fires in the rejection interceptor **before any caller sees the error**, hard-navigates with `window.location.replace`, and arms a module-scoped `redirecting` flag that is never reset (so later 401s in that document are silent). The player is destroyed mid-film with the position unflushed. **Guard:** `__allow401: true` on the player's own calls and a flush before any navigation; the rest of the surface keeps the redirect, and that asymmetry is documented. Note `rootClient` carries the same redirect, so a `baseService` call is a second path in. Note also it does **not** send `/bigscreen` to `/signin` — that was fixed in stage 5; the remaining problem is what the redirect does to a *player*.
8. **An unknown boundary turning into zero and refusing all seeking.** Three backend paths legitimately answer unknown, and `/info` 404s outright for an evicted torrent. A `null` collapsing to 0 bricks every seek on a complete film — the TV's main content. **Guard:** `null` → unbounded, with the mutation that proves it, and `_safe_have` explicitly banned inside the walk for the same reason.
9. **A boundary drawn exactly at the frontier still hangs.** The mid-stream hold is **300 s per chunk** (`cap` and `waited` both re-initialised inside the loop), unbounded in total, with the 206 already sent and no status code left. **Guard:** `MARGIN_S`, with the at-the-frontier mutation. The margin's size is a guess until reading 3.
10. **The boundary sitting *behind* the playhead.** The normal case for a pack episode, not an edge. A clamp without the playhead lift yanks the viewer backwards or refuses to start. **Guard:** the lift, with its mutation.
11. **A phantom cell / a count that does not equal the cells.** Parks the ring on a cell no element claims, and there is no Tab key to escape with. The grid also `preventDefault`s arrows **before** checking for an empty grid, so a zero-stop state swallows every press with nothing focused. **Guard:** `journeys.test.tsx:829`'s one-ring-and-it-is-activeElement invariant applies automatically once the `ScreenCase` lands, plus count-parity tests per component.
12. **Prepending a Retry cell.** Growth never refocuses, so the ring sits on the element that became column 1 while the model points at column 0 and the first press appears to do nothing. **Guard:** append last, with the column-stability mutation.
13. **The harness that passes while asserting the wrong thing.** The house `arrow()` helper fires at `window`, which a React `onKeyDown` never sees — the grid moves the ring and the test is green about nothing. **Guard:** fire at `document.activeElement` in every player key test, stated in the plan.
14. **Copying the web's dep arrays.** The 1 s interval's identity is hostage to an unmemoized prop; a TV page re-rendering faster than 1 Hz has **no stall detection** and no existing test can see it. The web survives only because its poll is 5000/1500 ms. **Guard:** `[]` deps + ref-held callback, with the 200 ms re-render test.
15. **Copying the stall latch's race.** `expectingPlayback` includes `!video.paused`, and `load()` sets `paused` without firing `pause`, so the latch is released by the recovery it just triggered. There is a third clear site the recon missed. **Guard:** `expectingPlayback` as a caller-supplied input; the TV's never reads `video.paused`; the detector is suspended during a recovery.
16. **A ranged-GET "cheap probe".** Runs `prioritize_video_files` + `force_start_for_stream` (a DB write) and re-anchors the deadline window to the **file head**, mid-film. Even a *refused* far seek plants an island at the position it abandons, so a retried probe drags swarm bandwidth away from the viewer and slows the frontier it is waiting for. **Guard:** HEAD only, pinned structurally (`method === 'HEAD'`, no `Range` on any call).
17. **An unbounded 503 retry.** One of the three 503 paths is the catch-all and can be permanent, and every GET retry re-runs the priority recompute and a DB write. **Guard:** bounded attempts + a terminal focusable screen.
18. **Erasing the web's progress row.** `progress_upsert` updates `title`/`file_index`/`content_id` **unconditionally**, so a heartbeat without `title` wipes it and takes Continue Watching's label. The written `file_index` is also **sticky** via `title.ts:154`. **Guard:** always send `title` in the strippable shape; POST-only; the don't-erase mutation.
19. **A silently orphaned resume.** `resolve_content_id`'s `tv:{tmdb}:s0:e{N}` parses cleanly, matches nothing the detail screens build, and draws as `S00 · E04`. **Guard:** build the id client-side; never write under `s0:`.
20. **`useSearchParams` without a boundary.** Fails inside `next build`, which runs inside the Docker image build — a broken **image**, not a red test. **Guard:** deliberate boundary + `npm run build`.
21. **The two guard commands run in no build and no CI.** Every CSS ban, import rule, token pin, drift pin and focus invariant is enforced only by someone typing `npx vitest run` and `npm run test:tv`. **Guard:** both named in every task and in the commit checklist. This repo's own memory note is that one green run proves nothing — the mutations are the answer, and they are also manual.
22. **A test-shaped lie.** The two most likely here: a `null`-is-not-zero assertion that passes on a falsy check, and a classifier commented as "detects the 503" when HEAD structurally cannot see it. **Guard:** mutate the unknown path to return a zero-length run and confirm red; write the HEAD limitation into the module header.
23. **Leaving `journeys.test.tsx` vacuous.** Relaxing `expectBuiltRoute` instead of removing the branch makes the whole file toothless — its header calls the catch-all "the vacuity trap". And the delete instruction names two of four sites. **Guard:** the five-edit list plus the restore-the-catch-all mutation.
24. **1080p is a preference, not a guarantee.** Health tier outranks bucket index and 2160p is the **first** fallback, and the selector never reads `codec` — so a healthy 2160p HEVC release can be handed to the player today, on a panel where HEVC decode and DTS at 1080p are both unverified. Stage 8 owns the selector; stage 7 owes only a truthful failure, which is what the `decode` verdict is for.

---

## 5. What stage 7 explicitly defers

| Deferred | Owner | Note |
|---|---|---|
| Codec-aware selection, the 4K opt-in, a quality picker | **Stage 8** | The TV keeps asking 1080p from the single constant at `_data/title.ts:84`. §7.3 does plan a picker; it is the code comment that says there is none. Stage 7's only concession is the truthful `decode` verdict. |
| Subtitles, `<track>`, sidecar endpoints | **Stage 9** | `skip_non_video_files` keeps zeroing sidecar priority. |
| The webOS shell and the real root exit | **Stage 10** | Back escalates **two** levels; the third is inherited from home, which already carries the documented `stayOnHome` no-op. Writing a third now means inventing an exit. |
| A navigation stack / Back returning to the detail screen | **Stage 10** | The watch URL carries a torrent id and a file index, no tmdb id or media type; widening `watchHref` touches the surface's only watch-URL builder (four `toBe` assertions plus a journey test). Parked finding 13. |
| Source switching on the TV | **not scheduled** | `onRecoveryExhausted`'s equivalent is kept as the one outbound signal; `sources`/`currentSourceId`/`onSelectSource` are dropped. The web's answer is wrong here: the first press (`POST /torrents/download`) is itself gated, so it 401s and bounces to pairing — possibly after minting a second multi-gigabyte download, with the ARM cap at two. |
| The web player's four parked defects | **a later web stage** | The interval-identity chain (`:603/:658/:661`), the stale `isBuffering` reads (`:869`, `:1058`), `attemptRecovery` missing from the listener deps (`:1154`), the ±20 s arrow double-seek (`:728`/`:1619`). Each is an untested behaviour change on a surface stage 7 is not asked to touch; the TV simply does not reproduce them. |
| The web player's health-chip copy | **same** | "Waiting for peers (0 connected)" on a finished 0-peer torrent playing fine. `streamAdvice`'s `busy` term exists so the TV does not inherit it; the web keeps passing `busy: true`. |
| `preload="auto"` on the web element | **not scheduled** | §7.6's `"metadata"` is about the TV element, and `preload` lives on the element, not a prop. |
| The mid-stream 300 s truncation | **not fixable here** | Once the status line is sent there is no code left to signal with, and the docstring argues the cap should stay generous. The boundary prevents the request instead, which is what §7.4 asks. |
| Wiring `await_pieces_async` / `_adaptive_piece_timeout` into `stream_file_range` | **spec §7.1's pending work** | Exists at `manager.py:1627` with no production caller while the loop polls every 250 ms and the docstring claims it is event-driven. |
| Fixing `_refresh_active_torrents` / `find_loadable_on_startup` | **a backend stage** | They disagree about `seeding`, and `POST /torrents/action/{id}` with `resume` applies no state filter while the batch endpoint honours `RESUMABLE_STATES`. Task 2 takes the narrow seam and records both. |
| A backend Pydantic model for `/info` | **not scheduled** | It is a bare dict with no `response_model`; introducing one is larger than the field being added. |
| Server-side seekable **seconds** | **not scheduled** | No duration anywhere in the backend and `/info` has no profile identity. Bytes plus a floored fraction; the TV converts. |
| Extracting the element-driving sequence | **revisit on trigger** | On a fourth behavioural divergence — stage 9's `<track>` handling on both surfaces, or a second shared recovery concern. |

---

## 6. Open decisions for the user

Two, both places where proceeding on my assumption could waste real work:

1. **Is Task 2 in scope?** Making a finished download streamable is a change to the shared backend streaming path, and it is **not** in spec §10's consolidated backend table. My recommendation is **yes, narrowly** — three guards, its own test file, no lifecycle change — because the television's main content is finished downloads and without it stage 7 ships a player that works best on titles still downloading, which is a strange product. **If you rule it out:** Task 1 and Task 9's `gone` screen still land (both are needed regardless, for genuinely deleted torrents), and the stage must say out loud in its results that the TV cannot play a completed download after a backend restart.

2. **Auto-seek, or the rebuilt resume prompt?** §8.3 says the resume prompt is rebuilt. I am choosing **auto-seek**, for two reasons: the detail screen's control already read "Resume from 1:02:05" and then dropped `atSeconds` on navigation, so a player that starts at 0:00 is a control whose label lied — the defect class `_data/title.ts:33` says this surface refuses; and a prompt is a **second focusable region**, which on this surface means a fourth mutually exclusive child with its own grid, since only one `useFocusGrid` may be live. §8.3's point is really "do not use `ui/fre/Modal.tsx`" (it traps Tab and closes on Escape, neither of which a remote has), not "add a question the previous screen already asked". **This is a deviation from the spec and I want your veto if you disagree** — it is cheap to add as a fourth child later, and expensive to retrofit into a screen that assumed one grid.

Everything else I have called: the sharing boundary, the `run_containing_offset` API shape, HEAD-only probing, the route-scoped 422 handler, hide-by-paint, two Back levels, POST-only progress, and merging on green tests while holding the "done" claim for readings 1–3.