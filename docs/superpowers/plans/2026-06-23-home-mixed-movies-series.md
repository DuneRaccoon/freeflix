# Mixed movies + series home page — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the home page surface both movies and series by blending the two into shared "mixed" rails, hero, and featured strip — without touching the `/movies` or `/tv` hubs.

**Architecture:** Add a frontend-only sibling builder `buildMixedRailsScreen()` next to the existing `buildRailsScreen()`. For each home rail it fetches both the movie feed and the TV feed in parallel and interleaves them (movie, series, movie, series…). The hero + featured strip come from a combined movie+series *popular* pool sorted by popularity. Only `HomeBrowse.tsx` switches to the new builder; every downstream component is already media-agnostic (`PosterCard`/`Hero`/`FeaturedRail` route by `item.media_type`).

**Tech Stack:** Next.js 15 / React 19 / TypeScript, Vitest 2 (`npm run test` → `vitest run`), existing `moviesService` / `tvService` axios clients.

## Global Constraints

- Vitest tests import from `vitest` explicitly: `import { describe, it, expect } from 'vitest'` (the repo convention, even though `globals: true`). Test files: `src/**/*.test.{ts,tsx}`. The `@` alias resolves to `frontend/src`.
- Run all frontend commands from `frontend/` (e.g. `cd frontend && …`).
- SQLAlchemy / backend: **no backend changes in this plan.**
- Conventional Commits (`feat:`, `refactor:`, `fix:`, `test:`). End every commit message with the trailer:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- Rail titles on the mixed home are **noun-free** — no "Movies"/"Series" suffix (each rail blends both).
- Genre IDs differ between movies and TV (TMDB): Action movie `28` ↔ tv `10759`; Sci-Fi movie `878` ↔ tv `10765`; Drama/Comedy/Crime are `18`/`35`/`80` on both. The `MIXED_RAILS` table is the single source of truth.
- Mixed rails carry **no `seeAllHref`** ("See all" is ambiguous for a blended row; there is no mixed listing page).

## File Structure

| File | Responsibility |
|---|---|
| `frontend/src/lib/buildMixedRailsScreen.ts` | **New.** Pure helpers `interleave` + `MIXED_RAILS` table, and the `buildMixedRailsScreen()` orchestrator. One module: the mixed-home data layer. |
| `frontend/src/lib/buildMixedRailsScreen.test.ts` | **New.** Vitest unit tests for the helpers (no mocks) and the orchestrator (mocked services). |
| `frontend/src/components/home/HomeBrowse.tsx` | **Modify.** Swap `buildRailsScreen('movie', …)` → `buildMixedRailsScreen()`. |

**Note on signature:** the spec sketched `buildMixedRailsScreen(userId?, surface?)`, but the mixed home does not call the per-mode rails planner, so those params would be unused. Per YAGNI the function takes **no arguments**. (`RailsScreen` is reused from `buildRailsScreen.ts` rather than redefined.)

---

### Task 1: Pure helpers — `interleave` + `MIXED_RAILS` table

**Files:**
- Create: `frontend/src/lib/buildMixedRailsScreen.ts`
- Test: `frontend/src/lib/buildMixedRailsScreen.test.ts`

**Interfaces:**
- Consumes: `BrowseParams` from `@/types`.
- Produces:
  - `interface MixedRailSpec { key: string; title: string; eyebrow?: string; variant?: 'poster' | 'ranked'; movieParams: BrowseParams; tvParams: BrowseParams }`
  - `const MIXED_RAILS: MixedRailSpec[]`
  - `function interleave<T>(a: T[], b: T[], cap?: number): T[]`

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/lib/buildMixedRailsScreen.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { interleave, MIXED_RAILS } from './buildMixedRailsScreen';

describe('interleave', () => {
  it('alternates starting with the first list (movies)', () => {
    expect(interleave(['m1', 'm2', 'm3'], ['t1', 't2', 't3']))
      .toEqual(['m1', 't1', 'm2', 't2', 'm3', 't3']);
  });

  it('appends the remainder when lists differ in length', () => {
    expect(interleave(['m1', 'm2', 'm3'], ['t1'])).toEqual(['m1', 't1', 'm2', 'm3']);
    expect(interleave(['m1'], ['t1', 't2', 't3'])).toEqual(['m1', 't1', 't2', 't3']);
  });

  it('degrades to the non-empty list when one side is empty', () => {
    expect(interleave(['m1', 'm2'], [])).toEqual(['m1', 'm2']);
    expect(interleave([], ['t1', 't2'])).toEqual(['t1', 't2']);
    expect(interleave([], [])).toEqual([]);
  });

  it('respects the cap', () => {
    const a = Array.from({ length: 30 }, (_, i) => `m${i}`);
    const b = Array.from({ length: 30 }, (_, i) => `t${i}`);
    expect(interleave(a, b, 5)).toEqual(['m0', 't0', 'm1', 't1', 'm2']);
  });
});

describe('MIXED_RAILS', () => {
  it('maps genre ids per media type (movie vs tv differ)', () => {
    const byKey = Object.fromEntries(MIXED_RAILS.map((r) => [r.key, r]));
    expect(byKey['genre-action'].movieParams.genres).toBe('28');
    expect(byKey['genre-action'].tvParams.genres).toBe('10759');
    expect(byKey['genre-scifi'].movieParams.genres).toBe('878');
    expect(byKey['genre-scifi'].tvParams.genres).toBe('10765');
    expect(byKey['genre-drama'].movieParams.genres).toBe('18');
    expect(byKey['genre-drama'].tvParams.genres).toBe('18');
  });

  it('uses noun-free titles (no "Movies"/"Series")', () => {
    for (const rail of MIXED_RAILS) {
      expect(rail.title).not.toMatch(/movies|series/i);
    }
  });

  it('leads with trending and has a ranked top-rated rail', () => {
    expect(MIXED_RAILS[0].key).toBe('trending');
    expect(MIXED_RAILS.find((r) => r.key === 'top-rated')?.variant).toBe('ranked');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run src/lib/buildMixedRailsScreen.test.ts`
Expected: FAIL — `Failed to resolve import "./buildMixedRailsScreen"` (module does not exist yet).

- [ ] **Step 3: Create the module with the helpers**

Create `frontend/src/lib/buildMixedRailsScreen.ts`:

```ts
import { BrowseParams } from '@/types';

export interface MixedRailSpec {
  key: string;
  title: string;
  eyebrow?: string;
  variant?: 'poster' | 'ranked';
  movieParams: BrowseParams;
  tvParams: BrowseParams;
}

/**
 * Home-page rail set. Titles are noun-free ("Movies"/"Series" omitted) because
 * each rail blends both media types. TMDB genre IDs differ between movies and
 * TV, so every rail carries the correct id for each side (e.g. Action is movie
 * genre 28 but tv genre 10759). This table is the single source of truth.
 */
export const MIXED_RAILS: MixedRailSpec[] = [
  {
    key: 'trending',
    title: 'Trending This Week',
    movieParams: { api: 'popular' },
    tvParams: { api: 'popular' },
  },
  {
    key: 'top-rated',
    title: 'Top Rated',
    eyebrow: 'Critically acclaimed',
    variant: 'ranked',
    movieParams: { api: 'top_rated' },
    tvParams: { api: 'top_rated' },
  },
  {
    key: 'new',
    title: 'New Releases',
    movieParams: { api: 'popular', sort: 'primary_release_date.desc' },
    tvParams: { api: 'popular', sort: 'primary_release_date.desc' },
  },
  {
    key: 'genre-action',
    title: 'Action & Adventure',
    eyebrow: 'Genre',
    movieParams: { genres: '28' },
    tvParams: { genres: '10759' },
  },
  {
    key: 'genre-drama',
    title: 'Drama',
    eyebrow: 'Genre',
    movieParams: { genres: '18' },
    tvParams: { genres: '18' },
  },
  {
    key: 'genre-comedy',
    title: 'Comedy',
    eyebrow: 'Genre',
    movieParams: { genres: '35' },
    tvParams: { genres: '35' },
  },
  {
    key: 'genre-scifi',
    title: 'Sci-Fi & Fantasy',
    eyebrow: 'Genre',
    movieParams: { genres: '878' },
    tvParams: { genres: '10765' },
  },
  {
    key: 'genre-crime',
    title: 'Crime',
    eyebrow: 'Genre',
    movieParams: { genres: '80' },
    tvParams: { genres: '80' },
  },
];

/**
 * Interleave two lists, alternating a, b, a, b… starting with `a` (movies).
 * Stops at `cap` total items. When one list is shorter or empty, the remaining
 * items of the longer list follow in order — no gaps.
 */
export function interleave<T>(a: T[], b: T[], cap = 20): T[] {
  const out: T[] = [];
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n && out.length < cap; i++) {
    if (i < a.length && out.length < cap) out.push(a[i]);
    if (i < b.length && out.length < cap) out.push(b[i]);
  }
  return out;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/lib/buildMixedRailsScreen.test.ts`
Expected: PASS — all 7 tests green.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/buildMixedRailsScreen.ts frontend/src/lib/buildMixedRailsScreen.test.ts
git commit -m "feat(home): add mixed-rail spec table and interleave helper

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `buildMixedRailsScreen()` orchestrator

**Files:**
- Modify: `frontend/src/lib/buildMixedRailsScreen.ts`
- Test: `frontend/src/lib/buildMixedRailsScreen.test.ts`

**Interfaces:**
- Consumes:
  - `interleave`, `MIXED_RAILS` (Task 1).
  - `RailsScreen` from `@/lib/buildRailsScreen` — `{ hero?: CatalogItem; featured: CatalogItem[]; rows: RowConfig[] }`.
  - `RowConfig` from `@/components/browse/BrowseScreen` — `{ key; title; eyebrow?; seeAllHref?; items: CatalogItem[]; variant?: 'poster' | 'ranked'; feed?: FeedIdentity }`.
  - `moviesService.browse(params: BrowseParams): Promise<CatalogPage>` and `tvService.browse(...)` (same shape).
  - `feedIdentityFromParams`, `feedIdentityFromKey` from `@/lib/feedThemes`.
  - `CatalogPage` from `@/types` — `{ page; results: CatalogItem[]; total_pages; total_results }`; `CatalogItem` has a numeric `popularity`.
- Produces: `function buildMixedRailsScreen(): Promise<RailsScreen>`.

- [ ] **Step 1: Write the failing orchestrator tests**

Edit `frontend/src/lib/buildMixedRailsScreen.test.ts`. **Replace the first line** (`import { describe, it, expect } from 'vitest';`) and the import of the module with the block below — this adds `vi`/`beforeEach`, mocks the two service modules, pulls in `buildMixedRailsScreen`, and adds a `CatalogItem` factory:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/services/movies', () => ({ moviesService: { browse: vi.fn() } }));
vi.mock('@/services/tv', () => ({ tvService: { browse: vi.fn() } }));

import { interleave, MIXED_RAILS, buildMixedRailsScreen } from './buildMixedRailsScreen';
import { moviesService } from '@/services/movies';
import { tvService } from '@/services/tv';
import { CatalogItem, CatalogPage, BrowseParams } from '@/types';

function mkItem(id: number, media_type: 'movie' | 'tv', popularity: number): CatalogItem {
  return {
    tmdb_id: id,
    media_type,
    title: `${media_type}-${id}`,
    year: 2024,
    overview: '',
    poster_url: null,
    backdrop_url: null,
    genre_ids: [],
    genres: [],
    vote_average: 7,
    vote_count: 100,
    popularity,
    original_language: 'en',
  };
}

const page = (results: CatalogItem[]): CatalogPage => ({
  page: 1,
  results,
  total_pages: 1,
  total_results: results.length,
});

const isBarePopular = (p: BrowseParams) => p.api === 'popular' && !p.sort;
```

Then append this `describe` block to the same file (keep the existing `interleave` and `MIXED_RAILS` describes — they still pass unchanged):

```ts
describe('buildMixedRailsScreen', () => {
  beforeEach(() => {
    vi.mocked(moviesService.browse).mockReset();
    vi.mocked(tvService.browse).mockReset();
    vi.mocked(moviesService.browse).mockImplementation(async (p: BrowseParams) =>
      isBarePopular(p) ? page([mkItem(1, 'movie', 50), mkItem(2, 'movie', 40)]) : page([mkItem(99, 'movie', 10)]),
    );
    vi.mocked(tvService.browse).mockImplementation(async (p: BrowseParams) =>
      isBarePopular(p) ? page([mkItem(3, 'tv', 90), mkItem(4, 'tv', 30)]) : page([mkItem(98, 'tv', 5)]),
    );
  });

  it('headlines the most popular title across both feeds (a show can take the hero)', async () => {
    const screen = await buildMixedRailsScreen();
    expect(screen.hero?.tmdb_id).toBe(3);          // tv item, popularity 90
    expect(screen.hero?.media_type).toBe('tv');
    expect(screen.featured.length).toBeLessThanOrEqual(6);
  });

  it('interleaves the trending rail starting with a movie', async () => {
    const screen = await buildMixedRailsScreen();
    const trending = screen.rows.find((r) => r.key === 'trending')!;
    expect(trending.items.map((i) => i.media_type)).toEqual(['movie', 'tv', 'movie', 'tv']);
  });

  it('reuses the popular feeds for trending (no duplicate popular fetch)', async () => {
    await buildMixedRailsScreen();
    const barePopularMovieCalls = vi
      .mocked(moviesService.browse)
      .mock.calls.filter(([p]) => isBarePopular(p));
    expect(barePopularMovieCalls).toHaveLength(1);
  });

  it('queries each side with its own genre id', async () => {
    await buildMixedRailsScreen();
    expect(vi.mocked(moviesService.browse)).toHaveBeenCalledWith({ genres: '28' });
    expect(vi.mocked(tvService.browse)).toHaveBeenCalledWith({ genres: '10759' });
  });

  it('builds one row per spec, in order', async () => {
    const screen = await buildMixedRailsScreen();
    expect(screen.rows.map((r) => r.key)).toEqual(MIXED_RAILS.map((r) => r.key));
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run src/lib/buildMixedRailsScreen.test.ts`
Expected: FAIL — `buildMixedRailsScreen is not a function` / not exported (Task 1's module has no such export yet).

- [ ] **Step 3: Implement the orchestrator**

Add to the top of `frontend/src/lib/buildMixedRailsScreen.ts` (after the existing `import { BrowseParams } from '@/types';`, widen it to also import `CatalogPage`):

```ts
import { BrowseParams, CatalogPage } from '@/types';
import { RowConfig } from '@/components/browse/BrowseScreen';
import { RailsScreen } from '@/lib/buildRailsScreen';
import { moviesService } from '@/services/movies';
import { tvService } from '@/services/tv';
import { feedIdentityFromParams, feedIdentityFromKey } from '@/lib/feedThemes';
```

Then append this function to the **end** of the file (below `interleave`):

```ts
const emptyPage: CatalogPage = { page: 1, results: [], total_pages: 0, total_results: 0 };

/**
 * Build the mixed (movies + series) home screen.
 *
 * For each rail in MIXED_RAILS we fetch the movie feed and the TV feed in
 * parallel, then interleave them. The hero + featured strip come from a
 * combined movie+series *popular* pool sorted by popularity, so the single
 * lead slot is the genuinely biggest title (a hot show can headline). The
 * popular feeds are fetched once and reused for the 'trending' rail.
 */
export async function buildMixedRailsScreen(): Promise<RailsScreen> {
  const [moviePopular, tvPopular] = await Promise.all([
    moviesService.browse({ api: 'popular' }).catch(() => emptyPage),
    tvService.browse({ api: 'popular' }).catch(() => emptyPage),
  ]);

  const pool = [...moviePopular.results, ...tvPopular.results].sort(
    (a, b) => (b.popularity ?? 0) - (a.popularity ?? 0),
  );

  // Every rail except 'trending', which reuses the popular feeds above.
  const rest = MIXED_RAILS.filter((r) => r.key !== 'trending');
  const restPages = await Promise.all(
    rest.map((r) =>
      Promise.all([
        moviesService.browse(r.movieParams).catch(() => emptyPage),
        tvService.browse(r.tvParams).catch(() => emptyPage),
      ]),
    ),
  );

  const pagesByKey = new Map<string, [CatalogPage, CatalogPage]>();
  pagesByKey.set('trending', [moviePopular, tvPopular]);
  rest.forEach((r, i) => pagesByKey.set(r.key, restPages[i]));

  const rows: RowConfig[] = MIXED_RAILS.map((spec) => {
    const [moviePage, tvPage] = pagesByKey.get(spec.key) ?? [emptyPage, emptyPage];
    return {
      key: spec.key,
      title: spec.title,
      eyebrow: spec.eyebrow,
      variant: spec.variant,
      items: interleave(moviePage.results, tvPage.results),
      feed: feedIdentityFromParams(spec.movieParams) ?? feedIdentityFromKey(spec.key),
    };
  });

  return { hero: pool[0], featured: pool.slice(1, 7), rows };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/lib/buildMixedRailsScreen.test.ts`
Expected: PASS — all describes green (helpers + orchestrator).

- [ ] **Step 5: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors. (Confirms `RowConfig`/`RailsScreen` field types and the `browse` signatures line up.)

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/buildMixedRailsScreen.ts frontend/src/lib/buildMixedRailsScreen.test.ts
git commit -m "feat(home): build mixed movies+series rails, hero and featured

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Wire the home page to the mixed builder

**Files:**
- Modify: `frontend/src/components/home/HomeBrowse.tsx`

**Interfaces:**
- Consumes: `buildMixedRailsScreen()` (Task 2). No other call-site changes — `BrowseScreen`, `insertWatchlistRow`, `buildWatchlistRow(watchlistItems, 'all')`, and `showContinueWatching` stay exactly as they are.

- [ ] **Step 1: Swap the import**

In `frontend/src/components/home/HomeBrowse.tsx`, replace:

```ts
import { buildRailsScreen } from '@/lib/buildRailsScreen';
```

with:

```ts
import { buildMixedRailsScreen } from '@/lib/buildMixedRailsScreen';
```

- [ ] **Step 2: Swap the call**

In the same file, replace:

```ts
      const screen = await buildRailsScreen('movie', currentUser?.id, 'home');
```

with:

```ts
      const screen = await buildMixedRailsScreen();
```

Leave the rest of `load()` and the `useEffect` deps (`[currentUser?.id]`) unchanged — the effect still re-runs on profile switch, which is harmless and keeps the watchlist/continue-watching context fresh.

- [ ] **Step 3: Typecheck and run the full frontend test suite**

Run: `cd frontend && npx tsc --noEmit && npx vitest run`
Expected: tsc clean; all tests pass (including the existing suite — this change touches no other module's contract).

- [ ] **Step 4: Manual smoke test**

Run the stack and verify in a browser:

```bash
make up        # then open http://localhost:3001/
```

Confirm:
- The home page rails now contain **series posters interleaved with movies** (hover a series card → it links to `/tv/{id}`; a movie card → `/movies/{id}`).
- The **hero** can be a series (depends on current TMDB popularity) and the featured strip mixes both.
- `/movies` and `/tv` look **unchanged** from before.

(If the stack is already running with hot reload, just reload `http://localhost:3001/`.)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/home/HomeBrowse.tsx
git commit -m "feat(home): switch home page to mixed movies+series rails

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- Mixed-content rails (each row blends both) → Task 1 `MIXED_RAILS` + Task 2 `interleave` per row. ✓
- Alternating interleave M,S,M,S → Task 1 `interleave` (starts with movies) + tests. ✓
- Mixed hero + featured from popularity-sorted pool → Task 2 `pool` sort + `hero`/`featured` + test "a show can take the hero". ✓
- Per-media genre-ID mapping → Task 1 `MIXED_RAILS` table + tests; Task 2 test "queries each side with its own genre id". ✓
- Longer page (5 → 8 rails) → Task 1 table has 8 specs. ✓
- Reuse popular feeds for hero/featured + trending → Task 2 `pagesByKey` + test "no duplicate popular fetch". ✓
- Graceful degradation when a feed is empty → `interleave` empty-side test + `.catch(() => emptyPage)` on every fetch. ✓
- No "See all" on mixed rails → no `seeAllHref` emitted in Task 2 row map. ✓
- `/movies` and `/tv` untouched → only `HomeBrowse.tsx` changes; `buildRailsScreen` left intact (still imported by the hubs). Task 3 Step 3 runs the full suite to confirm no contract breakage. ✓
- No backend changes → none in any task. ✓

**Placeholder scan:** No TBD/TODO/"handle edge cases"/"similar to" — every code step is complete and copy-pasteable. ✓

**Type consistency:** `interleave`, `MIXED_RAILS`, `MixedRailSpec`, `buildMixedRailsScreen`, `RailsScreen`, `RowConfig`, `CatalogPage`, `emptyPage` are spelled identically across Tasks 1–3 and match the real source (`RowConfig` fields verified against `BrowseScreen.tsx:42-57`; `RailsScreen` against `buildRailsScreen.ts:10-14`). ✓
