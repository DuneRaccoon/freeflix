# yts.lu Discover Params + Personalised Rails — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every catalog filter dimension (genre, streaming provider/network, country origin, studio, collection, best-of-year) actually filter, end-to-end, and drive dynamic, lightly-personalised carousel lineups via a backend rail planner.

**Architecture:** The yts.lu API has two request shapes — *feed* (`api=popular|…`) and *discover* (`api=discover` + named filters). `providers/catalog.py::browse` is rewritten to emit the discover shape whenever any filter is present, using the correct param names (`genres` plural, `provider`↔`network` by mode, `origin`, `company`, `id`, `lang`). A new `services/rails.py` planner returns ordered rail specs from per-profile taste + a daily seed; the frontend renders them.

**Tech Stack:** FastAPI, SQLAlchemy 1.4, httpx, pytest (backend); Next.js 15 / React 19 / TypeScript, vitest + RTL (frontend); Docker Compose.

## Global Constraints

- **SQLAlchemy 1.4** query/session style (not 2.0). Sessions via `with get_db() as db:`.
- **No Alembic** — no schema changes in this plan (rails read existing tables).
- **Python 3.10**, Poetry. **Commits:** Conventional Commits (`fix:`, `feat:`, `refactor:`).
- **Backend tests are baked into the image, not bind-mounted.** Run a new/edited test file with an explicit mount:
  `docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest tests/<file> -v`
  (container workdir `/opt/freeflix`; app at `/opt/freeflix/app`, tests at `/opt/freeflix/tests`). `backend/app` IS bind-mounted, so app edits are live.
- **Frontend tests:** `docker compose run --rm frontend npx vitest run <path>` (or `make sh s=frontend` then `npx vitest run <path>`). Typecheck: `docker compose run --rm frontend npx tsc --noEmit`.
- **Canonical id maps** live in `docs/superpowers/specs/2026-06-22-yts-discover-params-design.md` — copy ids exactly.
- **content_id format** (unchanged): `movie:{tmdb_id}` / `tv:{tmdb_id}:s{n}:e{m}`.

---

### Task 1: `catalog.browse` dual-shape request builder

**Files:**
- Modify: `backend/app/providers/catalog.py` (replace `browse`, lines 87-100; add `_merge_genre` helper above it)
- Test: `backend/tests/test_catalog_browse_params.py` (create)

**Interfaces:**
- Produces: `async def browse(api="popular", sort="popularity.desc", page=1, mode="movie", *, genres=None, year=0, provider=None, origin=None, company=None, collection=None, lang=None) -> CatalogPage` and `_merge_genre(existing: Optional[str], genre_id: int) -> str`.
- Consumes: existing module-level `async def _get(params) -> Optional[dict]` and `normalize_item`.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_catalog_browse_params.py`:

```python
"""catalog.browse must emit feed vs discover request shapes correctly."""
import asyncio
import app.providers.catalog as catalog


def _capture(monkeypatch):
    captured = {}

    async def fake_get(params):
        captured.clear()
        captured.update(params)
        return {"page": 1, "results": [], "total_pages": 0, "total_results": 0}

    monkeypatch.setattr(catalog, "_get", fake_get)
    return captured


def test_popular_stays_a_feed(monkeypatch):
    cap = _capture(monkeypatch)
    asyncio.run(catalog.browse(api="popular", mode="movie"))
    assert cap["api"] == "popular"
    assert "genres" not in cap and "genre" not in cap


def test_genre_forces_discover_plural(monkeypatch):
    cap = _capture(monkeypatch)
    asyncio.run(catalog.browse(api="popular", genres="28", mode="movie"))
    assert cap["api"] == "discover"
    assert cap["genres"] == "28"


def test_provider_movie_uses_provider(monkeypatch):
    cap = _capture(monkeypatch)
    asyncio.run(catalog.browse(provider="8", mode="movie"))
    assert cap["api"] == "discover" and cap["provider"] == "8" and "network" not in cap


def test_provider_tv_uses_network(monkeypatch):
    cap = _capture(monkeypatch)
    asyncio.run(catalog.browse(provider="8", mode="tv"))
    assert cap["network"] == "8" and "provider" not in cap


def test_anime_origin_is_genre16_plus_lang_ja(monkeypatch):
    cap = _capture(monkeypatch)
    asyncio.run(catalog.browse(origin="anime", mode="tv"))
    assert cap["api"] == "discover" and cap["genres"] == "16" and cap["lang"] == "ja"
    assert "origin" not in cap


def test_country_origin_passthrough(monkeypatch):
    cap = _capture(monkeypatch)
    asyncio.run(catalog.browse(origin="KR", mode="movie"))
    assert cap["origin"] == "KR"


def test_collection_maps_to_id(monkeypatch):
    cap = _capture(monkeypatch)
    asyncio.run(catalog.browse(collection="86311", mode="movie"))
    assert cap["id"] == "86311"


def test_year_forces_discover(monkeypatch):
    cap = _capture(monkeypatch)
    asyncio.run(catalog.browse(api="popular", year=2024, mode="movie"))
    assert cap["api"] == "discover" and cap["year"] == 2024


def test_multi_genre_and_company(monkeypatch):
    cap = _capture(monkeypatch)
    asyncio.run(catalog.browse(genres="28,12", company="420", mode="movie"))
    assert cap["genres"] == "28,12" and cap["company"] == "420"


def test_merge_genre_dedups():
    assert catalog._merge_genre("16", 16) == "16"
    assert catalog._merge_genre(None, 16) == "16"
    assert catalog._merge_genre("28", 16) == "28,16"
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest tests/test_catalog_browse_params.py -v`
Expected: FAIL — `AttributeError: module 'app.providers.catalog' has no attribute '_merge_genre'` / wrong param names.

- [ ] **Step 3: Implement the dual-shape builder**

In `backend/app/providers/catalog.py`, replace the existing `browse` function (lines 87-100) with:

```python
def _merge_genre(existing: Optional[str], genre_id: int) -> str:
    """Append genre_id to a comma-separated genres string, de-duplicated, order-preserving."""
    ids = [p for p in (existing or "").split(",") if p.strip()]
    gid = str(genre_id)
    if gid not in ids:
        ids.append(gid)
    return ",".join(ids)


async def browse(api: str = "popular", sort: str = "popularity.desc", page: int = 1,
                 mode: str = "movie", *, genres: Optional[str] = None, year: int = 0,
                 provider: Optional[str] = None, origin: Optional[str] = None,
                 company: Optional[str] = None, collection: Optional[str] = None,
                 lang: Optional[str] = None) -> CatalogPage:
    params: Dict[str, Any] = {"mode": mode, "page": page, "sort": sort}
    disc: Dict[str, Any] = {}
    eff_genres, eff_lang = genres, lang
    if origin == "anime":                       # anime = genres:16 + lang:ja, not an origin
        eff_genres = _merge_genre(eff_genres, 16)
        eff_lang = eff_lang or "ja"
    elif origin:
        disc["origin"] = origin
    if eff_genres:
        disc["genres"] = eff_genres
    if eff_lang:
        disc["lang"] = eff_lang
    if provider:
        disc["network" if mode == "tv" else "provider"] = provider
    if company:
        disc["company"] = company
    if collection:
        disc["id"] = collection
    if year:
        disc["year"] = year
    if disc:
        params.update({"api": "discover", "genre": 0, "year": 0})  # mirror proven discover URL shape
        params.update(disc)                                        # real values win over placeholders
    else:
        params["api"] = api
    data = await _get(params) or {}
    return CatalogPage(
        page=data.get("page", page),
        results=[normalize_item(r, media_type=mode) for r in data.get("results", []) if r.get("id")],
        total_pages=data.get("total_pages", 0),
        total_results=data.get("total_results", 0),
    )
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest tests/test_catalog_browse_params.py -v`
Expected: PASS (10 passed).

- [ ] **Step 5: Commit**

```bash
git add backend/app/providers/catalog.py backend/tests/test_catalog_browse_params.py
git commit -m "fix(catalog): emit discover request shape for filtered browse"
```

---

### Task 2: Routers + services thread discover params (with legacy `genre` alias)

**Files:**
- Modify: `backend/app/services/movies.py:29-32` (`browse`), `backend/app/services/tv.py:27-30` (`browse`)
- Modify: `backend/app/api/movies.py:10-18` (`browse_movies`), `backend/app/api/tv.py:10-18` (`browse_tv`)
- Test: `backend/tests/test_browse_params_api.py` (create)

**Interfaces:**
- Consumes: `catalog.browse(...)` from Task 1.
- Produces: `movie_service.browse(api, sort, page, *, genres=None, year=0, provider=None, origin=None, company=None, collection=None, lang=None) -> CatalogPage`; `tv_service.browse(api, sort, page, *, genres=None, year=0, provider=None, origin=None, lang=None) -> CatalogPage`. Routers accept query params `api, sort, genre, genres, year, provider, origin, lang, page` (+ `company, collection` on movies).

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_browse_params_api.py`:

```python
"""Movie/TV browse routers must forward discover params and fold the legacy `genre` alias."""
import os
os.environ.setdefault("DB_PATH", "/tmp/test_browse_params_api.db")

import pytest
from fastapi.testclient import TestClient

import app.providers.catalog as catalog
from app.models import CatalogPage
from app.main import app


@pytest.fixture()
def client(monkeypatch):
    captured = {}

    async def fake_browse(**kwargs):
        captured.clear()
        captured.update(kwargs)
        return CatalogPage(page=1, results=[], total_pages=0, total_results=0)

    monkeypatch.setattr(catalog, "browse", fake_browse)
    with TestClient(app) as c:
        c.captured = captured
        yield c


def test_movie_genre_alias_folds_to_genres(client):
    r = client.get("/api/v1/movies?genre=28")
    assert r.status_code == 200
    assert client.captured["genres"] == "28"


def test_movie_explicit_genres_wins_over_alias(client):
    r = client.get("/api/v1/movies?genre=28&genres=35")
    assert r.status_code == 200
    assert client.captured["genres"] == "35"


def test_movie_forwards_company_and_collection(client):
    r = client.get("/api/v1/movies?company=420&collection=86311")
    assert r.status_code == 200
    assert client.captured["company"] == "420"
    assert client.captured["collection"] == "86311"


def test_movie_best_year_feed_allowed(client):
    r = client.get("/api/v1/movies?api=best_2025")
    assert r.status_code == 200
    assert client.captured["api"] == "best_2025"


def test_tv_forwards_provider_and_origin(client):
    r = client.get("/api/v1/tv?provider=8&origin=KR")
    assert r.status_code == 200
    assert client.captured["provider"] == "8"
    assert client.captured["origin"] == "KR"
    assert client.captured["mode"] == "tv"


def test_movie_invalid_api_rejected(client):
    r = client.get("/api/v1/movies?api=bogus")
    assert r.status_code == 422
```

> Note: `tv_service.browse` calls `catalog.browse(..., mode="tv")`, so `captured["mode"] == "tv"` confirms the TV path.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest tests/test_browse_params_api.py -v`
Expected: FAIL — `genres` KeyError / `company` not forwarded / `best_2025` rejected as 422.

- [ ] **Step 3: Update the movie service**

In `backend/app/services/movies.py`, replace `browse` (lines 29-32):

```python
async def browse(api: str, sort: str, page: int, *, genres=None, year=0, provider=None,
                 origin=None, company=None, collection=None, lang=None) -> CatalogPage:
    result = await catalog.browse(
        api=api, sort=sort, page=page, mode="movie", genres=genres, year=year,
        provider=provider, origin=origin, company=company, collection=collection, lang=lang,
    )
    _cache_page(result)
    return result
```

- [ ] **Step 4: Update the TV service**

In `backend/app/services/tv.py`, replace `browse` (lines 27-30):

```python
async def browse(api: str, sort: str, page: int, *, genres=None, year=0, provider=None,
                 origin=None, lang=None) -> CatalogPage:
    result = await catalog.browse(
        api=api, sort=sort, page=page, mode="tv", genres=genres, year=year,
        provider=provider, origin=origin, lang=lang,
    )
    _cache_page(result)
    return result
```

- [ ] **Step 5: Update the movie router**

Replace `backend/app/api/movies.py` lines 1-18 with:

```python
from fastapi import APIRouter, HTTPException, Query, Path
from typing import List, Optional

from app.models import CatalogPage, MovieDetail, TorrentHit
from app.services import movies as movie_service

router = APIRouter()

_API_PATTERN = r"^(popular|top_rated|now_playing|upcoming|discover|best_(2020|2021|2022|2023|2024|2025))$"


@router.get("", response_model=CatalogPage, summary="Browse movies")
async def browse_movies(
    api: str = Query("popular", pattern=_API_PATTERN),
    sort: str = Query("popularity.desc"),
    genre: int = Query(0, ge=0),              # legacy alias -> genres
    genres: Optional[str] = Query(None),
    year: int = Query(0, ge=0),
    provider: Optional[str] = Query(None),
    origin: Optional[str] = Query(None),
    company: Optional[str] = Query(None),
    collection: Optional[str] = Query(None),
    lang: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
):
    if not genres and genre:
        genres = str(genre)
    return await movie_service.browse(
        api=api, sort=sort, page=page, genres=genres, year=year,
        provider=provider, origin=origin, company=company, collection=collection, lang=lang,
    )
```

- [ ] **Step 6: Update the TV router**

Replace `backend/app/api/tv.py` lines 1-18 with:

```python
from fastapi import APIRouter, HTTPException, Query, Path
from typing import List, Optional

from app.models import CatalogPage, ShowDetail, SeasonDetail, TorrentHit
from app.services import tv as tv_service

router = APIRouter()

_API_PATTERN = r"^(popular|top_rated|on_the_air|airing_today|discover|best_(2020|2021|2022|2023|2024|2025))$"


@router.get("", response_model=CatalogPage, summary="Browse TV shows")
async def browse_tv(
    api: str = Query("popular", pattern=_API_PATTERN),
    sort: str = Query("popularity.desc"),
    genre: int = Query(0, ge=0),              # legacy alias -> genres
    genres: Optional[str] = Query(None),
    year: int = Query(0, ge=0),
    provider: Optional[str] = Query(None),
    origin: Optional[str] = Query(None),
    lang: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
):
    if not genres and genre:
        genres = str(genre)
    return await tv_service.browse(
        api=api, sort=sort, page=page, genres=genres, year=year,
        provider=provider, origin=origin, lang=lang,
    )
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest tests/test_browse_params_api.py -v`
Expected: PASS (6 passed).

- [ ] **Step 8: Commit**

```bash
git add backend/app/api/movies.py backend/app/api/tv.py backend/app/services/movies.py backend/app/services/tv.py backend/tests/test_browse_params_api.py
git commit -m "feat(catalog): expose discover params on browse routers"
```

---

### Task 3: Fix scheduled-download genre filtering

**Files:**
- Modify: `backend/app/cron/jobs.py:36-47` (`_find_movies_for_schedule`)
- Test: `backend/tests/test_schedule_genre_filter.py` (create)

**Interfaces:**
- Consumes: `catalog.browse(...)` from Task 1.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_schedule_genre_filter.py`:

```python
"""Scheduled discovery must filter by genre via the discover param, not the dead `genre` kwarg."""
import asyncio
import types

import app.cron.jobs as jobs


def test_schedule_genre_passes_genres(monkeypatch):
    captured = {}

    async def fake_browse(**kwargs):
        captured.update(kwargs)
        return types.SimpleNamespace(results=[])

    monkeypatch.setattr(jobs.catalog, "browse", fake_browse)
    sp = types.SimpleNamespace(keyword=None, genre="action", year="all",
                               order_by="featured", page=1)
    asyncio.run(jobs._find_movies_for_schedule(sp))
    assert captured.get("genres") == "28"
    assert "genre" not in captured
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest tests/test_schedule_genre_filter.py -v`
Expected: FAIL — `captured.get("genres")` is `None` (code still passes `genre=`).

- [ ] **Step 3: Update the scheduler discovery call**

In `backend/app/cron/jobs.py`, replace the `else` branch body of `_find_movies_for_schedule` (lines 40-46) with:

```python
    else:
        genre = _GENRE_NAME_TO_ID.get((search_params.genre or "all").lower(), 0)
        year_raw = (search_params.year or "all")
        year = int(year_raw) if str(year_raw).isdigit() else 0
        sort = _ORDER_TO_SORT.get(search_params.order_by or "featured", "popularity.desc")
        page = await catalog.browse(api="popular", sort=sort,
                                    genres=str(genre) if genre else None,
                                    year=year, page=search_params.page or 1)
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest tests/test_schedule_genre_filter.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/cron/jobs.py backend/tests/test_schedule_genre_filter.py
git commit -m "fix(cron): scheduled genre filtering uses discover genres param"
```

---

### Task 4: Rail planner models + `services/rails.py`

**Files:**
- Modify: `backend/app/models.py` (add `RailSpec`, `RailsResponse` near `CatalogPage`, after line 188)
- Create: `backend/app/services/rails.py`
- Test: `backend/tests/test_rails_planner.py` (create)

**Interfaces:**
- Produces: `RailSpec(key:str, title:str, eyebrow:Optional[str]=None, variant:Literal['poster','ranked']='poster', params:Dict[str,Any]={}, see_all_href:Optional[str]=None)`; `RailsResponse(rails:List[RailSpec]=[])`; `plan_rails(user_id: Optional[str], mode: str='movie', limit: int=10, surface: str='') -> List[RailSpec]`; `affinity(user_id: str, mode: str) -> Dict[str, Counter]`.
- Consumes: `UserStreamingProgress.get_recent_for_user`, `UserWatchlist.get_for_user`, `CatalogItemCache.get_one`, `get_db`.

- [ ] **Step 1: Add the response models**

In `backend/app/models.py`, after the `CatalogPage` class (line 188), add:

```python
class RailSpec(BaseModel):
    key: str
    title: str
    eyebrow: Optional[str] = None
    variant: Literal['poster', 'ranked'] = 'poster'
    params: Dict[str, Any] = {}
    see_all_href: Optional[str] = None


class RailsResponse(BaseModel):
    rails: List[RailSpec] = []
```

- [ ] **Step 2: Write the failing tests**

Create `backend/tests/test_rails_planner.py`:

```python
"""Rail planner: deterministic seed, taste rails, cold-start, mode gating."""
from collections import Counter

import app.services.rails as rails


def test_cold_start_has_no_for_you_rails():
    plan = rails.plan_rails(user_id=None, mode="movie", limit=10)
    assert len(plan) == 10
    assert all(r.eyebrow != "For you" for r in plan)
    # Evergreen leads first.
    assert plan[0].params.get("api") == "popular"
    assert plan[1].variant == "ranked"


def test_seed_is_deterministic_within_day():
    a = rails.plan_rails(user_id=None, mode="movie", limit=10)
    b = rails.plan_rails(user_id=None, mode="movie", limit=10)
    assert [r.key for r in a] == [r.key for r in b]


def test_surface_changes_lineup():
    home = rails.plan_rails(user_id=None, mode="movie", limit=10, surface="home")
    movies = rails.plan_rails(user_id=None, mode="movie", limit=10, surface="movies")
    # Leads are identical; the seeded tail differs.
    assert [r.key for r in home] != [r.key for r in movies]


def test_taste_genre_and_origin_rails(monkeypatch):
    monkeypatch.setattr(rails, "affinity",
                        lambda uid, mode: {"genres": Counter({28: 5, 35: 2}),
                                           "origins": Counter({"KR": 4})})
    plan = rails.plan_rails(user_id="u1", mode="movie", limit=12)
    titles = [r.title for r in plan]
    assert "Because you watch Action" in titles
    assert "Korean Movies" in titles
    assert any(r.eyebrow == "For you" for r in plan)


def test_anime_taste_when_japanese_and_animation(monkeypatch):
    monkeypatch.setattr(rails, "affinity",
                        lambda uid, mode: {"genres": Counter({16: 6}),
                                           "origins": Counter({"JP": 5})})
    plan = rails.plan_rails(user_id="u1", mode="movie", limit=12)
    assert any(r.params.get("origin") == "anime" for r in plan)


def test_tv_mode_has_no_company_or_collection_rails():
    plan = rails.plan_rails(user_id=None, mode="tv", limit=20)
    assert all("company" not in r.params and "collection" not in r.params for r in plan)


def test_parse_content_id():
    assert rails._parse_content_id("movie:123") == ("movie", 123)
    assert rails._parse_content_id("tv:456:s1:e2") == ("tv", 456)
    assert rails._parse_content_id("garbage") == (None, None)


def test_lang_to_origin_mapping():
    assert rails._LANG_TO_ORIGIN["ko"] == "KR"
    assert rails._LANG_TO_ORIGIN["ja"] == "JP"
    assert rails._LANG_TO_ORIGIN["hi"] == "IN"
    assert "en" not in rails._LANG_TO_ORIGIN
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest tests/test_rails_planner.py -v`
Expected: FAIL — `ModuleNotFoundError: app.services.rails`.

- [ ] **Step 4: Implement the planner**

Create `backend/app/services/rails.py`:

```python
"""Personalised, rotating carousel ('rail') planner for browse pages.

Returns ordered RailSpec (title + browse params); the frontend fetches each
rail's items via the existing browse endpoint. Taste is a genre/origin affinity
tally over the profile's recent progress + watchlist, joined to CatalogItemCache.
Remaining rails are filled from a candidate pool by a daily per-profile seed so
lineups rotate (and differ per surface).
"""
import datetime
import hashlib
from collections import Counter
from typing import List, Optional, Dict, Any

from app.models import RailSpec
from app.database.session import get_db
from app.database.models.catalog import CatalogItemCache
from app.database.models.streaming import UserStreamingProgress
from app.database.models.watchlist import UserWatchlist

_GENRE_LABELS = {
    28: "Action", 12: "Adventure", 16: "Animation", 35: "Comedy", 80: "Crime",
    99: "Documentary", 18: "Drama", 10751: "Family", 14: "Fantasy", 36: "History",
    27: "Horror", 10402: "Music", 9648: "Mystery", 10749: "Romance", 878: "Sci-Fi",
    53: "Thriller", 10752: "War", 37: "Western",
}
_LANG_TO_ORIGIN = {
    "ko": "KR", "ja": "JP", "hi": "IN", "ta": "IN", "te": "IN", "ml": "IN",
    "kn": "IN", "bn": "IN", "pa": "IN", "fr": "FR", "es": "ES", "it": "IT", "zh": "CN",
}
_ORIGIN_LABELS = {
    "KR": "Korean", "JP": "Japanese", "IN": "Indian", "GB": "British",
    "FR": "French", "ES": "Spanish", "IT": "Italian", "CN": "Chinese",
}
_PROVIDER_POOL = [
    ("8", "Netflix"), ("9", "Prime Video"), ("337", "Disney+"), ("1899", "Max"),
    ("15", "Hulu"), ("350", "Apple TV+"), ("531", "Paramount+"), ("386", "Peacock"),
]
_COMPANY_POOL = [
    ("420", "Marvel Studios"), ("3", "Pixar"), ("521", "DreamWorks"), ("2", "Walt Disney"),
    ("174", "Warner Bros"), ("33", "Universal"), ("41077", "A24"), ("10342", "Studio Ghibli"),
    ("923", "Legendary"), ("1632", "Lionsgate"), ("3172", "Blumhouse"),
]
_COLLECTION_POOL = [
    ("86311", "The Avengers"), ("1241", "Harry Potter"), ("10", "Star Wars"),
    ("645", "James Bond"), ("9485", "Fast & Furious"), ("404609", "John Wick"),
    ("87096", "Avatar"), ("328", "Jurassic Park"), ("131635", "The Hunger Games"),
]
_ORIGIN_POOL = ["KR", "JP", "IN", "GB", "FR", "ES", "IT", "CN"]
_BEST_POOL = ["2025", "2024", "2023", "2022", "2021", "2020"]


def _parse_content_id(cid: str):
    """movie:{id} | tv:{id}[:...] -> (media_type, tmdb_id) | (None, None)."""
    if not cid or ":" not in cid:
        return None, None
    parts = cid.split(":")
    mt = "tv" if parts[0] == "tv" else "movie" if parts[0] == "movie" else None
    try:
        return mt, int(parts[1])
    except (IndexError, ValueError):
        return None, None


def _seed(user_id: Optional[str], surface: str) -> int:
    key = f"{user_id or 'anon'}:{surface}:{datetime.date.today().isoformat()}"
    return int(hashlib.sha256(key.encode()).hexdigest(), 16)


def _rotate(items: list, seed: int) -> list:
    if not items:
        return []
    off = seed % len(items)
    return items[off:] + items[:off]


def _interleave(lists: List[list]) -> list:
    out, queues = [], [list(l) for l in lists if l]
    while any(queues):
        for q in queues:
            if q:
                out.append(q.pop(0))
    return out


def affinity(user_id: str, mode: str) -> Dict[str, Counter]:
    """Tally genre + origin affinity from the profile's progress + watchlist."""
    genres: Counter = Counter()
    origins: Counter = Counter()
    with get_db() as db:
        cids = [p.movie_id for p in UserStreamingProgress.get_recent_for_user(db, user_id, limit=40)]
        cids += [w.content_id for w in UserWatchlist.get_for_user(db, user_id, limit=60)]
        seen = set()
        for cid in cids:
            mt, tid = _parse_content_id(cid)
            if not tid or (mt, tid) in seen:
                continue
            seen.add((mt, tid))
            row = CatalogItemCache.get_one(db, mt or "movie", tid)
            if not row:
                continue
            for gid in (row.genre_ids or []):
                if gid in _GENRE_LABELS:
                    genres[gid] += 1
            code = _LANG_TO_ORIGIN.get((row.original_language or "").lower())
            if code:
                origins[code] += 1
    return {"genres": genres, "origins": origins}


def plan_rails(user_id: Optional[str], mode: str = "movie", limit: int = 10,
               surface: str = "") -> List[RailSpec]:
    is_tv = mode == "tv"
    noun = "Series" if is_tv else "Movies"
    href = "/tv" if is_tv else "/movies"
    seed = _seed(user_id, surface)

    rails: List[RailSpec] = [
        RailSpec(key="trending", title=f"Trending {noun}", params={"api": "popular"}, see_all_href=href),
        RailSpec(key="top-rated", title=f"Top Rated {noun}", eyebrow="Critically acclaimed",
                 variant="ranked", params={"api": "top_rated"}),
        RailSpec(key="new", title="New Releases",
                 params={"api": "popular", "sort": "primary_release_date.desc"}),
    ]
    used_genres = set()

    if user_id:
        aff = affinity(user_id, mode)
        for gid, _ in aff["genres"].most_common(2):
            used_genres.add(gid)
            rails.append(RailSpec(key=f"taste-genre-{gid}", eyebrow="For you",
                                  title=f"Because you watch {_GENRE_LABELS[gid]}",
                                  params={"genres": str(gid)}))
        top = aff["origins"].most_common(1)
        if top:
            code = top[0][0]
            if code == "JP" and aff["genres"].get(16):
                rails.append(RailSpec(key="taste-anime", title="Anime For You",
                                      eyebrow="For you", params={"origin": "anime"}))
            else:
                rails.append(RailSpec(key=f"taste-origin-{code}", eyebrow="For you",
                                      title=f"{_ORIGIN_LABELS[code]} {noun}",
                                      params={"origin": code}))

    # Candidate pool, per-category rotated then interleaved for variety.
    genre_rail = [RailSpec(key=f"genre-{g}", title=_GENRE_LABELS[g], eyebrow="Genre",
                           params={"genres": str(g)})
                  for g in _rotate([g for g in _GENRE_LABELS if g not in used_genres], seed)]
    provider_rail = [RailSpec(key=f"provider-{pid}", title=label, eyebrow="Streaming",
                              params={"provider": pid})
                     for pid, label in _rotate(_PROVIDER_POOL, seed)]
    origin_rail = [RailSpec(key=f"origin-{c}", title=f"{_ORIGIN_LABELS[c]} {noun}",
                            eyebrow="Around the world", params={"origin": c})
                   for c in _rotate(_ORIGIN_POOL, seed)]
    best_rail = [RailSpec(key=f"best-{y}", title=f"Best of {y}", eyebrow="Year in review",
                          params={"api": f"best_{y}"})
                 for y in _rotate(_BEST_POOL, seed)]
    categories = [genre_rail, provider_rail, origin_rail, best_rail]
    if not is_tv:
        categories.append([RailSpec(key=f"company-{cid}", title=label, eyebrow="Studio",
                                    params={"company": cid})
                           for cid, label in _rotate(_COMPANY_POOL, seed)])
        categories.append([RailSpec(key=f"collection-{col}", title=label, eyebrow="Saga",
                                    params={"collection": col})
                           for col, label in _rotate(_COLLECTION_POOL, seed)])

    for rail in _rotate(_interleave(categories), seed):
        if len(rails) >= limit:
            break
        rails.append(rail)
    return rails[:limit]
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest tests/test_rails_planner.py -v`
Expected: PASS (8 passed).

- [ ] **Step 6: Commit**

```bash
git add backend/app/models.py backend/app/services/rails.py backend/tests/test_rails_planner.py
git commit -m "feat(rails): personalised rotating rail planner service"
```

---

### Task 5: Rails router + registration

**Files:**
- Create: `backend/app/api/rails.py`
- Modify: `backend/app/main.py:14` (import) and `:108` (after the activity router include)
- Test: `backend/tests/test_rails_api.py` (create)

**Interfaces:**
- Consumes: `rails_service.plan_rails(...)`, `RailsResponse` (Task 4).
- Produces: `GET /api/v1/rails?mode=&user_id=&surface=&limit=` → `{ "rails": [...] }`.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_rails_api.py`:

```python
"""Rails endpoint returns an ordered list and validates mode."""
import os
os.environ.setdefault("DB_PATH", "/tmp/test_rails_api.db")

import pytest
from fastapi.testclient import TestClient
from app.main import app


@pytest.fixture()
def client():
    with TestClient(app) as c:
        yield c


def test_rails_cold_start_returns_rails(client):
    r = client.get("/api/v1/rails?mode=movie&limit=8")
    assert r.status_code == 200
    rails = r.json()["rails"]
    assert len(rails) == 8
    assert rails[0]["params"]["api"] == "popular"


def test_rails_rejects_bad_mode(client):
    r = client.get("/api/v1/rails?mode=podcast")
    assert r.status_code == 422


def test_rails_tv_mode(client):
    r = client.get("/api/v1/rails?mode=tv&limit=6")
    assert r.status_code == 200
    assert r.json()["rails"][0]["title"].endswith("Series")
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest tests/test_rails_api.py -v`
Expected: FAIL — 404 (route not registered).

- [ ] **Step 3: Create the router**

Create `backend/app/api/rails.py`:

```python
from fastapi import APIRouter, Query
from typing import Optional

from app.models import RailsResponse
from app.services import rails as rails_service

router = APIRouter()


@router.get("", response_model=RailsResponse, summary="Personalised browse rails")
async def get_rails(
    mode: str = Query("movie", pattern="^(movie|tv)$"),
    user_id: Optional[str] = Query(None),
    surface: str = Query(""),
    limit: int = Query(10, ge=1, le=20),
):
    return RailsResponse(rails=rails_service.plan_rails(
        user_id=user_id, mode=mode, limit=limit, surface=surface))
```

- [ ] **Step 4: Register the router in `main.py`**

In `backend/app/main.py` line 14, add `rails` to the import:

```python
from app.api import movies, torrents, schedules, streaming, users, tv, watchlist, activity, rails
```

After the activity `include_router` block (after line 108), add:

```python
app.include_router(
    rails.router,
    prefix=f"{settings.api_v1_str}/rails",
    tags=["Rails"],
)
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest tests/test_rails_api.py -v`
Expected: PASS (3 passed).

- [ ] **Step 6: Run the full backend suite (regression guard)**

Run: `docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest -q`
Expected: PASS (all green; the pre-existing suite plus the four new files).

- [ ] **Step 7: Commit**

```bash
git add backend/app/api/rails.py backend/app/main.py backend/tests/test_rails_api.py
git commit -m "feat(rails): expose GET /api/v1/rails endpoint"
```

---

### Task 6: Frontend option constants, service params, rails client

**Files:**
- Modify: `frontend/src/types/index.ts` (replace `GENRE_OPTIONS` at 251-258; add new option consts + `BrowseParams` type after 265)
- Modify: `frontend/src/services/movies.ts:6`, `frontend/src/services/tv.ts:5` (widen `browse` param type)
- Create: `frontend/src/services/rails.ts`
- Test: `frontend/src/types/options.test.ts` (create)

**Interfaces:**
- Produces: `GENRE_OPTIONS, PROVIDER_OPTIONS, ORIGIN_OPTIONS, COMPANY_OPTIONS, COLLECTION_OPTIONS, BEST_OF_OPTIONS` (each `{value, label}[]`, value `number|string`); `BrowseParams`; `railsService.getRails(mode, userId?, surface?, limit?) => Promise<RailSpec[]>`; `RailSpec` interface.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/types/options.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { GENRE_OPTIONS, PROVIDER_OPTIONS, ORIGIN_OPTIONS, COMPANY_OPTIONS, COLLECTION_OPTIONS } from './index';

describe('catalog option constants', () => {
  it('GENRE_OPTIONS uses canonical movie ids, not TV-only ids', () => {
    const values = GENRE_OPTIONS.map((o) => o.value);
    expect(values).toContain(28);   // Action
    expect(values).toContain(878);  // Sci-Fi
    expect(values).toContain(37);   // Western
    expect(values).not.toContain(10759); // TV-only Action & Adventure
    expect(values).not.toContain(10765); // TV-only Sci-Fi & Fantasy
  });

  it('ORIGIN_OPTIONS includes anime as a string value', () => {
    expect(ORIGIN_OPTIONS.map((o) => o.value)).toContain('anime');
    expect(ORIGIN_OPTIONS.map((o) => o.value)).toContain('KR');
  });

  it('PROVIDER/COMPANY/COLLECTION carry the spec ids', () => {
    expect(PROVIDER_OPTIONS.find((o) => o.label === 'Netflix')?.value).toBe(8);
    expect(COMPANY_OPTIONS.find((o) => o.label === 'A24')?.value).toBe(41077);
    expect(COLLECTION_OPTIONS.find((o) => o.label === 'The Avengers')?.value).toBe(86311);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `docker compose run --rm frontend npx vitest run src/types/options.test.ts`
Expected: FAIL — `PROVIDER_OPTIONS` undefined; `GENRE_OPTIONS` still contains 10759.

- [ ] **Step 3: Replace `GENRE_OPTIONS` and add the new constants**

In `frontend/src/types/index.ts`, replace `GENRE_OPTIONS` (lines 251-258) with:

```ts
// Browse controls for the new API. Genre ids are the canonical unified TMDB set
// (work in both movie and tv discover modes).
export const GENRE_OPTIONS: { value: number; label: string }[] = [
  { value: 0, label: 'All Genres' }, { value: 28, label: 'Action' },
  { value: 12, label: 'Adventure' }, { value: 16, label: 'Animation' },
  { value: 35, label: 'Comedy' }, { value: 80, label: 'Crime' },
  { value: 99, label: 'Documentary' }, { value: 18, label: 'Drama' },
  { value: 10751, label: 'Family' }, { value: 14, label: 'Fantasy' },
  { value: 36, label: 'History' }, { value: 27, label: 'Horror' },
  { value: 10402, label: 'Music' }, { value: 9648, label: 'Mystery' },
  { value: 10749, label: 'Romance' }, { value: 878, label: 'Sci-Fi' },
  { value: 53, label: 'Thriller' }, { value: 10752, label: 'War' },
  { value: 37, label: 'Western' },
];

export const PROVIDER_OPTIONS: { value: number; label: string }[] = [
  { value: 0, label: 'Any Service' }, { value: 8, label: 'Netflix' },
  { value: 9, label: 'Prime Video' }, { value: 337, label: 'Disney+' },
  { value: 1899, label: 'Max' }, { value: 15, label: 'Hulu' },
  { value: 350, label: 'Apple TV+' }, { value: 531, label: 'Paramount+' },
  { value: 386, label: 'Peacock' },
];

export const ORIGIN_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'Anywhere' }, { value: 'anime', label: 'Anime' },
  { value: 'KR', label: 'Korean' }, { value: 'JP', label: 'Japanese' },
  { value: 'IN', label: 'Indian' }, { value: 'GB', label: 'British' },
  { value: 'FR', label: 'French' }, { value: 'ES', label: 'Spanish' },
  { value: 'IT', label: 'Italian' }, { value: 'CN', label: 'Chinese' },
];

export const COMPANY_OPTIONS: { value: number; label: string }[] = [
  { value: 0, label: 'Any Studio' }, { value: 420, label: 'Marvel Studios' },
  { value: 3, label: 'Pixar' }, { value: 521, label: 'DreamWorks' },
  { value: 2, label: 'Walt Disney' }, { value: 174, label: 'Warner Bros' },
  { value: 33, label: 'Universal' }, { value: 41077, label: 'A24' },
  { value: 10342, label: 'Studio Ghibli' }, { value: 923, label: 'Legendary' },
  { value: 1632, label: 'Lionsgate' }, { value: 3172, label: 'Blumhouse' },
];

export const COLLECTION_OPTIONS: { value: number; label: string }[] = [
  { value: 0, label: 'Any Collection' }, { value: 86311, label: 'The Avengers' },
  { value: 1241, label: 'Harry Potter' }, { value: 10, label: 'Star Wars' },
  { value: 645, label: 'James Bond 007' }, { value: 9485, label: 'Fast & Furious' },
  { value: 404609, label: 'John Wick' }, { value: 263, label: 'Dark Knight' },
  { value: 2344, label: 'The Matrix' }, { value: 10194, label: 'Toy Story' },
  { value: 2150, label: 'Shrek' }, { value: 86066, label: 'Despicable Me' },
  { value: 87096, label: 'Avatar' }, { value: 748, label: 'X-Men' },
  { value: 8091, label: 'Alien' }, { value: 328, label: 'Jurassic Park' },
  { value: 131635, label: 'The Hunger Games' }, { value: 295, label: 'Pirates of the Caribbean' },
  { value: 87359, label: 'Mission Impossible' },
];

export const BEST_OF_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'Any Year' }, { value: 'best_2025', label: 'Best of 2025' },
  { value: 'best_2024', label: 'Best of 2024' }, { value: 'best_2023', label: 'Best of 2023' },
  { value: 'best_2022', label: 'Best of 2022' }, { value: 'best_2021', label: 'Best of 2021' },
  { value: 'best_2020', label: 'Best of 2020' },
];

// Discover params accepted by the browse services / endpoints.
export interface BrowseParams {
  api?: string;
  sort?: string;
  genre?: number;       // legacy single-genre alias
  genres?: string;      // comma-separated tmdb genre ids
  year?: number;
  provider?: number | string;
  origin?: string;
  company?: number | string;
  collection?: number | string;
  lang?: string;
  page?: number;
}
```

- [ ] **Step 4: Widen the browse service param types**

In `frontend/src/services/movies.ts`, change the import (line 2) to add `BrowseParams`, and the `browse` signature (line 6):

```ts
import { CatalogPage, MovieDetail, TorrentHit, BrowseParams } from '@/types';
```
```ts
  browse: async (params: BrowseParams): Promise<CatalogPage> => {
    const response = await apiClient.get('/movies', { params });
    return response.data;
  },
```

In `frontend/src/services/tv.ts`, the same — import `BrowseParams` (line 2) and:

```ts
  browse: async (params: BrowseParams): Promise<CatalogPage> => {
    const response = await apiClient.get('/tv', { params });
    return response.data;
  },
```

- [ ] **Step 5: Create the rails client**

Create `frontend/src/services/rails.ts`:

```ts
import apiClient from './api-client';
import { BrowseParams } from '@/types';

export interface RailSpec {
  key: string;
  title: string;
  eyebrow?: string;
  variant?: 'poster' | 'ranked';
  params: BrowseParams;
  see_all_href?: string;
}

export const railsService = {
  getRails: async (
    mode: 'movie' | 'tv',
    userId?: string,
    surface?: string,
    limit = 10,
  ): Promise<RailSpec[]> => {
    const response = await apiClient.get('/rails', {
      params: { mode, user_id: userId, surface, limit },
    });
    return response.data.rails ?? [];
  },
};
```

- [ ] **Step 6: Run the test + typecheck to verify they pass**

Run: `docker compose run --rm frontend npx vitest run src/types/options.test.ts`
Expected: PASS.
Run: `docker compose run --rm frontend npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/types/index.ts frontend/src/services/movies.ts frontend/src/services/tv.ts frontend/src/services/rails.ts frontend/src/types/options.test.ts
git commit -m "feat(catalog): canonical genre + provider/origin/company/collection options + rails client"
```

---

### Task 7: Planner-driven carousels (Home / Movies / Series)

**Files:**
- Create: `frontend/src/lib/buildRailsScreen.ts`
- Modify: `frontend/src/components/home/HomeBrowse.tsx`, `frontend/src/components/movies/MoviesBrowse.tsx`, `frontend/src/components/tv/SeriesBrowse.tsx` (replace fetch logic; keep skeletons)
- Modify (tests): `frontend/src/components/movies/MoviesBrowse.test.tsx`, `frontend/src/components/home/HomeBrowse.test.tsx`, `frontend/src/components/tv/SeriesBrowse.test.tsx`
- Test: `frontend/src/lib/buildRailsScreen.test.ts` (create)

**Interfaces:**
- Consumes: `railsService.getRails` (Task 6), `moviesService.browse`/`tvService.browse`, `RowConfig` from `BrowseScreen`, `useUser().currentUser?.id`.
- Produces: `buildRailsScreen(mode, userId?, surface?) => Promise<{ hero?: CatalogItem; featured: CatalogItem[]; rows: RowConfig[] }>`.

- [ ] **Step 1: Write the failing test for the builder**

Create `frontend/src/lib/buildRailsScreen.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/services/rails', () => ({ railsService: { getRails: vi.fn() } }));
vi.mock('@/services/movies', () => ({ moviesService: { browse: vi.fn() } }));
vi.mock('@/services/tv', () => ({ tvService: { browse: vi.fn() } }));

import { railsService } from '@/services/rails';
import { moviesService } from '@/services/movies';
import { buildRailsScreen } from './buildRailsScreen';

function item(id: number, title: string) {
  return { tmdb_id: id, media_type: 'movie' as const, title, year: 2024, overview: '',
    poster_url: null, backdrop_url: null, genre_ids: [], genres: [], vote_average: 0,
    vote_count: 0, popularity: 0, original_language: 'en' };
}
const page = (items: ReturnType<typeof item>[]) => ({ page: 1, results: items, total_pages: 1, total_results: items.length });

beforeEach(() => {
  vi.clearAllMocks();
  (railsService.getRails as ReturnType<typeof vi.fn>).mockResolvedValue([
    { key: 'trending', title: 'Trending Movies', params: { api: 'popular' }, see_all_href: '/movies' },
    { key: 'genre-28', title: 'Action', eyebrow: 'Genre', params: { genres: '28' } },
  ]);
  (moviesService.browse as ReturnType<typeof vi.fn>).mockImplementation((p: { api?: string; genres?: string }) => {
    if (p.genres === '28') return Promise.resolve(page([item(301, 'Action Flick')]));
    return Promise.resolve(page([item(1, 'Hero'), item(2, 'Feat A')]));
  });
});

describe('buildRailsScreen', () => {
  it('maps planner rails to rows and derives hero/featured from the popular rail', async () => {
    const screen = await buildRailsScreen('movie', 'u1', 'movies');
    expect(railsService.getRails).toHaveBeenCalledWith('movie', 'u1', 'movies');
    expect(screen.hero?.title).toBe('Hero');
    expect(screen.featured.map((i) => i.title)).toEqual(['Feat A']);
    expect(screen.rows.map((r) => r.title)).toEqual(['Trending Movies', 'Action']);
    expect(screen.rows[1].items[0].title).toBe('Action Flick');
  });

  it('falls back to default rails when the planner fails', async () => {
    (railsService.getRails as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('down'));
    const screen = await buildRailsScreen('movie');
    expect(screen.rows.length).toBeGreaterThan(0);
    expect(screen.rows[0].title).toBe('Trending Movies');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `docker compose run --rm frontend npx vitest run src/lib/buildRailsScreen.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the builder**

Create `frontend/src/lib/buildRailsScreen.ts`:

```ts
import { CatalogItem, CatalogPage } from '@/types';
import { RowConfig } from '@/components/browse/BrowseScreen';
import { railsService, RailSpec } from '@/services/rails';
import { moviesService } from '@/services/movies';
import { tvService } from '@/services/tv';

const emptyPage: CatalogPage = { page: 1, results: [], total_pages: 0, total_results: 0 };

export interface RailsScreen {
  hero?: CatalogItem;
  featured: CatalogItem[];
  rows: RowConfig[];
}

function defaultRails(mode: 'movie' | 'tv'): RailSpec[] {
  const noun = mode === 'tv' ? 'Series' : 'Movies';
  const href = mode === 'tv' ? '/tv' : '/movies';
  return [
    { key: 'trending', title: `Trending ${noun}`, params: { api: 'popular' }, see_all_href: href },
    { key: 'top-rated', title: `Top Rated ${noun}`, eyebrow: 'Critically acclaimed', variant: 'ranked', params: { api: 'top_rated' } },
    { key: 'new', title: 'New Releases', params: { api: 'popular', sort: 'primary_release_date.desc' } },
    { key: 'genre-28', title: 'Action', eyebrow: 'Genre', params: { genres: '28' } },
    { key: 'genre-18', title: 'Drama', eyebrow: 'Genre', params: { genres: '18' } },
  ];
}

export async function buildRailsScreen(
  mode: 'movie' | 'tv',
  userId?: string,
  surface?: string,
): Promise<RailsScreen> {
  const browse = mode === 'tv' ? tvService.browse : moviesService.browse;

  let rails: RailSpec[];
  try {
    rails = await railsService.getRails(mode, userId, surface);
    if (rails.length === 0) rails = defaultRails(mode);
  } catch {
    rails = defaultRails(mode);
  }

  const pages = await Promise.all(rails.map((r) => browse(r.params).catch(() => emptyPage)));

  // Hero/featured come from the first popular-feed rail (fallback: first rail).
  const heroIdx = Math.max(0, rails.findIndex((r) => r.params.api === 'popular'));
  const heroPage = pages[heroIdx] ?? emptyPage;

  const rows: RowConfig[] = rails.map((r, i) => ({
    key: r.key,
    title: r.title,
    eyebrow: r.eyebrow,
    variant: r.variant,
    seeAllHref: r.see_all_href,
    items: pages[i].results,
  }));

  return {
    hero: heroPage.results[0],
    featured: heroPage.results.slice(1, 7),
    rows,
  };
}
```

- [ ] **Step 4: Run the builder test to verify it passes**

Run: `docker compose run --rm frontend npx vitest run src/lib/buildRailsScreen.test.ts`
Expected: PASS.

- [ ] **Step 5: Rewrite `MoviesBrowse.tsx` to use the builder**

Replace the `MoviesBrowse` component body (`frontend/src/components/movies/MoviesBrowse.tsx` lines 91-176) with:

```tsx
export default function MoviesBrowse() {
  const { currentUser } = useUser();
  const [isLoading, setIsLoading] = useState(true);
  const [hero, setHero] = useState<CatalogItem | undefined>(undefined);
  const [featured, setFeatured] = useState<CatalogItem[]>([]);
  const [rows, setRows] = useState<RowConfig[]>([]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setIsLoading(true);
      const screen = await buildRailsScreen('movie', currentUser?.id, 'movies');
      if (cancelled) return;
      setHero(screen.hero);
      setFeatured(screen.featured);
      setRows(screen.rows);
      setIsLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, [currentUser?.id]);

  if (isLoading) return <MoviesSkeleton />;

  return (
    <BrowseScreen hero={hero} featured={featured} rows={rows} showContinueWatching={false} />
  );
}
```

Update the imports at the top of the file (replace lines 18-21):

```tsx
import React, { useEffect, useState } from 'react';
import { CatalogItem } from '@/types';
import { useUser } from '@/context/UserContext';
import { buildRailsScreen } from '@/lib/buildRailsScreen';
import BrowseScreen, { RowConfig } from '@/components/browse/BrowseScreen';
```

Delete the now-unused `emptyPage` / `safeBrowse` helpers (old lines 23-37). Keep `MoviesSkeleton`.

- [ ] **Step 6: Rewrite `SeriesBrowse.tsx` the same way**

In `frontend/src/components/tv/SeriesBrowse.tsx`: same import block (but `buildRailsScreen('tv', currentUser?.id, 'tv')`), same component shape, keep `SeriesSkeleton`, `showContinueWatching={false}`. Remove `emptyPage`/`safeBrowse`.

- [ ] **Step 7: Rewrite `HomeBrowse.tsx` the same way**

In `frontend/src/components/home/HomeBrowse.tsx`: same shape with `buildRailsScreen('movie', currentUser?.id, 'home')`, keep `HomeSkeleton`, but `showContinueWatching` (true). Remove `emptyPage`/`safeBrowse`.

- [ ] **Step 8: Update the three component tests**

Replace `frontend/src/components/movies/MoviesBrowse.test.tsx` with:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import MoviesBrowse from './MoviesBrowse';

vi.mock('@/context/UserContext', () => ({ useUser: () => ({ currentUser: { id: 'u1' } }) }));
vi.mock('@/services/rails', () => ({ railsService: { getRails: vi.fn() } }));
vi.mock('@/services/movies', () => ({ moviesService: { browse: vi.fn() } }));
vi.mock('@/services/tv', () => ({ tvService: { browse: vi.fn() } }));
vi.mock('@/components/browse/BrowseScreen', () => ({
  default: ({ hero, rows }: { hero?: { title: string }; rows: Array<{ title: string }> }) => (
    <div data-testid="mock-browse-screen">
      {hero && <h1 data-testid="mock-hero-title">{hero.title}</h1>}
      {rows.map((r) => (<h2 key={r.title} data-testid="mock-row-title">{r.title}</h2>))}
    </div>
  ),
}));

import { railsService } from '@/services/rails';
import { moviesService } from '@/services/movies';

function item(id: number, title: string) {
  return { tmdb_id: id, media_type: 'movie' as const, title, year: 2024, overview: '',
    poster_url: null, backdrop_url: null, genre_ids: [], genres: [], vote_average: 0,
    vote_count: 0, popularity: 0, original_language: 'en' };
}
const page = (items: ReturnType<typeof item>[]) => ({ page: 1, results: items, total_pages: 1, total_results: items.length });

beforeEach(() => {
  vi.clearAllMocks();
  (railsService.getRails as ReturnType<typeof vi.fn>).mockResolvedValue([
    { key: 'trending', title: 'Trending Movies', params: { api: 'popular' }, see_all_href: '/movies' },
    { key: 'genre-28', title: 'Action', eyebrow: 'Genre', params: { genres: '28' } },
  ]);
  (moviesService.browse as ReturnType<typeof vi.fn>).mockImplementation((p: { api?: string; genres?: string }) => {
    if (p.genres === '28') return Promise.resolve(page([item(301, 'Action Flick')]));
    return Promise.resolve(page([item(1, 'Popular Hero Movie'), item(2, 'Feat A')]));
  });
});

describe('MoviesBrowse', () => {
  it('renders the BrowseScreen once data loads', async () => {
    render(<MoviesBrowse />);
    await screen.findByTestId('mock-browse-screen');
  });

  it('asks the planner for movie rails with the active profile + surface', async () => {
    render(<MoviesBrowse />);
    await screen.findByTestId('mock-browse-screen');
    expect(railsService.getRails).toHaveBeenCalledWith('movie', 'u1', 'movies');
  });

  it('passes the first popular item as the hero', async () => {
    render(<MoviesBrowse />);
    const hero = await screen.findByTestId('mock-hero-title');
    expect(hero).toHaveTextContent('Popular Hero Movie');
  });

  it('renders planner-driven row titles', async () => {
    render(<MoviesBrowse />);
    const titles = (await screen.findAllByTestId('mock-row-title')).map((e) => e.textContent);
    expect(titles).toContain('Trending Movies');
    expect(titles).toContain('Action');
  });

  it('falls back to default rails when the planner fails', async () => {
    (railsService.getRails as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('down'));
    render(<MoviesBrowse />);
    const titles = (await screen.findAllByTestId('mock-row-title')).map((e) => e.textContent);
    expect(titles).toContain('Trending Movies');
  });
});
```

Apply the same rewrite to `HomeBrowse.test.tsx` (mock `useUser`, `railsService`, `moviesService`; surface `'home'`; assert `getRails('movie','u1','home')` and that the skeleton testid is `home-skeleton`) and `SeriesBrowse.test.tsx` (mock `tvService.browse` instead of movies; surface `'tv'`; `getRails('tv','u1','tv')`; titles end in `Series`; skeleton `series-skeleton`).

- [ ] **Step 9: Run the three component tests + typecheck**

Run: `docker compose run --rm frontend npx vitest run src/components/movies/MoviesBrowse.test.tsx src/components/home/HomeBrowse.test.tsx src/components/tv/SeriesBrowse.test.tsx src/lib/buildRailsScreen.test.ts`
Expected: PASS.
Run: `docker compose run --rm frontend npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 10: Commit**

```bash
git add frontend/src/lib/buildRailsScreen.ts frontend/src/lib/buildRailsScreen.test.ts frontend/src/components/home/HomeBrowse.tsx frontend/src/components/movies/MoviesBrowse.tsx frontend/src/components/tv/SeriesBrowse.tsx frontend/src/components/home/HomeBrowse.test.tsx frontend/src/components/movies/MoviesBrowse.test.tsx frontend/src/components/tv/SeriesBrowse.test.tsx
git commit -m "feat(browse): planner-driven dynamic carousels on home/movies/series"
```

---

### Task 8: Search filters — new discover dimensions

**Files:**
- Modify: `frontend/src/lib/useSearchUrlState.ts` (extend state + querystring)
- Modify: `frontend/src/components/search/SearchFilters.tsx` (new chips, movie-only gating)
- Modify: `frontend/src/components/search/SearchView.tsx` (forward new params to browse)
- Modify (tests): `frontend/src/lib/useSearchUrlState.test.ts`, `frontend/src/components/search/SearchFilters.test.tsx`

**Interfaces:**
- Consumes: `GENRE_OPTIONS, PROVIDER_OPTIONS, ORIGIN_OPTIONS, COMPANY_OPTIONS, COLLECTION_OPTIONS, BEST_OF_OPTIONS` (Task 6); `moviesService.browse`/`tvService.browse`.
- Produces: extended `SearchState { q, type, genre, year, sort, provider, origin, company, collection, api }`.

- [ ] **Step 1: Write the failing tests for URL state**

Add to `frontend/src/lib/useSearchUrlState.test.ts` (inside the `setState` describe, plus a hydration test in the hydration describe):

```ts
    it('hydrates the new discover dimensions', () => {
      const { result } = renderSearchHook({ provider: '8', origin: 'KR', company: '420', collection: '86311', api: 'best_2025' });
      expect(result.current.state.provider).toBe(8);
      expect(result.current.state.origin).toBe('KR');
      expect(result.current.state.company).toBe(420);
      expect(result.current.state.collection).toBe(86311);
      expect(result.current.state.api).toBe('best_2025');
    });

    it('serialises provider + origin into the URL', () => {
      const { result } = renderSearchHook();
      act(() => { result.current.setState({ provider: 8, origin: 'KR' }); });
      const url: string = mockReplace.mock.calls[0][0];
      expect(url).toContain('provider=8');
      expect(url).toContain('origin=KR');
    });

    it('omits provider when 0 and origin when empty', () => {
      const { result } = renderSearchHook({ provider: '8', origin: 'KR' });
      act(() => { result.current.setState({ provider: 0, origin: '' }); });
      const url: string = mockReplace.mock.calls[0][0];
      expect(url).not.toContain('provider=');
      expect(url).not.toContain('origin=');
    });
```

Also update the existing `'uses defaults when no search params are present'` test's expected object to include the new defaults:

```ts
      expect(result.current.state).toEqual({
        q: '', type: 'all', genre: 0, year: 0, sort: '',
        provider: 0, origin: '', company: 0, collection: 0, api: '',
      });
```

- [ ] **Step 2: Run the URL-state tests to verify they fail**

Run: `docker compose run --rm frontend npx vitest run src/lib/useSearchUrlState.test.ts`
Expected: FAIL — `provider` undefined; default object mismatch.

- [ ] **Step 3: Extend `useSearchUrlState.ts`**

Replace `frontend/src/lib/useSearchUrlState.ts` lines 9-53 (the `SearchState` interface, `DEFAULTS`, `toQueryString`) and the state initialiser (74-80) with:

```ts
export interface SearchState {
  q: string;
  type: 'all' | 'movie' | 'tv';
  genre: number;
  year: number;
  sort: string;
  provider: number;
  origin: string;
  company: number;
  collection: number;
  api: string;          // best_YYYY feed (mutually exclusive with discover filters)
}

export interface UseSearchUrlStateReturn {
  state: SearchState;
  setState: (partial: Partial<SearchState>) => void;
}

const DEFAULTS: SearchState = {
  q: '', type: 'all', genre: 0, year: 0, sort: '',
  provider: 0, origin: '', company: 0, collection: 0, api: '',
};

function parseType(raw: string | null): 'all' | 'movie' | 'tv' {
  if (raw === 'movie' || raw === 'tv') return raw;
  return 'all';
}

function parseNum(raw: string | null): number {
  if (!raw) return 0;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : 0;
}

function toQueryString(state: SearchState): string {
  const params = new URLSearchParams();
  if (state.q) params.set('q', state.q);
  if (state.type !== 'all') params.set('type', state.type);
  if (state.genre !== 0) params.set('genre', String(state.genre));
  if (state.year !== 0) params.set('year', String(state.year));
  if (state.sort) params.set('sort', state.sort);
  if (state.provider !== 0) params.set('provider', String(state.provider));
  if (state.origin) params.set('origin', state.origin);
  if (state.company !== 0) params.set('company', String(state.company));
  if (state.collection !== 0) params.set('collection', String(state.collection));
  if (state.api) params.set('api', state.api);
  return params.toString();
}
```

And the state initialiser (the `useState` body, lines 74-80) becomes:

```ts
  const [state, setLocalState] = useState<SearchState>(() => ({
    q: params?.get('q') ?? DEFAULTS.q,
    type: parseType(params?.get('type')),
    genre: parseNum(params?.get('genre')),
    year: parseNum(params?.get('year')),
    sort: params?.get('sort') ?? DEFAULTS.sort,
    provider: parseNum(params?.get('provider')),
    origin: params?.get('origin') ?? DEFAULTS.origin,
    company: parseNum(params?.get('company')),
    collection: parseNum(params?.get('collection')),
    api: params?.get('api') ?? DEFAULTS.api,
  }));
```

- [ ] **Step 4: Run the URL-state tests to verify they pass**

Run: `docker compose run --rm frontend npx vitest run src/lib/useSearchUrlState.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing test for the new filter chips**

Add to `frontend/src/components/search/SearchFilters.test.tsx` (mirror its existing render helper; it passes the controlled props). Add a test that the Studio chip is movie-only:

```tsx
  it('shows Studio + Collection chips only for type=movie', () => {
    const { rerender } = render(
      <SearchFilters type="all" genre={0} year={0} sort="" provider={0} origin="" company={0} collection={0} api="" onChange={() => {}} />,
    );
    expect(screen.queryByLabelText('Studio filter')).toBeNull();
    rerender(
      <SearchFilters type="movie" genre={0} year={0} sort="" provider={0} origin="" company={0} collection={0} api="" onChange={() => {}} />,
    );
    expect(screen.getByLabelText('Studio filter')).toBeInTheDocument();
  });

  it('renders Streaming and Origin chips for all types', () => {
    render(
      <SearchFilters type="all" genre={0} year={0} sort="" provider={0} origin="" company={0} collection={0} api="" onChange={() => {}} />,
    );
    expect(screen.getByLabelText('Streaming filter')).toBeInTheDocument();
    expect(screen.getByLabelText('Origin filter')).toBeInTheDocument();
  });
```

> If the existing `SearchFilters.test.tsx` renders `<SearchFilters .../>` without the new props, update those render calls to include `provider={0} origin="" company={0} collection={0} api=""`.

- [ ] **Step 6: Run the chip test to verify it fails**

Run: `docker compose run --rm frontend npx vitest run src/components/search/SearchFilters.test.tsx`
Expected: FAIL — props type error / chips absent.

- [ ] **Step 7: Extend `SearchFilters.tsx`**

In `frontend/src/components/search/SearchFilters.tsx`:

Update the import (line 24) and props interface (30-36):

```tsx
import { GENRE_OPTIONS, SORT_OPTIONS, YEAR_OPTIONS, PROVIDER_OPTIONS, ORIGIN_OPTIONS, COMPANY_OPTIONS, COLLECTION_OPTIONS, BEST_OF_OPTIONS } from '@/types';
```
```tsx
export interface SearchFiltersProps {
  type: 'all' | 'movie' | 'tv';
  genre: number;
  year: number;
  sort: string;
  provider: number;
  origin: string;
  company: number;
  collection: number;
  api: string;
  onChange: (partial: Partial<{ type: 'all' | 'movie' | 'tv'; genre: number; year: number; sort: string; provider: number; origin: string; company: number; collection: number; api: string }>) => void;
}
```

Update the component signature (208-214) to destructure the new props, and add chips after the Sort chip (before the closing `</div>` at line 281). Insert:

```tsx
      {/* ── Streaming chip (provider/network) ── */}
      <FilterChip
        label="Streaming"
        value={provider}
        options={PROVIDER_OPTIONS}
        onSelect={(v) => onChange({ provider: v })}
        aria-label="Streaming filter"
      />

      {/* ── Origin chip (+ Anime) ── */}
      <FilterChip
        label="Origin"
        value={origin}
        options={ORIGIN_OPTIONS}
        onSelect={(v) => onChange({ origin: v })}
        defaultLabel="Anywhere"
        aria-label="Origin filter"
      />

      {/* ── Best of year chip (feed; suppresses discover filters) ── */}
      <FilterChip
        label="Best of"
        value={api}
        options={BEST_OF_OPTIONS}
        onSelect={(v) => onChange({ api: v })}
        defaultLabel="Any Year"
        aria-label="Best of year filter"
      />

      {/* ── Studio + Collection (movie-only) ── */}
      {type === 'movie' && (
        <>
          <FilterChip
            label="Studio"
            value={company}
            options={COMPANY_OPTIONS}
            onSelect={(v) => onChange({ company: v })}
            aria-label="Studio filter"
          />
          <FilterChip
            label="Saga"
            value={collection}
            options={COLLECTION_OPTIONS}
            onSelect={(v) => onChange({ collection: v })}
            aria-label="Collection filter"
          />
        </>
      )}
```

> `FilterChip<T extends string | number>` already supports string-valued options (origin/api) and its `hasSelection` check treats `''`/`0` as unset — no change needed there.

- [ ] **Step 8: Forward the new params from `SearchView.tsx`**

In `frontend/src/components/search/SearchView.tsx`:

Update the `isActive` check (112-117) to include the new dimensions:

```tsx
  const isActive =
    state.q.trim() !== '' || state.genre !== 0 || state.year !== 0 ||
    state.sort !== '' || state.type !== 'all' || state.provider !== 0 ||
    state.origin !== '' || state.company !== 0 || state.collection !== 0 || state.api !== '';
```

Update `fetchKey` (126) to include them:

```tsx
  const fetchKey = `${state.q}|${state.type}|${state.genre}|${state.year}|${state.sort}|${state.provider}|${state.origin}|${state.company}|${state.collection}|${state.api}`;
```

Replace the `fetchMovies`/`fetchTv` browse calls (162-174) with discover-param-aware versions:

```tsx
        const { type, genre, year, sort, provider, origin, company, collection, api } = state;
        const common = {
          sort: sort || undefined,
          genres: genre ? String(genre) : undefined,
          year: year || undefined,
          provider: provider || undefined,
          origin: origin || undefined,
          api: api || undefined,
        };

        const fetchMovies = async (): Promise<CatalogPage> => {
          if (q) return moviesService.search(q, page);
          return moviesService.browse({ ...common, company: company || undefined, collection: collection || undefined, page });
        };

        const fetchTv = async (): Promise<CatalogPage> => {
          if (q) return tvService.search(q, page);
          return tvService.browse({ ...common, page });
        };
```

Update the `fetchPage` dependency array (210) and the `<SearchFilters>` usage (340-346) to pass the new props:

```tsx
            <SearchFilters
              type={state.type}
              genre={state.genre}
              year={state.year}
              sort={state.sort}
              provider={state.provider}
              origin={state.origin}
              company={state.company}
              collection={state.collection}
              api={state.api}
              onChange={(partial) => setState(partial)}
            />
```

And the `fetchPage` `useCallback` deps (line 210) become:

```tsx
    [state.q, state.type, state.genre, state.year, state.sort, state.provider, state.origin, state.company, state.collection, state.api, isActive],
```

- [ ] **Step 9: Run the search tests + typecheck**

Run: `docker compose run --rm frontend npx vitest run src/components/search/SearchFilters.test.tsx src/lib/useSearchUrlState.test.ts`
Expected: PASS.
Run: `docker compose run --rm frontend npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 10: Run the full frontend suite (regression guard)**

Run: `docker compose run --rm frontend npx vitest run`
Expected: PASS (all green).

- [ ] **Step 11: Commit**

```bash
git add frontend/src/lib/useSearchUrlState.ts frontend/src/lib/useSearchUrlState.test.ts frontend/src/components/search/SearchFilters.tsx frontend/src/components/search/SearchFilters.test.tsx frontend/src/components/search/SearchView.tsx
git commit -m "feat(search): provider/origin/studio/collection/best-of-year filters"
```

---

## Final verification

- [ ] **Backend:** `docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest -q` → all pass.
- [ ] **Frontend:** `docker compose run --rm frontend npx vitest run` → all pass; `docker compose run --rm frontend npx tsc --noEmit` → clean.
- [ ] **Manual smoke (`make up`, frontend at http://localhost:3001):**
  - A genre row (e.g. "Action") shows genuinely different titles from "Trending".
  - Search → pick Genre = Horror → results are horror; pick Streaming = Netflix → Netflix titles; Origin = Korean → Korean titles; (movie type) Studio = A24 / Saga = The Avengers → correct.
  - Reload home twice on different profiles → lineups differ; same profile same day → stable.
- [ ] **DevTools Network check:** browse requests hit `…/browse-movies?api=discover&…&genres=28` (not `genre=28` against `api=popular`).

## Self-review notes (author)

- **Spec coverage:** dual-shape `browse` (Task 1) ✓; routers/services/cron (Tasks 2-3) ✓; rail planner + endpoint (Tasks 4-5) ✓; frontend options/services/rails client (Task 6) ✓; planner-driven carousels (Task 7) ✓; search filters (Task 8) ✓; canonical GENRE_OPTIONS fix (Task 6) ✓.
- **Type consistency:** `RailSpec.see_all_href` (snake, backend + rails client) is mapped to `RowConfig.seeAllHref` (camel) in `buildRailsScreen`. `BrowseParams` is the single source for browse/rails param typing.
- **Best-of-year × discover:** surfaced as the "Collection"/Best-of chip driving `api=`; backend treats `best_YYYY` as a feed (ignores discover filters), so no conflicting request is built.
