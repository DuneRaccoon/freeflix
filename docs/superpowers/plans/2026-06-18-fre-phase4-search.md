# FRÈ Phase 4 — Search Implementation Plan

> Spec-level tasks executed implement→test→commit. Steps use `- [ ]`.

**Goal:** Replace the legacy `/search` body with the FRÈ search experience — a cinematic search hero, an All / Movies / Series type toggle, genre/year/sort filters, a results grid of FRÈ `PosterCard`s, "Load More" paging, and a "Browse by genre" empty state — reusing the Phase-3 components and the unchanged catalog services.

**Architecture:** New components under `src/components/search/` compose the existing FRÈ primitives + `PosterCard`. Data via the unchanged `moviesService`/`tvService` (`search(q,page)` for queries, `browse({...})` for filter-only browsing). A new **"All"** mode merges movie + tv results and de-dupes. URL state (`q`/`type`/`genre`/`year`/`sort`) is synced via `useSearchParams`/`router`.

**Tech Stack:** Next 15 App Router (the page keeps a `<Suspense>` boundary for `useSearchParams`) · React 19 · Tailwind v4 · FRÈ design system · Vitest + RTL.

**VISUAL TARGET:** `/Users/benjaminherro/github/freeflix/.superpowers/brainstorm/18139-1781740714/content/search-mockup.html` (search hero + result count, All/Movies/Series toggle + genre/year/sort chips, results grid, "Browse by genre" empty state).

## Global Constraints
- Stack/alias/gates as prior phases (`npm run test`, `npx tsc --noEmit`, `npm run build` from `frontend/`). Dark-only, gold precious, gold focus rings, reduced-motion already gated. Conventional Commits.
- **Reuse, don't fork:** `moviesService.search(q, page)` / `tvService.search(q, page)` → `CatalogPage`; `moviesService.browse({api,sort,genre,year,page})` / `tvService.browse({...})` → `CatalogPage`. `CatalogItem` shape as in Phase 3. Filter options `GENRE_OPTIONS` (value 0 = "All Genres"), `SORT_OPTIONS`, `YEAR_OPTIONS` (0 = all) from `@/types`. De-dupe catalog results by `tmdb_id` (and by `media_type` when mixing movie+tv).
- **Reuse FRÈ components:** `PosterCard` (`@/components/browse/PosterCard`, props `{item: CatalogItem}` — links to detail by media_type), `Button`/`Pill`/`Badge` (`@/components/ui/fre`), `Wordmark`, `cn`, `CinematicAtmosphere`. Don't re-implement cards.
- **"All" mode** (new): fetch BOTH `moviesService.search`/`browse` and `tvService.search`/`browse` for the page, merge, de-dupe by `${media_type}:${tmdb_id}`, interleave by `popularity` desc. Movies/Series modes fetch only that type.
- Pages render under the fixed TopNav (`<main>` has `pt-[72px]`); the search hero starts below the nav (normal flow, with comfortable top spacing).

## File Structure
| File | Responsibility |
| --- | --- |
| `src/lib/mergeCatalog.ts` (+test) | `mergeDedupe(pages)` + `hasMoreResults(pages)` |
| `src/lib/useSearchUrlState.ts` (+test) | URL-synced `{q,type,genre,year,sort}` state |
| `src/components/search/ResultsGrid.tsx` (+test) | responsive PosterCard grid + Load More + empty/loading |
| `src/components/search/SearchFilters.tsx` (+test) | type toggle + genre/year/sort chips |
| `src/components/search/GenreBrowse.tsx` (+test) | "Browse by genre" empty-state tiles |
| `src/components/search/SearchView.tsx` (+test) | the whole search experience (replaces SearchPageContent) |
| `src/app/search/page.tsx` | render `<SearchView>` in `<Suspense>` |

> Legacy `SearchPageContent.tsx` left on disk (unused) for the final cleanup phase.

---

### Task 1: `mergeCatalog` util
**Files:** `src/lib/mergeCatalog.ts` (+ test).
- `mergeDedupe(pages: CatalogPage[]): CatalogItem[]` — flatten `results`, de-dupe by `${media_type}:${tmdb_id}`, sort by `popularity` desc (stable).
- `hasMoreResults(pages: CatalogPage[]): boolean` — true if ANY page has `page < total_pages`.
**Tests:** dedupes a movie+tv mix (same tmdb_id different media_type kept; same media_type+tmdb_id collapsed); sorts by popularity; hasMoreResults true/false.

### Task 2: `useSearchUrlState` hook
**Files:** `src/lib/useSearchUrlState.ts` (+ test).
A client hook returning `{ state: { q:string; type:'all'|'movie'|'tv'; genre:number; year:number; sort:string }, setState(partial), }`. Initializes from `useSearchParams()` (keys `q`,`type`,`genre`,`year`,`sort`; defaults `''`/`'all'`/`0`/`0`/`''`). `setState` merges into local state AND writes the querystring via `router.replace('/search?'+params)` omitting empty/default values. SSR-safe.
**Tests:** mock `next/navigation` (`useSearchParams` returns preset params; `useRouter().replace` spy) — initial state hydrates from the URL; `setState({type:'movie'})` updates state and calls `replace` with `type=movie`.

### Task 3: `ResultsGrid`
**Files:** `src/components/search/ResultsGrid.tsx` (+ test).
Props `{ items: CatalogItem[]; isLoading?: boolean; hasMore?: boolean; onLoadMore?: () => void; emptyLabel?: string }`. A responsive grid (`grid-cols-2 sm:3 md:4 lg:5 xl:6`, gap) of `<PosterCard item key=`${item.media_type}:${item.tmdb_id}`/>`; a skeleton grid while `isLoading` and no items; an `emptyLabel` message when not loading and empty; a centered FRÈ `Button` "Load more" when `hasMore && onLoadMore`.
**Tests:** renders one PosterCard per item with detail links; shows the empty label when empty + not loading; shows "Load more" only when hasMore, and clicking it calls onLoadMore.

### Task 4: `SearchFilters`
**Files:** `src/components/search/SearchFilters.tsx` (+ test).
Props `{ type:'all'|'movie'|'tv'; genre:number; year:number; sort:string; onChange:(p: Partial<{type,genre,year,sort}>)=>void }`. Renders: a type toggle as three FRÈ `Pill`s (All / Movies / Series — `selected` reflects `type`); and Genre / Year / Sort as compact FRÈ dropdown chips (a `Pill`/button that opens a small popover list, OR a styled native `<select>` — keep it FRÈ dark, gold-on-selected) sourced from `GENRE_OPTIONS`/`YEAR_OPTIONS`/`SORT_OPTIONS`. Each control calls `onChange` with its key. Gold focus rings; aria labels.
**Tests:** the three type pills render with the active one `aria-pressed`; clicking "Series" calls `onChange({type:'tv'})`; changing the genre control calls `onChange({genre: <id>})`.

### Task 5: `GenreBrowse`
**Files:** `src/components/search/GenreBrowse.tsx` (+ test).
Props `{ onPick:(genreId:number)=>void }`. A "Browse by genre" section: a heading + a responsive grid of tiles for each `GENRE_OPTIONS` entry except value 0; each tile is a `<button>` (gold-on-hover, FRÈ) showing the genre label, calling `onPick(value)`. (This is the empty-state affordance when there's no query/filters.)
**Tests:** renders a tile per real genre (not "All Genres"); clicking a tile calls `onPick` with that genre id.

### Task 6: `SearchView`
**Files:** `src/components/search/SearchView.tsx` (+ test). (Replaces `SearchPageContent`.)
Client component composing the whole experience:
- A **search hero**: an eyebrow ("Find something to watch"), a Fraunces heading ("Search the *collection*"), and a large FRÈ search input bound to `state.q` (debounced ~300ms as-you-type), with a clear (×) button, plus a result-count line ("N results" / "N results for '<q>'") when a search/filter is active.
- `<SearchFilters>` wired to `useSearchUrlState`.
- **Body:** if `state.q` is non-empty OR any filter is set (`genre||year||sort` or `type!=='all'`-with-intent) → fetch results and render `<ResultsGrid>`; else (truly empty) → render `<GenreBrowse onPick={g=>setState({genre:g})}/>`.
- **Fetching:** depends on `state` (q/type/genre/year/sort/page). With a query → `search(q,page)` per type; without → `browse({...filters,page})` per type. For `type:'all'` fetch BOTH movie+tv and `mergeDedupe`; for movie/tv fetch that one. Accumulate pages for Load More (append + de-dupe via mergeCatalog); reset on any filter/query change. Per-call try/catch degrades to empty; a loading state drives the grid skeleton; guard setState-after-unmount.
- Wrap in `<CinematicAtmosphere/>` + a relative content layer (atmosphere behind).
**Tests:** mock `@/services/movies` + `@/services/tv` + `next/navigation`; typing a query renders matching PosterCards (movie mode); switching to "All" merges movie+tv (assert both appear, deduped); with no query + no filters, `GenreBrowse` is shown; clicking "Load more" fetches the next page and appends.

### Task 7: `search/page.tsx`
**Files:** rewrite `src/app/search/page.tsx` to render `<SearchView/>` inside a `<Suspense fallback={<SearchSkeleton/>}>` (keep a suspense boundary because `useSearchUrlState` uses `useSearchParams`). A simple FRÈ skeleton fallback (a faint hero bar + a grid of shimmer tiles) is fine inline.
**Tests:** none required beyond a render smoke (the page is a thin wrapper); `SearchView` carries the logic tests.

### Task 8: Phase gate
`npm run test` (green), `npx tsc --noEmit` (clean), `npm run build` (succeeds; `/search` builds). Tag `fre-phase4-search`.

---

## Notes for implementers
- Match the search mockup; build with the real FRÈ primitives + `PosterCard`, not the mockup CSS.
- Keep presentational components (ResultsGrid/SearchFilters/GenreBrowse) pure; data/fetch logic lives in `SearchView`.
- Debounce the query input; reset accumulated results + page on any query/type/filter change.
- Mock services + `next/navigation` in tests; use `findBy*`/`waitFor`; keep output pristine (no act warnings).
- "All" mode is the notable new behavior (merge movie+tv search/browse, de-dupe by `${media_type}:${tmdb_id}`) — test it explicitly.
