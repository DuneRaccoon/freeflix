# Stage 9 — sidecar subtitles: piece-level admission, two read endpoints, and one `<track>`

Branch `feat/tv-stage9-subtitles`, off `master` at `4cad98b` (the stage 8 merge).

Spec: `docs/superpowers/specs/2026-09-22-webos-tv-app-design.md` — §7.5 is the stage, §4.4 the current state, §10's `torrent/manager.py` table row, §11 point 4, §13's out-of-scope list, §14 row 9. **The section numbers are the durable handle and the line numbers are not:** task 16's edits grew that file from 924 to 1020 lines and moved every one of these (`:796`→`:872`, `:824`→`:916`, `:894`→`:990`, `:923`→`:1019`, §4.4's grep set `:264-265`→`:269-270`, §7.5's styling promise `:667-669`→its own bullet, and the two `1226-1228` sites are gone). A line number into a file the task itself edits is stale the moment the task runs.

**Read `2026-10-20-tv-stage9-design-notes.md` first.** It is the design record: seven adversarially-checked recon areas, four competing designs, three judge panels, and the three things all four designs missed. Everything below carries a `file:line`, and **every citation in this plan was re-verified against the tree at `4cad98b` while writing it** — the dossier's own corrections drifted by ±1–2 lines in a dozen places, and one claim four independent recon passes agreed on ("the stale `manager.py:1226-1228` citation appears at three spec sites") is wrong: `grep -c` says **two** (`:267` in §4.4, `:662` in §7.5). §10's row at `:796` carries no line number at all. Four scouts corrected the same thing the same wrong way; do not inherit a number from a correction without opening the file.

**This stage is unlike 7 and 8 in one way that shapes every task: the deliverable §7.5 names is the wrong mechanism, not merely an incomplete one.** §7.5 bullet 1 says to stop zeroing priority for sidecars. Stage 9 does not, at either site. The reasons are measured, they are in **The settled decisions** below, and the clearest single sign of it is that `backend/tests/test_skip_non_video.py:31` — which pins `h.applied == [1, 0, 0, 0]` for a fixture naming `subs.srt` explicitly at index 3 — **survives this stage unmodified**. A plan that rewrites that assertion is a plan whose mechanism is wrong.

---

## Scope

In: a `subtitle_extensions` Settings field; a live-session sidecar lister whose readiness is measured and whose emptiness is never ambiguous; a pairing ladder that reports which rung it took; on-demand piece-level admission with a gate that keeps it from marking an unplayable episode complete; a pure-Python SRT→WebVTT converter that refuses rather than emits; three routes on a new router; one unconditional `Subtitles` transport cell with a picker; **the press that chooses an entry asking the box for its bytes and reporting the wait**; exactly one `<track>`; the scrim faded with the band; and twelve readings.

That emphasised clause was **not** in this list until C7 was found, and its absence here is the same omission in miniature: four tasks built the parts of a fetch and no task was told to connect them. A scope line that names components rather than journeys is how that happens.

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
4. **The cost is piece-shaped, not byte-shaped.** §7.5's "(kilobytes)" is wrong by up to four orders of magnitude: the marginal cost is `extra_pieces × piece_length` — measured 0 on an unpadded v1 torrent, one full piece per sidecar on a pad-aligned one (libtorrent 2.0's own `create_torrent` pads by default, as does qBittorrent, and every v2/hybrid torrent must), i.e. **N sidecars × `piece_length`**: **20 × 8 MiB = 160 MiB** for a 20-language `Subs/` tree, and **~200 × 8 MiB ≈ 1.6 GiB** for a 20-language × ~10-episode season pack. (**C5 corrected this**: the figure read 1.6 GiB for the 20-language tree, which is 10× off — 1.6 GiB needs ~200 sidecars, not 20. The conclusion is unchanged, and so is the cap.)

The mechanism instead is **two-phase, and C1 above is the measurement that shapes it.** Phase 1 is `handle.piece_priority(p, 7)` + `handle.set_piece_deadline(p, 0)` over the sidecar's own piece span — the same two calls `_deadline_pieces` already makes at `manager.py:1936-1937`. Measured: raising a piece wholly inside a deselected file widens `total_wanted` by exactly that file's bytes, leaves every file priority untouched, and — the property that decides the shape — **survives `prioritize_video_files`' next call**, because that vector is a pure function of the file set and libtorrent does not recompute from an identical list. But phase 1 alone leaves the bytes in a `.<infohash>.parts` part file that nothing can read, so phase 2 is a **flush**: once the span is held, one `file_priority(idx, 1)` moves them into the save path with `redownloaded=0`, and one `file_priority(idx, 0)` puts the priority back. Those two calls each wipe `_prioritize_window`'s raised window (measured on unheld pieces), which is transient because the repo re-asserts it per chunk, and they are the whole reason admission is not file-level from the start: a file-level admission makes the selector's next call a *changed* list, which undoes the admission and takes the playhead's window with it. **Designs 2's and the spec's position loses** because it buys a background pre-fetch nobody asked for at the price of reason 3; **Design 1's seam inside `wait_for_first_chunk` loses** because that function has exactly one caller, `api/streaming.py:334`, the shared `GET /video` path the web player drives too, so every web stream open would widen that torrent's wanted set with no subtitle UI to show for it.

### D2. Admission is a POST, and it is the only mutating route.

`classify.ts:11-20` is right that a GET which re-deadlines pieces is a probe that hijacks libtorrent's deadline queue. A POST also makes the mutation **structurally unreachable from a `<track>`**, which is a better guarantee than a source-text pin that a `getattr`-assembled name walks past. Design 3 found this; Designs 1, 2 and 4 all admit as a side effect of the read and then pin the absence of other side effects with scans whose limits they acknowledge.

### D3. Gate 4 — every byte of every piece raised must belong to files at priority 0.

This is the sharpest edge in the stage and it is a defect Design 3's probe found that the rest of the dossier would have shipped, **reproduced independently in task 0's run 4**. `piece_priority(p, 0)` on retraction, applied to a piece a **wanted** file also occupies, **de-wants video bytes**: on the unpadded layout `total_wanted` fell *below* baseline (residual **-3048**), the shared piece's priority went to **0**, and the torrent fell back from `seeding`/100% to `downloading`/46.78%. A negative residual is the torrent wanting less than its own video. An unplayable episode marked complete.

**C1 gives gate 4 a sharper job than the design round gave it.** The *success* retraction is `file_priority(idx, 0)` and needs no gate — measured, residual **0**, the shared piece left at libtorrent's default **4** (still wanted), the state back to `seeding`, and the video's SHA-256 matching the seed's. Gate 4 guards the **budget-expiry** retraction, which has no choice but to be piece-level, because an admitted piece that never arrived is the one thing that holds the torrent below 100%. That is now the only place a `piece_priority(p, 0)` appears in the stage, and it is the dangerous one.

Gate 4 also doubles as the no-op detector: on an unpadded torrent the sidecar shares a piece with a video file's tail, those bytes are **already wanted**, and admission is correctly a measured no-op — report `admitted: 0` rather than raising anything.

**The acceptance test for any change here is the video file's SHA-256 against a known-good copy, never a status line.** Both of run 4's arms ended with matching hashes, and only because the probe had a willing seeder and its loop waited for every piece; in production the de-wanted piece never arrives and the status line still says 100%.

### D4. Admission is bounded three ways and retracted on a budget.

`subtitle_admit_max_pieces = 4` forecloses the padded case — 160 MiB for a 20-language tree, ~1.6 GiB for a 20-language season pack at ~200 sidecars (C5) — per-sidecar structurally rather than by budget. `total_wanted` rises by only the file's bytes, but the download cost is whole pieces, so the cap is on the **span**, not on the size. One sidecar per POST.

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

So: `WEBVTT\n\n`, LF endings, `HH:MM:SS.mmm --> HH:MM:SS.mmm` with exactly one space each side, HH ≥ 2 digits, MM/SS exactly two digits in 0–59, fraction exactly three. **Two carries** — seconds ≥ 60 into minutes *and* minutes ≥ 60 into hours, because `00:00:75,000` and `00:75:01,000` are separately measured silent zeros. Strip `\{[^}]*\}` **before** escaping (`{\an8}Top line` renders the braces literally). Escape `&` unconditionally (`A &notreal; B` renders `A ¬real; B` via a legacy semicolon-less entity). Escape `<` **except** where it opens or closes one of `i b u ruby rt v lang c` — a blanket `html.escape()` puts the literal text `<i>` on screen for the whole film. Do **not** strip `<font …>` (Blink drops the tag, keeps the text). A **cue-setting tail** — DVD-rip `X1:100 X2:200 …` junk, or a real `.vtt`'s own `align:`/`line:` settings — is **tolerated on input and not reproduced on output**, and the distinction is the whole point (C5): nothing here hunts for the tail, the cue it trails still parses (measured harmless, pinned by `test_a_timing_line_with_a_tail_still_yields_its_cue`; anchoring the timing-line regex just after the second timestamp — the obvious "be stricter" edit — turns every DVD-rip sidecar and every settings-bearing `.vtt` into a flat `no-cues` refusal), but the output timing line is re-emitted from the parsed fields under a grammar anchored at **both** ends, so the tail cannot survive — carrying it across would redden this decision's own property assertion. Drop cues with `end <= start` (Blink keeps them as invisible dead weight; only the converter can remove them). Escape any `-->` in a payload line. Refuse on zero cues. And lean on **no** measured leniency — Chromium 155 accepts no blank line after the magic, no spaces around the arrow, 1-digit hours, CR-only endings and an absent hours field; the set is Chromium 120 and those five are the parts most likely to differ.

### D20. The pairing ladder reports which rung it took.

Five rungs: basename stem after stripping a trailing language / `forced` / `sdh` / numeric token → nearest-ancestor-directory stem → `parse_episode` over segments **below the torrent root**, required to agree with the paired video's own parse → single-video torrent → unpaired. Rung 2 cannot use `parse_episode`: measured, `parse_episode("Subs/E01.en.srt")` is None, because `_SXXEYY` is `[Ss](\d{1,2})[\s._-]?[Ee](\d{1,3})` (`providers/episodes.py:6`) and a bare `E01` matches neither it nor `_XNOTATION`. The root must be **excluded**, not merely deprioritised: `parse_episode` is an `re.search` taking the first left-to-right match (`:14-16`), so a range-named root **overrides** a correct later segment — `Breaking.Bad.S01E01-07.1080p.BluRay/Subs/Breaking.Bad.S01E04/3_English.srt` parses to (1, 1). Ten of the 94 `shape=episode` rows in `backend/tests/data/releases.tsv` are range-named, and 0 of 119 `pack` rows parse any episode, so the trap set is exactly the releases most likely to ship a multi-sidecar `Subs/` tree.

**THE AMBIGUITY CONTRACT, re-decided THREE times while implementing, and this is the standing version** (`f049a5f`, then `fa4d806`, then the rung-3b deferral below). As written above, D20 specified a refusal for rung 3 only, and rungs 1 and 2 shipped returning the FIRST of several matches. Measured on the multi-season "Complete" shape this entry cites to justify rung 2 — `videos = [0: Show.Complete/Season 2/E01.mkv, 1: Show.Complete/Season 1/E01.mkv]` — a Season 1 sidecar paired to Season **2**'s episode, flipping with file-index order, reported as `stem`. `f049a5f` made both rungs collect every claimant and refuse unless exactly one. That left the shared-directory depths unread, and they answer: **{0: 1, 1: 2}** for both of the reviewer's sidecars (the basename one and the `Subs/E01/` one), measured in a one-off container — index 1, the correct file, order-independently. So the whole contract now reads:

* A rung takes an answer when exactly **one** video claims the sidecar.
* **Rungs 1 and 2 break several claimants by DIRECTORY PROXIMITY** — the number of leading path segments a claimant's directory shares with the sidecar's — and take the **strictly greatest** scorer, reported as a sixth source **`near`**, suffix `English (nearest of several matches)`, which joins `dir`/`parse` in appending `· guessed`. `near` rather than `stem`/`dir` because the suffix table exists so the television can confess how an episode was identified, and "its name matched one video" and "its name matched several and I took the closest" are different confidences. It is **order-independent by construction**: the maximal SET is computed and its size checked, because `max()` over a list returns the first maximal element, which is the order-dependence the finding was about.
* **A tie proximity cannot break still declines** and falls through, with its INFO line. **Rung 3 does not use the tiebreak at all** — its claimants agree on a number the parse has already shown it cannot discriminate, so proximity there is a second guess stacked on a first. Scope pinned by `test_the_parse_rung_does_not_use_the_proximity_tiebreak`, which is the only row that can see it.
* **The cost that was recorded as "same index; measured" WAS BIGGER THAN THAT, and it is now fixed.** `fa4d806` returned the proximity answer immediately, so it pre-empted rung 3; the cost was recorded as a weaker label at the same index. That was true of the two fixtures it was measured on and **false in general**, and the generalisation of it that reached a test docstring ("in every shape where both can resolve they agree, because a rung-1 ambiguity means the video basenames are bare and identical") was false too: the episode can live in a segment proximity does not read — the sidecar's own **basename**, or any segment past the one the shared prefix stops at. Enumerated over **720,657 coherent two-video layouts** in a one-off container, **68** resolve to a *different index* under proximity than under the parse, 3 of them with both videos on one convention. The clean case, measured against both modules:

      videos  0: Show.Complete/Season 1/Show.S01E01/E01.mkv     below-root parse (1, 1)
              1: Show.Complete/Season 2/Show.S02E01/E01.mkv     below-root parse (2, 1)
      sidecar    Show.Complete/Season 1/Subs/E01/Show.S02E01.en.srt   parse (2, 1)
      8708913 -> (1, "parse")   CORRECT, order-independent
      HEAD    -> (0, "near")    WRONG season's file, order-independent

  Rung 2 fires because the sidecar's parent folder is the bare `E01`, which both videos' basenames match; proximity then reads only the leading segments, where this sidecar says `Season 1`, while the sidecar's own name says `S02E01`. A season's `Subs/` tree holding another season's sidecar is a packer's misfile, which is the thing a pairing ladder exists to survive. **So it was not only a weaker label — it was a right answer traded for a wrong one**, rendered `English (nearest of several matches)` with no error anywhere, which is the exact failure the paragraph above says the exposed rung exists to make visible.

* **RE-DECIDED A THIRD TIME, and this is the standing version: the proximity answer is HELD, not returned** (rung **3b**). Rungs 1 and 2 compute their tiebreak as before and keep the candidate in `held_near`; rung 3 runs; only if the parse finds nothing is the held candidate returned, as `near`. The misfile above answers `(1, "parse")` — the right file — and the two fixtures that motivated the tiebreak are unaffected, because rung 3 cannot parse a bare `Season 1/E01` (measured: both still `(1, "near")`, in every file order). So nothing was given up by deferring, and the rule that `f049a5f` stated and `fa4d806` broke is restored in the form it should have had: **a rung that can be wrong must not outrank the rung that checks**, and, below it in priority, silence is better than a wrong answer but worse than a right one. The tiebreak serves the second rule; the hold serves the first. **Rung 1's held candidate outranks rung 2's**, for the same reason an unambiguous `stem` outranks an unambiguous `dir`. Five mutations pin the order, each measured: revert to immediate return (RED 2), delete rung 3b (RED 6), hoist 3b above the parse (RED 2), let rung 2 overwrite rung 1 (RED 1), and the pre-tiebreak decline-only form (RED 6).
  - That fourth one shipped GREEN on all 51 rows first, with a comment claiming the precedence — the same shape the whole review round kept finding, in the fix for the review round's own finding. It needed the only layout that can discriminate it: both rungs ambiguous, both resolvable, and resolving to **different** videos, which requires the sidecar's stem and its parent folder to name different episodes (`Show/Season 2/E02/E01.en.srt` against `E01`/`E02` videos in two seasons — named `E01`, filed under `E02`, so the name picks the episode and the location picks the season). Pinned by `test_the_stem_rungs_held_answer_outranks_the_directory_rungs` over all 24 file orders.

`pair_source ∈ {stem, dir, near, parse, single, none}` is returned **and rendered**, which is the graft no design proposed and the epistemic panel named: for `Pack/Pack.S01E03.en.srt`, skipping the stem rung still yields episode (1,3) via the parse rung, so without the exposed rung that mutation cannot be discriminated at all. And a mis-paired sidecar is the one failure in this stage with no error anywhere — valid VTT, correct readiness, true sentence about everything except whose episode it is. So the picker row says `English` for a `stem`/`single` pairing and `English (matched by folder)` / `English (nearest of several matches)` / `English (matched by episode number)` for `dir`/`near`/`parse`, and the cell's sub-line appends `· guessed` in those three cases.

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
pieces, so a pad-aligned 20-language tree is still `20 × piece_length` = 160 MiB at an 8 MiB piece,
and a 20-language season pack (~200 sidecars) is the ~1.6 GiB case (C5). **D7 changes**: a held piece is
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

### C4 — Task 8(f)'s mutation is green under the obvious implementation, and task 8 needs a dedup decision the plan never names

Two findings from task 8, both measured.

**1. "No entry carries a `mime_type`" cannot fail against a pydantic response model.**
Task 8(f) prescribes `mime_type=get_mime_type(f["name"])` as the mutation. With
`response_model=SubtitleList` and pydantic v2's DEFAULT `extra='ignore'`, that
construction is **silently dropped**: measured, the handler builds every row with
`mime_type=get_mime_type(entry["rel_path"])` (returning `text/plain` for `.srt` in this
image, confirming D10) and **all 26 tests in `test_subtitles_list.py` stay green** — the
wire assertion cannot see a field pydantic discarded, and neither can a
`model_fields` check. The guard has teeth only if the model FORBIDS extras, which turns
the same construction into a `ValidationError` and a 500. So `SubtitleTrack` and
`SubtitleList` carry `model_config = ConfigDict(extra="forbid")` with the reason written
beside them, and `test_no_entry_carries_a_mime_type` pins **three** things — no
`mime_type` on the wire, none in `model_fields`, and `extra == "forbid"` — because
deleting that one config line would otherwise disarm the test without failing it.
Measured both ways: with `extra='forbid'` the mutation reddens 8 rows; with
`ConfigDict()` it reddens none, and deleting the config reddens only the third
assertion.

**2. Composing task 4's dedup into task 8's list drops a servable track, and no task owns
the decision.** `dedupe_by_language` collapses a language across whatever list it is
handed, and task 8's envelope is the first place that list is a whole torrent. Two
measured consequences, both fixed in `api/subtitles.py::_deduped` by grouping on
`(video_index, convertible)` before deduping:

* Deduping a four-episode pack in one pass keeps **one** English sidecar for the pack
  and silently discards the other episodes' — the row the television needs for the
  episode on screen is simply absent. (Mutation `groups.setdefault(0, ...)`: reddens.)
* Dedup's tie-break is `(forced, len(path), path)`, which knows nothing about format.
  `Subs/Pack.S01E02.en.ass` and `Subs/Pack.S01E02.en.srt` are the **same length** and
  `.ass` sorts first, so deduping the two convertibility classes together supersedes the
  only servable English track with one stage 9 refuses to convert (D17) and the viewer
  loses English for that episode. (Mutation `groups.setdefault(entry["video_index"], ...)`:
  reddens.) D21 says "prefer non-`forced`, then the shortest path" and stops there; D17
  says `.ass` ships as a listed row with `convertible: false`. Nothing in either decides
  what happens when both apply to one language, and the naive composition picks the row
  that cannot be served.

**Also, smaller:** task 8's `?file_index=` validation cannot be unconditional. The
television passes the index it is watching, and an **evicted** torrent has no file list
to validate against (D5), so a 404 there would replace `Subtitles · unavailable` with
"The box doesn't recognise this title." — the exact sentence D6 exists to prevent. The
validation is therefore gated on `coverage != "unknown"`, with its own row
(`test_an_evicted_torrent_with_a_file_index_is_still_a_200`); making it unconditional
reddens that row and nothing else. And task 8(g2)'s registry assertion is **unobservable
through `TestClient`**: its blocking portal closes the event loop with the request, which
cancels the fetch task, runs its `finally`, retracts, and drops the key — so the registry
reads empty and the admission recorder has picked up the retraction's
`piece_priority(p, 0)`, both of which look exactly like a handler that started no task.
The three rows that look at the driver use `httpx.ASGITransport` on the test's own loop
and set `torrent_manager._loop` the way `test_await_pieces_async.py:35` does, because
`start_update_task` (`manager.py:387`) is a startup event no module-level `TestClient`
ever runs and `await_pieces_async` begins with `self._loop.create_future()`.

### C5 — The review round: ~20 more assertions that could not fail, six findings that needed a decision, and a 10× figure that had reached production

Nine adversarial reviews, one per task, each required to redden what it read. **Yield: ~20
assertions that could not fail**, in a stage whose plan prescribed a mutation for every
assertion and whose **Notes** open on the 34+ that stage 8 found. Prescribing mutation is not
running it. Three shapes recurred, and they are worth recognising on sight:

* **A comment asserting a mechanism nothing tests.** Task 1's fake claimed a branch guard that
  deleting the fake's own fields left green (`6e39688`); task 6's N1/N2 input-leniency claims
  (`7df20f3`, `79273c6`); task 9's `reads` recorder had no positive control at all — replacing
  `_read_sidecar_bytes` with an inline `open()`, the exact refactor its docstring exists to
  prevent, left all 22 rows green, while one of those rows' `reads == []` was the **sole**
  instrument for "resolution goes through the lister" (`c2bd47b`).
* **A fixture where both branches agree, so deleting either is green.** Task 7's span fixture was
  two files with the sidecar last at index 1 — and 1 is also the flush's first priority, so the
  asserted `[(1, 1), (1, 0)]` was its own transpose: an argument swap and "the last index" were
  both blind (`fa43e8e`, four files now, sidecar at index 2, piece-unaligned). Task 6's `&` row
  had every `&` already bare, so the unconditional escape had no instrument (`79273c6`).
* **A guard duplicated, so deleting either copy is green.** Task 4's null rule was stated twice —
  "collect the winners, then add every null" says the same thing as "never group a null" — and
  with two statements of one rule neither deletion reddens. It is now a single `continue`
  (`backend/app/subtitles/naming.py:674`), with the shape written beside it at `:660-668`.
  (Both line numbers RE-RESOLVED in the following review round: `fa4d806` inserted the proximity
  tiebreak above them and moved the `continue` from `:518` to `:674`, and a citation that still
  reads `:518` now lands in the middle of rung 1. Checked by opening every `naming.py:NNN` in
  this document.)

**The six findings a reviewer reported rather than fixed, each with the decision taken and the
commit that implements it.** All five sibling commits are in `git log --oneline master..HEAD`;
none is missing.

1. **Task 4, finding 1 — rungs 1 and 2 returned on the first match.** Measured on the
   multi-season "Complete" shape D20 cites to justify rung 2: a Season 1 sidecar paired to
   Season **2**'s episode, flipping with file-index order, and reported as `stem`, which
   `track_label` renders as a plain "English" with nothing to confess. **Decision: a rung that can
   be wrong must not outrank the rung that checks.** Rungs 1 and 2 collect every claimant and
   return only on exactly one, otherwise **falling through** (a later rung still resolves per-episode
   folders). This re-decides D20 and says so in `pair()`'s docstring. `f049a5f`.

   **AND THAT DECISION WAS INCOMPLETE — the agent that made it said so, with a measurement, and it
   was right.** Both rungs compare basename stems only and ignore where the sidecar **sits**. The
   shared-directory depths for the two fixtures above are **{0: 1, 1: 2}** — measured in a one-off
   container, for the basename sidecar and the `Subs/E01/` one alike — so index **1**, Season 1's
   own file, is derivable uniquely and in either file order. Refusing therefore yielded **no
   subtitle at all** for every sidecar in the layout D20 cites to justify rung 2, which is a very
   common release shape. **Decision: rungs 1 and 2 break an ambiguous claim by DIRECTORY PROXIMITY
   — the strictly greatest count of shared leading path segments — reported as a sixth
   `pair_source`, `near`, with its own suffix; and they decline only when proximity cannot break it
   either.** Order-independent by construction (the maximal set's size is checked, never
   `max(claimants, key=…)`, which returns the first maximal element). Rung 3 keeps its outright
   refusal. Honest silence beats a wrong answer; a right answer beats both. `fa4d806`, which
   records in its own body the three things this costs: a guess now pre-empts rung 3's check (said
   to be "same index, weaker reported source" — see below, it was not), `near` does not say which
   rung guessed, and mutation (3) of the brief's prescribed list — scoring the full paths instead
   of the directories — is **green** and cannot be reddened by a realistic fixture, because the two
   scorings differ only when a release ships a folder named exactly `E01.en.srt`. Annotated in
   `_nearest_claimant` in the shape of task 4's X2, named rather than claimed.

   **AND THAT DECISION WAS ALSO INCOMPLETE — the reviewer enumerated the pre-emption instead of
   reasoning about it, and "same index" was false.** Over **720,657** coherent two-video layouts,
   **68** answer a *different index* under proximity than under the parse. The worked case is a
   packer's misfile — a sidecar named `Show.S02E01.en.srt` filed under Season 1's `Subs/` tree —
   where rung 2 fires on the bare `E01` parent folder, proximity reads the leading segments and
   says Season 1, and the sidecar's own name says `S02E01`: a right answer (`(1, "parse")`) traded
   for a wrong one (`(0, "near")`), rendered "nearest of several matches" with no error anywhere.
   **Decision: the proximity answer is HELD and consumed at a new rung 3b, after the parse has
   declined; rung 1's held candidate outranks rung 2's.** Both motivating fixtures are unaffected
   (rung 3 cannot parse a bare `Season 1/E01`), so deferring gave up nothing, and the rule
   `f049a5f` stated and `fa4d806` broke is restored: a rung that can be wrong must not outrank the
   rung that checks. Five mutations pin the order; one of them — rung 2 overwriting rung 1 — shipped
   **green on all 51 rows** with a comment claiming the precedence, i.e. the fix for the review
   round's finding reproduced the review round's own shape, and needed the one layout that can
   discriminate it (`test_the_stem_rungs_held_answer_outranks_the_directory_rungs`, all 24 orders).
   D20 carries the full contract and the measurements.
2. **Task 1 findings 5/6 and task 6 — two test-only degeneracies**, above. `fa43e8e`. It also
   corrects the brief that commissioned it: of the three mutations said to be green, **two were**.
3. **Task 9, finding 3 — the format gate consulted `row["reason"]`,** so a non-convertible row
   whose stat raised a non-absence `OSError` answered `415 {"reason": "unreadable"}` — a pair the
   route's own matrix forbids. **Decision: a non-convertible row is refused by its FORMAT,
   unconditionally**; the format gate stays first and no longer reads the reason, because an
   extension is a permanent refusal and must outrank a transient read failure. `48a3539`.
4. **Task 7, finding 5 — the gate-4-refused retraction cleared the PLAYHEAD's deadlines.**
   `reset_piece_deadline` ran over the whole span before the gate-4 re-check, i.e. over pieces gate
   4 had just identified as a wanted video file's — reachable with no admission of ours to withdraw.
   **Decision: the retraction touches only pieces the admission could have raised.** Gate 4 is
   re-checked first on **both** exits and a refusal makes the call a true no-op. Finding 6, the same
   commit: `SidecarAdmission`'s docstring claimed "`refusal` is a 409: the admission did not happen",
   false for `SIDECAR_REFUSAL_NO_DRIVER`. `b04ec3b`.
5. **Task 3, finding 4 — the lister filled the SHARED `_contiguous_runs` memo,** whose overflow
   policy is `if len(...) > 64: clear()`: a four-episode pack with D4's 20-language tree inserts 80
   keys in one call and the `.clear()` takes the seek boundary's own cached run with it. Key
   isolation (D7) is not capacity isolation. **Decision: `contiguous_available` takes a keyword-only
   `memoize`, and `memoize=False` neither reads nor writes** — not write-only-skip, because a
   read-only lister would still hand a cached `complete` to the honesty gate. `fd615ff`.
6. **Task 6 finding 2 and task 2 finding 5 — this plan was wrong about shipped behaviour and about
   its own arithmetic.** Fixed in this entry's own commit, below.

**This plan's three corrections.**

* **The cue-setting tail: `:169` and task 6's `Does not` list at `:692` said the converter does not
  strip it, which read as a description of the output.** It is not. The converter **tolerates** a tail
  on **input** — nothing hunts for it, the cue still parses, and
  `test_a_timing_line_with_a_tail_still_yields_its_cue` pins exactly that (anchoring the timing-line
  regex just after the second timestamp turns every DVD-rip sidecar and every settings-bearing `.vtt`
  into a flat `no-cues` refusal) — and does not **reproduce** it on output, because the prescribed
  output grammar is anchored at both ends and the timing line is re-emitted from the parsed fields.
  The implementer disclosed this as its own correction #3 and was right. Both sites now make the
  input/output distinction explicit; tasks 8, 9 and 16 read that line as a description of the
  converter. `<font …>` stays in the `Does not` list — that one is true and tested.
* **The 1.6 GiB figure was 10× off, and it had reached production as a cap's justification.** 20
  sidecars × an 8 MiB piece is **160 MiB**. ~1.6 GiB needs ~200 sidecars — a 20-language × ~10-episode
  **season pack**, which is a real release but is not what "a 20-language `Subs/` tree" says. The
  figure stood at **eight** sites and was inherited verbatim from this plan into five of them. All
  eight now state `N_sidecars × piece_length` with the arithmetic visible: this plan's `:48`, `:68`
  and `:281`; `2026-10-20-tv-stage9-design-notes.md:126-132`; `backend/app/config.py:177-192`, the
  cap's stated justification; `backend/tests/test_subtitle_config.py:107-113`; and
  `backend/app/torrent/manager.py:2453-2460`. The eighth was found by grep rather than named in the
  correction's own list: `backend/tests/test_sidecar_admission.py:442-449`. **Nothing follows from the correction**:
  the cost is still piece-shaped and not byte-shaped (160 MiB of pieces for ~600 KB of text), §7.5's
  "(kilobytes)" is still wrong by orders of magnitude, and `subtitle_admit_max_pieces = 4` is
  unchanged and is not re-opened on the strength of this. **Measured, and the reason it spread:
  nothing could see it.** The suite is 1705 passed at `fd615ff` with the wrong figure standing in all
  four backend files; the cap's *value* is asserted (`== 4`, `test_subtitle_config.py:120`) but its
  *justification* is prose, so a 10x arithmetic error in a production comment is invisible to every
  instrument in this repo. Check the arithmetic by reading it, which is why it is now written out.
* **C2's baseline needed no fix.** Task 2's review reported "C2 declares the backend baseline to be
  1446, but I measured 1441 pre-task-2". Re-read in full: C2 part 1 is headed "The 1441 baseline is
  right", states `8619e0f` = 1441, and records 1446 only as task 1's own *wrong* first measurement
  with the reason it was wrong; C3 carries the lesson forward. C2 was self-corrected during the review
  round and the reviewer read a transient state. No wrong figure remains in either document — checked
  by grep over every four-digit count in both.

**Two decisions taken NOT to change anything. Grounds recorded so they are not re-opened.**

* **`coverage` keeps THREE values.** Task 3's review finding 2 is right on the facts: `none` is
  returned both when a release ships no sidecar and when every sidecar was **excluded** (over
  `subtitle_max_bytes`, outside `subtitle_extensions`, or escaping the save path), so the television
  reads "none" where the truth is "excluded". A fourth value is **declined**: the two cases are
  indistinguishable in what the **viewer** can do about them, and the operator already has the
  distinction — the lister logs each exclusion by name and reason at INFO. The docstring is already
  honest about it. The frontend half (tasks 10–16) is not built, so this is the **cheap** moment to
  reverse it; a device reading that shows a real release reading "none" for the excluded reason is
  grounds to add the value, and after task 12 ships it is not.
* **The WebVTT route stays `async def`.** Task 9's review finding 5 measured a 4.02 MB SRT costing
  **173 ms of CPU** in `to_webvtt`, on the event loop that also serves `/video` Range requests —
  several times worse on ARM; a typical 100 KB sidecar is ~4 ms. Dropping `async` to get the
  threadpool would also move `list_sidecars`' libtorrent calls there, which is a thread-safety
  decision with a blast radius past stage 9. **Parked as a stage-10 item**, with the 173 ms recorded
  here so stage 10 does not have to re-measure it.

**The low-severity items left standing, so they are not lost.**

* **Gate 4's overlap boundary is green in the conservative direction only** (task 7, F3): a fixture
  that over-refuses is not distinguished from one that refuses correctly. Now *incidentally*
  reddened by the `SHARED_LAST_PIECE` fixture added for the last-piece row
  (`backend/tests/test_sidecar_admission.py:113-118`, used at `:371-395`) — incidentally, which is
  not the same as pinned.
* **`f_size <= 0` (`backend/app/torrent/manager.py:2427`) and the flush's `contained_path`
  (`:2585`) have no row** (task 7, F4).
* **`_SIDECAR_FLUSH_WAIT_S`' comment (`backend/app/torrent/manager.py:88-95`) states libtorrent
  2.0's missing write cache as settled fact when it is unmeasured here** (task 7, F7). The
  constant's own escape hatch ("if a real device ever shows the file arriving later, raise it")
  is the mitigation, not a test.
* **Task 4's X2 is undiscriminable by any realistic fixture and is annotated rather than tested**
  (`backend/app/subtitles/naming.py:265-271`, moved from `:247-253` by `fa4d806`): the
  `len(segs) < 2` conjunct in `_torrent_root` (named `_common_root` here by mistake) can
  only change an answer for a top-level file named exactly like the folder every other file sits
  under. Named there rather than claimed.

### C6 — Task 16: the prescribed `grep -c` is unsatisfiable, two MORE spec citations were stale, and a docstring fix had to be line-count neutral

Six measurements, from the documentation task. Four of them are about citations, which is what
this task exists to fix.

**1. `grep -c 'not taken' …device-readings.md` cannot equal 12, and the figure is the count of row
NUMBERS.** Measured on the sheet as written: **26** lines, 26 occurrences. The sheet has
**fourteen rows** under twelve numbers because this plan's own table splits 27 and 29 into a/b;
rule 1 then requires reading 27a's six facts in six separate cells (its own words: a zero-cue
reading and an invisible-cue reading "may not share a cell"); and rules 1 and 2 use the phrase
themselves. For scale, **both sibling sheets measure 75.** The three replacement falsifiers, all
run: `grep -c '| \*\*not taken\*\* |'` = **20** (14 row-status cells + 27a's six facts); all
**14/14** data rows of the rows table end in `**not taken** |` (header and separator excluded);
and `grep -nE '\|\s*\|\s*$'` returns **nothing** — no table row has an empty final cell, which is
what "a blank is a failure, not a pass" actually asserts. A hand-maintained total is the
count-pin shape of hazard 15; the per-cell form reddens on the blank instead of on the
arithmetic.

**2. The stale `1226-1228` was at two sites, as the brief insisted — and two OTHER Python
citations in the same spec were stale, one of them into the same function.** `grep -c '1226-1228'`
= 2 (§4.4, §7.5), confirmed before editing. Then, by grepping **every** `*.py:<line>` in the file:
§4.2 point 4 cited `torrent/manager.py:1389-1401` for `stream_file_range`'s hard `cap = 300.0`,
and that range now lands inside `get_completed_video_file_info` (`:1323`), at its gate 3 — the
same function `1226-1228` was landing in at the stage-8 merge, where it was that function's
docstring. In *this* tree `1226-1228` straddles the end of `precompute_episode_map` and the `def`
line of `_persist_episode_map`, i.e. it is inside no function at all, which is how the guard
reddens on it. Re-resolved: `stream_file_range` at `:1778`, the cap at
`:1864`, the truncating `return` at `:1876`, and **the defect is unchanged and still live** —
`piece_timeout`, which would replace the flat 300 s, is passed by no production caller. §4.5's
`main.py:188-191` for the bodiless 401 is `:205-208` on this branch (`:193-196` at the stage-8
merge, which is the figure task 16's text carries — the task text itself says `:194-196`, the
def-only span of the same handler). Both corrected. **Four stale citations in one
spec, found by grepping a pattern rather than by reading the two the brief named.** *(Task-16
review: the same section's two `VideoPlayer.tsx` citations were stale too and were left as
out-of-scope, with `:1020` named as the replacement — also wrong. `handleError` is
`VideoPlayer.tsx:1032-1059` and the `downloadProgress < 100` route into `attemptRecovery()` is
`:1035-1038`; both re-resolved in place, line-count neutral, because §4.5 sits above every
`:NNN` reference this plan and the readings sheet make into that spec. The guard does not police
`.tsx`, so that correction is unprotected — a fifth stale citation in the one section the task
rewrote is what being out of the guard's reach looks like.)*

   *(Task-16 review, and this is the bigger half of the same finding: "four stale citations in one
   spec" is an undercount, because the grep that found them ran over the two paths the guard
   polices. The spec carries **sixteen** `*.py:<line>` references; six are policed and **three of
   the ten that are not were stale as well.** `providers/quality.py:12` — §4.3's authority for the
   codec regex — is a BLANK LINE inside that module's docstring; `_CODEC` is at `:35`. And
   `specCitations.test.ts`'s own header used that citation as its example of a module-level
   citation out of reach, so the guard's excuse was itself stale. `services/auth.py:455-473`, cited
   in §6 for the session cookie's attributes, lands in `purge_expired`; `cookie_kwargs` is
   `:485-503` and `max_age` is applied in `api/auth.py:133-136`. Both corrected in place,
   line-count neutral. **Not corrected, because it needs a decision this review will not take:**
   §4.2 point 1 cites `backend/app/api/streaming.py:62-64` for
   `ranges = range_header.replace('bytes=','').split('-')`, and that expression exists nowhere in
   `streaming.py` any more — `:62-64` is the `RANGE_MALFORMED` constant and the parser is
   `:94-101`. Re-resolving it means first deciding whether §4.2's defect 1 still describes live
   behaviour after stages 7-8 rewrote that parser, which is a scope call, not a line number.
   Widening the guard's `SOURCES` does not reach any of these three: two land in a `def` their
   sentence does not name and one is module-level, so the guard's shape — "a def whose name the
   sentence contains" — would redden on the honest document. That is a prose change per citation,
   not a config change, and it is unowned.)*

**3. This plan's own backend citations are ~+124 lines off in this branch's tree.** The branch's
commits inserted that much above them: the false docstring at `manager.py:1140-1143` resolves at
**`:1264-1267`**, and hazard 1's `manager.py:328` (wanted-progress is `status.progress`) at
**`:452`**. Recorded because the task text says to correct a docstring at a line number that is no
longer that docstring, and because `bigscreen.css` moved the same way for the readings sheet's
rows: `.bs-player__bar`'s `position: relative` is `:980-981` (plan: `:957-958`),
`flex-wrap: nowrap` is `:991` (`:968`), `isolation: isolate` is `:944` (`:933`),
`.bs-player__track` is `:1028` (`:1005`). `:893-896`, `:899-901` and `:910-915` still resolve.

**4. The docstring correction had to be LINE-COUNT NEUTRAL, and that is not a style point.**
**fourteen** citations of the form `manager.py:<line>` in `backend/app` and `backend/tests` point
at lines below 1264, across **eight files**, and all fourteen were written and verified by this
branch's own tasks (`api/subtitles.py` ×3, `models.py:1291-1292`, `subtitles/sidecars.py`,
`test_sidecar_lister.py` ×3, `test_prioritize_video_files_list.py` ×2, `test_subtitles_list.py`
×2, `test_subtitles_vtt_route.py`, `test_sidecar_admission.py`). Another **98** sit in the
`docs/` tree — **68** of them in `docs/superpowers/plans/`, 46 of those below 1264. *(The "22"
that stood here, and the same figure in `specCitations.test.ts`'s header, were wrong: corrected
by the task-16 review, measured with `grep -roIE '…manager\.py:[0-9]+' docs` minus the
`test_content_guard_manager.py` and `assets/manager.py` spellings.)* A first draft of the correction ran to 28 lines and
shifted every one of them, including the three the spec edits had just been written against. The
shipped version replaces the four false lines with four true ones — `git diff --stat` is **4
insertions, 4 deletions** — so `skip_non_video_files` stays at `:1629`, `prioritize_video_files`
at `:1646` and `stream_file_range` at `:1778`. **A docstring fix in a heavily-cited file is an
edit with a blast radius, and the only safe size is the one it replaced.**

**5. The optional docs test shipped, and ten mutations say it discriminates.**
`frontend/src/app/(bigscreen)/specCitations.test.ts` (4 tests) resolves every
`torrent/manager.py:` and `main.py:` citation in the spec into the `def` whose block contains it,
and requires the citation's **own sentence** to name that def — the brief's "surrounding sentence"
read as a paragraph would have been green under a swap, because §4.4 and §7.5 each name both
selectors a few words apart (the "degenerate tuple that hides an argument swap" shape; measured on
that assertion alone, with §4.4's two citations swapped — sentence window **RED**, paragraph
window **GREEN**, and green on the honest document too, so the difference is the swap and nothing
else). **Twelve mutations: eleven reddened and the twelfth is the control above, deliberately
green.** The eleven: the brief's own (revert either site to `1226-1228`), a swap at each of the
two sites, a range leaking one line past a `def`'s block, the same at `main.py`'s decorated
handler, a sentence that stops naming the function it cites, a citation stripped of its path,
**a comment line inserted above `prioritize_video_files` in production** (the drift that caused
all four stale citations), a production rename of `skip_non_video_files`, and narrowing the
guard's own path matcher to exact keys — which makes it blind to the long and bare spellings this
spec already uses elsewhere, the "matcher so specific it misses the live spellings" shape, caught
by a three-spelling fixture rather than by the document. Two more findings from writing it: a
FastAPI handler's natural citation
includes its `@app.exception_handler` line, so a def's span starts at its first decorator
(without that, §4.5's honest `main.py:205-208` reads as "inside no def at all"); and **a pytest
cannot host this guard at all** — `backend/Dockerfile` copies `app/`, `tests/`, `serve.py` and
`shell.py`, so `docs/` does not exist in the image the backend suite runs in. It sits under
`(bigscreen)` so it runs in `npm run test:tv` **and** `npx vitest run`; hazard 16 is why that
placement is deliberate.

**The three frontend counts, measured not quoted (C3's lesson), in a `git worktree add --detach`
at task 16's parent `4ec439a` so no sibling's uncommitted work is in them:** `npm run test:tv`
**1388 → 1522 passed / 61 files** and `npx vitest run` **2340 → 2483 passed / 149 files** — i.e.
the plan's branch-start figures are stale by the branch's own fifteen tasks, and a task that
quoted them would have reported a 134-test fiction. `tsc --noEmit` clean, `npm run build`
compiles. Task 16 itself adds **4** tests in **1** file (the citation guard): **1526 / 62** and
**2487 / 150**, each held across 15 and 3 consecutive runs respectively.

**6. Smaller, and both already corrected in place.** Hazard 17's "`frontend/public/samples/` IS
EMPTY" is stale — task 15 committed the two `.vtt` cue probes into it behind a
`!/public/samples/*.vtt` negation, and the blocker is a **video**. And the device-readings section
above said "Four rules inherited verbatim" while task 16 said five and both sibling sheets list
five under a header that says four; the new sheet carries five and names the two that are stage
9's own.

---

### C7 — The press that chooses a sidecar never asked for its bytes: `fetchSubtitle` and `pollSubtitles` shipped with no production caller

**Found by task 14's reviewer, and no earlier review could have found it.** `grep -rn 'fetchSubtitle\|pollSubtitles' frontend/src/ | grep -v '\.test\.'` returns three lines at `6239575`, and **all three are comments**. Task 11 built the service call and the bounded poll and tested both to this stage's standard; task 12 built the cell that reports the wait; task 13 built the element that mounts when the wait ends; task 14 built the picker that takes the choice. Every one of the four is correct and every one of its reviews was right to pass it. **The wire between them was never assigned to anybody.** Re-read task 11's section and task 14's: 11 ends at "`_data/subtitles.ts` holds the pure helpers … and the bounded poll", 14 ends at the choice being committed to route state, and nothing in between says who sends the POST. D2 says "the television learns the outcome by polling the list" without ever saying which task makes it poll.

**What that cost, measured rather than asserted.** A sidecar sits at file priority 0 in every release this stage can see — that is D1's whole premise and task 0's measured mechanism — so `ready: false` is the **normal first answer for every sidecar the lister reports**. The path that works without the wire is only the gate-4 no-op case C1 measured: a sidecar sharing a piece with a wanted video file, whose bytes were already coming. So the shipped behaviour was: choosing any sidecar whose bytes are not already present sets the cell to `fetching`, sends nothing, reads nothing again, and leaves that word on the screen for the rest of the film. `SUBTITLE_CELL_LABELS.fetching`'s own comment — "Chosen, admitted, and the bytes are not here yet" — named an admission that never happened, and `chosenCellState` had no arm for `exhausted`, `gone` or `error` because nothing could produce one.

This is stage 7's inert-repair shape with the inversion task 14's reviewer named: there, one function's docstring claimed a round-trip it never completed; here, four correct components each describe a neighbour that was never connected to them. **The lesson is about where a per-task review cannot see.** Nine backend reviews and seven frontend reviews, every one of them adversarial and mutation-driven, and sixteen of sixteen passed a stage whose main path was dead — because each review's blast-radius check asks "did this task touch anything it did not name", and the defect is a thing **no** task touched. The check that finds it is a grep for a production caller of every exported symbol the stage adds, and it belongs in the whole-branch pass, not in a task's.

**Task 17 is the wire.** The decisions it ships, taken here rather than left to it:

1. **The press sends it, not an effect.** Driving it from an effect keyed on `chosenIndex` would not re-run when the viewer picks the same entry again, which is exactly the press a viewer makes after `not arriving`. The plan already says the poll "belongs to the press that chooses one, not here" (task 11's section, of the read effect) — this makes that true of the POST as well.
2. **A ready entry sends nothing.** Admission re-deadlines pieces; for a file already complete on disk that is a cost with no benefit, and D4's budget is a shared resource. The element's own `!chosen.ready` gate stays the only thing between a choice and a load.
3. **A ninth cell state, `notArriving`, label `not arriving`.** `exhausted`, `error`, a 409 from a refused gate and a thrown POST all land on it. It is a ninth state rather than a reuse because the stage has twice refused exactly that conflation — `none`'s double meaning (`2e15d54`) and the 415/`unreadable` pair the format gate stopped producing (`48a3539`) — and because `unreadable` means the bytes arrived and the load still failed, which is the opposite measurement. Not `stalled`: `messageFor` already carries a playback `stall: 'ok' | 'frozen' | 'buffering'` and two things called stall on one screen is how a word stops meaning anything. The cell does **not** name which of the four causes it was; the operator has the backend log, and the viewer's next press is the same for all four. That is the same judgement, with the same grounds, as "EVERY FAILED READ IS `unavailable`" already in the read effect.
4. **`gone`, `none` and `unknown` need no arm and get none.** Each of them changes the *list*, and a refreshed list makes `chosen` null through the route's own `.find(...)`, so the list-derived arms answer and the picker stops offering the row. Adding a cell state for them would be a rule written twice — this plan's own recurring finding.
5. **A generation guard, because this is a second async write path into the same state.** Task 12's review found and fixed this exact class twice in the read effect (the leading `loading` reset, and the `catch`'s `!cancelled`), and a poll that outlives an episode change would write the previous episode's list over the current one — on a season pack, another episode's sidecars. One monotonic counter, bumped by the read effect (so a title or episode change cancels) and by every press (so a new choice cancels the poll the last one started), checked by `isCancelled` and again before every `onList` write.
6. **`mayHide` is NOT touched and the band does not stay up for the fetch.** D12 refused subtitle state in `message` because a steady sentence pins the 480px band over the picture; a fetch may run 48 s, which would be the worst instance of exactly that. The cell is the channel, and a press is how the viewer reads it.
7. **`reloading` stays NOT CONSULTED by `chosenCellState`, and is now named there** — task 13's reviewer left this open. During a `video.load()` recovery the element unmounts the `<track>` (D14) while the cell still says `on`. Measured: both recovery kinds put a sentence on the band (`messageFor`: "Lost the stream — trying again (attempt N)."), which makes `message !== ''`, which suppresses the auto-hide — so the viewer is already being told what is happening, by the channel that owns recoveries, beside a cell whose word describes their choice rather than the element's momentary absence. A word that flickers for the length of one `video.load()` is less honest than one that does not. Named in the function, in the shape of its own `convertible` paragraph, rather than fixed.

### C8 — Task 16's reviewer refused to patch one line number in the spec's §4.2, and was right: five of that section's six claims are code stages 7–8 already fixed

The review's verdict was that §4.2's premise line still cites `backend/app/api/streaming.py:62-64` for `ranges = range_header.replace('bytes=','').split('-')`, that the expression exists nowhere in the file, and that re-resolving it was a scope call a review would not take. Taken here, by measuring every claim in the section against `7eb3960` rather than by moving the citation:

| §4.2 claim | measured | where |
| --- | --- | --- |
| the premise: a one-line `replace`/`split` parser at `:62-64` | **gone.** `:62-64` is `RANGE_MALFORMED`'s comment; the parser is a 50-line `parse_range_header` with four sentinels | `streaming.py:59-147` |
| 1. suffix ranges silently serve the first N bytes | **FIXED.** `bytes=-N` returns `max(0, size-n), size-1`, with `bytes=-`, `bytes=--5` and `bytes=-0` each separated | `:113-125` |
| 2. multipart and non-numeric ranges 500 | **FIXED.** `','` → `RANGE_MALFORMED` → ignored, 200 full body; non-numeric caught by `except ValueError` | `:105-106`, `:130-131` |
| 3. `HEAD /{id}/video` is a bare 405 | **FIXED.** `@router.head` exists, and its own comment records this history | `:205-213` |
| 4. the flat 300 s cap truncates below `Content-Length` | **STILL LIVE**, exactly as task 16 re-resolved it: `piece_timeout` exists as a parameter and no production caller passes it | `:1780`, cap `:1864` |
| Related: eight extensions have no `VIDEO_MIME_TYPES` entry | **FIXED.** All eight (`.m4v`, `.ts`, `.m2ts`, `.mts`, `.vob`, `.3gp`, `.mpg`, `.mpeg`) are present; the map holds 16 | `:32-48` |
| Related: 416 whenever `file_size <= 0` | **FIXED.** `RANGE_FILE_NOT_READY` → 503 + `Retry-After`, and the sentinel's comment describes this exact history | `:66-72`, `:85-89` |

So the section reads as six live defects in a backend that has one. **Why no citation guard could reach it:** `specCitations.test.ts` resolves a citation to the `def` whose name the sentence contains, and `:62-64` sits in module-level constants inside no `def` at all — the same blind spot the guard's own header already admits for module-level citations, which is finding 3 of task 16's review (and the excuse that header gave was itself a stale citation). A guard that policed this one would have to assert that a quoted expression still occurs in the file, which is a different instrument from the one this stage built.

Task 17 corrects §4.2 in place, each claim marked fixed-or-live with its measurement, in the dated-re-resolution form bullet 4 already carries. **The named limit:** stages 7 and 8 rewrote this file heavily, and §4.2 is the only section of §4 measured. §4.1 and §4.4–§4.5 may carry the same staleness class and are **not** audited here — that is a bounded sweep for whoever opens the spec next, recorded rather than silently left.

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

**Does not:** use ffmpeg. Does not convert ASS/SSA. Does not strip `<font …>`. Does not **hunt for** a cue-setting tail either — a DVD-rip `X1/X2` tail or a real `.vtt`'s own settings are tolerated on **input** (the cue still parses; no code here searches for the tail or deletes it) and are not reproduced on **output**, because the emitted timing line is re-built from the parsed fields under a both-ends-anchored grammar. Tasks 8, 9 and 16 read this line as a description of the converter: it is about input tolerance, never about output fidelity (C5). Does not emit a `line:` cue setting. Does not lean on any measured Chromium 155 leniency. Does not cache. Does not touch `get_mime_type` or `VIDEO_MIME_TYPES`.

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

**Mutate.** The falsifiers are mechanical and must be run. `grep -n '1226-1228' docs/superpowers/specs/2026-09-22-webos-tv-app-design.md` returns nothing. ~~`grep -c 'not taken' docs/superpowers/plans/2026-10-20-tv-stage9-device-readings.md` equals 12.~~ **That figure is the count of row NUMBERS and no sheet in this format can satisfy it — measured 26, against 75 in each sibling sheet; see C6.** Use instead: every data row of the rows table ends in `**not taken** |`, `grep -c '| \*\*not taken\*\* |'` equals the number of status cells the sheet declares, and `grep -nE '\|\s*\|\s*$'` returns nothing, which is what "a blank is a failure" actually asserts. `grep -rIn -- '\.ass\b' backend/app frontend/src` returns only deliberate stage-9 occurrences. **And the docs test is no longer optional: it shipped** as `frontend/src/app/(bigscreen)/specCitations.test.ts`, asserting every `manager.py:<line>` and `main.py:<line>` citation in the spec resolves into a `def` whose name the citation's **own sentence** contains — mutation: revert one citation to `1226-1228` → reddens. That mutation is worth having: this stale citation survived two spec sites, six recon passes and four designs. A paragraph-wide search would NOT have been worth having: §4.4 and §7.5 each name both selectors a few words apart, so a swap stays green under it — measured on that assertion alone, sentence window red and paragraph window green.

**Depends on:** all.

---

## Task 17 — The press that chooses a sidecar is the press that asks for its bytes

**Files:** `frontend/src/app/(bigscreen)/bigscreen/watch/[id]/page.tsx`, `frontend/src/app/(bigscreen)/_data/subtitles.ts`, `frontend/src/app/(bigscreen)/_data/subtitles.test.ts`, `frontend/src/app/(bigscreen)/bigscreen/watch/[id]/page.fetch.test.tsx` (new). No change to `SubtitleTrackElement.tsx`, to `SubtitlePicker.tsx`, or to any service.

Per **C7**, which holds the seven decisions and the grounds for each — read it before this section. The whole task is: on a press that chooses an entry which is **not** `ready`, send `fetchSubtitle` once and then run `pollSubtitles`, feeding every answer back into `subtitleRead` so the cell, the picker and the element all see the same list; and give `chosenCellState` the one arm it is missing.

`chosenCellState` gains a third input and a ninth state (`notArriving`, label `not arriving`, added to `SUBTITLE_CELL_STATES` and `SUBTITLE_CELL_LABELS` — `tsc` enforces the `Record` is exhaustive, so a missing label cannot compile). Arm order: `chosen === null` → `null`; `fault` → `unreadable`; `chosen.ready` → `on`; the fetch verdict → `notArriving`; else `fetching`. **`ready` is checked before the verdict deliberately**, and today nothing can distinguish the two orders — a poll that stopped on `exhausted` or `error` leaves the last list unready, so `ready && verdict` is unreachable. It is ordered this way because it is the only order that cannot produce a lie if it ever does become reachable: a mounted `<track>` beside a cell reading `not arriving`. Name it as undiscriminable in the shape of task 4's X2; do **not** write a row that cannot fail to defend it.

The route holds the verdict and one monotonic generation ref. The read effect bumps the generation (so a new title or episode cancels, and its cleanup covers unmount) and clears the verdict beside `setChosenIndex(null)` and `setTrackFault(false)`. The choose handler bumps it too, captures the value, and passes `isCancelled: () => ref.current !== captured`; every `onList` write is guarded by the same test, not only by the poll's own contract. `read` is `() => getSubtitles(torrentId, index, { allow401: true })` — **the VIDEO file index**, so the list stays filtered to the episode on screen — while `pollSubtitles`' own `index` option and `fetchSubtitle`'s second argument are **the sidecar's own `index`**. Those two numbers differ in every season pack and in most single-file releases; a fixture where they are equal cannot see them swapped.

`Off` (a `null` choice) bumps the generation, clears the verdict, and sends nothing.

**Does not:** touch `mayHide` (C7 bullet 6 — a 48 s fetch is the worst case of the pinned band D12 refused), put anything in `messageFor`, add a cell state for `gone`/`none`/`unknown` (C7 bullet 4 — the refreshed list answers through the existing arms), send a POST for a `ready` entry, poll when nothing is chosen, retry a poll that returned `cancelled`, read `convertible` or `reloading` in `chosenCellState` (both are named-not-consulted there, and `reloading` gains its paragraph per C7 bullet 7), import a service into `_data/` (`engineContract.test.ts` bans it and the poll takes `read` injected — that is what the injection is *for*), or change the picker's rows, the element's four gates, or any `_player/` file.

**Mutate.** Every row must have a production change that reddens it, and the prescribed list is a floor — C7 exists because sixteen adversarial reviews passed a dead main path, so invent your own and look hardest at the seams between the four components, not inside them.
(a) Delete the `fetchSubtitle` call, leaving the poll → reddens. Assert the call's arguments exactly: `(torrentId, entry.index)` with `{ allow401: true }`. (b) Send the row's **position** instead of `entry.index` → reddens, on a fixture whose chosen row sits at a position that is not its index. (c) Send a POST for a `ready` entry → reddens; a ready choice must send **nothing**, and the harm is a re-deadline against D4's shared budget for a file already on disk. (d) Drop `allow401` from the POST, and separately from the poll's `read` → each reddens; a mid-film 401 that hard-navigates to `/bigscreen/pair` from inside the interceptor is what the whole opt-out exists to prevent, and a subtitle is never worth a film. (e) Swap the two indices — `read` built with the sidecar's index, and `pollSubtitles({ index })` given the video's → **two** mutations, each reddening on its own. (f) Drop the `onList` wiring → the entry becomes ready and the cell stays `fetching` → reddens. (g) `isCancelled` hard-coded to `() => false` → a second press leaves the first poll running → reddens, and the instrument is the first poll's read count ceasing to grow, not a rendered word. (h) Delete the generation bump from the **read effect** → a poll started on episode A writes A's list over B's after the episode changes → reddens. This is the class task 12's review fixed twice in the same effect; the fixture needs A's answer to arrive *after* B's. (i) Map `exhausted` and `error` both to no verdict → reddens; then each one alone → each reddens, because one arm cannot discriminate the other. (j) A rejected POST (409 with a `reason`, and separately a throw) does not set the verdict → reddens. (k) Gate the POST on `choice !== chosenIndex` → reddens: pressing the same entry again after `not arriving` is the retry, and C7 bullet 1 is why this is a handler and not an effect. (l) Swap `fault` and the verdict in the arm order, and swap `ready` and the verdict → **report whether each reddens**; if one cannot, name it undiscriminable rather than shipping a green row for it.
And the D-pad invariants, verified by rendering: the picker still closes on the press, the ring still returns to the Subtitles cell, the declared row count still equals the cells rendered while a fetch is in flight, and the band still auto-hides during a fetch (which is the point of bullet 6).

**Depends on:** 11, 12, 13, 14.

---

## Task 18 — The diag probe's three status classes, and the bound on cue 1

**Files:** `frontend/src/app/(bigscreen)/bigscreen/diag/page.tsx`, `frontend/src/app/(bigscreen)/bigscreen/diag/page.subtitles.test.tsx`, `frontend/public/samples/cue-probe-line.vtt`.

Task 15's review left three measured greens for a decision. All three are taken as follows.

**F6 — `present: res.ok ? 'yes' : 'no'` calls every non-2xx an absent file, and the gate's own instrument then lies to the operator.** A 500 or a 403 from the static server renders `FILE NOT PRESENT — nothing was mounted` beside a paragraph telling the operator that this build is serving a different tree, which sends them to copy in a file that is already committed. That is the commit's own fix 1 (a thrown HEAD) one status class up, and reading 31 is gated on this probe. **Fix:** three values, not two — `yes` on `res.ok`, `no` on exactly 404, and a third on anything else that prints the status it got. A `no` must mean "the server answered, and said this file is not there."

**F7 — a second divergence can hide inside cue 1's body.** The row that asserts the two probe files "differ by exactly one variable" compares blocks 2–4 and cue 1's *timing* line; cue 1's text is the deliberate exception and is unbounded, so a longer sentence there is green — and a longer cue 1 wraps to a different number of rendered lines, which changes the very cue box reading 32 measures. **Fix:** bound the exception. The text may differ, and its length may not — assert the two cue-1 bodies are within a stated character budget of each other, with the budget's reason written beside it.

**F8 — `preload="metadata"` → `"none"` is green,** and with `none` the set never fires `loadedmetadata`, so the auto-sample path the commit's own F4 fix just instrumented never runs on the device. Pin the attribute.

**Does not:** change what any arm measures, add a focus stop (the diag page mounts no grid — `useFocusGrid` appears there only in comments), touch the gate's row numbering, or take any reading. Does not add GPU-expensive CSS: this file carries `@allow-legacy-probes` and is **exempt** from `legacy-target.test.ts`'s scan, so that claim is unguarded here and must be checked by hand.

**Mutate.** (a) Collapse the third status value back into `no` → reddens, with a non-404 failure fixture (500 and 403 both, since one does not discriminate the other). (b) `res.ok ? 'yes' : 'no'` restored wholesale → reddens. (c) 404 mapped to the third value → reddens; a real absence must still read as an absence, which is the arm the operator acts on. (d) Lengthen cue 1 past the budget → reddens; and (e) change cue 1's text within the budget → stays **green**, which is the exception being preserved rather than removed — assert both, or the bound is just a second equality. (f) `preload="none"` → reddens. (g) Drop the status from the third value's rendered text → reddens; the status is the whole reason the third value is worth having.

**Depends on:** 15.

---

## Task 19 — The stylesheet's own inventory went stale under the picker, and three claims it makes have no instrument

**Files:** `frontend/public/bigscreen.css` (comments only — **no rule may change**), `frontend/src/app/(bigscreen)/_player/playerCss.test.tsx`.

Three reviews left findings in this one pair of files, all comment-or-test, none behavioural.

**The inventory at `:879-889` describes a band that no longer exists** (task 14's review). It lists two users of `.bs-player__hint` ("TWO hint lines, not one") and two `.bs-player__row`s (scrub, transport); the picker is a third hint and up to seven rows. And its reassurance — "The route's line only exists while there is something to say, which is also when the auto-hide is suppressed" — is false of the picker's hint, which is always rendered and is suppressed by `!pickerOpen` instead. D16 made updating exactly this class of comment a requirement, "or it becomes a lie"; task 14's own comment declared this file out of scope, which is how it survived. Correct the counts and name which suppression covers which line.

**`playerCss.test.tsx`'s class-coverage guard cannot see the Subtitles cell** (task 12's review). Its "every rendered `bs-` class has a rule" row renders `<TransportBar>` with **no** `subtitles` view, so every class the sub-line carries sits outside the guard. Pass a view.

**Two of task 10's mutations stayed green and are pre-existing gaps in this file's rows.** Dropping `aria-hidden="true"` from the scrim is green on all 1391 rows — the scrim is decorative and holds no focus, and an `aria-hidden` that nothing asserts is one edit from being announced to a screen reader over the picture. And flattening the gradient to an opaque `var(--ink)` is green, while **three comments in that commit do arithmetic on it** ("~0.82 alpha at 45% of 480px"); a scrim that is opaque instead of graduated is a black band over the bottom 480px of every frame. Pin both — the gradient by the stylesheet-text idiom this file already uses, since jsdom computes nothing from a linked sheet.

**Does not:** change one CSS declaration — this is the file whose rules are measured against the TV's frame budget, and no reading has been taken since. Does not add a token, a class or a GPU-expensive property. Does not touch `TransportBar.tsx`.

**Mutate.** Each of the three fixes needs the mutation that was green before it: drop `aria-hidden` from the scrim → reddens; flatten the gradient to one opaque colour → reddens; delete a `bs-` class's rule while the sub-line renders → reddens, **and** confirm the same deletion was green with no `subtitles` view passed, which is the finding. For the inventory, the falsifier is mechanical and belongs in the comment's own vicinity: the counts it states must be greppable — `grep -c 'bs-player__hint' ` over the rendering files, and the row count the picker can reach from `pickerRowCounts`. If a number in a comment cannot be checked by a command, write the command beside it or do not write the number.

**Depends on:** 10, 12, 14.

---

## Task 20 — The spec's §4.2 describes a backend that has one of its six defects left, and §7.5 quotes a string the television does not render

**Files:** `docs/superpowers/specs/2026-09-22-webos-tv-app-design.md`. Nothing else.

**§4.2, per C8.** Correct all seven rows of C8's table in place — the premise line and the six claims — each marked fixed-or-live with the measurement and the line it resolves to, in the dated-re-resolution form bullet 4 already carries. **Measure every one yourself against the working tree before you write it**; C8's table is my measurement, not your instrument, and four independent scouts in this stage's design round corrected one stale line number the same wrong way. If any row disagrees with what you measure, say so and do not quietly write the other number. Record C8's named limit at the end of the section: §4.1 and §4.4–§4.5 are **not** audited, and stages 7–8 rewrote this file heavily.

**§7.5 gap (2) and the §12 row say the cell "reads `Subtitles · unavailable`"** (task 16's review, finding 6). It does not: the button's accessible name is exactly `Subtitles`, the state rides in a separate `aria-hidden` `.bs-player__commit` span, and no `·` exists anywhere in the cell. The implementer measured this and reported it, then wrote the un-nuanced string into the durable spec twice. The notation is inherited from five prior plan sites, so **the fix is to define it, not to rewrite six sites**: at its first occurrence in the spec, say once that `Name · state` denotes a cell's accessible name and its `aria-hidden` sub-line, which are two nodes and never one string. Then both occurrences are true.

**Does not:** touch §4.3's or §6's citations (task 16 fixed those at `7eb3960`), re-resolve `VideoPlayer.tsx:906-933` again (fixed in `3b410a4`), change any line count above a `:NNN` reference the plan or the readings sheet makes into this file — **verify that with a diff, the way task 16 did, and say which sections sit above which references** — or edit the plan, which I own.

**Mutate.** The falsifiers are mechanical. `grep -n "replace('bytes='" docs/superpowers/specs/2026-09-22-webos-tv-app-design.md` returns nothing but a quotation explicitly marked as deleted code. Every `streaming.py:<line>` and `manager.py:<line>` left in §4.2 resolves to what the sentence says it does — run `specCitations.test.ts` and report whether it polices any of them (C8 says the guard's shape cannot reach a module-level citation, which is why this section rotted; if your edit brings one inside a `def`, the guard starts covering it and that is worth saying). And `npm run test:tv` must be unchanged in count — a spec edit that moves a test number is an edit to something other than the spec.

**Depends on:** 16.

---

## The device readings

New sheet, rows numbered **27 onward** so numbering stays globally continuous and unique. **Five** rules inherited verbatim, not four — this sentence listed four and task 16 asked for five, and both sibling sheets carry five under a header that says four: a verbatim transcribed string or the words "not taken"; **a blank is a failure, not a pass**; transcribe the raw string, never "ok", "works" or "as expected"; **this document has no test, deliberately — the instrument is tested, the sheet is not**; measurement versus assumption called out per row.

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
17. **`frontend/public/samples/` HAS NO CLIP**, so stage 8's rows 16–18 and this stage's 27b are blocked on an artefact nobody has made. **Countermeasure:** 27a's instrument needs no clip. *(Corrected by task 16: "IS EMPTY" was true when this was written and is not any more — task 15 committed `cue-probe.vtt` and `cue-probe-line.vtt` into that directory behind a `!/public/samples/*.vtt` negation in `frontend/.gitignore`, and reading 27a's whole premise is that those two are already there. The blocker is a **video**, and both readings sheets now say so.)*
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
