# Stage 9 — sidecar subtitles: piece-level admission, two read endpoints, and one `<track>`

Branch `feat/tv-stage9-subtitles`, off `master` at `4cad98b` (the stage 8 merge).

Spec: `docs/superpowers/specs/2026-09-22-webos-tv-app-design.md` — §7.5 is the stage, §4.4 the current state, §10's table row at `:796`, §11 point 4 at `:824`, §13's out-of-scope list at `:894`, §14 row 9 at `:923`.

**Read `2026-10-20-tv-stage9-design-notes.md` first.** It is the design record: seven adversarially-checked recon areas, four competing designs, three judge panels, and the three things all four designs missed. Everything below carries a `file:line`, and **every citation in this plan was re-verified against the tree at `4cad98b` while writing it** — the dossier's own corrections drifted by ±1–2 lines in a dozen places, and one claim four independent recon passes agreed on ("the stale `manager.py:1226-1228` citation appears at three spec sites") is wrong: `grep -c` says **two** (`:267` in §4.4, `:662` in §7.5). §10's row at `:796` carries no line number at all. Four scouts corrected the same thing the same wrong way; do not inherit a number from a correction without opening the file.

**This stage is unlike 7 and 8 in one way that shapes every task: the deliverable §7.5 names is the wrong mechanism, not merely an incomplete one.** §7.5 bullet 1 says to stop zeroing priority for sidecars. Stage 9 does not, at either site. The reasons are measured, they are in **The settled decisions** below, and the clearest single sign of it is that `backend/tests/test_skip_non_video.py:31` — which pins `h.applied == [1, 0, 0, 0]` for a fixture naming `subs.srt` explicitly at index 3 — **survives this stage unmodified**. A plan that rewrites that assertion is a plan whose mechanism is wrong.

---

## Scope

In: a `subtitle_extensions` Settings field; a live-session sidecar lister whose readiness is measured and whose emptiness is never ambiguous; a pairing ladder that reports which rung it took; on-demand piece-level admission with a gate that keeps it from marking an unplayable episode complete; a pure-Python SRT→WebVTT converter that refuses rather than emits; three routes on a new router; one unconditional `Subtitles` transport cell with a picker; exactly one `<track>`; the scrim faded with the band; and twelve readings.

Out, with owners: the webOS shell and the real root exit (**stage 10**, which also owns parked finding 13); the web player's CC button (**stage 10** — decision 4 below); the `save_info_dict` repair of stage 7's resume-data fallback (**stage-7 follow-up**, named with its red test in **What ships inert or absent**); ASS/SSA conversion (**declined** — see **Decisions taken on the user's behalf**); a disk walk for evicted torrents (**declined** — see **Decisions taken on the user's behalf**).

## Verification, every task

From `frontend/`: `npx vitest run`, `npm run test:tv`, `npx tsc --noEmit`, `npm run build`. Backend, in a one-off container with tests mounted (they are baked into the image, not bind-mounted):

```bash
docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest -q
```

**Never** `docker compose up`, `down`, `restart`, or anything with `-V`. Recreating the running `backend` mid-download leaves a torrent seeding at 100% with no files on disk and there is no `force_recheck` path to recover it.

**Re-baseline all four counts at branch start and quote them in task 1's commit.** The dossier's numbers (backend 1441, `test:tv` 1388, `npx vitest run` 2340) are the starting point, not a target.

**The one-off container talks to the real dev Postgres**, and there is already a leaked pytest row in it (`t-block-1`, state `blocked`, `save_path` under `/tmp/pytest-of-root/...`) plus a `seeding`/100 row whose `save_path` does not exist on disk. Every test in this stage builds `Torrent` rows through `conftest.py`'s `override_get_db` (`:109`) and its throwaway SQLite engine (`:73`), patches `get_db` on **both** `app.torrent.manager` and `app.api.subtitles`, and commits nothing. `conftest.py` has no libtorrent fixture or kill switch — its seven fixtures are `auth_disabled` (`:44`), `auth_enabled` (`:53`), `clean_rate_limiter` (`:62`), `sqlite_engine` (`:73`), `session_factory` (`:94`), `db_session` (`:99`), `override_get_db` (`:109`) — and importing `app.torrent.manager` constructs a real libtorrent session at module scope (`manager.py:2024`), so any `lt.session` a test builds is built with DHT, LSD, UPnP and NAT-PMP off on `127.0.0.1:0`.

**Neither frontend guard runs in any build or in CI.** `test:tv` is `vitest run 'src/app/(bigscreen)'` (`frontend/package.json:13`) — a **directory glob**, so a guard test placed outside `src/app/(bigscreen)/` is silently absent from that suite while still running under `npx vitest run`. Every mutation below is manual. Loop the suites: `test:tv` 25+ times, the full `vitest run` 5+.

---

## The settled decisions

### D1. Neither file-priority selector changes. Sidecars are admitted at PIECE level, on demand.

The two selectors, verified: `skip_non_video_files` is `backend/app/torrent/manager.py:1342-1357`, the comprehension at `:1349-1352`, applied at `:1355`, **one** caller at `:585` — and that caller is inside `if settings.content_guard_enabled:` (`:580`, default `True` at `config.py:130`), in the `lt.metadata_received_alert` branch. The second site the spec never names is `prioritize_video_files` (`:1359`), which rebuilds the whole vector at `:1397-1410` (`append(7)` for video at `:1404`, `append(0)` for everything else at `:1410`) and applies it at `:1414`; it is called from `api/streaming.py:280` on every ranged `GET /video` while `progress < 100` (`:278-279`), from `api/torrents.py:288` with **no** progress gate, and from `frontend/src/components/downloads/DownloadsView.tsx:134`. The two disagree about the video value (1 vs 7).

Four measured reasons to touch neither, from `/private/tmp/claude-501/-Users-benjaminherro-github-freeflix/842cb553-a0bf-4489-923f-d782bde82aab/scratchpad/s9/probe_pieces2.py` (an **incomplete** torrent with the sidecars deleted before recheck and no peers — the only state with a piece picker; an earlier run against a `seeding` torrent measured nothing):

1. **A changed `prioritize_files` list recomputes the whole torrent's piece priorities and wipes `_prioritize_window`'s raised window.** `handle.file_priority(i, p)` does the same. Re-applying an **identical** list does not. `prioritize_video_files`' list is a pure function of the file set and `settings.video_extensions` — `file_index` only picks `target_index` for piece prioritisation — so after the first play it re-applies an identical list on every Range request. Making the admitted set depend on the watched file would put that recompute on every request and every episode switch.
2. **A short list re-admits rather than deselects.** `prioritize_files([1,0,0])` on a 5-file torrent whose pre-state was `[1,0,0,0,0]` yields `[1,0,0,4,0]` — the tail goes to libtorrent's **default 4**, silently, with no error. On a 40-file pack that is the padded worst case arriving by accident.
3. **The progress gate is the severe one.** `status.progress` is wanted-progress; `manager.py:328` writes it straight to the row. A widened wanted set whose bytes never arrive holds the torrent below 100% forever: `downloading` is in `ACTIVE_DOWNLOAD_STATES` (`states.py:4-7`), so one of the Pi's two slots is held (`main.py:57`) and the nav badge never clears (`api/activity.py:36`); `lt.torrent_finished_alert` (`:486`) never fires so `release_stream_force_start` (`:494`) never runs; and — the one that matters most — **`get_completed_video_file_info`'s gate 2 is `if state not in ON_DISK_STATES or progress < 100` at `:1250`**, so the title loses the only path that serves it after a restart. A file-level admission trades subtitles for the television's main content.
4. **The cost is piece-shaped, not byte-shaped.** §7.5's "(kilobytes)" is wrong by up to four orders of magnitude: the marginal cost is `extra_pieces × piece_length` — measured 0 on an unpadded v1 torrent, one full piece per sidecar on a pad-aligned one (libtorrent 2.0's own `create_torrent` pads by default, as does qBittorrent, and every v2/hybrid torrent must), i.e. 1.6 GiB for a 20-language `Subs/` tree at an 8 MiB piece.

The mechanism instead is **two-phase, and C1 above is the measurement that shapes it.** Phase 1 is `handle.piece_priority(p, 7)` + `handle.set_piece_deadline(p, 0)` over the sidecar's own piece span — the same two calls `_deadline_pieces` already makes at `manager.py:1936-1937`. Measured: raising a piece wholly inside a deselected file widens `total_wanted` by exactly that file's bytes, leaves every file priority untouched, and — the property that decides the shape — **survives `prioritize_video_files`' next call**, because that vector is a pure function of the file set and libtorrent does not recompute from an identical list. But phase 1 alone leaves the bytes in a `.<infohash>.parts` part file that nothing can read, so phase 2 is a **flush**: once the span is held, one `file_priority(idx, 1)` moves them into the save path with `redownloaded=0`, and one `file_priority(idx, 0)` puts the priority back. Those two calls each wipe `_prioritize_window`'s raised window (measured on unheld pieces), which is transient because the repo re-asserts it per chunk, and they are the whole reason admission is not file-level from the start: a file-level admission makes the selector's next call a *changed* list, which undoes the admission and takes the playhead's window with it. **Designs 2's and the spec's position loses** because it buys a background pre-fetch nobody asked for at the price of reason 3; **Design 1's seam inside `wait_for_first_chunk` loses** because that function has exactly one caller, `api/streaming.py:334`, the shared `GET /video` path the web player drives too, so every web stream open would widen that torrent's wanted set with no subtitle UI to show for it.

### D2. Admission is a POST, and it is the only mutating route.

`classify.ts:11-20` is right that a GET which re-deadlines pieces is a probe that hijacks libtorrent's deadline queue. A POST also makes the mutation **structurally unreachable from a `<track>`**, which is a better guarantee than a source-text pin that a `getattr`-assembled name walks past. Design 3 found this; Designs 1, 2 and 4 all admit as a side effect of the read and then pin the absence of other side effects with scans whose limits they acknowledge.

### D3. Gate 4 — every byte of every piece raised must belong to files at priority 0.

This is the sharpest edge in the stage and it is a defect Design 3's probe found that the rest of the dossier would have shipped, **reproduced independently in task 0's run 4**. `piece_priority(p, 0)` on retraction, applied to a piece a **wanted** file also occupies, **de-wants video bytes**: on the unpadded layout `total_wanted` fell *below* baseline (residual **-3048**), the shared piece's priority went to **0**, and the torrent fell back from `seeding`/100% to `downloading`/46.78%. A negative residual is the torrent wanting less than its own video. An unplayable episode marked complete.

**C1 gives gate 4 a sharper job than the design round gave it.** The *success* retraction is `file_priority(idx, 0)` and needs no gate — measured, residual **0**, the shared piece left at libtorrent's default **4** (still wanted), the state back to `seeding`, and the video's SHA-256 matching the seed's. Gate 4 guards the **budget-expiry** retraction, which has no choice but to be piece-level, because an admitted piece that never arrived is the one thing that holds the torrent below 100%. That is now the only place a `piece_priority(p, 0)` appears in the stage, and it is the dangerous one.

Gate 4 also doubles as the no-op detector: on an unpadded torrent the sidecar shares a piece with a video file's tail, those bytes are **already wanted**, and admission is correctly a measured no-op — report `admitted: 0` rather than raising anything.

**The acceptance test for any change here is the video file's SHA-256 against a known-good copy, never a status line.** Both of run 4's arms ended with matching hashes, and only because the probe had a willing seeder and its loop waited for every piece; in production the de-wanted piece never arrives and the status line still says 100%.

### D4. Admission is bounded three ways and retracted on a budget.

`subtitle_admit_max_pieces = 4` forecloses the 1.6 GiB padded case per-sidecar structurally rather than by budget. `total_wanted` rises by only the file's bytes, but the download cost is whole pieces, so the cap is on the **span**, not on the size. One sidecar per POST.

Two exits, and they are different calls:

- **Success** — the span is held. `reset_piece_deadline(p)` over the span, then `file_priority(idx, 1)`, then `file_priority(idx, 0)`. Measured: the file lands at its declared size, `redownloaded=0`, `total_wanted` returns to baseline with residual **0**, and the written bytes survive both the re-zero and every later selector call (`on_disk=40960` after the selector re-zeroed an already-written sidecar).
- **Budget expiry** at `subtitle_admit_budget_ms = 45_000` — the span is not held, so there is nothing to flush and the admission must be withdrawn or it strands the torrent. `reset_piece_deadline(p)` + `piece_priority(p, 0)`, **gate 4 re-checked**, never assumed from the admission: `_prioritize_window`'s relax branch sets `piece_priority(p, 1)` — "low, not zero (still wanted)" (`manager.py:1963`) — and is re-asserted per chunk, so the span's composition can have changed underneath.

### D5. Resolution is the live session only, and the emptiness is never ambiguous.

The brief's ground fact 3 points stage 9 at a mechanism that is **dead in production**. All three `handle.save_resume_data()` calls are flagless (`manager.py:322`, `:812`, `:993`); libtorrent 2.0.11 omits the `info` dict without `lt.torrent_handle.save_info_dict`; the persisted blob is `lt.write_resume_data_buf(alert.params)` (`:515`). So `lt.read_resume_data(...).ti` is None (`:1169`), `_video_files_from_resume_data` takes its own `if ti is None` branch (`:1170-1175`) and returns `[]`, and `get_completed_video_file_info` returns None at gate 4b (`:1260-1261`) for every torrent that exists. **The code is the evidence** — three recon passes measured `ti is None` on the dev DB's own blobs, and that n=2 sample is corroboration, not the finding. The docstring at `manager.py:1140-1143` asserts the opposite ("round-trip verified against the pinned libtorrent 2.0.11") and is false for every blob this application writes; it was verified against the hand-built `add_torrent_params` at `test_finished_torrent_streamable.py:144`.

So: **live session only.** `coverage: "listed" | "none" | "unknown"`, `source: "session" | null`. Design 2's three-source reach loses on three counts: the resume source needs `save_info_dict`, which changes what every torrent writes and flips a shared four-gate resolver from always-None to sometimes-returning — a stage-7 repair, not a subtitle stage's business; the disk walk cannot resolve a libtorrent index (which admission needs, and admission needs a live handle anyway) nor verify completeness against a declared size (which the honesty gate needs); and the walk costs an `os.walk` on the ARM disk per request plus a containment surface, for a sidecar whose bytes arrived by accident. The library has **zero** sidecars today — verified, `find downloads -type f` is one `.mkv`, one `.mp4`, and `www.YTS.MX.jpg` — so the accident is not worth building for.

### D6. `coverage` is an envelope field, not an empty array.

`/files` already answers `200 []` with three meanings and `backend/tests/test_finished_torrent_streamable.py:226-230` records in the repo's own words that `200 []` "means 'not ready, or evicted' and never 'this pack has no episodes'" — RECORDED, NOT FIXED. A fourth `200 []` inherits a meaning the suite has already declared unusable. And a 404 is worse: the TV's one status→copy map renders 404 as "The box doesn't recognise this title." (`_data/title.ts:488`) and 409/429/503 as "The box is busy with other downloads." (`:491`), both false sentences about a release that ships no `.srt` — which §7.5's own acknowledged gap says is the common outcome.

`coverage` is computed from the lister's own success, **never** from `handle.has_metadata()`, which is unanswerable for exactly the case the field exists to describe.

### D7. Readiness is measured by `contiguous_available`, never by `file_progress` and never by a stored row.

`contiguous_available(torrent_id, idx, 0)["complete"]` (`manager.py:1614`, `complete` key at `:1711`). It takes a non-video index unmodified — `idx = file_index` at `:1666`, the only check is `if idx < 0 or idx >= ti.num_files()` at `:1674`, and its video-only default applies only when `file_index is None` (`:1667-1672`) — and its memo is keyed `(torrent_id, idx, at_piece)` (`:113`), so a sidecar lookup cannot collide with the video's. Its fast path at `:1726-1727` is `progress[idx] >= file_size and handle.have_piece(last_piece)`, and the comment at `:1719-1724` says why the conjunct is there: `file_progress()` "is called with NO granularity flag by either caller, so it counts unverified blocks: byte-completeness alone would report `complete` at exactly the moment a tail seek still blocks." For a 40 KB sidecar wholly inside one piece, `last_piece == first_piece`, so `have_piece` **is** the hash-verified check on the whole file. A bare `file_progress()[i] == size` is refused by name.

**But C1 adds a second conjunct, and it is not optional: a held piece is not a readable file.** Until phase 2's flush runs, the bytes sit in a `.<infohash>.parts` file and `open()` on the sidecar's path raises `FileNotFoundError` while `contiguous_available` reports `complete` and `file_progress` reports the full size. So `ready` is `contiguous_available(torrent_id, idx, 0)["complete"]` **and** the file present at its declared size — the same `getsize == size` comparison stage 7's gate 3 already makes at `manager.py:1274-1285`, reused by shape rather than by call. Task 3's `Does not call os.path.getsize` is **withdrawn by C1**; what remains forbidden is deriving readiness from `getsize` *alone*, which cannot see a truncated tail that libtorrent has not yet verified.

`_video_files_from_resume_data` hard-codes `"downloaded": fi.size, "progress": 100.0` (`:1186-1187`) — a claim, as its own docstring says. Never reused.

### D8. A separate `subtitle_extensions` field. Never `video_extensions`.

`_is_video_file` (`manager.py:1019-1022`) wraps `content_guard.is_video_file(path, settings.video_extensions)` and is the predicate for `get_video_files`' filter (`:1075`), `_video_files_from_resume_data`' filter (`:1180`), `skip_non_video_files` (`:1351`) and `prioritize_video_files` (`:1402`); `content_guard.py:49` reads the same setting for rule 2, whose failure path is `_block_torrent` (`:1308`) — `session.remove_torrent` then `safe_rmtree`, with no unblock path. Widening it would let a subtitle-only release satisfy "has playable video", double a pack's `/files`, let a `.srt` resolve as the streamable file, mint a `tv:{id}:s{n}:e{n}` content_id for a file nobody watched, and — via `:1402` — hand a 30 KB text file priority **7** in competition with the playhead.

`.sub`/`.idx`/`.sup` are in neither set: VobSub and PGS are image formats, the extension cannot tell text from image, latin-1 never raises, and none of the three is in `blocked_extensions` (`config.py:132-136`), so nothing else stops them.

### D9. The index is the torrent's own, and the route resolves only through the lister.

`{index}` matches `?file_index=` (`streaming.py:256`). A filtered position renumbers: `lt.create_torrent` interleaved five `.pad/N` entries on the padded layout so a 3-file tree became `num_files() == 6` with the sidecar at index 4, and with `v1_only` the **same** tree came out in readdir order with 0 pads — so a torrent's file order is not derivable from the filenames in either direction, and `manager.py:1145-1149` already forbids deriving it. Resolving only through the lister gives the extension allow-list, the pad exclusion and the size cap for free, with no second policy to drift. Plus an explicit containment assertion — `Path(p).resolve()` must be under `Path(save_path).resolve()`, the `safe_rmtree` idiom at `backend/app/torrent/storage.py:33-42` — because nothing on the existing resolution path asserts it (`_resolve_video_file` checks only `os.path.exists`, `streaming.py:200`) and a route that returns file **contents as readable text** turns incidental cover into a disclosure primitive.

### D10. Hard-code `text/vtt; charset=utf-8`. Never `get_mime_type`.

Measured in the real image (Python 3.10.22): `.srt → text/plain`, `.ass → audio/aac`, `.ssa → None`, only `.vtt → text/vtt`. `/etc/mime.types` exists in that image, so the table is a property of the **base image** and a `python:3.10-slim` bump can change it with nothing noticing — `test_video_mime_types.py:11-12` only subtracts `VIDEO_MIME_TYPES` from `settings.video_extensions`, one-directionally. `VIDEO_MIME_TYPES` (`streaming.py:32-49`) gains nothing.

### D11. The 401 is bodiless and that is structural, not a choice.

`main.py:91` gates the router with `require_session_silent` and `:116` includes `streaming.router` with it; `:87-90` records that "the router-level dependency runs before the endpoint's own, so gating this router with the loud variant would make the per-endpoint `require_session_silent` unreachable." `bare_401` at `:194-196` returns `Response(status_code=401)`. The new router inherits the same posture by being included the same way. **That is precisely why the list carries `ready` and the TV never learns readiness from a `<track>`:** a bodiless 401 is indistinguishable from a malformed file to that element. `_BARE_422_PATHS` (`:211-213`) matches only `/video/?$` and is **not** extended — a subtitle error body is never handed to a parser and is the only thing a sibling `fetch` probe can read.

### D12. One unconditional cell; OK opens a picker; the state lives on the cell, not in the band.

Unconditional, because a cell that appears when the list resolves is the documented mid-row-insertion defect: `TransportBar.tsx:30-33` says a cell inserted at or before the focused column "would leave DOM focus on the element that just became column 1 while the model still points at column 0, and the next press would appear to do nothing," and the mechanism is `useFocusGrid.ts:300` — `if (!same(start, focusedRef.current)) go(...)`, so an insertion that leaves `clampTarget`'s answer unchanged never refocuses. The arrival case is reachable: the list resolves asynchronously while Retry may already be on screen.

Three existing guards fire for free. `TransportCellId` (`:43`) widens `TransportAction` (`:57`), so `TWIN_CELL: Record<TransportAction, TransportCellId>` (`:111`) fails `tsc` until given an entry — while `MEDIA_TWINS` (`:93`) is keyed on `MediaKeyAction` and does **not** complain, which is correct: no subtitle key code has ever been read off this set. `TransportBar.test.tsx:159-162` then walks `TWIN_CELL` and requires the cell to be **rendered**, which forces unconditionality independently of the focus argument. And `transportCellCount` stays `transportCells(opts).length` (`:127-129`) with **no new option**, so the page↔count drift hazard is structurally impossible.

The state goes on the cell as an `aria-hidden` `.bs-player__commit` sub-line — the ScrubBar idiom (`ScrubBar.tsx:172`), whose rule already exists at `bigscreen.css:1002`, so **no new CSS class**. `aria-hidden` is load-bearing: `TransportBar.test.tsx:98` and `:140` both do `getByRole('button', { name: labelFor(cell, …) })` with an exact string. The new prop is **optional** (`subtitles?:`), matching `retry?: boolean` (`:148`), which keeps all six existing `<TransportBar …>` renders compiling (`playerCss.test.tsx:157`; `TransportBar.test.tsx:37, 54, 68, 81, 196`), and `labelFor`'s signature is **unchanged**, which keeps its four existing call sites compiling (`TransportBar.test.tsx:98, 140, 209, 215` — four, not two; Designs 1 and 4 both miscounted this while proposing a required field).

Nothing goes into `messageFor` (`page.tsx:1033`). `mayHide = playing && !editOpen && message === ''` (`:826`), so a steady sentence pins the 480px band over the picture for the rest of the film — stage 8 measured exactly that.

### D13. The picker is a `rowCounts` replacement inside the one grid, with a Back rung and a `mayHide` clause.

A second `useFocusGrid` is not available: `useFocusGrid.ts:25` says only one may be live per screen, and during an overlapping mount the **incoming** grid is the dead one. The working pattern is `bigscreen/profiles/page.tsx` — three mutually exclusive grids. A cycle-on-OK is refused: nothing arrow-driven can live inside a transport cell (`ScrubBar.tsx:18-22` eats the horizontal arrows while focused, `preventDefault()` unconditional at `:112`), and on this television the transport row is usually the **only** row, because `scrubRowCount` returns 0 unless duration is finite (`ScrubBar.tsx:62`) and a finite duration has never been observed for an in-progress stream on this set.

So `rowCounts` becomes `pickerOpen ? pickerRowCounts(n) : [scrubRowCount(duration), transportCellCount({ retry: retryable })]` at `page.tsx:953`, chunking `offerable + 1` cells (an always-present **Off** first, so no reachable state leaves nothing focused) into rows of three. Focus moves **explicitly in both directions**, because `clampTarget` (`model.ts:65-69`) would otherwise land on `clamp(col, 0, n-1)` of the picker's first row on open and on `firstTarget` on close — which, with an empty scrub row, is Play/Pause.

And the Back rung is **mandatory**, not optional: `mayHide` guards only the auto-hide timer, while the ladder's second rung calls `setVisible(false)` **directly** at `page.tsx:531`. Without a `pickerOpen` rung ahead of it, one Back press hides the band under an open, focused menu and the next leaves the film. `pickerOpen` must be **route** state declared beside `editOpen` (`:305`) and passed down (`:573`), because `onBack` lives in the route (`:518-535`, `useBackKey(onBack)` at `:536`) while `mayHide` lives in `Playing`; a flag owned by the picker makes both guards unreachable code no test can redden. The level stays derived, never counted (`:511-513`).

### D14. Exactly one `<track>`, enabled by `default`, unmounted during a recovery.

Measured: a `<track default>` inserted after `loadedmetadata` reaches `mode: 'showing'` asynchronously, even with the media element in the error state. So no TextTrack API is touched — which matters because jsdom 25.0.1 has none: `window.TextTrack` is undefined, `video.textTracks` is a plain zero-length `Array` with a `<track default>` child present, `trackEl.track` is undefined, `trackEl.readyState` is a hardcoded 0, and `addTextTrack` does **not throw** (it reports a jsdomError and returns `undefined`, so even a `toThrow` guard around it is dead code). A mode-setting implementation would be a silent no-op in every test *and* unexecutable in principle.

One element, keyed on the index, because two `<track default>` elements both reach `showing` — Blink enforces no winner — and mode is not re-derived when the attribute changes. Off is "render no `<track>`".

Unmounted while `recovery.kind === 'reloading'` (`_player/recovery.ts:52`, said at `:117`): measured, each `video.load()` **appends** a fresh TextTrack per `<track>` element without discarding the previous — one element, `textTracks` 1 → 2 → 3, every copy `showing`, three identical cue lines stacked on the picture. React cannot reconcile that away; there is only ever one element.

`onErrorCapture`, never `onError`: react-dom 19.0.0's `listenToNonDelegatedEvent` block covers `embed`/`source`/`link` and `case "track":` falls through without them, and the native events do not bubble — so the bubble prop is dead code no test would catch, while the root-container capture listener fires in jsdom and in Blink. Never branch on `trackEl.readyState`; branch on which event fired.

### D15. No `crossOrigin`, with the right reason.

The track URL is same-origin through `next.config.ts:75-76`, so nothing is needed. The attribute would switch the media element's own range requests to CORS mode on the ladder's next `load()`, against an exact-match `cors_origins` (`config.py:92`) that does not contain a LAN address. It is **not** that it drops the cookie — `crossorigin="anonymous"` sets credentials mode `same-origin`, which still sends cookies on a same-origin request, and a ban resting on a wrong reason is one the first person to test it deletes.

### D16. The scrim fades with the band. No cue repositioning.

Verified: `.bs-player__video` is `z-index: -1` (`bigscreen.css:935-937`); `.bs-player__scrim` is **also** `z-index: -1` (`:946-948`) but later in source order, 480px tall, bottom-anchored, with `var(--ink)` fully opaque at its 0% stop (`:955`), rendered unconditionally at `page.tsx:990`; and `--hidden` sets opacity on `.bs-player__bar` only (`:965`). Native cues paint inside the video element's box, so they paint under the scrim for the whole film and the auto-hide does not rescue them.

The scrim exists to make the **band** legible; when the band is hidden it has no job. So it gains the same `transition: opacity 180ms cubic-bezier(0.4, 0, 0.2, 1)` and a `.bs-player__scrim--hidden { opacity: 0 }` toggled by the same `visible` flag. The stylesheet explicitly licenses this at `:906`: "The scrim and the hint hold no focus, so the route is free to unmount those." The COMBINING comment at `:920-921` — which currently says there is exactly one modifier in the block — must be updated, or it becomes a lie.

**No `line:` injection.** `::cue` cannot move a cue (Blink retains `bottom`/`transform`/`padding` in `cssText` and ignores them at used-value time; `::cue-region` does not survive into `cssRules` at all), so the only lever is a WebVTT cue setting the converter would have to invent — coupling backend output to a TV stylesheet with no runtime meeting point. And the arithmetic does not work: the gradient is ≈0.82 alpha at 45% of 480px, so clearing it needs roughly `line:-9`, which is mid-screen and not a subtitle position. **What ships inert or absent** says what the television does instead.

### D17. `.ass`/`.ssa` are listed and never converted; `.vtt` is revalidated, never passed through.

This is a **refusal with grounds, not a contradiction resolved** — and the dossier gets that wrong. §7.5 at `:662` lists the formats, `:667-669` says "ASS/SSA styling is dropped to plain text", and §13 at `:894` excludes "ASS/SSA **styling**". Those are consistent: convert the format, drop the styling. So §7.5 does ask for an ASS converter and stage 9 declines it, on four grounds: its `H:MM:SS.cc` timestamps under a shared regex are a measured silent zero-cue shape; a correct reader needs a `Format:`-line-driven field order with `split(',', n)`, `\N` handling and `{…}` stripping, i.e. a different parser; a styling-dropped typesetting file degrades to stacked overlapping junk rather than plain subtitles (overlapping cues all parse and all display); and nothing in this repo contains an `.ass` file to test against, so the grammar would be shipped from recall. `convertible: false` is reported per entry so the television says a true sentence.

The real spec contradiction is §11 point 4 at `:824`, which files "SRT→VTT conversion" under **Frontend, vitest**, against §7.5 (`:664-665`) and §10 (`:795`) putting the converter in the backend. The backend reading has two votes and is the only one a native `<track>` can use; `frontend/vitest.config.ts:14` is `environment: 'jsdom'`, which implements no WebVTT parser. (There is no §11.2 — the heading is a flat `## 11` at `:807`. The brief inherits the misnomer.)

`.vtt` goes through the same decode + validate + emit, because a signature-valid `.vtt` with `00:00:1.000` timings is a silent zero-cue file. One URL kind, one code path.

### D18. The decode ladder refuses rather than mojibakes.

BOM sniff (`utf-8-sig`, UTF-16 LE/BE with BOM) → UTF-8 strict **and** `"\x00" not in text` → `settings.subtitle_encoding` when the owner set one → cp1252 strict → whole-file non-ASCII-letter density gate → refuse. The NUL conjunct is load-bearing: BOM-less UTF-16 LE and BE both decode as **valid UTF-8** into a NUL-riddled string, which a browser then renders as visible U+FFFD garbage with no error. No latin-1 (it raises on **zero** of 256 bytes, i.e. it is the exact shape of serving garbage rather than failing), no `errors='replace'` (it makes every decode mutation unfalsifiable), no bespoke detector (one was built and measured 7/13 — identical to the naive ladder and wrong on worse rows, because Latin-1 mojibake of Cyrillic is 100% letters in one script, so character-category scoring cannot separate it from real text), and no `charset_normalizer`. It *is* importable in the image, but only because `backend/Dockerfile:6` sets `POETRY_VIRTUALENVS_CREATE=false` and `:25` pip-installs poetry into the same site-packages; it appears in neither `backend/pyproject.toml`'s 23 dependencies nor any `[[package]]` block of `poetry.lock`, so any slimming of the Dockerfile removes it and the failure is an ImportError at app import. The density gate's limit is written beside it: it detects a wrong **script**, not a wrong **codepage** within Latin — Turkish cp1254 scores ≈0.10 and sails through with its `ğ ş İ ı` mangled.

### D19. The emitter is the acceptance criterion, because no suite here can run a WebVTT parser.

Nine distinct malformed shapes load as `readyState 2` + `load` fired + `error` **not** fired + **zero cues**, and it is per-cue. A payload line containing `-->` yields a cue with `text === ""` that **passes** a cue-count check. And a naive converter turns a loud failure into a quiet one: raw ASS, an empty file and a header-less file all fire a real `error`; wrap any of them in `WEBVTT\n\n` and they become silent zero-cue successes.

So: `WEBVTT\n\n`, LF endings, `HH:MM:SS.mmm --> HH:MM:SS.mmm` with exactly one space each side, HH ≥ 2 digits, MM/SS exactly two digits in 0–59, fraction exactly three. **Two carries** — seconds ≥ 60 into minutes *and* minutes ≥ 60 into hours, because `00:00:75,000` and `00:75:01,000` are separately measured silent zeros. Strip `\{[^}]*\}` **before** escaping (`{\an8}Top line` renders the braces literally). Escape `&` unconditionally (`A &notreal; B` renders `A ¬real; B` via a legacy semicolon-less entity). Escape `<` **except** where it opens or closes one of `i b u ruby rt v lang c` — a blanket `html.escape()` puts the literal text `<i>` on screen for the whole film. Do **not** strip `<font …>` (Blink drops the tag, keeps the text) or DVD-rip cue-setting junk (measured harmless). Drop cues with `end <= start` (Blink keeps them as invisible dead weight; only the converter can remove them). Escape any `-->` in a payload line. Refuse on zero cues. And lean on **no** measured leniency — Chromium 155 accepts no blank line after the magic, no spaces around the arrow, 1-digit hours, CR-only endings and an absent hours field; the set is Chromium 120 and those five are the parts most likely to differ.

### D20. The pairing ladder reports which rung it took.

Five rungs: basename stem after stripping a trailing language / `forced` / `sdh` / numeric token → nearest-ancestor-directory stem → `parse_episode` over segments **below the torrent root**, required to agree with the paired video's own parse → single-video torrent → unpaired. Rung 2 cannot use `parse_episode`: measured, `parse_episode("Subs/E01.en.srt")` is None, because `_SXXEYY` is `[Ss](\d{1,2})[\s._-]?[Ee](\d{1,3})` (`providers/episodes.py:6`) and a bare `E01` matches neither it nor `_XNOTATION`. The root must be **excluded**, not merely deprioritised: `parse_episode` is an `re.search` taking the first left-to-right match (`:14-16`), so a range-named root **overrides** a correct later segment — `Breaking.Bad.S01E01-07.1080p.BluRay/Subs/Breaking.Bad.S01E04/3_English.srt` parses to (1, 1). Ten of the 94 `shape=episode` rows in `backend/tests/data/releases.tsv` are range-named, and 0 of 119 `pack` rows parse any episode, so the trap set is exactly the releases most likely to ship a multi-sidecar `Subs/` tree.

`pair_source ∈ {stem, dir, parse, single, none}` is returned **and rendered**, which is the graft no design proposed and the epistemic panel named: for `Pack/Pack.S01E03.en.srt`, skipping the stem rung still yields episode (1,3) via the parse rung, so without the exposed rung that mutation cannot be discriminated at all. And a mis-paired sidecar is the one failure in this stage with no error anywhere — valid VTT, correct readiness, true sentence about everything except whose episode it is. So the picker row says `English` for a `stem`/`single` pairing and `English (matched by folder)` / `English (matched by episode number)` for `dir`/`parse`, and the cell's sub-line appends `· guessed` in those two cases.

`precompute_episode_map` (`:1092-1102`) and `Torrent.precomputed_episodes` are not reused: built from `get_video_files` (`:1096`), so they hold no subtitle indices; video-indexed by contract (`streaming.py:426`); string-keyed; and `_persist_episode_map` writes only `if mapping:` so a movie stores nothing.

### D21. Language is an exact token match. Never a substring.

Tokens split on `[._\-\s]+`, matched against an ISO-639-1 code table and an English-name table, with the paired video's own stem tokens removed first. `'en' in "Movie.French.srt".lower()` is the measured trap (`fr-EN-ch`), and the same class hits `Children`, `Golden`, `Kingsman`. `hi` returns `None` (Hindi vs hearing-impaired). `forced`/`sdh`/`cc` are modifiers, not languages. `null` is honest and a null-language entry is still offerable — rendered `kind="captions"` with **no** `srclang`, because HTML requires a non-empty `srclang` for `kind="subtitles"` and a guessed `en` is a lie the viewer cannot see. Entries are deduplicated to one per language (prefer non-`forced`, then the shortest path) so the picker stays small.

**No corpus backs any of this.** `backend/tests/data/releases.tsv` is 370 rows of nine columns with no path column; `grep -cE '\.srt|Subs/'` is 0. Every filename convention in the fixtures is a hand-authored assumption with a provenance note.

### D22. Stage 9 adds the seventh entry to the player-divergence registry.

`frontend/src/app/(bigscreen)/_player/engineContract.test.ts` holds `DELIBERATELY_DIFFERENT` (`:231`) and `DIVERGENCE_CHECKS` (`:253`), with `expect.soft(…).toHaveLength(6)` on both (`:289-290`), set equality (`:294`) and an `it.each` predicate per entry (`:297-298`). The comment at `:286-288` states why the count is absolute: deleting a key from both maps passes every other guard, so "a seventh divergence or a deleted sixth has to be a deliberate edit here."

The TV player rendering a native `<track>` while the web player's CC button stays permanently `aria-disabled` (`VideoPlayer.tsx:1816-1831`) is exactly such a divergence, and **the count pin does not redden when it appears** — the registry is additive by hand. No design in the dossier mentioned this file's second half, and two of them cite its first half by line. So stage 9 adds the entry, writes its predicate over `tvAll` (which exists at `:273` and includes the route, where the `<track>` lives, the same reason the `preload` check uses it), and moves both counts to 7.

---

## Corrections found while implementing (read these before your task)

Stage 8's plan was wrong fifteen times, and every one was caught by the implementer who ran it
rather than by the reviewer who read it. The same section is opened here on the same terms: a
prescribed mutation that turns out not to redden, a citation that does not resolve, a fixture
that passes both arms, or a self-contradiction between two tasks goes here **with its
measurement**, before the task that found it is committed.

### C1 — Task 0 came back NEGATIVE, and the mechanism splits in two

**`piece_priority(p, 7)` alone never writes the file.** Five probe runs, each in a one-off
container with two `lt.session`s on loopback and DHT/LSD/UPnP/NAT-PMP off. The piece arrives —
`have_piece` True, `file_progress[sub]` at the declared size, `total_wanted` widened by exactly
the sidecar's bytes — and the bytes land in libtorrent 2.0's **`.<infohash>.parts` part file**,
which nothing can read. The part file appears in the ADMIT arms and not in the NOADMIT arms, so it
is the discriminator:

```
aligned/padded ADMIT    SRT ON DISK = None (declared 32768) have_piece=[True] file_progress=32768
                        leech tree = ['.5c14a61...parts', 'Show.S01E01/E01.mkv']
aligned/padded NOADMIT   SRT ON DISK = None                 have_piece=[False] file_progress=0
                        leech tree = ['Show.S01E01/E01.mkv']
```

libtorrent routes pieces belonging to a priority-0 file into the part file and only moves them into
place when that file's priority rises above 0. **D1's mechanism was necessary and not sufficient.**

**Run 1 was VOID and is recorded as such.** The sidecar sorted to file index 0 and so occupied piece
0, which the separately-raised 25-piece playhead window also covered — so the NOADMIT arm admitted
it too and both arms agreed. Exactly the failure task 0's own falsifier exists to catch, caught by
it. Run 2 moved the sidecar under `Subs/` so it sorts after the video, took the window from the
video's own span, and asserted the two disjoint.

**The shared selector undoes a file-level admission, and tolerates a piece-level one.** This is the
interaction that decides the shape, and nothing in the design round found it, because it is only
reachable once you know admission must touch file priority:

```
[0] baseline                              file_prios=[7,0,0,0]  sub_piece=[0,0]
[A] file_priority(sub,1)+deadlines        file_prios=[7,0,1,0]  sub_piece=[1,1]  wanted +40960
[B] then prioritize_video_files' vector   file_prios=[7,0,0,0]  sub_piece=[0,0]  wanted back
[C] piece-level admission [7,7]  ->  after the same selector call  [7,7]
```

`prioritize_video_files`' vector is a pure function of the file set, so while nothing else changes
it, every ranged `GET /video` re-applies an **identical** list, which libtorrent does not recompute
from — and a piece-level admission survives. A **file-level** admission makes the next call a
*changed* list, which recomputes: the admission is undone and `_prioritize_window`'s raised window
goes with it. Measured on **unheld** pieces, which is the only valid instrument — runs 2 and 3 both
sampled already-held pieces, where libtorrent has already dropped the raised priority, and both
cells were void:

```
[Q2a] window 156..180 (25 pieces) any_already_held=False raised_to=[7]
[Q2b] after file_priority(sub,1): STILL-UNHELD window pieces now at [1]
```

**So the mechanism is two-phase, and the second phase is a flush, not an admission.** Admit by
piece; when the span is held, one `file_priority(idx, 1)` moves the held bytes into the save path
with **`redownloaded=0`**; then `file_priority(idx, 0)` puts it back. Measured, in that order:

```
[2] have_piece=[True]  srt=None  parts=['.3e9ecc1...parts']     (bytes still in the part file)
[3] file_priority(sub,1) AFTER the piece is held: srt=2048  redownloaded=0
[4] RE-ZERO file_priority(sub,0):                 srt=2048  total_wanted back to baseline
[E] the selector re-zeroes an ALREADY-WRITTEN sidecar: on_disk=40960   <- the bytes survive
```

**File-level retraction is safe where piece-level retraction is not** — the dossier's gate-4
catastrophe reproduces exactly, on an unpadded layout whose sidecar shares the video's last piece:

```
retract=file   residual 0       shared_piece_prio=[4]  progress=1.0000 state=seeding
retract=piece  residual -3048   shared_piece_prio=[0]  progress=0.4678 state=downloading
```

A negative residual is the torrent wanting *less* than its own video. The acceptance test is the
video's SHA-256 against the seed's, not a status line — both arms matched here only because this
probe had a willing seeder and the loop waited for every piece; in production that de-wanted piece
never arrives.

**What this changes.** D1 **still holds**: neither shared selector changes, `file_priority` is
called on one index and never through `prioritize_files`, and `test_skip_non_video.py:31` still
survives the stage unmodified. **D3's gate 4 survives with a sharper job**: it guards the
*budget-expiry* retraction, which must be piece-level and is therefore the dangerous one, while the
*success* retraction is file-level and needs no gate. When gate 4 refuses because a wanted video
file shares the piece, the bytes are already coming and the admission is a measured **no-op**.
**D4's span cap survives** — `total_wanted` rises by the file's bytes but the download cost is whole
pieces, so a pad-aligned 20-language tree is still the 1.6 GiB case. **D7 changes**: a held piece is
not a readable file, so readiness is `contiguous_available(...)["complete"]` **and** the file present
at its declared size — stage 7's gate 3 shape at `manager.py:1274-1285`. Tasks 1, 3, 7, 8 and 9 are
edited below; 2, 4, 5, 6 and 10–16 are untouched.

**Probes:** `…/scratchpad/s9probe/probe_admit.py` (run 1, void), `probe_admit2.py` (run 2),
`probe_flush.py` (run 3), `probe_retract.py` (run 4), `probe_race.py` (run 5).

### C2 — The mounted-tests baseline measures OTHER agents' uncommitted work, and task 1's mutation (c) is unrunnable where it is prescribed

Three measurements, from task 1.

**1. The 1441 baseline is right; a backend count taken while another task is in flight is not.**
Task 1's own first measurement said `1446 collected / 1446 passed` at what `git log` showed as
`8619e0f` with a clean `git status`. That number was wrong, and the reason is structural: the house
command mounts `backend/tests` from the **host working tree**, so it collects whatever test files
another agent has written but not yet committed. Task 2 committed five minutes later (`39cd25f`,
`test_subtitle_config.py` +5 tests, `test_content_guard_config.py` +0) and the arithmetic closes
exactly — `1453` collected with task 1 and task 2 both in, minus task 1's **7** and task 2's **5**,
is **1441**. The baked-image figure (`1437`, the same command without the `-v` mount) is a third
number again and belongs to whenever the image was last built; it is not a baseline either.

**So: `8619e0f` = 1441, and the tree after task 1 + task 2 = 1453 collected (1450 passed, 3
skipped).** Task 1 contributes 7 tests, 3 of which skip until their subject exists. `test:tv` 1388,
`npx vitest run` 2340 and `tsc` clean, unchanged — task 1 touches no frontend file. **Whoever takes
the next task: `git log` and `git status` do not tell you whether a sibling task's files are under
`backend/tests/`. `git status --short` naming an untracked test file you did not write is the only
warning you get, and `ls backend/tests` against `git ls-files` is the check.**

**2. Task 1's mutation (c) cannot be run in task 1.** It prescribes that "`list_sidecars(...)` and
`admit_sidecar_pieces(...)` complete" under the forbidding fake, but `list_sidecars` lands in task 3
and `admit_sidecar_pieces`/`flush_sidecar_file` in task 7, and task 1's own **Does not** forbids
adding an `app/` file. The gate ships written-to-C1's-shape and `skipif`-guarded on
`hasattr(TorrentManager, …)`, so it activates itself the moment task 7 lands; until then it reports
as **skipped with the task named**, which is the visible record that it has not run. All four of
(c)'s mutations were measured against **temporary stand-in** implementations inserted beside
`_deadline_pieces` and removed afterwards (`…/scratchpad/standin.py`, four variants): the correct
two-phase shape is accepted (gate green, not skipped), admission via `prioritize_files` reddens,
a flush with `file_priority(idx, 7)` reddens, and a flush that omits the trailing `(idx, 0)`
reddens. **Task 7 must re-run that gate unskipped** and fix the call signatures if its own differ.
The two per-module source gates (`subtitles/sidecars.py`, `api/subtitles.py`) ship skipped for the
same reason and were validated the same way: with temporary violating modules both parametrised
cases redden and the skips disappear; with the same modules clean, both pass.

Two sub-findings from the same run. The fake's `prioritize_files` raises a **`BaseException`**
subclass, because the stand-in copied the repo's own `except Exception: pass` idiom and swallowed
it; measured, the gate reddens either way, because the recorded-call assertion catches what the
swallowed raise does not — the two assertions are independently sufficient, which is why both are
kept. And the source-text gate must scan **code**, not file text: `app/subtitles/__init__.py`'s
docstring names all three forbidden calls in order to forbid them, so the scan strips comments and
docstrings via `ast.unparse` (the `legacy-target.test.ts:91-96` idiom, limit note included).
Measured both arms: docstring mentions green, the same names as executable code red.

**3. Mutation (a)'s "only instrument there is" is overstated.** The short-list mutation (build the
vector from `get_video_files()` output) reddens the `== [7, 0, 0, 0]` equality too, because a short
list is also a *different* list. Measured with the equality assertion temporarily removed: the
`len(applied) == ti.num_files()` assertion reddens on its own, so it is live rather than decorative
— but it is not the sole instrument, and a later task must not drop the equality on the strength of
that sentence.

### C3 — C2's baseline hazard recurred as a stale number, and task 6's reported count is 46 low

Found reviewing task 6. The task-6 report says "Baseline re-measured at task start: **1453**
collected (1450 passed, 3 skipped) with a clean `git status` — matches C2's figure", and derives
**1491** collected as the figure attributable to the task. Both are wrong, and the reason is the
one C2 warned about from the other side: 1453 is C2's own number for the tree after tasks 1 + 2,
and it was carried forward rather than re-measured. Three commits of task 1/2 review fixes and the
whole of **task 5 (53 tests)** landed in between.

Measured in isolated `git worktree`s, so no sibling's uncommitted work is in the figure:

```
e488660 (task 6's parent, task 5 in)          1499 collected
fbfb0eb (task 6)                              1537 collected / 1534 passed / 3 skipped
be88ee9 (task 4)                              1569 collected / 1566 passed / 3 skipped
baked image, no -v mount                      1437 collected   (unchanged since C2)
```

So **task 6 adds 38 and the suite after it is 1537, not 1491.** The report's "1453 + 38 + 60 = 1551
closes exactly" closes only because two errors cancel: the baseline is 46 low and task 4's
then-uncommitted snapshot was counted as 60 where its committed form collects **32**
(`test_subtitle_pairing.py` 14 + `test_subtitle_language.py` 18).

**The lesson C2 should have carried and now does: a baseline is a number you measure, in a
worktree at the parent commit, not a number you quote.** `git worktree add --detach <dir> <sha>`
plus `docker compose run --rm -v "$WT/backend/tests:/opt/freeflix/tests" -v
"$WT/backend/app:/opt/freeflix/app" backend python -m pytest --collect-only -q` is immune to every
sibling in the working tree, which `git status --short` alone is not — during this review the
shared tree was mutated by two other agents mid-measurement.

---

## What ships inert or absent, and what the television shows instead

Following stage 8's precedent: a rule that cannot be evaluated ships as a **visible row with effect NONE** rather than as code that looks enforced.

**Nothing already in the library gets subtitles, and the television says so.** Admission requires a live handle; `_refresh_active_torrents` evicts `finished` mid-session (`manager.py:469`) and `find_loadable_on_startup` never re-adds it (`database/models/torrents.py:119-123`, docstring at `:120-121`: "Paused/stopped/finished/seeding/error stay unloaded"). There is no re-add, no `force_recheck` and no backfill, and the file list is unenumerable anyway (D5). So `coverage: "unknown"`, and the cell reads **`Subtitles · unavailable`**. That is the permanent answer for every title this household has already downloaded — the biggest coverage limit in the stage, bigger than §7.5's acknowledged embedded-MKV gap, and §7.5 does not mention it.

**`.ass`/`.ssa` ship as a listed row with `convertible: false`.** The picker shows them as an **unselectable row** carrying the format, and OK on it is answered by the row's own reason rather than by silence. That is the stage-8 shape: a visible row with effect NONE. Zero captions for anime and most fansub output; §7.5's "ASS/SSA styling is dropped to plain text" is declined with grounds (D17).

**A non-UTF-8, non-cp1252 sidecar is refused, not served.** The VTT route answers 415 naming `encoding-unknown` and the picker row is unselectable with the reason. A Cyrillic or Greek library gets nothing until the owner sets `SUBTITLE_ENCODING`. That is a deliberate coverage trade and it belongs in the spec's §12 "Subtitle coverage disappoints — High" row rather than being discovered on the set.

**Cue position while the band is VISIBLE ships unsolved, and nothing in stage 9 pretends otherwise.** The scrim fade (D16) clears the normal state — the band is hidden for almost the whole film. But `.bs-player__bar` is `position: relative` with **no** `z-index` (`bigscreen.css:957-958`), so inside `.bs-player`'s `isolation: isolate` (`:933`) it sits in the positioned-descendant layer at `z-index: auto` and paints above both `z-index: -1` layers. The stylesheet measures its content at ~334px (`:899-900`). So for the ~5 s the band is up after a press, a cue may be behind the transport row. **The television's behaviour is: accept it, and record it.** Stage 9 ships no `line:` guess, no `::cue` rule and no restacking, because every candidate fix is a guess and the reading that would choose between them has not been taken. Reading **29b** is the one that scopes the work, and it belongs to stage 10.

This is the panel finding nobody in the dossier got right: three designs fade the scrim and call the collision solved, one declines both and ships the cell anyway. There are **two** occluders with two different fixes, and a single reading cannot separate them — which is why reading 29 is split below.

**The web player's CC button stays `aria-disabled`,** so `VideoPlayer.test.tsx:34-41` stays green and `VideoPlayer.tsx` is untouched. The cost is real and named in **Decisions taken on the user's behalf**: the web is the only devtools-bearing surface, and declining it means the converter's output is never seen in a browser with a console before the television sees it. Task 15's diag probe is the mitigation.

**`/files` stays video-filtered.** It has **three** production callers, not two — `(web)/streaming/[id]/page.tsx:67`, `_data/title.ts:608`, and the TV's own `watch/[id]/page.tsx:331` — so widening it is not a web-regression question but a constraint on the television's own episode resolution. On the web it would flip `isMultiFile` (`(web)/streaming/[id]/page.tsx:110`) on a movie-plus-sidecar, and where a sidecar's libtorrent index sits below its own video's it would make a `.srt` the default `effectiveFileIndex`.

**No test of the form "admitting a sidecar does not block the torrent."** It cannot fail. `validate_torrent_content` (`manager.py:1288-1303`) runs first (`:580-585`), builds its list from `ti.file_at(i).path/.size` and never from priorities; `classify_torrent_files` (`content_guard.py:28-61`) reads only path and size; and `test_content_guard_manager.py:46` already pins `_Handle([("movie.mkv", 2_000_000_000), ("subs.srt", 50_000)])` as allowed. Named here so nobody writes it.

**The `save_info_dict` repair is a named stage-7 follow-up, not a stage-9 task.** Its red test: build a synthetic torrent with `lt.create_torrent` + `set_piece_hashes`, add it to a loopback session with DHT/LSD/UPnP/NAT-PMP off, call `save_resume_data(lt.torrent_handle.save_info_dict)`, catch the alert, round-trip through `write_resume_data_buf` → `encode_resume_data` → `decode_resume_data` → `read_resume_data`, and assert `.ti is not None` and `.ti.num_files()` — a test that fails today. Plus a per-site source pin, because one behavioural arm exercises only one of the three save sites. It helps only blobs written afterwards and can never help an already-finished torrent, and it flips a shared four-gate resolver from always-None to sometimes-returning, which is a larger change than anything stage 9 makes. **Task 16 corrects the false docstring at `manager.py:1140-1143` and files the fix; it does not make it.**

---

## Task 0 — Measure whether a raised piece priority actually writes a deselected file's bytes — **DONE, answer NEGATIVE**

**Files:** none in the repo. Probe in the scratchpad, run as a one-off container.

**Run and recorded. The answer is NEGATIVE and the full measurement set is C1 in the Corrections
section above — read it before tasks 1, 3, 7, 8 or 9.** Five runs; run 1 was void by its own
falsifier and is recorded as such. The mechanism is two-phase: admit by piece (which survives the
shared selector), flush by one `file_priority(idx, 1)` once the span is held, then put the priority
back. The named fallback below was **not** taken, because a changed `prioritize_files` list is
exactly what the selector's next call undoes.

The whole backend half assumes that `piece_priority(p, 7)` on a piece wholly inside a priority-0 file causes libtorrent to **write that file**. The dossier's only direct evidence is circumstantial: `downloads/History Of The World Part I …/www.YTS.MX.jpg` is complete at 53,226 bytes on a torrent with no row in the `torrents` table, so its priorities were never measured. Measure it properly. Build a 3-file torrent (`E01.mkv` 8 MiB, `E01.en.srt` 2 KiB, `info.nfo` 1 KiB) over a complete seed directory; start **two** `lt.session`s in one process on loopback with DHT/LSD/UPnP/NAT-PMP off; seed from the complete directory and leech into an empty one with `prioritize_files([1, 0, 0])`; raise the srt's piece span to 7 with `set_piece_deadline(p, 0)`; wait for `have_piece`; print `os.path.getsize(leech/E01.en.srt)`, `file_progress()[srt]`, `total_wanted` before and after, and the surviving piece priorities of a separately raised 25-piece window. Re-run `scratchpad/s9/probe_pieces2.py` verbatim and paste [A]–[F] into task 16's Corrections section, including the **gate-4 retraction trap** on the `v1_only` arm.

**Does not:** run pytest, touch any repo file, use the running backend, or need external network. Does not measure pad-file prevalence in real releases — unmeasurable here (**What no test can settle**).

**Mutate.** The probe's own falsifier: run a second arm with the `piece_priority`/`set_piece_deadline` lines commented out. The srt must then be **absent**. If it is present in both arms the probe is measuring piece-sharing rather than admission, and the layout must be changed so the sidecar's span lies wholly inside itself before either result is believed.

**The fallback as written was wrong, and C1 says why.** It was "a changed `prioritize_files` list inside `prioritize_video_files` admitting only the one matching sidecar at 1, accepting one whole-torrent piece recompute per episode switch." Measured, that list is undone by the selector's very next call — `prioritize_video_files` runs on every ranged `GET /video` and rebuilds the vector as `[7 for video, 0 for everything else]` — so the admission would survive until the next chunk request and no longer. Tasks 3, 7, 8 and 9 are edited for the two-phase mechanism instead; 1 gains one gate; 2, 4, 5, 6 and 10–16 are untouched.

**Depends on:** nothing.

---

## Task 1 — The zero-touch gates, and the characterisation `prioritize_video_files` has never had

**Files:** `backend/tests/test_stage9_leaves_the_selectors_alone.py` (new), `backend/tests/test_prioritize_video_files_list.py` (new). No production change.

Nothing in the suite executes `prioritize_video_files`' priority loop. Seven files monkeypatch it away (`test_stream_force_start.py:24`, `test_streaming_head.py:53`, `test_first_chunk_precheck.py:136`, `test_async_stream_endpoint.py:29`, `test_streaming_endpoint_416.py:41` and `:102`, `test_prioritize_endpoint.py:26`, `test_stream_status_matrix.py:105`/`:128`/`:147`) and the one file that calls it for real feeds it `FakeInfo.num_files() → 0` (`test_per_torrent_conn_cap.py:5-7`, call at `:35`), so the loop body has **never run**. Pin the two properties this stage rests on, with a `_TI`/`_Handle`-shaped fake copied (not imported) from `test_skip_non_video.py:6-24` and extended with `file_progress`, `status().save_path`, `get_file_priorities`, `piece_priority` and `set_piece_deadline`.

Plus the zero-touch gates. **C1 changes the shape of one of them**: `file_priority` is now the flush mechanism, so a fake that raises on it would forbid the stage's own code. The gate instead is a fake whose `prioritize_files` **raises** and whose `file_priority` **records** `(index, priority)`, with the recorded set asserted to be exactly `{(sidecar_index, 1), (sidecar_index, 0)}` — one index, two priorities, in that order, and never 7. That is a stronger gate than a ban, because it pins the flush's shape as well as its blast radius. Then source-text gates that no file under `backend/app/subtitles/` names `prioritize_files`, `prioritize_video_files` or `file_priority(`, that the lister module names neither `piece_priority` nor `set_piece_deadline`, and that the list and VTT handlers name neither `prioritize_video_files` nor `force_start_for_stream`; and `git diff --quiet backend/tests/test_skip_non_video.py` in the task's done-check. Write the scan's limit into the file as `legacy-target.test.ts:91-96` does for its own: a substring scan cannot see `getattr(handle, 'piece_' + 'priority')`.

**Does not:** edit `test_skip_non_video.py` — not one character. Does not duplicate its `[1, 0, 0, 0]` assertion; a second witness to one rule is this repo's own documented anti-pattern. Does not add an `app/` file. Does not assert a hash of `manager.py`.

**Mutate.** Every test in `test_prioritize_video_files_list.py` first asserts the recorder is **non-empty**, because the house reflex is to stub this function and a stubbed fake records nothing while an `== []`-shaped assertion stays green. (a) Fixture `["E01.mkv", "E01.en.srt", "Setup.exe", "info.nfo"]` → `applied == [7, 0, 0, 0]` **and** `len(applied) == ti.num_files()`. Mutation: give subtitle extensions a non-zero priority → reddens, and the fixture discriminates "admit everything" from "admit subtitles" because it carries both a sidecar at index 1 and a non-video non-subtitle at index 3; a one-non-video fixture cannot. Mutation: build the list from `get_video_files()` output → the length assertion reddens, and that is the only instrument there is, because a short list silently re-admits the tail at libtorrent's default 4. (b) Call with `file_index=0` then `1` on a two-video fixture → the two applied lists are **equal**. Mutation: give the target 7 and the other videos 1 → reddens; this is the property that keeps the per-request call at `streaming.py:280` from recomputing piece priorities. (c) The forbidden-call fake: `list_sidecars(...)` and `admit_sidecar_pieces(...)` complete, and the `file_priority` recorder holds exactly `[(sub, 1), (sub, 0)]`. Mutation: implement admission as `handle.prioritize_files(vector)` → the fake raises → reddens. Mutation: flush with `file_priority(idx, 7)` instead of `1` → the recorded-set assertion reddens; 7 is `prioritize_video_files`' own video value and would put a 40 KB text file in competition with the playhead. Mutation: leave the priority at 1 instead of putting it back to 0 → reddens, and what it prevents is measured: the next selector call then sees a *changed* list, recomputes, and takes `_prioritize_window`'s raised window with it. (d) `settings.video_extensions` equals its 16-entry set verbatim. Mutation: add `.srt` → reddens here **and**, independently, at the pre-existing `test_video_mime_types.py:12`. (e) Mutation: give the sidecar a non-zero priority in `skip_non_video_files` → `test_skip_non_video.py:31` reddens; the existing test **is** the gate.

**Depends on:** nothing.

---

## Task 2 — The Settings fields

**Files:** `backend/app/config.py` (additive, after `:141`), `backend/.env.example` (after `:9`), `backend/tests/test_subtitle_config.py` (new), `backend/tests/test_content_guard_config.py`.

```python
subtitle_extensions: set[str] = {".srt", ".vtt", ".ass", ".ssa"}            # LISTED
subtitle_convertible_extensions: set[str] = {".srt", ".vtt"}               # CONVERTED
subtitle_max_bytes: int = 4_194_304
subtitle_admit_max_pieces: int = 4
subtitle_admit_budget_ms: int = 45_000
subtitle_encoding: Optional[str] = None
```

Two sets, per D17, each with its rationale in a comment, including why `.sub`/`.idx`/`.sup` are in neither. Documented in `backend/.env.example` in the same commented-JSON-array form as `BLOCKED_EXTENSIONS`/`VIDEO_EXTENSIONS` at `:8-9`, with a line saying a declared pydantic field is env-overridable the moment it exists (`extra='forbid'` applies only to **un**declared keys). The field lands before any `.env` key, per CLAUDE.md.

**Does not:** touch `video_extensions` or `blocked_extensions`. Does not add `SUBTITLE_EXTENSIONS` to any compose file. Does not add `.ass`/`.ssa` to the convertible set.

**Mutate.** (a) `subtitle_extensions` disjoint from `video_extensions` **and** from `blocked_extensions`, as two separate asserts. Mutation: add `.mkv` → the first reddens. Mutation: add `.bin` → the second reddens. **The second arm is currently unfalsifiable by any realistic mistake** — no subtitle extension is in `blocked_extensions` today — and is pinned for the day someone adds `.iso`-style entries; say so in the test. (b) Every member lowercase and dot-prefixed, joined into the existing union at `test_content_guard_config.py:23-26`. Mutation: write `.SRT` → reddens. (c) `{".sub", ".idx", ".sup"} & subtitle_extensions == set()`. Mutation: add `.sub` → reddens; this earns its place because those three are in **neither** existing set, so nothing else in the suite has an opinion. (d) `subtitle_convertible_extensions ⊆ subtitle_extensions`. Mutation: move `.ass` into the convertible set → **does not redden here**; it reddens at task 6's ASS-refusal row. State that in the test's comment so nobody reads this as the ASS guard. (e) A policy note: these are **settings** assertions, so a hostile `.env` defeats them; the request-time guard is the lister's own hard-coded listed set, tested in task 3.

**Depends on:** 1.

---

## Task 3 — The lister: live session only, readiness measured, emptiness unambiguous

**Files:** `backend/app/subtitles/__init__.py`, `backend/app/subtitles/sidecars.py` (new), `backend/app/torrent/manager.py` (one new method `list_sidecars`), `backend/tests/test_sidecar_lister.py` (new).

`list_sidecars(torrent_id) -> Tuple[str, List[Dict]]` returning `(coverage, entries)` where `coverage ∈ {"listed", "none", "unknown"}`. `"unknown"` with an empty list unless `torrent_id in self.active_torrents` **and** `handle.has_metadata()`. Enumerates `range(ti.num_files())`, skips pad files by `ti.files().file_flags(i) & lt.file_flags_t.flag_pad_file`, keeps extensions in `settings.subtitle_extensions`, carries the torrent's **own** `index`, and refuses any entry over `subtitle_max_bytes` or whose resolved path escapes `save_path` (D9). Per-entry `OSError` is caught and reported, never raised. **Readiness is two conjuncts, per C1**: `contiguous_available(torrent_id, idx, 0)["complete"]` **and** the file present in `save_path` at its declared size (D7). The second is not belt-and-braces — until the flush runs, a fully-held sidecar's bytes are in a `.<infohash>.parts` file and `open()` on its path raises `FileNotFoundError` while `contiguous_available` reports `complete`. `convertible` from `subtitle_convertible_extensions`. Rows ordered by torrent file index.

**Does not:** read resume data, call `_video_files_from_resume_data`, `get_completed_video_file_info` or `get_video_files`, or touch `self._resume_video_files` (`manager.py:107`) — whose fingerprint `(len(blob), hash(blob), save_path)` at `:1164` carries no predicate and whose eviction at `:1194-1195` is a whole-dict `.clear()` above 16 entries, so a predicate parameter there would serve the other caller's cached list and halve the depth protecting the Range hot path. Does not walk `save_path` — it stats the one path it already resolved, which is not a walk. Does not derive readiness from `os.path.getsize` **alone** (C1 withdrew the blanket ban and kept this half: a size match cannot see a tail libtorrent has not verified). Does not prioritise anything. Does not flush anything — the flush is task 7's, and a lister that flushed would make the GET mutating, which D2 forbids. Does not return `progress` or `downloaded`.

**Mutate.** (a) **Coverage discrimination**, three fixtures: live with sidecars → `"listed"`; live with none → `"none"`; the same DB row with `tid` absent from `active_torrents` → `"unknown"` with `[]`. Mutation: compute coverage from `len(entries) > 0` → the evicted row reddens. Mutation: return a bare list in the `get_video_files` shape → every row reddens. Mutation: compute it from `handle.has_metadata()` → the evicted row reddens, because there is no handle to ask. (b) **Index fidelity**: fake TI `[info.nfo, .pad/16320, E01.mkv, .pad/14336, Subs/E01.en.srt, Subs/E01.es.srt]` → exactly the two `.srt` entries at indices 4 and 5. Mutation: return the `enumerate()` position → 0 and 1 → reddens; a fixture whose sidecar is file 0 cannot discriminate this. (c) **Readiness is measured, and both conjuncts are pinned by their own fixture.** (c1) A fake whose `file_progress()[idx] >= size` but `have_piece(last_piece)` is False, with the file present on disk at its declared size → `ready: false`. Mutation: replace `contiguous_available(...)["complete"]` with `file_progress()[idx] >= size` → reddens. Mutation: hard-code `ready: true` (the `_video_files_from_resume_data` shape at `:1186-1187`) → reddens. **A fixture whose `have_piece` is True cannot catch either.** (c2) **The part-file row, which is C1's whole finding**: a fake reporting `complete` with the sidecar's path **absent** from `save_path` → `ready: false`. Mutation: drop the on-disk conjunct → reddens, and what it prevents is a `<track>` spending its one and only load on a path that does not exist. (c3) The same with the file present but **short** of its declared size → `ready: false`. Mutation: test only `os.path.exists` → reddens. **Three fixtures, because each conjunct has a mutation the other two cannot see.** (d) **Extension filter at request time**: a fixture carrying `.ass`, `.sub`, `.exe`, `.nfo` and a `.pad/16320` entry, with `settings.subtitle_extensions` monkeypatched to include `.exe` → the `.exe` is still absent. Mutation: filter on `settings.subtitle_extensions` alone, dropping the hard-coded listed set → reddens. **Do not prescribe a separate pad-file assertion**: a pad carries no subtitle extension, so the extension filter excludes it incidentally and "drop the `flag_pad_file` check" is a dead mutation. (e) **Containment**: a crafted `fi.path` of `../../etc/passwd.srt` → absent. Mutation: drop the `resolve()` + parents assertion → reddens. (f) **Memo isolation**, in **one** test: ask `get_completed_video_file_info(tid)` then `list_sidecars(tid)` for the same tid; the second answer carries subtitle extensions. Mutation: route the new reader through `_resume_video_files` → reddens. Two separate tests cannot discriminate it — `test_finished_torrent_streamable.py:164` pops the memo per test.

**Depends on:** 2.

---

## Task 4 — Pairing and language, pure

**Files:** `backend/app/subtitles/naming.py` (new), `backend/tests/test_subtitle_pairing.py` (new), `backend/tests/test_subtitle_language.py` (new).

`pair(rel_path, video_files) -> (video_index | None, pair_source)` over the five rungs of D20, and `guess_language(rel_path, video_stem) -> (lang | None, label, flags)` per D21. Plus the per-language dedup and the `(matched by folder)` / `(matched by episode number)` label suffixes. No I/O, no session, no persistence.

**Does not:** modify `providers/episodes.py` or `parse_episode`. Does not read or write `precomputed_episodes`. Does not include the torrent root in rung 3. Does not implement rung 2 with `parse_episode`. Does not drop an unpairable or unguessable sidecar.

**Mutate.** Every fixture carries a provenance note (**What no test can settle**). (a) `Pack.S01/Subs/Pack.S01E05/2_English.srt` against videos E05 and E06 → E05, `pair_source == 'dir'`. Mutation: pair from `Path(p).name` the way `manager.py:1094` does → reddens. **A fixture named `Pack.S01E05.en.srt` cannot discriminate it** — the episode is in both places. (b) **The measured trap**: root `Breaking.Bad.S01E01-07.1080p.BluRay/`, sidecar `Subs/Breaking.Bad.S01E04/3_English.srt` → episode (1, 4). Mutation: include the root segment → (1, 1) → reddens. The fixture discriminates because the root parses to a *different* episode than the truth. (c) **Rung order**: `Pack/Pack.S01E03.en.srt` → `pair_source == 'stem'`. Mutation: skip the stem rung → still (1,3) via parse, but `pair_source == 'parse'` → reddens. **Without the exposed rung this mutation cannot be discriminated at all.** (d) Single-video torrent with `Movie.2020.mkv` + `English.srt` → `'single'`; the sidecar's stem must **differ** from the video's, or rungs 1 and 3 agree and deleting either is green. (e) Two-video pack + `Subs/2_English.srt` with no directory hint → `(None, 'none')`. Mutation: fall back to `max(files, key=size)` the way `manager.py:1134`/`:1266` do → reddens. (f) Language, four rows: `Movie.French.srt` → fr; `Children.srt`, `Golden.Years.srt`, `Kingsman.srt` → None. Mutation: `'en' in name.lower()` → all four redden. **Do not write `Movie.Spanish.es.srt`** — both branches agree, so deleting either is green. (g) `Subs/2_English.srt` → `en` **and label `English`**; asserting the label, not just the code, is what discriminates "don't strip the leading index". (h) `Movie.hi.srt` → None. Mutation: add `hi` to the code table → reddens. (i) Three English sidecars → one entry. Mutation: drop the dedup → reddens. (j) Labels are **pairwise distinct** across every `pair_source`. Mutation: collapse `dir` and `parse` onto one suffix → reddens.

**Depends on:** 3.

---

## Task 5 — The decode ladder

**Files:** `backend/app/subtitles/decode.py` (new), `backend/tests/test_subtitle_decode.py` (new).

`decode_subtitle(raw: bytes) -> Tuple[Optional[str], Optional[str]]` → `(text, refusal_reason)`, per D18, with the density gate's limit written beside it.

**Does not:** import `charset_normalizer`. Does not fall back to latin-1. Does not use `errors='replace'`. Does not write a bespoke detector. Adds no dependency, so no image rebuild.

**Mutate.** **Every fixture is a byte literal in the test module**, never a file under `backend/tests/data/`: git marks a cp1251 file binary, editors re-save it, and the bytes are the whole point. Expected text is written as `\uXXXX` escapes in the source and the assertion is **text equality, never the detected codec name** — German cp1252 is indistinguishable from cp1250 on every letter in a realistic sample, so a name assertion reddens on a correct answer. (a) `b"1\r\n00:00:01,000 --> 00:00:02,000\r\nCaf\xe9\r\n"` → text contains `Caf\u00e9`. Mutation: drop the cp1252 rung → reddens. **A `str` fixture cannot discriminate any decode mutation** — it is UTF-8 by construction. (b) A UTF-8 BOM fixture → the first character is not `\ufeff`. Mutation: use `utf-8` instead of `utf-8-sig` → reddens. (c) `"1\r\n00:00:01,000 --> …".encode("utf-16-le")` → refused. Mutation: drop the `"\x00"` conjunct → the bytes decode as valid UTF-8 and reddens. (d) A **~20-line** cp1251 fixture → refused with `encoding-unknown`. Mutation: delete the density gate → cp1252 decodes it silently and reddens. Twenty lines because the gate must aggregate over a **file**: a single Polish line measures 0.60 and the same file measures 0.157. (e) The same cp1252 fixture with `subtitle_encoding='cp1251'` → decoded as cp1251. (f) `"\ufffd" not in text` over every fixture. Mutation: add `errors='replace'` to any rung → reddens; this test exists because that one change makes every other mutation in the file unfalsifiable.

**Depends on:** 2.

---

## Task 6 — The converter

**Files:** `backend/app/subtitles/vtt.py` (new), `backend/tests/test_subtitle_vtt.py` (new).

`to_webvtt(text, fmt) -> ConvertResult(text, cue_count, reason)`, per D19. `.ass`/`.ssa` → `reason="unsupported-format"`, `cue_count=0`. `.vtt` reparsed and re-emitted.

**Does not:** use ffmpeg. Does not convert ASS/SSA. Does not strip `<font …>` or DVD-rip cue settings. Does not emit a `line:` cue setting. Does not lean on any measured Chromium 155 leniency. Does not cache. Does not touch `get_mime_type` or `VIDEO_MIME_TYPES`.

**Mutate.** **Every expected VTT is typed by hand and never captured from a run** — `backend/tests/test_release_corpus.py:35` already records that a corpus produced by the code under test "proves only that the parser is deterministic." Property assertions over every fixture, because nothing in this repo can run a WebVTT parser (D19, **What no test can settle**): first line exactly `WEBVTT`; every timing line matches `^(?:\d{2,}:)?[0-5]\d:[0-5]\d\.\d{3} --> (?:\d{2,}:)?[0-5]\d:[0-5]\d\.\d{3}$`; no comma in a timing line; no payload line contains `-->`; `cue_count > 0`. Mutations: emit the SRT comma → the regex and the comma assertion redden, and that is the only instrument there is. Remove the **seconds** carry → the `00:00:75,000` row reddens. Remove the **minutes** carry → the **separate** `00:75:01,000` row reddens; one fixture cannot discriminate both. Leave a payload `-->` unescaped → reddens, and this is a data-loss guard, not hygiene: measured, the payload is swallowed and the cue renders blank with `text === ""`, so it **passes** a cue-count check. Byte-exact rows for one hand-typed 3-cue SRT (CRLF, numeric ids, an `<i>`, an `&`, a bare `<`, an accented character) and one `.vtt` with comma timings; mutation: two spaces around the arrow → reddens. Escaping, two rows opposite ways: `5 < 6 and <i>7</i> & 8` → `5 &lt; 6 and <i>7</i> &amp; 8`. Mutation: `html.escape()` the payload → the `<i>` row reddens; mutation: escape nothing → the `&lt;`/`&amp;` row reddens; **the fixture must carry both or neither mutation discriminates.** `{\an8}Top` → `Top`; mutation: drop the strip → reddens. A payload that is only `{\an8}` → cue dropped. `end <= start` → dropped; assert the exact `cue_count`. Four refusal fixtures with four reasons (empty, whitespace-only, an ASS body, a 6 MB body) → mutation: return `"WEBVTT\n\n"` on zero cues → all four redden, **and this is the most important mutation in the stage**: measured, a raw empty or header-less file fires a real `error` event while `WEBVTT\n` loads at `readyState 2` with 0 cues and **no event at all**, so wrapping converts a loud failure into an unobservable one. `.ass` with `fmt=".ass"` → `reason="unsupported-format"`; mutation: route it through the SRT parser → `cue_count 0, reason None`, i.e. a header-only success → the reason assertion reddens. **Forbidden as a success criterion anywhere in this file: "200 and the body starts with WEBVTT."**

**Depends on:** 5.

---

## Task 7 — Piece admission, the flush, gate 4, and the two retraction exits

**Files:** `backend/app/torrent/manager.py` (new `admit_sidecar_pieces`, `flush_sidecar_file` and `retract_sidecar_pieces`, beside `_deadline_pieces` at `:1929`), `backend/tests/test_sidecar_admission.py` (new).

**Read C1 first.** This task is the one the measurement changed most: admission and the flush are
separate calls on separate mechanisms, and the two exits are different calls with different safety
properties.

**`admit_sidecar_pieces`** — five gates, per D3/D4: the torrent is in `active_torrents` and has metadata; the sidecar resolves to a real libtorrent index from **metadata**; its current file priority is 0; **every byte of every piece to be raised belongs to files at priority 0, pads excluded**, from `ti.map_file`/file offsets plus `handle.get_file_priorities()` (zero occurrences in `backend/app` today); and the span is ≤ `subtitle_admit_max_pieces`. The only calls are `piece_priority(p, 7)` + `set_piece_deadline(p, 0)` for pieces not already held. `first = fi.offset // ti.piece_length()`, `last = (fi.offset + fi.size - 1) // ti.piece_length()` — integer `//`, never `int(a/b)`, matching `contiguous_available`'s own note at `:1686-1688` and its non-zero-offset warning at `:1681-1683`. Each libtorrent call individually guarded, copying `_deadline_pieces`' idiom at `:1933-1939`. Idempotent; no-op off session.

**`flush_sidecar_file`** — the phase C1 added. Preconditions: the span is held (`have_piece` for every piece) **and** the file's current priority is 0. Then exactly `file_priority(idx, 1)`, a bounded wait for the path to appear at its declared size, then `file_priority(idx, 0)`. Never 7. Measured: `redownloaded=0`, the file lands at its declared size, and the written bytes survive both the re-zero and every later `prioritize_video_files` call. Both calls wipe `_prioritize_window`'s raised window — that is the price, it is transient because the window is re-asserted per chunk from `manager.py:1557`/`:1574`/`:1589`, and it is why the flush happens **once**, after the bytes are already held, rather than at admission time.

**`retract_sidecar_pieces`** — two exits, and only one of them is dangerous. On **success** the flush already restored the file priority to 0, so retraction is `reset_piece_deadline(p)` over the span and nothing else. On **budget expiry** the span is not held, so there is nothing to flush and the admission must be withdrawn or it holds the torrent below 100% forever: `reset_piece_deadline(p)` + `piece_priority(p, 0)`, **gate 4 re-checked** and never assumed from the admission. Driven by an `asyncio` task the POST handler creates with a module registry keyed `(torrent_id, index)`.

**Does not:** call `prioritize_files`, `prioritize_video_files`, `set_sequential_download`, `force_start_for_stream` or `set_max_connections`. Does not call `file_priority` anywhere but `flush_sidecar_file`, and there only with 1 then 0. Does not call `piece_priority(p, 0)` anywhere but the budget-expiry exit. Does not write a DB row. Does not edit the status loop, `_prioritize_window`, `_deadline_pieces` or `_prioritize_streaming_pieces`. Does not block the request — the POST returns 202 and the waiting happens in the task.

**Mutate.** A fake recording `piece_priority`, `set_piece_deadline`, `prioritize_files`, `file_priority` and `reset_piece_deadline`, over a fake `ti` whose sidecar sits at a **non-zero** offset mid-torrent. (a) The computed span is raised to 7 with a deadline, the `prioritize_files` recorder is **empty**, and the `file_priority` recorder is **empty at admission time**. Mutation: admit with `handle.file_priority(idx, 1)` → reddens, and C1 measured what it costs: the selector's next call undoes it and takes the playhead's window with it. Mutation: implement as `handle.prioritize_files(vector)` → reddens. Mutation: drop the `fi.offset` term → the wrong span → reddens; a sidecar-at-offset-0 fixture cannot discriminate it. (a2) **The flush, which is C1's own row**: with the span held, `flush_sidecar_file` records exactly `[(idx, 1), (idx, 0)]` in that order and raises no piece priority. Mutation: flush with 7 → reddens. Mutation: omit the trailing `(idx, 0)` → reddens. Mutation: call the flush before the span is held → the precondition row reddens, and what it prevents is a file-level admission wearing a flush's name. (b) **Gate 4**: a fixture on the unpadded layout where the sidecar shares a piece with a video file's 1000-byte tail → **nothing raised**. Mutation: drop gate 4 → reddens, and what it prevents is measured: retracting such a piece drove `total_wanted` below baseline and reported the torrent `finished` at 100% with a piece the film needs never downloaded. (c) The span cap: a 40 MB file named `.srt` spanning >4 pieces → refused. Mutation: remove the cap → reddens; a kilobyte fixture cannot. (d) `have_piece` True for one piece of two → only the other raised. Mutation: drop the guard → reddens. (e) `tid` absent from `active_torrents` → returns 0, raises nothing. Mutation: index `active_torrents` directly → KeyError → reddens. (f) **The two exits are different calls.** (f1) Success exit, span held: `reset_piece_deadline` is recorded for every piece and `piece_priority(p, 0)` is recorded for **none**. Mutation: use the budget-expiry call on the success path → reddens, and C1 measured the consequence on a shared piece: residual **-3048**, the shared piece de-wanted, and the torrent falling back from `seeding`/100% to `downloading`/46.78%. (f2) Budget exit, span not held: `piece_priority(p, 0)` **is** recorded, and gate 4 is re-checked first — call it again after the file's priority has become 7 underneath and the second lowers nothing. Mutation: drop the re-check → reddens; reachable in production because `_prioritize_window`'s relax sets `piece_priority(p, 1)` at `:1963`. (f3) Both exits are idempotent: call each twice. **One retraction test cannot cover this** — the two paths differ in exactly the call that is unsafe. (g) The budget registry: two admissions for one `(tid, index)` create one task. Mutation: drop the registry → reddens. **Not prescribed:** an `int(a/b)` vs `//` mutation — the two agree at every realistic offset and would need a fixture above 2^53, the shape stage 7 recorded. The integer form carries its reason in a comment instead.

**Depends on:** 3. (Task 0 is done — C1.)

---

## Task 8 — The list endpoint and the POST

**Files:** `backend/app/api/subtitles.py` (new), `backend/app/main.py` (one additive `include_router`), `backend/app/models.py` (new `SubtitleTrack`, `SubtitleList`, beside `VideoFile` at `:287-297`), `backend/tests/test_subtitles_list.py` (new).

`GET /{torrent_id}/subtitles?file_index=N` → `{torrent_id, state, coverage, source, paired_to, subtitles[]}`, where each entry is `{index, video_index, pair_source, season, episode, lang, label, flags[], format, size, ready, convertible, reason, url}`. 404 **only** when `get_torrent_status(torrent_id)` is falsy — it resolves from the DB (`manager.py:910-917`), so it answers for an evicted torrent — or the row carries `block_reason`. `Cache-Control: no-store`.

`POST /{torrent_id}/subtitles/{index}/fetch` → `202 {admitted, budget_ms}` / `409 {reason}` / 404. The only mutating route (D2). It creates task 7's asyncio task — admit, wait for the span, flush, retract — and returns immediately; the television learns the outcome by polling the list, never from this response. **`admitted: 0` is a success, not a refusal**, and it is the gate-4 no-op case C1 measured: the sidecar shares a piece with a wanted video file, so its bytes are already coming and there was nothing to raise.

The router is included under the existing `{api_v1_str}/streaming` prefix with the existing `STREAM_GATED` (`main.py:91`), so the bodiless 401 is inherited rather than invented (D11). Starlette matches in registration order and both new paths require a literal `subtitles` second segment, so `/{torrent_id}/files` (`streaming.py:481`) and `/{torrent_id}/video` cannot be shadowed — route ordering is a non-issue and none of `head_video`'s registration ceremony (`streaming.py:217-221`) earns anything here.

**Does not:** edit `api/streaming.py`. Does not register a `@router.head` — FastAPI never auto-adds HEAD (`streaming.py:207-215`), so `HEAD /subtitles` is a 405; write that into the route's docstring, because `classify.ts` is HEAD-only and someone will try, and in any case `classifyStatus` maps every 2xx to `{kind:'decode'}` (`classify.ts:118`), a sentence about a video decoder. Does not extend `_BARE_422_PATHS`. Does not call `get_mime_type` or extend `VIDEO_MIME_TYPES`. Does not admit, flush or retract anything from the GET. Does not block on the admission — a POST that waited for the span would hold a request open for up to `subtitle_admit_budget_ms`.

**Mutate.** (a) Three coverage rows, one fixture each: live with sidecars → `"listed"`; live with none → `"none"` and `[]`; evicted → `"unknown"` and `[]`. Mutation: 404 on an empty list → the `"none"` row reddens, and the consequence is the television saying "The box doesn't recognise this title." (`title.ts:488`) about a release that ships none. Mutation: return a bare array → every row reddens. (b) A `block_reason` row → 404. Mutation: drop the gate → reddens; one such row (`t-block-1`) is live in the dev DB. (c) `?file_index=N` on a four-episode pack filters to that episode's sidecars; an index naming a non-video file and an out-of-range index are refused rather than silently unfiltered. Mutation: ignore the parameter → reddens. (d) **A spy over `prioritize_video_files` and `force_start_for_stream` asserts neither was called across a list round trip**, plus the task-1 source gate. Both arms: the spy is falsifiable where a "no DB write" assertion is not, and the source gate catches what the spy's monkeypatch target cannot. Mutation: add either call → both redden. (e) An `.ass` entry is **listed** with `format: "ass"`, `convertible: false`. Mutation: omit non-convertible formats → reddens; silence about a file that exists is a lie, and the picker's label depends on knowing the format. (f) No entry carries a `mime_type`. Mutation: copy `/files`' `mime_type=get_mime_type(f["name"])` (`streaming.py:497`) → reddens; measured, that tells the TV an `.ass` sidecar is AAC audio. (g) The POST's matrix: 202 on admission; **202 with `admitted: 0` for the gate-4 no-op**; 409 per refused gate with its reason named; 404 for an unknown index. Mutation: 202 for a refused gate → the matching row reddens. Mutation: 409 for the gate-4 no-op → reddens, and the consequence is the television refusing a sidecar that was already on its way. (g2) The POST returns before the span is held: with a fake whose `have_piece` never becomes True, the response arrives and the registry holds one task. Mutation: await the admission inside the handler → the response-time row reddens. (h) A 422 row: a non-integer index returns FastAPI's default `{"detail": [...]}`. Mutation: add the path to `_BARE_422_PATHS` (`main.py:211-213`) → reddens, which pins the **decision** rather than leaving it an omission.

**Depends on:** 4, 7.

---

## Task 9 — The WebVTT endpoint

**Files:** `backend/app/api/subtitles.py` (additive), `backend/tests/test_subtitles_vtt_route.py` (new).

`GET /{torrent_id}/subtitles/{index}`. Resolution **only** through the lister (D9). Matrix: 200 `text/vtt; charset=utf-8` + `Cache-Control: no-store` when ready and `cue_count >= 1`; **503** + `Retry-After: 2` + empty body when resolvable but measured incomplete — the shape `streaming.py:286-292` already chose over 416 because "416 here would tell `<video>` to stop for good"; **415** naming the reason for unconvertible by extension, by size, by zero cues or by an undecodable body; 404 for an unknown torrent, an index the lister did not produce, a path escaping `save_path`, or `coverage != "listed"`; 422 FastAPI default for a non-integer index; 401 bodiless, inherited.

**Does not:** range-serve, stream, wait for pieces, prioritise, cache to disk or memoise. Does not hard-code an extension, size cap or path rule of its own. Does not fall back to an empty VTT. Does not read a file the lister did not return.

**Mutate.** (a) `response.headers['content-type'] == 'text/vtt; charset=utf-8'`. Mutation: serve `text/plain` → reddens, and **no body assertion can see it**. Mutation: route through `get_mime_type` → `.srt` yields `text/plain` on the container's table → reddens. (b) `Cache-Control: no-store`. Mutation: copy `avatars.py:85`'s `public, max-age=31536000, immutable` → reddens; a partial and a complete `.srt` live at the same URL, and that one line is also `public` on a session-gated resource. (c) **Path containment**: a crafted `fi.path` of `../../../etc/passwd.srt` → 404, no read attempted. Mutation: drop the `resolve()`/parents assert → reddens; a well-formed fixture cannot catch it. (d) Refusals, one fixture each: not-ready → 503 with `Retry-After: 2` and an empty body; a **video** file's index → 404; out of range → 404; an `.ass` index → 415 naming the format. Mutation: resolve the index independently of the lister → the video-index and `.ass` rows redden. Mutation: 200 with `WEBVTT\n\n` for the not-ready case → the status and cue-count rows redden. Mutation: 416 instead of 503 → reddens. (d2) **The part-file row, from C1**: a fixture whose lister entry is `ready: true` but whose file is absent from `save_path` — the state a held-but-unflushed sidecar is in, and the state a stale lister answer leaves behind — → **503**, not a 500 and not a 200 with an empty body. Mutation: trust `ready` and `open()` the path → the error middleware's `{"detail": "Internal server error", …}` → reddens. (e) **Index space**, two arms: index 4 (the sidecar) → 200; index 0 (its list position) → 404. Mutation: resolve as `subs[index]` → both redden; **the 200-only arm passes whenever the two numbers coincide.** (f) The 200 body asserts `cue_count` and the **text** of a cue containing `<`, `&` and an accented character — never status plus a `WEBVTT` prefix. (g) A fixture whose file is missing on disk → 404, not the `{"detail": "Internal server error", "error": str(e)}` the error middleware would produce. Mutation: drop the `OSError` handling → reddens; the dev DB holds a `seeding`/100 row whose `save_path` does not exist.

**Depends on:** 6, 8.

---

## Task 10 — The scrim fades with the band

**Files:** `frontend/public/bigscreen.css`, `frontend/src/app/(bigscreen)/bigscreen/watch/[id]/page.tsx` (`:990`), `frontend/src/app/(bigscreen)/_player/playerCss.test.tsx`, `frontend/src/app/(bigscreen)/bigscreen/watch/[id]/page.test.tsx`.

Per D16: `transition: opacity 180ms cubic-bezier(0.4, 0, 0.2, 1)` on `.bs-player__scrim` and a new `.bs-player__scrim--hidden { opacity: 0 }`, toggled by the same `visible` that drives `.bs-player__bar--hidden` at `page.tsx:997`. Add the class to `playerCss.test.tsx`'s route-written list (`:79-89`). Update the COMBINING comment at `bigscreen.css:920-921`.

**Does not:** unmount the scrim, change the visible state's appearance, change the scrim's height or gradient, add a `::cue` rule, add a colour token, or add any GPU-expensive construct. Does not touch `.bs-player__bar`.

**Mutate.** (a) **Both directions, in one file**: `visible=false` → the scrim carries `bs-player__scrim--hidden`; `visible=true` → it does not. Mutation: drop the conditional → the hidden row reddens. Mutation: apply the class unconditionally → the visible row reddens. **Asserting one direction leaves the other mutation green.** (b) Mutation: toggle on `playing` instead of `visible` → the coupling row reddens. (c) `playerCss.test.tsx`'s `rule('.bs-player__scrim--hidden')` matches `/opacity:\s*0/` and **nothing else**, mirroring the existing `:99-109`. Mutation: implement with `display: none` → reddens; `display:none`/`visibility`/`inert` all blur the focused control and the grid's reconcile never re-runs (`bigscreen.css:901-905`). (d) Mutation: rename the class in the stylesheet only → the `hasRule` catch-all (`:36`, used at `:88`) reddens; that row exists precisely because jsdom computes nothing from a linked sheet. (e) `npm run test:tv` unchanged. Mutation: implement the fade with `filter: blur(0)` → `legacy-target.test.ts:81`'s blunt `'blur('` catch-all reddens.

**Depends on:** nothing.

---

## Task 11 — `getSubtitles`, and the TV data module

**Files:** `frontend/src/services/streaming.ts`, `frontend/src/types/index.ts`, `frontend/src/app/(bigscreen)/_data/subtitles.ts` (new), `frontend/src/services/streaming.subtitles.test.ts` (new), `frontend/src/app/(bigscreen)/_data/subtitles.test.ts` (new).

`getSubtitles(torrentId, fileIndex, { allow401 })` and `fetchSubtitle(torrentId, index)` in the service, passing `{ __allow401: true }` exactly as `saveProgress` does (`streaming.ts:73-77`, `:86`). Without it, a mid-film 401 hard-navigates to `/bigscreen/pair` from inside the interceptor's own rejection handler (`api-client.ts:64-79`, called at `:136` before `Promise.reject` at `:145`) behind a module-scoped `redirecting` flag never reset (`:35`). A subtitle fetch is never worth evicting a viewer from a film. `_data/subtitles.ts` holds the pure helpers — `subtitleTrackSrc`, `offerable`, `cellLabel`, `pickerRows`, `pickerRowCounts` — and the bounded poll.

**Does not** live under `_player/`: `engineContract.test.ts:220-221` bans `@/services/streaming` and `@/services/api-client` there, and `playerSources()` (`:53-57`) is a **flat** `readdirSync`, so a subdirectory under `_player/` would EISDIR the whole suite. Does not reuse `classify.ts`. Does not poll when nothing is chosen, and does not poll forever.

**Mutate.** (a) The service test swaps `api.defaults.adapter` so the **real** interceptors run, and does **not** `vi.mock('./api-client')` — mocking the client closes the service hole and leaves the interceptor hole wide open, which is the hole this file exists for; the nearer precedent is `_data/useWatchProgress.allow401.test.tsx`, which carries no `vi.mock` at all and documents the `redirecting` flag and the full `window.location` stub axios's `isURLSameOrigin` needs. Two arms: a 401 **with** `__allow401` → `window.location.replace` was not called and the promise rejects to the caller; **without** it → `replace` was called with `/bigscreen/pair`. Mutation: drop `__allow401` → the first arm reddens. Both arms, because neither alone discriminates. (b) The URL is pinned exactly with `toBe`. Mutation: `/subtitle/` → reddens. **Never `toContain('/subtitles/')`** — every index satisfies it, so the index mutation cannot fail. (c) A contract test that `_data/subtitles.ts` imports neither service directly. Mutation: add the import → reddens. (d) `cache: 'no-store'` on the raw fetch (`classify.ts:40-41`: a cached 200 is "the one answer that must never be believed"). Mutation: drop it → reddens. (e) The poll stops on `ready`, on `coverage: "none"`, on `coverage: "unknown"` and on an error — **four arms**, assert the call count stops growing. Mutation: poll on `"unknown"` → that arm reddens; one `ready` arm cannot discriminate the other three. (f) `pickerRowCounts` is pure and densely tested: 0 offerable → `[1]`; 1 → `[2]`; 3 → `[3,1]`; 20 → seven rows; the sum is always `offerable + 1`. Mutation: off-by-one in the chunking → the sum row reddens.

**Depends on:** 8.

---

## Task 12 — The unconditional transport cell

**Files:** `frontend/src/app/(bigscreen)/_player/TransportBar.tsx`, `frontend/src/app/(bigscreen)/_player/TransportBar.test.tsx` (additive block), `frontend/src/app/(bigscreen)/bigscreen/watch/[id]/page.tsx`, `.../page.test.tsx` (additive block).

Per D12: `'subtitles'` joins `TransportCellId` (`:43`) and `TRANSPORT_CELLS` (`:75-81`) **between `forward60` and `stop`**; `TWIN_CELL` (`:111`) gains `subtitles: 'subtitles'`; a new **optional** `subtitles?: SubtitleCellView` prop renders an `aria-hidden` `.bs-player__commit` sub-line plus `data-subtitles={stateId}`. `labelFor`'s signature is unchanged.

**Does not:** make the cell conditional. Does not append after `RETRY_CELL`. Does not widen `labelFor`'s `state` (which would break its four call sites at `TransportBar.test.tsx:98, 140, 209, 215`). Does not make the prop required (which would break six existing renders). Does not add an option to `transportCells`/`transportCellCount`. Does not add a `MEDIA_TWINS` entry — reading 34 decides that. Does not add a CSS class. Does not touch `messageFor`. Does not add `aria-disabled` anywhere.

**Mutate.** (a) `transportCells({retry:false})` contains `'subtitles'`; `transportCellCount({retry:false}) === 6`; the rendered cell's accessible name is **exactly `'Subtitles'`**. Mutation: drop `aria-hidden` from the sub-line → the **existing** `TransportBar.test.tsx:98` and `:140` redden, because both query by exact name. (b) Retry is still last, by **both** witnesses: `transportCells({retry:true}).at(-1)?.id` (`:174`) and the route's DOM order (`page.test.tsx:976-977`). Mutation: append after `RETRY_CELL` → both redden. (c) The existing `TWIN_CELL` walk at `:159-162` requires the cell to be rendered. Mutation: make the cell conditional on a resolved list → reddens **independently of the focus argument**. (d) **The focus row**: render with the list unresolved, focus the last cell, resolve the list, then assert `journeys.test.tsx:918-919`'s invariant — `ring()` has length 1 and `ring()[0] === document.activeElement` — and that the rendered button count equals `transportCellCount({retry})` with `retry` both ways. Mutation: make the cell conditional and let it appear while Retry is rendered → reddens. (e) The eight cell-state labels are **pairwise distinct** and each ≤ 22 characters. Mutation: collapse `none` and `unavailable` → reddens, and the consequence is "this release has no subtitles" and "the box cannot see this download's files" becoming one sentence. Mutation: interpolate a full language name → the length row reddens; the row is `flex-wrap: nowrap` (`bigscreen.css:968`) and the width was measured on a macOS font stack, never on the set (reading 33). (f) **The band still auto-hides** with subtitles on, while fetching, and when unavailable. Mutation: route the subtitle state into `message` (`page.tsx:825`) → the two pre-existing auto-hide rows redden. **This is the one mutation in the stage with a measured precedent**: stage 8 recorded that hard-coding that line reddened exactly those two rows.

**Depends on:** 11.

---

## Task 13 — Exactly one `<track>`, and the seventh divergence

**Files:** `frontend/src/app/(bigscreen)/bigscreen/watch/[id]/page.tsx` (the `<video>` at `:958-989`), `frontend/src/app/(bigscreen)/_player/engineContract.test.ts`, `.../page.track.test.tsx` (new), `frontend/src/app/(bigscreen)/noCrossOrigin.test.ts` (new).

Per D14/D15: the self-closing `<video>` becomes a container with **at most one** `<track>` child, `key={chosen.index}`, `default`, `src={subtitleTrackSrc(torrentId, chosen.index)}`, `label`, and either `kind="subtitles" srcLang={lang}` or `kind="captions"` with **no** `srclang`; mounted only when `chosen && chosen.ready && chosen.convertible && recovery.kind !== 'reloading'`; `onErrorCapture` sets the cell to `unreadable`. Plus the seventh entry in `DELIBERATELY_DIFFERENT` and `DIVERGENCE_CHECKS` with its predicate over `tvAll`, and both `toHaveLength(6)` → `7` (D22). Plus a source-text guard that `(bigscreen)` contains no `crossOrigin`, placed **inside `src/app/(bigscreen)/`** so `test:tv`'s directory glob runs it.

**Does not:** write `textTracks[i].mode`. Does not call `addTextTrack`. Does not branch on `trackEl.readyState`. Does not use `onError`/`onLoad` on the track. Does not add `crossOrigin`. Does not render more than one `<track>`. Does not render cues itself. Does not add a `::cue` rule.

**Mutate.** (a) `querySelectorAll('track').length === 1` in the on state, 0 in off and in `none`; `kind`/`src`/`srclang`/`label`/`default` pinned with `getAttribute` + `toBe` — the house idiom at `page.test.tsx:390`, because `trackEl.src` is absolutised by jsdom. Mutation: build the src from the list position → reddens (the fixture's sidecar is at torrent index 4, position 0). Mutation: render one `<track>` per offerable entry with `default` on the chosen one → the length row reddens, with a **two**-sidecar fixture; a one-sidecar fixture cannot. (b) Not mounted when `ready` is false. Mutation: mount regardless → reddens; a failed track load is never retried, so the one load must not be spent on a 503. (c) Not mounted while `recovery.kind === 'reloading'`; mounted again on idle. Mutation: drop the conjunct → reddens. **Named limit in the test:** this proves the element's absence, not that no duplicate cues paint — jsdom has no `textTracks` and `page.test.tsx:268` replaces `HTMLMediaElement.prototype.load` with a `vi.fn()`. Reading 35. (d) Unknown language → `kind="captions"` and **no** `srclang` attribute. Mutation: emit `kind="subtitles" srclang="en"` → reddens. (e) Switching entries changes the DOM **node identity**. Mutation: drop `key` → reddens. (f) Dispatch a native `error` at the track with `{bubbles: false}` — RTL's own default (`@testing-library/dom`'s event map gives both `load` and `error` `{bubbles:false}`) → the cell reads `unreadable`. Mutation: use `onError` → nothing fires → reddens. **Caution written into the test: the dispatch must be non-bubbling**, because a bubbling one fires both props so the mutation cannot discriminate — and it would also reach the `<video>`'s own `onError` (`page.tsx:988`), running the stream-recovery ladder for a subtitle fault. (g) The divergence entry's predicate is true today and its reason is >30 characters (`engineContract.test.ts:280`). Mutation: add the entry to one map only → the set-equality row (`:294`) reddens. Mutation: leave the counts at 6 → `:289-290` redden. Mutation: add the entry but not the `<track>` → the `it.each` row (`:297-298`) reddens. (h) Mutation: add `crossOrigin="anonymous"` to the `<video>` → the source guard reddens; **no behavioural test can see this**, because jsdom fetches neither resource.

**Depends on:** 12, 9.

---

## Task 14 — The picker: one grid, one Back ladder, two explicit focus moves

**Files:** `frontend/src/app/(bigscreen)/_player/SubtitlePicker.tsx` (new, flat), `frontend/src/app/(bigscreen)/bigscreen/watch/[id]/page.tsx` (`:305`, `:518-535`, `:573`, `:826`, `:953`), `.../page.subtitles.test.tsx` (new).

Per D13. `pickerOpen` is **route** state beside `editOpen` (`:305`), passed down (`:573`); `rowCounts` becomes conditional at `:953`; a `pickerOpen` rung goes **ahead of** the `visible` rung in `onBack` (`:524-527`); `mayHide` (`:826`) gains `&& !pickerOpen`. Rows: **Off** first, then one per offerable entry, then the unselectable non-convertible rows carrying their format and reason. With zero offerable entries the picker is one cell (Off) plus its reason as the hint — uniform, always focused, and the press is always answered.

**Does not:** add a second `useFocusGrid` or a second `useBackKey` (`page.tsx:508-510`: effects register child before parent, so a child handler would claim the press). Does not overlay the picker — it **replaces** the band's rows. Does not claim Left/Right inside a transport cell. Does not put a sentence in the hint when the picker opens. Does not persist the choice. Does not carry its own `tabIndex={0}` (`journeys.test.tsx:671` queries `[tabindex="0"]` document-wide).

**Mutate.** (a) **Open**: a fixture with ≥2 picker rows and a current selection in row 1 → after OK the ring is on **that** entry. Mutation: delete the explicit focus move → `clampTarget` lands on row 0's clamped column → reddens, and the fixture discriminates because the clamp's answer differs from the truth. (b) **Close**, after OK on a language and separately after Back → the ring is on the **Subtitles cell specifically**. Mutation: delete the restore → `firstTarget` lands on Play/Pause (the scrub row is empty, `ScrubBar.tsx:62`) → reddens. (c) **The Back ladder**: picker open → one Back closes it **and leaves the band visible**; a second hides the band; a third leaves the player. Mutation: delete the rung → the first Back hides the band under an open focused menu → the `visible` assertion reddens. `mayHide` cannot cover this; `page.tsx:531` bypasses it. (d) **Auto-hide**: picker open, advance past the quiet period → the band is still visible **and `message === ''` throughout**. Mutation: drop `&& !pickerOpen` → reddens. The `message === ''` assertion is what keeps it discriminating: if opening the picker said anything, the pre-existing clause would already refuse the hide and the new one would be dead — stage 8's lesson that "a 1080p press landing 1080p must say nothing" was load-bearing twice over. (e) A non-convertible row is focusable, non-`aria-disabled`, and OK on it leaves the picker open and says why. Mutation: render it `aria-disabled` → reddens; the web CC button (`VideoPlayer.tsx:1816-1831`, `aria-disabled` at `:1820`, `tabIndex={-1}` at `:1822`) is the anti-pattern this surface bans. (f) A `dir`/`parse` pairing renders `(matched by folder)` / `(matched by episode number)`; a `stem`/`single` one does not. Mutation: drop the provenance → reddens, and this is the only thing in the stage that tells a viewer a pairing was inferred. (g) After a refresh shrinks the list, `ring()` has length 1 and is `activeElement`. **Not prescribed: a shrink rescue.** `clampTarget` (`model.ts:65-69`) already clamps a column into a shorter row, so there is no line to delete and no mutation to run — this is stage 8's dead-rescue shape, which measured 63/63 green, refused by name rather than reintroduced.

**Depends on:** 13.

---

## Task 15 — The diag subtitle probe, and the sample it needs

**Files:** `frontend/src/app/(bigscreen)/bigscreen/diag/page.tsx` (a Subtitles section beside Codec clips at `:801`), `frontend/public/samples/cue-probe.vtt` (new, hand-typed), `frontend/public/samples/cue-probe-line.vtt` (new), `.../diag/page.subtitles.test.tsx` (new).

Two arms. **27a:** a `<video>` with a deliberately bogus `src` plus the committed hand-typed `.vtt` — measured, a `<track default>` reaches `showing` with cues parsed even on an element in the error state, so this needs no clip and no backend. **27b:** the same over a real static clip. Transcribe `textTracks.length`, `textTracks[0].mode`, `cues.length`, `trackEl.readyState`, which of `load`/`error` fired, and **separately** whether text is VISIBLE on the panel. Plus a double-`load()` arm (reading 35), a `::cue { color: var(--gold) }` arm (reading 30), and a `line:-4` arm over the second `.vtt` (reading 31). Fetches use a plain `fetch` with `cache: 'no-store'` and `credentials: 'same-origin'` — the `classify.ts:154-159` pattern — never `apiClient`, whose interceptor would hard-navigate off the diag page.

**Does not:** add a focus stop (the rows are read-only text). Does not fetch from the backend in arm 27a. Does not mount a `<track>` before the 404 probe answers. Does not add GPU-expensive CSS. Does not claim a reading the operator has not transcribed. **NOTE: `frontend/public/samples/` is empty** — verified — so stage 8's clips 1–3 were never produced and its rows 16–18 are blocked on the same artefact. 27a is the arm that does not need one.

**Mutate.** (a) The section renders its rows, and the FILE NOT PRESENT branch renders when the probe 404s — the page's existing idiom ("Probe first, mount second. A 404 renders the FILE NOT PRESENT state and mounts NOTHING"). Mutation: mount the track before probing → that row reddens, and it is the state an operator will actually meet. (b) A source pin that the diag module imports no `@/services/*` and contains `fetch(`. Mutation: route the probe through `apiClient` → reddens; no behavioural test can see an interceptor that never fires in jsdom. (c) Status, cue count and VISIBLE are **separate fields**. Mutation: collapse them into one ok/failed field → reddens, and that collapse is exactly what would make a 401 indistinguishable from a malformed file on the set. **Not tested, and said so in the file:** every value the page prints. jsdom has no text-track machinery, so it prints an em dash for all of them in the suite. The page is an instrument, not an assertion.

**Depends on:** 13.

---

## Task 16 — The readings sheet, the Corrections section, and the spec edits

**Files:** `docs/superpowers/plans/2026-10-20-tv-stage9-device-readings.md` (new), `docs/superpowers/plans/2026-10-20-tv-stage9-subtitles.md` (this plan), `docs/superpowers/specs/2026-09-22-webos-tv-app-design.md`, `backend/app/torrent/manager.py` (docstring only, `:1140-1143`).

Rows 27–38 in the stage-7/8 sheet format (`| # | Reading | Gates "done"? | Instrument | Status |`), every cell starting at **not taken**, with the five how-to-read rules inherited verbatim and a `Run: **NOT TAKEN.**` line. Cross-linked both ways with the stage-7 and stage-8 sheets, and a **new file**, not an append, for the same reason stage 8 gave: that sheet's verdict is a stage-7 verdict gated on its rows 1–3 and still NOT REACHED.

Spec edits: correct `torrent/manager.py:1226-1228` at **`:267`** (§4.4 — the "current state" section the implementer reads first) and **`:662`** (§7.5) — **two** sites, not three; §10's row at `:796` carries no line number and needs the second site named, not a citation fixed. Add the second, ungated selector to both, and a note that stage 9 changed neither with a pointer to D1. Replace §7.5's "(kilobytes)" with `extra_pieces × piece_length` and the measured figures. Add `file_index` to §7.5's list route. Record that `.ass`/`.ssa` are listed and never converted, and that §7.5:667-669's styling promise is **declined with grounds** rather than contradicted by §13. Move "SRT→VTT conversion" from §11 point 4 (`:824`) to point 1 and state that **no suite in this repo can execute a WebVTT parser**; note there is no §11.2 (flat `## 11` at `:807`). Add `.ssa`, `text/vtt` and `::cue` to §4.4's grep set at `:264-265` and anchor `.ass` as `\.ass\b` — the naive term returns 20 in-scope hits, all false positives (15 `.assign`, 3 `.asset`, 2 `.assets`). Add the completed-library gap and the band-occlusion gate to §7.5's acknowledged-gap paragraph and to §12's "Subtitle coverage disappoints" row. And note in passing that §4.5's `main.py:188-191` is stale — `bare_401` is at `:194-196`.

Correct the false docstring at `manager.py:1140-1143` and file the `save_info_dict` repair as a stage-7 follow-up with the red test from **What ships inert or absent**. **Do not make it.**

**Does not:** take any reading. Does not change `handle.save_resume_data()` at any of the three sites. Does not produce a video clip. Does not mark the stage done.

**Mutate.** No test; the falsifiers are mechanical and must be run. `grep -n '1226-1228' docs/superpowers/specs/2026-09-22-webos-tv-app-design.md` returns nothing. `grep -c 'not taken' docs/superpowers/plans/2026-10-20-tv-stage9-device-readings.md` equals 12. `grep -rIn -- '\.ass\b' backend/app frontend/src` returns only deliberate stage-9 occurrences. Optionally, a docs test asserting every `manager.py:<line>` citation in the spec resolves to a `def` whose name the surrounding sentence also contains — mutation: revert one citation to `1226-1228` → reddens. That mutation is worth having: this stale citation survived two spec sites, six recon passes and four designs.

**Depends on:** all.

---

## The device readings

New sheet, rows numbered **27 onward** so numbering stays globally continuous and unique. Four rules inherited verbatim: a verbatim transcribed string or the words "not taken"; **a blank is a failure, not a pass**; transcribe the raw string, never "ok", "works" or "as expected"; measurement versus assumption called out per row.

| # | Reading | Gates "done"? | Instrument | Status |
|---|---|---|---|---|
| **27a** | Do native WebVTT cues PAINT on this set at all, and does a late-inserted `<track default>` reach `mode: 'showing'`? Transcribe `textTracks.length`, `mode`, `cues.length`, `readyState`, which of `load`/`error` fired, **and separately whether text is visible on the panel** — a zero-cue reading and an invisible-cue reading are different facts and may not share a cell. | **YES — gate A** | `/bigscreen/diag`, a `<video>` with a bogus `src` + the committed hand-typed `cue-probe.vtt`. No torrent, no FastAPI, no auth, no ARM cap, **no clip** — so a blank screen has one candidate cause. | **not taken** |
| 27b | The same question over a real decoded frame. | only if 27a is ambiguous | a static clip in `frontend/public/samples/`. **BLOCKER: that directory is empty** and producing a clip on a Pi is not a five-minute job. | **not taken** |
| **28** | Does the `<track>` subresource fetch carry `ff_session` with `AUTH_ENABLED=true`? **Independent of stage 7's row 1 in both directions** — a `<track>` goes through Blink's resource loader, a `<video>` range through the native media pipeline. | **YES — gate B** | the real player, auth on, paired set, and the backend log: `middleware/error_handler.py` logs method+path on entry and the status on completion, with no query strings. No devtools. Ride it with stage 7 row 1 in one sitting, in **separate cells**. | **not taken** |
| **29a** | With task 10 shipped, are cues LEGIBLE with the band **hidden** — the state the feature lives in? | **YES — gate C** | the real player at 1920×1080, screenshot. | **not taken** |
| 29b | Where do cues sit relative to the band when the band is **VISIBLE**? This is a *second* occluder: `.bs-player__bar` is `position: relative` with no `z-index` (`bigscreen.css:957-958`) and so paints above both `z-index:-1` layers, and the stylesheet puts its content at ~334px (`:899-900`). Stage 9 ships no fix. | no — **scopes stage 10** | same sitting, band forced visible. Take it **with stage 7's row 13** (`isolation: isolate` keeping the focus ring visible over the video): one stacking fact, three readings, and `bigscreen.css:893-896` records that this context already cost the stylesheet a full-bleed focus stop once, found by rendering and not by reading. | **not taken** |
| 30 | Does `::cue` styling apply, does `var()` resolve inside it, and what is the platform's DEFAULT cue size in px at 1080p against §8.5's 24px Read floor? **Do not substitute a `CSS.supports`/`cssRules` probe** — measured, Blink retains `bottom`/`transform`/`padding` inside a `::cue` block while ignoring them and drops `::cue-region` entirely, so a parse probe answers yes for properties that do nothing. | no | `/bigscreen/diag`, the `::cue { color: var(--gold) }` arm. | **not taken** |
| **31** | Does an admitted sidecar's piece actually ARRIVE on a real low-seeder swarm, and how long after the POST? Record three things separately: whether the piece arrived; whether the torrent returned to `finished` after retraction; whether the nav badge cleared. | **YES — gate D** | a real release carrying a `Subs/` folder, started **fresh** after this ships, timed against the TV's poll and the backend log. The only row that can falsify D1–D4. | **not taken** |
| 32 | Does `line:-4` move a cue clear of the band on this engine? The reading that chooses between reading 29b's candidate fixes, and the only one that would live in the **converter**. | no | `/bigscreen/diag`, the `cue-probe-line.vtt` arm. | **not taken** |
| 33 | Does a **seven**-cell transport row fit at the television's own font without overflow, and is the last cell still focusable? `.bs-player__row` is `flex-wrap: nowrap` (`bigscreen.css:968`), so an overflowed cell is one the D-pad can focus and the viewer cannot see — a silent violation of no-cell-that-cannot-act that no test on this surface would catch. Transcribe `scrollWidth` and `clientWidth`. | no | the real player, longest label forced. `bigscreen.css:910-911` claims ~1290px for the current six; that number was never read off the set either. | **not taken** |
| 34 | Does the set's own subtitle/CC remote key reach the page, and with what `keyCode`? | no | `/bigscreen/diag` → Remote key codes (`diag/page.tsx:727`), the same instrument as stage 7 rows 4–8. Decides whether the cell ever earns a `MEDIA_TWINS` entry; task 12 adds none, deliberately. | **not taken** |
| 35 | Does a recovery `video.load()` DUPLICATE the TextTrack on Chromium 120 as it does on 155 (one element, `textTracks` 1→2→3, every copy showing and painting), and does unmounting clear the copies already made? | no | `/bigscreen/diag`, the double-`load()` arm. Task 13's guard makes it moot either way; this says whether the guard is still earned. Not observable in any suite. | **not taken** |
| 36 | Does switching language mid-film take effect by remounting one `<track>`, with no `video.load()` and no stream interruption? | no | the real player, two languages, `currentTime` before and after. | **not taken** |
| 37 | How many sidecars do this household's real releases carry, in what formats, languages and encodings, and how many pair to an episode — **and by which rung**? | no | one read-only pass of `list_sidecars` over every `torrents` row after a week of ordinary use. The only row that can say whether §12's "Subtitle coverage disappoints — High" materialised, and the only instrument that can retire §6's encoding and pairing claims. Expect close to zero on today's two titles. | **not taken** |
| 38 | Verbatim `navigator.userAgent` and model SKU **again**, if this is a different sitting from row 26's, so a firmware change between sittings is visible rather than assumed. Every Chromium measurement behind this stage was taken on **155**; the record says the set is Chromium 120 / webOS 25, read Oct 2026. | no | `/bigscreen/diag` → Device (`diag/page.tsx:684`). | **not taken** |

**Which stage-7/8 readings block stage 9.** Stage 7's rows **1–3** do, and not as a formality: gate 1 raises the live possibility that playback has only ever been observed with `AUTH_ENABLED=false`, so a blank subtitle screen with auth on would have an extra candidate cause that reading 27a's instrument deliberately removes from its own path but cannot remove from 28 or 31. **Take stage 7's rows 1–3 first.** Stage 7's row **13** is the same stacking fact as 29a/29b and must be taken in the same sitting — a negative row 13 predicts invisible cues before anyone writes a converter. **Stage 8's rows 16–26 do not block stage 9**, and 27a is specified so it does not inherit their missing-clip blocker.

**Posture, copying both existing sheets: merge on green tests; hold the stage's "subtitles work on the television" claim until 27a, 28, 29a and 31 are transcribed.** All twenty-six prior readings are still `not taken`. If 27a comes back negative, task 13 and 14 are **replaced**, not patched — the replacement is DOM-rendered cues from a parsed VTT, which is a different stage with a different frame budget, and tasks 1–11 survive unchanged.

---

## Hazards

1. **THE STRAND.** `status.progress` is wanted-progress (`manager.py:328`), so an admitted piece that never arrives holds the torrent below 100% forever: one of the Pi's two slots (`main.py:57`), a permanently lit nav badge (`api/activity.py:36` → `TopNav`), a never-released force-start pin (`:486`, `:494`), and — the severe one — `get_completed_video_file_info`'s gate 2 (`:1250`) never opening, which reinstates stage 7's 404-after-restart on the television's main content. **Countermeasure:** gate 4 + the 4-piece span cap + budgeted retraction (D3/D4), all three, plus reading 31 as the only observation.
2. **GATE 4 INVERTED.** Retraction applied to a piece a wanted file also occupies de-wants video bytes and can report the torrent `finished` at 100% with a piece the film needs never downloaded — **an unplayable episode marked complete.** Measured. **Countermeasure:** gate 4 checked at admission **and re-checked at retraction**, with task 7(b) and 7(f) as the two mutations; and `_prioritize_window`'s relax setting `piece_priority(p, 1)` at `:1963` is why the re-check cannot be skipped.
3. **A CHANGED PRIORITY LIST WIPES THE PLAYHEAD'S WINDOW.** Measured both ways. **Countermeasure:** neither selector changes; task 1(b) pins that `prioritize_video_files`' list does not vary with `file_index`; task 7(a) pins that no file-priority call is made. All three are needed — no behavioural assertion can observe libtorrent's piece-priority recomputation.
4. **THE TEST CONTAINER TALKS TO THE REAL POSTGRES**, which already holds a leaked pytest row (`t-block-1`, `save_path` under `/tmp/pytest-of-root/...`) and a `seeding`/100 row whose `save_path` does not exist. **Countermeasure:** every row through `conftest.py:109`'s `override_get_db` and `:73`'s throwaway SQLite, `get_db` patched on **both** modules, nothing committed. This is the repo's own "Agent left a mutation" shape.
5. **A ROW CAN CLAIM 100% WITH NO FILES ON DISK** — one does right now. The DB's `save_path` is also **relative** while resume data's is absolute, so resolution works only because the container workdir is `/opt/freeflix`. **Countermeasure:** per-entry `OSError` reported not raised (task 3), both sides of the containment assert resolved (task 9c), readiness measured not read (D7).
6. **IMPORTING THE MANAGER BUILDS A REAL LIBTORRENT SESSION** at module scope (`manager.py:2024`) with DHT (`:64`), three bootstrap routers, `init_db()` and `_load_saved_torrents()`. **Countermeasure:** `assert tid not in torrent_manager.active_torrents` as the house guard (`test_finished_torrent_streamable.py:161`); any new `lt.session` built on `127.0.0.1:0` with DHT/LSD/UPnP/NAT-PMP off; run targeted files, because `test_torrent.py` does real network I/O during collection.
7. **`_block_torrent` IS UNREACHABLE FROM THIS STAGE AND THE TEST THAT SAYS SO CANNOT FAIL.** `validate_torrent_content` runs first and is priority-blind; `test_content_guard_manager.py:46` already pins a `.srt`-bearing torrent as allowed. **Countermeasure:** no such test; guard the settings instead (task 2).
8. **A SIGNATURE-VALID ZERO-CUE BODY IS UNOBSERVABLE EVERYWHERE DOWNSTREAM** — `readyState 2`, `load` fired, no `error`, nine measured shapes, and per-cue. A payload `-->` yields a cue that passes a cue-count check. **Countermeasure:** refuse at the converter; every assertion names a cue **count** and a cue's **text**; "200 and the body starts with WEBVTT" is forbidden by name.
9. **A TRUNCATED SIDECAR FAILS SILENTLY** and the zero-cue refusal does not catch it: a WebVTT parser discards a malformed trailing cue and renders what precedes it, so the viewer loses the last stretch and nobody files a bug. **Countermeasure:** `contiguous_available(...)["complete"]`, whose `have_piece(last_piece)` conjunct *is* the hash check for a one-piece file; a bare `file_progress` comparison refused by name.
10. **THE 401 IS BODILESS AND CANNOT BE CHANGED** (`main.py:87-90`, `:194-196`), so on the VTT route it is indistinguishable from a malformed file to a `<track>`. **Countermeasure:** the list carries `ready`, the TV never mounts a track to discover readiness, and the diag probe reads the status with a plain `fetch`. Reading 28.
11. **`react-dom` DOES NOT WIRE `onError`/`onLoad` ON A `<track>`** and the native events do not bubble, so the bubble prop is dead code no test catches; `trackEl.readyState` is a hardcoded 0 in jsdom, so a branch on it is permanently false in the suite. **Countermeasure:** `onErrorCapture`, branch on which event fired, and task 13(f)'s non-bubbling dispatch with its caution.
12. **`.bs-player__track` IS ALREADY THE SCRUB BAR'S CLASS** (`bigscreen.css:1005`), unrelated to `<track>`. Nothing in this stage may reuse it.
13. **`role="status"` AND `.bs-player__hint` ALREADY MATCH TWO NODES** — `page.tsx:999` and `ScrubBar.tsx:157`, deliberately (`bigscreen.css:884-889`: "TWO hint lines, not one, and they are the same class deliberately"). `getByRole('status')` throws today and `getAllByRole(...)[0]` silently picks whichever renders first, which changes the moment a picker adds a third. **Countermeasure:** every new band assertion scoped to a named container.
14. **`page.test.tsx:268` REPLACES `HTMLMediaElement.prototype.load` WITH A `vi.fn()`**, so the `<track>` duplication task 13 prevents is invisible to the suite in two independent ways. **Countermeasure:** assert the element's absence; reading 35 for the consequence.
15. **THE DIVERGENCE REGISTRY'S COUNT PIN DOES NOT REDDEN WHEN A SEVENTH DIVERGENCE APPEARS** — the maps are additive by hand (`engineContract.test.ts:286-288`). **Countermeasure:** task 13's entry, predicate and count bump, with three separate mutations.
16. **`test:tv` IS A DIRECTORY GLOB** (`package.json:13`), so a guard test outside `src/app/(bigscreen)/` is silently absent from it. **Countermeasure:** task 13's `crossOrigin` guard lives inside that directory.
17. **`frontend/public/samples/` IS EMPTY**, so stage 8's rows 16–18 and this stage's 27b are blocked on an artefact nobody has made. **Countermeasure:** 27a's instrument needs no clip.
18. **THREE VERIFICATION INSTRUMENTS RUN NOWHERE.** `test:tv` is in no build and no CI, `next build` happens inside the image build where a test failure must not break an image, and every mutation here is manual. **One green run proves nothing.** Loop the suites.
19. **NEVER RECREATE THE BACKEND CONTAINER.** `up`/`down`/`restart`/`-V` mid-download leaves a torrent seeding at 100% with no files on disk and there is no `force_recheck` path. One-off containers only, for every probe and every test run.
20. **`grep '\.ass'` IS THE WRONG INSTRUMENT HERE** — 20 in-scope hits, all `.assign`/`.asset`/`.assets`. Any guard anchors `\.ass\b`, or it is permanently red for reasons unrelated to subtitles.

---

## What no test can settle

- **That the television paints any cue at all.** No suite here can execute a WebVTT parser: jsdom 25.0.1 has no `TextTrack`, `TextTrackList`, `TextTrackCue` or `VTTCue`, `video.textTracks` is a plain zero-length Array with a `<track default>` child present, and `addTextTrack` does not even throw; the backend image has no browser binaries (`pyproject.toml:19` declares playwright, `backend/Dockerfile` never runs `playwright install`). Reading 27a.
- **That Chromium 120 on webOS 25 agrees with Chromium 155 on macOS about any of it** — the nine silent zero-cue shapes, the five leniencies, the tag allow-list, `default` on a late insertion, two defaults both showing, the `load()` duplication, `::cue`, the scrim occlusion screenshot. Emitting the strict form makes the leniencies moot for *our* output and nothing else moot.
- **That raising a piece priority writes a priority-0 file's bytes.** Task 0 measures the mechanism in a loopback probe; no committed test can assert it, because the suite has no peer to download from. The probe's own second arm is the only guard against measuring piece-sharing instead.
- **That an admitted piece ever arrives within the budget on the low-seeder swarms this project exists to serve.** A deadline is a request, not a delivery. Reading 31.
- **That `progress` returns to exactly 100 after retraction on a real torrent.** Measured in a container (residual 0); no pytest can execute libtorrent's piece scheduler.
- **That the pairing ladder's rungs or the language table match real releases, or that the rung ORDER is right when two rungs disagree.** There is no corpus of sidecar filenames anywhere in this repo: `releases.tsv` is 370 title rows, nine columns, no path column, zero `.srt`, zero `Subs/`. Every fixture layout is a hand-authored assumption with a provenance note. Reading 37.
- **That any release this household downloads carries a sidecar at all.** Zero today.
- **What fraction of real releases carry pad files** — the entire difference between "nothing to admit" and "one piece per sidecar". Not measurable from the dev DB by the obvious route: those blobs carry no `info` dict, so `read_resume_data(blob).ti.files().file_flags(i)` raises `AttributeError` on the very rows such a measurement would use. The one-off container has no network. Treated as a design constraint, not measured away.
- **That the density threshold is right for real sidecars**, and that "cp1252 or refuse" is the right default for this library. Its blind spot *is* measured (Turkish cp1254 ≈0.10); the threshold is not.
- **That the emitted VTT is parseable.** The property assertions *are* the browser facts transcribed by hand. If one was transcribed wrong, nothing in this repo will say so.
- **The `cues.length === 0 → "no cues"` branch.** `trackEl.track` is undefined in jsdom, so the branch is unreachable in the suite and is deliberately given no test. It exists so the device can say it.
- **That seven cells fit at the television's font.** Measured at 1041px of 1728px in Chromium 155 on macOS; `bigscreen.css:910-911` says ~1290px for six and is wrong in the safe direction. Neither number was read off the set, and `nowrap` means overflow clips rather than wraps. Reading 33.
- **That the faded scrim makes cues legible, or that anything makes them legible while the band is up.** Readings 29a and 29b.
- **That the eight cell labels read at three metres.** A test can prove they are distinct and bounded; nothing can prove a sentence reads.
- **That `coverage: "unknown"` will become rare.** It is the permanent answer for the existing library, and how often it recurs depends on how often the box restarts, which nothing here measures.

---

## Decisions taken on the user's behalf

The standing instruction for this project is to take the best option and keep going. Four genuine
risk-appetite questions came out of the design round; all four are **settled here**, each with the
reasoning written down so it can be reversed on evidence rather than re-argued. The full argument
for each, including the costs of the road not taken, is in the design notes.

**1. `.ass`/`.ssa` conversion — DECLINED.** §7.5 at `:667-669` does commit to it, so this is
declining a spec commitment, not resolving a contradiction. Shipping it means a `Format:`-line
driven parser written from recalled grammar with no `.ass` file anywhere in this repo to test it
against, whose measured failure mode is stacked overlapping junk over the picture, and whose worst
outcome is a 200 whose body is `WEBVTT\n\n` — which a `<track>` reports as a **successful load
with no event at all**. A bad ASS converter is strictly worse than none, because its failure is
unobservable. Sidecars are **listed** with `convertible: false` and the television says the format
out loud. Reading 37 decides whether this household's library makes it worth a stage-10 task.

**2. Non-UTF-8, non-cp1252 sidecars — REFUSED, with `SUBTITLE_ENCODING` as the owner's override.**
`charset_normalizer` is importable in the image today only because `backend/Dockerfile:6` sets
`POETRY_VIRTUALENVS_CREATE=false` and `:25` pip-installs poetry into the same site-packages; it is
in neither `pyproject.toml` nor any `[[package]]` block of `poetry.lock`. Declaring it is one line
plus an image rebuild and it measures better than the ladder — but it is confidently wrong on short
inputs, and "confidently wrong" here means a whole language's text silently corrupted for the
length of a film. A refusal is one sentence the viewer can act on; mojibake is invisible as a
*fault* and visible as *nonsense* for two hours. If reading 37 shows a real non-UTF-8 population,
declare the dependency then, in its own task with its own red tests.

**3. The existing library gets nothing, ever — ACCEPTED, and the television says so.** Reaching
for it means the `save_info_dict` repair plus a disk walk: changing what every torrent writes,
flipping a shared four-gate resolver from always-None to sometimes-returning, and an `os.walk` on
the ARM disk per request with its own containment surface — for a sidecar whose bytes could only
have arrived by piece-sharing, in a library that contains **zero** sidecars today. So
`coverage: "unknown"` → the cell reads `Subtitles · unavailable`. The `save_info_dict` fix is a
real bug and a bigger one than anything stage 9 adds; task 16 corrects its false docstring and
files it with its red test, and it gets its own branch and its own blast-radius review. Reversing
this decision is purely additive: a `source: "resume"` arm on the lister, after that fix ships.

**4. The TV half ships before reading 27a; the web CC button goes to stage 10.** The cell is honest
in every state the backend can describe (`unavailable`, `none`, `not ready`, `unreadable`,
`no cues`), reading 27a's instrument needs no clip and no backend so the gate is cheap and
immediate, and the stage's "subtitles work on the television" claim is withheld exactly as stages 7
and 8 withhold theirs. The cost of deferring the web button is real and named: the web player is
the only surface with a console, so the converter's output is first seen on a panel with no
devtools — task 15's diag probe is the mitigation. This is the one trade here where the other
answer is defensible; if the earlier feedback is worth more than the scope, the swap is to add the
web `<track>` and its cue positioning as a task 17 and accept that `VideoPlayer.test.tsx:34-41`
goes red by design.

---

## Notes for whoever runs this

1. **The mutation is the deliverable, not the test.** Every task carries a **Mutate** block naming
   the production change that must turn each assertion red. Run them. Stage 8 found 34+ tests in
   this repo that cannot fail, fourteen of them prescribed by a plan I wrote, and every single one
   was caught by someone running the mutation rather than reading the test.
2. **A task's `Does not` list is load-bearing.** Several entries exist because a plausible-looking
   alternative was measured and found to be a no-op, a silent regression, or a test that cannot
   fail. If you are about to do something a `Does not` line forbids, read the `D`-number it points
   at before you do it.
3. **Re-baseline the four counts at branch start** and quote them in task 1's commit. The numbers
   in `## Verification` are a starting point, not a target.
4. **One green run proves nothing.** `test:tv` 25+ times, the full `vitest run` 5+. The mechanism
   behind the known flake is recorded in `verify-suites-by-looping`: RTL's `asyncWrapper` disables
   the React act environment for all of `waitFor`, and passive effects flush as a separate Scheduler
   task gated by a 5 ms budget. `await act(async () => {})` does not close it.
5. **Never recreate the `backend` container.** No `docker compose up`, `down`, `restart`, or
   anything with `-V`. One-off containers only — for every probe and every test run.
6. **Never `git add -A`.** A blanket add has already swept another agent's edits into an unrelated
   commit in this repo. Stage by explicit path, and `git diff` each file you are about to commit —
   a stopped review workflow once left a production mutation unrestored in `capability.py` and
   only the per-file diff caught it.
7. **If task 0 comes back negative, stop and re-read it.** Tasks 3, 7, 8 and 9 change shape; 1, 2,
   4, 5, 6 and 10–16 do not. The named fallback is written into task 0.
