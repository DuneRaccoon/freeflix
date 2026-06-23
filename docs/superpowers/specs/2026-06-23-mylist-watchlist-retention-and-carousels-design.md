# My List: fix saved-data retention + type-aware carousels

**Date:** 2026-06-23
**Status:** Approved design — ready for implementation planning
**Area:** `backend/app` (watchlist) + `frontend/src` (My List page, browse carousels)

## Problem

Three related issues with the saved-items ("My List") feature:

1. **Saved items lose their metadata.** On the My List page, saved movies render with a
   placeholder poster, a meaningless `0.0` rating, and no year. The data was never
   retained — it is not a rendering bug.
2. **No way to surface the list elsewhere.** The user wants the saved list to also appear
   as a carousel on the Home, Movies, and Series pages.
3. **No type separation.** Both movies and TV series go into one undifferentiated list.
   The Movies page carousel should show only movies, the Series page only series, and the
   Home page both — and the page (currently routed at `/my-movies`) should be renamed to
   `/my-list`.

## Root cause (issue 1)

The metadata is lost at **two layers**:

1. **Save persists only an identity.** `WatchlistItemCreate`
   (`frontend/src/services/watchlist.ts:4-9`) carries only `content_id`, `tmdb_id`,
   `media_type`, `title`. The four save call sites all send exactly that. The ORM model
   `UserWatchlist` (`backend/app/database/models/watchlist.py:21-37`) stores only those
   columns — `poster_url`, `year`, `vote_average` are never sent and never stored.
2. **The render adapter hardcodes empties.** `watchlistItemToCatalogItem`
   (`frontend/src/components/my-movies/MyListView.tsx:32-48`) sets `poster_url: null`,
   `vote_average: 0`, `year: null`, so even if data existed the page would discard it.

`PosterCard` itself is correct (`poster_url ?? PLACEHOLDER`, `vote_average?.toFixed(1)`,
conditional year) — it is simply fed nulls/zeros.

## Decisions (locked with the user)

| Decision | Choice |
| --- | --- |
| Watchlist carousel cadence | **Always show when non-empty** (empty rows already auto-hide) |
| Existing blank saves | **Auto-heal on view** — re-fetch missing metadata from the catalog API and write it back |
| My List filter UX | **Tabs: All / Movies / Series**, default All |
| Carousel placement | **After the first popular rail** on each browse page |
| Home carousel contents | **Both** movies and TV (Movies page → movies only, Series page → series only) |
| Route rename | `/my-movies` → `/my-list`, with a redirect preserving old bookmarks |

## Design

The work is three parts, **sequenced A → B → C** because the carousels (C) render blank
placeholders until retention (A) is fixed.

### Part A — Retain saved metadata + auto-heal

**Goal:** every saved item carries `poster_url`, `year`, `vote_average`; existing blank
rows self-repair the first time they are viewed.

**Backend**

1. **`UserWatchlist` model** (`backend/app/database/models/watchlist.py`): add three
   nullable columns:
   - `poster_url = Column(String, nullable=True)`
   - `year = Column(Integer, nullable=True)`
   - `vote_average = Column(Float, nullable=True)`

   These are auto-added on next startup by `sync_columns()` (additive, nullable — no
   Alembic, per CLAUDE.md). The existing unique constraint is unaffected.
2. **Pydantic schemas** (`backend/app/models.py`):
   - `WatchlistItemCreate` (≈513-517): add optional `poster_url`, `year`, `vote_average`.
   - `WatchlistItemResponse` (≈520-530): add the same three (optional). With Pydantic
     `from_attributes`/`model_validate`, they populate from the ORM row automatically.
3. **Add endpoint** (`backend/app/api/watchlist.py:34-40`): pass the three new fields into
   the `UserWatchlist(...)` constructor.
4. **New PATCH endpoint** — `PATCH /{user_id}/{content_id}` mirroring the existing DELETE
   route shape. Accepts a partial body (`poster_url`, `year`, `vote_average`, `title`),
   finds the row via `UserWatchlist.find`, updates only provided non-null fields, commits,
   returns the updated `WatchlistItemResponse`. Used by auto-heal to persist hydrated data.

**Frontend**

5. **`services/watchlist.ts`:**
   - Extend `WatchlistItemCreate` and `WatchlistItem` with `poster_url?: string | null`,
     `year?: number | null`, `vote_average?: number | null`.
   - Add `update(userId, contentId, patch)` calling `PATCH /watchlist/{userId}/{contentId}`.
6. **Shared payload helper** — a single function that builds a `WatchlistItemCreate` from a
   `CatalogItem` (or movie/show detail object), pulling `poster_url`, `year`,
   `vote_average`. Replace the inline payload construction at all four save call sites:
   `MovieDetailView.tsx:177-188`, `ShowDetailView.tsx:149-161`, `PosterCard.tsx:118-135`,
   `Hero.tsx:120-134`. Each already holds the full object, so the data is available.
7. **Shared adapter** — extract `watchlistItemToCatalogItem` out of `MyListView` into
   `frontend/src/lib/watchlist/toCatalogItem.ts` and change it to read the stored
   `poster_url` / `year` / `vote_average` (no more hardcoded `null`/`0`). Both the My List
   page (Part B) and the carousels (Part C) import it.
8. **`WatchlistContext`:**
   - The optimistic stub inserted on `toggle()` now carries the new fields from the create
     payload, so a freshly-saved item shows its poster/rating immediately.
   - **Auto-heal:** after the watchlist loads, for any item missing `poster_url`, fetch its
     metadata from the existing catalog/detail API (`moviesService` for `media_type ===
     'movie'`, `tvService` for `'tv'`, keyed by `tmdb_id` — the same calls the detail pages
     use), patch the in-memory item so it renders correctly right away, and fire
     `watchlistService.update(...)` to persist it. Healing is idempotent and runs at most
     once per item (guarded on `poster_url` being absent). Failures are swallowed (the item
     just falls back to the placeholder, as today).

**Note on existing rows:** `sync_columns` adds columns but never backfills, so already-saved
rows start with null metadata — auto-heal (step 8) is what fills them. No separate migration.

### Part B — My List page: tabs + rename

9. **Rename route:** move `frontend/src/app/my-movies/` → `frontend/src/app/my-list/`.
10. **Redirect:** add an `async redirects()` to `next.config.ts` returning
    `{ source: '/my-movies', destination: '/my-list', permanent: true }` so the profile
    dropdown link, old bookmarks, and the "See all" link keep working during/after the
    rename.
11. **Update the 2 load-bearing hrefs:** `ProfileMenu.tsx:9` and
    `ContinueWatchingRow.tsx:227` → `/my-list`.
12. **Tabs in `MyListView.tsx`:** add a segmented control (All / Movies / Series),
    client-side `useState` defaulting to `'all'`, filtering `items` by `media_type` before
    the grid map (the single existing hook point, `MyListView.tsx:151/183`). The saved-count
    line reflects the active filter. All three tabs are always rendered and selectable;
    selecting a type with no saved items shows the existing empty state. Default is All.

The page heading, component name (`MyListView`), and testids (`my-list-view`,
`my-list-grid`) are already "My List" — no copy changes needed there.

### Part C — My List carousel on Home / Movies / Series

13. In each browse component — `HomeBrowse.tsx`, `MoviesBrowse.tsx`, `SeriesBrowse.tsx` —
    read `useWatchlist()`, convert items with the shared adapter (step 7), and build:
    ```ts
    const watchlistRow: RowConfig = {
      key: 'watchlist',
      title: 'My List',
      eyebrow: 'Your Collection',
      seeAllHref: '/my-list',
      variant: 'poster',
      items: watchlistItems
        // Movies page:  .filter(i => i.media_type === 'movie')
        // Series page:  .filter(i => i.media_type === 'tv')
        // Home page:    (no filter)
        .map(watchlistItemToCatalogItem),
    };
    ```
14. **Insert after the first popular rail:** build the rows as
    `[screen.rows[0], watchlistRow, ...screen.rows.slice(1)]`, guarding the empty-rows case
    (if `screen.rows` is empty, just `[watchlistRow]`). Pass to `<BrowseScreen rows={...}>`.
15. Empty-row auto-hide (`BrowseScreen.tsx:81`, `items.length > 0`) handles the no-saved /
    no-matching-type case, so "always show when non-empty" needs no extra guard.
16. **Theme:** `feed` is omitted → the `watchlist` key resolves to `null` → default gold
    look (free). No change to the `FeedIdentity`/registry theming model.

## Data flow (after)

```
Save (any of 4 sites)
  → shared payload helper reads CatalogItem.{poster_url,year,vote_average}
  → POST /watchlist/{user}/add  (now persists those fields)
  → UserWatchlist row stores poster_url, year, vote_average, media_type, title, …

List / render (My List page + 3 carousels)
  → GET /watchlist/{user}        (returns the stored fields)
  → WatchlistContext auto-heal: any row missing poster_url
       → fetch detail by tmdb_id → patch in memory → PATCH /watchlist/{user}/{content_id}
  → shared adapter maps stored fields → CatalogItem → PosterCard (real poster/rating/year)
```

## Testing

**Backend** (`backend/tests/`, run via `make test` — remember tests are baked into the
image; mount or rebuild for new files):
- Add persists and the response returns `poster_url`, `year`, `vote_average`.
- New PATCH updates only provided fields, leaves others intact, 404s on a missing row.
- List returns the new fields.

**Frontend** (`npx tsc --noEmit`, plus existing test setup):
- Shared adapter maps stored `poster_url`/`year`/`vote_average` (not null/0); null-safe when
  a field is missing (renders placeholder, as before).
- Tab filtering: All shows everything; Movies shows only `media_type === 'movie'`; Series
  only `'tv'`.
- Per-page carousel filtering: Home unfiltered, Movies movie-only, Series tv-only; empty
  watchlist (or no matching type) → row absent.
- `navLinks.test.ts` still passes (My List is not a primary nav link; only the route folder
  + 2 hrefs + a redirect change).

## Scope boundaries (YAGNI)

- **No** change to the `content_id` scheme, the rail/`FeedIdentity` theming model, or
  `getRails()` (the watchlist is per-user React state, injected client-side as an extra
  `RowConfig`).
- **No** custom branded accent for the watchlist row (default gold) unless requested later.
- **No** standalone backfill migration — auto-heal covers existing rows.
- **No** season/episode-level watchlist entries — saving stays show-level (`tv:{tmdb_id}`),
  unchanged.
