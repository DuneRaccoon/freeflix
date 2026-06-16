# TV Support — Stage B (Season Packs / Multi-File Streaming) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Support whole-season (multi-file) torrents: download a season pack, list its episode-labeled video files, and stream a chosen episode out of the pack.

**Architecture:** Generalize the torrent manager's single-file streaming to expose ALL video files in a torrent and stream any by `file_index`; parse `SxxEyy` from filenames to label files as episodes; extend the TV download to accept a season-only request (pack); add a streaming "episode picker" on the frontend. Single-file movie/episode streaming stays unchanged (the new `file_index` defaults to the largest file).

**Tech Stack:** FastAPI, libtorrent, pydantic v2, pytest; Next.js 15.

**Branch:** `feat/tv-support` (Stage A already merged into it).

---

## Conventions

- Stack running (backend `:8000`, frontend `:3001`); `./backend/app` + `./frontend` bind-mounted (hot reload).
- **RUNTEST:** `docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest tests/<file> -v`
- Frontend type-check: `docker compose exec -T frontend npx tsc --noEmit` (baseline clean).
- Commit per task with the `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` trailer. Stage only each task's files (never `git add .`/`-a`).
- **Note on testing the libtorrent methods:** `get_video_files` depends on a live torrent handle, so it is verified in the end-to-end tasks (B6/B10), not unit-tested. The pure `parse_episode` IS unit-tested. A season pack exposes its file list once **metadata** resolves (seconds), well before full download — so `/files` is testable quickly.

## File map

```
backend/app/
  providers/episodes.py   # B1: NEW pure parse_episode(filename) -> (season, episode) | None
  models.py               # B2: NEW VideoFile schema
  torrent/manager.py      # B3: get_video_files(); get_video_file_info(file_index=)
  api/streaming.py        # B4: file_index on video/info; NEW GET /{id}/files
  services/tv.py          # B5: season_torrents()
  api/tv.py               # B5: GET /{id}/season/{s}/torrents
  api/torrents.py         # B5: season-pack download (episode optional)
frontend/src/
  types/index.ts          # B7: VideoFile type
  services/streaming.ts   # B7: getFiles(), file_index on stream URL/info
  services/tv.ts          # B7: getSeasonTorrents()
  components/tv/ShowDetailsContent.tsx   # B8: "Download whole season"
  app/streaming/[id]/page.tsx (+ player) # B9: episode/file picker (?file=N)
```

---

## Task B1: Episode filename parser (`providers/episodes.py`)

**Files:** Create `backend/app/providers/episodes.py`; Test `backend/tests/test_episodes.py`

- [ ] **Step 1: Write the failing test** — create `backend/tests/test_episodes.py`:

```python
from app.providers.episodes import parse_episode


def test_parse_standard_sxxexx():
    assert parse_episode("The.Boys.S01E03.1080p.WEB.h264-GRP.mkv") == (1, 3)
    assert parse_episode("The Boys S05E08 1080p.mkv") == (5, 8)
    assert parse_episode("show.s02e10.720p.mkv") == (2, 10)


def test_parse_xnotation():
    assert parse_episode("Show - 1x04 - Title.mkv") == (1, 4)
    assert parse_episode("Show.12x07.mkv") == (12, 7)


def test_parse_no_match_returns_none():
    assert parse_episode("Some.Movie.2016.1080p.BluRay.mkv") is None
    assert parse_episode("random.mkv") is None


def test_parse_prefers_sxxexx_over_year():
    # a 4-digit year must not be read as season/episode
    assert parse_episode("Show.2019.S03E02.mkv") == (3, 2)
```

- [ ] **Step 2: Run to verify it fails** — RUNTEST `tests/test_episodes.py`. Expected: `ModuleNotFoundError: No module named 'app.providers.episodes'`.

- [ ] **Step 3: Implement `backend/app/providers/episodes.py`:**

```python
"""Parse a season/episode number out of a torrent file name."""
import re
from typing import Optional, Tuple

# S01E02 / s1e2 ; then 1x02 style
_SXXEYY = re.compile(r"[Ss](\d{1,2})[\s._-]?[Ee](\d{1,3})")
_XNOTATION = re.compile(r"(?<!\d)(\d{1,2})[xX](\d{1,3})(?!\d)")


def parse_episode(name: str) -> Optional[Tuple[int, int]]:
    """Return (season, episode) parsed from a filename, or None if not found."""
    if not name:
        return None
    m = _SXXEYY.search(name)
    if m:
        return int(m.group(1)), int(m.group(2))
    m = _XNOTATION.search(name)
    if m:
        return int(m.group(1)), int(m.group(2))
    return None
```

- [ ] **Step 4: Run to verify it passes** — RUNTEST `tests/test_episodes.py`. Expected: PASS (4 tests). (`SxxEyy` is matched first so `Show.2019.S03E02` → (3,2), not the year.)

- [ ] **Step 5: Commit**
```bash
git add backend/app/providers/episodes.py backend/tests/test_episodes.py
git commit -q -m "feat(providers): parse_episode (filename -> season/episode)"
```

---

## Task B2: VideoFile schema (`models.py`)

**Files:** Modify `backend/app/models.py`; Test `backend/tests/test_videofile_schema.py`

- [ ] **Step 1: Write the failing test** — create `backend/tests/test_videofile_schema.py`:

```python
from app.models import VideoFile


def test_videofile_defaults():
    f = VideoFile(index=2, name="The.Boys.S01E03.mkv", size=1000, mime_type="video/x-matroska",
                  stream_url="/api/v1/streaming/abc/video?file_index=2")
    assert f.index == 2 and f.downloaded == 0 and f.progress == 0.0
    assert f.season is None and f.episode is None


def test_videofile_with_episode():
    f = VideoFile(index=0, name="x.mkv", size=5, mime_type="video/mp4", stream_url="/x",
                  season=1, episode=3, downloaded=5, progress=100.0)
    assert f.season == 1 and f.episode == 3 and f.progress == 100.0
```

- [ ] **Step 2: Run to verify it fails** — RUNTEST `tests/test_videofile_schema.py`. Expected: `ImportError: cannot import name 'VideoFile'`.

- [ ] **Step 3: Add to `backend/app/models.py`** (after the `Episode`/`SeasonDetail` TV schemas):

```python
class VideoFile(BaseModel):
    index: int
    name: str
    size: int
    downloaded: int = 0
    progress: float = 0.0
    mime_type: str
    stream_url: str
    season: Optional[int] = None
    episode: Optional[int] = None
```

- [ ] **Step 4: Run to verify it passes** — RUNTEST `tests/test_videofile_schema.py`. Expected: PASS (2 tests).

- [ ] **Step 5: Commit**
```bash
git add backend/app/models.py backend/tests/test_videofile_schema.py
git commit -q -m "feat(models): VideoFile schema for multi-file streaming"
```

---

## Task B3: List all video files + index selection (`torrent/manager.py`)

**Files:** Modify `backend/app/torrent/manager.py`

This generalizes the single-file accessor. `get_video_files` lists every video file; `get_video_file_info` gains an optional `file_index` (default `None` = largest, preserving movie behavior). Verified in B6 (live).

- [ ] **Step 1: Add `get_video_files`** immediately before the existing `get_video_file_info` method (around line 1047). Insert:

```python
    def get_video_files(self, torrent_id: str) -> List[Dict[str, Any]]:
        """List every video file in a torrent (index/path/size/downloaded/progress/name)."""
        if torrent_id not in self.active_torrents:
            return []
        handle, _ = self.active_torrents[torrent_id]
        if not handle.has_metadata():
            return []
        try:
            torrent_info = handle.get_torrent_info()
            file_progress = handle.file_progress()
            base_path = Path(handle.status().save_path)
            files = []
            for i in range(torrent_info.num_files()):
                fi = torrent_info.file_at(i)
                if not self._is_video_file(fi.path):
                    continue
                downloaded = file_progress[i] if i < len(file_progress) else 0
                progress = (downloaded / fi.size) * 100 if fi.size > 0 else 0
                files.append({
                    "index": i,
                    "path": str(base_path / fi.path),
                    "size": fi.size,
                    "downloaded": downloaded,
                    "progress": progress,
                    "name": Path(fi.path).name,
                })
            return files
        except Exception as e:
            logger.error(f"Error listing video files for torrent {torrent_id}: {e}")
            return []
```

- [ ] **Step 2: Replace the body of `get_video_file_info`** to take an optional `file_index` and reuse `get_video_files`. Replace the whole method (currently `def get_video_file_info(self, torrent_id: str) -> Optional[Dict[str, Any]]:` through its `return None` / except block) with:

```python
    def get_video_file_info(self, torrent_id: str, file_index: Optional[int] = None) -> Optional[Dict[str, Any]]:
        """
        Get info about one video file in a torrent.

        file_index None -> the largest video file (movie / single-episode default).
        file_index set  -> that specific file (season-pack episode), or None if it
                           isn't a video file in this torrent.
        """
        files = self.get_video_files(torrent_id)
        if not files:
            return None
        if file_index is not None:
            for f in files:
                if f["index"] == file_index:
                    return f
            return None
        return max(files, key=lambda f: f["size"])
```

- [ ] **Step 3: Verify import + signatures** — `docker compose exec -T backend python -c "from app.torrent.manager import torrent_manager as m; import inspect; print('get_video_files' in dir(m)); print(inspect.signature(m.get_video_file_info))"`
Expected: `True` and `(torrent_id: str, file_index: Optional[int] = None)`.

- [ ] **Step 4: Commit**
```bash
git add backend/app/torrent/manager.py
git commit -q -m "feat(torrent): get_video_files + file_index-selectable get_video_file_info"
```

---

## Task B4: file_index streaming + `/files` endpoint (`api/streaming.py`)

**Files:** Modify `backend/app/api/streaming.py`

- [ ] **Step 1: Add the parse_episode import.** Near the top imports add:
```python
from app.providers.episodes import parse_episode
from app.models import VideoFile
from typing import List
```
(`List` may already be imported via `from typing import List, Dict, Any, Optional` on line 12 — if so, don't duplicate.)

- [ ] **Step 2: Add `file_index` to `stream_video`.** Change its signature to add the query param and pass it through:
```python
@router.get("/{torrent_id}/video", summary="Stream video from a torrent")
async def stream_video(
    request: Request,
    torrent_id: str = Path(..., description="ID of the torrent"),
    quality: Optional[str] = Query(None, description="Desired quality if multiple options available"),
    file_index: Optional[int] = Query(None, description="Index of the file to stream (season packs)"),
):
```
and change the lookup line from `video_info = torrent_manager.get_video_file_info(torrent_id)` to:
```python
    video_info = torrent_manager.get_video_file_info(torrent_id, file_index)
```
(The rest of `stream_video` is unchanged.)

- [ ] **Step 3: Add `file_index` to `get_video_info`.** Change its signature:
```python
@router.get("/{torrent_id}/info", summary="Get video streaming information")
async def get_video_info(
    torrent_id: str = Path(..., description="ID of the torrent"),
    file_index: Optional[int] = Query(None, description="Index of the file (season packs)"),
):
```
change `video_info = torrent_manager.get_video_file_info(torrent_id)` to `torrent_manager.get_video_file_info(torrent_id, file_index)`, and change the `stream_url` in the returned dict from
`"stream_url": f"/api/v1/streaming/{torrent_id}/video"` to:
```python
            "stream_url": (
                f"/api/v1/streaming/{torrent_id}/video"
                + (f"?file_index={file_index}" if file_index is not None else "")
            ),
```

- [ ] **Step 4: Add the `/files` endpoint** (after `get_video_info`):
```python
@router.get("/{torrent_id}/files", response_model=List[VideoFile], summary="List streamable video files")
async def list_video_files(torrent_id: str = Path(..., description="ID of the torrent")):
    """List the video files in a torrent, labeled with parsed season/episode (season packs)."""
    if not torrent_manager.get_torrent_status(torrent_id):
        raise HTTPException(status_code=404, detail="Torrent not found")
    files = torrent_manager.get_video_files(torrent_id)
    result: List[VideoFile] = []
    for f in files:
        ep = parse_episode(f["name"])
        result.append(VideoFile(
            index=f["index"], name=f["name"], size=f["size"],
            downloaded=f["downloaded"], progress=f["progress"],
            mime_type=get_mime_type(f["name"]),
            stream_url=f"/api/v1/streaming/{torrent_id}/video?file_index={f['index']}",
            season=ep[0] if ep else None,
            episode=ep[1] if ep else None,
        ))
    result.sort(key=lambda r: (
        r.season if r.season is not None else 999,
        r.episode if r.episode is not None else r.index,
    ))
    return result
```

- [ ] **Step 5: Verify it imports + movie streaming unaffected** (backend reloads):
`docker compose exec -T backend python -c "import app.api.streaming; print('streaming import OK')"` → `streaming import OK`. (Live multi-file behavior is checked in B6.)

- [ ] **Step 6: Commit**
```bash
git add backend/app/api/streaming.py
git commit -q -m "feat(api): file_index streaming + episode-labeled /files endpoint"
```

---

## Task B5: Season-pack download + season-torrents endpoint

**Files:** Modify `backend/app/services/tv.py`, `backend/app/api/tv.py`, `backend/app/api/torrents.py`

- [ ] **Step 1: Add `season_torrents` to `backend/app/services/tv.py`** (after `episode_torrents`):
```python
async def season_torrents(tmdb_id: int, season: int):
    show = await resolve_show_name(tmdb_id)
    if not show:
        return []
    return await catalog.torrents(f"{show} S{season:02d}")
```

- [ ] **Step 2: Add the season-torrents route to `backend/app/api/tv.py`** (after the episode-torrents route):
```python
@router.get("/{tmdb_id}/season/{season}/torrents",
            response_model=List[TorrentHit], summary="Season-pack torrents")
async def season_torrents(tmdb_id: int = Path(..., ge=1), season: int = Path(..., ge=0)):
    return await tv_service.season_torrents(tmdb_id, season)
```

- [ ] **Step 3: Allow season-only (pack) download in `backend/app/api/torrents.py`.** In `download_movie`, the TV branch currently requires both season and episode. Replace that branch:
```python
        if request.media_type == "tv":
            if request.season is None or request.episode is None:
                raise HTTPException(status_code=422, detail="season and episode are required for TV downloads")
            show = await tv_service.resolve_show_name(request.tmdb_id)
            if not show:
                raise HTTPException(status_code=404, detail="Show not found")
            name = f"{show} S{request.season:02d}E{request.episode:02d}"
            label, year = name, None
```
with (season required; episode optional → season pack):
```python
        if request.media_type == "tv":
            if request.season is None:
                raise HTTPException(status_code=422, detail="season is required for TV downloads")
            show = await tv_service.resolve_show_name(request.tmdb_id)
            if not show:
                raise HTTPException(status_code=404, detail="Show not found")
            if request.episode is not None:
                name = f"{show} S{request.season:02d}E{request.episode:02d}"
            else:
                name = f"{show} S{request.season:02d}"
            label, year = name, None
```

- [ ] **Step 4: Verify live** (backend reloads):
```bash
sleep 2
curl -s "http://localhost:8000/api/v1/tv/76479" >/dev/null
curl -s "http://localhost:8000/api/v1/tv/76479/season/1/torrents" | python3 -c "import sys,json;h=json.load(sys.stdin);print('season-pack hits',len(h),'| samples',[x['title'][:55] for x in h[:3]])"
curl -s -X POST http://localhost:8000/api/v1/torrents/download -H 'Content-Type: application/json' -d '{"tmdb_id":76479,"quality":"1080p","media_type":"tv","season":1}' | python3 -c "import sys,json;d=json.load(sys.stdin);print('pack download:',d.get('state'),'|',d.get('movie_title'))"
```
Expected: season-pack hits non-empty (names like "The Boys S01 ... 1080p"); pack download returns a `TorrentStatus` titled like "The Boys S01" in a queued state. (Leave the download running for B6, or note its id.)

- [ ] **Step 5: Commit**
```bash
git add backend/app/services/tv.py backend/app/api/tv.py backend/app/api/torrents.py
git commit -q -m "feat(api): season-pack torrents endpoint + season-only download"
```

---

## Task B6: Backend e2e — season pack → files → stream a file

**Files:** none (verification).

- [ ] **Step 1: Rebuild backend** — `docker compose up -d --build backend && sleep 5 && curl -sf http://localhost:8000/health && echo OK`.
- [ ] **Step 2: Run the new unit suite** — `docker compose run --rm backend python -m pytest tests/test_episodes.py tests/test_videofile_schema.py tests/test_tv_schemas.py tests/test_tv_normalize.py -q` → all pass.
- [ ] **Step 3: Download a season pack and wait for metadata**, then list its files:
```bash
curl -s "http://localhost:8000/api/v1/tv/76479" >/dev/null
tid=$(curl -s -X POST http://localhost:8000/api/v1/torrents/download -H 'Content-Type: application/json' -d '{"tmdb_id":76479,"quality":"1080p","media_type":"tv","season":1}' | python3 -c "import sys,json;print(json.load(sys.stdin)['id'])")
echo "pack torrent: $tid"
for i in $(seq 1 30); do
  n=$(curl -s "http://localhost:8000/api/v1/streaming/$tid/files" | python3 -c "import sys,json;print(len(json.load(sys.stdin)))" 2>/dev/null || echo 0)
  [ "$n" -gt 0 ] && break; sleep 3
done
curl -s "http://localhost:8000/api/v1/streaming/$tid/files" | python3 -c "import sys,json;fs=json.load(sys.stdin);print('files',len(fs));[print('  ',f['index'],'S%sE%s'%(f['season'],f['episode']),f['name'][:50]) for f in fs[:5]]"
```
Expected: once metadata resolves (often <60s for a well-seeded pack), `/files` lists multiple video files, each labeled with a parsed `season`/`episode` and a `stream_url` carrying `?file_index=`. **If no multi-file pack is available / metadata doesn't resolve in the window, record that explicitly** (the feature is correct if `/files` returns the file list once metadata is present; a single-file release would list 1 file).
- [ ] **Step 4: Smoke a file_index stream header** (range request on one file):
```bash
curl -s -o /dev/null -D - -H 'Range: bytes=0-1023' "http://localhost:8000/api/v1/streaming/$tid/video?file_index=0" | grep -iE 'HTTP/|Content-Range|Content-Type' | head
```
Expected: `206 Partial Content` with a `Content-Range` (once that file has at least its first bytes; if not yet downloaded it may 500/empty — note it). Then clean up: `curl -s -X DELETE "http://localhost:8000/api/v1/torrents/$tid?delete_files=true"`.
- [ ] **Step 5: Report** exactly what `/files` returned and whether a ranged file stream worked (network/seed-dependent).

---

## Task B7: Frontend types + streaming/tv services

**Files:** Modify `frontend/src/types/index.ts`, `frontend/src/services/streaming.ts`, `frontend/src/services/tv.ts`

- [ ] **Step 1: Add the `VideoFile` type** to `frontend/src/types/index.ts` (additive):
```typescript
export interface VideoFile {
  index: number;
  name: string;
  size: number;
  downloaded: number;
  progress: number;
  mime_type: string;
  stream_url: string;
  season: number | null;
  episode: number | null;
}
```

- [ ] **Step 2: Extend `frontend/src/services/streaming.ts`.** READ it first. Add a `getFiles` method and make the stream-URL / info helpers accept an optional `fileIndex`:
```typescript
  getFiles: async (torrentId: string): Promise<VideoFile[]> => {
    const response = await apiClient.get(`/streaming/${torrentId}/files`);
    return response.data;
  },
```
And where it builds the streaming URL (e.g. a `getStreamingUrl(torrentId)` / `getStreamingInfo(torrentId)`), add an optional `fileIndex?: number` param that appends `?file_index=${fileIndex}` when provided. Keep existing calls working (param optional). Import `VideoFile` from `@/types`.

- [ ] **Step 3: Add `getSeasonTorrents` to `frontend/src/services/tv.ts`:**
```typescript
  getSeasonTorrents: async (tmdbId: number, season: number): Promise<TorrentHit[]> => {
    const response = await apiClient.get(`/tv/${tmdbId}/season/${season}/torrents`);
    return response.data;
  },
```

- [ ] **Step 4: Type-check** — `docker compose exec -T frontend npx tsc --noEmit` → clean.
- [ ] **Step 5: Commit**
```bash
git add frontend/src/types/index.ts frontend/src/services/streaming.ts frontend/src/services/tv.ts
git commit -q -m "feat(frontend): VideoFile type + streaming getFiles/file_index + season torrents"
```

---

## Task B8: "Download whole season" on the show detail page

**Files:** Modify `frontend/src/components/tv/ShowDetailsContent.tsx`

- [ ] **Step 1:** READ `ShowDetailsContent.tsx`. In the season view (where the episode list + season selector live), add a **"Download whole season"** control near the season header. It calls the existing catalog download util with body `{ tmdb_id: showId, quality: selectedQuality, media_type: 'tv', season: seasonNumber }` (NO `episode` → the backend builds the season-pack query). Provide a quality picker for the season download (reuse the same `720p/1080p/2160p` options used per episode). On success (`TorrentStatus` with `id`), toast success and offer to go to `/streaming/${torrentId}` (where the pack's episodes can be picked — B9). On `422`, toast the "no release" detail (mirror the per-episode handler).
- [ ] **Step 2: Type-check** — `docker compose exec -T frontend npx tsc --noEmit` → clean.
- [ ] **Step 3: Runtime sanity** — `curl -sf -o /dev/null -w "/tv/76479 HTTP %{http_code}\n" http://localhost:3001/tv/76479` → 200.
- [ ] **Step 4: Commit**
```bash
git add frontend/src/components/tv/ShowDetailsContent.tsx
git commit -q -m "feat(frontend): Download whole season (pack) on show detail"
```

---

## Task B9: Episode/file picker on the streaming page

**Files:** Modify `frontend/src/app/streaming/[id]/page.tsx` (and the player wiring as needed)

- [ ] **Step 1:** READ `frontend/src/app/streaming/[id]/page.tsx` and how it builds the stream URL / fetches `getStreamingInfo`. Add multi-file support:
  - Read an optional `file` query param (`useSearchParams().get('file')`) → `fileIndex` (number | undefined).
  - On load, call `streamingService.getFiles(torrentId)`. If it returns **more than one** video file (a season pack), render an **episode/file picker** (a dropdown or list): label each as `S{season}E{episode}` when both are non-null, else the filename; sort is already done server-side. Selecting an entry sets the `?file=` query (e.g. `router.replace(\`/streaming/${torrentId}?file=${idx}\`)`) and switches playback to that file.
  - Pass `fileIndex` through to the stream URL (`streamingService.getStreamingUrl(torrentId, fileIndex)`) and to `getStreamingInfo(torrentId, fileIndex)`. Default: if `fileIndex` is undefined, behave exactly as today (largest file) — so movies/single-episode are unchanged.
  - When `files.length <= 1`, render no picker (current behavior).
- [ ] **Step 2: Type-check** — `docker compose exec -T frontend npx tsc --noEmit` → clean.
- [ ] **Step 3: Runtime sanity** — `curl -sf -o /dev/null -w "/streaming/x HTTP %{http_code}\n" http://localhost:3001/streaming/test` → 200 (route compiles; it'll show a not-found/empty state for a bogus id, which is fine).
- [ ] **Step 4: Commit**
```bash
git add "frontend/src/app/streaming/[id]/page.tsx"
git commit -q -m "feat(frontend): season-pack episode/file picker on the streaming page"
```

---

## Task B10: Frontend e2e (Stage B)

**Files:** none (verification).

- [ ] **Step 1: Rebuild frontend** — `docker compose up -d --build frontend` (runs `next build`; must compile).
- [ ] **Step 2: Type-check** — `docker compose exec -T frontend npx tsc --noEmit` → clean.
- [ ] **Step 3: Browser check** (`http://localhost:3001`, profile "ben"): on a show page (`/tv/76479`), the season view shows a **"Download whole season"** control; trigger it → a pack download starts (appears on downloads). Open that pack's `/streaming/<id>` → once metadata resolves, an **episode picker** lists the pack's episodes (S1E1, S1E2, …); selecting one updates `?file=` and the player targets that file. Use Playwright (navigate + snapshot + screenshot); report what rendered. (Actual playback bytes depend on seed/download progress; verifying the picker + file selection + stream URL is the goal.)
- [ ] **Step 4: Report** final Stage B status (note any seed/metadata-dependent steps that couldn't fully complete here).

---

## Self-review notes (author)

- **Spec coverage (Stage B):** `parse_episode` (B1), `VideoFile` (B2), `get_video_files` + `file_index` (B3), `file_index` streaming + `/files` (B4), season-pack download + season-torrents endpoint (B5), backend e2e (B6); frontend types/services (B7), "Download whole season" (B8), streaming episode picker (B9), frontend e2e (B10). Matches the spec's Stage B scope.
- **Backward-compat:** `get_video_file_info(torrent_id, file_index=None)` defaults to the largest file → movie + single-episode streaming unchanged; the `?file_index=` query is optional everywhere; the streaming page shows the picker only when `files.length > 1`.
- **Type/identity consistency:** `VideoFile` fields identical across B2 (pydantic) / B4 (response) / B7 (TS). `get_video_files` (B3) consumed by `/files` (B4). `season_torrents` defined in B5 service + route. Download branch (B5) makes `episode` optional → season pack; Stage A's "episode required" is intentionally relaxed here (matches the Stage-A review note).
- **Per-episode pack playback** (mapping a show's episode row directly to a downloaded pack's file_index) is intentionally NOT in Stage B — the user reaches pack episodes via the pack's streaming-page picker. Direct episode→pack-file linking can be a later enhancement.
