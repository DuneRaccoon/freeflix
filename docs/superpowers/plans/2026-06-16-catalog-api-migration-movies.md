# Catalog API Migration — Phase 1 (Movies) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the decommissioned YTS HTML scraper with the new TMDB-shaped JSON API for movies — restoring browse, search, detail (TMDB-enriched), quality-bucket download, and streaming.

**Architecture:** Two thin async API clients (`providers/catalog.py` for the new `yts.lu` JSON API, `providers/tmdb.py` for real TMDB detail-by-id) plus pure helpers (`providers/quality.py`, `services/torrents_select.py`). Movies are identified by TMDB numeric id and cached in a new `CatalogItem` table. Endpoints and the download path are reworked to be tmdb-id based; the libtorrent manager is reused unchanged.

**Tech Stack:** FastAPI, httpx, pydantic v2, SQLAlchemy 1.4, pytest; Next.js 15 frontend.

**Branch:** `feat/catalog-api-migration` (already checked out).

---

## Conventions for this plan

- **The stack is running** (from earlier work) on backend `:8000`, frontend `:3001`, via Docker Compose. The dev override bind-mounts `./backend/app`, so backend source edits are live (uvicorn reload).
- **Run a backend test** (new tests live in `backend/tests/`, which is NOT bind-mounted by default) with this exact pattern — it mounts the tests dir so no rebuild is needed:
  ```bash
  docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest tests/<file>::<test> -v
  ```
  Referred to below as **RUNTEST**.
- **New API base** = `settings.yify_url_browse_url` (`https://en.yts.lu/browse-movies`). **Image CDN** = `https://image.tmdb.org/t/p/`. **Real TMDB** = `https://api.themoviedb.org/3` with `settings.tmdb_api_key`.
- Commit after each task. End commit messages with the standard trailer:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- Stage only the files each task names (the working tree has 4 pre-existing untouched `frontend/` WIP files — never stage them; never use `git add .`/`-a`).

## File map

```
backend/app/
  providers/                 # NEW package (replaces scrapers/)
    __init__.py
    quality.py     # Task 1  — pure: parse quality/codec/source from a release title
    catalog.py     # Task 3  — new JSON API client + result normalizer + genre map
    tmdb.py        # Task 4  — real TMDB movie/{id} client + normalizer
  services/
    torrents_select.py  # Task 5 — pick best torrent for a quality bucket
    movies.py      # Task 7  — REWORKED orchestration (browse/search/detail)
  api/
    movies.py      # Task 8  — REWORKED endpoints (tmdb-id based)
    torrents.py    # Task 9  — REWORKED download (tmdb_id + quality)
  cron/jobs.py     # Task 10 — REWORKED schedule execution (no scraper)
  database/models/
    catalog.py     # Task 6  — NEW CatalogItem cache model
    __init__.py    # Task 6  — export CatalogItem
  models.py        # Task 2  — NEW schemas; reworked TorrentRequest
  scrapers/        # Task 11 — DELETED
frontend/src/
  types/index.ts            # Task 13
  services/movies.ts        # Task 14
  next.config.ts            # Task 15
  components/movies/*, home/*, search/*  # Tasks 16–18 (adapt to new shape)
```

---

## Task 1: Quality parser (`providers/quality.py`)

**Files:**
- Create: `backend/app/providers/__init__.py` (empty), `backend/app/providers/quality.py`
- Test: `backend/tests/test_quality.py`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_quality.py`:

```python
from app.providers.quality import parse_quality, parse_release_info


def test_parse_quality_common_buckets():
    assert parse_quality("Your.Name.2016.1080p.BluRay.x264-HAiKU") == "1080p"
    assert parse_quality("Your Name. (2016) 2160p BRRip 5.1 10Bit x265 -YTS") == "2160p"
    assert parse_quality("Your Name. (2016) 720p BRRip x264 -YTS") == "720p"
    assert parse_quality("Some.Movie.2019.480p.WEBRip") == "480p"


def test_parse_quality_4k_and_uhd_map_to_2160p():
    assert parse_quality("Movie.2020.4K.UHD.BluRay.x265") == "2160p"
    assert parse_quality("Movie 2020 UHD 2160p") == "2160p"


def test_parse_quality_unknown_returns_none():
    assert parse_quality("Movie.2020.DVDRip.XviD") is None
    assert parse_quality("Your.Name.2016.BDRip.x264-HAiKU") is None


def test_parse_release_info_extracts_fields():
    info = parse_release_info("Your.Name.2016.2160p.UHD.BluRay.x265.10bit.HDR.DTS-HD.MA.5.1-SWT")
    assert info["quality"] == "2160p"
    assert info["codec"] == "x265"
    assert info["source"] == "BluRay"
    assert info["hdr"] is True
```

- [ ] **Step 2: Run the test to verify it fails**

Run (RUNTEST): `docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest tests/test_quality.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.providers'`.

- [ ] **Step 3: Implement `backend/app/providers/quality.py`**

```python
"""Pure helpers for parsing release metadata out of a torrent title."""
import re
from typing import Optional, Dict, Any

_QUALITY_PATTERNS = [
    ("2160p", re.compile(r"\b(2160p|4k|uhd)\b", re.IGNORECASE)),
    ("1080p", re.compile(r"\b1080p\b", re.IGNORECASE)),
    ("720p", re.compile(r"\b720p\b", re.IGNORECASE)),
    ("480p", re.compile(r"\b480p\b", re.IGNORECASE)),
]

_CODEC = re.compile(r"\b(x265|h\.?265|hevc|x264|h\.?264|av1|xvid)\b", re.IGNORECASE)
_SOURCE = re.compile(
    r"\b(bluray|blu-ray|bdrip|brrip|web-?dl|webrip|web|hdrip|hdtv|dvdrip|remux|cam)\b",
    re.IGNORECASE,
)
_HDR = re.compile(r"\b(hdr|hdr10|dolby\s*vision|\bdv\b)\b", re.IGNORECASE)


def parse_quality(title: str) -> Optional[str]:
    """Return '2160p'|'1080p'|'720p'|'480p' parsed from the title, else None."""
    for bucket, pattern in _QUALITY_PATTERNS:
        if pattern.search(title or ""):
            return bucket
    return None


def parse_release_info(title: str) -> Dict[str, Any]:
    """Return a dict of best-effort release metadata for display."""
    codec = _CODEC.search(title or "")
    source = _SOURCE.search(title or "")
    return {
        "quality": parse_quality(title),
        "codec": codec.group(0).lower() if codec else None,
        "source": _normalize_source(source.group(0)) if source else None,
        "hdr": bool(_HDR.search(title or "")),
    }


def _normalize_source(raw: str) -> str:
    s = raw.lower().replace("-", "")
    if s in ("bluray", "bluray"):
        return "BluRay"
    if s in ("webdl", "web"):
        return "WEB-DL"
    return raw.title()
```

Create `backend/app/providers/__init__.py` (empty file).

- [ ] **Step 4: Run the test to verify it passes**

Run (RUNTEST): `... pytest tests/test_quality.py -v`
Expected: PASS (4 tests). If `_normalize_source` mislabels `BluRay`, fix the mapping until `test_parse_release_info_extracts_fields` passes.

- [ ] **Step 5: Commit**

```bash
git add backend/app/providers/__init__.py backend/app/providers/quality.py backend/tests/test_quality.py
git commit -q -m "feat(providers): add release-title quality parser"
```

---

## Task 2: New pydantic schemas (`models.py`)

**Files:**
- Modify: `backend/app/models.py` (add new models; rework `TorrentRequest`)
- Test: `backend/tests/test_schemas.py`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_schemas.py`:

```python
from app.models import CatalogItem, MovieDetail, TorrentHit, CatalogPage, TorrentRequest


def test_catalog_item_defaults():
    item = CatalogItem(tmdb_id=372058, title="Your Name.")
    assert item.media_type == "movie"
    assert item.genre_ids == [] and item.genres == []
    assert item.vote_average == 0.0


def test_movie_detail_is_catalog_item_plus_fields():
    d = MovieDetail(tmdb_id=1, title="X", runtime=107, available_qualities=["1080p"])
    assert d.tmdb_id == 1 and d.runtime == 107
    assert d.available_qualities == ["1080p"]


def test_torrent_request_requires_tmdb_id_int():
    req = TorrentRequest(tmdb_id=372058, quality="1080p")
    assert req.tmdb_id == 372058 and req.quality == "1080p"


def test_catalog_page_shape():
    page = CatalogPage(page=2, results=[CatalogItem(tmdb_id=1, title="X")], total_pages=5, total_results=99)
    assert page.page == 2 and page.total_pages == 5 and len(page.results) == 1
```

- [ ] **Step 2: Run to verify it fails**

Run (RUNTEST): `... pytest tests/test_schemas.py -v`
Expected: FAIL — `ImportError: cannot import name 'CatalogItem'`.

- [ ] **Step 3: Add the models to `backend/app/models.py`**

Append after the existing `CastMember` model (keep `CastMember` as-is):

```python
class CatalogItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    tmdb_id: int
    media_type: Literal['movie'] = 'movie'
    title: str
    year: Optional[int] = None
    overview: Optional[str] = None
    poster_url: Optional[str] = None
    backdrop_url: Optional[str] = None
    genre_ids: List[int] = []
    genres: List[str] = []
    vote_average: float = 0.0
    vote_count: int = 0
    popularity: float = 0.0
    original_language: Optional[str] = None


class MovieDetail(CatalogItem):
    runtime: Optional[int] = None
    imdb_id: Optional[str] = None
    tagline: Optional[str] = None
    cast: List[CastMember] = []
    director: Optional[str] = None
    available_qualities: List[str] = []


class TorrentHit(BaseModel):
    title: str
    seeds: int = 0
    peers: int = 0
    bytes: int = 0
    magnet: str
    hash: str = ''
    source: Optional[str] = None
    quality: Optional[str] = None


class CatalogPage(BaseModel):
    page: int = 1
    results: List[CatalogItem] = []
    total_pages: int = 0
    total_results: int = 0


class MovieBrowseParams(BaseModel):
    api: Literal['popular', 'top_rated'] = 'popular'
    sort: str = 'popularity.desc'
    genre: int = 0
    year: int = 0
    page: int = 1
```

Then **replace** the existing `TorrentRequest` class with:

```python
class TorrentRequest(BaseModel):
    tmdb_id: int
    quality: Literal['720p', '1080p', '2160p'] = '1080p'
    save_path: Optional[str] = None
```

(`Literal`, `Optional`, `List` are already imported at the top of `models.py`.)

- [ ] **Step 4: Run to verify it passes**

Run (RUNTEST): `... pytest tests/test_schemas.py -v`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/app/models.py backend/tests/test_schemas.py
git commit -q -m "feat(models): add CatalogItem/MovieDetail/TorrentHit schemas; tmdb-id TorrentRequest"
```

---

## Task 3: Catalog API client + normalizer (`providers/catalog.py`)

**Files:**
- Create: `backend/app/providers/catalog.py`
- Test: `backend/tests/test_catalog_normalize.py`

- [ ] **Step 1: Write the failing test (pure normalizers)**

Create `backend/tests/test_catalog_normalize.py`:

```python
from app.providers.catalog import normalize_item, normalize_hit, image_url, genre_names


def test_image_url_prefixes_relative_path():
    assert image_url("/abc.jpg", "w500") == "https://image.tmdb.org/t/p/w500/abc.jpg"
    assert image_url(None, "w500") is None


def test_genre_names_maps_known_ids():
    assert genre_names([16, 18]) == ["Animation", "Drama"]
    # unknown ids are dropped, not crashed
    assert genre_names([999999]) == []


def test_normalize_item_from_movie_object():
    raw = {
        "id": 372058, "title": "Your Name.", "overview": "High schoolers...",
        "poster_path": "/p.jpg", "backdrop_path": "/b.jpg",
        "genre_ids": [16, 18], "vote_average": 8.4, "vote_count": 12000,
        "popularity": 100.0, "original_language": "ja", "release_date": "2016-08-26",
    }
    item = normalize_item(raw)
    assert item.tmdb_id == 372058
    assert item.title == "Your Name."
    assert item.year == 2016
    assert item.poster_url == "https://image.tmdb.org/t/p/w500/p.jpg"
    assert item.backdrop_url == "https://image.tmdb.org/t/p/w1280/b.jpg"
    assert item.genres == ["Animation", "Drama"]


def test_normalize_hit_parses_quality_and_renames_magnet():
    raw = {"title": "Your.Name.2016.1080p.BluRay.x264-HAiKU", "seeds": 118,
           "peers": 5, "bytes": 5930685952, "magnetUrl": "magnet:?xt=urn:btih:ABC",
           "hash": "ABC", "source": "Knaben"}
    hit = normalize_hit(raw)
    assert hit.magnet == "magnet:?xt=urn:btih:ABC"
    assert hit.seeds == 118
    assert hit.quality == "1080p"
```

- [ ] **Step 2: Run to verify it fails**

Run (RUNTEST): `... pytest tests/test_catalog_normalize.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.providers.catalog'`.

- [ ] **Step 3: Implement `backend/app/providers/catalog.py`**

```python
"""Client + normalizers for the new TMDB-shaped JSON catalog API."""
import httpx
from typing import List, Optional, Dict, Any
from loguru import logger
from leakybucket import LeakyBucket
from leakybucket.persistence import InMemoryLeakyBucketStorage

from app.config import settings
from app.models import CatalogItem, TorrentHit, CatalogPage
from app.providers.quality import parse_quality
from app.utils.user_agent import get_random_user_agent

_IMG_BASE = "https://image.tmdb.org/t/p"

# Combined TMDB movie + TV genre id -> name map (for resolving genre_ids on items).
TMDB_GENRES: Dict[int, str] = {
    28: "Action", 12: "Adventure", 16: "Animation", 35: "Comedy", 80: "Crime",
    99: "Documentary", 18: "Drama", 10751: "Family", 14: "Fantasy", 36: "History",
    27: "Horror", 10402: "Music", 9648: "Mystery", 10749: "Romance",
    878: "Science Fiction", 10770: "TV Movie", 53: "Thriller", 10752: "War",
    37: "Western", 10759: "Action & Adventure", 10762: "Kids", 10763: "News",
    10764: "Reality", 10765: "Sci-Fi & Fantasy", 10766: "Soap", 10767: "Talk",
    10768: "War & Politics",
}

_throttler = LeakyBucket(InMemoryLeakyBucketStorage(
    max_rate=settings.request_rate_limit, time_period=1))


def image_url(path: Optional[str], size: str) -> Optional[str]:
    if not path:
        return None
    return f"{_IMG_BASE}/{size}{path}"


def genre_names(ids: List[int]) -> List[str]:
    return [TMDB_GENRES[i] for i in (ids or []) if i in TMDB_GENRES]


def _year_from(raw: Dict[str, Any]) -> Optional[int]:
    date = raw.get("release_date") or raw.get("first_air_date") or ""
    return int(date[:4]) if date[:4].isdigit() else None


def normalize_item(raw: Dict[str, Any]) -> CatalogItem:
    return CatalogItem(
        tmdb_id=raw["id"],
        title=raw.get("title") or raw.get("name") or "",
        year=_year_from(raw),
        overview=raw.get("overview"),
        poster_url=image_url(raw.get("poster_path"), "w500"),
        backdrop_url=image_url(raw.get("backdrop_path"), "w1280"),
        genre_ids=raw.get("genre_ids") or [],
        genres=genre_names(raw.get("genre_ids") or []),
        vote_average=raw.get("vote_average") or 0.0,
        vote_count=raw.get("vote_count") or 0,
        popularity=raw.get("popularity") or 0.0,
        original_language=raw.get("original_language"),
    )


def normalize_hit(raw: Dict[str, Any]) -> TorrentHit:
    title = raw.get("title") or ""
    return TorrentHit(
        title=title,
        seeds=raw.get("seeds") or 0,
        peers=raw.get("peers") or 0,
        bytes=raw.get("bytes") or 0,
        magnet=raw.get("magnetUrl") or "",
        hash=raw.get("hash") or "",
        source=raw.get("source"),
        quality=parse_quality(title),
    )


async def _get(params: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    _throttler.throttle()
    headers = {"User-Agent": get_random_user_agent()}
    async with httpx.AsyncClient(headers=headers) as client:
        try:
            resp = await client.get(settings.yify_url_browse_url, params=params, timeout=20.0)
            resp.raise_for_status()
            return resp.json()
        except Exception as e:  # network/HTTP/JSON errors -> caller degrades
            logger.error(f"Catalog API error for params={params}: {e}")
            return None


async def browse(api: str = "popular", sort: str = "popularity.desc",
                 genre: int = 0, year: int = 0, page: int = 1) -> CatalogPage:
    params = {"api": api, "mode": "movie", "page": page, "sort": sort}
    if genre:
        params["genre"] = genre
    if year:
        params["year"] = year
    data = await _get(params) or {}
    return CatalogPage(
        page=data.get("page", page),
        results=[normalize_item(r) for r in data.get("results", [])],
        total_pages=data.get("total_pages", 0),
        total_results=data.get("total_results", 0),
    )


async def search(q: str, page: int = 1) -> CatalogPage:
    data = await _get({"api": "search", "mode": "movie", "q": q, "page": page}) or {}
    return CatalogPage(
        page=data.get("page", page),
        results=[normalize_item(r) for r in data.get("results", [])],
        total_pages=data.get("total_pages", 0),
        total_results=data.get("total_results", 0),
    )


async def torrents(name: str) -> List[TorrentHit]:
    data = await _get({"api": "torrents", "name": name}) or {}
    return [normalize_hit(h) for h in data.get("hits", [])]
```

- [ ] **Step 4: Run to verify it passes**

Run (RUNTEST): `... pytest tests/test_catalog_normalize.py -v`
Expected: PASS (4 tests).

- [ ] **Step 5: Live smoke check (network)**

Run:
```bash
docker compose exec -T backend python -c "import asyncio; from app.providers import catalog as c; p=asyncio.run(c.browse()); print('items', len(p.results), '| first', p.results[0].title if p.results else None); h=asyncio.run(c.torrents('Your Name 2016')); print('hits', len(h), '| q', h[0].quality if h else None)"
```
Expected: prints a non-zero item count with a title, and a non-zero hit count with a parsed quality. (If the network is unavailable here, note it and rely on the unit tests + Task 12.)

- [ ] **Step 6: Commit**

```bash
git add backend/app/providers/catalog.py backend/tests/test_catalog_normalize.py
git commit -q -m "feat(providers): catalog API client + result/torrent normalizers"
```

---

## Task 4: Real-TMDB detail client (`providers/tmdb.py`)

**Files:**
- Create: `backend/app/providers/tmdb.py`
- Test: `backend/tests/test_tmdb_normalize.py`

- [ ] **Step 1: Write the failing test (pure normalizer)**

Create `backend/tests/test_tmdb_normalize.py`:

```python
from app.providers.tmdb import normalize_movie_detail


SAMPLE = {
    "id": 372058, "title": "Your Name.", "overview": "High schoolers...",
    "poster_path": "/p.jpg", "backdrop_path": "/b.jpg", "release_date": "2016-08-26",
    "runtime": 106, "vote_average": 8.5, "vote_count": 12000, "popularity": 90.0,
    "original_language": "ja", "imdb_id": "tt5311514", "tagline": "...",
    "genres": [{"id": 16, "name": "Animation"}, {"id": 18, "name": "Drama"}],
    "credits": {
        "cast": [{"name": "Ryunosuke Kamiki", "character": "Taki", "profile_path": "/c.jpg"}],
        "crew": [{"name": "Makoto Shinkai", "job": "Director"}],
    },
}


def test_normalize_movie_detail_extracts_rich_fields():
    d = normalize_movie_detail(SAMPLE)
    assert d.tmdb_id == 372058
    assert d.year == 2016
    assert d.runtime == 106
    assert d.imdb_id == "tt5311514"
    assert d.genres == ["Animation", "Drama"]
    assert d.director == "Makoto Shinkai"
    assert d.cast[0].name == "Ryunosuke Kamiki"
    assert d.cast[0].image == "https://image.tmdb.org/t/p/w185/c.jpg"
```

- [ ] **Step 2: Run to verify it fails**

Run (RUNTEST): `... pytest tests/test_tmdb_normalize.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.providers.tmdb'`.

- [ ] **Step 3: Implement `backend/app/providers/tmdb.py`**

```python
"""Client + normalizer for the real TMDB API (movie detail-by-id)."""
import httpx
from typing import Optional, Dict, Any, List
from loguru import logger

from app.config import settings
from app.models import MovieDetail, CastMember
from app.providers.catalog import image_url

_BASE = "https://api.themoviedb.org/3"
_CAST_LIMIT = 15


def normalize_movie_detail(raw: Dict[str, Any]) -> MovieDetail:
    date = raw.get("release_date") or ""
    genres: List[str] = [g["name"] for g in raw.get("genres", []) if g.get("name")]
    credits = raw.get("credits") or {}
    director = next(
        (c["name"] for c in credits.get("crew", []) if c.get("job") == "Director"), None)
    cast = [
        CastMember(
            name=c.get("name", ""),
            character=c.get("character"),
            image=image_url(c.get("profile_path"), "w185"),
        )
        for c in credits.get("cast", [])[:_CAST_LIMIT]
    ]
    return MovieDetail(
        tmdb_id=raw["id"],
        title=raw.get("title") or raw.get("name") or "",
        year=int(date[:4]) if date[:4].isdigit() else None,
        overview=raw.get("overview"),
        poster_url=image_url(raw.get("poster_path"), "w500"),
        backdrop_url=image_url(raw.get("backdrop_path"), "w1280"),
        genres=genres,
        vote_average=raw.get("vote_average") or 0.0,
        vote_count=raw.get("vote_count") or 0,
        popularity=raw.get("popularity") or 0.0,
        original_language=raw.get("original_language"),
        runtime=raw.get("runtime"),
        imdb_id=raw.get("imdb_id"),
        tagline=raw.get("tagline"),
        cast=cast,
        director=director,
    )


async def movie_details(tmdb_id: int) -> Optional[MovieDetail]:
    """Fetch full movie detail + credits by TMDB id. None if no key or on error."""
    if not settings.tmdb_api_key:
        logger.warning("TMDB_API_KEY not set; skipping rich movie detail")
        return None
    params = {"api_key": settings.tmdb_api_key, "append_to_response": "credits"}
    async with httpx.AsyncClient() as client:
        try:
            resp = await client.get(f"{_BASE}/movie/{tmdb_id}", params=params, timeout=15.0)
            resp.raise_for_status()
            return normalize_movie_detail(resp.json())
        except Exception as e:
            logger.error(f"TMDB detail error for id={tmdb_id}: {e}")
            return None
```

- [ ] **Step 4: Run to verify it passes**

Run (RUNTEST): `... pytest tests/test_tmdb_normalize.py -v`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add backend/app/providers/tmdb.py backend/tests/test_tmdb_normalize.py
git commit -q -m "feat(providers): real-TMDB movie detail-by-id client + normalizer"
```

---

## Task 5: Torrent selection (`services/torrents_select.py`)

**Files:**
- Create: `backend/app/services/torrents_select.py`
- Test: `backend/tests/test_torrents_select.py`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_torrents_select.py`:

```python
from app.models import TorrentHit
from app.services.torrents_select import select_best, available_qualities


def _hit(title, seeds, byts=1000):
    return TorrentHit(title=title, seeds=seeds, bytes=byts, magnet="magnet:x",
                      quality=__import__("app.providers.quality", fromlist=["parse_quality"]).parse_quality(title))


def test_select_best_picks_highest_seeded_in_bucket():
    hits = [_hit("M.2020.1080p.BluRay", 50), _hit("M.2020.1080p.WEB", 120),
            _hit("M.2020.2160p.BluRay", 999)]
    best = select_best(hits, "1080p")
    assert best.seeds == 120


def test_select_best_tie_breaks_on_larger_bytes():
    hits = [_hit("M.2020.1080p.A", 100, byts=1000), _hit("M.2020.1080p.B", 100, byts=5000)]
    assert select_best(hits, "1080p").bytes == 5000


def test_select_best_none_when_bucket_absent():
    hits = [_hit("M.2020.720p.WEB", 80)]
    assert select_best(hits, "2160p") is None


def test_available_qualities_ordered_desc():
    hits = [_hit("M.720p", 1), _hit("M.2160p", 1), _hit("M.1080p", 1), _hit("M.BDRip", 1)]
    assert available_qualities(hits) == ["2160p", "1080p", "720p"]
```

- [ ] **Step 2: Run to verify it fails**

Run (RUNTEST): `... pytest tests/test_torrents_select.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.services.torrents_select'`.

- [ ] **Step 3: Implement `backend/app/services/torrents_select.py`**

```python
"""Choose the best torrent hit for a requested quality bucket."""
from typing import List, Optional
from app.models import TorrentHit

_ORDER = ["2160p", "1080p", "720p", "480p"]


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

- [ ] **Step 4: Run to verify it passes**

Run (RUNTEST): `... pytest tests/test_torrents_select.py -v`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/torrents_select.py backend/tests/test_torrents_select.py
git commit -q -m "feat(services): quality-bucket torrent selector"
```

---

## Task 6: Catalog cache model (`database/models/catalog.py`)

**Files:**
- Create: `backend/app/database/models/catalog.py`
- Modify: `backend/app/database/models/__init__.py` (export `CatalogItem` ORM)
- Test: `backend/tests/test_catalog_cache.py`

Read `backend/app/database/models/__init__.py` first to see current exports and the existing import style.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_catalog_cache.py`:

```python
import os
os.environ.setdefault("DB_PATH", "/tmp/test_catalog.db")

from app.database.session import Base, engine, get_db
from app.database.models.catalog import CatalogItemCache


def setup_module(_):
    Base.metadata.create_all(bind=engine)


def test_upsert_then_get_roundtrips():
    with get_db() as db:
        CatalogItemCache.upsert_list_item(db, tmdb_id=999001, title="Test Movie", year=2020,
                                          overview="o", poster_url="p", backdrop_url="b",
                                          genre_ids=[18], genres=["Drama"], vote_average=7.5,
                                          vote_count=10, popularity=5.0, original_language="en")
    with get_db() as db:
        row = CatalogItemCache.get(db, "movie", 999001)
        assert row is not None
        assert row.title == "Test Movie" and row.year == 2020


def test_upsert_is_idempotent_on_media_type_tmdb_id():
    with get_db() as db:
        CatalogItemCache.upsert_list_item(db, tmdb_id=999002, title="A", year=2001)
        CatalogItemCache.upsert_list_item(db, tmdb_id=999002, title="A (updated)", year=2001)
    with get_db() as db:
        rows = db.query(CatalogItemCache).filter_by(media_type="movie", tmdb_id=999002).all()
        assert len(rows) == 1 and rows[0].title == "A (updated)"
```

- [ ] **Step 2: Run to verify it fails**

Run (RUNTEST): `... pytest tests/test_catalog_cache.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.database.models.catalog'`.

- [ ] **Step 3: Implement `backend/app/database/models/catalog.py`**

```python
"""Cache for catalog items keyed by (media_type, tmdb_id)."""
import datetime
from sqlalchemy import Column, String, Integer, Float, Text, JSON, DateTime, UniqueConstraint
from sqlalchemy.orm import Session

from app.database.mixins import Model, generate_uuid
from app.config import settings


class CatalogItemCache(Model):
    __tablename__ = "catalog_items"
    __table_args__ = (UniqueConstraint("media_type", "tmdb_id", name="uq_catalog_media_tmdb"),)

    id = Column(String, primary_key=True, default=generate_uuid)
    media_type = Column(String, nullable=False, default="movie", index=True)
    tmdb_id = Column(Integer, nullable=False, index=True)

    title = Column(String, nullable=False)
    year = Column(Integer, nullable=True)
    overview = Column(Text, nullable=True)
    poster_url = Column(String, nullable=True)
    backdrop_url = Column(String, nullable=True)
    genre_ids = Column(JSON, nullable=True)
    genres = Column(JSON, nullable=True)
    vote_average = Column(Float, default=0.0)
    vote_count = Column(Integer, default=0)
    popularity = Column(Float, default=0.0)
    original_language = Column(String, nullable=True)

    detail_json = Column(JSON, nullable=True)        # enriched MovieDetail dump
    torrents_json = Column(JSON, nullable=True)       # cached TorrentHit dumps
    fetched_at = Column(DateTime, nullable=True)
    detail_fetched_at = Column(DateTime, nullable=True)
    expires_at = Column(DateTime, nullable=True)

    @classmethod
    def get(cls, db: Session, media_type: str, tmdb_id: int):
        return db.query(cls).filter_by(media_type=media_type, tmdb_id=tmdb_id).first()

    @classmethod
    def upsert_list_item(cls, db: Session, *, tmdb_id: int, media_type: str = "movie", **fields):
        now = datetime.datetime.now(datetime.timezone.utc)
        row = cls.get(db, media_type, tmdb_id)
        if row is None:
            row = cls(id=generate_uuid(), media_type=media_type, tmdb_id=tmdb_id)
            db.add(row)
        for key, value in fields.items():
            setattr(row, key, value)
        row.fetched_at = now
        row.expires_at = now + datetime.timedelta(days=settings.cache_movies_for)
        db.flush()
        return row

    def set_detail(self, db: Session, detail_json: dict):
        self.detail_json = detail_json
        self.detail_fetched_at = datetime.datetime.now(datetime.timezone.utc)
        db.flush()

    def set_torrents(self, db: Session, torrents_json: list):
        self.torrents_json = torrents_json
        db.flush()
```

- [ ] **Step 4: Export it — modify `backend/app/database/models/__init__.py`**

Add to the imports/exports (match the existing style in that file): import `CatalogItemCache` from `.catalog` and add it to `__all__` if one exists. Remove the `MovieCache` export if it is re-exported there (the YTS cache is replaced; the class can stay in `torrents.py` for now but should not be imported by app code after Task 8).

- [ ] **Step 5: Run to verify it passes**

Run (RUNTEST): `... pytest tests/test_catalog_cache.py -v`
Expected: PASS (2 tests). (`init_db()` in `main.py` calls `Base.metadata.create_all`, so the new table is created on app startup automatically.)

- [ ] **Step 6: Commit**

```bash
git add backend/app/database/models/catalog.py backend/app/database/models/__init__.py backend/tests/test_catalog_cache.py
git commit -q -m "feat(db): CatalogItemCache keyed by (media_type, tmdb_id)"
```

---

## Task 7: Movie service orchestration (`services/movies.py`)

**Files:**
- Replace: `backend/app/services/movies.py` (delete the YTS `MovieDetailsService`; add orchestration functions)

This module gets the OMDB/scraping `MovieDetailsService` removed and replaced with thin orchestration over `providers.catalog`, `providers.tmdb`, and `CatalogItemCache`. No new unit test (it's I/O orchestration; covered by Task 12 end-to-end). Keep it small.

- [ ] **Step 1: Replace `backend/app/services/movies.py` with:**

```python
"""Movie orchestration: catalog browse/search + TMDB-enriched detail, with caching."""
import datetime
from typing import Optional
from loguru import logger

from app.models import CatalogPage, MovieDetail, CatalogItem
from app.providers import catalog, tmdb
from app.services.torrents_select import available_qualities
from app.database.session import get_db
from app.database.models.catalog import CatalogItemCache


def _cache_page(page: CatalogPage) -> None:
    """Upsert every item from a browse/search page into the cache."""
    try:
        with get_db() as db:
            for item in page.results:
                CatalogItemCache.upsert_list_item(
                    db, tmdb_id=item.tmdb_id, media_type="movie",
                    title=item.title, year=item.year, overview=item.overview,
                    poster_url=item.poster_url, backdrop_url=item.backdrop_url,
                    genre_ids=item.genre_ids, genres=item.genres,
                    vote_average=item.vote_average, vote_count=item.vote_count,
                    popularity=item.popularity, original_language=item.original_language,
                )
    except Exception as e:
        logger.error(f"Failed to cache catalog page: {e}")


async def browse(api: str, sort: str, genre: int, year: int, page: int) -> CatalogPage:
    result = await catalog.browse(api=api, sort=sort, genre=genre, year=year, page=page)
    _cache_page(result)
    return result


async def search(q: str, page: int) -> CatalogPage:
    result = await catalog.search(q=q, page=page)
    _cache_page(result)
    return result


def _cached_item(tmdb_id: int) -> Optional[CatalogItem]:
    with get_db() as db:
        row = CatalogItemCache.get(db, "movie", tmdb_id)
        if not row:
            return None
        return CatalogItem(
            tmdb_id=row.tmdb_id, title=row.title, year=row.year, overview=row.overview,
            poster_url=row.poster_url, backdrop_url=row.backdrop_url,
            genre_ids=row.genre_ids or [], genres=row.genres or [],
            vote_average=row.vote_average or 0.0, vote_count=row.vote_count or 0,
            popularity=row.popularity or 0.0, original_language=row.original_language,
        )


async def detail(tmdb_id: int) -> Optional[MovieDetail]:
    """Rich detail via TMDB-by-id, falling back to the cached list item."""
    enriched = await tmdb.movie_details(tmdb_id)
    base = enriched
    if base is None:
        cached = _cached_item(tmdb_id)
        if cached is None:
            return None
        base = MovieDetail(**cached.model_dump())

    # discover available qualities from a (cached) torrents fetch
    name = f"{base.title} {base.year}".strip() if base.year else base.title
    hits = await catalog.torrents(name)
    base.available_qualities = available_qualities(hits)

    # persist enriched detail
    try:
        with get_db() as db:
            row = CatalogItemCache.get(db, "movie", tmdb_id)
            if row:
                row.set_detail(db, base.model_dump())
                row.set_torrents(db, [h.model_dump() for h in hits])
    except Exception as e:
        logger.error(f"Failed to persist movie detail {tmdb_id}: {e}")
    return base


async def get_torrents(tmdb_id: int):
    """Return parsed torrent hits for a movie (by cached title/year or TMDB fallback)."""
    title, year = await _resolve_title_year(tmdb_id)
    if not title:
        return []
    name = f"{title} {year}".strip() if year else title
    return await catalog.torrents(name)


async def _resolve_title_year(tmdb_id: int):
    cached = _cached_item(tmdb_id)
    if cached:
        return cached.title, cached.year
    enriched = await tmdb.movie_details(tmdb_id)
    if enriched:
        return enriched.title, enriched.year
    return None, None
```

- [ ] **Step 2: Verify the module imports**

Run: `docker compose exec -T backend python -c "import app.services.movies as m; print([f for f in dir(m) if not f.startswith('_')])"`
Expected: prints a list including `browse, search, detail, get_torrents` (no import errors). (Other modules still importing the old `movie_details_service` will be fixed in Task 8/11.)

- [ ] **Step 3: Commit**

```bash
git add backend/app/services/movies.py
git commit -q -m "refactor(services): movie orchestration over catalog + TMDB + cache"
```

---

## Task 8: Rework movie endpoints (`api/movies.py`)

**Files:**
- Replace: `backend/app/api/movies.py`

- [ ] **Step 1: Replace `backend/app/api/movies.py` with:**

```python
from fastapi import APIRouter, HTTPException, Query, Path
from loguru import logger

from app.models import CatalogPage, MovieDetail, TorrentHit
from app.services import movies as movie_service
from typing import List

router = APIRouter()


@router.get("", response_model=CatalogPage, summary="Browse movies")
async def browse_movies(
    api: str = Query("popular", pattern="^(popular|top_rated)$"),
    sort: str = Query("popularity.desc"),
    genre: int = Query(0, ge=0),
    year: int = Query(0, ge=0),
    page: int = Query(1, ge=1),
):
    return await movie_service.browse(api=api, sort=sort, genre=genre, year=year, page=page)


@router.get("/search", response_model=CatalogPage, summary="Search movies")
async def search_movies(q: str = Query(..., min_length=1), page: int = Query(1, ge=1)):
    return await movie_service.search(q=q, page=page)


@router.get("/{tmdb_id}", response_model=MovieDetail, summary="Movie detail")
async def movie_detail(tmdb_id: int = Path(..., ge=1)):
    detail = await movie_service.detail(tmdb_id)
    if detail is None:
        raise HTTPException(status_code=404, detail="Movie not found")
    return detail


@router.get("/{tmdb_id}/torrents", response_model=List[TorrentHit], summary="Movie torrents")
async def movie_torrents(tmdb_id: int = Path(..., ge=1)):
    return await movie_service.get_torrents(tmdb_id)
```

Note: the browse route is `""` (slashless) so it serves `/api/v1/movies` without a redirect (consistent with the trailing-slash fix). The `/{tmdb_id}` int converter means `/search` must be declared before it — it is.

- [ ] **Step 2: Verify routing + a live call**

Run:
```bash
curl -s "http://localhost:8000/api/v1/movies?api=popular&page=1" | python3 -c "import sys,json; d=json.load(sys.stdin); print('results', len(d['results']), '| first', d['results'][0]['title'] if d['results'] else None)"
curl -s "http://localhost:8000/api/v1/movies/search?q=matrix" | python3 -c "import sys,json; d=json.load(sys.stdin); print('search results', len(d['results']))"
```
Expected: non-zero results with titles. (Backend auto-reloaded via the dev mount.) If it errors on import (old symbols), check Task 11 hasn't run yet — `main.py` still imports the old router fine since the router object name is unchanged.

- [ ] **Step 3: Commit**

```bash
git add backend/app/api/movies.py
git commit -q -m "feat(api): tmdb-id movie endpoints (browse/search/detail/torrents)"
```

---

## Task 9: Rework the download endpoint (`api/torrents.py`)

**Files:**
- Modify: `backend/app/api/torrents.py` (replace the import line + the `download_movie` handler)

- [ ] **Step 1: Replace the top imports** of `backend/app/api/torrents.py`

Change:
```python
from app.models import TorrentRequest, TorrentStatus, TorrentAction
from app.scrapers.yts import search_movie, get_movie_by_url
from app.torrent.manager import torrent_manager
from app.config import settings
from app.database.session import get_db
```
to:
```python
from dataclasses import dataclass
from typing import Optional as _Optional, Tuple as _Tuple

from app.models import TorrentRequest, TorrentStatus, TorrentAction
from app.services import movies as movie_service
from app.services.torrents_select import select_best, available_qualities
from app.providers import catalog
from app.torrent.manager import torrent_manager
from app.config import settings
from app.database.session import get_db


def _human_size(num: int) -> str:
    size = float(num or 0)
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if size < 1024 or unit == "TB":
            return f"{size:.1f} {unit}"
        size /= 1024


@dataclass
class _DlMovie:
    title: str
    year: _Optional[int]
    genre: str


@dataclass
class _DlTorrent:
    id: str
    quality: str
    magnet: str
    url: str
    sizes: _Tuple[str, str]
```

- [ ] **Step 2: Replace the `download_movie` handler** with a tmdb-id flow

Replace the whole `@router.post("/download/movie" ...)` function (lines ~15–63) with:

```python
import uuid as _uuid
from pathlib import Path as PathLib


@router.post("/download", response_model=TorrentStatus, summary="Download a movie")
async def download_movie(request: TorrentRequest, background_tasks: BackgroundTasks):
    """Start downloading a movie by TMDB id at the requested quality bucket."""
    try:
        title, year = await movie_service._resolve_title_year(request.tmdb_id)
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
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
```

`BackgroundTasks`, `HTTPException`, `Query`, `Path`, `List`, `Optional`, `Dict`, `Any` remain imported from the original top-of-file imports (keep those lines). The status/list/action/delete handlers below are unchanged.

- [ ] **Step 3: Verify a live download**

Run:
```bash
curl -s -X POST http://localhost:8000/api/v1/torrents/download -H 'Content-Type: application/json' \
  -d '{"tmdb_id":372058,"quality":"1080p"}' | python3 -c "import sys,json; d=json.load(sys.stdin); print('state', d.get('state'), '| movie', d.get('movie_title'), '| quality', d.get('quality'))"
```
Expected: a `TorrentStatus` JSON with `state` = `queued`/`downloading_metadata` and `movie_title` = "Your Name." . Then `curl -s http://localhost:8000/api/v1/torrents/list` shows it. (Cancel/clean it afterward via the action/delete endpoints if desired.)

- [ ] **Step 4: Commit**

```bash
git add backend/app/api/torrents.py
git commit -q -m "feat(api): tmdb-id quality-bucket movie download"
```

---

## Task 10: Rework scheduled downloads (`cron/jobs.py`)

**Files:**
- Modify: `backend/app/cron/jobs.py` (remove the `browse_yts` import + rework `execute_schedule`'s movie-finding to the new flow)

Read `backend/app/cron/jobs.py` around `execute_schedule` (≈ lines 191–309) first. The existing schedule config carries `SearchParams` (keyword, genre, year, order_by) + `quality` + `max_downloads`. Keep `ScheduleConfig`/`SearchParams` and the frontend schedule form unchanged; just translate to the new catalog calls.

- [ ] **Step 1: Add a translator + replace the movie-finding block**

At the top of `cron/jobs.py`, replace any `from app.scrapers.yts import browse_yts` (and related scraper imports) with:
```python
from app.providers import catalog
from app.services.torrents_select import select_best
```

Add this helper near the top of the module:
```python
# Map the legacy SearchParams genre names to new numeric TMDB genre ids.
_GENRE_NAME_TO_ID = {
    "action": 28, "adventure": 12, "animation": 16, "comedy": 35, "crime": 80,
    "documentary": 99, "drama": 18, "family": 10751, "fantasy": 14, "history": 36,
    "horror": 27, "music": 10402, "mystery": 9648, "romance": 10749, "sci-fi": 878,
    "thriller": 53, "war": 10752, "western": 37,
}
_ORDER_TO_SORT = {
    "rating": "vote_average.desc", "year": "primary_release_date.desc",
    "latest": "primary_release_date.desc", "likes": "popularity.desc",
    "featured": "popularity.desc",
}


async def _find_movies_for_schedule(search_params):
    """Return a list of CatalogItem for a schedule's SearchParams via the new API."""
    if search_params.keyword:
        page = await catalog.search(q=search_params.keyword, page=search_params.page or 1)
    else:
        genre = _GENRE_NAME_TO_ID.get((search_params.genre or "all").lower(), 0)
        year = int(search_params.year) if (search_params.year or "all").isdigit() else 0
        sort = _ORDER_TO_SORT.get(search_params.order_by or "featured", "popularity.desc")
        page = await catalog.browse(api="popular", sort=sort, genre=genre, year=year,
                                    page=search_params.page or 1)
    return page.results
```

Then, inside `execute_schedule`, replace the block that called `browse_yts(...)` and looped to find a quality-matching torrent. The new block (preserving the surrounding logging / `max_downloads` / `ScheduleLog` code) is:

```python
        items = await _find_movies_for_schedule(schedule.config.search_params)
        items = sorted(items, key=lambda m: m.vote_average, reverse=True)[: schedule.config.max_downloads]

        from app.api.torrents import _DlMovie, _DlTorrent, _human_size  # reuse the download shims
        import uuid as _uuid
        for item in items:
            name = f"{item.title} {item.year}".strip() if item.year else item.title
            hits = await catalog.torrents(name)
            best = select_best(hits, schedule.config.quality)
            if not best:
                logger.info(f"No {schedule.config.quality} release for {item.title}; skipping")
                continue
            dl_movie = _DlMovie(title=item.title, year=item.year, genre="")
            dl_torrent = _DlTorrent(id=str(_uuid.uuid4()), quality=schedule.config.quality,
                                    magnet=best.magnet, url=best.magnet,
                                    sizes=(_human_size(best.bytes), ""))
            await torrent_manager.add_torrent(dl_movie, dl_torrent)
```

(If `execute_schedule` builds a results summary, count the items for which `best` was found. Keep the existing `ScheduleLog` writes.)

- [ ] **Step 2: Verify the module imports cleanly**

Run: `docker compose exec -T backend python -c "import app.cron.jobs; print('cron jobs import OK')"`
Expected: `cron jobs import OK` (no reference to `app.scrapers`).

- [ ] **Step 3: Commit**

```bash
git add backend/app/cron/jobs.py
git commit -q -m "refactor(cron): scheduled downloads via the new catalog API"
```

---

## Task 11: Remove the dead scraper

**Files:**
- Delete: `backend/app/scrapers/` (entire package: `yts.py`, `rarbg/*`, `__init__.py`)

- [ ] **Step 1: Confirm nothing still imports the scraper**

Run: `git grep -n "app.scrapers\|scrapers.yts\|browse_yts\|get_movie_by_url\|search_movie" -- backend/app || echo "no scraper references"`
Expected: `no scraper references`. If any remain (e.g., a stale import in `api/torrents.py` or `__init__.py`), fix them first (the functions are gone; remove the import).

- [ ] **Step 2: Delete the package**

```bash
git rm -r -q backend/app/scrapers
```

- [ ] **Step 3: Verify the app imports + starts**

Run: `docker compose exec -T backend python -c "import app.main; print('app import OK')"`
Expected: `app import OK`. Then `curl -s http://localhost:8000/health` → healthy.

- [ ] **Step 4: Commit**

```bash
git commit -q -m "chore: remove decommissioned YTS/RARBG scraper"
```

---

## Task 12: Backend end-to-end verification

**Files:** none (verification; commit only if a fix is needed).

- [ ] **Step 1: Recreate the backend container (fresh image with the new code + new table)**

```bash
docker compose up -d --build backend
sleep 5 && curl -sf http://localhost:8000/health && echo " OK"
```
Expected: healthy. The new `catalog_items` table is created by `init_db()` on startup.

- [ ] **Step 2: Run the full new unit suite in-container**

```bash
docker compose run --rm backend python -m pytest tests/test_quality.py tests/test_schemas.py \
  tests/test_catalog_normalize.py tests/test_tmdb_normalize.py tests/test_torrents_select.py -v
```
Expected: all pass.

- [ ] **Step 3: Exercise the real flow (browse → detail → download)**

```bash
echo "--- browse ---"; curl -s "http://localhost:8000/api/v1/movies?api=popular" | python3 -c "import sys,json;d=json.load(sys.stdin);print(d['results'][0]['tmdb_id'], d['results'][0]['title'])"
echo "--- detail (Your Name 372058) ---"; curl -s "http://localhost:8000/api/v1/movies/372058" | python3 -c "import sys,json;d=json.load(sys.stdin);print('runtime',d.get('runtime'),'| qualities',d.get('available_qualities'),'| cast',len(d.get('cast',[])))"
echo "--- download 1080p ---"; curl -s -X POST http://localhost:8000/api/v1/torrents/download -H 'Content-Type: application/json' -d '{"tmdb_id":372058,"quality":"1080p"}' | python3 -c "import sys,json;d=json.load(sys.stdin);print('state',d.get('state'),'| title',d.get('movie_title'))"
```
Expected: browse prints an id+title; detail prints a runtime, a non-empty `available_qualities` (e.g. `['2160p','1080p','720p']`), and (if `TMDB_API_KEY` is set) a non-zero cast count; download returns a queued `TorrentStatus`. If `TMDB_API_KEY` is unset, detail degrades (runtime null, cast 0) but still 200 with `available_qualities` populated — note this in the report.

- [ ] **Step 4: Report** exactly what passed and whether `TMDB_API_KEY` was set (cast/runtime depend on it).

---

## Task 13: Frontend types (`types/index.ts`)

**Files:**
- Modify: `frontend/src/types/index.ts`

- [ ] **Step 1: Add the new movie types** (keep existing `TorrentStatus`, `TorrentState`, schedule, streaming, UI types). Replace the `Torrent`/`Movie`/`DetailedMovie` interfaces and `TorrentRequest` with:

```typescript
// --- Catalog (new API) ---
export interface CatalogItem {
  tmdb_id: number;
  media_type: 'movie';
  title: string;
  year: number | null;
  overview: string | null;
  poster_url: string | null;
  backdrop_url: string | null;
  genre_ids: number[];
  genres: string[];
  vote_average: number;
  vote_count: number;
  popularity: number;
  original_language: string | null;
}

export interface CastMember {
  name: string;
  character: string | null;
  image: string | null;
}

export interface MovieDetail extends CatalogItem {
  runtime: number | null;
  imdb_id: string | null;
  tagline: string | null;
  cast: CastMember[];
  director: string | null;
  available_qualities: string[];
}

export interface TorrentHit {
  title: string;
  seeds: number;
  peers: number;
  bytes: number;
  magnet: string;
  hash: string;
  source: string | null;
  quality: string | null;
}

export interface CatalogPage {
  page: number;
  results: CatalogItem[];
  total_pages: number;
  total_results: number;
}

export interface TorrentRequest {
  tmdb_id: number;
  quality: '720p' | '1080p' | '2160p';
  save_path?: string;
}

// Browse controls
export const GENRE_OPTIONS: { value: number; label: string }[] = [
  { value: 0, label: 'All Genres' }, { value: 10759, label: 'Action & Adventure' },
  { value: 16, label: 'Animation' }, { value: 35, label: 'Comedy' },
  { value: 80, label: 'Crime' }, { value: 99, label: 'Documentary' },
  { value: 18, label: 'Drama' }, { value: 10751, label: 'Family' },
  { value: 9648, label: 'Mystery' }, { value: 10765, label: 'Sci-Fi & Fantasy' },
  { value: 10768, label: 'War & Politics' }, { value: 37, label: 'Western' },
];
export const SORT_OPTIONS: { value: string; label: string }[] = [
  { value: 'popularity.desc', label: 'Popular' },
  { value: 'vote_average.desc', label: 'Top Rated' },
  { value: 'primary_release_date.desc', label: 'Newest' },
  { value: 'revenue.desc', label: 'Highest Grossing' },
];
export const YEAR_OPTIONS: number[] = [0, ...Array.from({ length: 2026 - 2010 + 1 }, (_, i) => 2026 - i)];
```

Keep the old `Movie`/`Torrent`/`DetailedMovie`/`SearchParams` exports **only if** other not-yet-migrated components still import them; otherwise remove them. (Tasks 16–18 migrate those components; remove the dead types once those compile.)

- [ ] **Step 2: Commit**

```bash
git add frontend/src/types/index.ts
git commit -q -m "feat(frontend): catalog/movie-detail types for the new API"
```

---

## Task 14: Frontend movie service (`services/movies.ts`)

**Files:**
- Replace: `frontend/src/services/movies.ts`

- [ ] **Step 1: Replace `frontend/src/services/movies.ts` with:**

```typescript
import apiClient from './api-client';
import { CatalogPage, CatalogItem, MovieDetail, TorrentHit } from '@/types';

export const moviesService = {
  browse: async (params: { api?: string; sort?: string; genre?: number; year?: number; page?: number }): Promise<CatalogPage> => {
    const response = await apiClient.get('/movies', { params });
    return response.data;
  },

  search: async (q: string, page = 1): Promise<CatalogPage> => {
    const response = await apiClient.get('/movies/search', { params: { q, page } });
    return response.data;
  },

  getDetail: async (tmdbId: number): Promise<MovieDetail> => {
    const response = await apiClient.get(`/movies/${tmdbId}`);
    return response.data;
  },

  getTorrents: async (tmdbId: number): Promise<TorrentHit[]> => {
    const response = await apiClient.get(`/movies/${tmdbId}/torrents`);
    return response.data;
  },
};
```

(Import line must read exactly `import { CatalogPage, CatalogItem, MovieDetail, TorrentHit } from '@/types';`.)

- [ ] **Step 2: Commit**

```bash
git add frontend/src/services/movies.ts
git commit -q -m "feat(frontend): movie service against the new tmdb-id endpoints"
```

---

## Task 15: Allow TMDB images (`next.config.ts`)

**Files:**
- Modify: `frontend/next.config.ts` (add `image.tmdb.org` to `images.remotePatterns`)

- [ ] **Step 1: Add the remote pattern**

In the `images.remotePatterns` array in `frontend/next.config.ts`, add:
```typescript
      { protocol: 'https', hostname: 'image.tmdb.org', pathname: '/**' },
```

- [ ] **Step 2: Commit**

```bash
git add frontend/next.config.ts
git commit -q -m "chore(frontend): allow image.tmdb.org posters/backdrops"
```

---

## Task 16: Browse / search filter UI

**Files:**
- Modify: `frontend/src/components/search/SearchPageContent.tsx` (and any browse filter controls it owns)

Read the component first. It currently builds `SearchParams` (keyword/quality/genre/rating/year/order_by) and calls `moviesService.browseMovies`/`searchMovies`. Migrate it to the new controls.

**Field/Call mapping (apply throughout):**
| Old | New |
|---|---|
| `moviesService.browseMovies(SearchParams)` | `moviesService.browse({ api, sort, genre, year, page })` |
| `moviesService.searchMovies(title)` | `moviesService.search(q, page)` |
| genre dropdown (string names) | `GENRE_OPTIONS` (number values) → `genre` |
| order_by dropdown | `SORT_OPTIONS` → `sort` |
| year dropdown (ranges) | `YEAR_OPTIONS` (0 + 2010–2026) → `year` |
| quality / rating filters | **removed** (quality is chosen at download) |
| response `Movie[]` | `CatalogPage.results` (`CatalogItem[]`); use `total_pages` for paging |
| card fields (`movie.img`,`movie.genre`,`movie.rating`) | `item.poster_url`, `item.genres.join(', ')`, `item.vote_average.toFixed(1)` |
| link to detail (`movie.link`/id) | `/movies/${item.tmdb_id}` |

- [ ] **Step 1:** Update the component's state, filter controls (`GENRE_OPTIONS`/`SORT_OPTIONS`/`YEAR_OPTIONS` from `@/types`), the service calls, and the results mapping per the table above. Remove quality/rating filter UI.
- [ ] **Step 2:** Verify it compiles: `docker compose exec -T frontend npx tsc --noEmit` (expect no errors in this file). Fix type errors.
- [ ] **Step 3: Commit**
```bash
git add frontend/src/components/search/SearchPageContent.tsx
git commit -q -m "feat(frontend): browse/search filters for the new catalog API"
```

---

## Task 17: Home + movie card/carousel

**Files:**
- Modify: `frontend/src/components/movies/MovieCard.tsx`, `frontend/src/components/movies/MovieCarousel.tsx`, `frontend/src/components/movies/FeatureCarousel.tsx`, `frontend/src/components/home/HomePageContent.tsx` (and any list that fed them `Movie[]`)

Read each. Apply the same **CatalogItem** mapping: `img`→`poster_url`/`backdrop_url`, `genre`(string)→`genres`(string[]), `rating`(string)→`vote_average`(number, format `.toFixed(1)`), `year` may be null (guard), detail link → `/movies/${item.tmdb_id}`. Home data sources switch to `moviesService.browse({ api: 'popular' })` and `moviesService.browse({ api: 'top_rated' })` (use `.results`).

- [ ] **Step 1:** Migrate each component/prop type from `Movie` to `CatalogItem` per the mapping; update Home's data fetching to `moviesService.browse({...})`.
- [ ] **Step 2:** Verify: `docker compose exec -T frontend npx tsc --noEmit` (no errors in these files).
- [ ] **Step 3: Commit**
```bash
git add frontend/src/components/movies/MovieCard.tsx frontend/src/components/movies/MovieCarousel.tsx frontend/src/components/movies/FeatureCarousel.tsx frontend/src/components/home/HomePageContent.tsx
git commit -q -m "feat(frontend): home + cards/carousels on CatalogItem"
```

---

## Task 18: Movie detail page + download

**Files:**
- Modify: `frontend/src/app/movies/[id]/page.tsx`, `frontend/src/components/movies/MovieDetailsContent.tsx`, and the torrents/download service that posts the download.

Read each. The route param `id` is now the **TMDB numeric id**.

**Mapping:**
| Old | New |
|---|---|
| `moviesService.getMovieDetails(movieId: string)` | `moviesService.getDetail(Number(id))` → `MovieDetail` |
| `detail.media.poster` / `img` | `detail.poster_url` |
| `detail.media.backdrop` | `detail.backdrop_url` |
| `detail.plot`/`description` | `detail.overview` |
| `detail.ratings.imdb` | `detail.vote_average.toFixed(1)` (single rating) |
| `detail.credits.cast` / `credits.director` | `detail.cast` / `detail.director` |
| `detail.runtime` (string) | `detail.runtime` (number, minutes → `${n}m`) |
| `detail.genre` (string) | `detail.genres` (string[]) |
| quality buttons from `detail.torrents[].quality` | `detail.available_qualities` |
| download body `{ movie_id, quality }` | `{ tmdb_id: detail.tmdb_id, quality }` to `POST /torrents/download` |
| reviews / related_movies / RT / Metacritic sections | **remove** (not provided) |

- [ ] **Step 1:** Update the page to parse `Number(id)`, call `getDetail`, and pass `MovieDetail`. Update `MovieDetailsContent` to render the new fields, build quality buttons from `available_qualities`, and POST `{ tmdb_id, quality }` to `/torrents/download`. Remove the reviews/related/RT/Metacritic UI.
- [ ] **Step 2:** Verify: `docker compose exec -T frontend npx tsc --noEmit` (no errors). Remove any now-dead `Movie`/`DetailedMovie` type exports from `types/index.ts` if nothing imports them.
- [ ] **Step 3: Commit**
```bash
git add frontend/src/app/movies/'[id]'/page.tsx frontend/src/components/movies/MovieDetailsContent.tsx
git commit -q -m "feat(frontend): movie detail + download by tmdb id"
```

---

## Task 19: Frontend end-to-end verification

**Files:** none (verification).

- [ ] **Step 1: Rebuild the frontend image and restart**

```bash
docker compose up -d --build frontend
```

- [ ] **Step 2: Full type check**

```bash
docker compose exec -T frontend npx tsc --noEmit
```
Expected: no type errors. Fix any stragglers (often leftover imports of removed `Movie`/`DetailedMovie` types).

- [ ] **Step 3: Manual browser check** (`http://localhost:3001`)

Use the Playwright MCP or a browser: home shows popular/top-rated posters; clicking a movie opens `/movies/<tmdb_id>` with poster/backdrop/overview/rating/genres (and cast/runtime if `TMDB_API_KEY` set); the quality buttons reflect `available_qualities`; clicking a quality starts a download that appears on the downloads page. Report what rendered and any gaps.

- [ ] **Step 4:** Report final status (what works end-to-end; whether TMDB enrichment was active).

---

## Self-review notes (author)

- **Spec coverage:** providers (T1,T3,T4), schemas (T2), selector (T5), cache (T6), service (T7), endpoints (T8), download (T9), cron keep-alive (T10), scraper removal (T11), backend verify (T12); frontend types/service/images/filters/cards/detail (T13–T18), frontend verify (T19). All spec sections map to tasks.
- **Identity/type consistency:** `tmdb_id:int` everywhere (schemas, endpoints `Path(int)`, `TorrentRequest`, frontend `number`); `available_qualities` produced in T7/T9 and consumed in T18; `_DlMovie`/`_DlTorrent`/`_human_size` defined in T9 and reused in T10; `CatalogItemCache.get(db, media_type, tmdb_id)` signature consistent across T6/T7.
- **Reused unchanged:** `torrent_manager.add_torrent` (fed duck-typed `_DlMovie`/`_DlTorrent` with exactly the attributes it reads: `title/year/genre` and `id/quality/magnet/url/sizes`).
- **Routing:** movie browse is the slashless `""` route; `/search` precedes `/{tmdb_id}` so the int route doesn't shadow it.
- **Known degradation:** without `TMDB_API_KEY`, movie detail falls back to the cached `CatalogItem` (no cast/runtime) — endpoints still 200; flagged in T12/T19.
