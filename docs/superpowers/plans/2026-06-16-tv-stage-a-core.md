# TV Support — Stage A (Core) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add TV browse/search, show detail (seasons), season episodes, and per-episode (single-file) download + streaming — a working "TV Shows" section reusing the Phase 1 movie seams.

**Architecture:** New TV calls on the existing catalog client (`mode=tv` + `tv_details`/`season_details`), a `services/tv.py` orchestration mirroring `services/movies.py`, a new `api/tv.py` router, an episode-aware extension to the existing `/torrents/download`, and a dedicated frontend `/tv` section. Single-episode torrents stream through the existing (single-file) streaming path unchanged; season packs + multi-file streaming are **Stage B**, show-level continue-watching is **Stage C**.

**Tech Stack:** FastAPI, httpx, pydantic v2, SQLAlchemy 1.4, pytest; Next.js 15.

**Branch:** `feat/tv-support` (already checked out).

---

## Conventions

- Stack is running (backend `:8000`, frontend `:3001`) via Docker Compose; `./backend/app` and `./frontend` are bind-mounted (hot reload).
- **RUNTEST** (new tests aren't bind-mounted): `docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest tests/<file> -v`
- Frontend type-check: `docker compose exec -T frontend npx tsc --noEmit` (baseline clean).
- Commit per task; end messages with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. Stage only each task's files (never `git add .`/`-a`).

## File map

```
backend/app/
  models.py                       # T1: ShowDetail/SeasonSummary/SeasonDetail/Episode; extend TorrentRequest
  providers/catalog.py            # T2: mode param on browse/search; tv_details/season_details + normalizers
  services/tv.py                  # T3: NEW orchestration
  api/tv.py                       # T4: NEW router
  main.py                         # T4: register tv router
  api/torrents.py                 # T5: episode-aware download
frontend/src/
  types/index.ts                  # T7: Show/Season/Episode types; extend CatalogTorrentRequest
  services/tv.ts                  # T8: NEW tv service
  components/ui/Navigation.tsx    # T8: add "TV Shows"
  app/tv/page.tsx                 # T9: browse
  app/tv/[id]/page.tsx + components/tv/*   # T10: show detail
  components/search/SearchPageContent.tsx  # T11: Movies/TV toggle
```

---

## Task 1: TV schemas + TorrentRequest extension (`models.py`)

**Files:** Modify `backend/app/models.py`; Test `backend/tests/test_tv_schemas.py`

- [ ] **Step 1: Write the failing test** — create `backend/tests/test_tv_schemas.py`:

```python
from app.models import ShowDetail, SeasonSummary, SeasonDetail, Episode, TorrentRequest


def test_show_detail_defaults():
    s = ShowDetail(tmdb_id=76479, name="The Boys")
    assert s.media_type == "tv" and s.number_of_seasons == 0 and s.seasons == []


def test_season_detail_with_episodes():
    sd = SeasonDetail(season_number=1, name="Season 1",
                      episodes=[Episode(episode_number=1, name="Pilot", runtime=62)])
    assert sd.episodes[0].episode_number == 1 and sd.episodes[0].runtime == 62


def test_season_summary():
    ss = SeasonSummary(season_number=2, name="Season 2", episode_count=8)
    assert ss.episode_count == 8


def test_torrent_request_tv_fields():
    r = TorrentRequest(tmdb_id=76479, quality="1080p", media_type="tv", season=1, episode=3)
    assert r.media_type == "tv" and r.season == 1 and r.episode == 3
    rm = TorrentRequest(tmdb_id=603, quality="1080p")
    assert rm.media_type == "movie" and rm.season is None
```

- [ ] **Step 2: Run to verify it fails** — RUNTEST `tests/test_tv_schemas.py`. Expected: `ImportError: cannot import name 'ShowDetail'`.

- [ ] **Step 3: Add the schemas to `backend/app/models.py`** (after the existing `CatalogPage`/`MovieBrowseParams` block; `Literal`/`Optional`/`List`/`ConfigDict`/`BaseModel` already imported):

```python
class SeasonSummary(BaseModel):
    season_number: int
    name: str = ""
    episode_count: int = 0
    overview: Optional[str] = None
    poster_url: Optional[str] = None
    air_date: Optional[str] = None


class Episode(BaseModel):
    episode_number: int
    name: str = ""
    overview: Optional[str] = None
    runtime: Optional[int] = None
    still_url: Optional[str] = None
    air_date: Optional[str] = None
    vote_average: float = 0.0


class ShowDetail(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    tmdb_id: int
    media_type: Literal['tv'] = 'tv'
    name: str
    year: Optional[int] = None
    overview: Optional[str] = None
    poster_url: Optional[str] = None
    backdrop_url: Optional[str] = None
    genres: List[str] = []
    status: Optional[str] = None
    first_air_date: Optional[str] = None
    last_air_date: Optional[str] = None
    number_of_seasons: int = 0
    vote_average: float = 0.0
    vote_count: int = 0
    seasons: List[SeasonSummary] = []


class SeasonDetail(BaseModel):
    season_number: int
    name: str = ""
    overview: Optional[str] = None
    episodes: List[Episode] = []
```

Then **replace** the existing `TorrentRequest` class with the extended version:

```python
class TorrentRequest(BaseModel):
    tmdb_id: int
    quality: Literal['720p', '1080p', '2160p'] = '1080p'
    save_path: Optional[str] = None
    media_type: Literal['movie', 'tv'] = 'movie'
    season: Optional[int] = None
    episode: Optional[int] = None
```

- [ ] **Step 4: Run to verify it passes** — RUNTEST `tests/test_tv_schemas.py`. Expected: PASS (4 tests).

- [ ] **Step 5: Commit**
```bash
git add backend/app/models.py backend/tests/test_tv_schemas.py
git commit -q -m "feat(models): TV show/season/episode schemas; TV fields on TorrentRequest"
```

---

## Task 2: Catalog TV calls + normalizers (`providers/catalog.py`)

**Files:** Modify `backend/app/providers/catalog.py`; Test `backend/tests/test_tv_normalize.py`

- [ ] **Step 1: Write the failing test** — create `backend/tests/test_tv_normalize.py`:

```python
from app.providers.catalog import normalize_show, normalize_season, normalize_episode


SHOW = {
    "id": 76479, "name": "The Boys", "overview": "Vigilantes...",
    "poster_path": "/p.jpg", "backdrop_path": "/b.jpg", "first_air_date": "2019-07-25",
    "last_air_date": "2026-05-20", "status": "Ended", "number_of_seasons": 5,
    "vote_average": 8.4, "vote_count": 12000,
    "genres": [{"id": 10765, "name": "Sci-Fi & Fantasy"}, {"id": 10759, "name": "Action & Adventure"}],
    "seasons": [
        {"season_number": 0, "name": "Specials", "episode_count": 74, "poster_path": "/s0.jpg", "air_date": "2019-05-01"},
        {"season_number": 1, "name": "Season 1", "episode_count": 8, "poster_path": "/s1.jpg", "air_date": "2019-07-25"},
    ],
}

SEASON = {
    "season_number": 1, "name": "Season 1", "overview": "...",
    "episodes": [
        {"episode_number": 1, "name": "The Name of the Game", "overview": "o",
         "runtime": 62, "still_path": "/e1.jpg", "air_date": "2019-07-25", "vote_average": 7.5},
    ],
}


def test_normalize_show():
    s = normalize_show(SHOW)
    assert s.tmdb_id == 76479 and s.name == "The Boys"
    assert s.year == 2019 and s.number_of_seasons == 5 and s.status == "Ended"
    assert s.genres == ["Sci-Fi & Fantasy", "Action & Adventure"]
    assert s.poster_url == "https://image.tmdb.org/t/p/w500/p.jpg"
    assert len(s.seasons) == 2 and s.seasons[1].episode_count == 8


def test_normalize_season_and_episode():
    sd = normalize_season(SEASON)
    assert sd.season_number == 1 and len(sd.episodes) == 1
    e = sd.episodes[0]
    assert e.episode_number == 1 and e.runtime == 62
    assert e.still_url == "https://image.tmdb.org/t/p/w300/e1.jpg"
```

- [ ] **Step 2: Run to verify it fails** — RUNTEST `tests/test_tv_normalize.py`. Expected: `ImportError: cannot import name 'normalize_show'`.

- [ ] **Step 3: Edit `backend/app/providers/catalog.py`.**

(3a) Update the import of app.models to include the TV schemas. Change:
```python
from app.models import CatalogItem, TorrentHit, CatalogPage
```
to:
```python
from app.models import (
    CatalogItem, TorrentHit, CatalogPage, ShowDetail, SeasonSummary, SeasonDetail, Episode,
)
```

(3b) Add a `mode` param to `browse` and `search` (replace those two functions):
```python
async def browse(api: str = "popular", sort: str = "popularity.desc",
                 genre: int = 0, year: int = 0, page: int = 1, mode: str = "movie") -> CatalogPage:
    params = {"api": api, "mode": mode, "page": page, "sort": sort}
    if genre:
        params["genre"] = genre
    if year:
        params["year"] = year
    data = await _get(params) or {}
    return CatalogPage(
        page=data.get("page", page),
        results=[normalize_item(r) for r in data.get("results", []) if r.get("id")],
        total_pages=data.get("total_pages", 0),
        total_results=data.get("total_results", 0),
    )


async def search(q: str, page: int = 1, mode: str = "movie") -> CatalogPage:
    data = await _get({"api": "search", "mode": mode, "q": q, "page": page}) or {}
    return CatalogPage(
        page=data.get("page", page),
        results=[normalize_item(r) for r in data.get("results", []) if r.get("id")],
        total_pages=data.get("total_pages", 0),
        total_results=data.get("total_results", 0),
    )
```
(Note `normalize_item` already derives `title` from `name` and `year` from `first_air_date`, so it handles TV list items.)

(3c) Append the TV calls + normalizers at the end of the file:
```python
async def tv_details(tmdb_id: int) -> Optional[Dict[str, Any]]:
    return await _get({"api": "tv_details", "mode": "tv", "id": tmdb_id})


async def season_details(tmdb_id: int, season: int) -> Optional[Dict[str, Any]]:
    return await _get({"api": "season_details", "mode": "tv", "id": tmdb_id, "season": season})


def normalize_season_summary(s: Dict[str, Any]) -> SeasonSummary:
    return SeasonSummary(
        season_number=s.get("season_number", 0),
        name=s.get("name") or "",
        episode_count=s.get("episode_count") or 0,
        overview=s.get("overview"),
        poster_url=image_url(s.get("poster_path"), "w300"),
        air_date=s.get("air_date"),
    )


def normalize_show(raw: Dict[str, Any]) -> ShowDetail:
    genres = [g["name"] for g in raw.get("genres", []) if g.get("name")] or genre_names(raw.get("genre_ids") or [])
    return ShowDetail(
        tmdb_id=raw["id"],
        name=raw.get("name") or raw.get("title") or "",
        year=_year_from(raw),
        overview=raw.get("overview"),
        poster_url=image_url(raw.get("poster_path"), "w500"),
        backdrop_url=image_url(raw.get("backdrop_path"), "w1280"),
        genres=genres,
        status=raw.get("status"),
        first_air_date=raw.get("first_air_date"),
        last_air_date=raw.get("last_air_date"),
        number_of_seasons=raw.get("number_of_seasons") or 0,
        vote_average=raw.get("vote_average") or 0.0,
        vote_count=raw.get("vote_count") or 0,
        seasons=[normalize_season_summary(s) for s in raw.get("seasons", [])],
    )


def normalize_episode(e: Dict[str, Any]) -> Episode:
    return Episode(
        episode_number=e.get("episode_number", 0),
        name=e.get("name") or "",
        overview=e.get("overview"),
        runtime=e.get("runtime"),
        still_url=image_url(e.get("still_path"), "w300"),
        air_date=e.get("air_date"),
        vote_average=e.get("vote_average") or 0.0,
    )


def normalize_season(raw: Dict[str, Any]) -> SeasonDetail:
    return SeasonDetail(
        season_number=raw.get("season_number", 0),
        name=raw.get("name") or "",
        overview=raw.get("overview"),
        episodes=[normalize_episode(e) for e in raw.get("episodes", [])],
    )
```

- [ ] **Step 4: Run to verify it passes** — RUNTEST `tests/test_tv_normalize.py`. Expected: PASS (2 tests). Also re-run the movie normalizer tests to confirm no regression: RUNTEST `tests/test_catalog_normalize.py` → PASS.

- [ ] **Step 5: Live smoke** — `docker compose exec -T backend python -c "import asyncio; from app.providers import catalog as c; s=c.normalize_show(asyncio.run(c.tv_details(76479))); print(s.name, s.number_of_seasons, len(s.seasons)); sd=c.normalize_season(asyncio.run(c.season_details(76479,1))); print(sd.name, len(sd.episodes))"`
Expected: prints `The Boys 5 6` (or similar) and `Season 1 8`. (Note network; if unavailable here, rely on unit tests + Task 6.)

- [ ] **Step 6: Commit**
```bash
git add backend/app/providers/catalog.py backend/tests/test_tv_normalize.py
git commit -q -m "feat(providers): catalog tv_details/season_details + mode param + tv normalizers"
```

---

## Task 3: TV service orchestration (`services/tv.py`)

**Files:** Create `backend/app/services/tv.py`

- [ ] **Step 1: Create `backend/app/services/tv.py`:**

```python
"""TV orchestration: browse/search + show/season detail, with show caching."""
from typing import Optional
from loguru import logger

from app.models import CatalogPage, ShowDetail, SeasonDetail
from app.providers import catalog
from app.database.session import get_db
from app.database.models.catalog import CatalogItemCache


def _cache_page(page: CatalogPage) -> None:
    try:
        with get_db() as db:
            for item in page.results:
                CatalogItemCache.upsert_list_item(
                    db, tmdb_id=item.tmdb_id, media_type="tv",
                    title=item.title, year=item.year, overview=item.overview,
                    poster_url=item.poster_url, backdrop_url=item.backdrop_url,
                    genre_ids=item.genre_ids, genres=item.genres,
                    vote_average=item.vote_average, vote_count=item.vote_count,
                    popularity=item.popularity, original_language=item.original_language,
                )
    except Exception as e:
        logger.error(f"Failed to cache tv page: {e}")


async def browse(api: str, sort: str, genre: int, year: int, page: int) -> CatalogPage:
    result = await catalog.browse(api=api, sort=sort, genre=genre, year=year, page=page, mode="tv")
    _cache_page(result)
    return result


async def search(q: str, page: int) -> CatalogPage:
    result = await catalog.search(q=q, page=page, mode="tv")
    _cache_page(result)
    return result


async def show_detail(tmdb_id: int) -> Optional[ShowDetail]:
    raw = await catalog.tv_details(tmdb_id)
    if not raw or not raw.get("id"):
        return None
    show = catalog.normalize_show(raw)
    try:
        with get_db() as db:
            CatalogItemCache.upsert_list_item(
                db, tmdb_id=show.tmdb_id, media_type="tv",
                title=show.name, year=show.year, overview=show.overview,
                poster_url=show.poster_url, backdrop_url=show.backdrop_url,
                genre_ids=[], genres=show.genres, vote_average=show.vote_average,
                vote_count=show.vote_count, popularity=0.0, original_language=None,
            )
    except Exception as e:
        logger.error(f"Failed to cache show {tmdb_id}: {e}")
    return show


async def season_detail(tmdb_id: int, season: int) -> Optional[SeasonDetail]:
    raw = await catalog.season_details(tmdb_id, season)
    if not raw or "episodes" not in raw:
        return None
    return catalog.normalize_season(raw)


async def resolve_show_name(tmdb_id: int) -> Optional[str]:
    with get_db() as db:
        row = CatalogItemCache.get_one(db, "tv", tmdb_id)
        if row:
            return row.title
    raw = await catalog.tv_details(tmdb_id)
    if raw and raw.get("name"):
        return raw["name"]
    return None


async def episode_torrents(tmdb_id: int, season: int, episode: int):
    show = await resolve_show_name(tmdb_id)
    if not show:
        return []
    return await catalog.torrents(f"{show} S{season:02d}E{episode:02d}")
```

- [ ] **Step 2: Verify it imports** — `docker compose exec -T backend python -c "import app.services.tv as t; print(sorted(f for f in dir(t) if not f.startswith('_')))"` → expected list includes `browse, search, show_detail, season_detail, resolve_show_name, episode_torrents`.

- [ ] **Step 3: Commit**
```bash
git add backend/app/services/tv.py
git commit -q -m "feat(services): tv orchestration (browse/search/show/season + episode torrents)"
```

---

## Task 4: TV API router (`api/tv.py`) + register

**Files:** Create `backend/app/api/tv.py`; Modify `backend/app/main.py`

- [ ] **Step 1: Create `backend/app/api/tv.py`:**

```python
from fastapi import APIRouter, HTTPException, Query, Path
from typing import List

from app.models import CatalogPage, ShowDetail, SeasonDetail, TorrentHit
from app.services import tv as tv_service

router = APIRouter()


@router.get("", response_model=CatalogPage, summary="Browse TV shows")
async def browse_tv(
    api: str = Query("popular", pattern="^(popular|top_rated|on_the_air|airing_today)$"),
    sort: str = Query("popularity.desc"),
    genre: int = Query(0, ge=0),
    year: int = Query(0, ge=0),
    page: int = Query(1, ge=1),
):
    return await tv_service.browse(api=api, sort=sort, genre=genre, year=year, page=page)


@router.get("/search", response_model=CatalogPage, summary="Search TV shows")
async def search_tv(q: str = Query(..., min_length=1), page: int = Query(1, ge=1)):
    return await tv_service.search(q=q, page=page)


@router.get("/{tmdb_id}", response_model=ShowDetail, summary="Show detail")
async def show_detail(tmdb_id: int = Path(..., ge=1)):
    show = await tv_service.show_detail(tmdb_id)
    if show is None:
        raise HTTPException(status_code=404, detail="Show not found")
    return show


@router.get("/{tmdb_id}/season/{season}", response_model=SeasonDetail, summary="Season episodes")
async def season_detail(tmdb_id: int = Path(..., ge=1), season: int = Path(..., ge=0)):
    s = await tv_service.season_detail(tmdb_id, season)
    if s is None:
        raise HTTPException(status_code=404, detail="Season not found")
    return s


@router.get("/{tmdb_id}/season/{season}/episode/{episode}/torrents",
            response_model=List[TorrentHit], summary="Episode torrents")
async def episode_torrents(tmdb_id: int = Path(..., ge=1), season: int = Path(..., ge=0),
                           episode: int = Path(..., ge=1)):
    return await tv_service.episode_torrents(tmdb_id, season, episode)
```

- [ ] **Step 2: Register the router in `backend/app/main.py`.** Add `tv` to the api import:
```python
from app.api import movies, torrents, schedules, streaming, users, tv
```
and add an include_router call alongside the others:
```python
app.include_router(
    tv.router,
    prefix=f"{settings.api_v1_str}/tv",
    tags=["TV"],
)
```

- [ ] **Step 3: Verify live** (backend reloads):
```bash
sleep 2
curl -s "http://localhost:8000/api/v1/tv?api=popular" | python3 -c "import sys,json;d=json.load(sys.stdin);print('shows',len(d['results']),'| first',d['results'][0]['title'] if d['results'] else None)"
curl -s "http://localhost:8000/api/v1/tv/76479" | python3 -c "import sys,json;d=json.load(sys.stdin);print('show',d.get('name'),'| seasons',d.get('number_of_seasons'))"
curl -s "http://localhost:8000/api/v1/tv/76479/season/1" | python3 -c "import sys,json;d=json.load(sys.stdin);print('season',d.get('name'),'| eps',len(d.get('episodes',[])))"
curl -s "http://localhost:8000/api/v1/tv/76479/season/1/episode/1/torrents" | python3 -c "import sys,json;h=json.load(sys.stdin);print('ep torrents',len(h),'| q',[x['quality'] for x in h[:3]])"
```
Expected: shows list non-empty; show "The Boys" with seasons; season 1 with episodes; episode torrents non-empty with parsed qualities.

- [ ] **Step 4: Commit**
```bash
git add backend/app/api/tv.py backend/app/main.py
git commit -q -m "feat(api): TV endpoints (browse/search/show/season/episode-torrents)"
```

---

## Task 5: Episode-aware download (`api/torrents.py`)

**Files:** Modify `backend/app/api/torrents.py`

- [ ] **Step 1: Add the tv service import.** After `from app.services import movies as movie_service` add:
```python
from app.services import tv as tv_service
```

- [ ] **Step 2: Replace the body of `download_movie`** (the `try:` block up to the `dl_movie = ...` line) so it branches on `media_type`. Replace:
```python
    try:
        title, year = await movie_service.resolve_title_year(request.tmdb_id)
        if not title:
            raise HTTPException(status_code=404, detail="Movie not found")

        name = f"{title} {year}".strip() if year else title
        hits = await catalog.torrents(name)
        best = select_best(hits, request.quality)
        if best is None:
            avail = available_qualities(hits)
            raise HTTPException(
                status_code=422,
                detail=f"No {request.quality} release found. Available: {avail or 'none'}",
            )

        dl_movie = _DlMovie(title=title, year=year, genre="")
```
with:
```python
    try:
        if request.media_type == "tv":
            if request.season is None or request.episode is None:
                raise HTTPException(status_code=422, detail="season and episode are required for TV downloads")
            show = await tv_service.resolve_show_name(request.tmdb_id)
            if not show:
                raise HTTPException(status_code=404, detail="Show not found")
            name = f"{show} S{request.season:02d}E{request.episode:02d}"
            label, year = name, None
        else:
            title, year = await movie_service.resolve_title_year(request.tmdb_id)
            if not title:
                raise HTTPException(status_code=404, detail="Movie not found")
            name = f"{title} {year}".strip() if year else title
            label = title

        hits = await catalog.torrents(name)
        best = select_best(hits, request.quality)
        if best is None:
            avail = available_qualities(hits)
            raise HTTPException(
                status_code=422,
                detail=f"No {request.quality} release found. Available: {avail or 'none'}",
            )

        dl_movie = _DlMovie(title=label, year=year, genre="")
```
(The remainder — building `_DlTorrent`, `add_torrent`, status — is unchanged.)

- [ ] **Step 3: Verify a live episode download** (backend reloads):
```bash
sleep 2
curl -s "http://localhost:8000/api/v1/tv/76479" >/dev/null   # cache the show name
curl -s -X POST http://localhost:8000/api/v1/torrents/download -H 'Content-Type: application/json' \
  -d '{"tmdb_id":76479,"quality":"1080p","media_type":"tv","season":1,"episode":1}' \
  | python3 -c "import sys,json;d=json.load(sys.stdin);print('state',d.get('state'),'| title',d.get('movie_title'))"
```
Expected: a `TorrentStatus` with `title` like "The Boys S01E01" and a queued/downloading state. Clean it up: find its id via `/torrents/list` and `DELETE /torrents/{id}`. Also confirm a movie download still works: `-d '{"tmdb_id":603,"quality":"1080p"}'` (after `curl /movies/search?q=matrix` to cache) → "The Matrix".

- [ ] **Step 4: Commit**
```bash
git add backend/app/api/torrents.py
git commit -q -m "feat(api): episode-aware download (media_type=tv + season/episode)"
```

---

## Task 6: Backend e2e (Stage A)

**Files:** none (verification).

- [ ] **Step 1: Rebuild backend (fresh image with new code)** — `docker compose up -d --build backend && sleep 5 && curl -sf http://localhost:8000/health && echo OK`.
- [ ] **Step 2: Run the full new unit suite** — `docker compose run --rm backend python -m pytest tests/test_tv_schemas.py tests/test_tv_normalize.py tests/test_quality.py tests/test_schemas.py tests/test_catalog_normalize.py tests/test_torrents_select.py -q` → all pass.
- [ ] **Step 3: Exercise the TV flow** — browse `/tv?api=popular`, show `/tv/76479`, season `/tv/76479/season/1`, episode torrents, episode download (as in Task 4/5 verifies). Report each result. (`available_qualities` and download depend on live torrents.)
- [ ] **Step 4: Report** what passed.

---

## Task 7: Frontend TV types (`types/index.ts`)

**Files:** Modify `frontend/src/types/index.ts` (additive)

- [ ] **Step 1: Add TV types** (after the `CatalogPage` block; do not remove anything):

```typescript
// --- TV ---
export interface SeasonSummary {
  season_number: number;
  name: string;
  episode_count: number;
  overview: string | null;
  poster_url: string | null;
  air_date: string | null;
}

export interface Episode {
  episode_number: number;
  name: string;
  overview: string | null;
  runtime: number | null;
  still_url: string | null;
  air_date: string | null;
  vote_average: number;
}

export interface ShowDetail {
  tmdb_id: number;
  media_type: 'tv';
  name: string;
  year: number | null;
  overview: string | null;
  poster_url: string | null;
  backdrop_url: string | null;
  genres: string[];
  status: string | null;
  first_air_date: string | null;
  last_air_date: string | null;
  number_of_seasons: number;
  vote_average: number;
  vote_count: number;
  seasons: SeasonSummary[];
}

export interface SeasonDetail {
  season_number: number;
  name: string;
  overview: string | null;
  episodes: Episode[];
}
```

- [ ] **Step 2: Extend `CatalogTorrentRequest`** (the download request added in Phase 1). Replace it with:
```typescript
export interface CatalogTorrentRequest {
  tmdb_id: number;
  quality: '720p' | '1080p' | '2160p';
  save_path?: string;
  media_type?: 'movie' | 'tv';
  season?: number;
  episode?: number;
}
```

- [ ] **Step 3: Type-check** — `docker compose exec -T frontend npx tsc --noEmit` → clean.
- [ ] **Step 4: Commit**
```bash
git add frontend/src/types/index.ts
git commit -q -m "feat(frontend): TV show/season/episode types"
```

---

## Task 8: TV service + nav (`services/tv.ts`, `Navigation.tsx`)

**Files:** Create `frontend/src/services/tv.ts`; Modify `frontend/src/components/ui/Navigation.tsx`

- [ ] **Step 1: Create `frontend/src/services/tv.ts`:**

```typescript
import apiClient from './api-client';
import { CatalogPage, ShowDetail, SeasonDetail, TorrentHit } from '@/types';

export const tvService = {
  browse: async (params: { api?: string; sort?: string; genre?: number; year?: number; page?: number }): Promise<CatalogPage> => {
    const response = await apiClient.get('/tv', { params });
    return response.data;
  },

  search: async (q: string, page = 1): Promise<CatalogPage> => {
    const response = await apiClient.get('/tv/search', { params: { q, page } });
    return response.data;
  },

  getShow: async (tmdbId: number): Promise<ShowDetail> => {
    const response = await apiClient.get(`/tv/${tmdbId}`);
    return response.data;
  },

  getSeason: async (tmdbId: number, season: number): Promise<SeasonDetail> => {
    const response = await apiClient.get(`/tv/${tmdbId}/season/${season}`);
    return response.data;
  },

  getEpisodeTorrents: async (tmdbId: number, season: number, episode: number): Promise<TorrentHit[]> => {
    const response = await apiClient.get(`/tv/${tmdbId}/season/${season}/episode/${episode}/torrents`);
    return response.data;
  },
};
```

- [ ] **Step 2: Add a "TV Shows" nav item** in `frontend/src/components/ui/Navigation.tsx`. Read the file; in the `navItems` array, add an entry between Search and My Movies:
```typescript
  { href: '/tv', label: 'TV Shows', icon: TvIcon },
```
Import `TvIcon` from `@heroicons/react/24/outline` alongside the existing icon imports.

- [ ] **Step 3: Type-check** — `docker compose exec -T frontend npx tsc --noEmit` → clean.
- [ ] **Step 4: Commit**
```bash
git add frontend/src/services/tv.ts frontend/src/components/ui/Navigation.tsx
git commit -q -m "feat(frontend): tv service + TV Shows nav item"
```

---

## Task 9: TV browse page (`/tv`)

**Files:** Create `frontend/src/app/tv/page.tsx` (+ any small browse component it needs)

This mirrors the movie browse experience but for shows. Read `frontend/src/components/search/SearchPageContent.tsx` and the movie browse/grid components for the established pattern, styling, and the `GENRE_OPTIONS`/`SORT_OPTIONS`/`YEAR_OPTIONS` usage.

- [ ] **Step 1: Build `/tv` browse** using `tvService.browse`:
  - A category toggle for `api`: **Popular** (`popular`), **On The Air** (`on_the_air`), **Airing Today** (`airing_today`).
  - Genre (`GENRE_OPTIONS`), sort (`SORT_OPTIONS`), year (`YEAR_OPTIONS`) filters — same controls as movie search.
  - Render `CatalogPage.results` (`CatalogItem[]`, `media_type:'tv'`) as a poster grid using the SAME card visual as movies: `item.poster_url`, `item.title` (the show name), `item.year`, `item.vote_average.toFixed(1)`, `item.genres.join(', ')`. Each card links to `/tv/${item.tmdb_id}`.
  - Pagination via `total_pages` (reuse the movie pagination pattern).
  - Reuse the existing `MovieCard` if it accepts a `CatalogItem` + a configurable detail href; otherwise create a thin `ShowCard` mirroring `MovieCard` that links to `/tv/...`. Prefer reuse: if `MovieCard` hardcodes `/movies/...`, add an optional `hrefBase` prop (default `/movies`) and pass `/tv` here.

- [ ] **Step 2: Type-check** — `docker compose exec -T frontend npx tsc --noEmit` → clean.
- [ ] **Step 3: Commit**
```bash
git add frontend/src/app/tv "frontend/src/components/movies/MovieCard.tsx"
git commit -q -m "feat(frontend): /tv browse page"
```
(Adjust the `git add` paths to whatever files you actually created/modified — e.g. a new `components/tv/ShowCard.tsx` if you made one.)

---

## Task 10: Show detail page (`/tv/[id]`) + episode download/stream

**Files:** Create `frontend/src/app/tv/[id]/page.tsx`, `frontend/src/components/tv/ShowDetailsContent.tsx` (+ small subcomponents as needed)

Read `frontend/src/app/movies/[id]/page.tsx` and `frontend/src/components/movies/MovieDetailsContent.tsx` for the established detail-page structure, hero styling, palette/backdrop handling, and how the movie download/stream button calls the torrents service. Mirror that look.

- [ ] **Step 1: Build the show detail page.** Route param `id` = show TMDB id → `tvService.getShow(Number(id))` → `ShowDetail`.
  - **Hero:** `backdrop_url` background, `poster_url`, `name`, `year` (guard null), `vote_average.toFixed(1)`, `genres.join(', ')`, `status`, `overview`.
  - **Season selector:** tabs or a dropdown over `show.seasons` (label `name`, badge `episode_count`); default to the first season with `season_number >= 1` (skip Specials/0 unless it's the only one). On select, `tvService.getSeason(showId, seasonNumber)` → `SeasonDetail`.
  - **Episode list:** for each `episode` in the season: `still_url` (guard null → placeholder), `S{season}E{episode_number}`, `name`, `runtime` (`${runtime}m`, guard null), `overview`, `vote_average`. Per episode, a **quality picker + Download** and **Stream** control.
  - **Download/stream an episode:** POST via the torrents download service with body `{ tmdb_id: showId, quality, media_type: 'tv', season: seasonNumber, episode: episode_number }` (use the Phase 1 `downloadCatalogMovie`/`handleCatalogStreamingStart` util — it already POSTs `CatalogTorrentRequest`, which now carries the TV fields). On a successful download response (`TorrentStatus`), the "Stream" flow navigates to `/streaming/${torrentId}` exactly like movies (single-episode torrent = one file; multi-file is Stage B).
  - Quality options: offer `720p / 1080p / 2160p` (Stage A doesn't pre-fetch episode `available_qualities`; the download returns 422 if the chosen quality is absent — surface that message via the existing toast).

- [ ] **Step 2: Type-check** — `docker compose exec -T frontend npx tsc --noEmit` → clean.
- [ ] **Step 3: Commit**
```bash
git add "frontend/src/app/tv/[id]" frontend/src/components/tv
git commit -q -m "feat(frontend): TV show detail page with seasons/episodes + episode download/stream"
```

---

## Task 11: Movies/TV toggle on search (`SearchPageContent.tsx`)

**Files:** Modify `frontend/src/components/search/SearchPageContent.tsx`

- [ ] **Step 1: Add a Movies/TV mode toggle.** Read the component. Add a `mode` state (`'movie' | 'tv'`, default `'movie'`). When `tv`, call `tvService.search(q, page)` and link results to `/tv/${item.tmdb_id}`; when `movie`, keep `moviesService.search` linking to `/movies/${item.tmdb_id}`. Results are `CatalogItem[]` in both modes (same card). Keep the existing genre/sort/year filters (they apply to browse; for search the toggle just switches the endpoint + result link base).
- [ ] **Step 2: Type-check** — `docker compose exec -T frontend npx tsc --noEmit` → clean.
- [ ] **Step 3: Commit**
```bash
git add frontend/src/components/search/SearchPageContent.tsx
git commit -q -m "feat(frontend): Movies/TV toggle on search"
```

---

## Task 12: Frontend e2e (Stage A)

**Files:** none (verification).

- [ ] **Step 1: Rebuild frontend** — `docker compose up -d --build frontend` (runs `next build`; must compile).
- [ ] **Step 2: Type-check** — `docker compose exec -T frontend npx tsc --noEmit` → clean.
- [ ] **Step 3: Browser check** (`http://localhost:3001`, profile "ben"): the nav shows **TV Shows**; `/tv` lists show posters (Popular/On The Air/Airing Today); clicking a show opens `/tv/<id>` with hero + season selector + episode rows; picking a quality + Download on an episode starts a download that appears on the downloads page; Search toggled to TV returns shows. Use Playwright (navigate + snapshot + screenshot) and report what rendered.
- [ ] **Step 4: Report** final Stage A status.

---

## Self-review notes (author)

- **Spec coverage (Stage A):** schemas (T1), catalog tv calls + mode (T2), service (T3), endpoints (T4), episode download (T5), backend verify (T6); frontend types (T7), service+nav (T8), browse (T9), show detail + episode download/stream (T10), search toggle (T11), verify (T12). Season packs + multi-file streaming = Stage B; continue-watching = Stage C (out of this plan, per spec staging).
- **Type/identity consistency:** `ShowDetail.name`/`Episode.episode_number`/`SeasonDetail.episodes` consistent across T1/T2/T7/T10; `TorrentRequest` TV fields (T1) match the download branch (T5) and the frontend `CatalogTorrentRequest` (T7) + episode download body (T10); `resolve_show_name` defined in T3 and used in T5. `normalize_show`/`normalize_season`/`normalize_episode` defined in T2 and used in T3.
- **Reuse:** single-episode streaming reuses the existing single-file path (no `file_index` yet); the movie download path is preserved (the `media_type` branch defaults to `movie`).
