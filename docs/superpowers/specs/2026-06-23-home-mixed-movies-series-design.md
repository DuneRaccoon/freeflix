# Mixed movies + series home page — Design

**Date:** 2026-06-23
**Status:** Approved (pending spec review)
**Surface affected:** Home page only (`/`). The `/movies` and `/tv` hubs are untouched.

## Problem

The home page is movies-only. `HomeBrowse.tsx` calls `buildRailsScreen('movie', …)` — that single `'movie'` argument makes the hero, the featured strip, and every content row come from the movies feed. There is no series presence on the landing page even though the app has full TV/series support (`/tv` hub, `tvService`, series detail/streaming).

## Goal

Surface **both movies and series** on the home page, and make the page **longer**, by blending the two media types into shared rails — without disturbing the single-type `/movies` and `/tv` hubs.

## Decisions (from brainstorming)

1. **Mixed-content rails** — each content row blends movies *and* series (not separate movie/series rows, not separate sectioned bands).
2. **Mixed hero + featured strip** — the top-of-page hero and the 6 featured tiles are drawn from a combined movie+series pool, so a hit show can headline.
3. **Alternating interleave** — within each content rail, items alternate movie, series, movie, series, … (`M, S, M, S…`).

## Approach

**Frontend orchestration, in a dedicated sibling builder.** No backend changes.

The existing `buildRailsScreen(mode, …)` (`frontend/src/lib/buildRailsScreen.ts`) is built around a single `browse` service and a single-mode planner call; it is used by both the `/movies` and `/tv` hubs. Rather than thread `'mixed'` conditionals through it (and risk regressing those hubs), add a **new sibling** `buildMixedRailsScreen(userId?, surface?)` in `frontend/src/lib/buildMixedRailsScreen.ts`. It reuses the same `RailsScreen` / `RowConfig` shapes and the same `feedIdentityFromParams` / `feedIdentityFromKey` helpers, so the rendered output is structurally identical to what `BrowseScreen` already consumes.

Only `HomeBrowse.tsx` switches to the new builder:

```diff
- const screen = await buildRailsScreen('movie', currentUser?.id, 'home');
+ const screen = await buildMixedRailsScreen(currentUser?.id, 'home');
```

Everything downstream of `BrowseScreen` is already media-agnostic and needs no change (see "Untouched" below).

### Cost / trade-off

Each mixed rail fetches **both** the movie feed and the TV feed, so home issues ~2× the browse requests (≈16 parallel calls vs ~8). All are fired concurrently via `Promise.all`, so wall-clock impact is negligible. The movie+TV *popular* feeds are fetched **once** and reused for both the hero/featured pool and the "Trending This Week" rail, avoiding a duplicate pair of calls.

## Detailed design

### 1. Mixed rail set (deterministic)

Home uses a fixed, noun-free rail set (no `Movies`/`Series` suffix in titles). This extends the page from 5 rails to **8**:

| key | title | eyebrow | variant | movie params | tv params |
|---|---|---|---|---|---|
| `trending` | Trending This Week | — | poster | `{ api: 'popular' }` | `{ api: 'popular' }` |
| `top-rated` | Top Rated | Critically acclaimed | ranked | `{ api: 'top_rated' }` | `{ api: 'top_rated' }` |
| `new` | New Releases | — | poster | `{ api: 'popular', sort: 'primary_release_date.desc' }` | `{ api: 'popular', sort: 'primary_release_date.desc' }` |
| `genre-action` | Action & Adventure | Genre | poster | `{ genres: '28' }` | `{ genres: '10759' }` |
| `genre-drama` | Drama | Genre | poster | `{ genres: '18' }` | `{ genres: '18' }` |
| `genre-comedy` | Comedy | Genre | poster | `{ genres: '35' }` | `{ genres: '35' }` |
| `genre-scifi` | Sci-Fi & Fantasy | Genre | poster | `{ genres: '878' }` | `{ genres: '10765' }` |
| `genre-crime` | Crime | Genre | poster | `{ genres: '80' }` | `{ genres: '80' }` |

This is encoded as a `MixedRailSpec[]` table:

```ts
interface MixedRailSpec {
  key: string;
  title: string;
  eyebrow?: string;
  variant?: 'poster' | 'ranked';
  movieParams: BrowseParams;
  tvParams: BrowseParams;
}
```

**No `see_all_href` on mixed rails.** "See all" is ambiguous for a blended row (movies *or* series?) and there is no mixed listing page. `Row`/`RankedRow` already treat `seeAllHref` as optional and simply omit the link when absent.

### 2. Genre-ID mapping (the one gotcha)

TMDB uses **different genre IDs for movies vs TV**. Action in particular: movie genre `28` has no TV equivalent — TV uses `10759` (Action & Adventure). Sci-Fi: movie `878` (Sci-Fi) + `14` (Fantasy) map to TV `10765` (Sci-Fi & Fantasy). The per-type `movieParams` / `tvParams` columns above carry the correct IDs for each side; the table is the single source of truth for the mapping. (The existing `/tv` hub's `defaultRails` reuses movie IDs `28`/`18` for its genre rows — a pre-existing inaccuracy that is **out of scope** here and left untouched.)

### 3. Interleave helper (pure, unit-tested)

```ts
function interleave<T>(a: T[], b: T[], cap = 20): T[] {
  const out: T[] = [];
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n && out.length < cap; i++) {
    if (i < a.length) out.push(a[i]);
    if (out.length < cap && i < b.length) out.push(b[i]);
  }
  return out;
}
```

- Starts with the movie item (`a`), then alternates.
- Capped at 20 items per rail.
- **Graceful degradation:** if one feed is empty (e.g. a genre returns no TV results), the result is simply the other feed's items in order — no gaps, no errors.

### 4. Hero + featured strip (mixed pool, popularity-sorted)

```ts
const [moviePop, tvPop] = await Promise.all([
  moviesService.browse({ api: 'popular' }),
  tvService.browse({ api: 'popular' }),
]);
const pool = [...moviePop.results, ...tvPop.results]
  .sort((x, y) => (y.popularity ?? 0) - (x.popularity ?? 0));
const hero = pool[0];
const featured = pool.slice(1, 7);
```

The hero/featured pool is **sorted by `popularity`** rather than strictly alternated, so the single lead slot always shows the genuinely biggest title (movie or show) — a hot series *can* take the hero. The content rows below use strict alternation, as decided. `moviePop` / `tvPop` are reused as the source for the `trending` rail (interleaved), so no extra fetch.

### 5. Row assembly

For each `MixedRailSpec`, fetch `moviesService.browse(movieParams)` and `tvService.browse(tvParams)` (reusing the popular pair for `trending`), `interleave` the two result arrays, and emit a `RowConfig`:

```ts
{
  key: spec.key,
  title: spec.title,
  eyebrow: spec.eyebrow,
  variant: spec.variant,
  seeAllHref: undefined,
  items: interleave(movieResults, tvResults),
  feed: feedIdentityFromParams(spec.movieParams) ?? feedIdentityFromKey(spec.key),
}
```

All browse calls use `.catch(() => emptyPage)` so a single failing feed degrades that rail to the other type (or drops to empty) instead of failing the whole page — matching the existing `buildRailsScreen` resilience pattern.

## Untouched (already media-agnostic)

- **`PosterCard` / `FeaturedRail` / `Hero`** route by `item.media_type` (`/tv/{id}` vs `/movies/{id}`), so a series card inside a mixed row already links correctly. No prop changes.
- **`Row` / `RankedRow` / `BrowseScreen`** take `CatalogItem[]` regardless of type.
- **`ContinueWatchingRow`** is already media-agnostic (parses `content_id`).
- **My List row** already uses `buildWatchlistRow(watchlistItems, 'all')` on home → already shows both types.
- **`/movies` and `/tv` hubs** keep their `buildRailsScreen('movie'|'tv', …)` calls and their planner personalization — completely unaffected.

## Final home layout

```
HERO              → top title across movies+series (popularity-sorted)
FEATURED STRIP    → next 6, mixed
[ Continue Watching ]   (unchanged, already mixed)
[ My List ]             (unchanged, already 'all')
▸ Trending This Week    (M, S, M, S…)
▸ Top Rated             (ranked, mixed)
▸ New Releases          (mixed)
▸ Action & Adventure    (mixed)
▸ Drama                 (mixed)
▸ Comedy                (mixed)
▸ Sci-Fi & Fantasy      (mixed)
▸ Crime                 (mixed)
```

## Testing

- **Unit test** the pure helpers (matches the existing `*.test.ts` setup under `frontend/src/lib/`, e.g. `feedThemes/resolveFeedTheme.test.ts`):
  - `interleave`: alternates starting with movies; respects the cap; degrades to the non-empty feed when one side is empty; empty+empty → `[]`.
  - The mixed-rail genre mapping table: Action → movie `28` / tv `10759`; Sci-Fi → movie `878` / tv `10765`; Drama/Comedy/Crime symmetric.
- **Typecheck:** `npx tsc --noEmit` from `frontend/`.
- **Manual smoke:** load `/` in the running stack (`make up`, host `:3001`), confirm series posters appear in the rails and route to `/tv/{id}`, and the hero can be a show. Confirm `/movies` and `/tv` are visually unchanged.

## Out of scope (future)

- Personalized planner-driven rails on the mixed home. Today's `railsService.getRails` is per-single-mode (`'movie' | 'tv'`); the mixed home uses the deterministic rail set above. The `/movies` and `/tv` hubs retain planner personalization. A future change could add a `'mixed'`/`'home'` mode to the backend rails planner.
- Fixing the `/tv` hub's genre-ID inaccuracy (`28`/`18` movie IDs reused for TV).
- A mixed "See all" listing page.

## Files

| File | Change |
|---|---|
| `frontend/src/lib/buildMixedRailsScreen.ts` | **New.** `buildMixedRailsScreen(userId?, surface?)`, `MixedRailSpec` table, `interleave` helper. |
| `frontend/src/lib/buildMixedRailsScreen.test.ts` | **New.** Unit tests for `interleave` + genre mapping. |
| `frontend/src/components/home/HomeBrowse.tsx` | Swap `buildRailsScreen('movie', …)` → `buildMixedRailsScreen(…)`. |
