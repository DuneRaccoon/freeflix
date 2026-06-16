# TV Support — Design (Phase 2)

**Date:** 2026-06-16
**Status:** Approved (design), pending spec review
**Branch:** `feat/tv-support`
**Builds on:** the Phase 1 catalog migration (providers, `CatalogItemCache`, quality parser, torrent selector, libtorrent download, streaming).

## Problem / Goal

Phase 1 moved **movies** to the new TMDB-shaped catalog API. Phase 2 adds **TV**: browse
shows, view seasons/episodes, download & stream individual episodes **and whole-season
packs**, with show-level "continue watching". The new API already exposes everything needed
for TV; the work is thin on the backend (new endpoints over the existing providers) and
larger on the frontend (a dedicated TV section), plus generalizing two things currently
hardwired to "one movie = one torrent = one file": **streaming** (single-file) and
**watch-progress** (one identity per torrent).

## Decisions (confirmed with user)

| Decision | Choice |
| --- | --- |
| Frontend IA | **Dedicated TV section** (`/tv` browse, `/tv/[id]` show detail); movie pages stay movie-only; `/search` gets a Movies/TV toggle. |
| Granularity | **Episode-by-episode AND season packs** (multi-file). |
| Continue-watching | **Show-level** ("Up next SxEy") on the home page. |
| TV detail source | Self-contained on the **new API** (`tv_details`/`season_details` are already rich); no real-TMDB needed. |
| Delivery | One spec; **three implementation plans** — Stage A (TV core), Stage B (season packs), Stage C (continue-watching). |

## New API — verified facts (live)

Base = `settings.yify_url_browse_url`. All `mode=tv`:

| Capability | Request | Response |
| --- | --- | --- |
| Browse | `api=popular\|on_the_air\|airing_today&mode=tv&sort=&genre=&year=&page=` | `{page, results:[TMDB show], total_pages, total_results}` (show: `id`, `name`, `first_air_date`, `genre_ids`, `poster_path`, `backdrop_path`, `vote_average`, `overview`) |
| Search | `api=search&mode=tv&q=&page=` | same shape |
| Show detail | `api=tv_details&mode=tv&id=` | `{id, name, overview, poster_path, backdrop_path, genres:[{id,name}], status, first_air_date, last_air_date, number_of_seasons, vote_average, seasons:[{season_number, episode_count, name, overview, poster_path, air_date}], created_by, networks}` |
| Season | `api=season_details&mode=tv&id=&season=` | `{season_number, name, overview, episodes:[{episode_number, name, overview, runtime, still_path, air_date, vote_average}]}` |
| Episode torrents | `api=torrents&mode=tv&name="{show} SxxEyy"` | `{hits:[{title, seeds, peers, bytes, magnetUrl, hash, source}]}` — quality parsed from titles |
| Season-pack torrents | `api=torrents&mode=tv&name="{show} S{ss}"` (or `"… Season {n}"`) | hits, typically multi-file releases |

The genre filter uses the same numeric list as movies (it is in fact the TMDB **TV** genre
set: `10759`, `10765`, `10768`, etc.).

## Identity scheme

- **Show**: `tmdb_id`, cached in `CatalogItemCache` with `media_type='tv'`. `CatalogItem.title`
  holds the show `name`; `year` from `first_air_date`.
- **content_id** (uniform watch identity): `movie:{tmdb_id}` for movies,
  `tv:{show_tmdb_id}:s{season}:e{episode}` for episodes. Stored in the existing
  `UserStreamingProgress.movie_id` string column (no schema change to that column). The movie
  video-player is updated to send `movie:{tmdb_id}` instead of the title (small, unifying).
- **Playback location**: `torrent_id` + optional `file_index`. Single-episode torrents use the
  main (largest) video file; season packs select the episode's file by index.

## Architecture (reuses Phase 1 seams)

Reused unchanged: `providers/quality.py` (quality parsing), `services/torrents_select.py`
(best-seeded pick), the libtorrent `torrent_manager.add_torrent` download path, and the
streaming byte-range machinery. Extended: `providers/catalog.py` (add `mode` + tv calls),
`api/torrents.py` (episode/pack download), `api/streaming.py` + `torrent_manager`
(multi-file), `UserStreamingProgress` (add `file_index`).

```
backend/app/
  providers/
    catalog.py     # + mode param on browse/search; + tv_details(id), season_details(id, season)
    episodes.py    # NEW: parse_episode(filename) -> (season, episode) | None
  services/
    tv.py          # NEW: browse_tv / search_tv / show_detail / season_detail orchestration
  api/
    tv.py          # NEW: /tv, /tv/search, /tv/{id}, /tv/{id}/season/{n}, episode torrents
    torrents.py    # extend download: media_type/season/episode/pack
    streaming.py   # + optional file_index; + GET /{torrent_id}/files (episode-labeled)
  torrent/manager.py  # + get_video_files(torrent_id) -> list (generalize get_video_file_info)
  database/models/streaming.py  # + file_index column (nullable)
  models.py        # + ShowDetail, SeasonSummary, SeasonDetail, Episode schemas
frontend/src/
  app/tv/page.tsx, app/tv/[id]/page.tsx          # browse + show detail
  app/streaming/[id]/page.tsx                    # + ?file=N
  components/tv/*                                 # show hero, season tabs, episode rows
  components/search/SearchPageContent.tsx        # + Movies/TV toggle
  components/home/ContinueWatchingSection.tsx    # + show grouping ("Up next")
  components/ui/Navigation.tsx                    # + "TV Shows"
  services/tv.ts, services/streaming.ts          # tv methods; file_index + content_id
  types/index.ts                                 # Show/Season/Episode types
```

## Schemas (new pydantic)

```
SeasonSummary: season_number:int, name:str, episode_count:int, overview:Optional[str],
               poster_url:Optional[str], air_date:Optional[str]
ShowDetail:    tmdb_id:int, media_type:Literal['tv']='tv', name:str, year:Optional[int],
               overview:Optional[str], poster_url, backdrop_url, genres:list[str],
               status:Optional[str], first_air_date, last_air_date,
               number_of_seasons:int, vote_average:float, vote_count:int,
               seasons:list[SeasonSummary]
Episode:       episode_number:int, name:str, overview:Optional[str], runtime:Optional[int],
               still_url:Optional[str], air_date:Optional[str], vote_average:float
SeasonDetail:  season_number:int, name:str, overview:Optional[str], episodes:list[Episode]
```
TV list items reuse `CatalogItem` (`media_type='tv'`, `title=name`).

`TorrentRequest` extended (back-compatible): `{tmdb_id:int, quality, save_path?,
media_type:Literal['movie','tv']='movie', season:Optional[int]=None,
episode:Optional[int]=None}`. Rules: movie → name `"Title Year"`; tv + season + episode →
`"Show SxxEyy"`; tv + season + no episode → season pack `"Show S{ss}"`.

`UserStreamingProgress`: add `file_index:Optional[int]` (nullable). Episode progress keyed by
`(user_id, movie_id=content_id)`; `file_index` records which file in a pack.

## Endpoints

| Method | Path | Returns |
| --- | --- | --- |
| GET | `/api/v1/tv?api=&sort=&genre=&year=&page=` | `CatalogPage` (tv items) |
| GET | `/api/v1/tv/search?q=&page=` | `CatalogPage` |
| GET | `/api/v1/tv/{tmdb_id}` | `ShowDetail` |
| GET | `/api/v1/tv/{tmdb_id}/season/{season}` | `SeasonDetail` |
| GET | `/api/v1/tv/{tmdb_id}/season/{s}/episode/{e}/torrents` | `list[TorrentHit]` |
| GET | `/api/v1/tv/{tmdb_id}/season/{s}/torrents` | `list[TorrentHit]` (season pack) |
| POST | `/api/v1/torrents/download` (extended) | `TorrentStatus` |
| GET | `/api/v1/streaming/{torrent_id}/files` | `list[VideoFile]` (`{index,name,size,progress,season?,episode?,stream_url}`) |
| GET | `/api/v1/streaming/{torrent_id}/video?file_index=` | byte-range stream (file_index optional) |
| GET | `/api/v1/streaming/{torrent_id}/info?file_index=` | `StreamingInfo` |

Browse/search TV endpoints cache items into `CatalogItemCache` (media_type='tv'), mirroring
movies, so show detail and download can resolve the show name by id.

## Data flow

- **Browse/search TV** → `catalog.browse/search(mode='tv')` → cache → `CatalogPage`.
- **Show detail** → `catalog.tv_details(id)` → `ShowDetail` (+cache the show item).
- **Season** → `catalog.season_details(id, n)` → `SeasonDetail`.
- **Episode download** → resolve show name from cache (or `tv_details`) → name `"Show SxxEyy"`
  → `catalog.torrents(name)` → `select_best(quality)` → `add_torrent` → `torrent_id`.
- **Season-pack download** → name `"Show S{ss}"` → select best pack → `add_torrent`. After
  metadata resolves, `get_video_files` lists files; `parse_episode(filename)` labels each.
- **Stream** → `/streaming/{torrent_id}/video?file_index=N`; movies/single-episode omit
  `file_index` (defaults to largest file — unchanged behavior).
- **Progress** → player POSTs `{torrent_id, movie_id=content_id, file_index?, current_time,
  percentage, …}`; keyed on `(user, content_id)`.
- **Continue-watching** → home reads recent progress, parses `tv:` content_ids, groups by
  show, and surfaces the next episode after the most-recently-watched.

## Stages (each its own implementation plan)

- **Stage A — TV core:** schemas, `providers.catalog` tv calls + `mode`, `services/tv.py`,
  `api/tv.py`, episode (single-file) download via extended `TorrentRequest`, and the frontend
  TV section (`/tv` browse, `/tv/[id]` show detail with seasons/episodes, search toggle, nav
  item). Reuses existing single-file streaming for single-episode torrents. **Outcome: TV
  browse → show → episode → download → stream works.**
- **Stage B — Season packs:** `torrent_manager.get_video_files`, `providers/episodes.py`,
  `api/streaming.py` `file_index` + `/files`, season-pack download, `/streaming/[id]?file=N`,
  and the "Download whole season" + per-file episode playback UI.
- **Stage C — Continue-watching:** `UserStreamingProgress.file_index`, `content_id` for movies
  + episodes, the player change, and the home "Up next" show-grouping UI.

## Error handling

- API/network failures → empty results (logged), mirroring movies.
- No release found for an episode/quality → `422` listing available qualities.
- `parse_episode` miss → file labeled "unknown" (still streamable by index).
- `file_index` out of range / non-video → `404`.
- Season with no episodes / show not found → `404`.

## Testing

- **Unit:** TV normalizers (`tv_details`/`season_details`/list → schemas, image prefixing,
  year from `first_air_date`); `parse_episode` (battery of real episode/pack filenames →
  (season, episode), incl. `S01E02`, `1x02`, `Season 1`, no-match); episode name-query
  builder; `get_video_files` selection/labeling (mocked file list); continue-watching
  "next episode" logic (content_id parse + grouping).
- **Live/integration:** TV browse → show detail → season → episode torrents; episode download
  → stream; season-pack download → `/files` lists episode-labeled files → stream a file_index.
- **Browser e2e** per stage (TV browse, show/season/episode, season pack playback,
  continue-watching "Up next").

## Out of scope / follow-ups

- Cross-show recommendations, watchlists, episode air-date notifications.
- Subtitles handling beyond what exists for movies.
- Real-TMDB enrichment for TV (not needed — the catalog `tv_details` is already rich).
- Migrating historical movie progress rows to the new `content_id` form (new rows use it;
  old rows remain by title and still resolve via the existing torrent-id lookup).
