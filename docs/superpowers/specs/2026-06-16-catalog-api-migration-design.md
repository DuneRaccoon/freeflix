# Catalog API Migration — Design (Phase 1: Movies)

**Date:** 2026-06-16
**Status:** Approved (design), pending spec review
**Branch:** `feat/catalog-api-migration`

## Problem

The app's movie data came from scraping a YTS HTML site (`backend/app/scrapers/yts.py`)
that has been **decommissioned**. We are migrating to a new JSON data API (TMDB-shaped)
that the user has already pointed the settings at. Browsing, search, detail, and torrent
downloads are all currently broken because the scraper's source is gone.

## Goals

1. Replace the dead HTML scraper with the new JSON API end-to-end for **movies**.
2. Restore: browse (popular/top-rated), search, movie detail, quality-based download,
   and streaming — on the new data source.
3. Lay a **shared foundation** so Phase 2 (TV) is additive, not a rewrite.

## Decisions (confirmed with user)

| Decision | Choice |
| --- | --- |
| Overall scope | **Movies + TV**, executed in **two sequential phases**. This spec covers **Phase 1: Movies**. TV gets its own spec. |
| Movie detail richness | **Rich via real TMDB**: fetch full detail + cast/crew/runtime/imdb by TMDB id (`tmdb_api_key`). |
| Torrent selection | **Quality buckets, auto best-seeded**: parse quality from titles, filter to the chosen bucket, download highest-seeded. |
| OMDB | **Dropped** for movies (TMDB-by-id covers ratings/cast/runtime). |
| Movie-metadata cache | **Rebuilt** under the new tmdb-id schema; old YTS-shaped cache rows discarded. Downloads / users / watch-progress tables untouched. |
| Identity | Movie identity flips from YTS URL → **TMDB numeric id**. Frontend `/movies/[id]` route's `id` becomes the tmdb id. |

## New API — verified facts

Base = `settings.yify_url_browse_url` (`https://en.yts.lu/browse-movies`), queried with params:

| Capability | Request | Response |
| --- | --- | --- |
| Browse | `?api=popular\|top_rated&mode=movie&page=N&sort=&genre=&year=` | `{page, results:[TMDB obj], total_pages, total_results}` |
| Search | `?api=search&mode=movie&q=&page=N` | same shape |
| Torrents | `?api=torrents&name=<"Title Year">` | `{hits:[{title, seeds, peers, bytes, magnetUrl, hash, source}], total, sources}` |

- **No movie-detail-by-id endpoint** exists (only `tv_details`/`season_details`, used in Phase 2).
  Movie detail therefore comes from the cached list item + **real TMDB** enrichment by id.
- `poster_path` / `backdrop_path` are **relative** TMDB paths; prefix with
  `https://image.tmdb.org/t/p/w500` (posters) and `.../w1280` (backdrops). Verified loading.
- Torrent `hits` have **no quality field** — quality is parsed from the release `title`.
- Genre filter uses a fixed **numeric** list (below). Sort ∈
  `popularity.desc`, `vote_average.desc`, `primary_release_date.desc`, `revenue.desc`.
  Year ∈ `0` (all) or `2010`–`2026`.

Genre values (id → label): `0` All, `10759` Action & Adventure, `16` Animation,
`35` Comedy, `80` Crime, `99` Documentary, `18` Drama, `10751` Family, `9648` Mystery,
`10765` Sci-Fi & Fantasy, `10768` War & Politics, `37` Western.

## Architecture

Replace `backend/app/scrapers/` with thin **provider** clients (HTML scraping → JSON):

```
backend/app/
  providers/                 # NEW (replaces scrapers/: yts.py + dead rarbg/)
    catalog.py   # client for the new yts.lu JSON API: browse / search / torrents
    tmdb.py      # client for real TMDB (api.themoviedb.org): movie/{id}+credits
    quality.py   # pure parsers: title -> quality / codec / source / hdr
  services/
    movies.py    # REWORKED: orchestrate catalog + tmdb + cache
    torrents_select.py  # NEW: pick best torrent for a quality bucket
  api/
    movies.py    # REWORKED endpoints (tmdb-id based, slashless routes)
    torrents.py  # REWORKED download (tmdb_id + quality)
  database/models/
    catalog.py   # NEW: CatalogItem cache, unique (media_type, tmdb_id)
  models.py      # NEW pydantic schemas (below)
```

**Removed:** `scrapers/yts.py`, dead `scrapers/rarbg/*`, and the HTML-scraping + OMDB
fallbacks in `services/movies.py`'s `MovieDetailsService`.

## Components & interfaces

### `providers/catalog.py`
- `async browse(api, sort, genre, year, page) -> CatalogPage` (`api` ∈ `popular`/`top_rated`, `mode=movie`).
- `async search(q, page) -> CatalogPage`.
- `async torrents(name) -> list[TorrentHit]`.
- Keeps the existing leaky-bucket rate limiter + random user-agent + timeouts.
  Any request error → empty result + logged warning (never raises to the endpoint).
- Normalizes images to full URLs and `year` from `release_date`.

### `providers/tmdb.py`
- `async movie_details(tmdb_id) -> MovieDetail | None` → `GET /movie/{id}?append_to_response=credits`.
  Extracts runtime, genres, imdb_id, tagline, top-N cast (name/character/profile image),
  director (from crew). Images via TMDB CDN.
- If `settings.tmdb_api_key` is unset or the call fails → returns `None` (caller degrades to
  the cached `CatalogItem`).

### `providers/quality.py` (pure, unit-tested)
- `parse_quality(title) -> Literal['2160p','1080p','720p','480p'] | None`
  (`4k`/`uhd` → `2160p`; case-insensitive).
- `parse_release_info(title) -> {quality, codec, source, hdr, group}` for display.

### `services/torrents_select.py`
- `select_best(hits, quality) -> TorrentHit | None` — filter hits whose parsed quality ==
  bucket, return the one with the most seeds (ties broken by larger `bytes`). `None` if none.
- `available_qualities(hits) -> list[str]` — distinct parsed qualities present, ordered
  2160p → 1080p → 720p → 480p.

## Schemas (`models.py`)

```
CatalogItem:   tmdb_id:int, media_type:Literal['movie']='movie', title:str,
               year:Optional[int], overview:str, poster_url:Optional[str],
               backdrop_url:Optional[str], genre_ids:list[int], genres:list[str],
               vote_average:float, vote_count:int, popularity:float,
               original_language:Optional[str]
MovieDetail(CatalogItem): runtime:Optional[int], imdb_id:Optional[str],
               tagline:Optional[str], cast:list[CastMember], director:Optional[str],
               available_qualities:list[str]
TorrentHit:    title:str, seeds:int, peers:int, bytes:int, magnet:str,
               hash:str, source:str, quality:Optional[str]
CatalogPage:   page:int, results:list[CatalogItem], total_pages:int, total_results:int
MovieBrowseParams: api:Literal['popular','top_rated']='popular',
               sort:str='popularity.desc', genre:int=0, year:int=0, page:int=1
TorrentRequest (reworked): tmdb_id:int, quality:Literal['720p','1080p','2160p']='1080p',
               save_path:Optional[str]=None
```
`CastMember` reuses the existing model (`name`, `character`, `image`).

## Cache model (`database/models/catalog.py`)

`CatalogItem` ORM — unique `(media_type, tmdb_id)`. Columns: `media_type`, `tmdb_id`,
`title`, `year`, `overview`, `poster_url`, `backdrop_url`, `genre_ids` (JSON),
`vote_average`, `vote_count`, `popularity`, `original_language`, `detail_json` (JSON;
the enriched `MovieDetail`), `torrents_json` (JSON; cached `TorrentHit`s),
`fetched_at`, `detail_fetched_at`, `expires_at`. Methods: `upsert_list_item(...)`,
`get(db, media_type, tmdb_id)`, `set_detail(...)`, `set_torrents(...)`. TTL via
`settings.cache_movies_for`. Replaces the YTS `MovieCache` (table recreated on startup).

## Endpoints (`api/movies.py`, slashless collection routes)

| Method | Path | Params | Returns |
| --- | --- | --- | --- |
| GET | `/api/v1/movies` | `api, sort, genre, year, page` | `CatalogPage` |
| GET | `/api/v1/movies/search` | `q, page` | `CatalogPage` |
| GET | `/api/v1/movies/{tmdb_id}` | — | `MovieDetail` |
| GET | `/api/v1/movies/{tmdb_id}/torrents` | — | `list[TorrentHit]` (grouped) |

Removed: `/browse` (POST), `/latest`, `/top`, `/movie?url=`, `/details?movie_id=`.

**Download** (`api/torrents.py`): `POST /api/v1/torrents/download {tmdb_id, quality}` →
resolve `title`+`year` from cache; if absent, from `tmdb.movie_details(tmdb_id)` (the new API
has no fetch-by-id) → `name = f"{title} {year}"` → `catalog.torrents(name)` → parse quality
per hit →
`select_best(hits, quality)` → build internal torrent → existing
`torrent_manager.add_torrent` (unchanged). The `Torrent` DB row stores `tmdb_id` + quality +
magnet. Status / list / pause / resume / remove endpoints unchanged.

## Data flow

1. **Browse/search:** frontend → `/movies` → `catalog.browse/search` → normalize → `upsert`
   each item into cache → `CatalogPage`.
2. **Detail:** `/movies/{tmdb_id}` → cache `get`; if `detail_json` missing/stale →
   `tmdb.movie_details(id)` → store; fetch (cache) torrents to compute `available_qualities`
   → `MovieDetail`. No TMDB key → return cached `CatalogItem` fields only.
3. **Download:** `/torrents/download` → cache lookup for title/year → `catalog.torrents(name)`
   → `select_best` → `torrent_manager.add_torrent` → libtorrent.

## Frontend (movies)

- `services/movies.ts` + `types/index.ts`: repoint to the new endpoints/shapes.
- Filter UI: numeric **genre** list above; **sort** = popularity / vote_average /
  primary_release_date / revenue; **year** = 0 + 2010–2026; **popular/top-rated** toggle.
  Drop the server-side quality/rating filters (quality is a download-time choice).
- `next.config.ts`: add `image.tmdb.org` to `images.remotePatterns`. Backend returns full
  image URLs, so the frontend uses them directly.
- `/movies/[id]`: `id` = tmdb id; `MovieDetailsContent` renders the new fields (poster,
  backdrop, overview, rating, genres, runtime, cast, director) + quality buttons.
- Download call passes `{tmdb_id, quality}`.

## Error handling / degradation

- New API unreachable → endpoints return an empty `CatalogPage` (200) + logged warning;
  frontend shows an empty state.
- `tmdb_api_key` missing/failed → movie detail degrades to cached `CatalogItem` (no cast/
  runtime); endpoint still 200.
- No release in the chosen quality → download returns **422** with the list of qualities
  that *are* available.
- Unparseable quality → bucket `other`; excluded from 720/1080/2160 unless explicitly chosen.
- Null `poster_path`/`backdrop_path` → frontend placeholder.

## Testing

- **Unit:** `parse_quality` / `parse_release_info` (battery of real release titles →
  expected quality/codec/source); catalog normalizer (TMDB obj → `CatalogItem`, image
  prefixing, year-from-`release_date`); `select_best` (best-seeded in bucket, ties → larger
  bytes, empty → None); `available_qualities` ordering; name-query builder.
- **Integration (network-gated smoke):** live `browse`/`search`/`torrents` return the
  expected shapes.
- **End-to-end in the running stack:** browse → detail → download a real movie → confirm it
  appears in the torrent manager and begins downloading.

## Out of scope (Phase 2 / later)

- All TV: shows browse, `tv_details`, `season_details`, episode lists, per-episode
  download/stream, the frontend TV section, and the movie/TV toggle.
- Season-pack (multi-file) torrents.
- OMDB.
- Local image-asset caching for posters (use the TMDB CDN directly; the asset manager stays
  for avatars only).

## Follow-ups / consequences

- Existing `Torrent` / `StreamingProgress` rows that referenced the old YTS-URL/UUID movie
  identity become orphaned (acceptable for this personal app; little/no live data).
- `settings.yify_url` (singular) and `rarbg_url` become unused for movies; leave for now.
