# FRÈ Phase 3 — Browse System (Home / Movies / Series) Implementation Plan

> **For agentic workers:** spec-level tasks (precise contracts + the approved mockup as the visual target), executed implement→test→commit. Steps use `- [ ]`.

**Goal:** Replace the legacy Home and Series page bodies (and the `/movies` stub) with the FRÈ browse system — a cinematic hero billboard, the overlapping Featured rail, an episode-aware Continue Watching row, and the showcase rows (poster carousels, a Top-10 ranked row, the Spotlight row) — all wired to the existing catalog services and `ProgressContext`.

**Architecture:** New presentational components under `src/components/browse/` compose the Phase-1/2 FRÈ primitives (`@/components/ui/fre`, `Wordmark`, `cn`, the `ff-*` atmosphere/utility CSS). Data fetching stays in the page components via the unchanged `moviesService`/`tvService`/`ProgressContext`. A shared `BrowseScreen` takes a hero item + featured items + an array of row configs and renders the whole page; Home / Movies / Series are thin pages that fetch their rows and render `BrowseScreen`.

**Tech Stack:** Next 15 App Router · React 19 · Tailwind v4 · the FRÈ design system · Vitest + RTL. **No Swiper** for the new rows — use native horizontal scroll + scroll-snap (the mockup uses this).

**THE VISUAL TARGET (read it):** the approved browse mockup at
`/Users/benjaminherro/github/freeflix/.superpowers/brainstorm/18139-1781740714/content/browse-mockup-v5.html`
— it shows the exact hero, Featured rail (overlapping the hero), Continue Watching, the Trending poster row (incl. the hover-reveal), the Top-10 ranked row, and the FRÈ Spotlight row. Match its look using the real tokens/primitives.

## Global Constraints

- **Stack/alias/gates** as Phases 1–2: alias `@/* → ./src/*`; gates `npm run test` + `npx tsc --noEmit` + `npm run build` from `frontend/`. Conventional Commits. Dark-only. Gold precious. Reduced-motion already globally gated. Gold focus rings on interactive elements.
- **Reuse, don't fork, the data layer.** `moviesService.browse({api,sort,genre,year,page})` / `tvService.browse({api,...})` → `CatalogPage`. `CatalogItem` = `{ tmdb_id, media_type:'movie'|'tv', title, year:number|null, overview:string|null, poster_url:string|null, backdrop_url:string|null, genre_ids:number[], genres:string[], vote_average:number, vote_count, popularity, original_language }`. Images are FULL TMDB URLs (use directly with `next/image` or `<img>`; `image.tmdb.org` is whitelisted in `next.config.ts`). `ProgressContext` (`useProgress()`): `{ progressData: Record<movieId, StreamingProgress>, refreshProgress, updateLocalProgress, isLoading }`. `useUser()` for the active profile.
- **content_id is load-bearing** — `StreamingProgress.movie_id` is `movie:{tmdb}` or `tv:{tmdb}:s{n}:e{m}`; resume URL is `/streaming/{torrent_id}` + `?file={file_index}` when `file_index != null`. Don't change the format.
- **Cards link to detail:** movie → `/movies/{tmdb_id}`, tv → `/tv/{tmdb_id}` (by `media_type`).
- **Hero/Featured "curation" is client-derived short-term** (per the spec): featured = a slice of popular; "Top 10" = a top-rated/popular slice labelled as such; genre rows = `browse({genre})`. No backend change.
- Pages render UNDER the fixed TopNav (Phase 2 added `pt-[72px]` to the shell `<main>`) — the hero should bleed to the top edge (negative top margin to sit under the transparent nav), the rest flows normally.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `src/lib/contentId.ts` (+ test) | shared `parseContentId` / `resumeUrlFor` / `showNameFromTitle` |
| `src/components/browse/PosterCard.tsx` (+ test) | 2:3 poster card with hover-reveal |
| `src/components/browse/Row.tsx` (+ test) | labelled horizontal scroll-snap carousel (spotlight-on-hover) |
| `src/components/browse/RankedRow.tsx` (+ test) | Top-10 ranked row (editorial numerals) |
| `src/components/browse/FeaturedRail.tsx` (+ test) | large 16:9 tiles overlapping the hero |
| `src/components/browse/Hero.tsx` (+ test) | cinematic billboard from a CatalogItem |
| `src/components/browse/ContinueWatchingRow.tsx` (+ test) | FRÈ episode-aware continue-watching |
| `src/components/browse/BrowseScreen.tsx` (+ test) | composes hero + featured + continue + rows |
| `src/app/page.tsx` + `src/components/home/HomeBrowse.tsx` | Home (replaces HomePageContent) |
| `src/app/movies/page.tsx` + `src/components/movies/MoviesBrowse.tsx` | Movies hub (replaces stub) |
| `src/app/tv/page.tsx` + `src/components/tv/SeriesBrowse.tsx` | Series (replaces TvBrowseContent) |

> Legacy `home/*`, `movies/FeatureCarousel|MovieCarousel|MovieCard|MovieGrid`, `tv/TvBrowseContent|ShowGrid|ShowCard`, and the Swiper CSS are left on disk (unused after this phase) for deletion in the final cleanup phase.

---

### Task 1: `contentId` shared util
**Files:** create `src/lib/contentId.ts` + `src/lib/contentId.test.ts`.
Extract the content-id helpers (currently inline in `src/components/home/ContinueWatchingSection.tsx`) into a tested module:
- `parseContentId(movieId: string): { kind:'movie'|'tv'; showId?:number; season?:number; episode?:number }` — `tv:{id}:s{n}:e{m}` → tv parts; else movie.
- `resumeUrlFor(p: { torrent_id: string; file_index?: number|null }): string` — `/streaming/{torrent_id}` + `?file={file_index}` when set.
- `showNameFromTitle(title: string|null|undefined, showId?: number): string` — strip `" S01E03…"` suffix; fallback `Show {id}` / `Unknown Show`.
**Tests:** parse movie + tv; resume url with/without file_index; showName strip + fallbacks. (Mirror the existing logic exactly.)

### Task 2: `PosterCard`
**Files:** create `src/components/browse/PosterCard.tsx` + test.
Props `{ item: CatalogItem; className?: string }`. A 2:3 poster (`item.poster_url`, `object-cover`, rounded, hairline border) with a resting caption (title · `item.year` · gold star `vote_average.toFixed(1)`) and a HOVER/`:focus-within` reveal overlay (a 2–3 line `overview` snippet, up to ~3 genre chips from `item.genres`, and a compact action row: a gold Play button, a `+` icon, an info `<a>`). The whole card is an `<a href>` to `/movies/{tmdb_id}` (movie) or `/tv/{tmdb_id}` (tv) by `item.media_type`. Disney+-scale fluid width `clamp(184px,15.5vw,272px)`. Gold focus ring. Match the Trending card (incl. its hover-reveal) in the mockup.
**Tests:** renders title, year, rounded rating; the detail `href` matches `media_type`; the overview/genre overlay is present in the DOM. Missing `poster_url` → a graceful placeholder (no broken img).

### Task 3: `Row`
**Files:** create `src/components/browse/Row.tsx` + test.
Props `{ title: string; eyebrow?: string; seeAllHref?: string; children: React.ReactNode; className?: string }`. Renders a row header (optional gold eyebrow, Fraunces `title`, a `See all ›` `<a>` when `seeAllHref`, and prev/next circular arrow `<button>`s) above a horizontal **scroll-snap** track (`overflow-x-auto`, `scroll-snap-type:x`, the `ff-spotlight-row` class for spotlight-on-hover) containing `children`. Arrows call `scrollBy({left: ±~oneCardWidth, behavior:'smooth'})` on the track ref. Keyboard-accessible (track `tabindex`/`role="list"`). Match the row headers + spacing in the mockup.
**Tests:** renders the title + a See-all link (when href) + both arrow buttons + the children; clicking an arrow invokes `scrollBy` on the track (spy/mocked).

### Task 4: `RankedRow`
**Files:** create `src/components/browse/RankedRow.tsx` + test.
Props `{ title: string; items: CatalogItem[]; seeAllHref?: string }`. Like `Row`, but each item pairs a LARGE outlined editorial numeral (`1..items.length`, Fraunces, `-webkit-text-stroke` gold) with the item's 2:3 poster (link to detail). Match the "Top 10" row in the mockup (restraint, gold/outline numerals). Cap at 10 items.
**Tests:** renders the title; renders one numeral per item (1..n) and the posters with correct detail hrefs.

### Task 5: `FeaturedRail`
**Files:** create `src/components/browse/FeaturedRail.tsx` + test.
Props `{ items: CatalogItem[] }`. A horizontal scroll row of LARGE 16:9 tiles (`backdrop_url`, `clamp(360px,30vw,520px)` wide), each with a gold "Featured" badge, a Fraunces title overlay, a hover play affordance, linking to detail. The rail is pulled UP to overlap the hero (`margin-top: clamp(-168px,-11vh,-104px); position:relative; z-index:5`) exactly as the mockup. Returns null if `items` is empty.
**Tests:** renders a tile per item with the title + correct detail href; renders nothing when items is empty.

### Task 6: `Hero`
**Files:** create `src/components/browse/Hero.tsx` + test.
Props `{ item: CatalogItem }`. A full-bleed cinematic billboard: `item.backdrop_url` as the background (with the `ff-kenburns` slow drift), AA-contrast left+bottom scrims, a gold eyebrow ("FEATURED"), a HUGE Fraunces title (`item.title`), a meta row (`item.year` · gold star `vote_average.toFixed(1)` · up to 3 `genres`), a 2-line `overview` logline, and actions: a champagne **Play** (primary, links to detail for now — `/movies|tv/{tmdb_id}`), a glass **More Info** (links to detail), and a `+` My List icon button (no-op placeholder, TODO-Phase). Height `clamp(620px,85vh,1040px)`; bleed to the top edge under the transparent nav (negative top margin). Content lifted to `bottom: clamp(150px,19vh,250px)` so the Featured rail clears it. Match the mockup hero.
**Tests:** renders the title, the rounded rating, the overview, and a Play control; the Play/More-Info link to the correct detail route; uses `backdrop_url`.

### Task 7: `ContinueWatchingRow`
**Files:** create `src/components/browse/ContinueWatchingRow.tsx` + test.
A FRÈ redesign of `ContinueWatchingSection` (reuse its exact logic, now via the Task-1 util). Reads `useProgress()` + `useUser()`; builds display cards from `progressData` (filter `percentage>0`, sort by `last_watched_at` desc, group TV by `showId`, movies individual, cap ~6), mirroring the existing Resume-vs-Up-next rules (Up-next only when the latest episode is `completed`). 16:9 cards with a thin **gold** progress fill, a remove (✕) calling `streamingService.deleteProgress(currentUser.id, item.id)` then `refreshProgress()`, and a resume link `resumeUrlFor(item)`. Section titled "Continue Watching". Returns null when there are no in-progress items. Match the mockup's Continue Watching.
**Tests:** with a mocked `useProgress`/`useUser` providing a movie + a tv episode in progress, renders both cards, the resume `href` (`/streaming/{torrent_id}?file=N`), the gold progress, and the remove button; renders nothing when progress is empty.

### Task 8: `BrowseScreen`
**Files:** create `src/components/browse/BrowseScreen.tsx` + test.
Props `{ hero?: CatalogItem; featured?: CatalogItem[]; rows: Array<{ key:string; title:string; eyebrow?:string; seeAllHref?:string; items: CatalogItem[]; variant?: 'poster'|'ranked' }>; showContinueWatching?: boolean }`. Renders (in order): `<Hero item={hero}/>` if hero; `<FeaturedRail items={featured}/>` if featured?.length; `<ContinueWatchingRow/>` if `showContinueWatching`; then each row — `variant:'ranked'` → `<RankedRow>`, else `<Row>` containing `items.map(i => <PosterCard item={i}/>)`. Skips empty rows. This is the shared body for Home/Movies/Series.
**Tests:** given a hero + two rows (one poster, one ranked) renders the hero title + both row titles + the right number of cards/numerals; omits the FeaturedRail when featured is empty.

### Task 9: Home page
**Files:** rewrite `src/app/page.tsx` to render a new `src/components/home/HomeBrowse.tsx` (client) inside the existing Suspense; create `HomeBrowse.tsx`.
`HomeBrowse` fetches in parallel: `moviesService.browse({api:'popular'})`, `browse({api:'popular',sort:'primary_release_date.desc'})` (Latest), `browse({api:'top_rated'})`, and 1–2 genre browses (e.g. Action `10759`? use the movie GENRE_OPTIONS) — handle errors per-call (degrade to empty). Compose: `hero = popular.results[0]`; `featured = popular.results.slice(1,7)`; rows = `[{key:'trending',title:'Trending Now',items:popular.results, seeAllHref:'/movies'}, {key:'latest',title:'New Releases',items:latest.results}, {key:'top10',title:'Top 10 Movies This Week',items:top_rated.results.slice(0,10),variant:'ranked'}, ...genreRows]`; `showContinueWatching: true`. Render `<BrowseScreen .../>` with a loading skeleton while fetching. Do NOT keep the legacy quick-stats/RecentlyWatched sections.
**Tests:** mock `moviesService.browse` to resolve catalog pages; assert the hero + the row titles render (use `findBy*` for the async fetch; no act warnings).

### Task 10: Movies hub
**Files:** rewrite `src/app/movies/page.tsx` to render `src/components/movies/MoviesBrowse.tsx` (client); create it.
Movies-only browse: fetch `browse({api:'popular'})`, `browse({api:'top_rated'})`, `browse({api:'popular',sort:'primary_release_date.desc'})`, + a couple genre browses. `hero = popular[0]`, `featured = popular.slice(1,7)`, rows Trending/Top Rated(ranked)/Latest/genre. `showContinueWatching:false` (Home owns it). Render `<BrowseScreen/>`.
**Tests:** mocked service → hero + row titles render.

### Task 11: Series page
**Files:** rewrite `src/app/tv/page.tsx` to render `src/components/tv/SeriesBrowse.tsx` (client); create it.
TV browse: `tvService.browse({api:'popular'})`, `browse({api:'top_rated'})`, `browse({api:'on_the_air'})`, + genre. `hero = popular[0]` (its detail link is `/tv/{tmdb_id}`), `featured = popular.slice(1,7)`, rows Trending Series / Top Rated (ranked) / On The Air / genre. PosterCards link to `/tv/{id}` (driven by `media_type:'tv'` from the TV endpoints). `showContinueWatching:false`. Render `<BrowseScreen/>`.
**Tests:** mocked `tvService.browse` → hero + row titles render; a PosterCard links to `/tv/{id}`.

### Task 12: Phase gate (verification only)
Run `npm run test` (all green), `npx tsc --noEmit` (clean), `npm run build` (succeeds; `/`, `/movies`, `/tv` build). Tag `fre-phase3-browse`.

---

## Notes for implementers
- Build to MATCH the mockup file referenced above — open it, mirror the hero/rail/row/card structure and the gold-on-ink restraint, but use the real `@/components/ui/fre` primitives + tokens (`bg-ink`, `text-gold`, `font-display`, etc.) and `cn`, not the mockup's raw CSS.
- Use `next/image` OR plain `<img>` with the full TMDB `*_url` fields; guard nulls with a tasteful placeholder (no broken images).
- Keep presentational components pure (data in via props); fetch only in the page-level `*Browse` client components. Each `*Browse` shows a skeleton while loading and degrades gracefully if a service call fails.
- Mock `@/services/*` and `@/context/*` in tests; use `findBy*`/`waitFor` for async; keep test output pristine (no act warnings).
