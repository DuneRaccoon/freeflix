# yts.lu discover params + personalised rails — design

**Date:** 2026-06-22
**Status:** Approved (design), pending spec review
**Area:** catalog provider (backend) + browse/search/carousels (frontend)

## Problem

The yts.lu catalog API exposes **two distinct request shapes**:

- **Feed requests** — `api=popular|top_rated|now_playing|upcoming|on_the_air|airing_today|best_YYYY`
  return a fixed feed and **ignore all filter params**.
- **Discover requests** — `api=discover` plus named filters
  (`genres`, `provider`/`network`, `origin`, `company`, `id`, `year`, `lang`) are the **only**
  way to filter the catalog.

`backend/app/providers/catalog.py::browse` only ever emits the feed shape and adds a
**singular `genre=`** param that the upstream ignores:

```python
params = {"api": api, "mode": mode, "page": page, "sort": sort}
if genre:
    params["genre"] = genre   # wrong name (should be `genres`) AND api is still a feed
```

Consequences (all observed by the user):

1. Every "genre" carousel (`HomeBrowse`/`MoviesBrowse`/`SeriesBrowse` send `api:'popular', genre:N`)
   actually requests the **popular feed** → every genre row shows the same popular titles.
2. The search page's genre filter is equally inert.
3. Scheduled downloads (`cron/jobs.py`) filter by genre the same broken way.
4. Secondary bug: frontend `GENRE_OPTIONS` mixes **TV-only** ids (`10759`, `10765`, `10768`)
   into a list used for movies too — those return nothing in movie mode.

## Goals

- Make genre (and all discover dimensions) filter correctly, end-to-end, for both movie and TV.
- Add the full discover param surface: `genres`, `provider`/`network`, `origin` (+ `anime`),
  `company`, `collection` (→ `id`), `year`, `lang`, and `best_YYYY` feeds.
- Surface the new dimensions in the frontend: search filter chips **and** curated carousels.
- Make home/movies/tv carousel lineups **dynamic and lightly personalised** via a backend rail planner.

## Non-goals (YAGNI)

- No standalone language chip — `lang` is reachable only via the Anime origin.
- No full recommendation engine — taste is a simple genre/origin affinity tally.
- No new auth — profile is the existing `user_id` (UserContext), passed like other endpoints.

## Canonical id maps (source of truth)

**Genres (unified, work in both modes):** Action:28, Adventure:12, Animation:16, Comedy:35,
Crime:80, Documentary:99, Drama:18, Family:10751, Fantasy:14, History:36, Horror:27, Music:10402,
Mystery:9648, Romance:10749, Sci-Fi:878, Thriller:53, War:10752, Western:37.

**Provider (movie) / Network (tv):** Netflix:8, Prime Video:9, Disney+:337, Max:1899, Hulu:15,
Apple TV+:350, Paramount+:531, Peacock:386.

**Origin (country code; both modes):** Korean:KR, Japanese:JP, Indian:IN, British:GB, French:FR,
Spanish:ES, Italian:IT, Chinese:CN. Special: **Anime** → `genres=16` + `lang=ja` (NOT an origin).

**Company (movie only):** Marvel Studios:420, Pixar:3, DreamWorks:521, Walt Disney:2,
Warner Bros:174, Universal:33, A24:41077, Studio Ghibli:10342, Legendary:923, Lionsgate:1632,
Blumhouse:3172.

**Collection / `id` (movie only):** Avengers:86311, Harry Potter:1241, Star Wars:10,
James Bond 007:645, Fast & Furious:9485, John Wick:404609, Dark Knight:263, The Matrix:2344,
Toy Story:10194, Shrek:2150, Despicable Me:86066, Avatar:87096, X-Men:748, Alien:8091,
Jurassic Park:328, Hunger Games:131635, Pirates of the Caribbean:295, Mission Impossible:87359.
(Partial list "for the time being" — extend later.)

**Best-of-year feeds:** `best_2025` … `best_2020`.

## Architecture

### Backend

#### 1. `providers/catalog.py::browse` — dual-shape request builder

New signature (keyword-only discover filters; legacy positional `genre` removed — see callers):

```python
async def browse(api="popular", sort="popularity.desc", page=1, mode="movie", *,
                 genres=None, year=0, provider=None, origin=None,
                 company=None, collection=None, lang=None) -> CatalogPage:
```

Build logic:

```python
params = {"mode": mode, "page": page, "sort": sort}
disc, g, lng = {}, genres, lang
if origin == "anime":
    g = _merge_genre(g, 16); lng = lng or "ja"   # anime = genres:16 + lang:ja
elif origin:
    disc["origin"] = origin
if g:          disc["genres"] = g                # plural, comma-joined
if lng:        disc["lang"] = lng
if provider:   disc["network" if mode == "tv" else "provider"] = provider
if company:    disc["company"] = company
if collection: disc["id"] = collection
if year:       disc["year"] = year
if disc:
    params.update({"api": "discover", "genre": 0, "year": 0, **disc})  # mirror proven request shape
else:
    params["api"] = api
```

- `_merge_genre(existing, id)` joins ids comma-separated, de-duplicated.
- `genres` accepts a single id (`"28"`) or comma list (`"28,12"`).
- The `genre=0` placeholder mirrors the exact proven-working discover URL; harmless.

#### 2. Routers `api/movies.py`, `api/tv.py`

- Widen `api` pattern:
  - movie: `^(popular|top_rated|now_playing|upcoming|discover|best_(2020|2021|2022|2023|2024|2025))$`
  - tv:    `^(popular|top_rated|on_the_air|airing_today|discover|best_(2020|2021|2022|2023|2024|2025))$`
- Add query params: `genres: str|None`, `provider: str|None`, `origin: str|None`, `year: int=0`,
  `lang: str|None`; movie router additionally `company`, `collection`. (TV router omits company/collection.)
- Keep legacy `genre: int = 0` as an **alias** folded into `genres` when `genres` is unset.

#### 3. Services `services/movies.py`, `services/tv.py`

Thread the new kwargs through to `catalog.browse`. `_cache_page` unchanged.

#### 4. `cron/jobs.py::_find_movies_for_schedule`

Replace `browse(..., genre=id)` with `browse(..., genres=str(id))` when a genre is selected
(fixes scheduled genre filtering, which was equally broken).

#### 5. Rail planner — `services/rails.py` + `api/rails.py`

- `GET /api/v1/rails?mode=movie&user_id=<id?>&limit=10` → `{ "rails": RailSpec[] }`.
- `RailSpec = {key, title, eyebrow?, variant?('poster'|'ranked'), params:{api?,sort?,genres?,
  provider?,origin?,company?,collection?,year?}, see_all_href?}`.
- Returns **specs only** (not items). Frontend fetches each rail via the browse endpoint in
  parallel with graceful degrade — matches the current architecture, keeps the endpoint fast.
- **Taste signal:**
  - Pull recent progress (`UserStreamingProgress.get_recent_for_user`, ~40) + watchlist.
  - Parse each `content_id` (`movie:{id}` / `tv:{id}:...`) → `(media_type, tmdb_id)`.
  - Join `CatalogItemCache` for `genre_ids` + `original_language`.
  - Tally genre frequency and language→origin frequency. Map:
    `ko→KR, ja→JP, hi/ta/te/ml/kn/bn/pa→IN, fr→FR, es→ES, it→IT, zh→CN` (`en` omitted).
  - Animation(16)+Japanese(ja) affinity → an Anime rail.
- **Assembly (ordered):**
  1. Evergreen leads: Trending (`api=popular`), Top Rated (`api=top_rated`, `variant=ranked`),
     New Releases (`api=popular, sort=primary_release_date.desc`).
  2. "Because you watch …" rails for the user's top genre(s) / origin (discover params).
  3. Remaining slots filled from a **candidate pool** (providers, studios [movie], best-of-year,
     collections [movie], untouched genres) selected/ordered by a **daily profile seed**
     `seed = hash((user_id or "anon", date.today().isoformat()))` → rotates daily, differs per profile.
- **Cold start** (no history / no user): seeded rotation over the pool + canonical genre rows; no "For you" rails.
- Mode-aware: company/collection pool entries only when `mode=="movie"`.

### Frontend

#### 6. `types/index.ts` + `services/movies.ts`, `services/tv.ts`

- Replace `GENRE_OPTIONS` with the canonical unified genre list above.
- Add `PROVIDER_OPTIONS`, `ORIGIN_OPTIONS` (+ Anime), `COMPANY_OPTIONS`, `COLLECTION_OPTIONS`,
  `BEST_OF_OPTIONS`.
- Widen `moviesService.browse` / `tvService.browse` param types with
  `api, sort, genres, provider, origin, company, collection, year, lang, page`.
- Add `services/rails.ts` → `railsService.getRails(mode, userId?, limit?)`.

#### 7. Carousels — `HomeBrowse`, `MoviesBrowse`, `SeriesBrowse`

- Refactor each from hardcoded `Promise.all` to: call the rail planner with `currentUser?.id`,
  then `Promise.all` fetch each returned rail's params via browse, derive hero/featured from the
  first popular-feed rail's results, render `BrowseScreen` (which already takes `RowConfig[]`).
- Graceful degrade: planner failure → fall back to a static default rail set (current behaviour,
  but corrected to use `genres`).

#### 8. Search — `SearchFilters`, `useSearchUrlState`, `SearchView`, `GenreBrowse`

- Add chips: **Streaming** (provider/network), **Origin** (+Anime), **Studio** (movie-only),
  **Collection** (movie-only), **Best of YYYY**. Movie-only chips hidden when type ≠ movie.
- Extend `SearchState` + querystring with `genres, provider, origin, company, collection, api`.
- `SearchView.fetchMovies/fetchTv` send the new discover params (and `genres` instead of `genre`).
- `best_YYYY` is a feed, mutually exclusive with discover filters: selecting it drives `api=` and
  suppresses/disables the discover chips for that query.
- `GenreBrowse` reads the corrected `GENRE_OPTIONS`.

## Data flow (genre row, corrected)

```
MoviesBrowse → railsService.getRails('movie', uid)
  → planner returns {key:'because-action', params:{genres:'28'}}
MoviesBrowse → moviesService.browse({genres:'28'})
  → GET /api/v1/movies?genres=28
  → catalog.browse(genres='28') → GET en.yts.lu/browse-movies?api=discover&mode=movie&genres=28&...
  → real Action movies → PosterCards
```

## Error handling

- `catalog._get` already logs and returns `None` → empty `CatalogPage`. Unchanged.
- Rail planner: any per-user DB/cache miss degrades to cold-start rotation; never 500s.
- Frontend `safeBrowse` + planner fallback keep every rail independent and non-fatal.

## Testing

**Backend (pytest):**
- `catalog.browse` param builder (monkeypatch `_get` to capture params):
  genre→`api=discover`+`genres`; provider→`network` in TV / `provider` in movie;
  anime→`genres=16`+`lang=ja`; bare `popular` stays a feed (no discover keys); `year` forces discover;
  `collection`→`id`; multi-genre comma join.
- Router alias: `genre=28` folds to `genres=28`.
- Rail planner: language→origin mapping; affinity tally; deterministic seed
  (same user+date → identical lineup); cold-start emits no "For you" rails; movie-only pool gating.

**Frontend (vitest/RTL):**
- Update existing tests asserting old `genre:` param (`HomeBrowse`, `MoviesBrowse`, `SeriesBrowse`,
  `SearchFilters`, `useSearchUrlState`) to the new `genres`/discover wiring.
- New: `railsService` shape; planner-driven carousel render; new filter chips update URL state;
  movie-only chips hidden for type≠movie.

## Affected files

Backend: `providers/catalog.py`, `api/movies.py`, `api/tv.py`, `services/movies.py`,
`services/tv.py`, `services/rails.py` (new), `api/rails.py` (new), `main.py` (register router),
`models.py` (RailSpec response models), `cron/jobs.py`, `tests/` (+ new).

Frontend: `types/index.ts`, `services/movies.ts`, `services/tv.ts`, `services/rails.ts` (new),
`components/home/HomeBrowse.tsx`, `components/movies/MoviesBrowse.tsx`,
`components/tv/SeriesBrowse.tsx`, `components/search/SearchFilters.tsx`,
`components/search/SearchView.tsx`, `components/search/GenreBrowse.tsx`,
`lib/useSearchUrlState.ts`, related `*.test.tsx`.

## Open items

- Collection id list is partial (18 franchises) — extend when the full list is available.
- Best-of-year × discover mutual exclusion is a UI affordance, not a hard backend constraint.
