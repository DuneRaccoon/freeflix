# FRÈ Phase 5 — Detail Pages (Movie + Show) Implementation Plan

> Spec-level tasks executed implement→test→commit. Steps use `- [ ]`.

**Goal:** Replace the legacy Movie and Show (TV) detail bodies with the FRÈ design — a cinematic backdrop hero, the signature **source/quality picker** (real seed/size from the torrent provider), the Play/Download flow, cast, season selector + episode list, and a "More Like This" row — preserving the exact existing download→stream mechanism.

**Architecture:** Keep `app/movies/[id]/page.tsx` and `app/tv/[id]/page.tsx` as **server components** (SSR `generateMetadata` + initial `getDetail`/`getShow` fetch), each rendering a new **client view** (`MovieDetailView` / `ShowDetailView`) that owns interactivity. Shared detail pieces live under `src/components/detail/`. Reuse the FRÈ primitives + `PosterCard`/`Row` (More Like This). **Drop the per-movie palette extraction** — FRÈ is a fixed gold-on-ink identity, not a per-title accent (note for cleanup phase).

**Tech Stack:** Next 15 App Router (server page + client island) · React 19 · Tailwind v4 · FRÈ design system · Vitest + RTL.

**VISUAL TARGETS:** `/Users/benjaminherro/github/freeflix/.superpowers/brainstorm/18139-1781740714/content/movie-mockup.html` and `show-mockup.html`.

## Global Constraints
- Stack/alias/gates as prior phases. Dark-only, gold precious, gold focus rings, reduced-motion gated. Conventional Commits.
- **PRESERVE THE PLAY/DOWNLOAD FLOW EXACTLY** (do not reinvent it):
  - Play: `handleCatalogStreamingStart(request)` from `@/utils/streaming` (it calls `torrentsService.downloadCatalogMovie(request)` then `torrentsService.prioritizeForStreaming(status.id)` and returns the `TorrentStatus`); then `router.push('/streaming/' + status.id)`. The detail page does NOT predict `file_index` (the player route handles multi-file).
  - Download (no nav): `torrentsService.downloadCatalogMovie(request)` + a toast.
  - `request: CatalogTorrentRequest = { tmdb_id, quality: '720p'|'1080p'|'2160p', media_type?: 'movie'|'tv', season?, episode? }`. Movies: `{tmdb_id, quality}`. Episodes: `{tmdb_id: showId, quality, media_type:'tv', season, episode}`. Season pack: `{tmdb_id, quality, media_type:'tv', season}` (no episode).
  - `content_id` is backend-derived — the detail page never builds it.
- **Data (reuse):** `moviesService.getDetail(tmdbId) → MovieDetail` (extends CatalogItem; adds `runtime`, `imdb_id`, `tagline`, `director`, `cast: CastMember[] {name,character,image}`, `available_qualities: string[]`). `moviesService.getTorrents(tmdbId) → TorrentHit[] {title, seeds, peers, bytes, magnet, hash, source, quality}`. `tvService.getShow(tmdbId) → ShowDetail` (`name`, `status`, `number_of_seasons`, `first/last_air_date`, `seasons: SeasonSummary[]`; NO cast field). `tvService.getSeason(tmdbId, season) → SeasonDetail {episodes: Episode[] {episode_number, name, overview, runtime, still_url, air_date, vote_average}}`. `moviesService.browse({genre})`/`tvService.browse({genre})` for More-Like-This. All `*_url` fields are full TMDB URLs.
- **Reuse FRÈ components:** `PosterCard`, `Row` (`@/components/browse/*`), `Button`/`Pill`/`Badge`/`Progress`/`Modal` (`@/components/ui/fre`), `Wordmark`, `cn`.
- Detail pages render under the fixed TopNav (`<main>` has `pt-[72px]`); the hero bleeds to the top edge (negative top margin) like the browse Hero.

## File Structure
| File | Responsibility |
| --- | --- |
| `src/components/detail/DetailHero.tsx` (+test) | shared backdrop hero (poster inset, title, meta, tagline, logline, actions slot) |
| `src/components/detail/SourcePicker.tsx` (+test) | quality/source pills from `TorrentHit[]` (seeds + size), incl. "Auto (best)" |
| `src/components/detail/CastRow.tsx` (+test) | round cast portraits from `CastMember[]` |
| `src/components/movies/MovieDetailView.tsx` (+test) | movie detail client view (replaces MovieDetailsContent) |
| `src/app/movies/[id]/page.tsx` | server: getDetail + metadata → MovieDetailView |
| `src/components/tv/EpisodeList.tsx` (+test) | season episode list with per-episode play/download |
| `src/components/tv/ShowDetailView.tsx` (+test) | show detail client view (replaces ShowDetailsContent) |
| `src/app/tv/[id]/page.tsx` | server: getShow + metadata → ShowDetailView |

> Legacy `MovieDetailsContent.tsx` / `ShowDetailsContent.tsx` left on disk for the final cleanup phase.

---

### Task 1: `DetailHero`
**Files:** `src/components/detail/DetailHero.tsx` (+test).
Props `{ title:string; backdropUrl:string|null; posterUrl:string|null; year:number|null; rating:number; genres:string[]; metaItems?:string[] /* e.g. runtime, cert, status */; tagline?:string|null; overview:string|null; eyebrow?:string; children?:React.ReactNode /* actions/picker slot */ }`. Renders a full-bleed backdrop (with `ff-kenburns` + AA scrims), a 2:3 poster inset, an eyebrow, a HUGE Fraunces title, a meta row (year · metaItems · up to 3 genres · gold star `rating.toFixed(1)`), an optional Fraunces-italic tagline, a 2–3 line logline, and the `children` slot beneath. Bleeds under the nav (negative top margin). Null-safe images (placeholder). Match the mockup hero.
**Tests:** renders title, rounded rating, overview, genres, and the children; null backdrop/poster → no broken img.

### Task 2: `SourcePicker`
**Files:** `src/components/detail/SourcePicker.tsx` (+test).
Props `{ hits: TorrentHit[]; value:string; onChange:(quality:string)=>void; fallbackQualities?:string[] }`. Renders an "Auto (best)" `Pill` (selected when `value==='auto'`) plus a `Pill` per quality present in `hits` (group hits by `quality`; for each show the best hit's `seeds` + humanized `bytes`, e.g. "1080p · 2.1 GB · 1.2k"). If `hits` is empty, render plain pills from `fallbackQualities` (no seed/size). Selected pill is gold. Each calls `onChange(quality)`. Include a small `humanizeBytes(n)` helper in this file.
**Tests:** with hits across 720p/1080p renders Auto + those pills with seed/size text; clicking a pill calls `onChange` with that quality; empty hits + fallbackQualities renders plain pills.

### Task 3: `CastRow`
**Files:** `src/components/detail/CastRow.tsx` (+test).
Props `{ cast: CastMember[] }` (`{name, character, image}`). A horizontal scroll row (reuse the `Row` look or a simple scroll track) of round portraits (`image` with `object-cover`, fallback to an initial placeholder) with name + character below. Returns null if cast is empty. Section title "Cast".
**Tests:** renders a portrait + name + character per member; null `image` → initial placeholder, no broken img; empty cast → renders nothing.

### Task 4: `MovieDetailView`
**Files:** `src/components/movies/MovieDetailView.tsx` (+test). (Replaces MovieDetailsContent.)
Client component, props `{ movie: MovieDetail }`. On mount, fetch `moviesService.getTorrents(movie.tmdb_id)` (degrade to [] on error) for the SourcePicker. Compose `<DetailHero ...movie fields, metaItems=[runtime?+'m', cert?]>` with children = `<SourcePicker hits value onChange fallbackQualities={movie.available_qualities}/>` + actions: a champagne **Play** (`Button` primary), a glass **Download**, a `+` My List icon (no-op placeholder). Below: an Overview block (logline + Director credit), `<CastRow cast={movie.cast}/>`, and a **More Like This** `<Row>` of `PosterCard`s (fetch `moviesService.browse({genre: movie.genre_ids?.[0]})`, exclude the movie itself).
- **Play** (`quality`): resolve `quality` — if `'auto'`, pick the best (the quality whose best hit has the most `seeds`; tie → higher resolution; if no hits, the highest of `available_qualities`). Then `const status = await handleCatalogStreamingStart({ tmdb_id: movie.tmdb_id, quality })`; if `status?.id` → `router.push('/streaming/' + status.id)`; toast on error.
- **Download**: `await torrentsService.downloadCatalogMovie({ tmdb_id: movie.tmdb_id, quality })` + toast.
Default `value='auto'`. Wrap content in a relative layer; the page already mounts the shell + atmosphere.
**Tests:** mock `@/services/movies` (getTorrents, browse), `@/services/torrents`, `@/utils/streaming` (handleCatalogStreamingStart), `next/navigation` (useRouter). Renders the hero (title/rating/overview) + source pills from getTorrents; clicking Play (with a selected quality) calls `handleCatalogStreamingStart` with `{tmdb_id, quality}` and `router.push('/streaming/<id>')`; clicking Download calls `downloadCatalogMovie`; More Like This renders PosterCards.

### Task 5: `movies/[id]/page.tsx`
**Files:** rewrite `src/app/movies/[id]/page.tsx`.
Keep it a server component: keep `generateMetadata` (uses `getDetail`), fetch `const movie = await moviesService.getDetail(Number(id))` (keep the existing not-found handling), and render `<MovieDetailView movie={movie}/>`. Remove the legacy `MovieDetailsContent` import + palette wiring.
**Tests:** none required (thin server wrapper; the view carries logic tests) — just ensure the build/tsc pass.

### Task 6: `EpisodeList`
**Files:** `src/components/tv/EpisodeList.tsx` (+test).
Props `{ showId:number; seasonNumber:number; episodes: Episode[] }`. A vertical list; each row: `still_url` (16:9, null-safe), an `S{seasonNumber}·E{episode_number}` label + `name`, a meta line (`runtime`m · `air_date` · gold `vote_average`), an expandable `overview`, a per-episode quality `Pill`/select (from a small fixed set `['1080p','720p','2160p']` or `available`? use `['Auto','720p','1080p','2160p']`), and **Play** + **Download** buttons.
- Play(quality): resolve auto→'1080p' (or best); `const s = await handleCatalogStreamingStart({ tmdb_id: showId, quality, media_type:'tv', season: seasonNumber, episode: episode.episode_number })`; `router.push('/streaming/' + s.id)`.
- Download: `downloadCatalogMovie({ tmdb_id: showId, quality, media_type:'tv', season: seasonNumber, episode: episode.episode_number })` + toast.
**Tests:** mock services/router; renders a row per episode with the S·E label + name; Play on an episode calls `handleCatalogStreamingStart` with the correct `{tmdb_id:showId, media_type:'tv', season, episode}` and navigates.

### Task 7: `ShowDetailView`
**Files:** `src/components/tv/ShowDetailView.tsx` (+test). (Replaces ShowDetailsContent.)
Client, props `{ show: ShowDetail }`. `<DetailHero title={show.name} ... metaItems=[`${show.number_of_seasons} Seasons`, show.status] tagline=null overview={show.overview}>` with children = actions: a **Play** (resolves to the first season's first episode, or a "Play S1·E1" — call `handleCatalogStreamingStart({tmdb_id, quality:'1080p', media_type:'tv', season:1, episode:1})` → push), a glass **Download Season** (downloads the selected season pack: `downloadCatalogMovie({tmdb_id, quality, media_type:'tv', season})`), + My List placeholder. Then a **season selector** (`Pill` per `show.seasons` `season_number`); on select, `tvService.getSeason(show.tmdb_id, season)` (cache per season; loading state) → `<EpisodeList showId={show.tmdb_id} seasonNumber={season} episodes={...}/>`. A note "Season pack · streams the selected episode". Then a **More Like This** `<Row>` of `PosterCard`s (`tvService.browse({genre: show... genre id})` — ShowDetail lacks genre_ids; use a genre lookup from `show.genres[0]` via GENRE_OPTIONS label→value, or skip if unmappable). No cast row (ShowDetail has no cast).
**Tests:** mock `@/services/tv` (getSeason, browse), torrents/streaming/router; renders the hero (name, seasons/status meta); selecting a season fetches getSeason and renders the EpisodeList; Download Season calls `downloadCatalogMovie` with `{media_type:'tv', season}`.

### Task 8: `tv/[id]/page.tsx`
**Files:** rewrite `src/app/tv/[id]/page.tsx`.
Server component: keep `generateMetadata`/`getShow`, render `<ShowDetailView show={show}/>`. Remove the legacy `ShowDetailsContent` import + palette wiring.
**Tests:** none required (thin wrapper).

### Task 9: Phase gate
`npm run test` (green), `npx tsc --noEmit` (clean), `npm run build` (succeeds; `/movies/[id]`, `/tv/[id]` build). Tag `fre-phase5-detail`.

---

## Notes for implementers
- Match the movie/show mockups; build with real FRÈ primitives + `PosterCard`/`Row`, not the mockup CSS.
- The PLAY/DOWNLOAD flow is load-bearing — reuse `handleCatalogStreamingStart` and `torrentsService.downloadCatalogMovie` EXACTLY as the legacy `MovieDetailsContent`/`ShowDetailsContent` did; the only change is the UI around it. Never construct `content_id` or guess `file_index`.
- Keep the pages server components (SSR metadata + fetch); the views are client islands.
- Mock `@/services/*`, `@/utils/streaming`, `next/navigation` in tests; use `findBy*`/`waitFor`; keep output pristine.
