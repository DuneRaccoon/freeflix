# TV Support — Stage C (Show-Level Continue-Watching) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Track watch progress per episode (and per file in a season pack) under a stable `content_id`, and show a show-grouped "Continue Watching" on the home page ("The Boys — Resume S2E3 · Up next S2E4").

**Architecture:** Persist the media identity (`tmdb_id`/`media_type`/`season`/`episode`) on the downloaded torrent so the streaming layer can compute a stable `content_id` (`movie:{tmdb_id}` / `tv:{tmdb_id}:s{n}:e{m}`); the video player saves progress keyed by that `content_id` (+ `file_index` for pack episodes, + a display `title`); the home page groups TV progress by show. Movie progress keeps working (content_id `movie:{tmdb_id}`).

**Tech Stack:** FastAPI, SQLAlchemy 1.4, pydantic v2, pytest; Next.js 15.

**Branch:** `feat/tv-support` (Stages A+B already on it).

---

## Conventions

- Stack running (backend `:8000`, frontend `:3001`); `./backend/app` + `./frontend` bind-mounted (hot reload).
- **RUNTEST:** `docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest tests/<file> -v`
- Frontend type-check: `docker compose exec -T frontend npx tsc --noEmit` (baseline clean).
- Commit per task with the `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` trailer. Stage only each task's files (never `git add .`/`-a`).
- DB tables are (re)created by `init_db()` on startup, so new columns appear after a backend restart/rebuild (dev DB; existing rows simply have NULLs for the new columns).

## File map

```
backend/app/
  database/models/torrents.py    # C1: + tmdb_id/media_type/season/episode columns
  database/models/streaming.py   # C1: + file_index, title columns
  models.py                      # C1: + file_index/title on StreamingProgress schemas
  services/content_id.py         # C2: NEW build_content_id (pure)
  torrent/manager.py             # C3: add_torrent stores media identity
  api/torrents.py                # C3: pass media identity to add_torrent
  api/streaming.py               # C4: /info returns content_id; C5: progress file_index/title + key-by-content_id
frontend/src/
  types/index.ts                 # C6: StreamingProgress + StreamingInfo gain content_id/file_index/title
  app/streaming/[id]/page.tsx    # C6: pass content_id + file_index to the player
  components/player/PatchedVideoPlayer.tsx  # C6: save movie_id=content_id, file_index, title
  context/ProgressContext.tsx    # C7: expose grouped data (or keep raw + group in the component)
  components/home/ContinueWatchingSection.tsx  # C7: group TV by show (Resume + Up next)
```

---

## Task C1: DB columns + progress schemas

**Files:** Modify `backend/app/database/models/torrents.py`, `backend/app/database/models/streaming.py`, `backend/app/models.py`; Test `backend/tests/test_stagec_models.py`

- [ ] **Step 1: Write the failing test** — create `backend/tests/test_stagec_models.py`:

```python
import os
os.environ.setdefault("DB_PATH", "/tmp/test_stagec.db")

from app.database.session import Base, engine, get_db
from app.database.models.torrents import Torrent
from app.database.models.streaming import UserStreamingProgress
from app.models import StreamingProgressCreate


def setup_module(_):
    Base.metadata.create_all(bind=engine)


def test_torrent_has_media_identity_columns():
    cols = {c.name for c in Torrent.__table__.columns}
    assert {"tmdb_id", "media_type", "season", "episode"} <= cols


def test_progress_has_file_index_and_title_columns():
    cols = {c.name for c in UserStreamingProgress.__table__.columns}
    assert {"file_index", "title"} <= cols


def test_progress_create_schema_fields():
    p = StreamingProgressCreate(torrent_id="t", movie_id="tv:76479:s1:e3",
                                current_time=10.0, percentage=5.0, file_index=2, title="The Boys S01E03")
    assert p.file_index == 2 and p.title == "The Boys S01E03"
    # backward-compatible (omittable)
    p2 = StreamingProgressCreate(torrent_id="t", movie_id="movie:603", current_time=1, percentage=1)
    assert p2.file_index is None and p2.title is None
```

- [ ] **Step 2: Run to verify it fails** — RUNTEST `tests/test_stagec_models.py`. Expected: AssertionError (columns absent) or schema field error.

- [ ] **Step 3a: Add identity columns to `Torrent`** in `backend/app/database/models/torrents.py` (after the `sizes` column, before `# Status information`):
```python
    # Media identity (for content_id / continue-watching)
    tmdb_id = Column(Integer, nullable=True, index=True)
    media_type = Column(String, nullable=True)   # 'movie' | 'tv'
    season = Column(Integer, nullable=True)
    episode = Column(Integer, nullable=True)
```
(`Integer`/`String`/`Column` are already imported in that file.)

- [ ] **Step 3b: Add columns to `UserStreamingProgress`** in `backend/app/database/models/streaming.py` (after the `completed` column):
```python
    file_index = Column(Integer, nullable=True)  # which file in a (multi-file) torrent
    title = Column(String, nullable=True)        # human display title, e.g. "The Boys S01E03"
```

- [ ] **Step 3c: Add fields to the progress schemas** in `backend/app/models.py`. Find `StreamingProgressCreate` and `StreamingProgressResponse`. Add to **both** (after `completed`):
```python
    file_index: Optional[int] = None
    title: Optional[str] = None
```
(Leave `StreamingProgressUpdate` as-is.)

- [ ] **Step 4: Run to verify it passes** — RUNTEST `tests/test_stagec_models.py`. Expected: PASS (3 tests).

- [ ] **Step 5: Commit**
```bash
git add backend/app/database/models/torrents.py backend/app/database/models/streaming.py backend/app/models.py backend/tests/test_stagec_models.py
git commit -q -m "feat(db): torrent media identity + progress file_index/title columns"
```

---

## Task C2: content_id helper (`services/content_id.py`)

**Files:** Create `backend/app/services/content_id.py`; Test `backend/tests/test_content_id.py`

- [ ] **Step 1: Write the failing test** — create `backend/tests/test_content_id.py`:

```python
from app.services.content_id import build_content_id


def test_movie_content_id():
    assert build_content_id("movie", 603, None, None) == "movie:603"


def test_tv_episode_content_id():
    assert build_content_id("tv", 76479, 1, 3) == "tv:76479:s1:e3"


def test_tv_without_episode_is_none():
    # a show/season identity is not a watchable unit on its own
    assert build_content_id("tv", 76479, 1, None) is None


def test_missing_tmdb_id_is_none():
    assert build_content_id("movie", None, None, None) is None
    assert build_content_id("tv", None, 1, 3) is None
```

- [ ] **Step 2: Run to verify it fails** — RUNTEST `tests/test_content_id.py`. Expected: `ModuleNotFoundError`.

- [ ] **Step 3: Implement `backend/app/services/content_id.py`:**

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

- [ ] **Step 4: Run to verify it passes** — RUNTEST `tests/test_content_id.py`. Expected: PASS (4 tests).

- [ ] **Step 5: Commit**
```bash
git add backend/app/services/content_id.py backend/tests/test_content_id.py
git commit -q -m "feat(services): build_content_id (movie/tv watch identity)"
```

---

## Task C3: Persist media identity at download

**Files:** Modify `backend/app/torrent/manager.py`, `backend/app/api/torrents.py`

The download already builds a `_DlMovie` and calls `add_torrent`. Thread the media identity (`tmdb_id`/`media_type`/`season`/`episode`) onto the `DbTorrent` row.

- [ ] **Step 1: Extend `_DlMovie`** in `backend/app/api/torrents.py` (the dataclass) to carry identity:
```python
@dataclass
class _DlMovie:
    title: str
    year: _Optional[int]
    genre: str
    tmdb_id: _Optional[int] = None
    media_type: str = "movie"
    season: _Optional[int] = None
    episode: _Optional[int] = None
```

- [ ] **Step 2: Populate it in `download_movie`.** Where the handler builds `dl_movie = _DlMovie(title=label, year=year, genre="")`, replace with:
```python
        dl_movie = _DlMovie(
            title=label, year=year, genre="",
            tmdb_id=request.tmdb_id, media_type=request.media_type,
            season=request.season, episode=request.episode,
        )
```

- [ ] **Step 3: Store identity in `add_torrent`** (`backend/app/torrent/manager.py`). In the `DbTorrent(...)` construction inside `add_torrent` (the `new_torrent = DbTorrent(...)` call), add these kwargs (read identity defensively so other callers — e.g. cron — still work):
```python
                new_torrent = DbTorrent(
                    id=torrent_id,
                    movie_title=movie.title,
                    quality=torrent.quality,
                    magnet=torrent.magnet,
                    url=str(torrent.url),
                    save_path=str(save_path),
                    sizes=torrent.sizes,
                    state='queued',
                    meta_data=metadata,
                    tmdb_id=getattr(movie, "tmdb_id", None),
                    media_type=getattr(movie, "media_type", "movie"),
                    season=getattr(movie, "season", None),
                    episode=getattr(movie, "episode", None),
                )
```

- [ ] **Step 4: Verify live** (rebuild needed for the new columns — `init_db` adds them on startup):
```bash
docker compose up -d --build backend && sleep 5
curl -s "http://localhost:8000/api/v1/tv/76479" >/dev/null
tid=$(curl -s -X POST http://localhost:8000/api/v1/torrents/download -H 'Content-Type: application/json' -d '{"tmdb_id":76479,"quality":"1080p","media_type":"tv","season":1,"episode":3}' | python3 -c "import sys,json;print(json.load(sys.stdin)['id'])")
docker compose exec -T backend python -c "
from app.database.session import get_db
from app.database.models.torrents import Torrent
with get_db() as db:
    t = db.query(Torrent).filter(Torrent.id=='$tid').first()
    print('identity:', t.media_type, t.tmdb_id, t.season, t.episode, '| title', t.movie_title)
"
curl -s -o /dev/null -X DELETE "http://localhost:8000/api/v1/torrents/$tid?delete_files=true"
```
Expected: `identity: tv 76479 1 3 | title The Boys S01E03`. Also confirm a movie download stores `movie 603 None None` (download `{"tmdb_id":603,"quality":"1080p"}` after caching Matrix, then check + delete).

- [ ] **Step 5: Commit**
```bash
git add backend/app/torrent/manager.py backend/app/api/torrents.py
git commit -q -m "feat(torrent): persist media identity (tmdb_id/media_type/season/episode) on downloads"
```

---

## Task C4: `/info` returns `content_id`

**Files:** Modify `backend/app/api/streaming.py`

- [ ] **Step 1: Add imports** (near the existing ones): `from app.services.content_id import build_content_id` and `from app.database.models import Torrent` (Torrent is already imported on line 16 via `from app.database.models import UserStreamingProgress, Torrent, MovieCache, User` — confirm; only add `build_content_id`).

- [ ] **Step 2: In `get_video_info`, compute and return `content_id`.** After `video_info = torrent_manager.get_video_file_info(torrent_id, file_index)` (and its None check), look up the torrent's identity and build the content_id, then add it to the returned dict:
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
Then in the returned dict (the `return { ... }`), add these keys alongside the existing ones:
```python
        "content_id": content_id,
        "season": season,
        "episode": episode,
        "file_index": file_index if file_index is not None else (video_info.get("index")),
```

- [ ] **Step 3: Verify live** (backend reloads):
```bash
sleep 2
curl -s "http://localhost:8000/api/v1/tv/76479" >/dev/null
tid=$(curl -s -X POST http://localhost:8000/api/v1/torrents/download -H 'Content-Type: application/json' -d '{"tmdb_id":76479,"quality":"1080p","media_type":"tv","season":1,"episode":5}' | python3 -c "import sys,json;print(json.load(sys.stdin)['id'])")
for i in $(seq 1 20); do curl -s "http://localhost:8000/api/v1/streaming/$tid/info" | python3 -c "import sys,json;d=json.load(sys.stdin);print('content_id',d.get('content_id'),'| s/e',d.get('season'),d.get('episode'))" 2>/dev/null && break; sleep 3; done
curl -s -o /dev/null -X DELETE "http://localhost:8000/api/v1/torrents/$tid?delete_files=true"
```
Expected (once metadata resolves): `content_id tv:76479:s1:e5 | s/e 1 5`. (If metadata is slow, note it; the logic is verified by the pack-file derivation + the single-episode identity columns.)

- [ ] **Step 4: Commit**
```bash
git add backend/app/api/streaming.py
git commit -q -m "feat(api): streaming /info returns content_id (+ season/episode/file_index)"
```

---

## Task C5: Progress — file_index/title + key by content_id

**Files:** Modify `backend/app/api/streaming.py`

The progress create currently upserts by `(torrent_id, user_id)` — wrong for a season pack (all episodes share one torrent). Key by `(movie_id=content_id, user_id)` and persist `file_index`/`title`.

- [ ] **Step 1: Rework `create_streaming_progress`.** Replace the body from `existing_progress = UserStreamingProgress.get_by_torrent_and_user(...)` through the create branch with:
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
            return StreamingProgressCreate(**existing_progress.to_dict())
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
            return StreamingProgressCreate(**new_progress.to_dict())
```

- [ ] **Step 2: Verify live** (backend reloads): save two episodes of the same show and confirm they are distinct rows (not overwriting each other), and that `file_index`/`title` round-trip. There must be a user — create one if needed:
```bash
sleep 2
uid=$(curl -s http://localhost:8000/api/v1/users | python3 -c "import sys,json;u=json.load(sys.stdin);print(u[0]['id'] if u else '')")
[ -z "$uid" ] && uid=$(curl -s -X POST http://localhost:8000/api/v1/users -H 'Content-Type: application/json' -d '{"username":"cwtest","display_name":"CW","avatar":"default.png"}' | python3 -c "import sys,json;print(json.load(sys.stdin)['id'])")
# need a real torrent id for the FK; reuse any from the list or download one episode:
tid=$(curl -s "http://localhost:8000/api/v1/tv/76479" >/dev/null; curl -s -X POST http://localhost:8000/api/v1/torrents/download -H 'Content-Type: application/json' -d '{"tmdb_id":76479,"quality":"1080p","media_type":"tv","season":1,"episode":1}' | python3 -c "import sys,json;print(json.load(sys.stdin)['id'])")
curl -s -X POST "http://localhost:8000/api/v1/streaming/progress/$uid" -H 'Content-Type: application/json' -d "{\"torrent_id\":\"$tid\",\"movie_id\":\"tv:76479:s1:e1\",\"current_time\":120,\"percentage\":20,\"file_index\":0,\"title\":\"The Boys S01E01\"}" >/dev/null
curl -s -X POST "http://localhost:8000/api/v1/streaming/progress/$uid" -H 'Content-Type: application/json' -d "{\"torrent_id\":\"$tid\",\"movie_id\":\"tv:76479:s1:e2\",\"current_time\":60,\"percentage\":10,\"file_index\":2,\"title\":\"The Boys S01E02\"}" >/dev/null
curl -s "http://localhost:8000/api/v1/streaming/progress/$uid?limit=10" | python3 -c "import sys,json;rows=json.load(sys.stdin);print('rows',len(rows));[print('  ',r['movie_id'],'| file',r.get('file_index'),'|',r.get('title'),'|',r['percentage'],'%') for r in rows]"
curl -s -o /dev/null -X DELETE "http://localhost:8000/api/v1/torrents/$tid?delete_files=true"
```
Expected: **two distinct rows** (`tv:76479:s1:e1` and `tv:76479:s1:e2`), each with its `file_index`/`title`/percentage. (Deleting the torrent cascades and removes the progress rows — that's fine for the test.)

- [ ] **Step 3: Commit**
```bash
git add backend/app/api/streaming.py
git commit -q -m "feat(api): per-episode progress (key by content_id) + file_index/title"
```

---

## Task C6: Player saves structured progress

**Files:** Modify `frontend/src/types/index.ts`, `frontend/src/app/streaming/[id]/page.tsx`, `frontend/src/components/player/PatchedVideoPlayer.tsx`

- [ ] **Step 1: Extend the frontend types** in `frontend/src/types/index.ts`:
  - On `StreamingInfo`, add: `content_id?: string | null; season?: number | null; episode?: number | null; file_index?: number | null;`
  - On `StreamingProgress`, add: `file_index?: number | null; title?: string | null;`

- [ ] **Step 2: Thread content_id + file_index from the streaming page to the player.** In `frontend/src/app/streaming/[id]/page.tsx`, the page already computes `effectiveFileIndex` and fetches `streamingInfo` (which now carries `content_id`). Pass to the player a `contentId` (from `streamingInfo?.content_id`, falling back to `movie:${...}`/the torrent title only if absent) and the `fileIndex={effectiveFileIndex}` plus the display `title` (the torrent `movie_title` or `streamingInfo.video_file.name`). Read `PatchedVideoPlayer`'s props (Step 3) and pass the matching ones.

- [ ] **Step 3: Save structured progress in `frontend/src/components/player/PatchedVideoPlayer.tsx`.** READ it. It currently saves `{ torrent_id, movie_id: movieId }` (where `movieId` was the title). Change so:
  - It accepts a `contentId?: string`, `fileIndex?: number`, and `title?: string` prop (in addition to / replacing the loose `movieId`).
  - When saving/looking up progress, use `movie_id = contentId` (the stable identity) when present (fall back to the existing `movieId` only if `contentId` is absent), and include `file_index: fileIndex` and `title` in the `saveProgress`/`updateProgress` body.
  - Lookup before save: prefer `getProgressByMovie(userId, contentId)` (so a season-pack episode resolves its own row), falling back to `getProgressByTorrent` only when `contentId` is absent.
  - Keep movie playback working: for movies the streaming page passes `contentId = movie:{tmdb_id}` (from `/info`), so the same path applies.

- [ ] **Step 4: Type-check** — `docker compose exec -T frontend npx tsc --noEmit` → clean.
- [ ] **Step 5: Commit**
```bash
git add frontend/src/types/index.ts "frontend/src/app/streaming/[id]/page.tsx" frontend/src/components/player/PatchedVideoPlayer.tsx
git commit -q -m "feat(frontend): player saves progress under content_id + file_index/title"
```

---

## Task C7: Home — show-grouped Continue Watching

**Files:** Modify `frontend/src/components/home/ContinueWatchingSection.tsx` (and read `frontend/src/context/ProgressContext.tsx`)

- [ ] **Step 1:** READ `ContinueWatchingSection.tsx` + `ProgressContext.tsx`. The section renders recent `StreamingProgress` entries (display label + a resume link to `/streaming/{torrent_id}`). Rework the rendering:
  - **Movies** (entries whose `movie_id` starts with `movie:` OR doesn't start with `tv:`): render as today — `title` (fall back to `movie_id`), progress %, resume → `/streaming/${torrent_id}`.
  - **TV** (entries whose `movie_id` starts with `tv:`): **group by show**. Parse `content_id = "tv:{showId}:s{n}:e{m}"` to get `showId`, `season`, `episode`. For each show, take its most-recently-watched entry (the list is already `last_watched_at desc`). Render ONE card per show:
    - Show display name: derive from the entry `title` by stripping a trailing ` S\d+(E\d+)?...` suffix (e.g. `"The Boys S01E03"` → `"The Boys"`); fall back to the raw `title`.
    - Sub-label: `S{season}E{episode}` + the progress %.
    - **Resume** (the in-progress episode) → `/streaming/${torrent_id}?file=${file_index}` when `file_index != null`, else `/streaming/${torrent_id}`.
    - **Up next** hint: if that entry is `completed`, show `Up next S{season}E{episode+1}` linking to `/tv/${showId}`; otherwise omit (they're mid-episode).
  - Keep the existing card visual/styling; just change what each card represents and where it links. Cap the total cards as today (e.g. 6).

- [ ] **Step 2: Type-check** — `docker compose exec -T frontend npx tsc --noEmit` → clean.
- [ ] **Step 3: Runtime sanity** — `curl -sf -o /dev/null -w "/ HTTP %{http_code}\n" http://localhost:3001` → 200.
- [ ] **Step 4: Commit**
```bash
git add frontend/src/components/home/ContinueWatchingSection.tsx
git commit -q -m "feat(frontend): show-grouped Continue Watching (Resume + Up next)"
```

---

## Task C8: End-to-end (Stage C)

**Files:** none (verification).

- [ ] **Step 1: Rebuild both** — `docker compose up -d --build backend frontend && sleep 6 && curl -sf http://localhost:8000/health && echo OK`.
- [ ] **Step 2: Backend unit suite** — `docker compose run --rm backend python -m pytest tests/test_stagec_models.py tests/test_content_id.py tests/test_episodes.py tests/test_tv_schemas.py -q` → all pass.
- [ ] **Step 3: Backend flow** — download a TV episode, confirm `/info` returns its `content_id`, POST progress for two episodes of the same show under their content_ids, and confirm `GET /streaming/progress/{user}` returns two distinct rows with `title`/`file_index` (as in C5 Step 2). Report results.
- [ ] **Step 4: Browser** (`http://localhost:3001`, profile "ben"): seed a little TV progress (stream an episode briefly, or POST progress as in C5), then load home — **Continue Watching** shows a show-grouped card ("The Boys • S1E1 …") with a Resume link to `/streaming/<id>?file=<n>`; movies still appear as individual cards. Use Playwright (navigate + snapshot + screenshot); report what rendered.
- [ ] **Step 5: Report** final Stage C status (note metadata/seed-dependent steps that couldn't fully complete here).

---

## Self-review notes (author)

- **Spec coverage (Stage C):** `file_index` on progress (C1), `content_id` (C2) for movies + episodes, the movie-player change to send `movie:{tmdb_id}` (C6, via `/info` content_id), and the home "Up next" show-grouping (C7). The spec said continue-watching is computed frontend-side from recent progress — C7 does exactly that (parse `tv:` content_ids, group by show). The identity is persisted on the torrent (C1/C3) and surfaced via `/info` (C4) so the player can build a clean `content_id`, resolving the Stage-B review's "TV identity isn't persisted" gap.
- **Type/identity consistency:** `content_id` format `tv:{tmdb_id}:s{n}:e{m}` / `movie:{tmdb_id}` is produced in C2/C4 and parsed in C7; `file_index`/`title` flow C1 (columns/schema) → C5 (persist) → C6 (player saves) → C7 (resume link). Progress upsert keys on `(movie_id=content_id, user_id)` (C5) so a season pack's episodes are distinct rows.
- **Backward-compat:** movie progress keeps working (content_id `movie:{tmdb_id}` from `/info`); `add_torrent` reads identity via `getattr(..., None)` so cron / other callers passing a plain object still work; new columns are nullable so old rows/torrents are unaffected.
- **Out of scope (documented follow-ups):** the pre-existing `/torrents/{id}/prioritize` 404; season-progress bars / "mark watched"; downloading the "Up next" episode automatically (it links to the show page).
