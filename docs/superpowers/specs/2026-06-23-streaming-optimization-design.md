# Streaming Experience Optimization — Design

- **Date:** 2026-06-23
- **Status:** Approved (design); pending implementation plan
- **Author:** Claude + DuneRaccoon
- **Scope:** Backend torrent/streaming pipeline + frontend streaming flow & player

---

## 1. Context & problem

Freeflix picks a torrent for a title, downloads it with libtorrent, and streams the files while
still downloading. A full read of the pipeline (selection → session → serving → player → flow)
surfaced systemic weaknesses that degrade the streaming experience, most acutely under **low
seeders** — the failure mode the user explicitly called out.

Today's path: detail page picks the **most-seeded torrent of an *exact* quality** → `POST
/torrents/download` → navigate to `/streaming/[id]` → poll status every 5 s, gate the player behind
a 2 % threshold → HTML5 `<video>` points at a Range endpoint → backend serves 1 MB chunks,
deadline-ing each chunk's pieces and **synchronously polling `have_piece()` every 50 ms for up to a
fixed 45 s**.

### Confirmed root-cause findings (with evidence)

| # | Finding | Evidence |
|---|---------|----------|
| F1 | Selection is single-shot and **blind to swarm health**: `max(seeds, bytes)` over an *exact* quality match, **no min-seeders floor, no fallback list**. A 0-seeder torrent is chosen if it's the only quality match. | `services/torrents_select.py:8-13` |
| F2 | If the requested quality bucket has no match → **hard 422, no auto-downgrade** even when a healthy lower quality exists. | `api/torrents.py` (422 path); `torrents_select.py:16-19` only builds the error string |
| F3 | **Corrupt bytes served on timeout.** `stream_file_range` ignores `_await_pieces`' return value and `f.read(n)` runs unconditionally; on timeout it yields sparse/zero bytes → `PIPELINE_ERROR_DECODE`. | `torrent/manager.py:1101-1102`, `:1134-1137` |
| F4 | **Fixed 45 s, non-adaptive** piece timeout on a **thread-blocking 50 ms poll loop** (≈900 iterations/chunk). | `torrent/manager.py:1053`, `:1126-1132` |
| F5 | **Untuned libtorrent session** — only DHT/LSD/UPnP/NAT-PMP toggles; no connection/peer limits, timeouts, or cache. Tracker errors logged, never re-announced. | `torrent/manager.py:43-55` |
| F6 | **No read-ahead / seek-aware prioritization**: only the exact range +4 pieces are deadlined, reactively, on read. A far seek doesn't re-position libtorrent's window. | `torrent/manager.py:1109-1121` |
| F7 | **Active-download cap counted, never enforced** as a queue at add time (ARM cap = 2). | `config.py:85-90`; `add_torrent` has no check |
| F8 | **Passive player under stress**: single 2 s retry (no backoff); `isStalled` after 10 s triggers **no recovery**; network errors masked as "buffering" so a dead torrent looks identical to a slow one; no in-player swarm health or source switch. | `VideoPlayer.tsx` (stall/retry/error handlers) |
| F9 | **Context-free flow**: blank "Loading…" while the torrent is added; 5 s polling lags reality; no pre-stream seeder check — dead picks discovered only after navigation. | `streaming/[id]/page.tsx`; `utils/streaming.ts` |
| F10 | **No HTTP 416**; `parse_range_header` silently clamps; weak `file_index` validation (can silently stream the wrong/largest file). | `api/streaming.py:43-56`, `:74-76` |
| F11 | **Progress upsert race**: read-then-write on `(user_id, movie_id)` with **no unique constraint/index**; content_id re-parsed from filename per stream request — a misnamed file orphans progress under `movie_id=None`. | `api/streaming.py:246-277`; `database/models/streaming.py:16-18` |

---

## 2. Decisions locked (from brainstorming)

1. **Deployment target: ARM / Raspberry Pi.** Conservative, config-driven caps; non-blocking serving
   is high-value; the 2-download limit is real and must be enforced.
2. **Low-seeder UX: pre-check + let the user choose.** Selection returns *ranked candidates with
   health*; the UI validates seeders before navigating and surfaces alternatives. A thin server-side
   safety net exists, but **no silent auto-switching** — the user stays in control.
3. **Scope: one comprehensive plan** covering all workstreams, implemented in a safe sequence.
4. **Async piece-waiting: included.** ARM is precisely where thread-blocking polling hurts. It lands
   **last**, isolated, behind the WS3 safety net so a regression degrades gracefully.

---

## 3. Architecture approach — Hybrid (chosen)

Keep existing module boundaries; make three **structural** changes where they pay off, harden the
rest incrementally:

1. **Selection returns ranked candidates + health** (not a single pick).
2. **Serving becomes async and never yields undownloaded bytes.**
3. **A single stream-health model** is the source of truth consumed by both the flow page and the
   player.

Rejected: *(A) pure in-place patching* leaves the structural problems intact; *(B) a full
`StreamSession` rewrite* has too large a blast radius for working code.

---

## 4. Workstreams

Each workstream lists: **problem → design → key technical notes → tests**. Interfaces and data shapes
are defined in §5.

### WS1 — Selection: ranked candidates, health & quality downgrade
*Files:* `services/torrents_select.py`, `api/torrents.py`, `services/movies.py`, `services/tv.py`,
`cron/jobs.py`

- **Problem:** F1, F2.
- **Design:** Replace `select_best()` with `rank_candidates(hits, quality, min_seeds)` returning an
  **ordered `list[TorrentCandidate]`** (§5.1). Ranking: exact-quality healthy candidates first
  (seeds desc, then bytes desc), then a **downgrade walk** down `_ORDER` (2160p→480p) appending
  healthy lower-quality releases. Apply a configurable **min-seeders floor**; classify each candidate
  `healthy | low | dead`. Fix the bytes tiebreak so a tiny CAM never outranks a full release at equal
  seeds (guard against `bytes == 0`). `select_best()` becomes a thin `rank_candidates(...)[0]` shim
  for existing callers (`cron/jobs.py`).
- **Endpoint:** a sources endpoint returns the ranked candidates + health for a title (consumed by
  the detail page). `POST /torrents/download` accepts an **explicit chosen candidate** (`magnet` or
  `source_id`); when absent it falls back to the ranked top pick (back-compat + server-side default).
  The 422 path is removed in favor of returning the best healthy downgrade.
- **Tests:** unit — ranking order; floor filtering; downgrade walk when exact bucket absent/dead;
  bytes-tiebreak with `bytes==0`; `select_best` shim parity.

### WS2 — Pre-stream validation + staged flow feedback
*Files:* `components/movies/MovieDetailView.tsx`, `components/detail/SourcePicker.tsx`,
`utils/streaming.ts`, `app/streaming/[id]/page.tsx`, `services/streaming.ts`, `services/torrents.ts`

- **Problem:** F9.
- **Design:** `SourcePicker` shows **health badges** (healthy/low/dead) per candidate from WS1; the
  detail page **validates the chosen candidate's seeders before navigating** and, if weak, surfaces
  ranked alternatives for the user to pick (the locked UX). The streaming page renders **staged
  status** derived from a `stream_phase` field (§5.2): *Finding sources → Connecting to peers →
  Fetching metadata → Buffering N % → Ready*. Polling is **fast (~1.5 s) while not-ready** and
  relaxes once playing; the player's duplicate 5 s poll is removed (page is the single poll owner,
  §5.2).
- **Tests:** `tsc --noEmit`; manual — staged labels track real state; pre-check blocks a 0-seed pick
  and offers alternatives.

### WS3 — Serving safety: adaptive timeout + never serve undownloaded bytes
*Files:* `torrent/manager.py`, `api/streaming.py`

- **Problem:** F3, F4, F10. **This is the core correctness fix and must land early.**
- **Design:**
  - **Never yield undownloaded bytes.** `stream_file_range` honors `_await_pieces`' result: on
    failure it **ends the generator cleanly** (stops yielding) so the browser re-requests the Range,
    rather than reading sparse bytes. `f.read(n)` only runs when the pieces are confirmed present.
  - **Adaptive timeout** computed from peer count and measured throughput: abort fast (short timeout)
    when `peers == 0` and progress is stalled; extend generously while pieces are arriving. Replaces
    the fixed 45 s.
  - **HTTP 416** for unsatisfiable ranges (`start >= file_size`) with `Content-Range: bytes
    */{size}`; stop silent clamping of `start`.
  - **`file_index` validation**: distinguish *invalid index* (→ 400/404 with a clear detail) from
    *not ready*; never silently fall back to the largest file when an explicit index was supplied.
- **Key notes:** headers are already sent (206) before the body streams, so a mid-stream "abort" =
  ending the generator; the player (WS6) + page health polling (WS2) explain the gap to the user.
- **Tests:** unit — `parse_range_header` returns 416 sentinel for out-of-bounds; `file_index`
  validation paths. Mocked-handle integration — the generator **never yields bytes for an
  un-`have_piece` index** (core guarantee); on timeout it ends rather than yields.

### WS4 — Async / event-driven piece waiting + seek-aware prioritization
*Files:* `torrent/manager.py`

- **Problem:** F4 (thread-blocking), F6 (seek). **Lands last; behind WS3's safety net.**
- **Design:** Route `piece_finished_alert` / `read_piece_alert` from the existing alert loop into a
  **per-torrent registry of `asyncio.Event`s keyed by piece index**. A request coroutine registers
  the pieces it needs and `await`s (with the WS3 adaptive timeout) instead of `time.sleep(0.05)`.
  Convert `stream_file_range` to an **async generator**; offload disk reads via
  `asyncio.to_thread`/executor so the event loop never blocks. Cross-thread wake-ups use
  `loop.call_soon_threadsafe`.
  - **Seek-aware prioritization:** maintain a per-torrent playhead + forward **read-ahead window**;
    on each Range request set **graduated `set_piece_deadline(p, k·step)`** across the window and
    relax priority/deadline on pieces far behind the playhead, so libtorrent focuses where the user
    actually is.
- **Tests:** unit — alert dispatch sets the right per-piece events; `await_pieces_async` resolves on
  arrival and times out correctly (fake clock + injected alerts). Manual — far-seek latency improves;
  concurrent streams don't starve each other's threads.

### WS5 — Session tuning + active-download queue (ARM-profiled)
*Files:* `torrent/manager.py`, `config.py`

- **Problem:** F5, F7.
- **Design:** Apply a real `settings_pack` via `session.apply_settings({...})`: connection/peer
  limits, `peer_connect_timeout`/`request_timeout`/`piece_timeout` tuned for slow seeders,
  `prioritize_partial_pieces`, `strict_end_game_mode`, `suggest_mode = suggest_read_cache`, send/recv
  buffer + `aio_threads` sizing — **all config-driven with an ARM profile** (lower connection limits,
  `active_downloads` aligned with `effective_max_active_downloads()`, fewer aio threads).
  - **Active-download queue via libtorrent**, not a hand-rolled one: torrents are `auto_managed=True`
    with `active_downloads` = effective cap; the **actively-streamed torrent is force-started**
    (`auto_managed=False` + `resume()`) so the queue never pauses it. On stream end/complete it
    returns to auto-managed.
  - **Tracker recovery:** on `tracker_error_alert`, schedule a backed-off `force_reannounce()` +
    `force_dht_announce()`.
- **Key notes:** valid setting *names* depend on the container's libtorrent version — the
  implementation must read it from the running image (`make sh s=backend`) and guard unknown keys.
- **Tests:** unit — config ARM vs x86 profile values; settings dict assembled correctly and unknown
  keys filtered. Manual — cap enforced (3rd download queues, not starves); streamed torrent never
  auto-paused.

### WS6 — Player resilience + swarm-health UI
*Files:* `components/player/VideoPlayer.tsx`, `components/player/PatchedVideoPlayer.tsx`

- **Problem:** F8.
- **Design:**
  - **Exponential backoff** retry (e.g. 1·2·4·8 s, capped, bounded attempts) replacing the single 2 s
    setTimeout; each retry **re-seeks to `currentTime`** to force a fresh Range request.
  - **`isStalled` → real recovery:** the 10 s stall triggers the re-seek recovery path, not just an
    overlay.
  - **Health-aware messaging:** consume polled health (§5.2) to distinguish **"Waiting for peers (0
    connected)"** from **"Buffering — slow connection (N peers)"**; stop masking dead torrents as
    generic buffering.
  - **In-player swarm health** (seeds/peers/rate) and a **source/quality switcher** listing WS1
    alternatives; selecting one swaps the source (new download or `file_index`) and updates the
    stream URL without full back-navigation.
- **Tests:** `tsc --noEmit`; manual (Playwright) — backoff fires & recovers; 0-peer shows the right
  message; switcher swaps source live.

### WS7 — Data hardening
*Files:* `database/models/streaming.py`, `database/session.py` (`init_db`), `api/streaming.py`,
`services/content_id.py`, `torrent/manager.py` (file metadata)

- **Problem:** F11.
- **Design:**
  - **Unique index on `(user_id, movie_id)`.** Add to the ORM model (so `create_all` covers fresh
    DBs) **and** add a new **`sync_indexes()`** step to `init_db` *after* `create_all` + `sync_columns`
    — `sync_columns` only ADDs columns and cannot create indexes/constraints. `sync_indexes()` first
    **deduplicates existing rows** (keep the latest `last_watched_at` per `(user_id, movie_id)`), then
    issues `CREATE UNIQUE INDEX IF NOT EXISTS ...` (valid on both Postgres and SQLite). Idempotent,
    safe on every startup.
  - **Atomic upsert:** dialect-aware `INSERT … ON CONFLICT (user_id, movie_id) DO UPDATE` (Postgres &
    SQLite both support it); fallback retains read-then-write wrapped in `try/except IntegrityError →
    update` now that the unique index exists.
  - **Precompute season/episode/content_id** when a torrent's files are known (status loop / on
    metadata), stored on the torrent record (additive nullable column — safe via `sync_columns`).
    content_id derivation reads stored values, then falls back to filename parse, then to a
    deterministic fallback (e.g. `file_index`) so progress is **never orphaned under `None`**.
- **Tests:** unit — `sync_indexes()` dedup keeps the latest row & is idempotent; upsert is atomic
  under simulated concurrent writes; content_id precompute + fallback chain (incl. misnamed file).

---

## 5. Cross-cutting data shapes

### 5.1 `TorrentCandidate` (WS1, backend → frontend)
```
{
  source_id: str,          # stable id (infohash) for re-selection
  magnet: str,
  quality: str,            # "1080p" ...
  seeds: int,
  peers: int,
  bytes: int,
  health: "healthy" | "low" | "dead",   # derived from seeds vs config thresholds
  is_season_pack: bool,
  release_title: str,
}
```
Health thresholds are config-driven: `dead` = seeds < 1; `low` = seeds < `healthy_seeds`
(default ≈ 5); `healthy` ≥ `healthy_seeds`.

### 5.2 Stream-health / phase model (WS2/WS3/WS6, single source of truth)
Extends the existing status payload with:
```
{
  stream_phase: "searching" | "connecting" | "metadata" | "buffering" | "ready",
  num_seeds: int,
  num_peers: int,
  download_rate: int,      # bytes/s
  health: "healthy" | "low" | "dead",
}
```
`stream_phase` is derived from torrent state (pre-add / peers==0&no-metadata / peers>0&no-metadata /
metadata&below-ready-threshold / ready). The **streaming page owns polling** and passes this down to
the player; the player's separate 5 s poll is removed.

---

## 6. Implementation sequence

> One comprehensive plan; each step ships independently green.

1. **WS1** — selection ranked candidates + health + downgrade (foundation for the rest).
2. **WS3** — serving safety (stop-the-bleeding correctness; depends on nothing).
3. **WS2** — pre-check + staged flow (consumes WS1 candidates + WS3/§5.2 health model).
4. **WS6** — player resilience + health UI (consumes §5.2).
5. **WS5** — session tuning + active-download queue.
6. **WS4** — async refactor + seek-aware (riskiest; isolated; behind WS3).
7. **WS7** — data hardening (parallelizable anytime; independent of the above).

---

## 7. Testing & verification strategy

- **Unit (pytest in Docker):** WS1 ranking/floor/downgrade; WS3 range/416 + `file_index`; WS4 alert
  dispatch + async-wait timeout; WS5 config profiles; WS7 dedup/idempotent index, atomic upsert,
  content_id fallback. *(Tests are baked into the image — `make build` or mount `backend/tests`
  per CLAUDE.md.)*
- **Mocked-handle integration:** a fake libtorrent handle proves the WS3 guarantee — the serve
  generator **never yields bytes for an un-`have_piece` index**, and ends (not yields) on timeout.
- **Manual / Playwright** (checklist authored into the plan): low-seeder stall → recovery;
  seek-ahead-of-download; in-player source switch; staged startup labels; 3rd concurrent download
  queues on ARM; dead-pick pre-check on the detail page.

---

## 8. Risks & mitigations

| Risk | Mitigation |
|------|-----------|
| **DB unique constraint vs no-Alembic** (WS7) — most likely to break startup if done naively. | New guarded `sync_indexes()` with a dedup pass + `CREATE UNIQUE INDEX IF NOT EXISTS`; never via `sync_columns`. Verify on both PG (compose) and the SQLite fallback. |
| **WS4 async** is the riskiest change. | Lands last, isolated, behind WS3's safety net; adaptive-timeout + no-garbage stand alone even if async slips. Async generator offloads disk reads to avoid blocking the loop. |
| **`auto_managed` queueing** (WS5) changes libtorrent scheduling. | Force-start override (`auto_managed=False` + `resume()`) guarantees the actively-streamed torrent is never paused; revert on stream end. |
| **libtorrent setting-name drift across versions** (WS5). | Read the container's libtorrent version first; assemble settings against it; filter/guard unknown keys. |
| **Ending the stream generator mid-response** (WS3) could surface as a player error. | WS6 classifies the resulting event using health and recovers via re-seek/backoff rather than showing a hard error during active download. |

---

## 9. Non-goals (this round)

- No real authentication / multi-tenant rework (app remains multi-profile, no auth).
- No replacement of the TMDB-shaped catalog provider or the legacy `scrapers/`.
- No adaptive *bitrate* transcoding (we switch torrents/quality, we don't transcode).
- No Alembic / migration framework introduction (additive `sync_columns` + new `sync_indexes` only).
