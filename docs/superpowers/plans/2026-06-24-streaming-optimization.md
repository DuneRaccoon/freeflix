# Streaming Experience Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Freeflix streaming robust under low seeders by selecting ranked health-aware candidates, never serving undownloaded bytes, and surfacing one shared stream-health model across the flow page and player.

**Architecture:** Hybrid — keep existing module boundaries while making three structural changes: selection returns an ordered `list[TorrentCandidate]` with swarm-health (never a single blind pick); serving becomes correctness-safe and async, ending the generator rather than yielding sparse/undownloaded bytes; and a single stream-health/phase model is the source of truth consumed by both the streaming page and the player. Everything else is hardened incrementally behind that safety net.

**Tech Stack:** Backend — FastAPI, libtorrent, SQLAlchemy 1.4, Pydantic, Python 3.10 (Poetry), PostgreSQL 16. Frontend — Next.js 15 (App Router), React 19, TypeScript, Tailwind v4. Run entirely through Docker Compose.

## Global Constraints

- **SQLAlchemy 1.4** style only (not 2.0) — query/session API differs from 2.0 docs.
- **Two separate model layers — never conflate:** `backend/app/models.py` = Pydantic API schemas; `backend/app/database/models/` = SQLAlchemy ORM tables.
- **`get_db()` is `@contextmanager`** — FastAPI injects the context-manager object; endpoints use `with db as session:`. Do NOT "fix" it into a plain yield dependency.
- **No Alembic:** `init_db()` runs `create_all()` then additive `sync_columns()` (ADDs missing nullable model columns only — never drops/renames/retypes/backfills); WS7 adds a new guarded `sync_indexes()` step *after* both, since `sync_columns` cannot create indexes/constraints.
- **`content_id` format** is `movie:{tmdb_id}` / `tv:{tmdb_id}:s{season}:e{episode}` (built in `services/content_id.py`); it has 3 mirrors — `UserStreamingProgress.movie_id`, `PatchedVideoPlayer.tsx` (`effectiveMovieId = contentId ?? movieId`), `ContinueWatchingSection.tsx` (re-parse). Change it in one place → update all three.
- **ARM active-download cap = 2**, enforced via `effective_max_active_downloads()` (config-driven; do not hand-roll a queue).
- **Backend tests are baked into the image, not bind-mounted** by the dev override. Run new/edited tests with the mount form, from repo root: `docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest tests/<f> -v` (container workdir `/opt/freeflix`; tests at `/opt/freeflix/tests`). `make build` to bake them in.
- **Frontend typecheck:** `npx tsc --noEmit` (no working lint setup). No ESLint config.
- **Compose URLs:** backend `:8000` (Swagger `/docs`), frontend host `:3001`→container `:3000`.
- **Conventional Commits** (`feat:`, `refactor:`, `fix:`, `test:`).
- **libtorrent setting *names* are version-dependent** (WS5) — read the running container's libtorrent version (`make sh s=backend`), assemble settings against it, and filter/guard unknown keys.

## File Structure

| File | Created/Modified | Workstream | Responsibility |
| --- | --- | --- | --- |
| `backend/app/config.py` | Modified | W1 (owns `min_seeds`/`healthy_seeds`), W5 | W1 adds swarm-health thresholds; W5 adds ARM-profiled session-tuning + `lt_settings()`. |
| `backend/app/models.py` | Modified | W1 | `TorrentCandidate`; `TorrentRequest.magnet`/`source_id`; `TorrentStatus.chosen_quality` + WS3/§5.2 health/phase fields. |
| `backend/app/services/torrents_select.py` | Modified | W1 | `classify_health`, `_source_id`, `_is_season_pack`, `rank_candidates`, `select_best` shim, `available_qualities`. |
| `backend/app/services/movies.py` | Modified | W1 | `get_candidates(tmdb_id, quality)` ranked sources for a movie. |
| `backend/app/services/tv.py` | Modified | W1 | `episode_candidates` / `season_candidates` ranked sources for TV. |
| `backend/app/api/torrents.py` | Modified | W1 | `GET /torrents/sources`; `POST /torrents/download` explicit candidate + auto-downgrade (422 removed). |
| `backend/app/cron/jobs.py` | (unchanged code; guarded) | W1 | Keeps importing `select_best`; parity guarded by test only. |
| `backend/app/api/streaming.py` | Modified | W3, W7 | `RANGE_NOT_SATISFIABLE` + 416; `file_index` validation; atomic progress upsert (W7). |
| `backend/app/torrent/manager.py` | Modified | W3 (serving helpers), W4 (async), W5 (session/queue), W7 (file metadata) | `_pieces_ready`, `_adaptive_piece_timeout`, `stream_file_range` (sync→async by W4); seek-aware deadlines; session tuning + queue; precomputed season/episode/content_id. |
| `backend/app/database/models/streaming.py` | Modified | W7 | Unique index on `(user_id, movie_id)`; precomputed content_id column. |
| `backend/app/database/session.py` | Modified | W7 | New `sync_indexes()` step in `init_db` (dedup + `CREATE UNIQUE INDEX IF NOT EXISTS`). |
| `backend/app/services/content_id.py` | Modified | W7 | content_id derivation: stored → filename parse → deterministic fallback (never `None`). |
| `frontend/src/types/index.ts` | Modified | W2 (owns), W6 imports | `TorrentCandidate`, `StreamPhase`, `SwarmHealth`, `StreamHealthState` TS types. |
| `frontend/src/utils/streamHealth.ts` | Created | W2 (owns), W6 imports | `deriveStreamHealth(status) -> StreamHealthState`. |
| `frontend/src/services/torrents.ts` | Modified | W2 (owns), W6 imports | `getSources()` + download-with-candidate client calls. |
| `frontend/src/services/streaming.ts` | Modified | W2 | Streaming status fetch wired to the phase/health payload. |
| `frontend/src/utils/streaming.ts` | Modified | W2 | Pre-stream seeder validation helpers. |
| `frontend/src/components/movies/MovieDetailView.tsx` | Modified | W2 | Pre-navigate validation + alternatives surfacing. |
| `frontend/src/components/detail/SourcePicker.tsx` | Created | W2 | Health-badged candidate picker. |
| `frontend/src/app/streaming/[id]/page.tsx` | Modified | W2 | Single poll owner; staged phase status; fast-while-not-ready polling. |
| `frontend/src/components/player/VideoPlayer.tsx` | Modified | W6 | Exponential backoff + re-seek recovery; health-aware messaging; in-player swarm health + source switcher. |
| `frontend/src/components/player/PatchedVideoPlayer.tsx` | Modified | W6 | Removes duplicate 5s poll; consumes page-supplied health; source/quality swap. |

Shared-file ownership: **`config.py`** — W1 owns `min_seeds`/`healthy_seeds`; W5 owns session-tuning keys. **`types/index.ts` + `utils/streamHealth.ts` + `services/torrents.ts`** — W2 owns and defines; W6 imports (no redefinition). **Player components** (`VideoPlayer.tsx`, `PatchedVideoPlayer.tsx`) — W6. **`manager.py` serving helpers** (`_pieces_ready`, `_adaptive_piece_timeout`, `stream_file_range`) — authored by W3 (synchronous), converted to async by W4 behind W3's safety net.

## Interfaces Reference

**`TorrentCandidate` — Pydantic** (`backend/app/models.py`):
```python
class TorrentCandidate(BaseModel):
    source_id: str          # stable id, prefer infohash; fallback to a hash of the magnet
    magnet: str
    quality: str            # "2160p"|"1080p"|"720p"|"480p"|""
    seeds: int
    peers: int
    bytes: int
    health: str             # "healthy"|"low"|"dead"
    is_season_pack: bool
    release_title: str
```

**`TorrentCandidate` — TypeScript** (`frontend/src/types/index.ts`):
```ts
export interface TorrentCandidate {
  source_id: string;
  magnet: string;
  quality: string;
  seeds: number;
  peers: number;
  bytes: number;
  health: 'healthy' | 'low' | 'dead';
  is_season_pack: boolean;
  release_title: string;
}
```

**Selection** (`backend/app/services/torrents_select.py`):
```python
def classify_health(seeds: int, *, min_seeds: int, healthy_seeds: int) -> str
# "dead" if seeds < min_seeds; "low" if seeds < healthy_seeds; else "healthy"

def rank_candidates(
    hits: List[TorrentHit], quality: str, *, min_seeds: int, healthy_seeds: int
) -> List[TorrentCandidate]
# exact-quality healthy first (seeds desc, effective_bytes desc), then downgrade walk
# down _ORDER appending healthy lower-quality, then low, then dead last. bytes==0 never
# outranks a real release at equal seeds (effective_bytes = bytes if bytes > 0 else -1).

def select_best(hits: List[TorrentHit], quality: str) -> Optional[TorrentHit]
# SHIM over rank_candidates — returns the original TorrentHit (NOT a TorrentCandidate);
# highest-seeded EXACT-quality match (None if bucket absent). cron/jobs.py unaffected.

def _source_id(hit: TorrentHit) -> str
def _is_season_pack(title: str) -> bool
def available_qualities(hits: List[TorrentHit]) -> List[str]
```

**Config** (`backend/app/config.py`): `settings.min_seeds: int = 1`, `settings.healthy_seeds: int = 5`; plus (W5) `def lt_settings() -> dict` — assembles the version-guarded libtorrent `settings_pack` dict (ARM-profiled), filtering unknown keys.

**Stream-health / phase model — TypeScript** (`frontend/src/types/index.ts` + `frontend/src/utils/streamHealth.ts`):
```ts
export type StreamPhase = 'searching' | 'connecting' | 'metadata' | 'buffering' | 'ready';
export type SwarmHealth = 'healthy' | 'low' | 'dead';

export interface StreamHealthState {
  stream_phase: StreamPhase;
  num_seeds: number;
  num_peers: number;
  download_rate: number;   // bytes/s
  health: SwarmHealth;
}

export function deriveStreamHealth(status: TorrentStatus): StreamHealthState;
```

**`TorrentStatus` extension fields (§5.2, single source of truth)** on the Pydantic `TorrentStatus` (`backend/app/models.py`), mirrored in the TS `TorrentStatus`:
```python
    stream_phase: Optional[str] = None   # "searching"|"connecting"|"metadata"|"buffering"|"ready"
    num_seeds: int = 0
    num_peers: int = 0
    download_rate: int = 0                # bytes/s
    health: Optional[str] = None          # "healthy"|"low"|"dead"
    chosen_quality: Optional[str] = None  # quality actually picked after any downgrade
```

**Serving — synchronous (W3)** (`backend/app/torrent/manager.py`):
```python
def _pieces_ready(self, handle, first_piece: int, last_piece: int) -> bool
# True iff handle.have_piece(p) for every p in [first_piece, last_piece]; False on any exception. No sleeping.

def _adaptive_piece_timeout(self, handle, *, base: float = 8.0, max_timeout: float = 60.0) -> float
# 2.0 when num_peers == 0; `base` when peers idle; base + rate/65536.0 while downloading, capped at max_timeout.

def stream_file_range(self, torrent_id: str, file_index: int, file_path: str,
                      start: int, end: int, chunk_size: int = 1024 * 1024,
                      piece_timeout: Optional[float] = None)
# generator; only reads/yields a chunk once its pieces are confirmed present, else RETURNs (ends
# the generator) without yielding. piece_timeout=None -> compute adaptively per chunk; numeric -> fixed.
```

**Serving — async conversion (W4)** (`backend/app/torrent/manager.py`):
```python
async def await_pieces_async(self, handle, first_piece: int, last_piece: int,
                             num_pieces: int, timeout: float) -> bool
# registers per-piece asyncio.Events and awaits arrival (or times out via the WS3 adaptive budget),
# replacing the time.sleep(0.05) poll loop.

def _on_piece_finished(self, torrent_id: str, piece_index: int) -> None
# called from the alert loop (via loop.call_soon_threadsafe) to set the asyncio.Event for that piece.
```
W4 converts `stream_file_range` to an async generator, offloading disk reads via `asyncio.to_thread`/executor, and adds seek-aware graduated `set_piece_deadline` across a forward read-ahead window.

**Range / 416** (`backend/app/api/streaming.py`):
```python
RANGE_NOT_SATISFIABLE = (-1, -1)   # module-level sentinel

def parse_range_header(range_header: Optional[str], file_size: int) -> tuple
# (start, end) inclusive for satisfiable ranges; RANGE_NOT_SATISFIABLE when start >= file_size
# (or file_size <= 0 / start < 0). end past EOF is clamped; start is NOT silently clamped.
# stream_video maps the sentinel to Response(status_code=416, headers={"Content-Range": f"bytes */{file_size}"}).
```

## Implementation Sequence

> One comprehensive plan; each workstream ships independently green (its full test set passes before the next begins).

1. **W1** — Selection: ranked candidates + health + downgrade (foundation; `TorrentCandidate`, `rank_candidates`, sources endpoint, candidate-aware download).
2. **W3** — Serving safety: adaptive timeout, never serve undownloaded bytes, HTTP 416, `file_index` validation (core correctness; depends on nothing — but sequenced after W1 so the §5.2 fields land coherently).
3. **W2** — Pre-stream validation + staged flow feedback (consumes W1 candidates + W3/§5.2 health/phase model; owns the shared TS types + `streamHealth.ts` + `torrents.ts`).
4. **W6** — Player resilience + swarm-health UI (consumes §5.2 and imports W2's shared types/utils).
5. **W5** — Session tuning + active-download queue (`lt_settings()`, ARM profile, libtorrent queueing).
6. **W4** — Async / event-driven piece waiting + seek-aware prioritization (riskiest; lands last, isolated, behind W3's safety net).
7. **W7** — Data hardening (`sync_indexes()`, atomic upsert, precomputed content_id) — **independent of the above; parallelizable anytime**.

---

## Workstream W1: Selection — ranked candidates, health & quality downgrade

This workstream replaces the blind single-pick selection with a ranked, health-aware candidate list, adds config-driven seeder thresholds, exposes a sources endpoint, and rewrites `POST /torrents/download` to accept an explicit chosen candidate (with auto-downgrade instead of a hard 422). `select_best()` is retained as a thin shim so `cron/jobs.py` is untouched in behavior.

All backend test-run commands use the mount form from CLAUDE.md so new/edited tests run without a rebuild. Container workdir is `/opt/freeflix`; tests live at `/opt/freeflix/tests`.

---

### Task W1.1: Config — `min_seeds` / `healthy_seeds` settings

**Files:**
- Modify: `backend/app/config.py` (insert after the `cache_movies_for` line, currently `backend/app/config.py:83`)
- Test: `backend/tests/test_selection_config.py` (create)

**Interfaces:**
- Consumes: nothing.
- Produces: `settings.min_seeds: int = 1`, `settings.healthy_seeds: int = 5` (attributes on the existing `Settings` singleton in `backend/app/config.py`).

Steps:

- [ ] **Step 1: Write the failing test.** Create `backend/tests/test_selection_config.py`:
```python
from app.config import settings, Settings


def test_seed_threshold_defaults():
    assert settings.min_seeds == 1
    assert settings.healthy_seeds == 5


def test_seed_thresholds_are_ints():
    fresh = Settings()
    assert isinstance(fresh.min_seeds, int)
    assert isinstance(fresh.healthy_seeds, int)
```

- [ ] **Step 2: Run the test — expect FAIL.** It fails with `AttributeError: 'Settings' object has no attribute 'min_seeds'`.
```bash
docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest tests/test_selection_config.py -v
```

- [ ] **Step 3: Add the settings.** In `backend/app/config.py`, the current snippet is:
```python
    # Cron settings
    cron_enabled: bool = True
    
    cache_movies_for: int = 365  # 365 days
```
Replace it with:
```python
    # Cron settings
    cron_enabled: bool = True
    
    cache_movies_for: int = 365  # 365 days

    # Torrent selection: swarm-health thresholds (seeders).
    # dead   = seeds < min_seeds
    # low    = seeds < healthy_seeds
    # healthy = seeds >= healthy_seeds
    min_seeds: int = 1
    healthy_seeds: int = 5
```

- [ ] **Step 4: Run the test — expect PASS.**
```bash
docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest tests/test_selection_config.py -v
```

- [ ] **Step 5: Commit.**
```bash
git add backend/app/config.py backend/tests/test_selection_config.py
git commit -m "feat(config): add min_seeds/healthy_seeds swarm-health thresholds"
```

---

### Task W1.2: `TorrentCandidate` Pydantic model + `classify_health`

**Files:**
- Modify: `backend/app/models.py` (insert after the `TorrentHit` class, currently ends at `backend/app/models.py:181`)
- Modify: `backend/app/services/torrents_select.py` (add `classify_health`)
- Test: `backend/tests/test_classify_health.py` (create)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `class TorrentCandidate(BaseModel)` in `backend/app/models.py` with fields exactly: `source_id: str`, `magnet: str`, `quality: str`, `seeds: int`, `peers: int`, `bytes: int`, `health: str`, `is_season_pack: bool`, `release_title: str`.
  - `def classify_health(seeds: int, *, min_seeds: int, healthy_seeds: int) -> str` in `backend/app/services/torrents_select.py` returning `"dead"` if `seeds < min_seeds`, `"low"` if `seeds < healthy_seeds`, else `"healthy"`.

Steps:

- [ ] **Step 1: Write the failing test.** Create `backend/tests/test_classify_health.py`:
```python
import pytest
from app.models import TorrentCandidate
from app.services.torrents_select import classify_health


def test_classify_dead_below_min_seeds():
    assert classify_health(0, min_seeds=1, healthy_seeds=5) == "dead"


def test_classify_low_at_min_seeds():
    # seeds == min_seeds is NOT dead; below healthy_seeds is low
    assert classify_health(1, min_seeds=1, healthy_seeds=5) == "low"


def test_classify_low_just_below_healthy():
    assert classify_health(4, min_seeds=1, healthy_seeds=5) == "low"


def test_classify_healthy_at_threshold():
    assert classify_health(5, min_seeds=1, healthy_seeds=5) == "healthy"


def test_classify_healthy_above():
    assert classify_health(100, min_seeds=1, healthy_seeds=5) == "healthy"


def test_candidate_model_round_trips():
    c = TorrentCandidate(
        source_id="abc", magnet="magnet:?xt=urn:btih:abc", quality="1080p",
        seeds=10, peers=3, bytes=2_000_000_000, health="healthy",
        is_season_pack=False, release_title="M.2020.1080p.BluRay",
    )
    assert c.health == "healthy"
    assert c.is_season_pack is False
    assert c.source_id == "abc"
```

- [ ] **Step 2: Run the test — expect FAIL.** Fails with `ImportError: cannot import name 'TorrentCandidate'` (and `classify_health`).
```bash
docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest tests/test_classify_health.py -v
```

- [ ] **Step 3: Add the Pydantic model.** In `backend/app/models.py`, the current `TorrentHit` block is:
```python
class TorrentHit(BaseModel):
    title: str
    seeds: int = 0
    peers: int = 0
    bytes: int = 0
    magnet: str
    hash: str = ''
    source: Optional[str] = None
    quality: Optional[str] = None
```
Add immediately after it (before `class CatalogPage`):
```python


class TorrentCandidate(BaseModel):
    """A ranked, health-classified torrent option surfaced to the UI / picker."""
    source_id: str          # stable id, prefer infohash; fallback to a hash of the magnet
    magnet: str
    quality: str            # "2160p"|"1080p"|"720p"|"480p"|""
    seeds: int
    peers: int
    bytes: int
    health: str             # "healthy"|"low"|"dead"
    is_season_pack: bool
    release_title: str
```

- [ ] **Step 4: Add `classify_health`.** In `backend/app/services/torrents_select.py`, the current header is:
```python
"""Choose the best torrent hit for a requested quality bucket."""
from typing import List, Optional
from app.models import TorrentHit

_ORDER = ["2160p", "1080p", "720p", "480p"]
```
Replace it with:
```python
"""Rank torrent hits for a requested quality bucket, with swarm-health classification."""
from typing import List, Optional
from app.models import TorrentHit

_ORDER = ["2160p", "1080p", "720p", "480p"]


def classify_health(seeds: int, *, min_seeds: int, healthy_seeds: int) -> str:
    """Map a seeder count to "dead" | "low" | "healthy" against config thresholds."""
    if seeds < min_seeds:
        return "dead"
    if seeds < healthy_seeds:
        return "low"
    return "healthy"
```

- [ ] **Step 5: Run the test — expect PASS.**
```bash
docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest tests/test_classify_health.py -v
```

- [ ] **Step 6: Commit.**
```bash
git add backend/app/models.py backend/app/services/torrents_select.py backend/tests/test_classify_health.py
git commit -m "feat(selection): add TorrentCandidate model and classify_health"
```

---

### Task W1.3: `source_id` derivation + `is_season_pack` detection helpers

**Files:**
- Modify: `backend/app/services/torrents_select.py` (add two private helpers below `classify_health`)
- Test: `backend/tests/test_candidate_helpers.py` (create)

**Interfaces:**
- Consumes: `TorrentHit` (`backend/app/models.py`: fields `title`, `seeds`, `peers`, `bytes`, `magnet`, `hash`, `quality`).
- Produces:
  - `def _source_id(hit: TorrentHit) -> str` — returns `hit.hash` lowercased if non-empty, else the `btih` infohash parsed from `hit.magnet` (lowercased), else a stable `hashlib.sha1(hit.magnet.encode()).hexdigest()`.
  - `def _is_season_pack(title: str) -> bool` — `True` when the title looks like a multi-episode/season pack (`S01` with no `E\d`, or `Season N`, or `Complete`), else `False`.

Steps:

- [ ] **Step 1: Write the failing test.** Create `backend/tests/test_candidate_helpers.py`:
```python
import hashlib
from app.models import TorrentHit
from app.services.torrents_select import _source_id, _is_season_pack


def _hit(title="x", magnet="magnet:?xt=urn:btih:abc", hsh=""):
    return TorrentHit(title=title, magnet=magnet, hash=hsh)


def test_source_id_prefers_hash():
    h = _hit(hsh="ABCDEF123456")
    assert _source_id(h) == "abcdef123456"


def test_source_id_parses_btih_from_magnet():
    h = _hit(magnet="magnet:?xt=urn:btih:2385EB80D5F99EFD&dn=foo", hsh="")
    assert _source_id(h) == "2385eb80d5f99efd"


def test_source_id_falls_back_to_sha1_of_magnet():
    magnet = "https://example.test/not-a-magnet"
    h = _hit(magnet=magnet, hsh="")
    assert _source_id(h) == hashlib.sha1(magnet.encode()).hexdigest()


def test_is_season_pack_true_for_season_only():
    assert _is_season_pack("Show.Name.S01.1080p.WEB") is True


def test_is_season_pack_true_for_complete():
    assert _is_season_pack("Show Name Complete Series 1080p") is True


def test_is_season_pack_false_for_single_episode():
    assert _is_season_pack("Show.Name.S01E04.1080p.WEB") is False


def test_is_season_pack_false_for_movie():
    assert _is_season_pack("Movie.Name.2020.1080p.BluRay") is False
```

- [ ] **Step 2: Run the test — expect FAIL.** Fails with `ImportError: cannot import name '_source_id'`.
```bash
docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest tests/test_candidate_helpers.py -v
```

- [ ] **Step 3: Add the helpers.** In `backend/app/services/torrents_select.py`, the current import header is:
```python
"""Rank torrent hits for a requested quality bucket, with swarm-health classification."""
from typing import List, Optional
from app.models import TorrentHit

_ORDER = ["2160p", "1080p", "720p", "480p"]
```
Replace it with:
```python
"""Rank torrent hits for a requested quality bucket, with swarm-health classification."""
import hashlib
import re
from typing import List, Optional
from app.models import TorrentHit, TorrentCandidate

_ORDER = ["2160p", "1080p", "720p", "480p"]

_BTIH_RE = re.compile(r"btih:([0-9a-zA-Z]+)", re.IGNORECASE)
_EPISODE_RE = re.compile(r"\bS\d{1,2}E\d{1,3}\b", re.IGNORECASE)
_SEASON_RE = re.compile(r"\b(S\d{1,2}\b|Season\s*\d{1,3}|Complete)\b", re.IGNORECASE)


def _source_id(hit: TorrentHit) -> str:
    """Stable id for a hit: infohash if known, else a sha1 of the magnet."""
    if hit.hash:
        return hit.hash.lower()
    m = _BTIH_RE.search(hit.magnet or "")
    if m:
        return m.group(1).lower()
    return hashlib.sha1((hit.magnet or "").encode()).hexdigest()


def _is_season_pack(title: str) -> bool:
    """True when the title looks like a season pack / complete set (no single SxxExx)."""
    t = title or ""
    if _EPISODE_RE.search(t):
        return False
    return bool(_SEASON_RE.search(t))
```
Then update the module docstring line for `classify_health` is unchanged; `classify_health` stays directly below this block.

- [ ] **Step 4: Run the test — expect PASS.**
```bash
docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest tests/test_candidate_helpers.py -v
```

- [ ] **Step 5: Run the full selection test set to confirm no regressions** (the existing `test_torrents_select.py` still imports `select_best`/`available_qualities`, which are untouched).
```bash
docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest tests/test_torrents_select.py tests/test_candidate_helpers.py -v
```

- [ ] **Step 6: Commit.**
```bash
git add backend/app/services/torrents_select.py backend/tests/test_candidate_helpers.py
git commit -m "feat(selection): add source_id and season-pack helpers"
```

---

### Task W1.4: `rank_candidates` — ranking, floor, downgrade walk, bytes tiebreak

**Files:**
- Modify: `backend/app/services/torrents_select.py` (add `rank_candidates` below `_is_season_pack`/`classify_health`)
- Test: `backend/tests/test_rank_candidates.py` (create)

**Interfaces:**
- Consumes: `classify_health(seeds, *, min_seeds, healthy_seeds) -> str`, `_source_id(hit) -> str`, `_is_season_pack(title) -> bool`, `TorrentHit`, `TorrentCandidate` (all from Task W1.2/W1.3).
- Produces: `def rank_candidates(hits: List[TorrentHit], quality: str, *, min_seeds: int, healthy_seeds: int) -> List[TorrentCandidate]`.

Ranking contract (per spec §WS1 and pinned interface):
1. Exact-quality **healthy** candidates first, sorted by `(seeds desc, effective_bytes desc)`.
2. Then a **downgrade walk** down `_ORDER` (2160p→480p), appending **healthy** lower-quality releases (each bucket internally sorted the same way).
3. Then **low**-health candidates (exact quality first, then downgrade order), same internal sort.
4. **dead** candidates excluded unless nothing else remains (then appended last so the caller always has at least the available options).
5. **bytes tiebreak guard:** at equal seeds, a release with `bytes == 0` must NOT outrank a real release — use `effective_bytes = bytes if bytes > 0 else -1` for the sort key so `bytes==0` sorts last among equal seeds.

Steps:

- [ ] **Step 1: Write the failing test.** Create `backend/tests/test_rank_candidates.py`:
```python
from app.models import TorrentHit
from app.providers.quality import parse_quality
from app.services.torrents_select import rank_candidates


def _hit(title, seeds, byts=1_000_000, magnet=None):
    return TorrentHit(
        title=title, seeds=seeds, peers=0, bytes=byts,
        magnet=magnet or f"magnet:?xt=urn:btih:{abs(hash(title)) % (16**16):016x}",
        hash="", quality=parse_quality(title),
    )


THR = {"min_seeds": 1, "healthy_seeds": 5}


def test_exact_quality_healthy_first_seeds_desc():
    hits = [
        _hit("M.2020.1080p.A", 10),
        _hit("M.2020.1080p.B", 50),
        _hit("M.2020.720p.C", 999),
    ]
    out = rank_candidates(hits, "1080p", **THR)
    assert out[0].quality == "1080p" and out[0].seeds == 50
    assert out[1].quality == "1080p" and out[1].seeds == 10


def test_floor_filters_dead_when_alternatives_exist():
    # 0-seed 1080p is "dead"; a healthy 720p exists -> dead drops below healthy downgrade
    hits = [
        _hit("M.2020.1080p.Dead", 0),
        _hit("M.2020.720p.Healthy", 30),
    ]
    out = rank_candidates(hits, "1080p", **THR)
    assert out[0].health == "healthy" and out[0].quality == "720p"
    assert out[-1].health == "dead" and out[-1].quality == "1080p"


def test_downgrade_walk_when_exact_bucket_absent():
    hits = [
        _hit("M.2020.720p.A", 20),
        _hit("M.2020.480p.B", 99),
    ]
    out = rank_candidates(hits, "1080p", **THR)
    # exact 1080p absent -> walk down: 720p (healthy) before 480p (healthy)
    assert [c.quality for c in out] == ["720p", "480p"]


def test_bytes_tiebreak_zero_never_outranks_real_release():
    hits = [
        _hit("M.2020.1080p.Zero", 100, byts=0),
        _hit("M.2020.1080p.Real", 100, byts=1500),
    ]
    out = rank_candidates(hits, "1080p", **THR)
    assert out[0].bytes == 1500
    assert out[1].bytes == 0


def test_dead_only_still_returned():
    hits = [_hit("M.2020.1080p.Dead", 0)]
    out = rank_candidates(hits, "1080p", **THR)
    assert len(out) == 1 and out[0].health == "dead"


def test_low_ranks_below_healthy_downgrade():
    # 1080p low (seeds=2) vs 720p healthy (seeds=30): healthy downgrade wins
    hits = [
        _hit("M.2020.1080p.Low", 2),
        _hit("M.2020.720p.Healthy", 30),
    ]
    out = rank_candidates(hits, "1080p", **THR)
    assert out[0].quality == "720p" and out[0].health == "healthy"
    assert out[1].quality == "1080p" and out[1].health == "low"


def test_empty_hits_returns_empty():
    assert rank_candidates([], "1080p", **THR) == []
```

- [ ] **Step 2: Run the test — expect FAIL.** Fails with `ImportError: cannot import name 'rank_candidates'`.
```bash
docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest tests/test_rank_candidates.py -v
```

- [ ] **Step 3: Implement `rank_candidates`.** In `backend/app/services/torrents_select.py`, the file currently ends with:
```python
def select_best(hits: List[TorrentHit], quality: str) -> Optional[TorrentHit]:
    """Highest-seeded hit whose parsed quality == `quality` (ties -> larger bytes)."""
    matching = [h for h in hits if h.quality == quality]
    if not matching:
        return None
    return max(matching, key=lambda h: (h.seeds, h.bytes))


def available_qualities(hits: List[TorrentHit]) -> List[str]:
    """Distinct buckets present among hits, ordered 2160p -> 480p."""
    present = {h.quality for h in hits if h.quality}
    return [q for q in _ORDER if q in present]
```
Insert the following function **directly above** `def select_best` (so `classify_health`/helpers above, then `rank_candidates`, then `select_best`):
```python
def _effective_bytes(byts: int) -> int:
    """Sort key for the bytes tiebreak: a 0-byte release must not outrank a real one."""
    return byts if byts > 0 else -1


def _to_candidate(hit: TorrentHit, health: str) -> TorrentCandidate:
    return TorrentCandidate(
        source_id=_source_id(hit),
        magnet=hit.magnet,
        quality=hit.quality or "",
        seeds=hit.seeds,
        peers=hit.peers,
        bytes=hit.bytes,
        health=health,
        is_season_pack=_is_season_pack(hit.title),
        release_title=hit.title,
    )


def rank_candidates(
    hits: List[TorrentHit], quality: str, *, min_seeds: int, healthy_seeds: int
) -> List[TorrentCandidate]:
    """Ordered candidate list: exact-quality healthy first (seeds desc, bytes desc),
    then a downgrade walk down _ORDER appending healthy lower-quality releases, then
    low-health (same order), then dead last (kept only so a caller always has options).
    bytes==0 never outranks a real release at equal seeds."""
    # Quality buckets, exact-first then the downgrade walk (2160p->480p excluding exact).
    bucket_order: List[str] = []
    if quality:
        bucket_order.append(quality)
    bucket_order += [q for q in _ORDER if q != quality]
    bucket_order.append("")  # releases whose quality didn't parse

    def _bucket_index(q: str) -> int:
        try:
            return bucket_order.index(q)
        except ValueError:
            return len(bucket_order)

    health_rank = {"healthy": 0, "low": 1, "dead": 2}

    scored = []
    for h in hits:
        health = classify_health(h.seeds, min_seeds=min_seeds, healthy_seeds=healthy_seeds)
        scored.append((h, health))

    # Sort key: health tier, then bucket position, then seeds desc, then effective bytes desc.
    scored.sort(
        key=lambda hh: (
            health_rank[hh[1]],
            _bucket_index(hh[0].quality or ""),
            -hh[0].seeds,
            -_effective_bytes(hh[0].bytes),
        )
    )
    return [_to_candidate(h, health) for (h, health) in scored]
```

- [ ] **Step 4: Run the test — expect PASS.**
```bash
docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest tests/test_rank_candidates.py -v
```

- [ ] **Step 5: Commit.**
```bash
git add backend/app/services/torrents_select.py backend/tests/test_rank_candidates.py
git commit -m "feat(selection): rank_candidates with health, downgrade walk, bytes tiebreak"
```

---

### Task W1.5: `select_best` shim parity over `rank_candidates`

**Files:**
- Modify: `backend/app/services/torrents_select.py` (rewrite `select_best` body)
- Test: `backend/tests/test_select_best_shim.py` (create)

**Interfaces:**
- Consumes: `rank_candidates(...) -> List[TorrentCandidate]`, `settings.min_seeds`, `settings.healthy_seeds`.
- Produces: `def select_best(hits: List[TorrentHit], quality: str) -> Optional[TorrentHit]` — **same return type as today** (returns the original `TorrentHit`, not a candidate). For exact-quality callers (`cron/jobs.py`), returns the same `TorrentHit` the old implementation would have (highest-seeded exact match, ties → larger bytes), so cron behavior is unchanged.

Implementation note: the old `select_best` returned `None` when the exact bucket was absent. To preserve cron's "skip if no exact match" behavior, the shim must still return the **highest-seeded exact-quality hit** (or `None`), but routed through `rank_candidates` for the bytes-tiebreak fix. Filter the ranked candidates to the exact `quality` and map the top one back to its originating `TorrentHit` via `source_id`.

Steps:

- [ ] **Step 1: Write the failing test.** Create `backend/tests/test_select_best_shim.py`:
```python
from app.models import TorrentHit
from app.providers.quality import parse_quality
from app.services.torrents_select import select_best


def _hit(title, seeds, byts=1000, magnet=None):
    return TorrentHit(
        title=title, seeds=seeds, peers=0, bytes=byts,
        magnet=magnet or f"magnet:?xt=urn:btih:{abs(hash((title, seeds, byts))) % (16**16):016x}",
        hash="", quality=parse_quality(title),
    )


def test_shim_returns_torrenthit_type():
    hits = [_hit("M.2020.1080p.A", 50)]
    out = select_best(hits, "1080p")
    assert isinstance(out, TorrentHit)


def test_shim_picks_highest_seeded_exact_bucket():
    hits = [_hit("M.2020.1080p.A", 50), _hit("M.2020.1080p.B", 120),
            _hit("M.2020.2160p.C", 999)]
    assert select_best(hits, "1080p").seeds == 120


def test_shim_none_when_bucket_absent():
    hits = [_hit("M.2020.720p.W", 80)]
    assert select_best(hits, "2160p") is None


def test_shim_bytes_zero_never_wins_tiebreak():
    # parity with rank_candidates bytes-tiebreak: real release wins at equal seeds
    hits = [_hit("M.2020.1080p.Zero", 100, byts=0),
            _hit("M.2020.1080p.Real", 100, byts=5000)]
    assert select_best(hits, "1080p").bytes == 5000
```

- [ ] **Step 2: Run the test — expect FAIL** (the `test_shim_bytes_zero_never_wins_tiebreak` assertion fails today: old `max(..., key=(seeds, bytes))` is order-dependent and a 0-byte hit can win at equal seeds; also confirm the type test passes already but run the whole file).
```bash
docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest tests/test_select_best_shim.py -v
```

- [ ] **Step 3: Rewrite `select_best`.** Current body in `backend/app/services/torrents_select.py`:
```python
def select_best(hits: List[TorrentHit], quality: str) -> Optional[TorrentHit]:
    """Highest-seeded hit whose parsed quality == `quality` (ties -> larger bytes)."""
    matching = [h for h in hits if h.quality == quality]
    if not matching:
        return None
    return max(matching, key=lambda h: (h.seeds, h.bytes))
```
Replace it with:
```python
def select_best(hits: List[TorrentHit], quality: str) -> Optional[TorrentHit]:
    """Highest-seeded EXACT-quality hit (ties -> larger bytes, 0-byte never wins).

    Thin shim over rank_candidates so the bytes tiebreak is shared; returns the
    original TorrentHit (unchanged return type) for existing callers (cron/jobs.py).
    """
    from app.config import settings

    matching = [h for h in hits if h.quality == quality]
    if not matching:
        return None
    ranked = rank_candidates(
        matching, quality,
        min_seeds=settings.min_seeds, healthy_seeds=settings.healthy_seeds,
    )
    top_id = ranked[0].source_id
    by_id = {_source_id(h): h for h in matching}
    return by_id.get(top_id, matching[0])
```

- [ ] **Step 4: Run the test — expect PASS.**
```bash
docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest tests/test_select_best_shim.py -v
```

- [ ] **Step 5: Run the legacy selection tests to confirm parity** (`test_torrents_select.py` asserts highest-seeded + tie-on-larger-bytes + None-when-absent — all must still pass).
```bash
docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest tests/test_torrents_select.py tests/test_select_best_shim.py -v
```

- [ ] **Step 6: Commit.**
```bash
git add backend/app/services/torrents_select.py backend/tests/test_select_best_shim.py
git commit -m "refactor(selection): route select_best through rank_candidates as a shim"
```

---

### Task W1.6: Sources service functions — ranked candidates for a movie & an episode

**Files:**
- Modify: `backend/app/services/movies.py` (add `get_candidates`, near `get_torrents`, currently `backend/app/services/movies.py:92-98`)
- Modify: `backend/app/services/tv.py` (add `episode_candidates` / `season_candidates`, near `episode_torrents`/`season_torrents`, currently `backend/app/services/tv.py:80-91`)
- Test: `backend/tests/test_sources_service.py` (create)

**Interfaces:**
- Consumes: `catalog.torrents(name) -> List[TorrentHit]`, `rank_candidates(...)`, `resolve_title_year`, `resolve_show_name`, `settings.min_seeds`, `settings.healthy_seeds`.
- Produces:
  - `async def get_candidates(tmdb_id: int, quality: str) -> List[TorrentCandidate]` in `backend/app/services/movies.py`.
  - `async def episode_candidates(tmdb_id: int, season: int, episode: int, quality: str) -> List[TorrentCandidate]` in `backend/app/services/tv.py`.
  - `async def season_candidates(tmdb_id: int, season: int, quality: str) -> List[TorrentCandidate]` in `backend/app/services/tv.py`.

Steps:

- [ ] **Step 1: Write the failing test.** Create `backend/tests/test_sources_service.py`:
```python
import pytest
from app.models import TorrentHit, TorrentCandidate
from app.providers.quality import parse_quality
from app.services import movies as movie_service
from app.services import tv as tv_service


def _hit(title, seeds, byts=1000):
    return TorrentHit(title=title, seeds=seeds, peers=0, bytes=byts,
                      magnet=f"magnet:?xt=urn:btih:{abs(hash(title)) % (16**16):016x}",
                      hash="", quality=parse_quality(title))


@pytest.mark.asyncio
async def test_get_candidates_returns_ranked(monkeypatch):
    async def fake_resolve(tmdb_id):
        return "Movie Name", 2020

    async def fake_torrents(name):
        assert name == "Movie Name 2020"
        return [_hit("Movie.2020.1080p.A", 3), _hit("Movie.2020.1080p.B", 40)]

    monkeypatch.setattr(movie_service, "resolve_title_year", fake_resolve)
    monkeypatch.setattr(movie_service.catalog, "torrents", fake_torrents)

    out = await movie_service.get_candidates(123, "1080p")
    assert all(isinstance(c, TorrentCandidate) for c in out)
    assert out[0].seeds == 40 and out[0].health == "healthy"
    assert out[1].seeds == 3 and out[1].health == "low"


@pytest.mark.asyncio
async def test_get_candidates_empty_when_unresolved(monkeypatch):
    async def fake_resolve(tmdb_id):
        return None, None
    monkeypatch.setattr(movie_service, "resolve_title_year", fake_resolve)
    assert await movie_service.get_candidates(999, "1080p") == []


@pytest.mark.asyncio
async def test_episode_candidates_ranked(monkeypatch):
    async def fake_show(tmdb_id):
        return "Show"

    async def fake_torrents(name):
        assert name == "Show S01E04"
        return [_hit("Show.S01E04.720p", 10), _hit("Show.S01E04.1080p", 2)]

    monkeypatch.setattr(tv_service, "resolve_show_name", fake_show)
    monkeypatch.setattr(tv_service.catalog, "torrents", fake_torrents)

    out = await tv_service.episode_candidates(5, 1, 4, "1080p")
    # 1080p is "low" (seeds=2), 720p is "healthy" (seeds=10) -> healthy downgrade first
    assert out[0].quality == "720p" and out[0].is_season_pack is False
```

- [ ] **Step 2: Run the test — expect FAIL.** Fails with `AttributeError: module 'app.services.movies' has no attribute 'get_candidates'`.
```bash
docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest tests/test_sources_service.py -v
```

- [ ] **Step 3: Add `get_candidates` to movies.** In `backend/app/services/movies.py`, the current import block is:
```python
from app.models import CatalogPage, MovieDetail, CatalogItem
from app.providers import catalog, tmdb
from app.services.torrents_select import available_qualities
```
Replace it with:
```python
from app.models import CatalogPage, MovieDetail, CatalogItem, TorrentCandidate
from app.providers import catalog, tmdb
from app.services.torrents_select import available_qualities, rank_candidates
from app.config import settings
```
Then the current `get_torrents` function is:
```python
async def get_torrents(tmdb_id: int):
    """Return parsed torrent hits for a movie (by cached title/year or TMDB fallback)."""
    title, year = await resolve_title_year(tmdb_id)
    if not title:
        return []
    name = f"{title} {year}".strip() if year else title
    return await catalog.torrents(name)
```
Insert directly after it:
```python


async def get_candidates(tmdb_id: int, quality: str):
    """Ranked, health-classified TorrentCandidates for a movie at the requested quality."""
    hits = await get_torrents(tmdb_id)
    return rank_candidates(
        hits, quality,
        min_seeds=settings.min_seeds, healthy_seeds=settings.healthy_seeds,
    )
```

- [ ] **Step 4: Add candidate functions to tv.** In `backend/app/services/tv.py`, the current import block is:
```python
from app.models import CatalogPage, ShowDetail, SeasonDetail
from app.providers import catalog
from app.database.session import get_db
from app.database.models.catalog import CatalogItemCache
```
Replace it with:
```python
from app.models import CatalogPage, ShowDetail, SeasonDetail, TorrentCandidate
from app.providers import catalog
from app.services.torrents_select import rank_candidates
from app.config import settings
from app.database.session import get_db
from app.database.models.catalog import CatalogItemCache
```
Then the file currently ends with:
```python
async def season_torrents(tmdb_id: int, season: int):
    show = await resolve_show_name(tmdb_id)
    if not show:
        return []
    return await catalog.torrents(f"{show} S{season:02d}")
```
Append after it:
```python


async def episode_candidates(tmdb_id: int, season: int, episode: int, quality: str):
    """Ranked TorrentCandidates for a single episode at the requested quality."""
    hits = await episode_torrents(tmdb_id, season, episode)
    return rank_candidates(
        hits, quality,
        min_seeds=settings.min_seeds, healthy_seeds=settings.healthy_seeds,
    )


async def season_candidates(tmdb_id: int, season: int, quality: str):
    """Ranked TorrentCandidates for a whole-season pack at the requested quality."""
    hits = await season_torrents(tmdb_id, season)
    return rank_candidates(
        hits, quality,
        min_seeds=settings.min_seeds, healthy_seeds=settings.healthy_seeds,
    )
```

- [ ] **Step 5: Run the test — expect PASS.**
```bash
docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest tests/test_sources_service.py -v
```

- [ ] **Step 6: Commit.**
```bash
git add backend/app/services/movies.py backend/app/services/tv.py backend/tests/test_sources_service.py
git commit -m "feat(selection): ranked candidate service functions for movies and tv"
```

---

### Task W1.7: `GET /torrents/sources` endpoint — ranked candidates + health

**Files:**
- Modify: `backend/app/api/torrents.py` (imports at `backend/app/api/torrents.py:10-21`; add a new GET route after `download_movie`, currently ending at `:107`)
- Test: `backend/tests/test_sources_endpoint.py` (create)

**Interfaces:**
- Consumes: `movie_service.get_candidates(tmdb_id, quality)`, `tv_service.episode_candidates(...)`, `tv_service.season_candidates(...)`, `TorrentCandidate`.
- Produces: `GET /api/v1/torrents/sources` with query params `tmdb_id: int` (required), `quality: str = "1080p"`, `media_type: Literal['movie','tv'] = 'movie'`, `season: Optional[int] = None`, `episode: Optional[int] = None`; returns `List[TorrentCandidate]`.

Routing: `media_type == "tv"` + `season` given + `episode` given → `episode_candidates`; `media_type == "tv"` + `season` given + no episode → `season_candidates`; otherwise → `get_candidates`. `media_type == "tv"` with `season is None` → 422.

Steps:

- [ ] **Step 1: Write the failing test.** Create `backend/tests/test_sources_endpoint.py`:
```python
import os
os.environ.setdefault("DB_PATH", "/tmp/test_sources_endpoint.db")

import pytest
from fastapi.testclient import TestClient

import app.api.torrents as torrents_api
from app.models import TorrentCandidate
from app.main import app


def _cand(quality, seeds, health, src):
    return TorrentCandidate(
        source_id=src, magnet=f"magnet:?xt=urn:btih:{src}", quality=quality,
        seeds=seeds, peers=0, bytes=1000, health=health,
        is_season_pack=False, release_title=f"R.{quality}",
    )


@pytest.fixture()
def client(monkeypatch):
    async def fake_movie(tmdb_id, quality):
        return [_cand("1080p", 40, "healthy", "aaa"), _cand("720p", 2, "low", "bbb")]

    async def fake_episode(tmdb_id, season, episode, quality):
        return [_cand("1080p", 10, "healthy", "ccc")]

    monkeypatch.setattr(torrents_api.movie_service, "get_candidates", fake_movie)
    monkeypatch.setattr(torrents_api.tv_service, "episode_candidates", fake_episode)
    with TestClient(app) as c:
        yield c


def test_sources_movie(client):
    r = client.get("/api/v1/torrents/sources", params={"tmdb_id": 1, "quality": "1080p"})
    assert r.status_code == 200
    body = r.json()
    assert body[0]["source_id"] == "aaa" and body[0]["health"] == "healthy"
    assert body[1]["health"] == "low"


def test_sources_episode(client):
    r = client.get("/api/v1/torrents/sources", params={
        "tmdb_id": 5, "quality": "1080p", "media_type": "tv", "season": 1, "episode": 4})
    assert r.status_code == 200
    assert r.json()[0]["source_id"] == "ccc"


def test_sources_tv_requires_season(client):
    r = client.get("/api/v1/torrents/sources", params={
        "tmdb_id": 5, "quality": "1080p", "media_type": "tv"})
    assert r.status_code == 422
```

- [ ] **Step 2: Run the test — expect FAIL** (404, no such route).
```bash
docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest tests/test_sources_endpoint.py -v
```

- [ ] **Step 3: Add the route.** In `backend/app/api/torrents.py`, the current import block is:
```python
from app.models import (
    TorrentRequest, TorrentStatus, TorrentAction,
    TorrentBatchAction, TorrentBatchResponse, TorrentBatchResult,
)
from app.torrent.states import ACTIVE_DOWNLOAD_STATES, RESUMABLE_STATES
from app.services import movies as movie_service
from app.services import tv as tv_service
from app.services.torrents_select import select_best, available_qualities
```
Replace it with:
```python
from app.models import (
    TorrentRequest, TorrentStatus, TorrentAction,
    TorrentBatchAction, TorrentBatchResponse, TorrentBatchResult,
    TorrentCandidate,
)
from app.torrent.states import ACTIVE_DOWNLOAD_STATES, RESUMABLE_STATES
from app.services import movies as movie_service
from app.services import tv as tv_service
from app.services.torrents_select import select_best, available_qualities
```
Then, immediately after the `download_movie` function (which ends at the line `raise HTTPException(status_code=500, detail=str(e))` followed by a blank line, currently `:107`), insert:
```python


@router.get("/sources", response_model=List[TorrentCandidate], summary="Ranked torrent sources")
async def get_sources(
    tmdb_id: int = Query(..., description="TMDB id of the title"),
    quality: str = Query("1080p", description="Preferred quality bucket"),
    media_type: str = Query("movie", description="'movie' or 'tv'"),
    season: Optional[int] = Query(None, ge=0),
    episode: Optional[int] = Query(None, ge=1),
):
    """Ranked, health-classified candidate sources for a title (consumed by the picker)."""
    try:
        if media_type == "tv":
            if season is None:
                raise HTTPException(status_code=422, detail="season is required for TV sources")
            if episode is not None:
                return await tv_service.episode_candidates(tmdb_id, season, episode, quality)
            return await tv_service.season_candidates(tmdb_id, season, quality)
        return await movie_service.get_candidates(tmdb_id, quality)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
```

- [ ] **Step 4: Run the test — expect PASS.**
```bash
docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest tests/test_sources_endpoint.py -v
```

- [ ] **Step 5: Commit.**
```bash
git add backend/app/api/torrents.py backend/tests/test_sources_endpoint.py
git commit -m "feat(api): GET /torrents/sources returns ranked candidates with health"
```

---

### Task W1.8: `POST /torrents/download` — explicit candidate + auto-downgrade (remove hard 422)

**Files:**
- Modify: `backend/app/models.py` (`TorrentRequest`, currently `backend/app/models.py:341-347`; and `TorrentStatus`, currently `:318-338`)
- Modify: `backend/app/api/torrents.py` (`download_movie`, currently `backend/app/api/torrents.py:54-107`)
- Test: `backend/tests/test_download_select.py` (create)

**Interfaces:**
- Consumes: `rank_candidates(...)`, `TorrentCandidate`, `catalog.torrents`, `tv_service.resolve_show_name`, `movie_service.resolve_title_year`, `torrent_manager.add_torrent`, `torrent_manager.get_torrent_status`, `settings.min_seeds`, `settings.healthy_seeds`.
- Produces:
  - Two new optional fields on `TorrentRequest`: `magnet: Optional[str] = None`, `source_id: Optional[str] = None`.
  - One new optional field on `TorrentStatus`: `chosen_quality: Optional[str] = None` (records which quality the server actually picked after any downgrade).
  - New behavior in `download_movie`: if `magnet` given → use it directly (quality = `request.quality`); elif `source_id` given → match against ranked candidates by `source_id`; else → ranked top pick. No more hard 422 when the exact bucket is absent — the best available downgrade is used. Only 422 left: TV with `season is None`. Only 404: title/show unresolved. If `rank_candidates` returns empty (no hits at all) → 404 `"No torrents found"`.

Steps:

- [ ] **Step 1: Write the failing test.** Create `backend/tests/test_download_select.py`:
```python
import os
os.environ.setdefault("DB_PATH", "/tmp/test_download_select.db")

import types
import pytest
from fastapi.testclient import TestClient

import app.api.torrents as torrents_api
from app.models import TorrentHit
from app.providers.quality import parse_quality
from app.main import app


def _hit(title, seeds, byts=1000):
    return TorrentHit(title=title, seeds=seeds, peers=0, bytes=byts,
                      magnet=f"magnet:?xt=urn:btih:{abs(hash(title)) % (16**16):016x}",
                      hash="", quality=parse_quality(title))


@pytest.fixture()
def client(monkeypatch):
    state = types.SimpleNamespace(added=[])

    async def fake_resolve(tmdb_id):
        return "Movie", 2020

    async def fake_torrents(name):
        # No 1080p; a healthy 720p exists (downgrade target) + a dead 1080p
        return [_hit("Movie.2020.720p.WEB", 30), _hit("Movie.2020.1080p.Dead", 0)]

    async def fake_add(dl_movie, dl_torrent, save_path=None):
        state.added.append(dl_torrent)
        return "tid-1"

    def fake_status(tid):
        return types.SimpleNamespace(
            id=tid, movie_title="Movie", quality="720p",
            state="downloading", magnet="magnet:?x", progress=0.0,
            download_rate=0.0, upload_rate=0.0, total_downloaded=0,
            total_uploaded=0, num_peers=0, save_path="/x",
            created_at=__import__("datetime").datetime.utcnow(),
            updated_at=__import__("datetime").datetime.utcnow(),
            eta=None, error_message=None, chosen_quality=None,
        )

    monkeypatch.setattr(torrents_api.movie_service, "resolve_title_year", fake_resolve)
    monkeypatch.setattr(torrents_api.catalog, "torrents", fake_torrents)
    monkeypatch.setattr(torrents_api.torrent_manager, "add_torrent", fake_add)
    monkeypatch.setattr(torrents_api.torrent_manager, "get_torrent_status", fake_status)
    with TestClient(app) as c:
        c.state = state
        yield c


def test_download_auto_downgrades_instead_of_422(client):
    # Asked for 1080p (only a dead 1080p + healthy 720p exist) -> 720p chosen, no 422
    r = client.post("/api/v1/torrents/download",
                    json={"tmdb_id": 1, "quality": "1080p", "media_type": "movie"})
    assert r.status_code == 200
    assert client.state.added[-1].quality == "720p"


def test_download_explicit_magnet_used_verbatim(client):
    r = client.post("/api/v1/torrents/download", json={
        "tmdb_id": 1, "quality": "1080p", "media_type": "movie",
        "magnet": "magnet:?xt=urn:btih:deadbeefcafebabe0000"})
    assert r.status_code == 200
    assert client.state.added[-1].magnet == "magnet:?xt=urn:btih:deadbeefcafebabe0000"
    assert client.state.added[-1].quality == "1080p"
```

- [ ] **Step 2: Run the test — expect FAIL** (today the no-1080p case returns 422, and `magnet`/`source_id` are not accepted fields → ignored, and `chosen_quality` is unknown to `TorrentStatus`).
```bash
docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest tests/test_download_select.py -v
```

- [ ] **Step 3: Extend `TorrentRequest` and `TorrentStatus`.** In `backend/app/models.py`, the current `TorrentRequest` is:
```python
class TorrentRequest(BaseModel):
    tmdb_id: int
    quality: Literal['720p', '1080p', '2160p'] = '1080p'
    save_path: Optional[str] = None
    media_type: Literal['movie', 'tv'] = 'movie'
    season: Optional[int] = Field(None, ge=0)
    episode: Optional[int] = Field(None, ge=1)
```
Replace it with:
```python
class TorrentRequest(BaseModel):
    tmdb_id: int
    quality: Literal['720p', '1080p', '2160p'] = '1080p'
    save_path: Optional[str] = None
    media_type: Literal['movie', 'tv'] = 'movie'
    season: Optional[int] = Field(None, ge=0)
    episode: Optional[int] = Field(None, ge=1)
    # Explicit user choice from the source picker (WS1/WS2). When set, it overrides
    # the server's ranked top pick. `magnet` wins over `source_id` if both are given.
    magnet: Optional[str] = None
    source_id: Optional[str] = None
```
Then the current `TorrentStatus` ends with:
```python
    eta: Optional[int] = None   # Estimated seconds remaining
    error_message: Optional[str] = None
```
Replace those two lines with:
```python
    eta: Optional[int] = None   # Estimated seconds remaining
    error_message: Optional[str] = None
    chosen_quality: Optional[str] = None  # quality actually selected (after any downgrade)
```

- [ ] **Step 4: Rewrite `download_movie`.** In `backend/app/api/torrents.py`, the current function body from the `hits = await catalog.torrents(name)` line through the `return status` line is:
```python
        hits = await catalog.torrents(name)
        best = select_best(hits, request.quality)
        if best is None:
            avail = available_qualities(hits)
            raise HTTPException(
                status_code=422,
                detail=f"No {request.quality} release found. Available: {avail or 'none'}",
            )

        dl_movie = _DlMovie(
            title=label, year=year, genre="",
            tmdb_id=request.tmdb_id, media_type=request.media_type,
            season=request.season, episode=request.episode,
        )
        dl_torrent = _DlTorrent(
            id=str(_uuid.uuid4()),
            quality=request.quality,
            magnet=best.magnet,
            url=best.magnet,
            sizes=(_human_size(best.bytes), ""),
        )
        save_path = PathLib(request.save_path) if request.save_path else None
        torrent_id = await torrent_manager.add_torrent(dl_movie, dl_torrent, save_path)

        status = torrent_manager.get_torrent_status(torrent_id)
        if not status:
            raise HTTPException(status_code=500, detail="Failed to get torrent status")
        return status
```
Replace that entire block with:
```python
        chosen_magnet: str
        chosen_quality: str
        chosen_bytes: int = 0

        if request.magnet:
            # Explicit magnet from the picker: use verbatim, trust the requested bucket.
            chosen_magnet = request.magnet
            chosen_quality = request.quality
        else:
            hits = await catalog.torrents(name)
            candidates = rank_candidates(
                hits, request.quality,
                min_seeds=settings.min_seeds, healthy_seeds=settings.healthy_seeds,
            )
            if not candidates:
                raise HTTPException(status_code=404, detail="No torrents found")
            chosen = None
            if request.source_id:
                chosen = next(
                    (c for c in candidates if c.source_id == request.source_id), None
                )
            if chosen is None:
                # No explicit pick (or it was stale) -> ranked top pick (best healthy
                # downgrade). No hard 422: the user always gets the best available.
                chosen = candidates[0]
            chosen_magnet = chosen.magnet
            chosen_quality = chosen.quality or request.quality
            chosen_bytes = chosen.bytes

        dl_movie = _DlMovie(
            title=label, year=year, genre="",
            tmdb_id=request.tmdb_id, media_type=request.media_type,
            season=request.season, episode=request.episode,
        )
        dl_torrent = _DlTorrent(
            id=str(_uuid.uuid4()),
            quality=chosen_quality,
            magnet=chosen_magnet,
            url=chosen_magnet,
            sizes=(_human_size(chosen_bytes), ""),
        )
        save_path = PathLib(request.save_path) if request.save_path else None
        torrent_id = await torrent_manager.add_torrent(dl_movie, dl_torrent, save_path)

        status = torrent_manager.get_torrent_status(torrent_id)
        if not status:
            raise HTTPException(status_code=500, detail="Failed to get torrent status")
        status.chosen_quality = chosen_quality
        return status
```

- [ ] **Step 5: Wire up the `rank_candidates` import.** In `backend/app/api/torrents.py` the current selection import is:
```python
from app.services.torrents_select import select_best, available_qualities
```
Replace it with:
```python
from app.services.torrents_select import select_best, available_qualities, rank_candidates
```

- [ ] **Step 6: Run the test — expect PASS.**
```bash
docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest tests/test_download_select.py -v
```

- [ ] **Step 7: Run the broader API + selection suites to confirm no regressions** (existing `test_torrents_api.py` action/batch/delete tests, plus all W1 tests).
```bash
docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest tests/test_torrents_api.py tests/test_torrents_select.py tests/test_select_best_shim.py tests/test_rank_candidates.py tests/test_sources_endpoint.py tests/test_download_select.py -v
```

- [ ] **Step 8: Commit.**
```bash
git add backend/app/models.py backend/app/api/torrents.py backend/tests/test_download_select.py
git commit -m "feat(api): download accepts explicit candidate, auto-downgrades instead of 422"
```

---

### Task W1.9: cron parity guard — verify `select_best` shim leaves scheduled downloads unchanged

**Files:**
- Test: `backend/tests/test_cron_select_parity.py` (create) — no production code change; `cron/jobs.py` keeps importing `select_best` (verified at `backend/app/cron/jobs.py:18` and used at `:284`).

**Interfaces:**
- Consumes: `select_best(hits, quality) -> Optional[TorrentHit]` (W1.5 shim), `rank_candidates(...)`.
- Produces: nothing (regression guard only).

Steps:

- [ ] **Step 1: Write the guard test.** Create `backend/tests/test_cron_select_parity.py`:
```python
from app.cron.jobs import select_best as cron_select_best
from app.services.torrents_select import select_best
from app.models import TorrentHit
from app.providers.quality import parse_quality


def _hit(title, seeds, byts=1000):
    return TorrentHit(title=title, seeds=seeds, peers=0, bytes=byts,
                      magnet=f"magnet:?xt=urn:btih:{abs(hash(title)) % (16**16):016x}",
                      hash="", quality=parse_quality(title))


def test_cron_imports_the_shim():
    # cron/jobs.py must keep using the same select_best symbol (return type unchanged)
    assert cron_select_best is select_best


def test_cron_skip_behavior_preserved_when_bucket_absent():
    # cron skips a title when no exact-quality release exists -> shim returns None
    hits = [_hit("Title.2020.720p.WEB", 50)]
    assert cron_select_best(hits, "1080p") is None


def test_cron_picks_exact_quality_release():
    hits = [_hit("Title.2020.1080p.A", 5), _hit("Title.2020.1080p.B", 80)]
    best = cron_select_best(hits, "1080p")
    assert best is not None and best.seeds == 80 and best.quality == "1080p"
```

- [ ] **Step 2: Run the test — expect PASS** (no production change needed; this confirms the W1.5 shim preserves cron semantics: `select_best` is the same object, returns `None` when the bucket is absent, and picks the highest-seeded exact match).
```bash
docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest tests/test_cron_select_parity.py -v
```

- [ ] **Step 3: Commit.**
```bash
git add backend/tests/test_cron_select_parity.py
git commit -m "test(cron): guard select_best shim parity for scheduled downloads"
```

---

### Task W1.10: Full W1 suite green sweep + image bake

**Files:** none (verification only).

Steps:

- [ ] **Step 1: Rebuild the image so the new test files are baked in** (per CLAUDE.md, tests are not bind-mounted by the dev override; bake them so future `make test` runs see them).
```bash
make build
```

- [ ] **Step 2: Run every W1 test through the standard baked-in runner — expect ALL PASS.**
```bash
docker compose run --rm backend python -m pytest \
  tests/test_selection_config.py tests/test_classify_health.py \
  tests/test_candidate_helpers.py tests/test_rank_candidates.py \
  tests/test_select_best_shim.py tests/test_sources_service.py \
  tests/test_sources_endpoint.py tests/test_download_select.py \
  tests/test_cron_select_parity.py tests/test_torrents_select.py \
  tests/test_torrents_api.py -v
```

- [ ] **Step 3: Run the entire backend suite to confirm no cross-module regressions — expect PASS.**
```bash
docker compose run --rm backend python -m pytest -q
```

- [ ] **Step 4: Commit** (records the green state; no file changes if the build produced none, so use `--allow-empty` to mark the milestone).
```bash
git commit --allow-empty -m "test(selection): WS1 suite green (ranked candidates, health, downgrade)"
```

---

**WS1 deliverables for downstream workstreams:**
- `app.models.TorrentCandidate` (fields: `source_id, magnet, quality, seeds, peers, bytes, health, is_season_pack, release_title`) — consumed by WS2 (`SourcePicker`) and WS6 (in-player switcher).
- `GET /api/v1/torrents/sources?tmdb_id&quality&media_type&season&episode` → `List[TorrentCandidate]` — consumed by WS2 pre-stream validation.
- `POST /api/v1/torrents/download` now accepts `magnet` / `source_id` and returns `TorrentStatus.chosen_quality` — consumed by WS2/WS6 source switching.
- `rank_candidates`, `classify_health` in `app.services.torrents_select` — reusable by WS5/WS6 if needed.
- `select_best` retained, return type unchanged; `cron/jobs.py` unaffected.

---

## Workstream W2: Pre-stream validation + staged flow feedback (frontend)

This workstream makes the streaming flow swarm-health-aware end to end on the frontend. It defines the **shared TypeScript types** (`StreamPhase`, `SwarmHealth`, `TorrentCandidate`, `StreamHealthState`), the **single derivation utility** `deriveStreamHealth`, the **`getSources` service** + download-request widening, the **single-poll-owner** cadence on the streaming page, a **`StreamPhasePanel`** warm-up panel with health messaging, **health badges** in `SourcePicker`, and **pre-stream seeder validation** in `MovieDetailView` that surfaces ranked alternatives (no silent auto-switch). It also **declares** the optional player prop seam (`streamHealth`, `sources`, `currentSourceId`, `onSelectSource`, `onRecoveryExhausted`) on both player components and passes those props **unconditionally** from the page (declaration + wiring only — the *behavior* behind those props is W6's job).

W2 OWNS every symbol it defines here per the ownership contract. W6 imports these and must NOT redefine them. **W2 also OWNS the optional-prop DECLARATION on `VideoPlayerProps` / `PatchedVideoPlayerProps`** (the seam); W6 OWNS the *behavior* behind those props and must NOT redeclare them. The frontend has no unit harness, so every task ends with `(cd frontend && npx tsc --noEmit)` plus a concrete manual checklist at `http://localhost:3001`.

**Sequence note (authoritative seam contract):** W2 lands BEFORE W6. So that the page can pass props the player will only *consume* in W6, W2 adds the five props as OPTIONAL pass-through declarations on both player components in a dedicated declaration step (W2.6). An unused optional prop is NOT a tsc error, so `VideoPlayer` may leave them unconsumed until W6. There is **NO** `void x;` placeholder anywhere and **NO** "if props already declared" conditional — the declaration is guaranteed by W2.6, so the page passes all five props unconditionally.

**Baseline note:** the "current code" below is the repo AFTER W1 and W3 have landed. W1 ships the backend `GET /api/v1/torrents/sources` endpoint returning `List[TorrentCandidate]`, `POST /torrents/download` accepting optional `magnet`/`source_id`, and `TorrentStatus.chosen_quality`. The §5.2 health fields (`stream_phase`, `num_seeds`, `num_peers`, `download_rate`, `health`) are NOT yet emitted by the backend status payload in this sequence — W2 therefore **derives** `stream_phase` and `health` client-side from the existing `TorrentStatus` (`state`, `progress`, `num_peers`) via `deriveStreamHealth`, and the optional status fields it adds are forward-compatible (consumed if the backend later emits them, derived otherwise).

---

### Task W2.1: Shared stream-health types in `types/index.ts`

**Files:**
- Modify: `frontend/src/types/index.ts` — extend the existing `TorrentStatus` interface (currently lines 93-109) and add new exported types after it.

**Interfaces:**
- Produces (exported from `@/types`):
  - `export type StreamPhase = 'searching' | 'connecting' | 'metadata' | 'buffering' | 'ready'`
  - `export type SwarmHealth = 'healthy' | 'low' | 'dead'`
  - `export interface TorrentCandidate { source_id: string; magnet: string; quality: string; seeds: number; peers: number; bytes: number; health: SwarmHealth; is_season_pack: boolean; release_title: string }`
  - `export interface StreamHealthState { stream_phase: StreamPhase; num_seeds: number; num_peers: number; download_rate: number; health: SwarmHealth }`
  - Extends existing `TorrentStatus` with optional: `stream_phase?: StreamPhase; num_seeds?: number; num_peers?: number; download_rate?: number; health?: SwarmHealth; chosen_quality?: string`.
- Consumes: nothing.

Steps:

- [ ] **Step 1: Confirm the current `TorrentStatus` block.** It is exactly (lines 93-109):
```ts
export interface TorrentStatus {
  id: string;
  movie_title: string;
  quality: string;
  state: TorrentState;
  progress: number;
  download_rate: number;
  upload_rate: number;
  total_downloaded: number;
  total_uploaded: number;
  num_peers: number;
  save_path: string;
  created_at: string;
  updated_at: string;
  eta?: number;
  error_message?: string;
}
```

- [ ] **Step 2: Extend `TorrentStatus` with the optional §5.2 fields + `chosen_quality`.** Replace the two trailing lines:
```ts
  eta?: number;
  error_message?: string;
}
```
with:
```ts
  eta?: number;
  error_message?: string;
  // §5.2 stream-health fields. Optional + forward-compatible: emitted by the
  // backend status payload in a later workstream; derived client-side via
  // deriveStreamHealth() until then. `download_rate`/`num_peers` already exist
  // above as required fields — these duplicates are the explicit health-channel
  // names the backend may add; keep them optional to avoid a breaking rename.
  stream_phase?: StreamPhase;
  num_seeds?: number;
  health?: SwarmHealth;
  // chosen quality after any server-side downgrade (W1 TorrentStatus.chosen_quality)
  chosen_quality?: string;
}
```
(Do NOT re-add `num_peers`/`download_rate` — they already exist as required fields and `deriveStreamHealth` reads those.)

- [ ] **Step 3: Add the new shared types immediately after the `TorrentStatus` block** (before `export interface TorrentRequest`):
```ts

// --- Stream-health / phase model (§5.2 — single source of truth) ---
// W2 OWNS these. W6 imports them; it must NOT redefine StreamPhase / SwarmHealth
// / TorrentCandidate / StreamHealthState anywhere.
export type StreamPhase = 'searching' | 'connecting' | 'metadata' | 'buffering' | 'ready';
export type SwarmHealth = 'healthy' | 'low' | 'dead';

// Ranked, health-classified torrent option (mirrors backend app.models.TorrentCandidate).
export interface TorrentCandidate {
  source_id: string;
  magnet: string;
  quality: string;
  seeds: number;
  peers: number;
  bytes: number;
  health: SwarmHealth;
  is_season_pack: boolean;
  release_title: string;
}

// Derived/polled stream-health snapshot passed from the streaming page to the player.
export interface StreamHealthState {
  stream_phase: StreamPhase;
  num_seeds: number;
  num_peers: number;
  download_rate: number;
  health: SwarmHealth;
}
```

- [ ] **Step 4: Typecheck — expect PASS.**
```bash
(cd frontend && npx tsc --noEmit)
```
Expected: no errors (these are pure additive type declarations; `StreamPhase`/`SwarmHealth` are now referenced by the new `TorrentStatus` optional fields and resolve within the same module).

- [ ] **Step 5: Commit.**
```bash
git add frontend/src/types/index.ts
git commit -m "feat(types): add StreamPhase, SwarmHealth, TorrentCandidate, StreamHealthState"
```

---

### Task W2.2: `deriveStreamHealth` — single source of truth for phase + health

**Files:**
- Create: `frontend/src/utils/streamHealth.ts`

**Interfaces:**
- Consumes: `TorrentStatus`, `StreamHealthState`, `StreamPhase`, `SwarmHealth`, `TorrentState` (from `@/types`).
- Produces: `export function deriveStreamHealth(status: TorrentStatus): StreamHealthState`. There is **NO** separate `deriveStreamPhase` — phase is computed inside this one function.

Derivation contract (grounded in the existing `TorrentState` enum and `TorrentStatus` fields):
- `num_seeds` = `status.num_seeds ?? status.num_peers` (backend may later split seeds from peers; until then peers is the only live signal).
- `num_peers` = `status.num_peers`.
- `download_rate` = `status.download_rate`.
- `health` (prefer backend `status.health` if present, else derive from peers): `dead` when `num_peers === 0`; `low` when `num_peers < 5`; else `healthy`.
- `stream_phase` (prefer backend `status.stream_phase` if present, else derive):
  - `ready` when `status.state` is `finished` or `seeding`, OR (`state === downloading` AND `progress >= 2`).
  - `metadata` when `state === downloading_metadata` OR (`state === checking`/`checking_fastresume`/`allocating`).
  - `connecting` when `state === downloading` AND `progress < 2` AND `num_peers > 0`.
  - `searching` when `num_peers === 0` AND not yet ready (covers `queued`, freshly-added downloading with 0 peers).
  - `buffering` is the residual (`downloading`, `progress < 2`, but none of the above) — kept distinct so the panel can say "Buffering" vs "Connecting".

Steps:

- [ ] **Step 1: Write the module.** Create `frontend/src/utils/streamHealth.ts`:
```ts
// frontend/src/utils/streamHealth.ts
//
// deriveStreamHealth — the SINGLE source of truth that maps a polled TorrentStatus
// to a StreamHealthState (stream_phase + swarm health). W2 owns this; W6 imports it.
// There is NO separate deriveStreamPhase: phase is computed here.

import { TorrentStatus, StreamHealthState, StreamPhase, SwarmHealth, TorrentState } from '@/types';

const READY_PROGRESS = 2; // % buffered before the player may start (matches isStreamingReady)
const HEALTHY_PEERS = 5;  // mirrors backend healthy_seeds default

function deriveHealth(numPeers: number): SwarmHealth {
  if (numPeers === 0) return 'dead';
  if (numPeers < HEALTHY_PEERS) return 'low';
  return 'healthy';
}

function derivePhase(status: TorrentStatus, numPeers: number): StreamPhase {
  const { state, progress } = status;

  if (
    state === TorrentState.FINISHED ||
    state === TorrentState.SEEDING ||
    (state === TorrentState.DOWNLOADING && progress >= READY_PROGRESS)
  ) {
    return 'ready';
  }

  if (
    state === TorrentState.DOWNLOADING_METADATA ||
    state === TorrentState.CHECKING ||
    state === TorrentState.CHECKING_FASTRESUME ||
    state === TorrentState.ALLOCATING
  ) {
    return 'metadata';
  }

  if (numPeers === 0) return 'searching';

  if (state === TorrentState.DOWNLOADING && progress < READY_PROGRESS) {
    return 'connecting';
  }

  return 'buffering';
}

export function deriveStreamHealth(status: TorrentStatus): StreamHealthState {
  const num_peers = status.num_peers ?? 0;
  const num_seeds = status.num_seeds ?? num_peers;
  const download_rate = status.download_rate ?? 0;
  const health: SwarmHealth = status.health ?? deriveHealth(num_peers);
  const stream_phase: StreamPhase = status.stream_phase ?? derivePhase(status, num_peers);
  return { stream_phase, num_seeds, num_peers, download_rate, health };
}
```

- [ ] **Step 2: Typecheck — expect PASS.**
```bash
(cd frontend && npx tsc --noEmit)
```
Expected: no errors. (`TorrentState` is an enum imported from `@/types`; all referenced members exist.)

- [ ] **Step 3: Sanity-print the derivation for three representative statuses** (no harness — use a throwaway ts-node-free check via a tiny inline script compiled by tsc-of-the-build is overkill; instead verify by reasoning + the manual checklist in W2.5). Add a temporary console probe ONLY if desired, then remove it. Skip if confident.

- [ ] **Step 4: Commit.**
```bash
git add frontend/src/utils/streamHealth.ts
git commit -m "feat(stream): deriveStreamHealth single source of truth for phase + health"
```

---

### Task W2.3: `getSources` service + download-request widening

**Files:**
- Modify: `frontend/src/types/index.ts` — widen `CatalogTorrentRequest` (currently lines 241-248).
- Modify: `frontend/src/services/torrents.ts` — add `getSources` and a typed params interface (current file lines 1-67).

**Interfaces:**
- Consumes: `apiClient` (`./api-client`), `TorrentCandidate`, `CatalogTorrentRequest` (from `@/types`).
- Produces:
  - Widened `CatalogTorrentRequest` with optional `magnet?: string; source_id?: string` (keeps required `tmdb_id` + `quality`).
  - `export interface SourcesParams { tmdb_id: number; quality?: string; media_type?: 'movie' | 'tv'; season?: number; episode?: number }`
  - `torrentsService.getSources(params: SourcesParams): Promise<TorrentCandidate[]>` hitting `GET /torrents/sources`. NO `as any`.

Steps:

- [ ] **Step 1: Widen `CatalogTorrentRequest`.** In `frontend/src/types/index.ts` the current block (lines 241-248) is:
```ts
export interface CatalogTorrentRequest {
  tmdb_id: number;
  quality: '720p' | '1080p' | '2160p';
  save_path?: string;
  media_type?: 'movie' | 'tv';
  season?: number;
  episode?: number;
}
```
Replace it with:
```ts
export interface CatalogTorrentRequest {
  tmdb_id: number;
  quality: '720p' | '1080p' | '2160p';
  save_path?: string;
  media_type?: 'movie' | 'tv';
  season?: number;
  episode?: number;
  // Explicit user pick from the source picker (W1/W2). `magnet` wins over
  // `source_id` server-side; both optional so existing callers are unaffected.
  magnet?: string;
  source_id?: string;
}
```

- [ ] **Step 2: Typecheck — expect PASS** (purely additive optional fields).
```bash
(cd frontend && npx tsc --noEmit)
```

- [ ] **Step 3: Add `getSources` + `SourcesParams` to the service.** In `frontend/src/services/torrents.ts`, the current import line is:
```ts
import { TorrentStatus, TorrentRequest, TorrentAction, TorrentBatchActionType, TorrentBatchResponse, CatalogTorrentRequest } from '@/types';
```
Replace it with:
```ts
import { TorrentStatus, TorrentRequest, TorrentAction, TorrentBatchActionType, TorrentBatchResponse, CatalogTorrentRequest, TorrentCandidate } from '@/types';

export interface SourcesParams {
  tmdb_id: number;
  quality?: string;
  media_type?: 'movie' | 'tv';
  season?: number;
  episode?: number;
}
```
Then, inside the `torrentsService` object, immediately after the `downloadCatalogMovie` method (which ends at the `},` after `return response.data;` on line 15), insert:
```ts

  // Ranked, health-classified torrent sources for a title (W1 GET /torrents/sources)
  getSources: async (params: SourcesParams): Promise<TorrentCandidate[]> => {
    const response = await apiClient.get(`/torrents/sources`, { params });
    return response.data;
  },
```

- [ ] **Step 4: Typecheck — expect PASS.**
```bash
(cd frontend && npx tsc --noEmit)
```
Expected: no errors. `apiClient.get` returns `AxiosResponse<any>`, so `response.data` assigns to `TorrentCandidate[]` without a cast.

- [ ] **Step 5: Commit.**
```bash
git add frontend/src/types/index.ts frontend/src/services/torrents.ts
git commit -m "feat(torrents): getSources service + widen catalog download request with magnet/source_id"
```

---

### Task W2.4: `StreamPhasePanel` — staged warm-up panel with health messaging

**Files:**
- Create: `frontend/src/components/streaming/StreamPhasePanel.tsx`

**Interfaces:**
- Consumes: `StreamHealthState`, `StreamPhase`, `SwarmHealth` (from `@/types`); `cn` (`@/lib/cn`).
- Produces: a default-exported React component:
```ts
export interface StreamPhasePanelProps {
  health: StreamHealthState;
  progress: number;            // torrent overall progress %
  onForceStart?: () => void;   // "Start anyway" escape hatch (page-owned)
  showForceStart?: boolean;
}
```
Renders the staged label per `health.stream_phase` and carries 0-peer / dead messaging via `health.health`. Phase labels: `searching` → "Finding sources…", `connecting` → "Connecting to peers…", `metadata` → "Fetching metadata…", `buffering` → "Buffering N%…", `ready` → "Almost ready…". When `health.health === 'dead'` (0 peers) it shows a distinct "Waiting for peers — no seeders connected yet" line instead of a generic spinner caption.

Steps:

- [ ] **Step 1: Create the component.** `frontend/src/components/streaming/StreamPhasePanel.tsx`:
```tsx
'use client';

/**
 * StreamPhasePanel — the warm-up panel shown in the streaming page's player area
 * before there's enough buffered to play. Renders a staged label derived from
 * StreamHealthState.stream_phase and surfaces 0-peer / dead-swarm messaging via
 * the health prop. W2 owns this; the page renders it and owns onForceStart.
 */

import React from 'react';
import { StreamHealthState, StreamPhase } from '@/types';
import { cn } from '@/lib/cn';

export interface StreamPhasePanelProps {
  health: StreamHealthState;
  progress: number;
  onForceStart?: () => void;
  showForceStart?: boolean;
}

const PHASE_LABEL: Record<StreamPhase, string> = {
  searching: 'Finding sources…',
  connecting: 'Connecting to peers…',
  metadata: 'Fetching metadata…',
  buffering: 'Buffering…',
  ready: 'Almost ready…',
};

const StreamPhasePanel: React.FC<StreamPhasePanelProps> = ({
  health,
  progress,
  onForceStart,
  showForceStart = false,
}) => {
  const { stream_phase, num_peers, health: swarm } = health;
  const isDead = swarm === 'dead';

  const headline =
    stream_phase === 'buffering'
      ? `Buffering ${Math.round(progress)}%…`
      : PHASE_LABEL[stream_phase];

  // Sub-line distinguishes a dead swarm (0 peers) from a slow one (N peers).
  const subline = isDead
    ? 'Waiting for peers — no seeders connected yet'
    : num_peers > 0
    ? `${Math.round(progress)}% downloaded · ${num_peers} peer${num_peers === 1 ? '' : 's'}`
    : `${Math.round(progress)}% downloaded`;

  return (
    <div
      className="absolute inset-0 flex flex-col items-center justify-center gap-5 bg-ink px-6 text-center"
      data-testid="stream-phase-panel"
      data-phase={stream_phase}
      data-health={swarm}
    >
      <div
        className={cn(
          'w-12 h-12 rounded-full border-2 animate-spin',
          isDead ? 'border-hairline border-t-rust' : 'border-hairline border-t-gold',
        )}
        aria-label={headline}
      />
      <div>
        <p className="font-display text-xl text-text tracking-tight" data-testid="stream-phase-headline">
          {headline}
        </p>
        <p className="mt-1.5 text-sm text-muted" data-testid="stream-phase-subline">
          {subline}
        </p>
      </div>
      {showForceStart && onForceStart && (
        <button
          onClick={onForceStart}
          className="text-xs text-muted underline-offset-4 transition-colors hover:text-gold hover:underline"
        >
          Start anyway
        </button>
      )}
    </div>
  );
};

export default StreamPhasePanel;
```

- [ ] **Step 2: Confirm the `border-t-rust` token exists; if not, fall back to `border-t-gold`.** Check:
```bash
grep -rn "rust" /Users/benjaminherro/github/freeflix/frontend/src/app/globals.css /Users/benjaminherro/github/freeflix/frontend/tailwind.config.* 2>/dev/null | head
```
If `rust` is not a defined color token, replace the conditional `isDead ? 'border-hairline border-t-rust' : ...` with `'border-hairline border-t-gold'` (drop the dead-color branch — the headline/subline already convey the dead state). Do not invent a token.

- [ ] **Step 3: Typecheck — expect PASS.**
```bash
(cd frontend && npx tsc --noEmit)
```

- [ ] **Step 4: Commit.**
```bash
git add frontend/src/components/streaming/StreamPhasePanel.tsx
git commit -m "feat(streaming): StreamPhasePanel staged warm-up panel with health messaging"
```

---

### Task W2.5: Streaming page — single poll owner, adaptive cadence, StreamPhasePanel, source switch + recovery handlers

**Files:**
- Modify: `frontend/src/app/streaming/[id]/page.tsx` — imports (lines 1-20), the polling effect (lines 75-184), the warm-up fallback panel (lines 462-485), and add `sources` fetch + `handleSelectSource` + `handleRecoveryExhausted` (passed to the player in W2.6).

**Interfaces:**
- Consumes: `deriveStreamHealth` (`@/utils/streamHealth`), `StreamHealthState`, `TorrentCandidate` (`@/types`), `torrentsService.getSources` / `torrentsService.downloadCatalogMovie`, `StreamPhasePanel`, `toast` (`react-hot-toast`).
- Produces (within the page): a single polling interval owner with **fast (~1.5 s) while not ready, relaxed (~5 s) once playing** cadence; a derived `streamHealth: StreamHealthState`; `sources: TorrentCandidate[]`; `handleSelectSource(c: TorrentCandidate)` implementing the same-torrent `file_index` swap vs different-torrent new-download (+ `router.replace`) logic; `handleRecoveryExhausted()` that reveals the source-switch affordance. W6 must NOT touch this poll.

Steps:

- [ ] **Step 1: Extend the page imports.** The current line 7 is:
```ts
import { TorrentStatus, StreamingInfo, TorrentState, VideoFile } from '@/types';
```
Replace it with:
```ts
import { TorrentStatus, StreamingInfo, TorrentState, VideoFile, TorrentCandidate, StreamHealthState } from '@/types';
```
Then replace the trailing import block (lines 18-20):
```ts
import { formatBytes } from '@/utils/format';
import { isStreamingReady } from '@/utils/streaming';
import { cn } from '@/lib/cn';
```
with:
```ts
import { formatBytes } from '@/utils/format';
import { isStreamingReady } from '@/utils/streaming';
import { deriveStreamHealth } from '@/utils/streamHealth';
import StreamPhasePanel from '@/components/streaming/StreamPhasePanel';
import { toast } from 'react-hot-toast';
import { cn } from '@/lib/cn';
```

- [ ] **Step 2: Add `sources` + `showSources` state + a derived `streamHealth`.** After the existing `const [videoFileProgress, setVideoFileProgress] = useState<number>(0);` line (line 44), insert:
```ts
  // Ranked alternative sources for the in-player switcher (W1 /torrents/sources).
  const [sources, setSources] = useState<TorrentCandidate[]>([]);
  // Revealed when in-player recovery is exhausted — the page surfaces the
  // source-switch affordance (W6 calls onRecoveryExhausted → setShowSources).
  const [showSources, setShowSources] = useState(false);
```
Then, immediately after the `// Up-Next card` state declaration block (after line 47 `const [showUpNext, setShowUpNext] = useState(false);`), insert the derived health (recomputed each render from the latest status):
```ts

  // Single derived stream-health snapshot (§5.2). The page is the ONLY poller;
  // this is passed to the player so it never runs its own status poll.
  const streamHealth: StreamHealthState | null = torrentStatus
    ? deriveStreamHealth(torrentStatus)
    : null;
```

- [ ] **Step 3: Change the poll cadence to adaptive (single owner).** The current closing of the interval (line 181) is:
```ts
    }, 5000);
```
Replace it with:
```ts
    }, isStreamReady ? 5000 : 1500);
```
(The effect already re-runs when `isStreamReady` flips because it is in the dependency array on the final line, so the interval is torn down and recreated at the relaxed cadence once the stream is ready — no extra wiring needed.)

- [ ] **Step 4: Fetch ranked sources once the torrent is known.** Add a new effect after the file-list effect (after line 60, the `}, [torrentId]);` of the `getFiles` effect). Insert:
```ts

  // Fetch ranked alternative sources for the in-player switcher. Best-effort:
  // a failure just leaves the switcher empty (no alternatives offered).
  useEffect(() => {
    if (!torrentStatus) return;
    let cancelled = false;
    // Derive tmdb_id from the streaming info when available; the sources call is
    // keyed by the catalog id, which the streaming page does not always hold, so
    // we only fetch when streamingInfo carries content_id we can parse.
    const cid = streamingInfo?.content_id;
    if (!cid) return;
    // content_id: "movie:{tmdb}" | "tv:{tmdb}:s{n}:e{n}"
    const parts = cid.split(':');
    const tmdb = Number(parts[1]);
    if (!Number.isInteger(tmdb)) return;
    const isTv = parts[0] === 'tv';
    const season = isTv ? Number(parts[2]?.replace(/^s/, '')) : undefined;
    const episode = isTv ? Number(parts[3]?.replace(/^e/, '')) : undefined;
    torrentsService
      .getSources({
        tmdb_id: tmdb,
        quality: torrentStatus.quality,
        media_type: isTv ? 'tv' : 'movie',
        season: Number.isInteger(season) ? season : undefined,
        episode: Number.isInteger(episode) ? episode : undefined,
      })
      .then((list) => { if (!cancelled) setSources(list); })
      .catch(() => { if (!cancelled) setSources([]); });
    return () => { cancelled = true; };
  }, [streamingInfo?.content_id, torrentStatus?.quality]);
```

- [ ] **Step 5: Add the content-id parse helpers + `handleSelectSource` + `handleRecoveryExhausted`.** Insert after the existing `handleFileSelect` function (after line 287, the `};` of `handleFileSelect`):
```ts

  // Parse the watch-identity content_id into download params for a source switch.
  const _cidParts = (streamingInfo?.content_id ?? '').split(':');
  const streamingTmdbId: number | undefined = Number.isInteger(Number(_cidParts[1]))
    ? Number(_cidParts[1])
    : undefined;
  const streamingMediaType: 'movie' | 'tv' = _cidParts[0] === 'tv' ? 'tv' : 'movie';
  const streamingSeason: number | undefined =
    streamingMediaType === 'tv' && Number.isInteger(Number(_cidParts[2]?.replace(/^s/, '')))
      ? Number(_cidParts[2].replace(/^s/, ''))
      : undefined;
  const streamingEpisode: number | undefined =
    streamingMediaType === 'tv' && Number.isInteger(Number(_cidParts[3]?.replace(/^e/, '')))
      ? Number(_cidParts[3].replace(/^e/, ''))
      : undefined;

  const normalizeSwitchQuality = (q: string): '720p' | '1080p' | '2160p' =>
    q === '720p' || q === '1080p' || q === '2160p' ? q : '1080p';

  // Switch the active source from the in-player switcher (W6 renders the UI; the
  // page owns the swap). A season-pack alternative on the SAME torrent is handled
  // as a file_index swap via router.replace(?file=N); any other candidate starts a
  // NEW download (magnet/source_id) and navigates to it. No silent auto-switch —
  // this only runs on an explicit user pick.
  const handleSelectSource = async (c: TorrentCandidate) => {
    // Same-torrent season pack → file_index swap (no new download).
    if (c.is_season_pack && torrentStatus && c.quality === torrentStatus.quality) {
      const target = videoFiles.find((f) => f.name === c.release_title);
      if (target) {
        router.replace(`/streaming/${torrentId}?file=${target.index}`);
        return;
      }
    }
    // Different torrent → start a new download and navigate to it.
    try {
      toast.loading('Switching source…', { id: 'switch-source' });
      const status = await torrentsService.downloadCatalogMovie({
        tmdb_id: streamingTmdbId ?? 0,
        quality: normalizeSwitchQuality(c.quality),
        media_type: streamingMediaType,
        season: streamingSeason,
        episode: streamingEpisode,
        magnet: c.magnet,
        source_id: c.source_id,
      });
      toast.success('Source switched', { id: 'switch-source' });
      if (status?.id && status.id !== torrentId) {
        router.replace(`/streaming/${status.id}`);
      }
    } catch {
      toast.error('Could not switch source. Please try again.', { id: 'switch-source' });
    }
  };

  // Called by the player (W6) when in-player recovery (backoff re-seek) is
  // exhausted: reveal the source-switch affordance so the user can pick another
  // release instead of staring at a stalled stream.
  const handleRecoveryExhausted = () => {
    setShowSources(true);
    if (sources.length > 0) {
      toast('Playback is struggling — try another source.', { id: 'recovery-exhausted' });
    }
  };
```

- [ ] **Step 6: Replace the inline warm-up panel with `StreamPhasePanel`.** The current fallback panel (the `: (` branch, lines 462-485) is:
```tsx
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-5 bg-ink px-6 text-center">
            <div
              className="w-12 h-12 rounded-full border-2 border-hairline border-t-gold animate-spin"
              aria-label="Buffering"
            />
            <div>
              <p className="font-display text-xl text-text tracking-tight">Buffering your stream…</p>
              <p className="mt-1.5 text-sm text-muted">
                {Math.round(torrentStatus.progress)}% downloaded
                {torrentStatus.num_peers > 0 &&
                  ` · ${torrentStatus.num_peers} peer${torrentStatus.num_peers === 1 ? '' : 's'}`}
              </p>
            </div>
            {!forceStreaming && (
              <button
                onClick={handleForceStreaming}
                className="text-xs text-muted underline-offset-4 transition-colors hover:text-gold hover:underline"
              >
                Start anyway
              </button>
            )}
          </div>
        )}
```
Replace it with:
```tsx
        ) : (
          streamHealth && (
            <StreamPhasePanel
              health={streamHealth}
              progress={torrentStatus.progress}
              onForceStart={handleForceStreaming}
              showForceStart={!forceStreaming}
            />
          )
        )}
```

- [ ] **Step 7: Typecheck — expect PASS.**
```bash
(cd frontend && npx tsc --noEmit)
```
Expected: no errors. (`streamHealth` is `StreamHealthState | null`, narrowed by `streamHealth &&`; `handleSelectSource`, `handleRecoveryExhausted`, `sources`, and `showSources` are defined and will be passed to the player in W2.6 — an unused local is not yet flagged because W2.6 follows immediately, but if you run tsc between W2.5 and W2.6, an unused local function/variable is NOT a tsc error under this project's config. `showSources` is referenced by `setShowSources`; `sources` is read in `handleSelectSource`/`handleRecoveryExhausted`.)

- [ ] **Step 8: Manual verification.** Start the stack: `make up d=1`, wait for `http://localhost:3001` to respond.
  - Navigate to any movie detail page, click **Play** to reach `/streaming/{id}` while the torrent is still warming up.
  - EXPECT: the warm-up panel headline cycles through staged labels matching reality — "Finding sources…" (0 peers), then "Connecting to peers…" / "Fetching metadata…", then "Buffering N%…" with the live percentage. The sub-line reads "Waiting for peers — no seeders connected yet" when peers is 0, else "{n}% downloaded · {m} peers".
  - Open browser devtools Network tab: EXPECT the `/torrents/status/{id}` poll fires roughly every **1.5 s** while the panel is up, and slows to roughly every **5 s** after the player mounts (stream ready).
  - EXPECT a single `/torrents/sources?...` request fires once `content_id` is known (not on every poll).
  - Click **Start anyway**: EXPECT the player mounts immediately.

- [ ] **Step 9: Commit.**
```bash
git add frontend/src/app/streaming/[id]/page.tsx
git commit -m "feat(streaming): single-poll-owner adaptive cadence, StreamPhasePanel, source fetch + switch/recovery handlers"
```

---

### Task W2.6: Declare the player prop seam + pass all five props unconditionally

> **Seam ownership (authoritative contract):** W2 owns the optional-prop DECLARATION on both `VideoPlayerProps` and `PatchedVideoPlayerProps` and threads them straight through `PatchedVideoPlayer → <VideoPlayer/>` as **pass-through, declaration only** — NO behavior, NO rendering, NO consumption. An unused optional prop is not a tsc error, so `VideoPlayer` leaves them unconsumed until W6. W6 owns the *behavior* behind these props and must NOT redeclare them. There is **NO** `void x;` placeholder and **NO** "if props already declared" conditional anywhere — the page passes all five props unconditionally because Step 1/Step 2 guarantee the declaration.

**Files:**
- Modify: `frontend/src/components/player/VideoPlayer.tsx` — add five optional props to `VideoPlayerProps` (declaration only; left unconsumed until W6).
- Modify: `frontend/src/components/player/PatchedVideoPlayer.tsx` — add the same five optional props to `PatchedVideoPlayerProps`, destructure them, and pass them straight through to `<VideoPlayer/>`.
- Modify: `frontend/src/app/streaming/[id]/page.tsx` — pass all five props unconditionally to `<PatchedVideoPlayer/>`.

**Interfaces (the canonical seam — snake_case `StreamHealthState`, do NOT change to camelCase):**
```ts
streamHealth?: StreamHealthState
sources?: TorrentCandidate[]
currentSourceId?: string
onSelectSource?: (candidate: TorrentCandidate) => void
onRecoveryExhausted?: () => void
```

Steps:

- [ ] **Step 1: Declare the seam on `VideoPlayer` (declaration only — unconsumed until W6).** In `frontend/src/components/player/VideoPlayer.tsx`, the current props imports + interface are:
```ts
import { formatTime } from '@/utils/format';
import { PlayerState } from '@/types';
```
Replace that pair with:
```ts
import { formatTime } from '@/utils/format';
import { PlayerState, StreamHealthState, TorrentCandidate } from '@/types';
```
Then the current `VideoPlayerProps` (lines 19-31) is:
```ts
interface VideoPlayerProps {
  src: string;
  poster?: string;
  movieTitle?: string;
  subtitle?: string;
  autoPlay?: boolean;
  debug?: boolean;
  onEnded?: () => void;
  onError?: (error: string) => void;
  onProgress?: (state: PlayerState) => void;
  registerMethods?: (methods: { seekTo: (time: number) => void }) => void;
  downloadProgress?: number; // Optional prop to indicate download progress
}
```
Replace it with (append the five seam props; W6 implements the behavior — these stay unconsumed here for now and that is intentional, an unused optional prop is not a tsc error):
```ts
interface VideoPlayerProps {
  src: string;
  poster?: string;
  movieTitle?: string;
  subtitle?: string;
  autoPlay?: boolean;
  debug?: boolean;
  onEnded?: () => void;
  onError?: (error: string) => void;
  onProgress?: (state: PlayerState) => void;
  registerMethods?: (methods: { seekTo: (time: number) => void }) => void;
  downloadProgress?: number; // Optional prop to indicate download progress
  // --- W2-declared stream-health / source-switch seam (W6 implements behavior) ---
  // Canonical contract; snake_case StreamHealthState. Declared here so the page
  // can pass them through; left UNCONSUMED until W6 (unused optional = not an error).
  streamHealth?: StreamHealthState;
  sources?: TorrentCandidate[];
  currentSourceId?: string;
  onSelectSource?: (candidate: TorrentCandidate) => void;
  onRecoveryExhausted?: () => void;
}
```
Do NOT destructure or read these in `VideoPlayer`'s body — W6 owns that. The interface declaration alone is what the page's pass-through needs.

- [ ] **Step 2: Declare the seam on `PatchedVideoPlayer`, destructure, and thread straight through.** In `frontend/src/components/player/PatchedVideoPlayer.tsx`, the current types import (line 7) is:
```ts
import { StreamingProgress, StreamingInfo, TorrentStatus } from '@/types';
```
Replace it with:
```ts
import { StreamingProgress, StreamingInfo, TorrentStatus, StreamHealthState, TorrentCandidate } from '@/types';
```
Then the current `PatchedVideoPlayerProps` (lines 11-27) is:
```ts
interface PatchedVideoPlayerProps {
  src: string;
  torrentId: string;
  torrentInfo?: TorrentStatus;
  movieId: string;
  contentId?: string;
  fileIndex?: number;
  title?: string;
  movieTitle?: string;
  subtitle?: string;
  poster?: string;
  onError?: (error: string) => void;
  /** Optional external progress callback — fired alongside internal progress tracking */
  onProgress?: (state: { currentTime: number; duration: number }) => void;
  downloadProgress?: number;
  streamingInfo?: StreamingInfo;
}
```
Replace it with:
```ts
interface PatchedVideoPlayerProps {
  src: string;
  torrentId: string;
  torrentInfo?: TorrentStatus;
  movieId: string;
  contentId?: string;
  fileIndex?: number;
  title?: string;
  movieTitle?: string;
  subtitle?: string;
  poster?: string;
  onError?: (error: string) => void;
  /** Optional external progress callback — fired alongside internal progress tracking */
  onProgress?: (state: { currentTime: number; duration: number }) => void;
  downloadProgress?: number;
  streamingInfo?: StreamingInfo;
  // --- W2-declared stream-health / source-switch seam (W6 implements behavior) ---
  // Pure pass-through to <VideoPlayer/>; PatchedVideoPlayer does NOT act on them here.
  streamHealth?: StreamHealthState;
  sources?: TorrentCandidate[];
  currentSourceId?: string;
  onSelectSource?: (candidate: TorrentCandidate) => void;
  onRecoveryExhausted?: () => void;
}
```
Then the current destructure (lines 29-44) is:
```ts
const PatchedVideoPlayer: React.FC<PatchedVideoPlayerProps> = ({
  src,
  torrentId,
  torrentInfo,
  movieId,
  contentId,
  fileIndex,
  title,
  movieTitle,
  subtitle,
  poster,
  onError,
  onProgress: externalOnProgress,
  downloadProgress = 0,
  streamingInfo
}) => {
```
Replace it with (destructure the five new props so they can be threaded through):
```ts
const PatchedVideoPlayer: React.FC<PatchedVideoPlayerProps> = ({
  src,
  torrentId,
  torrentInfo,
  movieId,
  contentId,
  fileIndex,
  title,
  movieTitle,
  subtitle,
  poster,
  onError,
  onProgress: externalOnProgress,
  downloadProgress = 0,
  streamingInfo,
  streamHealth,
  sources,
  currentSourceId,
  onSelectSource,
  onRecoveryExhausted
}) => {
```
Then the current `<VideoPlayer .../>` render (lines 363-375) is:
```tsx
          <VideoPlayer 
            src={streamingUrl}
            poster={poster}
            movieTitle={movieTitle}
            subtitle={subtitle}
            autoPlay={!showResumePrompt}
            debug
            onProgress={handleProgress}
            onEnded={handleEnded}
            onError={handleVideoError}
            registerMethods={registerPlayerMethods}
            downloadProgress={currentDownloadProgress}
          />
```
Replace it with (thread the five props straight through — pass-through only, no behavior here):
```tsx
          <VideoPlayer 
            src={streamingUrl}
            poster={poster}
            movieTitle={movieTitle}
            subtitle={subtitle}
            autoPlay={!showResumePrompt}
            debug
            onProgress={handleProgress}
            onEnded={handleEnded}
            onError={handleVideoError}
            registerMethods={registerPlayerMethods}
            downloadProgress={currentDownloadProgress}
            streamHealth={streamHealth}
            sources={sources}
            currentSourceId={currentSourceId}
            onSelectSource={onSelectSource}
            onRecoveryExhausted={onRecoveryExhausted}
          />
```

- [ ] **Step 3: Pass all five props UNCONDITIONALLY from the page.** In `frontend/src/app/streaming/[id]/page.tsx`, the current `<PatchedVideoPlayer .../>` render (lines 431-445) is:
```tsx
            <PatchedVideoPlayer
              src={streamingUrl}
              torrentId={torrentId}
              torrentInfo={torrentStatus}
              movieId={torrentStatus.movie_title}
              contentId={streamingInfo.content_id ?? undefined}
              fileIndex={effectiveFileIndex}
              title={torrentStatus.movie_title ?? streamingInfo.video_file.name}
              movieTitle={torrentStatus.movie_title}
              subtitle={`${torrentStatus.quality} • ${streamingInfo.video_file.name}`}
              onError={handleVideoError}
              onProgress={handleVideoProgress}
              downloadProgress={videoFileProgress} // Pass the video-specific progress
              streamingInfo={streamingInfo} // Pass the full streaming info
            />
```
Replace it with (all five seam props passed unconditionally — `streamHealth` is `StreamHealthState | null` on the page, coerced to `undefined` to match the optional prop; `currentSourceId` is unknown on the page so it is left `undefined` and W6 treats undefined as "current unknown, all alternatives selectable"):
```tsx
            <PatchedVideoPlayer
              src={streamingUrl}
              torrentId={torrentId}
              torrentInfo={torrentStatus}
              movieId={torrentStatus.movie_title}
              contentId={streamingInfo.content_id ?? undefined}
              fileIndex={effectiveFileIndex}
              title={torrentStatus.movie_title ?? streamingInfo.video_file.name}
              movieTitle={torrentStatus.movie_title}
              subtitle={`${torrentStatus.quality} • ${streamingInfo.video_file.name}`}
              onError={handleVideoError}
              onProgress={handleVideoProgress}
              downloadProgress={videoFileProgress} // Pass the video-specific progress
              streamingInfo={streamingInfo} // Pass the full streaming info
              sources={sources}
              currentSourceId={undefined}
              onSelectSource={handleSelectSource}
              streamHealth={streamHealth ?? undefined}
              onRecoveryExhausted={handleRecoveryExhausted}
            />
```
Note: `currentSourceId` is not tracked on the page (the active torrent's `source_id` is not known here), so it is passed as a literal `undefined`; W6 treats `undefined` as "current unknown, all alternatives selectable". There is NO conditional branch and NO `void` block: the props are declared by Steps 1–2, so this pass is unconditional.

- [ ] **Step 4: Confirm there is NO leftover placeholder.** Verify no `void sources` / `void handleSelectSource` / `void streamHealth` / `void handleRecoveryExhausted` block and no "if props already declared" conditional remain anywhere:
```bash
grep -rn "void sources\|void handleSelectSource\|void streamHealth\|void handleRecoveryExhausted\|props already declared" /Users/benjaminherro/github/freeflix/frontend/src/app/streaming/[id]/page.tsx
```
Expected: no output. If any line is found, delete that block — the seam declaration makes it unnecessary.

- [ ] **Step 5: Typecheck — expect PASS (green at the END of W2).**
```bash
(cd frontend && npx tsc --noEmit)
```
Expected: no errors. The page passes all five props; both player components declare them as optional; `VideoPlayer` leaves them unconsumed (unused optional prop ≠ error). `streamHealth ?? undefined` collapses `StreamHealthState | null` to `StreamHealthState | undefined`, matching `streamHealth?: StreamHealthState`. `handleSelectSource` matches `(candidate: TorrentCandidate) => void`; `handleRecoveryExhausted` matches `() => void`.

- [ ] **Step 6: Manual verification.** `make up d=1`; open `/streaming/{id}` for any title.
  - EXPECT: the player mounts and plays exactly as before this task — the seam is declaration + pass-through only, so there is NO visible behavior change yet (the source switcher, swarm chip, and recovery UI are W6).
  - Confirm no console errors about unknown props.
  - (Full source-switch / recovery behavior is verified in W6 once it consumes these props.)

- [ ] **Step 7: Commit.**
```bash
git add frontend/src/components/player/VideoPlayer.tsx frontend/src/components/player/PatchedVideoPlayer.tsx frontend/src/app/streaming/[id]/page.tsx
git commit -m "feat(player): declare streamHealth/sources/onSelectSource/onRecoveryExhausted seam and pass through from page"
```

---

### Task W2.7: Health badges in `SourcePicker` (per-candidate swarm health)

**Files:**
- Modify: `frontend/src/components/detail/SourcePicker.tsx` — add an optional `candidates` prop and render per-quality health badges (current file lines 1-200).

**Interfaces:**
- Consumes: `TorrentCandidate`, `SwarmHealth` (from `@/types`); `Badge` (`@/components/ui/fre`).
- Produces: an extended `SourcePickerProps` with optional `candidates?: TorrentCandidate[]`. When `candidates` is supplied, each quality pill shows a small health badge (healthy/low/dead) derived from the best candidate in that quality bucket. Backward compatible: existing `hits`-only callers are unchanged (no badge).

Steps:

- [ ] **Step 1: Confirm `Badge` props.** Read its tone/variant surface:
```bash
sed -n '1,60p' /Users/benjaminherro/github/freeflix/frontend/src/components/ui/fre/Badge.tsx
```
Note the actual `BadgeTone` union values; the implementation below maps `healthy → 'positive'`-style tone. In Step 3, use the ACTUAL tone names from this file (do not assume). If `Badge` has no semantic tones, fall back to a plain `<span>` dot+label using existing color tokens (`#4caf6a` for healthy as already used by `SeedDot`).

- [ ] **Step 2: Extend the props + add a health helper.** In `frontend/src/components/detail/SourcePicker.tsx`, the current import block is:
```ts
import React from 'react';
import Pill from '@/components/ui/fre/Pill';
import { cn } from '@/lib/cn';
import type { TorrentHit } from '@/types';
```
Replace it with:
```ts
import React from 'react';
import Pill from '@/components/ui/fre/Pill';
import { cn } from '@/lib/cn';
import type { TorrentHit, TorrentCandidate, SwarmHealth } from '@/types';
```
Then the current `SourcePickerProps`:
```ts
export interface SourcePickerProps {
  hits: TorrentHit[];
  value: string;
  onChange: (quality: string) => void;
  /** Used when hits is empty — render plain pills with no seed/size info. */
  fallbackQualities?: string[];
}
```
Replace it with:
```ts
export interface SourcePickerProps {
  hits: TorrentHit[];
  value: string;
  onChange: (quality: string) => void;
  /** Used when hits is empty — render plain pills with no seed/size info. */
  fallbackQualities?: string[];
  /** Ranked, health-classified candidates (W1). When present, drives health badges. */
  candidates?: TorrentCandidate[];
}
```

- [ ] **Step 3: Add a `HealthBadge` component + best-per-quality lookup.** Immediately after the `SeedDot` component (after line 96, its closing `}`), insert:
```tsx
/** Best (most-seeded) candidate health per quality bucket. */
function bestHealthByQuality(candidates: TorrentCandidate[]): Map<string, SwarmHealth> {
  const map = new Map<string, { seeds: number; health: SwarmHealth }>();
  for (const c of candidates) {
    const existing = map.get(c.quality);
    if (!existing || c.seeds > existing.seeds) {
      map.set(c.quality, { seeds: c.seeds, health: c.health });
    }
  }
  const out = new Map<string, SwarmHealth>();
  map.forEach((v, k) => out.set(k, v.health));
  return out;
}

const HEALTH_STYLE: Record<SwarmHealth, { dot: string; label: string }> = {
  healthy: { dot: 'bg-[#4caf6a] shadow-[0_0_6px_rgba(76,175,106,.7)]', label: 'Healthy' },
  low: { dot: 'bg-gold shadow-[0_0_6px_rgba(201,168,106,.6)]', label: 'Low' },
  dead: { dot: 'bg-muted', label: 'No seeders' },
};

/** Small swarm-health badge for a quality pill. */
function HealthBadge({ health }: { health: SwarmHealth }) {
  const s = HEALTH_STYLE[health];
  return (
    <span
      className="inline-flex items-center gap-[5px] text-[11px] text-muted"
      data-testid={`source-health-${health}`}
      title={`Swarm health: ${s.label}`}
    >
      <span aria-hidden="true" className={cn('inline-block w-[6px] h-[6px] rounded-full shrink-0', s.dot)} />
      <span>{s.label}</span>
    </span>
  );
}
```
(This uses only existing color tokens — `#4caf6a`, `gold`, `muted` — so it is safe regardless of `Badge`'s tone surface; if you confirmed semantic `Badge` tones in Step 1 and prefer them, swap the `<span>` dot for `<Badge tone={...}>` using the ACTUAL tone names.)

- [ ] **Step 4: Render the badge inside each per-quality pill.** In the component body, just after `const groups = groupByQuality(hits);` (line 104), add:
```ts
  const healthByQuality = candidates && candidates.length > 0
    ? bestHealthByQuality(candidates)
    : null;
```
Then in the per-quality pill map, the current meta `<span>` block is:
```tsx
            <span
              className="text-[12px] text-muted flex items-center gap-[5px]"
              data-testid={`source-pill-${quality}-meta`}
            >
              {best.bytes > 0 && <>{humanizeBytes(best.bytes)} · </>}
              {best.seeds > 0 && (
                <>
                  <SeedDot seeds={best.seeds} />
                  <span>{formatSeeds(best.seeds)} seeds</span>
                </>
              )}
            </span>
```
Replace it with:
```tsx
            <span
              className="text-[12px] text-muted flex items-center gap-[5px]"
              data-testid={`source-pill-${quality}-meta`}
            >
              {best.bytes > 0 && <>{humanizeBytes(best.bytes)} · </>}
              {best.seeds > 0 && (
                <>
                  <SeedDot seeds={best.seeds} />
                  <span>{formatSeeds(best.seeds)} seeds</span>
                </>
              )}
              {healthByQuality?.get(quality) && (
                <>
                  {' · '}
                  <HealthBadge health={healthByQuality.get(quality)!} />
                </>
              )}
            </span>
```

- [ ] **Step 5: Typecheck — expect PASS.**
```bash
(cd frontend && npx tsc --noEmit)
```

- [ ] **Step 6: Manual verification.** `make up d=1`; open a movie detail page at `http://localhost:3001/movies/{id}`.
  - Before W2.8 wires `candidates` into `MovieDetailView`, the picker renders exactly as today (no health badge) because `candidates` is undefined — EXPECT NO visual regression.
  - (Badge rendering is verified end-to-end in W2.8 once `candidates` is supplied.)

- [ ] **Step 7: Commit.**
```bash
git add frontend/src/components/detail/SourcePicker.tsx
git commit -m "feat(detail): SourcePicker health badges from ranked candidates"
```

---

### Task W2.8: Pre-stream seeder validation in `MovieDetailView` (surface ranked alternatives)

**Files:**
- Modify: `frontend/src/components/movies/MovieDetailView.tsx` — imports (lines 20-38), state (lines 170-175), the torrents-load effect (lines 187-221), `handlePlay` (lines 225-245), the `SourcePicker` render (lines 291-296), and add an alternatives Modal.

**Interfaces:**
- Consumes: `torrentsService.getSources` (W2.3), `TorrentCandidate` / `SwarmHealth` (`@/types`), `handleCatalogStreamingStart` (existing), `Modal` + `Button` (`@/components/ui/fre`), `SourcePicker` (now accepts `candidates`).
- Produces: pre-stream validation in `handlePlay` — when the resolved pick's best candidate health is `dead` or `low`, open an **alternatives Modal** listing ranked candidates (the user picks; **no silent auto-switch**). Selecting an alternative starts the stream with that candidate's `magnet`/`source_id`. A healthy pick streams immediately as today.

Steps:

- [ ] **Step 1: Extend imports.** The current import block includes (lines 24-35):
```ts
import { MovieDetail, TorrentHit, CatalogItem } from '@/types';
import { moviesService } from '@/services/movies';
import { torrentsService } from '@/services/torrents';
import { handleCatalogStreamingStart } from '@/utils/streaming';
import { useWatchlist } from '@/context/WatchlistContext';
import { buildContentId } from '@/lib/contentId';
import { toWatchlistCreate } from '@/lib/watchlist/toWatchlistCreate';

import DetailHero from '@/components/detail/DetailHero';
import SourcePicker from '@/components/detail/SourcePicker';
import CastRow from '@/components/detail/CastRow';
import { Button } from '@/components/ui/fre';
```
Replace the `import { MovieDetail, ... } from '@/types';` line with:
```ts
import { MovieDetail, TorrentHit, CatalogItem, TorrentCandidate, SwarmHealth } from '@/types';
```
And replace the `import { Button } from '@/components/ui/fre';` line with:
```ts
import { Button, Modal } from '@/components/ui/fre';
```

- [ ] **Step 2: Add candidate + modal state.** The current state block (lines 171-175) is:
```ts
  const [hits, setHits] = useState<TorrentHit[]>([]);
  const [quality, setQuality] = useState<string>('auto');
  const [isPlaying, setIsPlaying] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [moreLikeThis, setMoreLikeThis] = useState<CatalogItem[]>([]);
```
Replace it with:
```ts
  const [hits, setHits] = useState<TorrentHit[]>([]);
  const [candidates, setCandidates] = useState<TorrentCandidate[]>([]);
  const [quality, setQuality] = useState<string>('auto');
  const [isPlaying, setIsPlaying] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [moreLikeThis, setMoreLikeThis] = useState<CatalogItem[]>([]);
  // Pre-stream validation: when the resolved pick is weak we surface ranked
  // alternatives in a modal instead of silently auto-switching.
  const [altModalOpen, setAltModalOpen] = useState(false);
```

- [ ] **Step 3: Fetch ranked candidates alongside hits.** The current `loadTorrents` (lines 190-197) is:
```ts
    async function loadTorrents() {
      try {
        const data = await moviesService.getTorrents(movie.tmdb_id);
        if (!cancelled) setHits(data ?? []);
      } catch {
        if (!cancelled) setHits([]);
      }
    }
```
Replace it with:
```ts
    async function loadTorrents() {
      try {
        const data = await moviesService.getTorrents(movie.tmdb_id);
        if (!cancelled) setHits(data ?? []);
      } catch {
        if (!cancelled) setHits([]);
      }
    }

    async function loadCandidates() {
      try {
        const list = await torrentsService.getSources({
          tmdb_id: movie.tmdb_id,
          quality: '1080p',
          media_type: 'movie',
        });
        if (!cancelled) setCandidates(list ?? []);
      } catch {
        if (!cancelled) setCandidates([]);
      }
    }
```
Then the current effect body calls (lines 215-216):
```ts
    loadTorrents();
    loadMoreLikeThis();
```
Replace with:
```ts
    loadTorrents();
    loadCandidates();
    loadMoreLikeThis();
```

- [ ] **Step 4: Add a health-for-resolved-quality helper + gate `handlePlay`.** The current `handlePlay` (lines 225-245) is:
```ts
  async function handlePlay() {
    setIsPlaying(true);
    try {
      const resolved = resolveQuality(
        quality,
        hits,
        movie.available_qualities,
      );
      const status = await handleCatalogStreamingStart({
        tmdb_id: movie.tmdb_id,
        quality: resolved,
      });
      if (status?.id) {
        router.push(`/streaming/${status.id}`);
      }
    } catch {
      toast.error('Failed to start streaming. Please try again.');
    } finally {
      setIsPlaying(false);
    }
  }
```
Replace it with:
```ts
  // Best candidate health for a given quality bucket (most-seeded wins).
  function healthForQuality(q: string): SwarmHealth | null {
    const inBucket = candidates.filter((c) => c.quality === q);
    if (inBucket.length === 0) return null;
    const best = inBucket.reduce((a, b) => (a.seeds >= b.seeds ? a : b));
    return best.health;
  }

  // Start streaming a specific candidate (explicit user pick from the modal).
  async function streamCandidate(c: TorrentCandidate) {
    setAltModalOpen(false);
    setIsPlaying(true);
    try {
      const status = await handleCatalogStreamingStart({
        tmdb_id: movie.tmdb_id,
        quality:
          c.quality === '720p' || c.quality === '1080p' || c.quality === '2160p'
            ? c.quality
            : '1080p',
        magnet: c.magnet,
        source_id: c.source_id,
      });
      if (status?.id) router.push(`/streaming/${status.id}`);
    } catch {
      toast.error('Failed to start streaming. Please try again.');
    } finally {
      setIsPlaying(false);
    }
  }

  async function handlePlay() {
    const resolved = resolveQuality(quality, hits, movie.available_qualities);
    // Pre-stream seeder validation: if the resolved pick is dead/low AND a
    // healthier alternative exists, let the user choose (no silent auto-switch).
    const pickHealth = healthForQuality(resolved);
    const hasHealthierAlt = candidates.some(
      (c) => c.health === 'healthy' && c.quality !== resolved,
    );
    if ((pickHealth === 'dead' || pickHealth === 'low') && candidates.length > 0 && hasHealthierAlt) {
      setAltModalOpen(true);
      return;
    }

    setIsPlaying(true);
    try {
      const status = await handleCatalogStreamingStart({
        tmdb_id: movie.tmdb_id,
        quality: resolved,
      });
      if (status?.id) {
        router.push(`/streaming/${status.id}`);
      }
    } catch {
      toast.error('Failed to start streaming. Please try again.');
    } finally {
      setIsPlaying(false);
    }
  }
```

- [ ] **Step 5: Pass `candidates` to `SourcePicker`.** The current render (lines 291-296) is:
```tsx
        <SourcePicker
          hits={hits}
          value={quality}
          onChange={setQuality}
          fallbackQualities={movie.available_qualities}
        />
```
Replace it with:
```tsx
        <SourcePicker
          hits={hits}
          value={quality}
          onChange={setQuality}
          fallbackQualities={movie.available_qualities}
          candidates={candidates}
        />
```

- [ ] **Step 6: Render the alternatives Modal.** Immediately before the final closing `</div>` of the component's returned tree (just before the line `    </div>\n  );\n};` — i.e. after the `More Like This` row block ending at line 426 `)}`), insert:
```tsx

      {/* Pre-stream alternatives — shown when the resolved pick is dead/low. */}
      <Modal
        open={altModalOpen}
        onClose={() => setAltModalOpen(false)}
        label="Choose a healthier source"
        className="max-w-lg"
      >
        <h2 className="font-display text-xl text-text tracking-tight mb-1">
          Low seeders on your pick
        </h2>
        <p className="text-sm text-muted mb-5">
          The selected quality has few or no seeders. Pick a healthier source to start streaming.
        </p>
        <div className="flex flex-col gap-2 max-h-[50vh] overflow-y-auto" data-testid="alt-source-list">
          {candidates.slice(0, 8).map((c) => (
            <button
              key={c.source_id}
              onClick={() => streamCandidate(c)}
              data-testid={`alt-source-${c.source_id}`}
              className={cn(
                'flex items-center justify-between gap-3 rounded-xl border border-hairline',
                'bg-surface-2/50 px-4 py-3 text-left transition-colors',
                'hover:border-gold/50 hover:bg-surface-2',
              )}
            >
              <span className="min-w-0">
                <span className="block text-sm text-text font-medium truncate" title={c.release_title}>
                  {c.quality || 'Unknown'} · {c.release_title}
                </span>
                <span className="block text-xs text-muted">
                  {c.seeds} seeds · {c.peers} peers
                </span>
              </span>
              <span
                className={cn(
                  'inline-block w-[8px] h-[8px] rounded-full shrink-0',
                  c.health === 'healthy'
                    ? 'bg-[#4caf6a] shadow-[0_0_6px_rgba(76,175,106,.7)]'
                    : c.health === 'low'
                    ? 'bg-gold shadow-[0_0_6px_rgba(201,168,106,.6)]'
                    : 'bg-muted',
                )}
                aria-hidden="true"
                title={`Swarm health: ${c.health}`}
              />
            </button>
          ))}
        </div>
        <div className="mt-5 flex justify-end">
          <Button variant="glass" size="sm" onClick={() => setAltModalOpen(false)}>
            Cancel
          </Button>
        </div>
      </Modal>
```

- [ ] **Step 7: Typecheck — expect PASS.**
```bash
(cd frontend && npx tsc --noEmit)
```
Expected: no errors. `Modal` is exported from `@/components/ui/fre` (confirmed in the barrel); its props are `open`, `onClose`, `label`, `children`, `className`. When `altModalOpen` is `false`, `Modal` returns `null` (Modal.tsx line 76: `if (!open) return null;`) so nothing renders — the closed-state contract is a hard `null`, not a hidden node.

- [ ] **Step 8: Manual verification.** `make up d=1`; open `http://localhost:3001/movies/{id}`.
  - **Healthy pick:** choose a quality whose best candidate is healthy (green dot in the picker), click **Play**. EXPECT: NO modal — it streams immediately and navigates to `/streaming/{id}` (unchanged behavior).
  - **Dead/low pick with a healthier alternative:** for a title where the resolved quality is dead/low but another quality is healthy, click **Play**. EXPECT: the "Low seeders on your pick" modal opens listing ranked candidates with seeds/peers + a health dot. NO navigation happened yet (no silent auto-switch).
  - Click a healthy alternative in the modal. EXPECT: modal closes, "Preparing your stream…" toast, navigation to `/streaming/{newId}` with that source.
  - Press **Escape** or click the backdrop. EXPECT: modal closes (Modal's Escape + backdrop handlers), Play not triggered, you stay on the detail page.
  - In the picker, EXPECT each per-quality pill now shows a health badge (e.g. "Healthy" / "Low" / "No seeders") next to the seeds count.

- [ ] **Step 9: Commit.**
```bash
git add frontend/src/components/movies/MovieDetailView.tsx
git commit -m "feat(detail): pre-stream seeder validation surfaces ranked alternatives (no auto-switch)"
```

---

### Task W2.9: Full W2 typecheck sweep + manual flow walkthrough

**Files:** none (verification only).

Steps:

- [ ] **Step 1: Whole-frontend typecheck — expect PASS (green at the END of W2).**
```bash
(cd frontend && npx tsc --noEmit)
```
Expected: zero errors across all W2-touched modules (`types/index.ts`, `utils/streamHealth.ts`, `services/torrents.ts`, `app/streaming/[id]/page.tsx`, `components/streaming/StreamPhasePanel.tsx`, `components/player/VideoPlayer.tsx`, `components/player/PatchedVideoPlayer.tsx`, `components/detail/SourcePicker.tsx`, `components/movies/MovieDetailView.tsx`).

- [ ] **Step 2: Confirm the seam is declared and there is NO placeholder.** Verify the five props exist on both player interfaces and that no `void`/conditional placeholder survived:
```bash
grep -n "streamHealth\|onSelectSource\|onRecoveryExhausted\|sources\|currentSourceId" /Users/benjaminherro/github/freeflix/frontend/src/components/player/VideoPlayer.tsx /Users/benjaminherro/github/freeflix/frontend/src/components/player/PatchedVideoPlayer.tsx
grep -rn "void sources\|void handleSelectSource\|void streamHealth\|void handleRecoveryExhausted\|props already declared" /Users/benjaminherro/github/freeflix/frontend/src/app/streaming/[id]/page.tsx
```
Expected: the first grep shows the props in both interfaces (and threaded through `<VideoPlayer/>`); the second grep prints NOTHING.

- [ ] **Step 3: Production build smoke — expect PASS** (catches Next.js RSC/client boundary issues `tsc` misses).
```bash
(cd frontend && npm run build)
```
Expected: build completes; `/streaming/[id]` and `/movies/[id]` routes compile.

- [ ] **Step 4: End-to-end manual walkthrough.** `make up d=1`; at `http://localhost:3001`:
  - Movie detail → picker shows health badges → Play on a healthy pick streams straight through.
  - Play on a dead/low pick opens the alternatives modal; choosing a healthy one streams it.
  - On `/streaming/{id}`, the warm-up `StreamPhasePanel` shows staged labels tracking real torrent state; the status poll runs ~1.5 s warming up, ~5 s once playing (verify in devtools Network).
  - A single `/torrents/sources` request fires once `content_id` is known.
  - The player mounts and plays unchanged (the seam props are passed but their behavior lands in W6).

- [ ] **Step 5: Commit the green milestone.**
```bash
git commit --allow-empty -m "test(streaming): WS2 typecheck + build green (staged flow, pre-stream validation, player seam)"
```

---

**WS2 deliverables for downstream workstreams (W6 imports — never redefines):**
- `frontend/src/types/index.ts`: `StreamPhase`, `SwarmHealth`, `TorrentCandidate`, `StreamHealthState`, and the optional `TorrentStatus` health fields.
- `frontend/src/utils/streamHealth.ts`: `deriveStreamHealth(status) -> StreamHealthState` (single source of truth; no separate `deriveStreamPhase`).
- `frontend/src/services/torrents.ts`: `getSources(params)` + widened `CatalogTorrentRequest` (`magnet?`, `source_id?`), no `as any`.
- `frontend/src/app/streaming/[id]/page.tsx`: the single poll owner (~1.5 s warming / ~5 s playing), `StreamPhasePanel` render, source fetch, `handleSelectSource` (same-torrent `file_index` swap vs different-torrent new-download + `router.replace`), and `handleRecoveryExhausted` (reveals the source-switch affordance) — all five seam props passed UNCONDITIONALLY to `<PatchedVideoPlayer/>`. W6 must NOT touch the page poll or remove it; W6 owns removing `PatchedVideoPlayer`'s own 5 s `getStreamingInfo` poll.
- **The player prop SEAM (W2-owned declaration):** `VideoPlayerProps` and `PatchedVideoPlayerProps` both declare the optional `streamHealth?: StreamHealthState`, `sources?: TorrentCandidate[]`, `currentSourceId?: string`, `onSelectSource?: (candidate: TorrentCandidate) => void`, `onRecoveryExhausted?: () => void` (snake_case `StreamHealthState` — do NOT change to camelCase), threaded `PatchedVideoPlayer → <VideoPlayer/>` as pass-through. W6 reads/destructures these already-declared props and implements the behavior; it must NOT redeclare them.
- `frontend/src/components/streaming/StreamPhasePanel.tsx`: warm-up panel consuming `StreamHealthState`.
- `SourcePicker` health badges; `MovieDetailView` pre-stream validation modal.

---

## Workstream W3: Serving safety — adaptive timeout, never serve undownloaded bytes, HTTP 416, file_index validation

This workstream is the core correctness fix and depends on nothing. It keeps `stream_file_range` **synchronous** (WS4 converts it to async later, behind this safety net). Three behaviors change in `backend/app/torrent/manager.py` and `backend/app/api/streaming.py`:

1. Add `_pieces_ready(self, handle, first_piece, last_piece) -> bool` (a pure, non-blocking availability check) and make `stream_file_range` **end the generator** (RETURN) instead of yielding sparse bytes when pieces are not ready / time out. `f.read(n)` now runs only after readiness is confirmed.
2. Replace the fixed `45.0`s timeout with an **adaptive** budget derived from peer count + measured `download_rate` (short abort when `peers == 0` and stalled; extended while pieces arrive).
3. `parse_range_header` returns a **416 sentinel** for `start >= file_size` (no more silent clamping); `stream_video` returns HTTP 416 with `Content-Range: bytes */{size}`. `file_index` validation distinguishes **invalid index** (404 clear detail) from **not ready**, and never silently falls back to the largest file when an explicit index was passed.

All backend test-run steps use the mounted-tests command form (tests are baked into the image, not bind-mounted). Container workdir is `/opt/freeflix`; tests live at `/opt/freeflix/tests`. Run **from the repo root** so `$(pwd)` resolves to `/Users/benjaminherro/github/freeflix`.

---

### Task W3.1: `parse_range_header` returns a 416 sentinel for out-of-bounds ranges

**Files:**
- Modify: `backend/app/api/streaming.py` (lines 43-56 — `parse_range_header`)
- Test: `backend/tests/test_range_header.py` (create)

**Interfaces:**
- Produces: `RANGE_NOT_SATISFIABLE: tuple` — module-level sentinel `(-1, -1)` returned by `parse_range_header` when the requested `start >= file_size`.
- Produces: `def parse_range_header(range_header: Optional[str], file_size: int) -> tuple` — unchanged signature; returns `(start, end)` for satisfiable ranges, `RANGE_NOT_SATISFIABLE` when unsatisfiable. (Consumed by Task W3.4.)

Steps:

- [ ] **Step 1: Write the failing test.** Create `backend/tests/test_range_header.py`:
```python
"""parse_range_header must signal HTTP 416 (not silently clamp) when the
requested range starts at or beyond the file size."""
from app.api.streaming import parse_range_header, RANGE_NOT_SATISFIABLE


def test_no_range_header_returns_full_file():
    assert parse_range_header(None, 1000) == (0, 999)
    assert parse_range_header("", 1000) == (0, 999)


def test_normal_range_parsed():
    assert parse_range_header("bytes=100-299", 1000) == (100, 299)


def test_open_ended_range_clamped_to_eof():
    assert parse_range_header("bytes=500-", 1000) == (500, 999)


def test_end_beyond_eof_clamped():
    # end past EOF is fine to clamp; only start-out-of-bounds is unsatisfiable
    assert parse_range_header("bytes=100-99999", 1000) == (100, 999)


def test_start_equal_to_filesize_is_unsatisfiable():
    assert parse_range_header("bytes=1000-1000", 1000) is RANGE_NOT_SATISFIABLE


def test_start_beyond_filesize_is_unsatisfiable():
    assert parse_range_header("bytes=5000-", 1000) is RANGE_NOT_SATISFIABLE


def test_empty_file_any_range_unsatisfiable():
    assert parse_range_header("bytes=0-", 0) is RANGE_NOT_SATISFIABLE
```

- [ ] **Step 2: Run the test, expect FAIL.** Import error (`RANGE_NOT_SATISFIABLE` does not exist) / assertion failures.
```bash
docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest tests/test_range_header.py -v
```
Expected: FAIL — `ImportError: cannot import name 'RANGE_NOT_SATISFIABLE'`.

- [ ] **Step 3: Implement the sentinel + bounds logic.** In `backend/app/api/streaming.py`, replace the current function (lines 43-56):
```python
def parse_range_header(range_header: str, file_size: int) -> tuple:
    """Parse Range header and return start and end positions."""
    if not range_header or not range_header.startswith('bytes='):
        return 0, file_size - 1
    
    ranges = range_header.replace('bytes=', '').split('-')
    start = int(ranges[0]) if ranges[0] else 0
    end = int(ranges[1]) if len(ranges) > 1 and ranges[1] else file_size - 1
    
    # Ensure values are within bounds
    start = max(0, min(start, file_size - 1))
    end = max(start, min(end, file_size - 1))
    
    return start, end
```
with:
```python
# Sentinel returned by parse_range_header for an unsatisfiable range
# (start >= file_size). The endpoint maps this to HTTP 416.
RANGE_NOT_SATISFIABLE = (-1, -1)


def parse_range_header(range_header: Optional[str], file_size: int) -> tuple:
    """Parse a Range header into (start, end) inclusive byte positions.

    Returns RANGE_NOT_SATISFIABLE when the requested start is at or beyond
    file_size (HTTP 416). end past EOF is clamped; start is NOT clamped — an
    out-of-bounds start is a client error, not something to silently rewrite.
    """
    if not range_header or not range_header.startswith('bytes='):
        if file_size <= 0:
            return RANGE_NOT_SATISFIABLE
        return 0, file_size - 1

    ranges = range_header.replace('bytes=', '').split('-')
    start = int(ranges[0]) if ranges[0] else 0
    end = int(ranges[1]) if len(ranges) > 1 and ranges[1] else file_size - 1

    if file_size <= 0 or start >= file_size or start < 0:
        return RANGE_NOT_SATISFIABLE

    # Clamp the end to the last byte; start stays as requested (already in bounds).
    end = max(start, min(end, file_size - 1))
    return start, end
```

- [ ] **Step 4: Run the test, expect PASS.**
```bash
docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest tests/test_range_header.py -v
```
Expected: PASS — 7 passed.

- [ ] **Step 5: Commit.**
```bash
git add backend/app/api/streaming.py backend/tests/test_range_header.py
git commit -m "feat(streaming): parse_range_header returns 416 sentinel for out-of-bounds ranges"
```

---

### Task W3.2: `_pieces_ready` non-blocking readiness check + adaptive timeout helper

**Files:**
- Modify: `backend/app/torrent/manager.py` (add methods near `_await_pieces`, lines 1109-1137)
- Test: `backend/tests/test_pieces_ready.py` (create)

**Interfaces:**
- Produces: `def _pieces_ready(self, handle, first_piece: int, last_piece: int) -> bool` — returns `True` iff `handle.have_piece(p)` is True for every `p` in `[first_piece, last_piece]`; returns `False` on any exception. No sleeping, no deadlining. (Consumed by Task W3.3 / WS4.)
- Produces: `def _adaptive_piece_timeout(self, handle, *, base: float = 8.0, max_timeout: float = 60.0) -> float` — computes a per-chunk wait budget from `handle.status()`: `max(2.0, base)` when peers are connected, scaled up while `download_rate > 0`; a short `2.0`s when `num_peers == 0`. Returns a float seconds budget. (Consumed by Task W3.3.)

Steps:

- [ ] **Step 1: Write the failing test.** Create `backend/tests/test_pieces_ready.py`:
```python
"""_pieces_ready is a pure, non-blocking availability check; _adaptive_piece_timeout
derives a wait budget from live peer/throughput status."""
import types
from app.torrent.manager import torrent_manager


class _Handle:
    def __init__(self, have, status=None):
        self._have = have          # set of piece indices already downloaded
        self._status = status

    def have_piece(self, p):
        return p in self._have

    def status(self):
        return self._status


def test_pieces_ready_true_when_all_present():
    h = _Handle(have={3, 4, 5})
    assert torrent_manager._pieces_ready(h, 3, 5) is True


def test_pieces_ready_false_when_any_missing():
    h = _Handle(have={3, 5})  # 4 missing
    assert torrent_manager._pieces_ready(h, 3, 5) is False


def test_pieces_ready_false_on_exception():
    class _Boom:
        def have_piece(self, p):
            raise RuntimeError("handle invalidated")
    assert torrent_manager._pieces_ready(_Boom(), 0, 1) is False


def test_adaptive_timeout_short_when_no_peers():
    st = types.SimpleNamespace(num_peers=0, download_rate=0)
    t = torrent_manager._adaptive_piece_timeout(_Handle(have=set(), status=st))
    assert t == 2.0


def test_adaptive_timeout_base_when_peers_idle():
    st = types.SimpleNamespace(num_peers=3, download_rate=0)
    t = torrent_manager._adaptive_piece_timeout(_Handle(have=set(), status=st), base=8.0)
    assert t == 8.0


def test_adaptive_timeout_extends_while_downloading():
    st = types.SimpleNamespace(num_peers=10, download_rate=500_000)
    t = torrent_manager._adaptive_piece_timeout(
        _Handle(have=set(), status=st), base=8.0, max_timeout=60.0
    )
    assert 8.0 < t <= 60.0


def test_adaptive_timeout_capped_at_max():
    st = types.SimpleNamespace(num_peers=50, download_rate=10_000_000)
    t = torrent_manager._adaptive_piece_timeout(
        _Handle(have=set(), status=st), base=8.0, max_timeout=60.0
    )
    assert t == 60.0
```

- [ ] **Step 2: Run the test, expect FAIL.**
```bash
docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest tests/test_pieces_ready.py -v
```
Expected: FAIL — `AttributeError: 'TorrentManager' object has no attribute '_pieces_ready'`.

- [ ] **Step 3: Implement both helpers.** In `backend/app/torrent/manager.py`, immediately before the existing `def _await_pieces(` (line 1109), insert:
```python
    def _pieces_ready(self, handle, first_piece: int, last_piece: int) -> bool:
        """Non-blocking: True iff every piece in [first_piece, last_piece] is
        already downloaded. Never sleeps, never deadlines. False on any error
        (e.g. the handle was invalidated mid-stream)."""
        try:
            return all(
                handle.have_piece(p) for p in range(first_piece, last_piece + 1)
            )
        except Exception:
            return False

    def _adaptive_piece_timeout(self, handle, *, base: float = 8.0,
                                max_timeout: float = 60.0) -> float:
        """Per-chunk wait budget derived from live swarm status.

        - No peers connected  -> short 2s abort (a dead/connecting torrent should
          not block the response for 45s).
        - Peers but idle       -> `base` seconds.
        - Peers and downloading -> extend with throughput (more bandwidth => we
          can afford to wait for sequential pieces), capped at `max_timeout`.
        """
        try:
            st = handle.status()
            num_peers = int(getattr(st, "num_peers", 0) or 0)
            rate = int(getattr(st, "download_rate", 0) or 0)
        except Exception:
            return base

        if num_peers <= 0:
            return 2.0
        if rate <= 0:
            return base
        # Scale: +1s of patience per ~64 kB/s of measured throughput.
        extended = base + (rate / 65536.0)
        return min(max_timeout, extended)

```

- [ ] **Step 4: Run the test, expect PASS.**
```bash
docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest tests/test_pieces_ready.py -v
```
Expected: PASS — 7 passed.

- [ ] **Step 5: Commit.**
```bash
git add backend/app/torrent/manager.py backend/tests/test_pieces_ready.py
git commit -m "feat(streaming): add _pieces_ready check and adaptive piece-timeout helper"
```

---

### Task W3.3: `stream_file_range` never yields undownloaded bytes — ends generator on timeout

**Files:**
- Modify: `backend/app/torrent/manager.py` (`stream_file_range` lines 1051-1107; `_await_pieces` lines 1109-1137)
- Test: `backend/tests/test_stream_no_garbage.py` (create)

**Interfaces:**
- Consumes: `self._pieces_ready(handle, first_piece, last_piece) -> bool` (Task W3.2); `self._adaptive_piece_timeout(handle, *, base, max_timeout) -> float` (Task W3.2).
- Produces: `def stream_file_range(self, torrent_id: str, file_index: int, file_path: str, start: int, end: int, chunk_size: int = 1024 * 1024, piece_timeout: Optional[float] = None)` — generator; **only** `f.read`/`yield`s a chunk once its pieces are confirmed present, otherwise **RETURNs** (ends the generator) without yielding. `piece_timeout=None` (new default) means "compute adaptively per chunk"; a numeric value forces a fixed budget (back-compat for existing tests). (Consumed by Task W3.4 endpoint.)

Steps:

- [ ] **Step 1: Write the failing test.** Create `backend/tests/test_stream_no_garbage.py`:
```python
"""Core WS3 guarantee: stream_file_range must NEVER yield bytes for a piece that
is not have_piece(), and on timeout it must END the generator (stop yielding)
rather than serve sparse/zero bytes."""
import types
from app.torrent.manager import torrent_manager


class _FakeFile:
    def __init__(self, offset):
        self.offset = offset


class _FakeTI:
    def __init__(self, offset, piece_length, num_pieces):
        self._offset = offset
        self._pl = piece_length
        self._np = num_pieces

    def file_at(self, i):
        return _FakeFile(self._offset)

    def piece_length(self):
        return self._pl

    def num_pieces(self):
        return self._np


class _NeverReadyHandle:
    """have_piece() is always False -> no chunk may ever be served."""
    def __init__(self, ti, num_peers=0, download_rate=0):
        self._ti = ti
        self._num_peers = num_peers
        self._download_rate = download_rate
        self.read_attempts = 0

    def has_metadata(self):
        return True

    def get_torrent_info(self):
        return self._ti

    def set_sequential_download(self, _v):
        pass

    def have_piece(self, _p):
        return False

    def piece_priority(self, _p, _pr):
        pass

    def set_piece_deadline(self, _p, _d):
        pass

    def status(self):
        return types.SimpleNamespace(
            num_peers=self._num_peers, download_rate=self._download_rate
        )


class _ReadyHandle(_NeverReadyHandle):
    def have_piece(self, _p):
        return True


def _collect(gen):
    return b"".join(gen)


def test_never_yields_when_pieces_unavailable_and_ends(tmp_path):
    # Disk file is fully allocated (sparse in reality), but no piece is "have".
    data = b"GARBAGE_" * 64  # 512 bytes
    f = tmp_path / "vid.mp4"
    f.write_bytes(data)

    ti = _FakeTI(offset=0, piece_length=64, num_pieces=8)
    handle = _NeverReadyHandle(ti, num_peers=0, download_rate=0)
    torrent_manager.active_torrents["t-never"] = (handle, {})
    try:
        gen = torrent_manager.stream_file_range(
            "t-never", 0, str(f), 0, 511, chunk_size=128
        )
        out = _collect(gen)
    finally:
        del torrent_manager.active_torrents["t-never"]

    # Generator ended cleanly having yielded ZERO bytes — never the sparse data.
    assert out == b""


def test_yields_real_bytes_when_pieces_available(tmp_path):
    data = bytes(range(256)) * 2  # 512 bytes
    f = tmp_path / "vid.mp4"
    f.write_bytes(data)

    ti = _FakeTI(offset=0, piece_length=64, num_pieces=8)
    handle = _ReadyHandle(ti, num_peers=5, download_rate=100_000)
    torrent_manager.active_torrents["t-ready"] = (handle, {})
    try:
        out = _collect(
            torrent_manager.stream_file_range(
                "t-ready", 0, str(f), 100, 299, chunk_size=64
            )
        )
    finally:
        del torrent_manager.active_torrents["t-ready"]

    assert out == data[100:300]


def test_partial_then_unavailable_ends_after_good_chunks(tmp_path):
    """First chunk's pieces are ready, the rest never arrive -> serve the good
    chunk(s), then END without yielding garbage for the unavailable tail."""
    data = b"".join(bytes([i]) * 64 for i in range(8))  # 512 bytes, distinct per piece
    f = tmp_path / "vid.mp4"
    f.write_bytes(data)

    ti = _FakeTI(offset=0, piece_length=64, num_pieces=8)

    class _FirstTwoPiecesHandle(_NeverReadyHandle):
        def have_piece(self, p):
            return p < 2  # only pieces 0 and 1 (first 128 bytes) are ready

    handle = _FirstTwoPiecesHandle(ti, num_peers=2, download_rate=0)
    torrent_manager.active_torrents["t-partial"] = (handle, {})
    try:
        out = _collect(
            torrent_manager.stream_file_range(
                "t-partial", 0, str(f), 0, 511, chunk_size=128
            )
        )
    finally:
        del torrent_manager.active_torrents["t-partial"]

    # Exactly the first 128 bytes (pieces 0-1); nothing past that.
    assert out == data[0:128]
```

- [ ] **Step 2: Run the test, expect FAIL.**
```bash
docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest tests/test_stream_no_garbage.py -v
```
Expected: FAIL — current code reads unconditionally (manager.py:1102) so `test_never_yields_when_pieces_unavailable_and_ends` yields the sparse `GARBAGE_` bytes, and the partial test over-yields.

- [ ] **Step 3: Implement readiness-gated, return-on-timeout streaming.** In `backend/app/torrent/manager.py`, replace the `stream_file_range` signature and body (lines 1051-1107). Replace this current block:
```python
    def stream_file_range(self, torrent_id: str, file_index: int, file_path: str,
                          start: int, end: int, chunk_size: int = 1024 * 1024,
                          piece_timeout: float = 45.0):
```
with:
```python
    def stream_file_range(self, torrent_id: str, file_index: int, file_path: str,
                          start: int, end: int, chunk_size: int = 1024 * 1024,
                          piece_timeout: Optional[float] = None):
```
Then replace the streaming `while` loop body (current lines 1093-1107):
```python
        with open(file_path, "rb") as f:
            f.seek(start)
            remaining = end - start + 1
            pos = start
            while remaining > 0:
                n = min(chunk_size, remaining)
                first_piece = (file_offset + pos) // piece_length
                last_piece = (file_offset + pos + n - 1) // piece_length
                self._await_pieces(handle, first_piece, last_piece, num_pieces, piece_timeout)
                chunk = f.read(n)
                if not chunk:
                    break
                remaining -= len(chunk)
                pos += len(chunk)
                yield chunk
```
with:
```python
        with open(file_path, "rb") as f:
            f.seek(start)
            remaining = end - start + 1
            pos = start
            while remaining > 0:
                n = min(chunk_size, remaining)
                first_piece = (file_offset + pos) // piece_length
                last_piece = (file_offset + pos + n - 1) // piece_length

                # Wait (with deadlining) for this chunk's pieces. On failure we
                # END the generator rather than read sparse/undownloaded bytes —
                # the browser re-requests the Range; WS6/WS2 explain the gap.
                budget = (
                    piece_timeout if piece_timeout is not None
                    else self._adaptive_piece_timeout(handle)
                )
                if not self._await_pieces(
                    handle, first_piece, last_piece, num_pieces, budget
                ):
                    return

                # Pieces confirmed present — only NOW read from disk.
                chunk = f.read(n)
                if not chunk:
                    return
                remaining -= len(chunk)
                pos += len(chunk)
                yield chunk
```

- [ ] **Step 4: Make `_await_pieces` use the non-blocking check and return its result honestly.** In `backend/app/torrent/manager.py`, replace the `_await_pieces` body's wait loop (current lines 1125-1137):
```python
        deadline = time.time() + timeout
        while time.time() < deadline:
            try:
                if all(handle.have_piece(p) for p in range(first_piece, last_piece + 1)):
                    return True
            except Exception:
                return False
            time.sleep(0.05)

        logger.warning(
            f"Streaming: timed out waiting for pieces {first_piece}-{last_piece}; serving partial data"
        )
        return False
```
with:
```python
        deadline = time.time() + timeout
        while time.time() < deadline:
            if self._pieces_ready(handle, first_piece, last_piece):
                return True
            time.sleep(0.05)

        logger.warning(
            f"Streaming: timed out after {timeout:.1f}s waiting for pieces "
            f"{first_piece}-{last_piece}; ending stream (no garbage served)"
        )
        return False
```

- [ ] **Step 5: Run the new test, expect PASS.**
```bash
docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest tests/test_stream_no_garbage.py -v
```
Expected: PASS — 3 passed.

- [ ] **Step 6: Run the existing streaming-pieces regression suite, expect PASS.** The existing `test_streaming_pieces.py` passes numeric `piece_timeout` values (`5.0`) or relies on the default; with `available_after=0/2` the fakes become ready, and `test_disk_fallback_when_torrent_not_in_session` uses the `ti is None` early path — all still green.
```bash
docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest tests/test_streaming_pieces.py -v
```
Expected: PASS — 3 passed.

- [ ] **Step 7: Commit.**
```bash
git add backend/app/torrent/manager.py backend/tests/test_stream_no_garbage.py
git commit -m "fix(streaming): never serve undownloaded bytes; end generator on piece timeout"
```

---

### Task W3.4: Endpoint returns HTTP 416 for unsatisfiable ranges; passes adaptive timeout through

**Files:**
- Modify: `backend/app/api/streaming.py` (`stream_video`, lines 93-126)
- Test: `backend/tests/test_streaming_endpoint_416.py` (create)

**Interfaces:**
- Consumes: `parse_range_header(range_header, file_size) -> tuple`, `RANGE_NOT_SATISFIABLE` (Task W3.1); `torrent_manager.stream_file_range(...)` with `piece_timeout=None` default (Task W3.3).
- Produces: `stream_video` returns `Response(status_code=416, headers={"Content-Range": "bytes */{file_size}"})` when `parse_range_header` returns the sentinel.

Steps:

- [ ] **Step 1: Write the failing test.** Create `backend/tests/test_streaming_endpoint_416.py`:
```python
"""The /video endpoint returns HTTP 416 with Content-Range: bytes */{size} for
an unsatisfiable range, instead of silently clamping and serving the tail."""
import os
import types
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.api import streaming as streaming_api
from app.torrent import manager as manager_mod

client = TestClient(app)


@pytest.fixture
def stub_video(tmp_path, monkeypatch):
    f = tmp_path / "movie.mp4"
    f.write_bytes(b"X" * 1000)
    info = {"index": 0, "path": str(f), "size": 1000,
            "downloaded": 1000, "progress": 100.0, "name": "movie.mp4"}

    monkeypatch.setattr(
        streaming_api.torrent_manager, "get_video_file_info",
        lambda tid, fi=None: info,
    )
    monkeypatch.setattr(
        streaming_api.torrent_manager, "get_torrent_status",
        lambda tid: types.SimpleNamespace(progress=100.0),
    )
    monkeypatch.setattr(
        streaming_api.torrent_manager, "prioritize_video_files",
        lambda *a, **k: True,
    )
    return info


def test_unsatisfiable_range_returns_416(stub_video):
    r = client.get(
        "/api/v1/streaming/tid-1/video",
        headers={"Range": "bytes=5000-"},
    )
    assert r.status_code == 416
    assert r.headers["Content-Range"] == "bytes */1000"


def test_satisfiable_range_returns_206(stub_video):
    r = client.get(
        "/api/v1/streaming/tid-1/video",
        headers={"Range": "bytes=0-99"},
    )
    assert r.status_code == 206
    assert r.headers["Content-Range"] == "bytes 0-99/1000"
```

- [ ] **Step 2: Confirm the route prefix.** The endpoint is mounted under `/api/v1/streaming` (matches the `stream_url` the code already emits at streaming.py:186). Run the test, expect FAIL.
```bash
docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest tests/test_streaming_endpoint_416.py -v
```
Expected: FAIL — `test_unsatisfiable_range_returns_416` gets `206` (current code clamps `bytes=5000-` to the tail). If the route prefix differs, the FAIL surfaces as `404`; fix the URL in the test to the prefix shown by the run before proceeding.

- [ ] **Step 3: Implement the 416 branch.** In `backend/app/api/streaming.py`, inside `stream_video`, replace the current parse + early body (lines 93-95):
```python
        # Parse range header if present
        range_header = request.headers.get("Range")
        start, end = parse_range_header(range_header, file_size)
```
with:
```python
        # Parse range header if present.
        range_header = request.headers.get("Range")
        parsed = parse_range_header(range_header, file_size)
        if parsed is RANGE_NOT_SATISFIABLE:
            # RFC 7233 §4.4 — unsatisfiable range: 416 + the resource size.
            return Response(
                status_code=416,
                headers={"Content-Range": f"bytes */{file_size}"},
            )
        start, end = parsed
```
`Response` is already imported at streaming.py:1 (`from fastapi import ... Response`).

- [ ] **Step 4: Run the test, expect PASS.**
```bash
docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest tests/test_streaming_endpoint_416.py -v
```
Expected: PASS — 2 passed.

- [ ] **Step 5: Commit.**
```bash
git add backend/app/api/streaming.py backend/tests/test_streaming_endpoint_416.py
git commit -m "feat(streaming): return HTTP 416 with Content-Range for unsatisfiable ranges"
```

---

### Task W3.5: `file_index` validation — explicit invalid index is 404, never silent largest-file fallback

**Files:**
- Modify: `backend/app/torrent/manager.py` (`get_video_file_info`, lines 909-925)
- Modify: `backend/app/api/streaming.py` (`stream_video`, lines 73-81)
- Test: `backend/tests/test_file_index_validation.py` (create)

**Interfaces:**
- Produces: `def get_video_file_info(self, torrent_id: str, file_index: Optional[int] = None) -> Optional[Dict[str, Any]]` — unchanged signature. New invariant: when `file_index is not None` and it is **not** a video file in this torrent, returns `None` (already true today) — the endpoint must treat that as a **400/404 clear detail**, never re-call with `file_index=None`. When metadata is not yet available (torrent not in session / no metadata), the endpoint distinguishes "not ready" (404 "not ready for streaming") from "invalid index". (The function body is unchanged here; the behavioral fix is in the endpoint — this task adds the failing test that pins both functions and the endpoint contract.)
- Produces: `stream_video` returns HTTP 404 with detail `"Video file index {n} not found in this torrent"` when an explicit `file_index` does not resolve, and never falls back to the largest file.

Steps:

- [ ] **Step 1: Write the failing test.** Create `backend/tests/test_file_index_validation.py`:
```python
"""An explicitly-passed file_index that is not a video file in the torrent must
produce a clear 404 — it must NOT silently fall back to the largest file."""
import types
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.api import streaming as streaming_api

client = TestClient(app)


def test_get_video_file_info_returns_none_for_unknown_explicit_index(monkeypatch):
    files = [
        {"index": 0, "path": "/d/a.mkv", "size": 100, "downloaded": 0,
         "progress": 0.0, "name": "a.mkv"},
        {"index": 1, "path": "/d/b.mkv", "size": 999, "downloaded": 0,
         "progress": 0.0, "name": "b.mkv"},
    ]
    from app.torrent.manager import torrent_manager
    monkeypatch.setattr(torrent_manager, "get_video_files", lambda tid: files)
    # explicit, non-existent index -> None (no largest-file fallback)
    assert torrent_manager.get_video_file_info("t", file_index=7) is None
    # explicit, existing index -> that exact file (not the largest)
    assert torrent_manager.get_video_file_info("t", file_index=0)["index"] == 0
    # no index -> largest
    assert torrent_manager.get_video_file_info("t", file_index=None)["index"] == 1


def test_endpoint_404_for_invalid_explicit_index(monkeypatch):
    # An explicit file_index that does not resolve -> 404 with a clear detail.
    monkeypatch.setattr(
        streaming_api.torrent_manager, "get_video_file_info",
        lambda tid, fi=None: None,
    )
    r = client.get("/api/v1/streaming/tid-x/video?file_index=42")
    assert r.status_code == 404
    assert "42" in r.json()["detail"]


def test_endpoint_does_not_fall_back_to_largest_for_explicit_index(monkeypatch):
    """If file_index=42 is invalid, the endpoint must not retry with None and
    stream the largest file — get_video_file_info is called only with 42."""
    calls = []

    def _info(tid, fi=None):
        calls.append(fi)
        return None  # nothing resolves

    monkeypatch.setattr(streaming_api.torrent_manager, "get_video_file_info", _info)
    client.get("/api/v1/streaming/tid-x/video?file_index=42")
    assert calls == [42]  # never re-called with None
```

- [ ] **Step 2: Run the test, expect FAIL.** The unit assertions on `get_video_file_info` pass against current code, but `test_endpoint_404_for_invalid_explicit_index` currently returns the generic detail `"Video file not found or not ready for streaming"` (no `"42"`), so that assertion FAILs.
```bash
docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest tests/test_file_index_validation.py -v
```
Expected: FAIL — `assert "42" in r.json()["detail"]`.

- [ ] **Step 3: Implement explicit-index validation in the endpoint.** In `backend/app/api/streaming.py`, replace the current lookup block (lines 73-81):
```python
    # Get video file info from torrent manager
    video_info = torrent_manager.get_video_file_info(torrent_id, file_index)
    if not video_info:
        raise HTTPException(status_code=404, detail="Video file not found or not ready for streaming")
    
    # Ensure the file exists
    file_path = video_info["path"]
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Video file not found on disk")
```
with:
```python
    # Resolve the video file. An EXPLICIT file_index must resolve to that exact
    # file — never silently fall back to the largest. Distinguish an invalid
    # index from "metadata not ready yet".
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

    # Ensure the file exists
    file_path = video_info["path"]
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Video file not found on disk")
```

- [ ] **Step 4: Harden the docstring on `get_video_file_info` to lock the no-fallback contract.** In `backend/app/torrent/manager.py`, replace the current docstring (lines 910-916):
```python
        """
        Get info about one video file in a torrent.

        file_index None -> the largest video file (movie / single-episode default).
        file_index set  -> that specific file (season-pack episode), or None if it
                           isn't a video file in this torrent.
        """
```
with:
```python
        """
        Get info about one video file in a torrent.

        file_index None -> the largest video file (movie / single-episode default).
        file_index set  -> that EXACT file (season-pack episode), or None if it
                           isn't a video file in this torrent. The caller MUST NOT
                           re-query with None on a None result for an explicit
                           index — an explicit index that does not resolve is a
                           404, not a reason to stream the largest file.
        """
```
(The body — `if file_index is not None: ... return None` then `return max(files, ...)` at lines 920-925 — already implements the no-fallback behavior; no logic change.)

- [ ] **Step 5: Run the test, expect PASS.**
```bash
docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest tests/test_file_index_validation.py -v
```
Expected: PASS — 3 passed.

- [ ] **Step 6: Run the full WS3 suite + existing manager/streaming tests for regressions, expect PASS.**
```bash
docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest tests/test_range_header.py tests/test_pieces_ready.py tests/test_stream_no_garbage.py tests/test_streaming_endpoint_416.py tests/test_file_index_validation.py tests/test_streaming_pieces.py tests/test_torrents_manager.py -v
```
Expected: PASS — all green.

- [ ] **Step 7: Commit.**
```bash
git add backend/app/api/streaming.py backend/app/torrent/manager.py backend/tests/test_file_index_validation.py
git commit -m "fix(streaming): 404 on invalid explicit file_index; no silent largest-file fallback"
```

---

## Workstream W4: Async/event-driven piece waiting + seek-aware prioritization

This is the **last and riskiest** workstream (sequence: W1 → W3 → W2 → W6 → W5 → **W4** → W7). Its baseline is the repo **after W3 landed**: in `backend/app/torrent/manager.py`, `stream_file_range` is already a **synchronous** generator with signature `(self, torrent_id, file_index, file_path, start, end, chunk_size=1024*1024, piece_timeout: Optional[float] = None)`; it computes `budget = piece_timeout if piece_timeout is not None else self._adaptive_piece_timeout(handle)` and calls `self._await_pieces(handle, first_piece, last_piece, num_pieces, budget)`, **returning** (ending the generator) on a falsy result so no undownloaded bytes are ever served. W3 also added `_pieces_ready(self, handle, first_piece, last_piece) -> bool` and `_adaptive_piece_timeout(self, handle, *, base=8.0, max_timeout=60.0) -> float`. W3's `_await_pieces` wait loop is `while time.time() < deadline: if self._pieces_ready(...): return True; time.sleep(0.05)`.

W4 converts `stream_file_range` to an **`async def` generator** (keeping `piece_timeout: Optional[float] = None`, where `None` = adaptive), replaces the `time.sleep(0.05)` busy-wait with an **event-driven** `await_pieces_async`, wires a **per-torrent waiter registry keyed by piece index** that is woken from the alert loop via `_on_piece_finished` dispatched through `loop.call_soon_threadsafe`, offloads disk reads via `asyncio.to_thread`, and adds **seek-aware graduated deadlines** with relax-behind. Crucially: **REUSE `_pieces_ready` and `_adaptive_piece_timeout` — never redefine them** (a second def in the class body silently shadows the first), and there is **no `_compute_adaptive_timeout`**. `StreamingResponse` supports async generators, so `api/streaming.py` needs no change to consume the async gen.

W4's edits to `backend/tests/test_streaming_pieces.py` and `backend/tests/test_stream_no_garbage.py` (driving the now-async generator via `asyncio.run`) land in the **SAME commit** as the async conversion (Task W4.4), so the suite never goes red.

All backend test-run steps use the mounted-tests form (tests are baked into the image). Run **from the repo root** so `$(pwd)` = `/Users/benjaminherro/github/freeflix`; container workdir is `/opt/freeflix`, tests at `/opt/freeflix/tests`.

---

### Task W4.1: Per-torrent piece-waiter registry + event loop capture

**Files:**
- Modify: `backend/app/torrent/manager.py` — `__init__` (the `active_torrents` block, lines 64-65) to add registry + loop fields; `start_update_task` (lines 132-136) to capture the running loop.
- Test: `backend/tests/test_piece_waiters.py` (create)

**Interfaces:**
- Produces: `self._piece_waiters: Dict[str, Dict[int, List[asyncio.Future]]]` — per-torrent map of `piece_index -> list of pending Futures`. (Consumed by Tasks W4.2, W4.3.)
- Produces: `self._waiter_lock: threading.Lock` — guards `_piece_waiters` (the alert thread and the loop both touch it). (Consumed by W4.2, W4.3.)
- Produces: `self._loop: Optional[asyncio.AbstractEventLoop]` — the running event loop, captured in `start_update_task`, used by `_on_piece_finished` for `call_soon_threadsafe`. (Consumed by W4.3.)

Steps:

- [ ] **Step 1: Write the failing test.** Create `backend/tests/test_piece_waiters.py`:
```python
"""W4: the manager owns a per-torrent piece-waiter registry, a lock guarding it,
and a loop slot captured for cross-thread wakeups."""
import asyncio
import threading
from app.torrent.manager import torrent_manager


def test_registry_and_lock_exist():
    assert isinstance(torrent_manager._piece_waiters, dict)
    assert isinstance(torrent_manager._waiter_lock, type(threading.Lock()))


def test_loop_slot_exists():
    # Captured lazily in start_update_task; None before the task starts.
    assert hasattr(torrent_manager, "_loop")


def test_start_update_task_captures_running_loop():
    async def _run():
        await torrent_manager.start_update_task()
        captured = torrent_manager._loop
        # Cancel the background task we just started so the loop can close.
        if torrent_manager.update_task:
            torrent_manager.update_task.cancel()
        return captured

    loop = asyncio.new_event_loop()
    try:
        captured = loop.run_until_complete(_run())
    finally:
        loop.close()
        torrent_manager.update_task = None
    assert captured is loop
```

- [ ] **Step 2: Run the test, expect FAIL.**
```bash
docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest tests/test_piece_waiters.py -v
```
Expected: FAIL — `AttributeError: 'TorrentManager' object has no attribute '_piece_waiters'`.

- [ ] **Step 3: Add the `threading` import.** In `backend/app/torrent/manager.py`, the imports start with `import libtorrent as lt` / `import asyncio` / `import time` (lines 1-3). Add `threading` after `import time` (line 3). Replace:
```python
import asyncio
import time
import json
```
with:
```python
import asyncio
import threading
import time
import json
```

- [ ] **Step 4: Add registry, lock, and loop slot in `__init__`.** In `backend/app/torrent/manager.py`, the current block (lines 64-65) is:
```python
        # Dictionary to store active torrents: {torrent_id: (handle, metadata)}
        self.active_torrents: Dict[str, Tuple[lt.torrent_handle, Dict[str, Any]]] = {}
```
Replace it with:
```python
        # Dictionary to store active torrents: {torrent_id: (handle, metadata)}
        self.active_torrents: Dict[str, Tuple[lt.torrent_handle, Dict[str, Any]]] = {}

        # W4: per-torrent event-driven piece waiters.
        # {torrent_id: {piece_index: [asyncio.Future, ...]}}. The alert thread
        # resolves these via _on_piece_finished; stream coroutines await them
        # instead of busy-polling have_piece(). _waiter_lock guards mutation
        # (the alert loop and request coroutines both touch the map).
        self._piece_waiters: Dict[str, Dict[int, List[asyncio.Future]]] = {}
        self._waiter_lock = threading.Lock()
        # The running event loop, captured when the status task starts; used by
        # _on_piece_finished for loop.call_soon_threadsafe cross-thread wakeups.
        self._loop: Optional[asyncio.AbstractEventLoop] = None
```

- [ ] **Step 5: Capture the running loop in `start_update_task`.** The current method (lines 132-136) is:
```python
    async def start_update_task(self):
        """Start the background task to update torrent status"""
        if self.update_task is None or self.update_task.done():
            self.update_task = asyncio.create_task(self._update_torrents_status())
            logger.info("Started torrent status update task")
```
Replace it with:
```python
    async def start_update_task(self):
        """Start the background task to update torrent status"""
        # Capture the loop running this coroutine so the alert thread can wake
        # stream coroutines across threads (loop.call_soon_threadsafe).
        self._loop = asyncio.get_running_loop()
        if self.update_task is None or self.update_task.done():
            self.update_task = asyncio.create_task(self._update_torrents_status())
            logger.info("Started torrent status update task")
```

- [ ] **Step 6: Run the test, expect PASS.**
```bash
docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest tests/test_piece_waiters.py -v
```
Expected: PASS — 3 passed.

- [ ] **Step 7: Commit.**
```bash
git add backend/app/torrent/manager.py backend/tests/test_piece_waiters.py
git commit -m "feat(streaming): add per-torrent piece-waiter registry and loop capture

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task W4.2: `_on_piece_finished` resolves waiters + alert-loop dispatch

**Files:**
- Modify: `backend/app/torrent/manager.py` — add `_on_piece_finished` and `_register_piece_waiter`/`_unregister_piece_waiter` helpers (near `_pieces_ready`, after the `_adaptive_piece_timeout` method added by W3); hook `piece_finished_alert` into `_handle_alert` (after the `performance_alert` branch, lines 504-521, before the `except` at line 523).
- Test: `backend/tests/test_on_piece_finished.py` (create)

**Interfaces:**
- Consumes: `self._piece_waiters`, `self._waiter_lock`, `self._loop` (Task W4.1).
- Produces: `def _register_piece_waiter(self, torrent_id: str, piece_index: int) -> asyncio.Future` — creates a Future on `self._loop`, files it under `[torrent_id][piece_index]`, returns it. (Consumed by W4.3.)
- Produces: `def _unregister_piece_waiter(self, torrent_id: str, piece_index: int, fut: asyncio.Future) -> None` — removes `fut` from the registry (cleanup after await/timeout). (Consumed by W4.3.)
- Produces: `def _on_piece_finished(self, torrent_id: str, piece_index: int) -> None` — resolves (sets result `True`) every pending Future for that `(torrent_id, piece_index)` via `loop.call_soon_threadsafe`, then drops them. Safe to call from the alert thread. (Consumed by the `_handle_alert` dispatch.)

Steps:

- [ ] **Step 1: Write the failing test.** Create `backend/tests/test_on_piece_finished.py`:
```python
"""W4: _on_piece_finished resolves the per-piece Futures registered by a waiter,
dispatched safely across the alert thread via call_soon_threadsafe."""
import asyncio
import pytest
from app.torrent.manager import torrent_manager


@pytest.fixture(autouse=True)
def _clean_registry():
    torrent_manager._piece_waiters.clear()
    yield
    torrent_manager._piece_waiters.clear()


def test_register_creates_future_in_registry():
    async def _run():
        torrent_manager._loop = asyncio.get_running_loop()
        fut = torrent_manager._register_piece_waiter("t1", 5)
        assert isinstance(fut, asyncio.Future)
        assert torrent_manager._piece_waiters["t1"][5] == [fut]
        fut.cancel()
    asyncio.run(_run())


def test_on_piece_finished_resolves_waiter():
    async def _run():
        torrent_manager._loop = asyncio.get_running_loop()
        fut = torrent_manager._register_piece_waiter("t1", 7)
        # Simulate the alert thread calling in.
        torrent_manager._on_piece_finished("t1", 7)
        result = await asyncio.wait_for(fut, timeout=1.0)
        assert result is True
        # Registry entry for that piece is cleaned up.
        assert 7 not in torrent_manager._piece_waiters.get("t1", {})
    asyncio.run(_run())


def test_on_piece_finished_unknown_piece_is_noop():
    async def _run():
        torrent_manager._loop = asyncio.get_running_loop()
        # No waiter registered -> must not raise.
        torrent_manager._on_piece_finished("nope", 0)
    asyncio.run(_run())


def test_unregister_removes_future():
    async def _run():
        torrent_manager._loop = asyncio.get_running_loop()
        fut = torrent_manager._register_piece_waiter("t1", 3)
        torrent_manager._unregister_piece_waiter("t1", 3, fut)
        assert 3 not in torrent_manager._piece_waiters.get("t1", {})
        fut.cancel()
    asyncio.run(_run())
```

- [ ] **Step 2: Run the test, expect FAIL.**
```bash
docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest tests/test_on_piece_finished.py -v
```
Expected: FAIL — `AttributeError: 'TorrentManager' object has no attribute '_register_piece_waiter'`.

- [ ] **Step 3: Implement the three helpers.** In `backend/app/torrent/manager.py`, the methods `_pieces_ready` and `_adaptive_piece_timeout` (added by W3) sit immediately before `def _await_pieces(`. Insert the following **after `_adaptive_piece_timeout` and before `_await_pieces`** (do NOT redefine `_pieces_ready` or `_adaptive_piece_timeout`):
```python
    def _register_piece_waiter(self, torrent_id: str, piece_index: int):
        """Create + register a Future resolved when piece `piece_index` of
        `torrent_id` finishes. Must be called from the event-loop thread."""
        fut = self._loop.create_future()
        with self._waiter_lock:
            self._piece_waiters.setdefault(torrent_id, {}).setdefault(
                piece_index, []
            ).append(fut)
        return fut

    def _unregister_piece_waiter(self, torrent_id: str, piece_index: int, fut) -> None:
        """Drop `fut` from the registry (after it resolved, timed out, or the
        stream ended). Idempotent."""
        with self._waiter_lock:
            per_torrent = self._piece_waiters.get(torrent_id)
            if not per_torrent:
                return
            waiters = per_torrent.get(piece_index)
            if not waiters:
                return
            if fut in waiters:
                waiters.remove(fut)
            if not waiters:
                per_torrent.pop(piece_index, None)
            if not per_torrent:
                self._piece_waiters.pop(torrent_id, None)

    def _on_piece_finished(self, torrent_id: str, piece_index: int) -> None:
        """Resolve every Future waiting on (torrent_id, piece_index). Safe to
        call from the alert thread: each Future is completed on its own loop via
        call_soon_threadsafe. Drops the resolved waiters from the registry."""
        with self._waiter_lock:
            per_torrent = self._piece_waiters.get(torrent_id)
            if not per_torrent:
                return
            waiters = per_torrent.pop(piece_index, None)
            if not per_torrent:
                self._piece_waiters.pop(torrent_id, None)
        if not waiters:
            return

        def _resolve(f):
            if not f.done():
                f.set_result(True)

        for fut in waiters:
            loop = fut.get_loop()
            loop.call_soon_threadsafe(_resolve, fut)

```

- [ ] **Step 4: Run the test, expect PASS.**
```bash
docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest tests/test_on_piece_finished.py -v
```
Expected: PASS — 4 passed.

- [ ] **Step 5: Write the failing alert-dispatch test.** Append to `backend/tests/test_on_piece_finished.py`:
```python
def test_handle_alert_dispatches_piece_finished():
    """A piece_finished_alert for a known handle calls _on_piece_finished with
    the right torrent_id + piece index."""
    import types

    class _Handle:
        pass

    handle = _Handle()
    torrent_manager.active_torrents["t-alert"] = (handle, {})
    calls = []
    orig = torrent_manager._on_piece_finished
    torrent_manager._on_piece_finished = lambda tid, pi: calls.append((tid, pi))
    try:
        alert = types.SimpleNamespace(handle=handle, piece_index=11)
        # Force the isinstance branch by monkeypatching lt.piece_finished_alert
        # to this SimpleNamespace's type for the duration of the call.
        import app.torrent.manager as mgr
        real_cls = mgr.lt.piece_finished_alert
        mgr.lt.piece_finished_alert = types.SimpleNamespace
        try:
            torrent_manager._handle_alert(alert)
        finally:
            mgr.lt.piece_finished_alert = real_cls
    finally:
        torrent_manager._on_piece_finished = orig
        del torrent_manager.active_torrents["t-alert"]
    assert calls == [("t-alert", 11)]
```

- [ ] **Step 6: Run it, expect FAIL.**
```bash
docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest tests/test_on_piece_finished.py::test_handle_alert_dispatches_piece_finished -v
```
Expected: FAIL — `_handle_alert` has no `piece_finished_alert` branch, so `calls == []`.

- [ ] **Step 7: Hook `piece_finished_alert` into `_handle_alert`.** In `backend/app/torrent/manager.py`, the `performance_alert` branch ends at line 521 (`break`) and the method's `except` is at line 523. Insert a new branch between them. Replace:
```python
                        db.add(log)
                        db.commit()
                        break

        except Exception as e:
            logger.error(f"Error handling alert: {e}")
            logger.exception("Alert handling exception details:")
```
with:
```python
                        db.add(log)
                        db.commit()
                        break

            elif isinstance(alert, lt.piece_finished_alert):
                # W4: wake any stream coroutine awaiting this piece. Dispatched
                # to the loop thread inside _on_piece_finished via
                # call_soon_threadsafe, so this is safe even if alerts are popped
                # off-loop.
                torrent_handle = alert.handle
                piece_index = int(alert.piece_index)
                for torrent_id, (handle, _) in self.active_torrents.items():
                    if handle == torrent_handle:
                        self._on_piece_finished(torrent_id, piece_index)
                        break

        except Exception as e:
            logger.error(f"Error handling alert: {e}")
            logger.exception("Alert handling exception details:")
```

- [ ] **Step 8: Run the full file, expect PASS.**
```bash
docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest tests/test_on_piece_finished.py -v
```
Expected: PASS — 5 passed.

- [ ] **Step 9: Commit.**
```bash
git add backend/app/torrent/manager.py backend/tests/test_on_piece_finished.py
git commit -m "feat(streaming): resolve piece waiters from piece_finished_alert

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task W4.3: `await_pieces_async` — event-driven wait replacing the sync sleep loop

**Files:**
- Modify: `backend/app/torrent/manager.py` — add `await_pieces_async`; **remove** the sync `_await_pieces` wait loop (the whole `_await_pieces` method, post-W3 lines 1109-1137) and replace it with the async path's deadlining helper that `await_pieces_async` reuses.
- Test: `backend/tests/test_await_pieces_async.py` (create)

**Interfaces:**
- Consumes: `self._pieces_ready(handle, first_piece, last_piece) -> bool` (W3); `self._register_piece_waiter`, `self._unregister_piece_waiter` (W4.2); `self._on_piece_finished` (W4.2, for test injection).
- Produces: `def _deadline_pieces(self, handle, first_piece: int, last_piece: int, num_pieces: int, read_ahead: int = 4) -> None` — sets top priority + `set_piece_deadline(p, 0)` on `[first_piece, last_piece+read_ahead)` (the non-waiting half of old `_await_pieces`). (Consumed by W4.4.)
- Produces: `async def await_pieces_async(self, handle, pieces: list[int], timeout: float) -> bool` — returns `True` as soon as every piece in `pieces` is `have_piece`; registers a Future per not-yet-have piece, awaits them under a single `asyncio.wait_for(..., timeout)`; on timeout returns `False` after cleaning up its Futures. `pieces` is the inclusive `[first_piece, last_piece]` set (caller passes `list(range(first, last+1))`). (Consumed by W4.4.)
- Removed: `_await_pieces` (the sync `time.sleep(0.05)` wait loop). W3's `stream_file_range` call to it is rewritten in W4.4.

Steps:

- [ ] **Step 1: Write the failing test.** Create `backend/tests/test_await_pieces_async.py`:
```python
"""W4: await_pieces_async resolves when pieces arrive (via the waiter Futures)
and times out cleanly when they do not — no busy-poll."""
import asyncio
import types
import pytest
from app.torrent.manager import torrent_manager


@pytest.fixture(autouse=True)
def _clean():
    torrent_manager._piece_waiters.clear()
    yield
    torrent_manager._piece_waiters.clear()


class _Handle:
    def __init__(self, have):
        self._have = set(have)

    def have_piece(self, p):
        return p in self._have

    def piece_priority(self, p, pr):
        pass

    def set_piece_deadline(self, p, d):
        pass

    def status(self):
        return types.SimpleNamespace(num_peers=3, download_rate=0)


def test_returns_true_immediately_when_all_present():
    async def _run():
        torrent_manager._loop = asyncio.get_running_loop()
        torrent_manager.active_torrents["t-a"] = (_Handle({0, 1, 2}), {})
        try:
            ok = await torrent_manager.await_pieces_async(
                torrent_manager.active_torrents["t-a"][0], [0, 1, 2], timeout=1.0
            )
        finally:
            del torrent_manager.active_torrents["t-a"]
        assert ok is True
    asyncio.run(_run())


def test_resolves_when_piece_arrives_via_alert():
    async def _run():
        torrent_manager._loop = asyncio.get_running_loop()
        h = _Handle({0})  # piece 1 missing initially
        torrent_manager.active_torrents["t-b"] = (h, {})

        async def _deliver():
            await asyncio.sleep(0.05)
            h._have.add(1)
            torrent_manager._on_piece_finished("t-b", 1)

        try:
            deliver = asyncio.create_task(_deliver())
            ok = await torrent_manager.await_pieces_async(h, [0, 1], timeout=2.0)
            await deliver
        finally:
            del torrent_manager.active_torrents["t-b"]
        assert ok is True
    asyncio.run(_run())


def test_times_out_when_pieces_never_arrive():
    async def _run():
        torrent_manager._loop = asyncio.get_running_loop()
        h = _Handle(set())  # nothing ever arrives
        torrent_manager.active_torrents["t-c"] = (h, {})
        try:
            ok = await torrent_manager.await_pieces_async(h, [0, 1], timeout=0.2)
        finally:
            del torrent_manager.active_torrents["t-c"]
        assert ok is False
        # Waiter Futures were cleaned up.
        assert torrent_manager._piece_waiters.get("t-c") in (None, {})
    asyncio.run(_run())
```

- [ ] **Step 2: Run it, expect FAIL.**
```bash
docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest tests/test_await_pieces_async.py -v
```
Expected: FAIL — `AttributeError: 'TorrentManager' object has no attribute 'await_pieces_async'`.

- [ ] **Step 3: Replace `_await_pieces` with `_deadline_pieces` + `await_pieces_async`.** In `backend/app/torrent/manager.py`, the entire current `_await_pieces` method (post-W3, lines 1109-1137) is:
```python
    def _await_pieces(self, handle, first_piece: int, last_piece: int,
                      num_pieces: int, timeout: float, read_ahead: int = 4) -> bool:
        """
        Block until pieces [first_piece, last_piece] are downloaded (or `timeout`
        seconds elapse), deadlining them — plus a little read-ahead — so libtorrent
        fetches them ASAP. Returns True if every required piece arrived, else False
        (caller then serves what's there rather than hanging forever).
        """
        for p in range(first_piece, min(last_piece + 1 + read_ahead, num_pieces)):
            try:
                if not handle.have_piece(p):
                    handle.piece_priority(p, 7)
                    handle.set_piece_deadline(p, 0)
            except Exception:
                pass

        deadline = time.time() + timeout
        while time.time() < deadline:
            if self._pieces_ready(handle, first_piece, last_piece):
                return True
            time.sleep(0.05)

        logger.warning(
            f"Streaming: timed out after {timeout:.1f}s waiting for pieces "
            f"{first_piece}-{last_piece}; ending stream (no garbage served)"
        )
        return False
```
Replace it **in full** with:
```python
    def _deadline_pieces(self, handle, first_piece: int, last_piece: int,
                         num_pieces: int, read_ahead: int = 4) -> None:
        """Top-priority + zero-deadline pieces [first_piece, last_piece] plus a
        little read-ahead so libtorrent fetches them next. No waiting."""
        for p in range(first_piece, min(last_piece + 1 + read_ahead, num_pieces)):
            try:
                if not handle.have_piece(p):
                    handle.piece_priority(p, 7)
                    handle.set_piece_deadline(p, 0)
            except Exception:
                pass

    async def await_pieces_async(self, handle, pieces: list, timeout: float) -> bool:
        """Event-driven wait for every piece in `pieces` to be downloaded.

        Returns True once all are have_piece(); False if `timeout` seconds pass
        first. Replaces the old time.sleep(0.05) busy-poll: registers a Future per
        not-yet-have piece (resolved from the alert loop by _on_piece_finished) and
        awaits them under one asyncio.wait_for. Always cleans up its Futures.
        """
        # Find the torrent_id for this handle (registry is keyed by it).
        torrent_id = None
        for tid, (h, _) in self.active_torrents.items():
            if h == handle:
                torrent_id = tid
                break
        if torrent_id is None:
            # Not in the session anymore — fall back to a direct check.
            return all(self._pieces_ready(handle, p, p) for p in pieces)

        missing = [p for p in pieces if not self._safe_have(handle, p)]
        if not missing:
            return True

        futures = [self._register_piece_waiter(torrent_id, p) for p in missing]
        try:
            await asyncio.wait_for(
                asyncio.gather(*futures), timeout=timeout
            )
            return True
        except asyncio.TimeoutError:
            logger.warning(
                f"Streaming: timed out after {timeout:.1f}s waiting for pieces "
                f"{missing[0]}-{missing[-1]}; ending stream (no garbage served)"
            )
            return False
        finally:
            for p, fut in zip(missing, futures):
                self._unregister_piece_waiter(torrent_id, p, fut)
                if not fut.done():
                    fut.cancel()

    def _safe_have(self, handle, piece: int) -> bool:
        """have_piece() that never raises (handle may be invalidated)."""
        try:
            return bool(handle.have_piece(piece))
        except Exception:
            return False
```

- [ ] **Step 4: Run the async-wait test, expect PASS.**
```bash
docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest tests/test_await_pieces_async.py -v
```
Expected: PASS — 3 passed.

- [ ] **Step 5: Confirm no remaining `_await_pieces` references (other than `stream_file_range`, fixed in W4.4).**
```bash
grep -rn "_await_pieces" backend/app
```
Expected: exactly ONE hit — the call inside `stream_file_range` (rewritten in Task W4.4). No method definition remains.

- [ ] **Step 6: Commit.**
```bash
git add backend/app/torrent/manager.py backend/tests/test_await_pieces_async.py
git commit -m "feat(streaming): event-driven await_pieces_async replaces sync sleep loop

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task W4.4: Convert `stream_file_range` to an async generator (disk reads off-loop)

**Files:**
- Modify: `backend/app/torrent/manager.py` — `stream_file_range` (post-W3 lines 1051-1107).
- Modify: `backend/tests/test_streaming_pieces.py` — drive the now-async generator via `asyncio.run`; add `status()`/`have_piece` plumbing the async path needs.
- Modify: `backend/tests/test_stream_no_garbage.py` (created by W3) — same async-drive adaptation.

**Interfaces:**
- Consumes: `self._deadline_pieces(...)` (W4.3); `self.await_pieces_async(handle, pieces, timeout) -> bool` (W4.3); `self._adaptive_piece_timeout(handle)` (W3); `asyncio.to_thread`.
- Produces: `async def stream_file_range(self, torrent_id, file_index, file_path, start, end, chunk_size=1024*1024, piece_timeout: Optional[float] = None)` — async generator. `piece_timeout=None` ⇒ adaptive (`_adaptive_piece_timeout`); numeric ⇒ fixed. Preserves W3's guarantee: **never `yield`s bytes for an index whose pieces are not confirmed present** — on wait failure it `return`s (ends the gen). Disk reads run via `asyncio.to_thread`. `StreamingResponse` consumes it directly (no `api/streaming.py` change). (Consumed by `api/streaming.py` `stream_video`.)

Steps:

- [ ] **Step 1: Adapt the no-garbage test to the async generator.** In `backend/tests/test_stream_no_garbage.py` (created by W3), replace the `_collect` helper:
```python
def _collect(gen):
    return b"".join(gen)
```
with:
```python
import asyncio


async def _drain(agen):
    out = []
    async for chunk in agen:
        out.append(chunk)
    return b"".join(out)


def _collect(agen):
    return asyncio.run(_drain(agen))
```
The W3 fakes (`_NeverReadyHandle`/`_ReadyHandle`) already expose `status()`, `have_piece`, `piece_priority`, `set_piece_deadline` — the async path needs nothing more. (Each `_collect` call uses a fresh `asyncio.run`, so `_register_piece_waiter` creates Futures on that call's loop; the never-ready handle has `have_piece -> False` so `await_pieces_async` registers + times out via the adaptive `2.0`s budget for 0-peer / numeric budget, then `stream_file_range` returns having yielded nothing.)

- [ ] **Step 2: Run the no-garbage test, expect FAIL.** It still calls the sync generator; with the gen about to become async, the `async for` adaptation drives it. Right now `stream_file_range` is sync, so `async for` over a sync generator raises.
```bash
docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest tests/test_stream_no_garbage.py -v
```
Expected: FAIL — `TypeError: 'async for' requires an object with __aiter__ ... got generator`.

- [ ] **Step 3: Adapt `test_streaming_pieces.py` to the async generator.** In `backend/tests/test_streaming_pieces.py`, replace the `_collect` helper:
```python
def _collect(gen):
    return b"".join(gen)
```
with:
```python
import asyncio


async def _drain(agen):
    out = []
    async for chunk in agen:
        out.append(chunk)
    return b"".join(out)


def _collect(agen):
    return asyncio.run(_drain(agen))
```
Then add `status()` to `_FakeHandle` so the adaptive path can read peers/rate (insert after its `set_piece_deadline` method):
```python
    def status(self):
        import types
        return types.SimpleNamespace(num_peers=3, download_rate=0)
```
Note: `_FakeHandle.have_piece` flips to `True` after `available_after` checks; `await_pieces_async` calls `_safe_have` once per piece up-front and, if missing, registers a Future. For `available_after=2` (`test_deadlines_pieces_until_available`) the piece is still "not yet" at registration, so the Future would never resolve (no alert fires in the unit harness). Change that one test to pass `available_after=0` and instead assert deadlining happens via the now-synchronous `_deadline_pieces`. Replace the body of `test_deadlines_pieces_until_available`:
```python
    ti = _FakeTI(offset=0, piece_length=64, num_pieces=8)
    # First two availability checks report "not yet"; then pieces arrive.
    handle = _FakeHandle(ti, available_after=2)
    torrent_manager.active_torrents["t-wait"] = (handle, {})
    try:
        out = _collect(
            torrent_manager.stream_file_range(
                "t-wait", 0, str(f), 0, 127, chunk_size=128, piece_timeout=5.0
            )
        )
    finally:
        del torrent_manager.active_torrents["t-wait"]

    assert out == data[0:128]
    # It deadlined the pieces it was waiting on.
    assert handle.deadlined, "expected pieces to be deadlined while waiting"
```
with:
```python
    ti = _FakeTI(offset=0, piece_length=64, num_pieces=8)
    # Pieces are available; assert the deadlining pass still ran. (Event-driven
    # waiting for not-yet-have pieces is covered by test_await_pieces_async.)
    handle = _FakeHandle(ti, available_after=0)
    torrent_manager.active_torrents["t-wait"] = (handle, {})
    try:
        out = _collect(
            torrent_manager.stream_file_range(
                "t-wait", 0, str(f), 0, 127, chunk_size=128, piece_timeout=5.0
            )
        )
    finally:
        del torrent_manager.active_torrents["t-wait"]

    assert out == data[0:128]
    # The deadlining pass ran for this chunk's pieces.
    assert handle.deadlined, "expected pieces to be deadlined for the served chunk"
```
The deadlining assertion holds because Step 5's `stream_file_range` calls `_deadline_pieces` (which sets deadlines) **before** the readiness wait, and `_FakeHandle.have_piece` returns `False` on the very first call inside `_deadline_pieces` (checks counter starts at 0), so `set_piece_deadline` is invoked.

- [ ] **Step 4: Run both adapted tests, expect FAIL.**
```bash
docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest tests/test_streaming_pieces.py tests/test_stream_no_garbage.py -v
```
Expected: FAIL — both files hit `TypeError: 'async for' requires ... __aiter__` (generator still sync).

- [ ] **Step 5: Convert `stream_file_range` to async.** In `backend/app/torrent/manager.py`, replace the entire current method (post-W3 lines 1051-1107). The current signature + disk-fallback + loop are:
```python
    def stream_file_range(self, torrent_id: str, file_index: int, file_path: str,
                          start: int, end: int, chunk_size: int = 1024 * 1024,
                          piece_timeout: Optional[float] = None):
```
through the final:
```python
                remaining -= len(chunk)
                pos += len(chunk)
                yield chunk
```
Replace that whole method body with:
```python
    async def stream_file_range(self, torrent_id: str, file_index: int, file_path: str,
                                start: int, end: int, chunk_size: int = 1024 * 1024,
                                piece_timeout: Optional[float] = None):
        """
        Async generator yielding bytes [start, end] (inclusive) of a torrent's
        file for HTTP streaming, event-driven-WAITING for each underlying piece to
        actually be downloaded before serving it.

        Serving a torrent file straight off disk while it is still downloading
        hands the player not-yet-downloaded (sparse / zero) bytes — including the
        MP4 `moov` atom when it lives at the END of the file. The browser decoder
        rejects those (PIPELINE_ERROR_DECODE / VideoToolbox -12909). This gates
        every chunk on piece availability (await_pieces_async) — deadlining the
        needed pieces so libtorrent fetches them next — and NEVER yields a chunk
        whose pieces are not confirmed present (it ends the generator on timeout
        instead of serving garbage). Disk reads run off the event loop via
        asyncio.to_thread. StreamingResponse consumes async generators directly.
        """
        entry = self.active_torrents.get(torrent_id)
        handle = entry[0] if entry else None
        ti = handle.get_torrent_info() if (handle and handle.has_metadata()) else None

        # No live torrent (e.g. completed and removed from the session) → every
        # byte is already on disk; serve straight through (reads off-loop).
        if ti is None:
            f = await asyncio.to_thread(open, file_path, "rb")
            try:
                await asyncio.to_thread(f.seek, start)
                remaining = end - start + 1
                while remaining > 0:
                    chunk = await asyncio.to_thread(f.read, min(chunk_size, remaining))
                    if not chunk:
                        break
                    remaining -= len(chunk)
                    yield chunk
            finally:
                await asyncio.to_thread(f.close)
            return

        file_offset = ti.file_at(file_index).offset
        piece_length = ti.piece_length()
        num_pieces = ti.num_pieces()
        try:
            handle.set_sequential_download(True)
        except Exception:
            pass

        # Seek-aware playhead: where this stream currently reads from, in pieces.
        playhead_piece = (file_offset + start) // piece_length

        f = await asyncio.to_thread(open, file_path, "rb")
        try:
            await asyncio.to_thread(f.seek, start)
            remaining = end - start + 1
            pos = start
            while remaining > 0:
                n = min(chunk_size, remaining)
                first_piece = (file_offset + pos) // piece_length
                last_piece = (file_offset + pos + n - 1) // piece_length

                # Seek-aware graduated read-ahead: focus libtorrent on the window
                # at/after the playhead, relax anything far behind it.
                self._prioritize_window(
                    handle, first_piece, num_pieces, playhead_piece
                )
                playhead_piece = first_piece

                # Deadline this chunk's pieces, then event-wait for them. On
                # failure END the generator rather than read undownloaded bytes —
                # the browser re-requests the Range; WS6/WS2 explain the gap.
                self._deadline_pieces(handle, first_piece, last_piece, num_pieces)
                budget = (
                    piece_timeout if piece_timeout is not None
                    else self._adaptive_piece_timeout(handle)
                )
                ok = await self.await_pieces_async(
                    handle, list(range(first_piece, last_piece + 1)), budget
                )
                if not ok:
                    return

                # Pieces confirmed present — only NOW read from disk (off-loop).
                chunk = await asyncio.to_thread(f.read, n)
                if not chunk:
                    return
                remaining -= len(chunk)
                pos += len(chunk)
                yield chunk
        finally:
            await asyncio.to_thread(f.close)
```

- [ ] **Step 6: Add the seek-aware `_prioritize_window` helper.** In `backend/app/torrent/manager.py`, insert immediately after `_deadline_pieces` (added in W4.3):
```python
    def _prioritize_window(self, handle, first_piece: int, num_pieces: int,
                           prev_playhead: int, window: int = 32,
                           step_ms: int = 800) -> None:
        """Seek-aware prioritization. Around the current read position set
        GRADUATED set_piece_deadline(p, k*step) across a forward read-ahead
        window (nearest piece tightest), and RELAX pieces far behind the playhead
        on a backward seek so libtorrent stops fetching where the user no longer
        is. Best-effort: every libtorrent call is guarded."""
        last = min(first_piece + window, num_pieces)
        for k, p in enumerate(range(first_piece, last)):
            try:
                if not handle.have_piece(p):
                    handle.piece_priority(p, 7)
                    handle.set_piece_deadline(p, k * step_ms)
            except Exception:
                pass

        # Backward seek: relax the abandoned window behind the new playhead.
        if first_piece < prev_playhead:
            for p in range(first_piece + window, min(prev_playhead + window, num_pieces)):
                try:
                    if not handle.have_piece(p):
                        handle.piece_priority(p, 1)  # low, not zero (still wanted)
                        handle.reset_piece_deadline(p)
                except Exception:
                    pass
```

- [ ] **Step 7: Run the adapted streaming tests, expect PASS.**
```bash
docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest tests/test_streaming_pieces.py tests/test_stream_no_garbage.py -v
```
Expected: PASS — `test_streaming_pieces.py` 3 passed, `test_stream_no_garbage.py` 3 passed. (The W3 `_FakeTI`/handle fakes lack `reset_piece_deadline`, but `_prioritize_window`'s backward-relax branch only runs on `first_piece < prev_playhead`; for these forward single-pass reads it never fires, and every call is `try/except`-guarded regardless.)

- [ ] **Step 8: Run the full W4 + W3 streaming regression set, expect PASS.**
```bash
docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest tests/test_piece_waiters.py tests/test_on_piece_finished.py tests/test_await_pieces_async.py tests/test_streaming_pieces.py tests/test_stream_no_garbage.py tests/test_torrents_manager.py -v
```
Expected: PASS — all green.

- [ ] **Step 9: Commit (conversion + test adaptations together).**
```bash
git add backend/app/torrent/manager.py backend/tests/test_streaming_pieces.py backend/tests/test_stream_no_garbage.py
git commit -m "feat(streaming): async stream_file_range with seek-aware piece prioritization

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task W4.5: End-to-end regression — endpoint still serves via the async generator

**Files:**
- Test: `backend/tests/test_async_stream_endpoint.py` (create)

**Interfaces:**
- Consumes: `app.api.streaming.stream_video` → `StreamingResponse(torrent_manager.stream_file_range(...))` (async generator from W4.4); `parse_range_header` + `RANGE_NOT_SATISFIABLE` (W3). No production change in this task — it pins that `StreamingResponse` drives the async generator end-to-end so a future edit can't silently re-sync it.

Steps:

- [ ] **Step 1: Write the test.** Create `backend/tests/test_async_stream_endpoint.py`:
```python
"""W4 end-to-end: the /video endpoint streams real bytes through the async
stream_file_range generator (StreamingResponse supports async generators)."""
import types
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.api import streaming as streaming_api

client = TestClient(app)


@pytest.fixture
def stub(tmp_path, monkeypatch):
    data = bytes(range(256)) * 4  # 1024 bytes
    f = tmp_path / "movie.mp4"
    f.write_bytes(data)
    info = {"index": 0, "path": str(f), "size": 1024,
            "downloaded": 1024, "progress": 100.0, "name": "movie.mp4"}
    monkeypatch.setattr(
        streaming_api.torrent_manager, "get_video_file_info",
        lambda tid, fi=None: info,
    )
    monkeypatch.setattr(
        streaming_api.torrent_manager, "get_torrent_status",
        lambda tid: types.SimpleNamespace(progress=100.0),
    )
    monkeypatch.setattr(
        streaming_api.torrent_manager, "prioritize_video_files",
        lambda *a, **k: True,
    )
    # Not in active_torrents -> stream_file_range takes the disk-fallback path
    # (still async, still off-loop reads).
    streaming_api.torrent_manager.active_torrents.pop("tid-async", None)
    return data


def test_async_generator_streams_range(stub):
    r = client.get(
        "/api/v1/streaming/tid-async/video",
        headers={"Range": "bytes=100-299"},
    )
    assert r.status_code == 206
    assert r.headers["Content-Range"] == "bytes 100-299/1024"
    assert r.content == stub[100:300]


def test_async_generator_full_when_no_range(stub):
    r = client.get("/api/v1/streaming/tid-async/video")
    assert r.status_code in (200, 206)
    assert r.content == stub
```

- [ ] **Step 2: Run it, expect PASS.** No production change — this is the green-state pin. If it FAILs with `404`, the route prefix differs; adjust the URL to the prefix the run reports (it must match the prefix W3's `test_streaming_endpoint_416.py` used).
```bash
docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest tests/test_async_stream_endpoint.py -v
```
Expected: PASS — 2 passed.

- [ ] **Step 3: Run the entire backend suite to confirm no cross-module regression from the async conversion.**
```bash
docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest -q
```
Expected: PASS — whole suite green (notably `test_torrents_manager.py`, `test_torrents_api.py`, `test_streaming_pieces.py`, `test_stream_no_garbage.py`, the four new W4 files).

- [ ] **Step 4: Commit.**
```bash
git add backend/tests/test_async_stream_endpoint.py
git commit -m "test(streaming): pin endpoint streams through async stream_file_range

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Workstream W5: Session tuning + active-download queue (ARM-profiled)

This workstream addresses F5 (untuned libtorrent session, tracker errors never re-announced) and F7 (active-download cap counted but never enforced). It adds config-driven `lt_*` tuning fields plus a build-agnostic `config.lt_settings()` assembler (ARM vs x86 profiles), applies it via `session.apply_settings()` at startup, enforces the active-download cap through libtorrent's own queue (`auto_managed=True` + `active_downloads`) with a force-start override for the actively-streamed torrent, sets per-torrent connection caps via `handle.set_max_connections()`, and schedules backed-off tracker recovery on `tracker_error_alert`.

W5 lands AFTER W1 and W3. The baseline `backend/app/torrent/manager.py` is the post-W3 file (W3 added `_pieces_ready`, `_adaptive_piece_timeout`, the sync `stream_file_range`, and the streaming-endpoint 416/file_index branches). **W5 does NOT re-add `min_seeds`/`healthy_seeds`** (W1 owns them in `config.py`) and **does NOT convert `stream_file_range` to async** (W4 owns that, last). W5 may READ `settings.min_seeds`/`healthy_seeds` but adds only `lt_*` fields and `lt_settings()`.

All backend test-run commands use the mount form from CLAUDE.md so new/edited tests run without a rebuild. Container workdir is `/opt/freeflix`; tests live at `/opt/freeflix/tests`. The `lt_settings()` unit test is **build-agnostic by design** — it asserts dict assembly + unknown-key filtering, never the live `apply_settings()` result.

---

### Task W5.1: Read the container libtorrent version (grounding, MANDATORY first)

**Files:** none (investigation only — records the setting-name surface the rest of W5 guards against).

**Interfaces:**
- Consumes: nothing.
- Produces: nothing (a recorded fact: the running `lt.version` and which `settings_pack` keys exist, used to author the `_KNOWN_LT_SETTINGS` guard in W5.2).

Steps:

- [ ] **Step 1: Print the libtorrent version baked into the backend image.**
```bash
docker compose run --rm backend python -c "import libtorrent as lt; print('lt.version=', lt.version)"
```
Expected: a version string is printed (e.g. `lt.version= 2.0.x`). Record the major version: **2.x has no per-torrent `connections_limit` key inside `settings_pack`** — per-torrent caps must go through `handle.set_max_connections(n)` (W5.5), NOT a `settings_pack` key.

- [ ] **Step 2: Enumerate the valid `settings_pack` key names in this exact build** (this set is the authoritative filter — any key W5 assembles that is NOT in here gets dropped at apply time).
```bash
docker compose run --rm backend python -c "import libtorrent as lt; d=lt.default_settings(); print(len(d), 'keys'); [print(k) for k in sorted(d) if any(t in k for t in ('connection','peer','timeout','piece','partial','end_game','suggest','buffer','aio','active_'))]"
```
Expected: prints the subset of tuning-relevant keys present in THIS build (e.g. `connections_limit`, `active_downloads`, `active_limit`, `peer_connect_timeout`, `request_timeout`, `piece_timeout`, `prioritize_partial_pieces`, `strict_end_game_mode`, `suggest_mode`, `send_buffer_watermark`, `recv_buffer_watermark`, `aio_threads`, …). Note any of the W5.2 target keys that are **absent** in this build — the unknown-key filter (W5.2/W5.3) must drop them silently. No code is written in this task; it only confirms the names the assembler will be filtered against.

- [ ] **Step 3: Commit the grounding note** (empty marker so the sequence has a checkpoint; no file changes).
```bash
git commit --allow-empty -m "chore(torrent): record container libtorrent version before session tuning"
```

---

### Task W5.2: Config `lt_*` tuning fields + `lt_settings()` assembler (ARM vs x86, unknown-key filtered)

**Files:**
- Modify: `backend/app/config.py` (add `lt_*` fields after `cache_movies_for`/`min_seeds`/`healthy_seeds` block which W1 inserted, and add `lt_settings()` method after `effective_max_active_downloads`, currently `backend/app/config.py:85-90`)
- Test: `backend/tests/test_lt_settings.py` (create)

**Interfaces:**
- Consumes: `settings.effective_max_active_downloads() -> int` (existing, `config.py:85`). Does NOT consume `min_seeds`/`healthy_seeds`.
- Produces:
  - New `Settings` fields (all config-driven, defaults below): `lt_connections_limit_arm: int = 80`, `lt_connections_limit_x86: int = 300`, `lt_per_torrent_connections_arm: int = 40`, `lt_per_torrent_connections_x86: int = 120`, `lt_peer_connect_timeout: int = 8`, `lt_request_timeout: int = 10`, `lt_piece_timeout: int = 20`, `lt_aio_threads_arm: int = 2`, `lt_aio_threads_x86: int = 8`, `lt_send_buffer_watermark: int = 1048576`, `lt_recv_buffer_watermark: int = 1048576`.
  - `def lt_settings(self) -> dict` — assembles the full intended settings dict (ARM vs x86 profile chosen by `platform.machine()`), then **filters to keys valid in the running libtorrent build** via `lt.default_settings()`. Returns only known keys. `active_downloads`/`active_limit` are aligned with `effective_max_active_downloads()`.
  - `def lt_per_torrent_connections(self) -> int` — the per-torrent connection cap for the current arch (used by W5.5 via `handle.set_max_connections`, NOT a settings_pack key).

Steps:

- [ ] **Step 1: Write the failing test.** Create `backend/tests/test_lt_settings.py`:
```python
import platform
import libtorrent as lt
from app.config import settings, Settings


def test_lt_settings_returns_dict_of_known_keys_only():
    out = settings.lt_settings()
    assert isinstance(out, dict)
    valid = set(lt.default_settings().keys())
    # Every assembled key must be valid in THIS libtorrent build (unknown keys filtered).
    assert set(out).issubset(valid), f"unknown keys leaked: {set(out) - valid}"


def test_lt_settings_filters_an_injected_unknown_key():
    # The assembler must drop any key not present in the running build.
    out = Settings()._assemble_lt_settings({"definitely_not_a_real_lt_key_xyz": 1,
                                            "active_downloads": 2})
    assert "definitely_not_a_real_lt_key_xyz" not in out
    assert out.get("active_downloads") == 2


def test_lt_settings_active_downloads_tracks_effective_cap():
    out = settings.lt_settings()
    # active_downloads is only present if the build supports it; when present it equals the cap.
    if "active_downloads" in out:
        assert out["active_downloads"] == settings.effective_max_active_downloads()


def test_lt_settings_arm_profile_lowers_connection_limit():
    s = Settings()
    arm = s._profile_settings(is_arm=True)
    x86 = s._profile_settings(is_arm=False)
    assert arm["connections_limit"] < x86["connections_limit"]
    assert arm["aio_threads"] <= x86["aio_threads"]


def test_lt_per_torrent_connections_is_positive_int():
    assert isinstance(settings.lt_per_torrent_connections(), int)
    assert settings.lt_per_torrent_connections() > 0


def test_lt_settings_includes_tuning_keys_when_supported():
    out = settings.lt_settings()
    valid = set(lt.default_settings().keys())
    # For any tuning key supported by this build, the assembler must have set it.
    for k in ("peer_connect_timeout", "request_timeout", "piece_timeout",
              "prioritize_partial_pieces", "strict_end_game_mode"):
        if k in valid:
            assert k in out
```

- [ ] **Step 2: Run the test — expect FAIL.** Fails with `AttributeError: 'Settings' object has no attribute 'lt_settings'`.
```bash
docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest tests/test_lt_settings.py -v
```

- [ ] **Step 3: Add the `lt_*` fields.** In `backend/app/config.py`, the current snippet (after W1 landed) is:
```python
    # Torrent selection: swarm-health thresholds (seeders).
    # dead   = seeds < min_seeds
    # low    = seeds < healthy_seeds
    # healthy = seeds >= healthy_seeds
    min_seeds: int = 1
    healthy_seeds: int = 5
```
Insert directly after it (before the `effective_max_active_downloads` method):
```python

    # libtorrent session tuning (WS5). Profiles are arch-selected at runtime by
    # lt_settings(); unknown keys are filtered against the running build so a
    # version drift never raises. ARM (Raspberry Pi) gets conservative limits.
    lt_connections_limit_arm: int = 80
    lt_connections_limit_x86: int = 300
    lt_per_torrent_connections_arm: int = 40
    lt_per_torrent_connections_x86: int = 120
    lt_peer_connect_timeout: int = 8     # seconds to wait for a peer handshake
    lt_request_timeout: int = 10         # seconds before re-requesting a block
    lt_piece_timeout: int = 20           # seconds before timing out a piece request
    lt_aio_threads_arm: int = 2
    lt_aio_threads_x86: int = 8
    lt_send_buffer_watermark: int = 1048576   # 1 MiB
    lt_recv_buffer_watermark: int = 1048576   # 1 MiB
```

- [ ] **Step 4: Add the assembler methods.** In `backend/app/config.py`, the current method is:
```python
    def effective_max_active_downloads(self) -> int:
        """Configured concurrent-download ceiling, capped to 2 on ARM (Raspberry Pi)."""
        import platform
        if "arm" in platform.machine().lower():
            return min(self.max_active_downloads, 2)
        return self.max_active_downloads
```
Insert directly after it (before `initialize`):
```python

    def _is_arm(self) -> bool:
        import platform
        return "arm" in platform.machine().lower() or "aarch" in platform.machine().lower()

    def lt_per_torrent_connections(self) -> int:
        """Per-torrent connection cap for the current arch. Applied via
        handle.set_max_connections() in the manager — NOT a settings_pack key
        (libtorrent 2.x has no per-torrent connections key in settings_pack)."""
        return (self.lt_per_torrent_connections_arm if self._is_arm()
                else self.lt_per_torrent_connections_x86)

    def _profile_settings(self, *, is_arm: bool) -> dict:
        """The full INTENDED settings dict for a profile, before unknown-key
        filtering. Pure/deterministic so it is unit-testable per arch."""
        cap = self.effective_max_active_downloads()
        return {
            "connections_limit": (self.lt_connections_limit_arm if is_arm
                                  else self.lt_connections_limit_x86),
            "active_downloads": cap,
            "active_limit": max(cap * 2, cap + 4),
            "peer_connect_timeout": self.lt_peer_connect_timeout,
            "request_timeout": self.lt_request_timeout,
            "piece_timeout": self.lt_piece_timeout,
            "prioritize_partial_pieces": True,
            "strict_end_game_mode": True,
            "suggest_mode": lt.suggest_mode_t.suggest_read_cache,
            "send_buffer_watermark": self.lt_send_buffer_watermark,
            "recv_buffer_watermark": self.lt_recv_buffer_watermark,
            "aio_threads": (self.lt_aio_threads_arm if is_arm
                            else self.lt_aio_threads_x86),
        }

    def _assemble_lt_settings(self, intended: dict) -> dict:
        """Drop any key not present in the running libtorrent build (version-safe)."""
        valid = set(lt.default_settings().keys())
        return {k: v for k, v in intended.items() if k in valid}

    def lt_settings(self) -> dict:
        """Arch-profiled libtorrent settings_pack, filtered to keys valid in the
        running build. Safe to pass straight to session.apply_settings()."""
        return self._assemble_lt_settings(self._profile_settings(is_arm=self._is_arm()))
```

- [ ] **Step 5: Add the `libtorrent` import.** In `backend/app/config.py`, the current top import block is:
```python
import os
from typing import Optional, Union
from pathlib import Path
```
Replace it with:
```python
import os
import libtorrent as lt
from typing import Optional, Union
from pathlib import Path
```
(`suggest_mode_t.suggest_read_cache` and `default_settings()` both come from this import; if a future build lacks `suggest_mode_t`, the key is still filtered out by `_assemble_lt_settings`, but the attribute access in `_profile_settings` would raise — guarded in Step 6.)

- [ ] **Step 6: Guard the `suggest_mode` attribute** so an exotic build that lacks `suggest_mode_t` cannot raise inside `_profile_settings`. In `backend/app/config.py`, the line just added is:
```python
            "suggest_mode": lt.suggest_mode_t.suggest_read_cache,
```
Replace it with:
```python
            "suggest_mode": getattr(getattr(lt, "suggest_mode_t", None),
                                    "suggest_read_cache", 1),
```
(`1` is the historical integer for `suggest_read_cache`; if `suggest_mode` itself is an unknown key in the build it is still dropped by `_assemble_lt_settings`.)

- [ ] **Step 7: Run the test — expect PASS.**
```bash
docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest tests/test_lt_settings.py -v
```

- [ ] **Step 8: Commit.**
```bash
git add backend/app/config.py backend/tests/test_lt_settings.py
git commit -m "feat(config): lt_settings() ARM/x86 profiles with unknown-key filtering"
```

---

### Task W5.3: Apply session settings at manager init

**Files:**
- Modify: `backend/app/torrent/manager.py` (`TorrentManager.__init__`, the `self.session = lt.session({...})` block at `backend/app/torrent/manager.py:43-55`)
- Test: `backend/tests/test_session_tuning.py` (create)

**Interfaces:**
- Consumes: `settings.lt_settings() -> dict` (W5.2).
- Produces: `def _apply_session_tuning(self) -> None` on `TorrentManager` — calls `self.session.apply_settings(settings.lt_settings())`, logging and swallowing any error so a bad setting never blocks startup. Called once from `__init__` after the session is constructed.

Steps:

- [ ] **Step 1: Write the failing test.** Create `backend/tests/test_session_tuning.py`:
```python
import types
import app.torrent.manager as mgr


def test_apply_session_tuning_calls_apply_settings(monkeypatch):
    captured = {}

    class FakeSession:
        def apply_settings(self, d):
            captured["dict"] = d

    inst = mgr.TorrentManager.__new__(mgr.TorrentManager)  # no __init__ side effects
    inst.session = FakeSession()
    inst._apply_session_tuning()

    assert "dict" in captured
    assert isinstance(captured["dict"], dict)


def test_apply_session_tuning_swallows_errors(monkeypatch):
    class BoomSession:
        def apply_settings(self, d):
            raise RuntimeError("bad key")

    inst = mgr.TorrentManager.__new__(mgr.TorrentManager)
    inst.session = BoomSession()
    # Must not raise — a bad setting cannot block startup.
    inst._apply_session_tuning()
```

- [ ] **Step 2: Run the test — expect FAIL.** Fails with `AttributeError: type object 'TorrentManager' has no attribute '_apply_session_tuning'` (or instance has no such method).
```bash
docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest tests/test_session_tuning.py -v
```

- [ ] **Step 3: Add the method + call it from `__init__`.** In `backend/app/torrent/manager.py`, the current end of the session-construction block is:
```python
        self.session.add_dht_router("router.bittorrent.com", 6881)
        self.session.add_dht_router("router.utorrent.com", 6881)
        self.session.add_dht_router("dht.transmissionbt.com", 6881)
        
        # Try to load the resume data
        settings.resume_data_path.mkdir(parents=True, exist_ok=True)
```
Replace it with:
```python
        self.session.add_dht_router("router.bittorrent.com", 6881)
        self.session.add_dht_router("router.utorrent.com", 6881)
        self.session.add_dht_router("dht.transmissionbt.com", 6881)

        # Apply arch-profiled libtorrent tuning (WS5). Unknown keys are already
        # filtered by config.lt_settings(); this also swallows apply errors.
        self._apply_session_tuning()

        # Try to load the resume data
        settings.resume_data_path.mkdir(parents=True, exist_ok=True)
```

- [ ] **Step 4: Add the `_apply_session_tuning` method.** In `backend/app/torrent/manager.py`, the current `_load_saved_torrents` definition begins:
```python
    def _load_saved_torrents(self):
        """Load previously active torrents from the database"""
```
Insert directly above it:
```python
    def _apply_session_tuning(self):
        """Apply the arch-profiled settings_pack to the live session. Errors are
        logged and swallowed so a single unsupported key never blocks startup."""
        try:
            pack = settings.lt_settings()
            self.session.apply_settings(pack)
            logger.info(f"Applied libtorrent session tuning ({len(pack)} keys)")
        except Exception as e:
            logger.warning(f"Failed to apply session tuning (continuing): {e}")

    def _load_saved_torrents(self):
        """Load previously active torrents from the database"""
```

- [ ] **Step 5: Run the test — expect PASS.**
```bash
docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest tests/test_session_tuning.py -v
```

- [ ] **Step 6: Commit.**
```bash
git add backend/app/torrent/manager.py backend/tests/test_session_tuning.py
git commit -m "feat(torrent): apply arch-profiled libtorrent settings at session init"
```

---

### Task W5.4: Active-download queue — auto_managed at add, force-start on stream

**Files:**
- Modify: `backend/app/torrent/manager.py` (`_add_torrent`, the `handle = self.session.add_torrent(atp)` block at `backend/app/torrent/manager.py:124-127`; and add `force_start_for_stream` / `release_stream_force_start` methods)
- Test: `backend/tests/test_active_queue.py` (create)

**Interfaces:**
- Consumes: `self.active_torrents` dict, `self.session`, `lt` handle API (`set_flags`/`unset_flags`/`flags`/`resume`/`pause`).
- Produces:
  - `_add_torrent` sets the new handle **auto-managed** so libtorrent's queue enforces `active_downloads` (the cap from W5.2). A version-safe helper sets the flag.
  - `def _set_auto_managed(self, handle, value: bool) -> None` — flag set via `handle.set_flags`/`handle.unset_flags` using `lt.torrent_flags.auto_managed`, guarded for builds lacking the flag.
  - `def force_start_for_stream(self, torrent_id: str) -> bool` — `auto_managed=False` + `handle.resume()` so the queue never pauses the actively-streamed torrent. Returns `True` if applied.
  - `def release_stream_force_start(self, torrent_id: str) -> bool` — reverts to `auto_managed=True` (queue resumes managing it). Called on stream end/complete.

Steps:

- [ ] **Step 1: Write the failing test.** Create `backend/tests/test_active_queue.py`:
```python
import app.torrent.manager as mgr


class FakeHandle:
    def __init__(self):
        self.flags_set = []
        self.flags_unset = []
        self.resumed = False

    def set_flags(self, f):
        self.flags_set.append(f)

    def unset_flags(self, f):
        self.flags_unset.append(f)

    def resume(self):
        self.resumed = True


def _mgr_with(torrent_id, handle):
    inst = mgr.TorrentManager.__new__(mgr.TorrentManager)
    inst.active_torrents = {torrent_id: (handle, {})}
    return inst


def test_set_auto_managed_true_sets_flag():
    h = FakeHandle()
    inst = _mgr_with("t1", h)
    inst._set_auto_managed(h, True)
    assert h.flags_set and not h.flags_unset


def test_set_auto_managed_false_unsets_flag():
    h = FakeHandle()
    inst = _mgr_with("t1", h)
    inst._set_auto_managed(h, False)
    assert h.flags_unset and not h.flags_set


def test_force_start_unsets_auto_managed_and_resumes():
    h = FakeHandle()
    inst = _mgr_with("t1", h)
    assert inst.force_start_for_stream("t1") is True
    assert h.flags_unset  # auto_managed removed
    assert h.resumed is True


def test_force_start_unknown_torrent_returns_false():
    inst = _mgr_with("t1", FakeHandle())
    assert inst.force_start_for_stream("nope") is False


def test_release_reverts_to_auto_managed():
    h = FakeHandle()
    inst = _mgr_with("t1", h)
    assert inst.release_stream_force_start("t1") is True
    assert h.flags_set  # auto_managed restored
```

- [ ] **Step 2: Run the test — expect FAIL.** Fails with `AttributeError: 'TorrentManager' object has no attribute '_set_auto_managed'`.
```bash
docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest tests/test_active_queue.py -v
```

- [ ] **Step 3: Make `_add_torrent` add torrents auto-managed.** In `backend/app/torrent/manager.py`, the current tail of `_add_torrent` is:
```python
            handle = self.session.add_torrent(atp)
            handle.set_sequential_download(True)
            self.active_torrents[torrent_id] = (handle, metadata)
            return handle
```
Replace it with:
```python
            handle = self.session.add_torrent(atp)
            handle.set_sequential_download(True)
            # Auto-managed so libtorrent's own queue enforces active_downloads
            # (the effective cap). The actively-streamed torrent is force-started
            # out of the queue separately (force_start_for_stream).
            self._set_auto_managed(handle, True)
            # Per-torrent connection cap (lt 2.x has no settings_pack key for this).
            try:
                handle.set_max_connections(settings.lt_per_torrent_connections())
            except Exception as e:
                logger.debug(f"set_max_connections skipped for {torrent_id}: {e}")
            self.active_torrents[torrent_id] = (handle, metadata)
            return handle
```

- [ ] **Step 4: Add the three queue methods.** In `backend/app/torrent/manager.py`, insert directly above the `_apply_session_tuning` method added in W5.3 (so all session/queue helpers sit together):
```python
    def _set_auto_managed(self, handle, value: bool) -> None:
        """Toggle libtorrent's auto_managed flag (version-safe). When True the
        torrent is subject to the active_downloads queue; when False it is
        force-started/pinned by the caller."""
        try:
            flag = lt.torrent_flags.auto_managed
        except Exception:
            return  # build lacks the flag enum; nothing to toggle
        try:
            if value:
                handle.set_flags(flag)
            else:
                handle.unset_flags(flag)
        except Exception as e:
            logger.debug(f"auto_managed toggle failed: {e}")

    def force_start_for_stream(self, torrent_id: str) -> bool:
        """Pin the actively-streamed torrent out of the auto-managed queue so it
        is never paused while the user is watching (auto_managed=False + resume)."""
        entry = self.active_torrents.get(torrent_id)
        if not entry:
            return False
        handle, _ = entry
        self._set_auto_managed(handle, False)
        try:
            handle.resume()
        except Exception as e:
            logger.debug(f"resume on force-start failed for {torrent_id}: {e}")
        logger.info(f"Force-started {torrent_id} for streaming (out of queue)")
        return True

    def release_stream_force_start(self, torrent_id: str) -> bool:
        """Revert a force-started torrent back to auto-managed (re-enters the
        queue). Called on stream end / completion."""
        entry = self.active_torrents.get(torrent_id)
        if not entry:
            return False
        handle, _ = entry
        self._set_auto_managed(handle, True)
        logger.info(f"Released force-start for {torrent_id} (back to auto-managed)")
        return True

```

- [ ] **Step 5: Run the test — expect PASS.**
```bash
docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest tests/test_active_queue.py -v
```

- [ ] **Step 6: Run the existing manager test to confirm no regression** (`_add_torrent` signature/behavior changed).
```bash
docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest tests/test_active_queue.py tests/test_session_tuning.py tests/test_torrents_manager.py -v
```

- [ ] **Step 7: Commit.**
```bash
git add backend/app/torrent/manager.py backend/tests/test_active_queue.py
git commit -m "feat(torrent): auto-managed active-download queue with stream force-start"
```

---

### Task W5.5: Per-torrent connection cap on resumed/loaded handles

**Files:**
- Modify: `backend/app/torrent/manager.py` (`prioritize_video_files`, the `handle.set_sequential_download(True)` line at `backend/app/torrent/manager.py:951`)
- Test: `backend/tests/test_per_torrent_conn_cap.py` (create)

**Interfaces:**
- Consumes: `settings.lt_per_torrent_connections() -> int` (W5.2).
- Produces: `prioritize_video_files` also re-applies `handle.set_max_connections(settings.lt_per_torrent_connections())` so torrents resumed from disk (which skip the `_add_torrent` add path's cap) still get the per-torrent cap when streaming begins. Guarded so an unsupported handle method never breaks prioritization.

Steps:

- [ ] **Step 1: Write the failing test.** Create `backend/tests/test_per_torrent_conn_cap.py`:
```python
import app.torrent.manager as mgr
from app.config import settings


class FakeInfo:
    def num_files(self):
        return 0


class FakeHandle:
    def __init__(self):
        self.max_conn = None
        self.seq = None

    def has_metadata(self):
        return True

    def set_sequential_download(self, v):
        self.seq = v

    def get_torrent_info(self):
        return FakeInfo()

    def prioritize_files(self, prios):
        pass

    def set_max_connections(self, n):
        self.max_conn = n


def test_prioritize_applies_per_torrent_connection_cap():
    h = FakeHandle()
    inst = mgr.TorrentManager.__new__(mgr.TorrentManager)
    inst.active_torrents = {"t1": (h, {})}
    inst.prioritize_video_files("t1")
    assert h.max_conn == settings.lt_per_torrent_connections()
```

- [ ] **Step 2: Run the test — expect FAIL.** `assert None == <int>` because `prioritize_video_files` does not yet set `max_connections`.
```bash
docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest tests/test_per_torrent_conn_cap.py -v
```

- [ ] **Step 3: Apply the cap in `prioritize_video_files`.** In `backend/app/torrent/manager.py`, the current snippet inside the `try:` is:
```python
        try:
            # Enable sequential download
            handle.set_sequential_download(True)
            
            # Find video files and set their priorities
            torrent_info = handle.get_torrent_info()
```
Replace it with:
```python
        try:
            # Enable sequential download
            handle.set_sequential_download(True)

            # Re-apply the per-torrent connection cap. Torrents resumed from disk
            # bypass _add_torrent's cap, so set it here when streaming begins.
            try:
                handle.set_max_connections(settings.lt_per_torrent_connections())
            except Exception as e:
                logger.debug(f"set_max_connections skipped for {torrent_id}: {e}")

            # Find video files and set their priorities
            torrent_info = handle.get_torrent_info()
```

- [ ] **Step 4: Run the test — expect PASS.**
```bash
docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest tests/test_per_torrent_conn_cap.py -v
```

- [ ] **Step 5: Commit.**
```bash
git add backend/app/torrent/manager.py backend/tests/test_per_torrent_conn_cap.py
git commit -m "feat(torrent): apply per-torrent connection cap on stream prioritization"
```

---

### Task W5.6: Wire force-start into the streaming endpoint

**Files:**
- Modify: `backend/app/api/streaming.py` (`stream_video`, the prioritization block at `backend/app/api/streaming.py:89-91`)
- Test: `backend/tests/test_stream_force_start.py` (create)

**Interfaces:**
- Consumes: `torrent_manager.force_start_for_stream(torrent_id) -> bool` (W5.4), `torrent_manager.get_torrent_status`, `torrent_manager.get_video_file_info`, `torrent_manager.prioritize_video_files`, `torrent_manager.stream_file_range` (W3 sync generator).
- Produces: when a stream starts on an in-progress torrent, `stream_video` calls `force_start_for_stream(torrent_id)` alongside `prioritize_video_files`, pinning the streamed torrent out of the auto-managed queue. (Revert on stream-end is handled by W5.7's completion hook + the existing `torrent_finished_alert`; an in-flight HTTP range request is short-lived, so the page-driven poll re-pins on the next range request — no explicit teardown in the request handler, which would otherwise un-pin between byte-range requests.)

Steps:

- [ ] **Step 1: Write the failing test.** Create `backend/tests/test_stream_force_start.py`:
```python
import os
os.environ.setdefault("DB_PATH", "/tmp/test_stream_force_start.db")

import types
import pytest
from fastapi.testclient import TestClient

import app.api.streaming as streaming_api
from app.main import app


@pytest.fixture()
def client(monkeypatch, tmp_path):
    f = tmp_path / "v.mp4"
    f.write_bytes(b"0" * 2048)
    state = types.SimpleNamespace(forced=[])

    monkeypatch.setattr(streaming_api.torrent_manager, "get_video_file_info",
                        lambda tid, fi=None: {"index": 0, "path": str(f)})

    def fake_status(tid):
        return types.SimpleNamespace(progress=10.0)
    monkeypatch.setattr(streaming_api.torrent_manager, "get_torrent_status", fake_status)
    monkeypatch.setattr(streaming_api.torrent_manager, "prioritize_video_files",
                        lambda tid, file_index=None: True)

    def fake_force(tid):
        state.forced.append(tid)
        return True
    monkeypatch.setattr(streaming_api.torrent_manager, "force_start_for_stream", fake_force)

    def fake_stream(tid, idx, path, start, end, chunk_size=1024 * 1024, **kw):
        yield b"0" * (end - start + 1)
    monkeypatch.setattr(streaming_api.torrent_manager, "stream_file_range", fake_stream)

    with TestClient(app) as c:
        c.state = state
        yield c


def test_stream_force_starts_in_progress_torrent(client):
    r = client.get("/api/v1/streaming/tid-1/video",
                   headers={"Range": "bytes=0-1023"})
    assert r.status_code in (200, 206)
    assert client.state.forced == ["tid-1"]
```

- [ ] **Step 2: Run the test — expect FAIL.** `assert [] == ['tid-1']` — `force_start_for_stream` is never called.
```bash
docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest tests/test_stream_force_start.py -v
```

- [ ] **Step 3: Call `force_start_for_stream` on stream start.** In `backend/app/api/streaming.py`, the current block is:
```python
        # Prioritize the file for streaming if it's still downloading
        torrent_status = torrent_manager.get_torrent_status(torrent_id)
        if torrent_status and torrent_status.progress < 100:
            torrent_manager.prioritize_video_files(torrent_id, file_index=video_info["index"])
```
Replace it with:
```python
        # Prioritize the file for streaming if it's still downloading, and pin it
        # out of the auto-managed queue so the active stream is never paused (WS5).
        torrent_status = torrent_manager.get_torrent_status(torrent_id)
        if torrent_status and torrent_status.progress < 100:
            torrent_manager.prioritize_video_files(torrent_id, file_index=video_info["index"])
            torrent_manager.force_start_for_stream(torrent_id)
```

- [ ] **Step 4: Run the test — expect PASS.**
```bash
docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest tests/test_stream_force_start.py -v
```

- [ ] **Step 5: Commit.**
```bash
git add backend/app/api/streaming.py backend/tests/test_stream_force_start.py
git commit -m "feat(streaming): pin actively-streamed torrent out of the download queue"
```

---

### Task W5.7: Revert force-start on completion (`torrent_finished_alert`)

**Files:**
- Modify: `backend/app/torrent/manager.py` (`_handle_alert`, the `torrent_finished_alert` branch at `backend/app/torrent/manager.py:337-358`)
- Test: `backend/tests/test_force_start_release_on_finish.py` (create)

**Interfaces:**
- Consumes: `self.release_stream_force_start(torrent_id) -> bool` (W5.4).
- Produces: on `torrent_finished_alert`, after marking the torrent `finished`, `_handle_alert` reverts the force-start so the completed torrent re-enters auto-management (it no longer needs the pin; seeding/queue scheduling resumes).

Steps:

- [ ] **Step 1: Write the failing test.** Create `backend/tests/test_force_start_release_on_finish.py`:
```python
import types
import app.torrent.manager as mgr


class FakeHandle:
    pass


def test_finish_alert_releases_force_start(monkeypatch):
    h = FakeHandle()
    inst = mgr.TorrentManager.__new__(mgr.TorrentManager)
    inst.active_torrents = {"t1": (h, {})}

    released = []
    inst.release_stream_force_start = lambda tid: released.append(tid) or True

    # No DB writes in this unit test: stub get_db to a no-op context manager.
    class _NoDb:
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def query(self, *a, **k): return self
        def filter(self, *a, **k): return self
        def first(self): return None
        def add(self, *a, **k): pass
        def commit(self): pass
    monkeypatch.setattr(mgr, "get_db", lambda: _NoDb())

    alert = types.SimpleNamespace(handle=h)
    # Make isinstance(alert, lt.torrent_finished_alert) True via the type the code checks.
    monkeypatch.setattr(mgr.lt, "torrent_finished_alert", types.SimpleNamespace)

    inst._handle_alert(alert)
    assert released == ["t1"]
```

- [ ] **Step 2: Run the test — expect FAIL.** `assert [] == ['t1']` — the finish branch does not yet release the force-start.
```bash
docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest tests/test_force_start_release_on_finish.py -v
```

- [ ] **Step 3: Release on finish.** In `backend/app/torrent/manager.py`, the current finish branch is:
```python
            if isinstance(alert, lt.torrent_finished_alert):
                torrent_handle = alert.handle
                # Find the torrent_id for this handle
                for torrent_id, (handle, _) in self.active_torrents.items():
                    if handle == torrent_handle:
                        logger.info(f"Torrent {torrent_id} finished downloading")
                        # Use a new session for database operations
                        with get_db() as db:
                            torrent: DbTorrent = db.query(DbTorrent).filter(DbTorrent.id == torrent_id).first()
                            if torrent:
                                torrent.state = 'finished'
                                # Log completion
                                log = TorrentLog(
                                    torrent_id=torrent_id,
                                    message="Download completed",
                                    level="INFO",
                                    state='finished',
                                    progress=100.0
                                )
                                db.add(log)
                                db.commit()
                        break
```
Replace it with:
```python
            if isinstance(alert, lt.torrent_finished_alert):
                torrent_handle = alert.handle
                # Find the torrent_id for this handle
                for torrent_id, (handle, _) in self.active_torrents.items():
                    if handle == torrent_handle:
                        logger.info(f"Torrent {torrent_id} finished downloading")
                        # Completed torrent no longer needs the streaming pin —
                        # return it to the auto-managed queue (WS5).
                        self.release_stream_force_start(torrent_id)
                        # Use a new session for database operations
                        with get_db() as db:
                            torrent: DbTorrent = db.query(DbTorrent).filter(DbTorrent.id == torrent_id).first()
                            if torrent:
                                torrent.state = 'finished'
                                # Log completion
                                log = TorrentLog(
                                    torrent_id=torrent_id,
                                    message="Download completed",
                                    level="INFO",
                                    state='finished',
                                    progress=100.0
                                )
                                db.add(log)
                                db.commit()
                        break
```

- [ ] **Step 4: Run the test — expect PASS.**
```bash
docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest tests/test_force_start_release_on_finish.py -v
```

- [ ] **Step 5: Commit.**
```bash
git add backend/app/torrent/manager.py backend/tests/test_force_start_release_on_finish.py
git commit -m "feat(torrent): release stream force-start when a torrent completes"
```

---

### Task W5.8: Backed-off tracker recovery on `tracker_error_alert`

**Files:**
- Modify: `backend/app/torrent/manager.py` (`_handle_alert`, the `tracker_error_alert` branch at `backend/app/torrent/manager.py:465-483`; add a `_tracker_recovery` registry init in `__init__` near `self.active_torrents` at `:65`, and a `_schedule_tracker_recovery` method)
- Test: `backend/tests/test_tracker_recovery.py` (create)

**Interfaces:**
- Consumes: `handle.force_reannounce()`, `handle.force_dht_announce()`, `time.time()` (already imported, `manager.py:3`).
- Produces:
  - `self._tracker_recovery: Dict[str, dict]` per-torrent state `{ "attempts": int, "next_at": float }` (initialized in `__init__`).
  - `def _schedule_tracker_recovery(self, torrent_id: str, handle) -> None` — exponential backoff (base 15s, doubling, capped at 300s, max 5 attempts within a window). When the backoff window has elapsed it calls `handle.force_reannounce()` + `handle.force_dht_announce()` (each guarded) and advances the schedule; otherwise it is a no-op until `next_at`.
  - The `tracker_error_alert` branch invokes `_schedule_tracker_recovery` (in addition to the existing logging).

Steps:

- [ ] **Step 1: Write the failing test.** Create `backend/tests/test_tracker_recovery.py`:
```python
import app.torrent.manager as mgr


class FakeHandle:
    def __init__(self):
        self.reannounced = 0
        self.dht = 0

    def force_reannounce(self):
        self.reannounced += 1

    def force_dht_announce(self):
        self.dht += 1


def _inst(torrent_id, handle):
    inst = mgr.TorrentManager.__new__(mgr.TorrentManager)
    inst.active_torrents = {torrent_id: (handle, {})}
    inst._tracker_recovery = {}
    return inst


def test_first_error_triggers_reannounce(monkeypatch):
    monkeypatch.setattr(mgr.time, "time", lambda: 1000.0)
    h = FakeHandle()
    inst = _inst("t1", h)
    inst._schedule_tracker_recovery("t1", h)
    assert h.reannounced == 1 and h.dht == 1
    assert inst._tracker_recovery["t1"]["attempts"] == 1


def test_second_error_within_backoff_is_suppressed(monkeypatch):
    t = {"now": 1000.0}
    monkeypatch.setattr(mgr.time, "time", lambda: t["now"])
    h = FakeHandle()
    inst = _inst("t1", h)
    inst._schedule_tracker_recovery("t1", h)   # fires (attempt 1), next_at = 1015
    t["now"] = 1005.0                            # still inside backoff window
    inst._schedule_tracker_recovery("t1", h)   # suppressed
    assert h.reannounced == 1


def test_error_after_backoff_fires_again(monkeypatch):
    t = {"now": 1000.0}
    monkeypatch.setattr(mgr.time, "time", lambda: t["now"])
    h = FakeHandle()
    inst = _inst("t1", h)
    inst._schedule_tracker_recovery("t1", h)   # attempt 1, next_at = 1015
    t["now"] = 1020.0                            # past next_at
    inst._schedule_tracker_recovery("t1", h)   # attempt 2
    assert h.reannounced == 2
    assert inst._tracker_recovery["t1"]["attempts"] == 2


def test_max_attempts_caps_reannounce(monkeypatch):
    t = {"now": 1000.0}
    monkeypatch.setattr(mgr.time, "time", lambda: t["now"])
    h = FakeHandle()
    inst = _inst("t1", h)
    for i in range(10):
        inst._schedule_tracker_recovery("t1", h)
        t["now"] += 1000.0  # always past backoff
    assert h.reannounced == 5  # capped at max attempts
```

- [ ] **Step 2: Run the test — expect FAIL.** Fails with `AttributeError: 'TorrentManager' object has no attribute '_schedule_tracker_recovery'`.
```bash
docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest tests/test_tracker_recovery.py -v
```

- [ ] **Step 3: Initialize the recovery registry in `__init__`.** In `backend/app/torrent/manager.py`, the current line is:
```python
        # Dictionary to store active torrents: {torrent_id: (handle, metadata)}
        self.active_torrents: Dict[str, Tuple[lt.torrent_handle, Dict[str, Any]]] = {}
```
Replace it with:
```python
        # Dictionary to store active torrents: {torrent_id: (handle, metadata)}
        self.active_torrents: Dict[str, Tuple[lt.torrent_handle, Dict[str, Any]]] = {}

        # Per-torrent tracker-recovery backoff: {torrent_id: {"attempts": int, "next_at": float}}
        self._tracker_recovery: Dict[str, Dict[str, Any]] = {}
```

- [ ] **Step 4: Add the `_schedule_tracker_recovery` method.** In `backend/app/torrent/manager.py`, insert directly above `_apply_session_tuning` (added in W5.3), so all session/queue/recovery helpers are grouped:
```python
    def _schedule_tracker_recovery(self, torrent_id: str, handle) -> None:
        """On a tracker error, force a re-announce (tracker + DHT) with exponential
        backoff (15s base, x2, cap 300s, max 5 attempts). No-op until the next
        scheduled time so a burst of tracker errors does not hammer announces."""
        base, cap, max_attempts = 15.0, 300.0, 5
        now = time.time()
        rec = self._tracker_recovery.get(torrent_id, {"attempts": 0, "next_at": 0.0})

        if rec["attempts"] >= max_attempts:
            return
        if now < rec["next_at"]:
            return

        try:
            handle.force_reannounce()
        except Exception as e:
            logger.debug(f"force_reannounce failed for {torrent_id}: {e}")
        try:
            handle.force_dht_announce()
        except Exception as e:
            logger.debug(f"force_dht_announce failed for {torrent_id}: {e}")

        rec["attempts"] += 1
        backoff = min(base * (2 ** (rec["attempts"] - 1)), cap)
        rec["next_at"] = now + backoff
        self._tracker_recovery[torrent_id] = rec
        logger.info(
            f"Tracker recovery for {torrent_id}: re-announce attempt "
            f"{rec['attempts']} (next in {backoff:.0f}s)"
        )

```

- [ ] **Step 5: Invoke it from the `tracker_error_alert` branch.** In `backend/app/torrent/manager.py`, the current branch is:
```python
            elif isinstance(alert, lt.tracker_error_alert):
                torrent_handle = alert.handle
                error_message = f"Tracker error: {alert.error_message()}"
                
                for torrent_id, (handle, _) in self.active_torrents.items():
                    if handle == torrent_handle:
                        logger.warning(f"Tracker error for torrent {torrent_id}: {error_message}")
                        # We don't update the torrent state just for tracker errors
                        # but we do log them for debugging purposes
                        with get_db() as db:
                            log = TorrentLog(
                                torrent_id=torrent_id,
                                message=error_message,
                                level="WARNING",
                                state=None  # Don't change state for tracker errors
                            )
                            db.add(log)
                            db.commit()
                        break
```
Replace it with:
```python
            elif isinstance(alert, lt.tracker_error_alert):
                torrent_handle = alert.handle
                error_message = f"Tracker error: {alert.error_message()}"
                
                for torrent_id, (handle, _) in self.active_torrents.items():
                    if handle == torrent_handle:
                        logger.warning(f"Tracker error for torrent {torrent_id}: {error_message}")
                        # Schedule a backed-off re-announce (tracker + DHT) so a
                        # transient tracker outage doesn't strand a low-seed swarm.
                        self._schedule_tracker_recovery(torrent_id, handle)
                        # We don't update the torrent state just for tracker errors
                        # but we do log them for debugging purposes
                        with get_db() as db:
                            log = TorrentLog(
                                torrent_id=torrent_id,
                                message=error_message,
                                level="WARNING",
                                state=None  # Don't change state for tracker errors
                            )
                            db.add(log)
                            db.commit()
                        break
```

- [ ] **Step 6: Run the test — expect PASS.**
```bash
docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest tests/test_tracker_recovery.py -v
```

- [ ] **Step 7: Commit.**
```bash
git add backend/app/torrent/manager.py backend/tests/test_tracker_recovery.py
git commit -m "feat(torrent): backed-off tracker+DHT re-announce on tracker errors"
```

---

### Task W5.9: Full W5 suite green sweep + image bake + manual cap verification

**Files:** none (verification only).

Steps:

- [ ] **Step 1: Rebuild the image so the new W5 test files are baked in** (dev override does not bind-mount `backend/tests`).
```bash
make build
```

- [ ] **Step 2: Run every W5 test through the standard baked-in runner — expect ALL PASS.**
```bash
docker compose run --rm backend python -m pytest \
  tests/test_lt_settings.py tests/test_session_tuning.py \
  tests/test_active_queue.py tests/test_per_torrent_conn_cap.py \
  tests/test_stream_force_start.py tests/test_force_start_release_on_finish.py \
  tests/test_tracker_recovery.py -v
```

- [ ] **Step 3: Run the broader manager/streaming/config suites to confirm no cross-module regression — expect PASS.**
```bash
docker compose run --rm backend python -m pytest \
  tests/test_torrents_manager.py tests/test_streaming_pieces.py \
  tests/test_selection_config.py -q
```

- [ ] **Step 4: Run the entire backend suite — expect PASS.**
```bash
docker compose run --rm backend python -m pytest -q
```

- [ ] **Step 5: Manual cap verification (the F7 acceptance check).** Start the stack and confirm libtorrent's queue enforces the cap rather than starving: a 3rd concurrent download QUEUES (does not run) on an ARM profile, and the actively-streamed torrent is never auto-paused.
```bash
make up d=1
docker compose logs -f backend | grep -E "Applied libtorrent session tuning|Force-started|back to auto-managed|Tracker recovery"
```
  Expected on startup: one `Applied libtorrent session tuning (N keys)` line. Then in the UI at `http://localhost:3001`: start three downloads in quick succession; query `http://localhost:8000/api/v1/activity/count` — `active_downloads` reflects running torrents and the cap (`max_active_downloads`) matches `effective_max_active_downloads()`. Confirm the 3rd torrent sits in `queued` (libtorrent-managed) while the first two download. Open one stream at `http://localhost:3001` and confirm a `Force-started <id> for streaming` log line; the streamed torrent must keep downloading (never flips to `queued`/paused) even with the queue full.

- [ ] **Step 6: Commit the green milestone** (no file change; marker for the sequence).
```bash
git commit --allow-empty -m "test(torrent): WS5 suite green (session tuning + active-download queue)"
```

---

**WS5 deliverables for downstream / operators:**
- `config.lt_settings() -> dict` (ARM vs x86 profiles, unknown-key filtered) + `config.lt_per_torrent_connections() -> int` — single source of libtorrent tuning; READ-only consumes `effective_max_active_downloads()`, does NOT touch `min_seeds`/`healthy_seeds` (W1-owned).
- `TorrentManager._apply_session_tuning()` applied once at session init.
- Active-download queue via libtorrent `auto_managed=True` + `active_downloads`; `force_start_for_stream(torrent_id)` / `release_stream_force_start(torrent_id)` pin/un-pin the streamed torrent; per-torrent caps via `handle.set_max_connections()` (no invalid `settings_pack` key — lt 2.x has no per-torrent connections key).
- `_schedule_tracker_recovery(torrent_id, handle)` — backed-off `force_reannounce()` + `force_dht_announce()` on `tracker_error_alert`.
- Does NOT convert `stream_file_range` to async (W4 owns that, sequenced last, and reuses W3's `_pieces_ready`/`_adaptive_piece_timeout`).

---

## Workstream W6: Player resilience + swarm-health UI (frontend)

This workstream hardens the two player components against low-seeder stress and surfaces swarm health in-player. It replaces the single 2 s retry with **bounded exponential backoff** (1·2·4·8 s, capped, max attempts) that **re-seeks to `currentTime`** on each attempt to force a fresh Range request; wires `isStalled` (10 s) into that recovery path; renders **health-aware messaging** that distinguishes "Waiting for peers (0 connected)" from "Buffering — slow connection (N peers)"; adds an **in-player swarm-health readout** (seeds/peers/rate) plus a **source/quality switcher** consuming WS1 candidates; and **removes PatchedVideoPlayer's own 5 s `getStreamingInfo` poll** (the streaming page is the single poll owner per §5.2).

**Seam ownership (W2 ↔ W6).** Per the authoritative seam contract, **W2 owns the prop DECLARATION** and lands *before* W6: W2 adds the five optional props to **both** `VideoPlayerProps` and `PatchedVideoPlayerProps`, threads them straight through `PatchedVideoPlayer → <VideoPlayer/>` as pass-through (declaration only, no behavior), and passes all five unconditionally from `app/streaming/[id]/page.tsx`. The canonical shape (snake_case — do **not** change to camelCase, it matches `deriveStreamHealth` and the `VideoPlayer` reads) is:

```tsx
interface StreamHealthState { stream_phase: StreamPhase; num_seeds: number; num_peers: number; download_rate: number; health: SwarmHealth }
```

and the five props are:

```tsx
streamHealth?: StreamHealthState
sources?: TorrentCandidate[]
currentSourceId?: string
onSelectSource?: (candidate: TorrentCandidate) => void
onRecoveryExhausted?: () => void
```

**W6 owns the BEHAVIOR only.** W6 therefore does **NOT** redeclare any of those five props on either interface (they already exist from W2) — W6 **reads/destructures** them and implements: bounded backoff recovery that calls `onRecoveryExhausted?.()` on exhaustion; the 10 s stall → recovery tie-in; the health-aware copy; the in-player swarm-health chip; and the source/quality switcher that renders `sources` and calls `onSelectSource`. W6 also removes PatchedVideoPlayer's 5 s poll. There must be **no `void x;` placeholder** anywhere.

W6 **imports** all shared types/derivers/services from W2's modules and **never** redefines them:
- `StreamPhase`, `SwarmHealth`, `TorrentCandidate`, `StreamHealthState`, and the extended `TorrentStatus` from `frontend/src/types/index.ts`.
- `deriveStreamHealth` / `getSources` live in W2's modules; W6 does not call them directly — it consumes the already-passed props.

W6 does **not** edit `types/index.ts`, `app/streaming/[id]/page.tsx`, or the page poll. It **owns exclusively** the *behavior* inside `frontend/src/components/player/VideoPlayer.tsx` and `frontend/src/components/player/PatchedVideoPlayer.tsx`.

Baseline = repo after W1, W3, **W2** have landed (W2 owns the §5.2 types, `deriveStreamHealth`, `getSources`, the page poll, the five-prop **declarations** on both player interfaces, the pass-through wiring through `PatchedVideoPlayer`, and the unconditional passing of `sources`/`currentSourceId`/`onSelectSource`/`streamHealth`/`onRecoveryExhausted` into `<PatchedVideoPlayer/>` from the page). W6 adds the in-player behavior and UI that consume those props.

**Health-color guard (confirmed palette).** Do **not** assume `bg-emerald-400` / a `rust` token exist. Verified via:
```bash
rg -n "danger|emerald|rust" frontend/src/app/globals.css frontend/src/app/**/*.css
rg -n "4caf6a|bg-gold|bg-muted" frontend/src/components/detail/SourcePicker.tsx
```
Result: only `--color-danger`, `--color-gold`, `--color-gold-lite`, `--color-muted` exist; there is **no** `emerald` or `rust` token. `SourcePicker` renders its health dot as healthy `bg-[#4caf6a]` / low `bg-gold`. W6 therefore uses the **same confirmed palette** so the in-player dots match the SourcePicker badges: healthy `bg-[#4caf6a]`, low `bg-gold`, dead `bg-muted` (the `rust→muted` fallback, since `rust` is absent). For the *message* text/border, `danger` is confirmed present, so the "0 peers / dead" copy keeps `text-danger`/`border-danger`.

Frontend has no unit harness; every task verifies with `(cd frontend && npx tsc --noEmit)` and ends with a concrete manual/Playwright checklist at `http://localhost:3001`.

---

### Task W6.1: Add backoff-retry + re-seek recovery primitives to `VideoPlayer.tsx`

**Files:**
- Modify: `frontend/src/components/player/VideoPlayer.tsx` — imports (lines 14-17), the destructure (lines 33-45), refs block (lines 55-58), the `handleError` network-error branch (lines 797-838), the source-change reset effect (lines 497-543), the `handlePlaying` handler (lines 865-876).

**Interfaces:**
- Consumes: the **already-declared** (W2) `streamHealth?: StreamHealthState` and `onRecoveryExhausted?: () => void` props — W6 destructures them, it does **not** add them to `VideoPlayerProps` (W2 owns that declaration).
- Produces: `VideoPlayer` gains internal `attemptRecovery(): void` (bounded exponential backoff that re-seeks `currentTime`), an attempt counter ref, and calls `onRecoveryExhausted?.()` when the backoff ladder is exhausted.

Steps:

- [ ] **Step 1: Import the shared type.** The current import block (lines 14-17) is:
```tsx
import { formatTime } from '@/utils/format';
import { PlayerState } from '@/types';
import BufferingAnimation from '@/components/streaming/BufferingAnimation';
import { cn } from '@/lib/cn';
```
Replace it with:
```tsx
import { formatTime } from '@/utils/format';
import { PlayerState, StreamHealthState } from '@/types';
import BufferingAnimation from '@/components/streaming/BufferingAnimation';
import { cn } from '@/lib/cn';
```
(Do **not** edit `VideoPlayerProps` — `streamHealth` and `onRecoveryExhausted` are already declared there by W2. `StreamHealthState` is imported only to annotate local logic.)

- [ ] **Step 2: Destructure the W2-declared props.** The current destructure (lines 33-45) is:
```tsx
const VideoPlayer: React.FC<VideoPlayerProps> = ({
  src,
  poster,
  movieTitle,
  subtitle,
  autoPlay = false,
  debug = false,
  onEnded,
  onError,
  onProgress,
  registerMethods,
  downloadProgress = 100 // Default to 100% (fully downloaded) if not provided
}) => {
```
Replace it with:
```tsx
const VideoPlayer: React.FC<VideoPlayerProps> = ({
  src,
  poster,
  movieTitle,
  subtitle,
  autoPlay = false,
  debug = false,
  onEnded,
  onError,
  onProgress,
  registerMethods,
  downloadProgress = 100, // Default to 100% (fully downloaded) if not provided
  streamHealth,
  onRecoveryExhausted
}) => {
```

- [ ] **Step 3: Add recovery refs.** The current refs block (lines 55-58) is:
```tsx
  const bufferingRetryTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastPlayheadPositionRef = useRef<number>(0);
  const stallTimeRef = useRef<number | null>(null);
  const maxStallTime = 10000; // Maximum time (ms) to wait before showing stall warning
```
Replace it with:
```tsx
  const bufferingRetryTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastPlayheadPositionRef = useRef<number>(0);
  const stallTimeRef = useRef<number | null>(null);
  const maxStallTime = 10000; // Maximum time (ms) to wait before showing stall warning
  // Bounded exponential backoff recovery (1·2·4·8s, capped). Each attempt re-seeks
  // currentTime to force the browser to re-issue the Range request to the backend.
  const recoveryAttemptRef = useRef<number>(0);
  const recoveryTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const RECOVERY_BACKOFF_MS = [1000, 2000, 4000, 8000];
  const MAX_RECOVERY_ATTEMPTS = RECOVERY_BACKOFF_MS.length;
```

- [ ] **Step 4: Add the `attemptRecovery` callback.** Insert it directly after the `checkForStall` callback (i.e. immediately before the `// Set up stall detection interval` effect at line 490). Insert:
```tsx
  // Bounded exponential-backoff recovery: re-seek to currentTime so the browser
  // re-requests the active Range from the backend. After MAX_RECOVERY_ATTEMPTS we
  // give up and let the page surface a source switch via onRecoveryExhausted.
  const attemptRecovery = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;

    if (recoveryAttemptRef.current >= MAX_RECOVERY_ATTEMPTS) {
      if (debug) console.log('Recovery exhausted after', MAX_RECOVERY_ATTEMPTS, 'attempts');
      onRecoveryExhausted?.();
      return;
    }

    const delay = RECOVERY_BACKOFF_MS[recoveryAttemptRef.current];
    recoveryAttemptRef.current += 1;
    if (debug) console.log(`Recovery attempt ${recoveryAttemptRef.current} in ${delay}ms`);

    setIsBuffering(true);
    setShowBufferingMessage(true);

    if (recoveryTimeoutRef.current) clearTimeout(recoveryTimeoutRef.current);
    recoveryTimeoutRef.current = setTimeout(() => {
      const v = videoRef.current;
      if (!v) return;
      try {
        // Re-seek to the current position (nudge) to force a fresh Range request.
        const t = v.currentTime;
        v.currentTime = Math.max(0, t);
        v.play().catch(err => {
          if (debug) console.error('Recovery play failed:', err);
        });
      } catch (e) {
        if (debug) console.error('Recovery seek failed:', e);
      }
    }, delay);
  }, [debug, onRecoveryExhausted]);
```

- [ ] **Step 5: Reset the recovery counter on successful playback.** The current `handlePlaying` (lines 865-876) is:
```tsx
    const handlePlaying = () => {
      try {
        if (debug) console.log("Playing event");
        setPlayerState(prev => ({ ...prev, isLoading: false, isPlaying: true }));
        setIsBuffering(false);
        setShowBufferingMessage(false);
        setIsStalled(false);
        stallTimeRef.current = null;
      } catch (e) {
        console.error("Error in playing event:", e);
      }
    };
```
Replace it with:
```tsx
    const handlePlaying = () => {
      try {
        if (debug) console.log("Playing event");
        setPlayerState(prev => ({ ...prev, isLoading: false, isPlaying: true }));
        setIsBuffering(false);
        setShowBufferingMessage(false);
        setIsStalled(false);
        stallTimeRef.current = null;
        // Healthy playback resumed → reset the backoff ladder.
        recoveryAttemptRef.current = 0;
        if (recoveryTimeoutRef.current) {
          clearTimeout(recoveryTimeoutRef.current);
          recoveryTimeoutRef.current = null;
        }
      } catch (e) {
        console.error("Error in playing event:", e);
      }
    };
```

- [ ] **Step 6: Route the network-error branch through `attemptRecovery`.** The current `handleError` network branch (lines 800-817) is:
```tsx
        // Don't treat network errors during active downloads as fatal
        if (downloadProgress < 100 && (video.error?.code === 2 || video.error?.code === 4)) {
          if (debug) console.log("Network error during download, treating as buffering");
          setIsBuffering(true);
          setShowBufferingMessage(true);

          // Retry playback after a delay if the video was playing
          if (playerState.isPlaying) {
            if (bufferingRetryTimeoutRef.current) {
              clearTimeout(bufferingRetryTimeoutRef.current);
            }

            bufferingRetryTimeoutRef.current = setTimeout(() => {
              if (debug) console.log("Retrying playback after network error");
              video.play().catch(e => {
                if (debug) console.error("Retry playback failed:", e);
              });
            }, 2000);
          }
        } else {
```
Replace it with:
```tsx
        // Don't treat network errors during active downloads as fatal
        if (downloadProgress < 100 && (video.error?.code === 2 || video.error?.code === 4)) {
          if (debug) console.log("Network error during download, recovering via backoff");
          // Bounded exponential backoff with re-seek instead of a single 2s retry.
          attemptRecovery();
        } else {
```

- [ ] **Step 7: Clear the recovery timeout on source change and reset the attempt counter.** The current source-change cleanup (lines 538-542) is:
```tsx
      // Clear any buffering retry timeouts
      if (bufferingRetryTimeoutRef.current) {
        clearTimeout(bufferingRetryTimeoutRef.current);
      }
    };
  }, [src, debug, updateVolumeFromMouseMove, stopVolumeDrag]);
```
Replace it with:
```tsx
      // Clear any buffering retry timeouts
      if (bufferingRetryTimeoutRef.current) {
        clearTimeout(bufferingRetryTimeoutRef.current);
      }
      if (recoveryTimeoutRef.current) {
        clearTimeout(recoveryTimeoutRef.current);
      }
    };
  }, [src, debug, updateVolumeFromMouseMove, stopVolumeDrag]);
```
Then reset the attempt counter when the source changes. The current reset block (lines 504-512) is:
```tsx
    // Reset state when source changes
    userInteractedRef.current = false;
    setShowUnmuteButton(false);
    volumeChangeInProgressRef.current = false;
    isDraggingVolumeRef.current = false;
    stallTimeRef.current = null;
    lastPlayheadPositionRef.current = 0;
    setIsBuffering(false);
    setShowBufferingMessage(false);
    setIsStalled(false);
```
Replace it with:
```tsx
    // Reset state when source changes
    userInteractedRef.current = false;
    setShowUnmuteButton(false);
    volumeChangeInProgressRef.current = false;
    isDraggingVolumeRef.current = false;
    stallTimeRef.current = null;
    lastPlayheadPositionRef.current = 0;
    setIsBuffering(false);
    setShowBufferingMessage(false);
    setIsStalled(false);
    recoveryAttemptRef.current = 0;
```

- [ ] **Step 8: Run the typecheck — expect PASS** (`streamHealth`/`onRecoveryExhausted` are already declared optional by W2, so destructuring them is type-safe even if a caller omits them).
```bash
(cd frontend && npx tsc --noEmit)
```

- [ ] **Step 9: Commit.**
```bash
git add frontend/src/components/player/VideoPlayer.tsx
git commit -m "feat(player): bounded backoff recovery with re-seek in VideoPlayer

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task W6.2: Tie `isStalled` (10 s) into the recovery path

**Files:**
- Modify: `frontend/src/components/player/VideoPlayer.tsx` — the `checkForStall` callback (lines 447-488) and its dependency array.

**Interfaces:**
- Consumes: `attemptRecovery` (Task W6.1), existing `stallTimeRef`, `maxStallTime`, `isStalled`.
- Produces: when a stall exceeds `maxStallTime` (10 s) the stall transition now **calls `attemptRecovery()`** once (not just sets the overlay flag).

Steps:

- [ ] **Step 1: Trigger recovery on the 10 s stall transition.** The current stall-exceeded branch inside `checkForStall` (lines 471-474) is:
```tsx
        if (stallDuration > maxStallTime && !isStalled) {
          // After max stall time (10 seconds by default), show stall warning
          setIsStalled(true);
        }
```
Replace it with:
```tsx
        if (stallDuration > maxStallTime && !isStalled) {
          // After max stall time (10 seconds by default): surface the warning AND
          // kick off the bounded backoff recovery (re-seek), not just an overlay.
          setIsStalled(true);
          attemptRecovery();
        }
```

- [ ] **Step 2: Add `attemptRecovery` and `isStalled` to the dependency array.** The current closing of `checkForStall` (line 488) is:
```tsx
  }, [playerState.isPlaying]);
```
Replace it with:
```tsx
  }, [playerState.isPlaying, isStalled, attemptRecovery]);
```

- [ ] **Step 3: Run the typecheck — expect PASS.**
```bash
(cd frontend && npx tsc --noEmit)
```

- [ ] **Step 4: Commit.**
```bash
git add frontend/src/components/player/VideoPlayer.tsx
git commit -m "feat(player): drive 10s stall into backoff recovery instead of a passive overlay

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task W6.3: Health-aware messaging — distinguish 0 peers from slow connection

**Files:**
- Modify: `frontend/src/components/player/VideoPlayer.tsx` — add a derived message string and render it inside the buffering overlay (lines 1149-1154) and the debug overlay (lines 1177-1183).

**Interfaces:**
- Consumes: the W2-declared `streamHealth?: StreamHealthState` prop (destructured in W6.1; shape `{ stream_phase, num_seeds, num_peers, download_rate, health }`).
- Produces: a `healthMessage` computed from `streamHealth` — `"Waiting for peers (0 connected)"` when `num_peers === 0` (or `health === 'dead'`), else `"Buffering — slow connection (N peers)"` when buffering, rendered over the `BufferingAnimation`.

Steps:

- [ ] **Step 1: Compute the health message.** Insert directly above the `return (` statement (line 1083, right after the `controlsVisible` const at line 1081). Insert:
```tsx
  // Health-aware buffering copy: a dead/0-peer swarm reads differently from a slow one.
  const healthMessage: string | null = (() => {
    if (!streamHealth) return null;
    if (streamHealth.health === 'dead' || streamHealth.num_peers === 0) {
      return 'Waiting for peers (0 connected)';
    }
    if (isBuffering || isStalled) {
      return `Buffering — slow connection (${streamHealth.num_peers} ${
        streamHealth.num_peers === 1 ? 'peer' : 'peers'
      })`;
    }
    return null;
  })();
```

- [ ] **Step 2: Render the message in the buffering overlay.** The current buffering overlay (lines 1149-1154) is:
```tsx
      {/* Loading/Buffering Overlay */}
      {(playerState.isLoading || isBuffering) && (
        <div className="absolute inset-0 z-30 pointer-events-none">
          <BufferingAnimation downloadProgress={downloadProgress} />
        </div>
      )}
```
Replace it with (note: `danger` is a confirmed token, so the dead/0-peer copy uses `border-danger`/`text-danger`):
```tsx
      {/* Loading/Buffering Overlay */}
      {(playerState.isLoading || isBuffering) && (
        <div className="absolute inset-0 z-30 pointer-events-none">
          <BufferingAnimation downloadProgress={downloadProgress} />
          {healthMessage && (
            <div className="absolute inset-x-0 bottom-[18%] flex justify-center px-6">
              <span
                data-testid="player-health-message"
                className={cn(
                  'rounded-full border px-4 py-1.5 text-xs font-medium backdrop-blur-md',
                  streamHealth?.health === 'dead' || streamHealth?.num_peers === 0
                    ? 'border-danger/50 text-danger'
                    : 'border-hairline text-text/90'
                )}
                style={{ background: 'rgba(17,17,19,.6)' }}
              >
                {healthMessage}
              </span>
            </div>
          )}
        </div>
      )}
```

- [ ] **Step 3: Surface health in the debug overlay.** The current debug overlay (lines 1177-1183) is:
```tsx
      {/* Debug Overlay */}
      {debug && (
        <div className="absolute top-0 left-0 bg-ink/80 text-text text-xs p-2 z-20 font-mono">
          Volume: {playerState.volume.toFixed(2)} | Muted: {playerState.isMuted.toString()} |
          Ready: {videoIsReady.toString()} | Buffering: {isBuffering.toString()} |
          Download: {downloadProgress.toFixed(1)}% | Stalled: {isStalled.toString()}
        </div>
      )}
```
Replace it with:
```tsx
      {/* Debug Overlay */}
      {debug && (
        <div className="absolute top-0 left-0 bg-ink/80 text-text text-xs p-2 z-20 font-mono">
          Volume: {playerState.volume.toFixed(2)} | Muted: {playerState.isMuted.toString()} |
          Ready: {videoIsReady.toString()} | Buffering: {isBuffering.toString()} |
          Download: {downloadProgress.toFixed(1)}% | Stalled: {isStalled.toString()} |
          Retry: {recoveryAttemptRef.current}/{MAX_RECOVERY_ATTEMPTS}
          {streamHealth && ` | Seeds: ${streamHealth.num_seeds} | Peers: ${streamHealth.num_peers} | Health: ${streamHealth.health}`}
        </div>
      )}
```

- [ ] **Step 3a: Run the typecheck — expect PASS.**
```bash
(cd frontend && npx tsc --noEmit)
```

- [ ] **Step 4: Commit.**
```bash
git add frontend/src/components/player/VideoPlayer.tsx
git commit -m "feat(player): health-aware buffering copy (0 peers vs slow connection)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task W6.4: In-player swarm-health readout + source/quality switcher

**Files:**
- Modify: `frontend/src/components/player/VideoPlayer.tsx` — the import (extended in W6.1), the destructure (extended in W6.1), the state block (line 74), the right-cluster of the bottom bar (the gated quality pill at lines 1524-1536), and the top-overlay streaming chip (lines 1232-1236).

**Interfaces:**
- Consumes: the W2-declared `sources?: TorrentCandidate[]`, `currentSourceId?: string`, `onSelectSource?: (c: TorrentCandidate) => void` props (destructured here — **not** redeclared on `VideoPlayerProps`, which W2 owns) and the `streamHealth` prop (W6.1).
- Produces: a bottom-bar **Source** popover listing candidates (quality + health dot + seeds), replacing the gated informational quality pill; and a live swarm-health chip (seeds/peers/rate) when `streamHealth` is present. Health dots use the **confirmed SourcePicker palette** (healthy `bg-[#4caf6a]`, low `bg-gold`, dead `bg-muted`).

Steps:

- [ ] **Step 1: Import `TorrentCandidate` and destructure the W2-declared switcher props.** The import (extended in W6.1) is:
```tsx
import { PlayerState, StreamHealthState } from '@/types';
```
Replace it with:
```tsx
import { PlayerState, StreamHealthState, TorrentCandidate } from '@/types';
```
Then the destructure tail (from W6.1) is:
```tsx
  downloadProgress = 100, // Default to 100% (fully downloaded) if not provided
  streamHealth,
  onRecoveryExhausted
}) => {
```
Replace it with:
```tsx
  downloadProgress = 100, // Default to 100% (fully downloaded) if not provided
  streamHealth,
  onRecoveryExhausted,
  sources,
  currentSourceId,
  onSelectSource
}) => {
```
(`TorrentCandidate` is imported only to keep the local `sources.map` / `find` callbacks well-typed; the props themselves are declared by W2 on `VideoPlayerProps`, so this step does **not** touch the interface.)

- [ ] **Step 2: Add switcher open-state.** The current state block has `const [showSettings, setShowSettings] = useState(false);` (line 74). Insert directly after it:
```tsx
  const [showSources, setShowSources] = useState(false);
```

- [ ] **Step 3: Replace the gated quality pill with the live Source switcher.** The current gated quality pill (lines 1524-1536) is:
```tsx
            {/* Quality pill — GATED (informational only) */}
            <button
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-hairline text-text text-xs font-semibold opacity-50 cursor-not-allowed"
              style={{ background: 'rgba(22,22,26,.4)', letterSpacing: '.03em' }}
              aria-label="Quality 1080p (informational)"
              aria-disabled="true"
              title="Informational — quality is fixed per torrent"
              tabIndex={-1}
              onClick={e => e.stopPropagation()}
            >
              <span className="text-[9px] text-muted uppercase tracking-widest mr-0.5">HD</span>
              1080p
            </button>
```
Replace it with (health dots use the confirmed SourcePicker palette — `bg-[#4caf6a]` / `bg-gold` / `bg-muted`):
```tsx
            {/* Source / quality switcher — lists WS1 alternatives with health */}
            {sources && sources.length > 0 ? (
              <div className="relative" onClick={e => e.stopPropagation()}>
                <button
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-hairline text-text text-xs font-semibold transition-colors hover:border-gold/40 hover:text-gold-lite"
                  style={{ background: 'rgba(22,22,26,.4)', letterSpacing: '.03em' }}
                  onClick={() => setShowSources(s => !s)}
                  aria-label="Switch source or quality"
                  aria-expanded={showSources}
                  data-testid="source-switcher-button"
                >
                  <span className="text-[9px] text-muted uppercase tracking-widest mr-0.5">Source</span>
                  {sources.find(s => s.source_id === currentSourceId)?.quality || 'Auto'}
                </button>

                {showSources && (
                  <div
                    className="absolute bottom-full right-0 mb-2 min-w-[240px] max-h-[280px] overflow-y-auto rounded-xl border border-hairline py-1.5 z-50"
                    style={{ background: 'rgba(22,22,26,.97)', backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)' }}
                    data-testid="source-switcher-menu"
                  >
                    <div className="px-3 py-1 text-[10px] uppercase tracking-widest text-muted">Sources</div>
                    {sources.map((s: TorrentCandidate) => (
                      <button
                        key={s.source_id}
                        className={cn(
                          'w-full flex items-center gap-2.5 px-3 py-2 text-xs transition-colors hover:bg-surface-2 text-left',
                          s.source_id === currentSourceId ? 'text-gold font-semibold' : 'text-text'
                        )}
                        onClick={() => {
                          setShowSources(false);
                          if (s.source_id !== currentSourceId) onSelectSource?.(s);
                        }}
                        data-testid="source-option"
                      >
                        {/* Health dot — same palette as SourcePicker's SeedDot */}
                        <span
                          className={cn(
                            'flex-shrink-0 w-2 h-2 rounded-full',
                            s.health === 'healthy' ? 'bg-[#4caf6a]'
                              : s.health === 'low' ? 'bg-gold'
                              : 'bg-muted'
                          )}
                          aria-hidden="true"
                        />
                        <span className="font-semibold">{s.quality || 'SD'}</span>
                        {s.is_season_pack && (
                          <span className="text-[9px] uppercase tracking-widest text-muted border border-hairline rounded px-1">Pack</span>
                        )}
                        <span className="flex-1" />
                        <span className="text-muted tabular-nums">{s.seeds} sd</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              // No alternatives available → keep the gated informational pill.
              <button
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-hairline text-text text-xs font-semibold opacity-50 cursor-not-allowed"
                style={{ background: 'rgba(22,22,26,.4)', letterSpacing: '.03em' }}
                aria-label="Quality (informational)"
                aria-disabled="true"
                title="Informational — quality is fixed per torrent"
                tabIndex={-1}
                onClick={e => e.stopPropagation()}
              >
                <span className="text-[9px] text-muted uppercase tracking-widest mr-0.5">HD</span>
                {sources?.find(s => s.source_id === currentSourceId)?.quality || '1080p'}
              </button>
            )}
```

- [ ] **Step 4: Add the live swarm-health chip in the top overlay.** The current streaming chip closing in the top overlay (lines 1232-1236) is:
```tsx
              Streaming
              <span className="text-muted">·</span>
              <b className="text-gold-lite font-semibold">{Math.round(downloadProgress)}% downloaded</b>
            </div>
          )}
        </div>
      </div>
```
Replace it with (chip dot uses the same confirmed palette):
```tsx
              Streaming
              <span className="text-muted">·</span>
              <b className="text-gold-lite font-semibold">{Math.round(downloadProgress)}% downloaded</b>
            </div>
          )}
          {/* Live swarm health (seeds/peers/rate) */}
          {streamHealth && downloadProgress < 100 && (
            <div
              data-testid="swarm-health-chip"
              className="inline-flex items-center gap-2 self-start px-3 py-1.5 rounded-full border border-hairline text-text text-xs"
              style={{ background: 'rgba(17,17,19,.55)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' }}
            >
              <span
                className={cn(
                  'flex-shrink-0 w-1.5 h-1.5 rounded-full',
                  streamHealth.health === 'healthy' ? 'bg-[#4caf6a]'
                    : streamHealth.health === 'low' ? 'bg-gold'
                    : 'bg-muted'
                )}
                aria-hidden="true"
              />
              <span className="text-muted">{streamHealth.num_seeds} seeds · {streamHealth.num_peers} peers</span>
              <span className="text-muted">·</span>
              <b className="text-text/90 font-semibold tabular-nums">
                {(streamHealth.download_rate / 1_000_000).toFixed(1)} MB/s
              </b>
            </div>
          )}
        </div>
      </div>
```

- [ ] **Step 5: Run the typecheck — expect PASS.**
```bash
(cd frontend && npx tsc --noEmit)
```

- [ ] **Step 6: Commit.**
```bash
git add frontend/src/components/player/VideoPlayer.tsx
git commit -m "feat(player): in-player swarm-health chip and source/quality switcher

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task W6.5: Remove PatchedVideoPlayer's 5 s poll; consume + forward the W2 props

**Files:**
- Modify: `frontend/src/components/player/PatchedVideoPlayer.tsx` — the destructure (lines 29-44), the 5 s `getStreamingInfo` poll effect (lines 77-96), the `handleVideoError` handler (lines 331-343), the `<VideoPlayer/>` render (lines 363-375).

**Interfaces:**
- Consumes: the **W2-declared** `streamHealth`, `sources`, `currentSourceId`, `onSelectSource`, `onRecoveryExhausted` props on `PatchedVideoPlayerProps` (W2 added these to the interface; W6 destructures them — it does **not** redeclare the interface). `StreamHealthState`/`TorrentCandidate` are already imported by W2 for those declarations.
- Produces: the five props forwarded verbatim to `<VideoPlayer/>`; health-aware error gating; and **deletion** of the internal 5 s `setInterval(getStreamingInfo, 5000)` effect (the page is the single poll owner; download progress now flows only via the `downloadProgress` prop).

> Note: W2 already added the five prop declarations to `PatchedVideoPlayerProps` and threaded them through to `<VideoPlayer/>` as a pass-through. If W2's pass-through render already forwards all five props, **skip Step 4** below (it is idempotent — verify the render block first). The poll-removal and error-gating steps are W6-exclusive and always apply.

Steps:

- [ ] **Step 1: Destructure the W2-declared props.** The current destructure (lines 29-44) is:
```tsx
const PatchedVideoPlayer: React.FC<PatchedVideoPlayerProps> = ({
  src,
  torrentId,
  torrentInfo,
  movieId,
  contentId,
  fileIndex,
  title,
  movieTitle,
  subtitle,
  poster,
  onError,
  onProgress: externalOnProgress,
  downloadProgress = 0,
  streamingInfo
}) => {
```
Replace it with:
```tsx
const PatchedVideoPlayer: React.FC<PatchedVideoPlayerProps> = ({
  src,
  torrentId,
  torrentInfo,
  movieId,
  contentId,
  fileIndex,
  title,
  movieTitle,
  subtitle,
  poster,
  onError,
  onProgress: externalOnProgress,
  downloadProgress = 0,
  streamingInfo,
  streamHealth,
  sources,
  currentSourceId,
  onSelectSource,
  onRecoveryExhausted
}) => {
```
(Do **not** edit `PatchedVideoPlayerProps` or its imports — W2 owns those declarations.)

- [ ] **Step 2: Delete the 5 s `getStreamingInfo` poll effect.** The current effect (lines 77-96) is:
```tsx
  // Set up interval for checking streaming info updates
  useEffect(() => {
    // Don't need to run if we're already at 100%
    if (downloadProgress >= 100) return;
    
    const infoInterval = setInterval(async () => {
      try {
        // Get updated streaming info
        const info = await streamingService.getStreamingInfo(torrentId);
        if (info) {
          // Update download progress based on overall progress
          setCurrentDownloadProgress(info.progress);
        }
      } catch (error) {
        console.error('Error updating streaming info:', error);
      }
    }, 5000); // Check every 5 seconds
    
    return () => clearInterval(infoInterval);
  }, [torrentId, downloadProgress]);
  
```
Replace it with:
```tsx
  // NOTE: the per-player 5s getStreamingInfo poll was removed (WS6). The streaming
  // page is the single poll owner (§5.2) and feeds download progress down via the
  // `downloadProgress` prop, which the effect above mirrors into local state.

```

- [ ] **Step 3: Health-aware error gating.** The current `handleVideoError` (lines 331-343) is:
```tsx
  // Handle video player error
  const handleVideoError = (error: string) => {
    // For minor errors during active downloads, don't show the error screen
    if (torrentInfo && torrentInfo.progress < 100 && 
        (error.includes('network error') || error.includes('buffering'))) {
      // Just log the error but don't show the error screen
      console.warn('Video playback issue during download:', error);
    } else {
      // For serious errors, show the error screen
      if (onError) {
        onError(error);
      }
    }
  };
```
Replace it with:
```tsx
  // Handle video player error
  const handleVideoError = (error: string) => {
    // During an active download, minor network/buffering errors are handled in-player
    // by the backoff recovery — don't escalate to the error screen. A genuinely dead
    // swarm (health === 'dead') still bubbles up so the user can switch sources.
    const isRecoverable =
      torrentInfo && torrentInfo.progress < 100 &&
      streamHealth?.health !== 'dead' &&
      (error.includes('network error') || error.includes('buffering'));
    if (isRecoverable) {
      console.warn('Video playback issue during download (recovering in-player):', error);
    } else if (onError) {
      onError(error);
    }
  };
```

- [ ] **Step 4: Forward the W2 props to `<VideoPlayer/>` (skip if W2's pass-through already forwards all five).** Verify the current render (lines 363-375); if it does not already forward all five props, replace:
```tsx
          <VideoPlayer 
            src={streamingUrl}
            poster={poster}
            movieTitle={movieTitle}
            subtitle={subtitle}
            autoPlay={!showResumePrompt}
            debug
            onProgress={handleProgress}
            onEnded={handleEnded}
            onError={handleVideoError}
            registerMethods={registerPlayerMethods}
            downloadProgress={currentDownloadProgress}
          />
```
with:
```tsx
          <VideoPlayer 
            src={streamingUrl}
            poster={poster}
            movieTitle={movieTitle}
            subtitle={subtitle}
            autoPlay={!showResumePrompt}
            debug
            onProgress={handleProgress}
            onEnded={handleEnded}
            onError={handleVideoError}
            registerMethods={registerPlayerMethods}
            downloadProgress={currentDownloadProgress}
            streamHealth={streamHealth}
            sources={sources}
            currentSourceId={currentSourceId}
            onSelectSource={onSelectSource}
            onRecoveryExhausted={onRecoveryExhausted}
          />
```

- [ ] **Step 5: Run the typecheck — expect PASS.** (`streamingService` is still imported and used elsewhere in the file — `getProgressByMovie`, `saveProgress`, etc. — so no unused-import error; `getStreamingInfo` is simply no longer called here.)
```bash
(cd frontend && npx tsc --noEmit)
```

- [ ] **Step 6: Commit.**
```bash
git add frontend/src/components/player/PatchedVideoPlayer.tsx
git commit -m "feat(player): remove duplicate 5s poll, consume and forward swarm-health and switcher props

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task W6.6: Manual / Playwright verification of player resilience + health UI

**Files:** none (verification only). Requires W1+W3+W2 landed and `make up` running (frontend at `http://localhost:3001`).

**Interfaces:**
- Consumes: the running app; the W2-owned page passing `streamHealth`/`sources`/`currentSourceId`/`onSelectSource`/`onRecoveryExhausted` unconditionally into `<PatchedVideoPlayer/>`, plus W2's page-side `handleSelectSource` (same-torrent season-pack → `file_index` swap via `router.replace ?file=N`; different-torrent → `downloadCatalogMovie` then `router.replace`) and `handleRecoveryExhausted` (reveals the source-switch affordance).
- Produces: nothing (sign-off only).

Steps:

- [ ] **Step 1: Bring the stack up.**
```bash
make up d=1
```

- [ ] **Step 2: Typecheck the whole frontend once more — expect PASS.**
```bash
(cd frontend && npx tsc --noEmit)
```

- [ ] **Step 3: Manual — swarm-health chip appears.**
  1. Open `http://localhost:3001`, pick any movie, click Play.
  2. On `http://localhost:3001/streaming/<id>` while still downloading (download chip < 100%), confirm a second chip appears in the top-left overlay showing `N seeds · M peers` and a `X.X MB/s` rate (`data-testid="swarm-health-chip"`).
  3. Expected: a colored dot — green `#4caf6a` (healthy), gold (low), or muted/grey (dead) — matching the detail-page SourcePicker badge palette.

- [ ] **Step 4: Manual — 0-peer vs slow-connection messaging.**
  1. Pick a low-seeder title (a "low"/"dead" badge on the detail page from WS1).
  2. While buffering, confirm the centered pill (`data-testid="player-health-message"`): when `num_peers === 0` it reads **"Waiting for peers (0 connected)"** in `danger` red; with peers > 0 while buffering it reads **"Buffering — slow connection (N peers)"** in neutral text.
  3. Expected: the message swaps as peers connect; it does NOT show the generic spinner-only buffer with no explanation.

- [ ] **Step 5: Manual — backoff recovery fires and recovers (debug overlay).**
  1. With the player open (debug is on — top-left mono overlay), throttle the network in DevTools (Network → "Slow 3G") mid-playback to induce a stall.
  2. After ~10 s of no playhead movement, confirm the overlay's `Retry: k/4` increments (1→2→3→4) at ~1·2·4·8 s spacing and `Stalled: true` appears.
  3. Remove the throttle. Expected: playback resumes, `Retry` resets to `0/4`, `Stalled: false`.

- [ ] **Step 6: Manual — recovery exhaustion bubbles up via `onRecoveryExhausted`.**
  1. Keep the network throttled past 4 attempts (~15 s+).
  2. Expected: `onRecoveryExhausted?.()` fires after the 4th attempt — W2's page `handleRecoveryExhausted` reveals the source-switch affordance; the player itself does not hard-crash to the red "Playback Error" screen while `health !== 'dead'`.

- [ ] **Step 7: Manual — source/quality switcher swaps source live.**
  1. Click the bottom-bar **Source** pill (`data-testid="source-switcher-button"`) — a menu (`data-testid="source-switcher-menu"`) lists candidates with a health dot (same palette as SourcePicker), quality, optional "Pack" tag, and `N sd` seed count.
  2. Click a different candidate (`data-testid="source-option"`). Expected: `onSelectSource` fires; W2's page swaps the source (same-torrent season pack → `file_index` swap via `?file=N`, or different torrent → new download + `router.replace`) and the video reloads at the new source without full back-navigation; the menu highlights the new `currentSourceId` in gold.

- [ ] **Step 8: Playwright smoke (optional, automatable parts).**
```bash
# From a Playwright MCP session against http://localhost:3001/streaming/<id>:
# - browser_snapshot → assert [data-testid="swarm-health-chip"] present while downloading
# - browser_click [data-testid="source-switcher-button"]
# - browser_snapshot → assert [data-testid="source-switcher-menu"] and >=1 [data-testid="source-option"]
# - browser_click first [data-testid="source-option"] → assert the <video> src changed (network request to a new /api/.../stream)
```

- [ ] **Step 9: Record sign-off.**
```bash
git commit --allow-empty -m "test(player): WS6 manual/Playwright resilience + health UI sign-off

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

**WS6 deliverables:**
- `VideoPlayer` and `PatchedVideoPlayer` **consume** (do not redeclare) the five W2-declared props — `streamHealth?: StreamHealthState`, `sources?: TorrentCandidate[]`, `currentSourceId?: string`, `onSelectSource?: (c: TorrentCandidate) => void`, `onRecoveryExhausted?: () => void` (single `streamHealth` object — no trio).
- Bounded exponential backoff (1·2·4·8 s, max 4 attempts) with re-seek-to-`currentTime` recovery; `isStalled` (10 s) drives the same path; counter resets on `playing`/source change; **exhaustion calls `onRecoveryExhausted?.()`**.
- Health-aware copy: "Waiting for peers (0 connected)" vs "Buffering — slow connection (N peers)".
- In-player swarm-health chip (seeds/peers/MB/s) + source/quality switcher consuming WS1 candidates, with health dots on the **confirmed SourcePicker palette** (healthy `bg-[#4caf6a]`, low `bg-gold`, dead `bg-muted`; message text uses the confirmed `danger` token) — no assumed `emerald`/`rust` tokens.
- PatchedVideoPlayer's own 5 s `getStreamingInfo` poll removed — the streaming page is the single poll owner.
- All shared types imported from W2's modules; `VideoPlayerProps`/`PatchedVideoPlayerProps` declarations, `types/index.ts`, `page.tsx`, and the page poll untouched by W6.

---

## Workstream W7: Data hardening — unique index, atomic upsert, content_id precompute

> **No-Alembic constraint (applies to every task in this workstream):** This project has **no migration framework**. `init_db()` (in `backend/app/database/session.py`) runs `create_all()` (creates whole new tables only) then `sync_columns()` (additive `ALTER TABLE ... ADD COLUMN` only — it **cannot** create indexes/constraints and never drops/renames/retypes/backfills). Adding a **column** = add a nullable ORM column (auto-applied by `sync_columns`). Adding an **index** requires a **new guarded `sync_indexes()`** step that issues `CREATE ... INDEX IF NOT EXISTS` and must be valid on **both PostgreSQL 16 and the SQLite fallback**. Do **not** convert `get_db()` to a yield-dependency; it is an intentional `@contextmanager`. SQLAlchemy is **1.4** style (not 2.0). `content_id` format is `movie:{tmdb_id}` / `tv:{tmdb_id}:s{season}:e{episode}` — owned by `backend/app/services/content_id.py`.

This workstream is independent of WS1–WS6 and can be implemented in any order relative to them. It has internal ordering: Task W7.1 (column + index on the ORM) → W7.2 (`sync_indexes()`) → W7.3 (atomic upsert) → W7.4 (content_id resolver + Torrent column) → W7.5 (precompute wiring) → W7.6 (endpoint uses resolver).

**Baked-in-image test command (use this exact form in every backend test-run step):**
```bash
docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest tests/<file> -v
```
(Container workdir `/opt/freeflix`; app at `/opt/freeflix/app`; tests at `/opt/freeflix/tests`. Mounting `backend/tests` makes new/edited test files visible without a rebuild.)

---

### Task W7.1 — Unique index declaration on the ORM model + `season`/`episode`/`content_id` columns on `UserStreamingProgress`

Adds the declarative `UniqueConstraint` (so `create_all` covers fresh DBs) and a nullable `content_id` column to `user_streaming_progress`. No `sync_indexes` yet — this task only changes the model and proves the constraint exists on a freshly-created table.

**Files:**
- Modify: `backend/app/database/models/streaming.py` (imports line 1-7; class body lines 11-29)
- Test: `backend/tests/test_streaming_unique.py` (new)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `UserStreamingProgress.content_id` — nullable `Column(String, index=True)`, the precomputed/derived watch-identity string (`movie:{tmdb_id}` / `tv:{tmdb_id}:s{n}:e{m}`).
  - `UserStreamingProgress.__table_args__` containing `UniqueConstraint("user_id", "movie_id", name="uq_user_movie_progress")`.

**Steps:**

- [ ] **Step 1: Write a failing test that the model declares a unique constraint and a `content_id` column.**
  Create `backend/tests/test_streaming_unique.py`:
  ```python
  from sqlalchemy import UniqueConstraint

  from app.database.models import UserStreamingProgress


  def test_unique_constraint_declared_on_user_id_movie_id():
      constraints = [
          c for c in UserStreamingProgress.__table__.constraints
          if isinstance(c, UniqueConstraint)
      ]
      cols = [tuple(sorted(col.name for col in c.columns)) for c in constraints]
      assert ("movie_id", "user_id") in cols


  def test_content_id_column_exists_and_nullable():
      col = UserStreamingProgress.__table__.columns.get("content_id")
      assert col is not None
      assert col.nullable is True
  ```

- [ ] **Step 2: Run the test and watch it FAIL.**
  ```bash
  docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest tests/test_streaming_unique.py -v
  ```
  Expected: FAIL — `test_unique_constraint_declared_on_user_id_movie_id` asserts on a missing `UniqueConstraint`, and `test_content_id_column_exists_and_nullable` finds `col is None`.

- [ ] **Step 3: Add the `UniqueConstraint` import.**
  In `backend/app/database/models/streaming.py`, replace the current import block (lines 1-4):
  ```python
  from sqlalchemy import (
      Boolean, Column, DateTime, Float, ForeignKey, 
      Integer, String, Text, JSON, func
  )
  ```
  with:
  ```python
  from sqlalchemy import (
      Boolean, Column, DateTime, Float, ForeignKey,
      Integer, String, Text, JSON, func, UniqueConstraint
  )
  ```

- [ ] **Step 4: Add `__table_args__` and the `content_id` column.**
  In `backend/app/database/models/streaming.py`, replace the current snippet (lines 13-18):
  ```python
      __tablename__ = "user_streaming_progress"
      
      id = Column(String, primary_key=True, default=generate_uuid)
      user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
      torrent_id = Column(String, ForeignKey("torrents.id", ondelete="SET NULL"), nullable=True, index=True)
      movie_id = Column(String, nullable=False, index=True)  # To track progress even if torrent changes
  ```
  with:
  ```python
      __tablename__ = "user_streaming_progress"
      __table_args__ = (
          UniqueConstraint("user_id", "movie_id", name="uq_user_movie_progress"),
      )

      id = Column(String, primary_key=True, default=generate_uuid)
      user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
      torrent_id = Column(String, ForeignKey("torrents.id", ondelete="SET NULL"), nullable=True, index=True)
      movie_id = Column(String, nullable=False, index=True)  # To track progress even if torrent changes
      # Precomputed/derived watch-identity (movie:{id} | tv:{id}:s{n}:e{m}); nullable so
      # sync_columns can add it to pre-existing tables. Mirrors movie_id, kept for clarity
      # and future de-coupling.
      content_id = Column(String, nullable=True, index=True)
  ```

- [ ] **Step 5: Run the test and watch it PASS.**
  ```bash
  docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest tests/test_streaming_unique.py -v
  ```
  Expected: PASS (2 passed).

- [ ] **Step 6: Commit.**
  ```bash
  git add backend/app/database/models/streaming.py backend/tests/test_streaming_unique.py
  git commit -m "feat(streaming): declare uq(user_id,movie_id) + content_id column on progress model"
  ```

---

### Task W7.2 — `sync_indexes()`: dedup latest-per-`(user_id, movie_id)` then `CREATE UNIQUE INDEX IF NOT EXISTS`

Adds the dedup + idempotent unique-index creation step and wires it into `init_db()` **after** `create_all` + `sync_columns`. Works on PostgreSQL **and** SQLite.

**Files:**
- Modify: `backend/app/database/session.py` (imports line 1; `sync_columns` ends line 156; `init_db` lines 158-163)
- Test: `backend/tests/test_sync_indexes.py` (new)

**Interfaces:**
- Consumes: `UserStreamingProgress.__table_args__` (uq name `uq_user_movie_progress`) from Task W7.1.
- Produces:
  - `def sync_indexes(engine_) -> None` in `backend/app/database/session.py` — deduplicates `user_streaming_progress` rows keeping the latest `last_watched_at` per `(user_id, movie_id)` (ties broken by `id`), then runs `CREATE UNIQUE INDEX IF NOT EXISTS uq_user_movie_progress ON user_streaming_progress (user_id, movie_id)`. Idempotent; safe on Postgres + SQLite. Skips cleanly if the table does not exist.

**Steps:**

- [ ] **Step 1: Write failing tests for dedup-keeps-latest and idempotency.**
  Create `backend/tests/test_sync_indexes.py`:
  ```python
  import datetime

  from sqlalchemy import create_engine, text, inspect

  from app.database.session import sync_indexes


  def _make_progress_table(engine):
      with engine.begin() as conn:
          conn.execute(text(
              "CREATE TABLE user_streaming_progress ("
              "id VARCHAR PRIMARY KEY, "
              "user_id VARCHAR NOT NULL, "
              "movie_id VARCHAR NOT NULL, "
              "current_time FLOAT, "
              "last_watched_at TIMESTAMP NOT NULL)"
          ))

  def _insert(engine, id_, user_id, movie_id, ct, watched):
      with engine.begin() as conn:
          conn.execute(
              text("INSERT INTO user_streaming_progress "
                   "(id, user_id, movie_id, current_time, last_watched_at) "
                   "VALUES (:id, :u, :m, :ct, :w)"),
              {"id": id_, "u": user_id, "m": movie_id, "ct": ct, "w": watched},
          )

  def _rows(engine):
      with engine.connect() as conn:
          return conn.execute(text(
              "SELECT id, current_time FROM user_streaming_progress "
              "ORDER BY id")).fetchall()


  def test_sync_indexes_dedup_keeps_latest(tmp_path):
      engine = create_engine(f"sqlite:///{tmp_path / 'idx.db'}")
      _make_progress_table(engine)
      old = datetime.datetime(2026, 1, 1, 0, 0, 0)
      new = datetime.datetime(2026, 6, 1, 0, 0, 0)
      # Two duplicate rows for the SAME (user, movie); the newer one (current_time=99) must survive.
      _insert(engine, "a", "u1", "movie:1", 10.0, old)
      _insert(engine, "b", "u1", "movie:1", 99.0, new)
      # An unrelated row must be untouched.
      _insert(engine, "c", "u2", "movie:2", 5.0, new)

      sync_indexes(engine)

      rows = _rows(engine)
      # 'a' (older dup) removed; 'b' (latest) and 'c' (unrelated) remain.
      assert {r[0] for r in rows} == {"b", "c"}
      kept = {r[0]: r[1] for r in rows}
      assert kept["b"] == 99.0

      indexes = {ix["name"] for ix in inspect(engine).get_indexes("user_streaming_progress")}
      assert "uq_user_movie_progress" in indexes


  def test_sync_indexes_is_idempotent(tmp_path):
      engine = create_engine(f"sqlite:///{tmp_path / 'idx.db'}")
      _make_progress_table(engine)
      now = datetime.datetime(2026, 6, 1, 0, 0, 0)
      _insert(engine, "a", "u1", "movie:1", 10.0, now)

      sync_indexes(engine)
      sync_indexes(engine)  # second run must not raise and must not drop the row

      rows = _rows(engine)
      assert {r[0] for r in rows} == {"a"}


  def test_sync_indexes_skips_missing_table(tmp_path):
      engine = create_engine(f"sqlite:///{tmp_path / 'idx.db'}")
      # No table created -> must be a clean no-op.
      sync_indexes(engine)
      assert "user_streaming_progress" not in set(inspect(engine).get_table_names())
  ```

- [ ] **Step 2: Run the tests and watch them FAIL.**
  ```bash
  docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest tests/test_sync_indexes.py -v
  ```
  Expected: FAIL — `ImportError: cannot import name 'sync_indexes' from 'app.database.session'`.

- [ ] **Step 3: Implement `sync_indexes()`.**
  In `backend/app/database/session.py`, immediately after the end of `sync_columns` (after line 156, before `def init_db():` at line 158), add:
  ```python
  def sync_indexes(engine_):
      """Idempotent, additive index creation that sync_columns cannot perform.

      ``sync_columns`` only ADDs columns; it can never create an index or a unique
      constraint. With no migration framework, a unique index on an existing table must
      be created defensively here. Before creating the UNIQUE index on
      ``user_streaming_progress (user_id, movie_id)`` we DEDUPLICATE any pre-existing
      duplicate rows (keeping the latest ``last_watched_at`` per pair, ties broken by id),
      otherwise the CREATE UNIQUE INDEX would fail on a dirty table. Valid on both
      PostgreSQL and SQLite; safe to run on every startup.
      """
      table = "user_streaming_progress"
      inspector = sa_inspect(engine_)
      if table not in set(inspector.get_table_names()):
          return  # create_all will create it fresh (with the declarative UniqueConstraint)

      try:
          with engine_.begin() as conn:
              # Delete every row that is NOT the surviving (latest) row for its
              # (user_id, movie_id). Survivor = max last_watched_at, tie-break max id.
              # Correlated NOT EXISTS works identically on Postgres and SQLite.
              conn.execute(text(
                  f"""
                  DELETE FROM {table} AS p
                  WHERE EXISTS (
                      SELECT 1 FROM {table} AS q
                      WHERE q.user_id = p.user_id
                        AND q.movie_id = p.movie_id
                        AND (
                            q.last_watched_at > p.last_watched_at
                            OR (q.last_watched_at = p.last_watched_at AND q.id > p.id)
                        )
                  )
                  """
              ))
      except Exception as e:
          # SQLite older syntax does not accept the "AS p" table alias in DELETE.
          # Retry without the alias (Postgres accepts both; this form is portable).
          logger.warning(f"Aliased dedup DELETE failed ({e}); retrying unaliased")
          with engine_.begin() as conn:
              conn.execute(text(
                  f"""
                  DELETE FROM {table}
                  WHERE EXISTS (
                      SELECT 1 FROM {table} AS q
                      WHERE q.user_id = {table}.user_id
                        AND q.movie_id = {table}.movie_id
                        AND (
                            q.last_watched_at > {table}.last_watched_at
                            OR (q.last_watched_at = {table}.last_watched_at
                                AND q.id > {table}.id)
                        )
                  )
                  """
              ))

      try:
          with engine_.begin() as conn:
              conn.execute(text(
                  f"CREATE UNIQUE INDEX IF NOT EXISTS uq_user_movie_progress "
                  f"ON {table} (user_id, movie_id)"
              ))
          logger.info("Ensured unique index uq_user_movie_progress(user_id, movie_id)")
      except Exception as e:
          logger.warning(f"Could not create unique index uq_user_movie_progress: {e}")
  ```
  > Note: the unaliased retry exists because SQLite versions before 3.33 reject the `DELETE FROM t AS p` alias form, while Postgres accepts both; the unaliased body is portable across both engines.

- [ ] **Step 4: Wire `sync_indexes()` into `init_db()`.**
  In `backend/app/database/session.py`, replace the current `init_db` body (lines 158-163):
  ```python
  def init_db():
      """Initialize the database tables."""
      Base.metadata.create_all(bind=engine)
      # Apply additive column migrations for tables that pre-date newer model columns.
      sync_columns(engine)
      logger.info("Database tables created")
  ```
  with:
  ```python
  def init_db():
      """Initialize the database tables."""
      Base.metadata.create_all(bind=engine)
      # Apply additive column migrations for tables that pre-date newer model columns.
      sync_columns(engine)
      # Create indexes/unique constraints that sync_columns cannot (dedup-then-create).
      sync_indexes(engine)
      logger.info("Database tables created")
  ```

- [ ] **Step 5: Run the tests and watch them PASS.**
  ```bash
  docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest tests/test_sync_indexes.py -v
  ```
  Expected: PASS (3 passed).

- [ ] **Step 6: Commit.**
  ```bash
  git add backend/app/database/session.py backend/tests/test_sync_indexes.py
  git commit -m "feat(db): add sync_indexes() dedup + unique index on (user_id, movie_id)"
  ```

---

### Task W7.3 — Atomic dialect-aware upsert for streaming progress

Replaces the read-then-write block in `create_streaming_progress` (`api/streaming.py` lines 244-277) with an atomic `INSERT ... ON CONFLICT (user_id, movie_id) DO UPDATE` using the dialect-specific insert construct, plus a `try/except IntegrityError → update` fallback. Lives in a small testable helper so concurrency can be exercised in unit tests.

**Files:**
- Create: `backend/app/services/progress_upsert.py` (new)
- Modify: `backend/app/api/streaming.py` (imports lines 14-22; upsert block lines 244-277)
- Test: `backend/tests/test_progress_upsert.py` (new)

**Interfaces:**
- Consumes: `UserStreamingProgress` (with uq from W7.1/W7.2); the unique index `uq_user_movie_progress`.
- Produces:
  - `def upsert_progress(session, *, user_id: str, movie_id: str, torrent_id: Optional[str], current_time: float, duration: Optional[float], percentage: float, completed: bool, file_index: Optional[int], title: Optional[str], content_id: Optional[str]) -> UserStreamingProgress` in `backend/app/services/progress_upsert.py`. Atomically inserts-or-updates the single row for `(user_id, movie_id)`, sets `last_watched_at = now()`, returns the persisted ORM row (re-queried). Dialect-aware (PostgreSQL/SQLite `ON CONFLICT`), with `IntegrityError`→update fallback.

**Steps:**

- [ ] **Step 1: Write failing tests — insert path, update path, and concurrent-insert path.**
  Create `backend/tests/test_progress_upsert.py`:
  ```python
  import datetime

  from sqlalchemy import create_engine
  from sqlalchemy.orm import sessionmaker

  from app.database.session import Base, sync_indexes
  from app.database.models import UserStreamingProgress
  from app.services.progress_upsert import upsert_progress


  def _engine(tmp_path):
      eng = create_engine(f"sqlite:///{tmp_path / 'up.db'}")
      # Only create the progress table (avoid FK deps on users/torrents in this unit test).
      UserStreamingProgress.__table__.create(bind=eng)
      sync_indexes(eng)
      return eng

  def _kwargs(**over):
      base = dict(
          user_id="u1", movie_id="movie:1", torrent_id=None,
          current_time=10.0, duration=100.0, percentage=10.0,
          completed=False, file_index=None, title="X", content_id="movie:1",
      )
      base.update(over)
      return base


  def test_upsert_inserts_then_updates_same_row(tmp_path):
      eng = _engine(tmp_path)
      Session = sessionmaker(bind=eng)

      s1 = Session()
      row = upsert_progress(s1, **_kwargs(current_time=10.0))
      s1.commit()
      first_id = row.id
      s1.close()

      s2 = Session()
      row2 = upsert_progress(s2, **_kwargs(current_time=55.0, percentage=55.0))
      s2.commit()
      s2.close()

      s3 = Session()
      all_rows = s3.query(UserStreamingProgress).all()
      assert len(all_rows) == 1                 # upsert, not a second insert
      assert all_rows[0].id == first_id         # same row reused
      assert all_rows[0].current_time == 55.0   # value updated
      s3.close()


  def test_upsert_survives_concurrent_insert(tmp_path):
      """Two sessions racing the SAME (user, movie) must end with exactly one row."""
      eng = _engine(tmp_path)
      Session = sessionmaker(bind=eng)

      sa = Session()
      sb = Session()
      # Both prepare an insert for the same key before either commits.
      ra = upsert_progress(sa, **_kwargs(current_time=1.0))
      rb = upsert_progress(sb, **_kwargs(current_time=2.0))
      sa.commit()
      sb.commit()
      sa.close()
      sb.close()

      sc = Session()
      rows = sc.query(UserStreamingProgress).all()
      assert len(rows) == 1
      sc.close()
  ```

- [ ] **Step 2: Run the tests and watch them FAIL.**
  ```bash
  docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest tests/test_progress_upsert.py -v
  ```
  Expected: FAIL — `ModuleNotFoundError: No module named 'app.services.progress_upsert'`.

- [ ] **Step 3: Implement the atomic upsert helper.**
  Create `backend/app/services/progress_upsert.py`:
  ```python
  """Atomic, dialect-aware upsert for UserStreamingProgress keyed by (user_id, movie_id).

  Replaces a read-then-write that raced under concurrent player heartbeats. Relies on the
  unique index uq_user_movie_progress(user_id, movie_id) created by sync_indexes().
  """
  import datetime
  import uuid
  from typing import Optional

  from sqlalchemy.exc import IntegrityError
  from sqlalchemy.orm import Session
  from sqlalchemy.dialects.postgresql import insert as pg_insert
  from sqlalchemy.dialects.sqlite import insert as sqlite_insert

  from app.database.models import UserStreamingProgress


  def upsert_progress(
      session: Session,
      *,
      user_id: str,
      movie_id: str,
      torrent_id: Optional[str],
      current_time: float,
      duration: Optional[float],
      percentage: float,
      completed: bool,
      file_index: Optional[int],
      title: Optional[str],
      content_id: Optional[str],
  ) -> UserStreamingProgress:
      now = datetime.datetime.now(datetime.timezone.utc)
      values = dict(
          id=str(uuid.uuid4()),
          user_id=user_id,
          movie_id=movie_id,
          torrent_id=torrent_id,
          current_time=current_time,
          duration=duration,
          percentage=percentage,
          completed=completed,
          file_index=file_index,
          title=title,
          content_id=content_id,
          last_watched_at=now,
      )
      update_cols = dict(
          torrent_id=torrent_id,
          current_time=current_time,
          duration=duration,
          percentage=percentage,
          completed=completed,
          file_index=file_index,
          title=title,
          content_id=content_id,
          last_watched_at=now,
      )

      dialect = session.bind.dialect.name
      table = UserStreamingProgress.__table__

      try:
          if dialect == "postgresql":
              stmt = pg_insert(table).values(**values)
              stmt = stmt.on_conflict_do_update(
                  index_elements=["user_id", "movie_id"],
                  set_=update_cols,
              )
              session.execute(stmt)
          elif dialect == "sqlite":
              stmt = sqlite_insert(table).values(**values)
              stmt = stmt.on_conflict_do_update(
                  index_elements=["user_id", "movie_id"],
                  set_=update_cols,
              )
              session.execute(stmt)
          else:
              # Generic fallback for any other backend: insert, else update on conflict.
              _fallback_upsert(session, values, update_cols, user_id, movie_id)
      except IntegrityError:
          session.rollback()
          _fallback_upsert(session, values, update_cols, user_id, movie_id)

      session.flush()
      return (
          session.query(UserStreamingProgress)
          .filter(
              UserStreamingProgress.user_id == user_id,
              UserStreamingProgress.movie_id == movie_id,
          )
          .first()
      )


  def _fallback_upsert(session, values, update_cols, user_id, movie_id) -> None:
      existing = (
          session.query(UserStreamingProgress)
          .filter(
              UserStreamingProgress.user_id == user_id,
              UserStreamingProgress.movie_id == movie_id,
          )
          .first()
      )
      if existing:
          for k, v in update_cols.items():
              setattr(existing, k, v)
          session.add(existing)
      else:
          session.add(UserStreamingProgress(**values))
  ```

- [ ] **Step 4: Run the tests and watch them PASS.**
  ```bash
  docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest tests/test_progress_upsert.py -v
  ```
  Expected: PASS (2 passed).

- [ ] **Step 5: Wire the helper into the endpoint.**
  In `backend/app/api/streaming.py`, add the import. Replace the current line 21:
  ```python
  from app.services.content_id import build_content_id
  ```
  with:
  ```python
  from app.services.content_id import build_content_id
  from app.services.progress_upsert import upsert_progress
  ```
  Then replace the entire read-then-write block (lines 244-277):
  ```python
          # Upsert by (content_id, user): one row per movie/episode, even for a
          # season pack whose many episodes share a single torrent_id.
          existing_progress = UserStreamingProgress.get_by_movie_and_user(
              session, progress.movie_id, user_id
          )

          if existing_progress:
              existing_progress.torrent_id = progress.torrent_id
              existing_progress.current_time = progress.current_time
              existing_progress.duration = progress.duration
              existing_progress.percentage = progress.percentage
              existing_progress.completed = progress.completed
              existing_progress.file_index = progress.file_index
              existing_progress.title = progress.title
              existing_progress.last_watched_at = datetime.datetime.now()
              session.commit()
              session.refresh(existing_progress)
              return StreamingProgressResponse(**existing_progress.to_dict())
          else:
              new_progress = UserStreamingProgress(
                  user_id=user_id,
                  torrent_id=progress.torrent_id,
                  movie_id=progress.movie_id,
                  current_time=progress.current_time,
                  duration=progress.duration,
                  percentage=progress.percentage,
                  completed=progress.completed,
                  file_index=progress.file_index,
                  title=progress.title,
              )
              session.add(new_progress)
              session.commit()
              session.refresh(new_progress)
              return StreamingProgressResponse(**new_progress.to_dict())
  ```
  with:
  ```python
          # Atomic upsert keyed by (user_id, movie_id): one row per movie/episode, even
          # for a season pack whose many episodes share a single torrent_id. Relies on
          # the unique index uq_user_movie_progress created by sync_indexes().
          row = upsert_progress(
              session,
              user_id=user_id,
              movie_id=progress.movie_id,
              torrent_id=progress.torrent_id,
              current_time=progress.current_time,
              duration=progress.duration,
              percentage=progress.percentage,
              completed=progress.completed,
              file_index=progress.file_index,
              title=progress.title,
              content_id=progress.movie_id,
          )
          session.commit()
          session.refresh(row)
          return StreamingProgressResponse(**row.to_dict())
  ```

- [ ] **Step 6: Confirm the endpoint module still imports cleanly and the broader streaming/progress tests pass.**
  ```bash
  docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest tests/test_progress_upsert.py tests/test_streaming_unique.py -v
  ```
  Expected: PASS (4 passed). Also verify the API module imports:
  ```bash
  docker compose run --rm backend python -c "import app.api.streaming"
  ```
  Expected: no output, exit 0.

- [ ] **Step 7: Commit.**
  ```bash
  git add backend/app/services/progress_upsert.py backend/app/api/streaming.py backend/tests/test_progress_upsert.py
  git commit -m "feat(streaming): atomic ON CONFLICT upsert for progress (no read-then-write race)"
  ```

---

### Task W7.4 — `content_id` resolver with full fallback chain + precompute column on `Torrent`

Adds a deterministic resolver `resolve_content_id(...)` so progress is **never orphaned under `None`**: it reads stored season/episode → falls back to filename parse → falls back to a deterministic `file_index`-based id. Also adds a nullable `precomputed_episodes` JSON column to the `Torrent` ORM (additive via `sync_columns`) to cache per-file `(file_index → season, episode)` once metadata is known.

**Files:**
- Modify: `backend/app/services/content_id.py` (whole file, lines 1-15)
- Modify: `backend/app/database/models/torrents.py` (imports line 1-4; `Torrent` class metadata block lines 27-31)
- Test: `backend/tests/test_content_id_resolver.py` (new)

**Interfaces:**
- Consumes: `build_content_id(media_type, tmdb_id, season, episode) -> Optional[str]` (existing), `parse_episode(name) -> Optional[Tuple[int,int]]` (existing, `app/providers/episodes.py`).
- Produces:
  - `Torrent.precomputed_episodes` — nullable `Column(JSON)`: a mapping `{"<file_index>": {"season": int, "episode": int}}` populated by Task W7.5.
  - `def resolve_content_id(*, media_type: Optional[str], tmdb_id: Optional[int], season: Optional[int], episode: Optional[int], file_name: Optional[str], file_index: Optional[int], precomputed: Optional[dict]) -> Optional[str]` in `backend/app/services/content_id.py`. Resolution order: (1) stored `season`/`episode`; (2) `precomputed[str(file_index)]`; (3) `parse_episode(file_name)`; (4) deterministic fallback `tv:{tmdb_id}:s0:e{file_index}` for unidentifiable TV episodes (so a misnamed file is still keyed, never `None`), or `build_content_id` for movies.

**Steps:**

- [ ] **Step 1: Write failing tests for the resolver fallback chain.**
  Create `backend/tests/test_content_id_resolver.py`:
  ```python
  from app.services.content_id import resolve_content_id


  def test_movie_uses_build_content_id():
      assert resolve_content_id(
          media_type="movie", tmdb_id=603, season=None, episode=None,
          file_name="The.Matrix.1999.mkv", file_index=0, precomputed=None,
      ) == "movie:603"


  def test_tv_uses_stored_season_episode_first():
      assert resolve_content_id(
          media_type="tv", tmdb_id=76479, season=1, episode=3,
          file_name="whatever.mkv", file_index=4, precomputed={"4": {"season": 2, "episode": 9}},
      ) == "tv:76479:s1:e3"


  def test_tv_uses_precomputed_when_no_stored_episode():
      assert resolve_content_id(
          media_type="tv", tmdb_id=76479, season=None, episode=None,
          file_name="badname.mkv", file_index=4, precomputed={"4": {"season": 2, "episode": 9}},
      ) == "tv:76479:s2:e9"


  def test_tv_parses_filename_when_no_stored_no_precompute():
      assert resolve_content_id(
          media_type="tv", tmdb_id=76479, season=None, episode=None,
          file_name="The.Boys.S01E03.1080p.mkv", file_index=2, precomputed=None,
      ) == "tv:76479:s1:e3"


  def test_tv_misnamed_file_falls_back_to_file_index_never_none():
      # No stored S/E, no precompute, filename has no parseable S/E -> deterministic fallback.
      cid = resolve_content_id(
          media_type="tv", tmdb_id=76479, season=None, episode=None,
          file_name="random_release_group_file.mkv", file_index=7, precomputed=None,
      )
      assert cid == "tv:76479:s0:e7"
      assert cid is not None


  def test_no_tmdb_id_is_none():
      assert resolve_content_id(
          media_type="tv", tmdb_id=None, season=1, episode=3,
          file_name="x.mkv", file_index=0, precomputed=None,
      ) is None
  ```

- [ ] **Step 2: Run the tests and watch them FAIL.**
  ```bash
  docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest tests/test_content_id_resolver.py -v
  ```
  Expected: FAIL — `ImportError: cannot import name 'resolve_content_id' from 'app.services.content_id'`.

- [ ] **Step 3: Implement `resolve_content_id`.**
  In `backend/app/services/content_id.py`, replace the whole file (lines 1-15):
  ```python
  """Build a stable watch-identity string for progress / continue-watching."""
  from typing import Optional


  def build_content_id(media_type: Optional[str], tmdb_id: Optional[int],
                       season: Optional[int], episode: Optional[int]) -> Optional[str]:
      """movie:{id} for movies; tv:{id}:s{n}:e{m} for an episode; None if not identifiable."""
      if not tmdb_id:
          return None
      if media_type == "tv":
          if season is None or episode is None:
              return None
          return f"tv:{tmdb_id}:s{season}:e{episode}"
      return f"movie:{tmdb_id}"
  ```
  with:
  ```python
  """Build a stable watch-identity string for progress / continue-watching."""
  from typing import Optional

  from app.providers.episodes import parse_episode


  def build_content_id(media_type: Optional[str], tmdb_id: Optional[int],
                       season: Optional[int], episode: Optional[int]) -> Optional[str]:
      """movie:{id} for movies; tv:{id}:s{n}:e{m} for an episode; None if not identifiable."""
      if not tmdb_id:
          return None
      if media_type == "tv":
          if season is None or episode is None:
              return None
          return f"tv:{tmdb_id}:s{season}:e{episode}"
      return f"movie:{tmdb_id}"


  def resolve_content_id(
      *,
      media_type: Optional[str],
      tmdb_id: Optional[int],
      season: Optional[int],
      episode: Optional[int],
      file_name: Optional[str],
      file_index: Optional[int],
      precomputed: Optional[dict],
  ) -> Optional[str]:
      """Resolve a content_id with a full fallback chain so progress is never orphaned.

      Order:
        1. stored season/episode on the torrent (build_content_id);
        2. precomputed[str(file_index)] season/episode (cached at metadata time);
        3. parse_episode(file_name);
        4. deterministic fallback for unidentifiable TV files: tv:{tmdb_id}:s0:e{file_index}.
      Movies: always build_content_id (returns None only when tmdb_id is missing).
      """
      if not tmdb_id:
          return None

      # Movies never need episode resolution.
      if media_type != "tv":
          return build_content_id(media_type, tmdb_id, None, None)

      # 1) Stored season/episode.
      if season is not None and episode is not None:
          return build_content_id("tv", tmdb_id, season, episode)

      # 2) Precomputed per-file mapping.
      if precomputed and file_index is not None:
          entry = precomputed.get(str(file_index))
          if entry and entry.get("season") is not None and entry.get("episode") is not None:
              return build_content_id("tv", tmdb_id, entry["season"], entry["episode"])

      # 3) Filename parse.
      if file_name:
          parsed = parse_episode(file_name)
          if parsed:
              return build_content_id("tv", tmdb_id, parsed[0], parsed[1])

      # 4) Deterministic fallback so a misnamed file is still keyed (never None).
      if file_index is not None:
          return f"tv:{tmdb_id}:s0:e{file_index}"

      return None
  ```

- [ ] **Step 4: Run the resolver tests AND the existing content_id tests together (no regression) and watch them PASS.**
  ```bash
  docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest tests/test_content_id_resolver.py tests/test_content_id.py -v
  ```
  Expected: PASS (10 passed).

- [ ] **Step 5: Add the additive `precomputed_episodes` JSON column to `Torrent`.**
  In `backend/app/database/models/torrents.py`, replace the current media-identity block (lines 27-31):
  ```python
      # Media identity (for content_id / continue-watching)
      tmdb_id = Column(Integer, nullable=True, index=True)
      media_type = Column(String, nullable=True)   # 'movie' | 'tv'
      season = Column(Integer, nullable=True)
      episode = Column(Integer, nullable=True)
  ```
  with:
  ```python
      # Media identity (for content_id / continue-watching)
      tmdb_id = Column(Integer, nullable=True, index=True)
      media_type = Column(String, nullable=True)   # 'movie' | 'tv'
      season = Column(Integer, nullable=True)
      episode = Column(Integer, nullable=True)
      # Per-file episode map cached once metadata is known: {"<file_index>": {"season": int,
      # "episode": int}}. Nullable + additive -> applied by sync_columns on existing DBs.
      precomputed_episodes = Column(JSON, nullable=True)
  ```
  (`JSON` is already imported on line 3 of this file.)

- [ ] **Step 6: Verify the column is declared and the model still imports.**
  ```bash
  docker compose run --rm backend python -c "from app.database.models import Torrent; assert 'precomputed_episodes' in Torrent.__table__.columns; print('ok')"
  ```
  Expected: `ok`.

- [ ] **Step 7: Commit.**
  ```bash
  git add backend/app/services/content_id.py backend/app/database/models/torrents.py backend/tests/test_content_id_resolver.py
  git commit -m "feat(streaming): resolve_content_id fallback chain + precomputed_episodes column"
  ```

---

### Task W7.5 — Precompute season/episode per file when metadata is known

Adds `precompute_episode_map(self, torrent_id)` to `TorrentManager`, which builds `{file_index: {season, episode}}` from `get_video_files(...)` via `parse_episode`, and calls it from the `metadata_received_alert` handler so the `Torrent.precomputed_episodes` column is filled as soon as files are known.

**Files:**
- Modify: `backend/app/torrent/manager.py` (`metadata_received_alert` block lines 406-425; add new method after `get_video_files` which ends line 907)
- Test: `backend/tests/test_precompute_episodes.py` (new)

**Interfaces:**
- Consumes: `TorrentManager.get_video_files(torrent_id) -> List[Dict]` (returns dicts with `index`, `name`), `parse_episode(name)`.
- Produces:
  - `def precompute_episode_map(self, torrent_id: str) -> dict` on `TorrentManager` — returns `{str(file_index): {"season": int, "episode": int}}` for every video file whose name parses to a season/episode, and persists it onto `Torrent.precomputed_episodes` in its own `get_db()` session. Returns `{}` when no files parse.

**Steps:**

- [ ] **Step 1: Write a failing test that exercises `precompute_episode_map` against a fake-files manager.**
  Create `backend/tests/test_precompute_episodes.py`:
  ```python
  from app.torrent.manager import TorrentManager


  class _FakeMgr(TorrentManager):
      """Subclass that bypasses libtorrent: stub get_video_files + persistence."""
      def __init__(self, files):
          self._files = files
          self.persisted = None

      def get_video_files(self, torrent_id):  # override, no libtorrent
          return self._files

      def _persist_episode_map(self, torrent_id, mapping):  # capture instead of DB write
          self.persisted = mapping


  def test_precompute_maps_parseable_files():
      mgr = _FakeMgr([
          {"index": 0, "name": "Show.S01E01.1080p.mkv"},
          {"index": 1, "name": "Show.S01E02.1080p.mkv"},
          {"index": 5, "name": "random_no_episode.mkv"},
      ])
      mapping = mgr.precompute_episode_map("t1")
      assert mapping == {
          "0": {"season": 1, "episode": 1},
          "1": {"season": 1, "episode": 2},
      }
      assert mgr.persisted == mapping  # also persisted


  def test_precompute_empty_when_nothing_parses():
      mgr = _FakeMgr([{"index": 0, "name": "movie_release.mkv"}])
      assert mgr.precompute_episode_map("t1") == {}
  ```
  > Note: this test refactors persistence into a `_persist_episode_map` seam so the parse logic is testable without a DB or libtorrent. The seam is implemented in Step 3.

- [ ] **Step 2: Run the test and watch it FAIL.**
  ```bash
  docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest tests/test_precompute_episodes.py -v
  ```
  Expected: FAIL — `AttributeError: 'TorrentManager' object has no attribute 'precompute_episode_map'` (and no `_persist_episode_map`).

- [ ] **Step 3: Implement `precompute_episode_map` + `_persist_episode_map`.**
  In `backend/app/torrent/manager.py`, immediately after `get_video_files` ends (after line 907, before `def get_video_file_info(` on line 909), add:
  ```python
      def precompute_episode_map(self, torrent_id: str) -> dict:
          """Build {str(file_index): {season, episode}} from parseable video file names
          and persist it on the Torrent row. Returns the mapping ({} if nothing parses)."""
          mapping: dict = {}
          for f in self.get_video_files(torrent_id):
              ep = parse_episode(f["name"])
              if ep:
                  mapping[str(f["index"])] = {"season": ep[0], "episode": ep[1]}
          if mapping:
              self._persist_episode_map(torrent_id, mapping)
          return mapping

      def _persist_episode_map(self, torrent_id: str, mapping: dict) -> None:
          """Persist the precomputed episode map onto the Torrent row (own session)."""
          try:
              with get_db() as db:
                  torrent = db.query(DbTorrent).filter(DbTorrent.id == torrent_id).first()
                  if torrent is not None:
                      torrent.precomputed_episodes = mapping
                      db.commit()
          except Exception as e:
              logger.warning(f"Could not persist episode map for {torrent_id}: {e}")
  ```
  Then add the import for `parse_episode` near the top of `manager.py`. Confirm it is imported (run first):
  ```bash
  grep -n "from app.providers.episodes import parse_episode\|^import\|^from" backend/app/torrent/manager.py | head
  ```
  If `parse_episode` is not already imported, add this import line beside the other `from app...` imports at the top of the file:
  ```python
  from app.providers.episodes import parse_episode
  ```

- [ ] **Step 4: Run the test and watch it PASS.**
  ```bash
  docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest tests/test_precompute_episodes.py -v
  ```
  Expected: PASS (2 passed).

- [ ] **Step 5: Trigger precompute from the `metadata_received_alert` handler.**
  In `backend/app/torrent/manager.py`, replace the current handler body (lines 406-425):
  ```python
          elif isinstance(alert, lt.metadata_received_alert):
              torrent_handle = alert.handle
              
              for torrent_id, (handle, _) in self.active_torrents.items():
                  if handle == torrent_handle:
                      logger.info(f"Received metadata for torrent {torrent_id}")
                      # Update database to indicate we have metadata
                      with get_db() as db:
                          torrent = db.query(DbTorrent).filter(DbTorrent.id == torrent_id).first()
                          if torrent and torrent.state == 'downloading_metadata':
                              torrent.state = 'downloading'
                              log = TorrentLog(
                                  torrent_id=torrent_id,
                                  message="Metadata received, starting download",
                                  level="INFO",
                                  state='downloading'
                              )
                              db.add(log)
                              db.commit()
                      break
  ```
  with:
  ```python
          elif isinstance(alert, lt.metadata_received_alert):
              torrent_handle = alert.handle
              
              for torrent_id, (handle, _) in self.active_torrents.items():
                  if handle == torrent_handle:
                      logger.info(f"Received metadata for torrent {torrent_id}")
                      # Update database to indicate we have metadata
                      with get_db() as db:
                          torrent = db.query(DbTorrent).filter(DbTorrent.id == torrent_id).first()
                          if torrent and torrent.state == 'downloading_metadata':
                              torrent.state = 'downloading'
                              log = TorrentLog(
                                  torrent_id=torrent_id,
                                  message="Metadata received, starting download",
                                  level="INFO",
                                  state='downloading'
                              )
                              db.add(log)
                              db.commit()
                      # Files are now known: cache per-file season/episode so content_id
                      # resolution never depends on a per-request filename parse.
                      try:
                          self.precompute_episode_map(torrent_id)
                      except Exception as e:
                          logger.warning(f"Episode precompute failed for {torrent_id}: {e}")
                      break
  ```

- [ ] **Step 6: Re-run the precompute test and confirm the manager still imports.**
  ```bash
  docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest tests/test_precompute_episodes.py -v
  docker compose run --rm backend python -c "import app.torrent.manager"
  ```
  Expected: tests PASS (2 passed); import prints nothing, exit 0.

- [ ] **Step 7: Commit.**
  ```bash
  git add backend/app/torrent/manager.py backend/tests/test_precompute_episodes.py
  git commit -m "feat(torrent): precompute per-file season/episode map on metadata_received"
  ```

---

### Task W7.6 — Use the resolver + precomputed map in the `info` endpoint

Replaces the per-request filename-parse content_id derivation in `get_video_info` (`api/streaming.py` lines 159-171) with `resolve_content_id(...)`, reading the torrent's stored `season`/`episode` and `precomputed_episodes` first so a misnamed file never orphans progress under `None`.

**Files:**
- Modify: `backend/app/api/streaming.py` (imports line 20-21; content_id block lines 159-171)
- Test: `backend/tests/test_info_content_id.py` (new)

**Interfaces:**
- Consumes: `resolve_content_id(...)` (Task W7.4), `Torrent.precomputed_episodes` (Task W7.4/W7.5).
- Produces: no new public symbol; behavioral guarantee that `get_video_info` returns a non-`None` `content_id` for any identifiable torrent (tmdb_id present), even for a season-pack file whose name does not parse.

**Steps:**

- [ ] **Step 1: Write a failing test for the resolver-backed derivation logic used by the endpoint.**
  This test exercises the exact resolution the endpoint performs (resolver fed from a Torrent row), proving the misnamed-file path yields a deterministic id. Create `backend/tests/test_info_content_id.py`:
  ```python
  from types import SimpleNamespace

  from app.services.content_id import resolve_content_id


  def _resolve_for_torrent(row, file_name, file_index):
      """Mirror of get_video_info's content_id derivation (single source: resolve_content_id)."""
      return resolve_content_id(
          media_type=row.media_type,
          tmdb_id=row.tmdb_id,
          season=row.season,
          episode=row.episode,
          file_name=file_name,
          file_index=file_index,
          precomputed=row.precomputed_episodes,
      )


  def test_season_pack_uses_precomputed_over_filename():
      row = SimpleNamespace(
          media_type="tv", tmdb_id=1399, season=None, episode=None,
          precomputed_episodes={"3": {"season": 4, "episode": 9}},
      )
      assert _resolve_for_torrent(row, "garbled.mkv", 3) == "tv:1399:s4:e9"


  def test_misnamed_file_never_none():
      row = SimpleNamespace(
          media_type="tv", tmdb_id=1399, season=None, episode=None,
          precomputed_episodes=None,
      )
      cid = _resolve_for_torrent(row, "no_episode_marker.mkv", 6)
      assert cid is not None
      assert cid == "tv:1399:s0:e6"


  def test_movie_uses_tmdb_id():
      row = SimpleNamespace(
          media_type="movie", tmdb_id=603, season=None, episode=None,
          precomputed_episodes=None,
      )
      assert _resolve_for_torrent(row, "the.matrix.mkv", 0) == "movie:603"
  ```

- [ ] **Step 2: Run the test and watch it FAIL.**
  ```bash
  docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest tests/test_info_content_id.py -v
  ```
  Expected: FAIL only if W7.4 is not yet merged; if W7.4 is merged this test would already pass at the resolver level. To make this task self-contained and red→green at the **endpoint** level, proceed to Step 3 regardless — the endpoint change is the deliverable; the test pins the resolution contract the endpoint relies on. (If the test already passes here because W7.4 landed, that confirms the contract; the FAIL→PASS gate for this task is the endpoint import + diff verified in Step 5.)

- [ ] **Step 3: Import the resolver in the streaming API.**
  In `backend/app/api/streaming.py`, replace the current import lines 20-21:
  ```python
  from app.providers.episodes import parse_episode
  from app.services.content_id import build_content_id
  ```
  with:
  ```python
  from app.providers.episodes import parse_episode
  from app.services.content_id import build_content_id, resolve_content_id
  ```
  (Keep the `build_content_id` and `parse_episode` imports; `list_video_files` at lines 198-219 still uses `parse_episode`, and Task W7.3's `upsert_progress` import added on line 22 stays.)

- [ ] **Step 4: Replace the per-request derivation in `get_video_info`.**
  In `backend/app/api/streaming.py`, replace the current content_id block (lines 159-171):
  ```python
      # Resolve the watch identity (content_id) for progress / continue-watching.
      content_id = None
      season = episode = None
      with get_db() as db:
          row = db.query(Torrent).filter(Torrent.id == torrent_id).first()
          if row:
              season, episode = row.season, row.episode
              # Season pack (no per-episode on the torrent): derive from the streamed file.
              if row.media_type == "tv" and episode is None:
                  ep = parse_episode(video_info["name"])
                  if ep:
                      season, episode = ep
              content_id = build_content_id(row.media_type, row.tmdb_id, season, episode)
  ```
  with:
  ```python
      # Resolve the watch identity (content_id) for progress / continue-watching.
      # Full fallback chain (stored S/E -> precomputed map -> filename parse ->
      # deterministic file_index) so progress is never orphaned under None.
      content_id = None
      season = episode = None
      file_idx = file_index if file_index is not None else video_info.get("index")
      with get_db() as db:
          row = db.query(Torrent).filter(Torrent.id == torrent_id).first()
          if row:
              season, episode = row.season, row.episode
              # Surface the precomputed/parsed S/E in the response for season packs.
              if row.media_type == "tv" and episode is None:
                  pre = (row.precomputed_episodes or {}).get(str(file_idx))
                  if pre:
                      season, episode = pre.get("season"), pre.get("episode")
                  else:
                      ep = parse_episode(video_info["name"])
                      if ep:
                          season, episode = ep
              content_id = resolve_content_id(
                  media_type=row.media_type,
                  tmdb_id=row.tmdb_id,
                  season=row.season,
                  episode=row.episode,
                  file_name=video_info["name"],
                  file_index=file_idx,
                  precomputed=row.precomputed_episodes,
              )
  ```

- [ ] **Step 5: Run the test, confirm the endpoint imports, and run the full WS7 suite green.**
  ```bash
  docker compose run --rm backend python -c "import app.api.streaming"
  docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest tests/test_info_content_id.py tests/test_content_id_resolver.py tests/test_content_id.py tests/test_progress_upsert.py tests/test_sync_indexes.py tests/test_streaming_unique.py tests/test_precompute_episodes.py -v
  ```
  Expected: import prints nothing (exit 0); all WS7 tests PASS.

- [ ] **Step 6: Commit.**
  ```bash
  git add backend/app/api/streaming.py backend/tests/test_info_content_id.py
  git commit -m "feat(streaming): derive info content_id via resolve_content_id + precomputed map"
  ```

---

### Task W7.7 — Build the image and run the full backend suite (regression gate)

`sync_indexes()`, the new ORM column, and the resolver all run at startup / on every progress write. Bake everything into the image and run the entire suite to confirm no regression in the broader streaming/torrent tests (`test_streaming_pieces.py`, `test_torrents_manager.py`, `test_migrations.py`, etc.).

**Files:** none (verification-only task).

**Interfaces:** Consumes all WS7 artifacts. Produces nothing.

**Steps:**

- [ ] **Step 1: Rebuild the image so the new test files are baked in.**
  ```bash
  make build
  ```
  Expected: build completes successfully.

- [ ] **Step 2: Run the full backend test suite (baked-in, no mount).**
  ```bash
  docker compose run --rm backend python -m pytest -v
  ```
  Expected: PASS for all tests, including the seven WS7 files and the pre-existing `test_migrations.py`, `test_content_id.py`, `test_streaming_pieces.py`, `test_torrents_manager.py`.

- [ ] **Step 3: Verify `init_db()` runs `sync_indexes()` cleanly against the live Postgres (idempotent on a populated DB).**
  ```bash
  docker compose run --rm backend python -c "from app.database.session import init_db; init_db(); init_db()"
  ```
  Expected: no exception; logs show `Ensured unique index uq_user_movie_progress(user_id, movie_id)` (twice is fine — `CREATE UNIQUE INDEX IF NOT EXISTS` and the dedup pass are idempotent).

- [ ] **Step 4: No code change → no commit.** If Step 2 or Step 3 surfaces a failure, fix it in the owning task above (re-running that task's red→green→commit cycle) rather than patching here. This task is a gate, not a code change.

---

**Files touched by this workstream (all absolute under repo root `/Users/benjaminherro/github/freeflix`):**
- `backend/app/database/models/streaming.py` (uq constraint + `content_id` column)
- `backend/app/database/session.py` (`sync_indexes()` + `init_db` wiring)
- `backend/app/services/progress_upsert.py` (new — atomic upsert)
- `backend/app/services/content_id.py` (`resolve_content_id` + fallback chain)
- `backend/app/database/models/torrents.py` (`precomputed_episodes` column)
- `backend/app/torrent/manager.py` (`precompute_episode_map` + `metadata_received_alert` wiring)
- `backend/app/api/streaming.py` (atomic upsert in `create_streaming_progress`; resolver in `get_video_info`)
- Tests: `backend/tests/test_streaming_unique.py`, `test_sync_indexes.py`, `test_progress_upsert.py`, `test_content_id_resolver.py`, `test_precompute_episodes.py`, `test_info_content_id.py`
