# My List: Watchlist Retention + Type-Aware Carousels — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Saved items retain their poster/year/rating, the "My List" page gains All/Movies/Series tabs and a `/my-list` route, and a type-filtered "My List" carousel appears on the Home, Movies, and Series pages.

**Architecture:** Denormalise display metadata (`poster_url`, `year`, `vote_average`) onto the `user_watchlist` row at save time; lazily heal existing rows from the catalog API on load via `WatchlistContext`. Render reads come through one shared adapter. The carousel is a client-side `RowConfig` injected after the first rail in each `*Browse` component, filtered by `media_type`.

**Tech Stack:** FastAPI + SQLAlchemy 1.4 (backend), Next.js 15 / React 19 / TypeScript (frontend), Pydantic v2, Vitest + React Testing Library, Pytest.

## Global Constraints

- **SQLAlchemy 1.4 style** (not 2.0) for all ORM/query code.
- **New columns must be nullable** — `init_db()`/`sync_columns()` only ever `ADD COLUMN` (additive); no Alembic, no backfill, no constraint changes.
- **`content_id` format is unchanged**: `movie:{tmdb_id}` / `tv:{tmdb_id}` (show-level). Do not alter `buildContentId`/`parseContentId`.
- **Backend tests are baked into the image, not bind-mounted.** Run watchlist tests with the tests dir mounted: `docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest tests/test_watchlist.py -v`. App code (`backend/app`) *is* mounted, so endpoint/model edits hot-reload.
- **Frontend tests:** `cd frontend && npx vitest run <path>` for one file; `npm run test` for all. Typecheck: `npx tsc --noEmit`.
- **The My List route is `/my-list`.** `/my-movies` must redirect to it (permanent).
- The watchlist carousel uses the **default gold theme** (no `feed` identity). Do not extend the `FeedIdentity` registry.
- Conventional Commits (`feat:`, `fix:`, `refactor:`, `test:`).

---

### Task 1: Backend — persist poster/year/rating on the watchlist

**Files:**
- Modify: `backend/app/database/models/watchlist.py` (imports + 3 columns)
- Modify: `backend/app/models.py:513-530` (`WatchlistItemCreate`, `WatchlistItemResponse`)
- Modify: `backend/app/api/watchlist.py:34-40` (add-endpoint constructor)
- Test: `backend/tests/test_watchlist.py`

**Interfaces:**
- Produces: `UserWatchlist.poster_url: str|None`, `.year: int|None`, `.vote_average: float|None`; `WatchlistItemCreate`/`WatchlistItemResponse` gain optional `poster_url`, `year`, `vote_average`.

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_watchlist.py`:

```python
def test_watchlist_table_has_metadata_columns():
    cols = {c.name for c in UserWatchlist.__table__.columns}
    assert {"poster_url", "year", "vote_average"} <= cols


def test_add_persists_and_returns_metadata(client, test_user):
    resp = client.post(
        f"/api/v1/watchlist/{test_user.id}/add",
        json={
            "content_id": "movie:550",
            "tmdb_id": "550",
            "media_type": "movie",
            "title": "Fight Club",
            "poster_url": "https://image.tmdb.org/t/p/w500/fc.jpg",
            "year": 1999,
            "vote_average": 8.4,
        },
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["poster_url"] == "https://image.tmdb.org/t/p/w500/fc.jpg"
    assert data["year"] == 1999
    assert data["vote_average"] == 8.4
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest tests/test_watchlist.py::test_watchlist_table_has_metadata_columns tests/test_watchlist.py::test_add_persists_and_returns_metadata -v`
Expected: FAIL — columns missing / response has no `poster_url`.

- [ ] **Step 3: Add the ORM columns**

In `backend/app/database/models/watchlist.py`, widen the SQLAlchemy import and add three columns after `title`:

```python
from sqlalchemy import (
    Column, DateTime, Float, ForeignKey, Integer, String, UniqueConstraint, func
)
```

```python
    media_type = Column(String, nullable=False)   # "movie" | "tv"
    title = Column(String, nullable=True)

    # Denormalised display metadata (nullable; legacy rows backfilled lazily
    # via WatchlistContext auto-heal). sync_columns adds these on startup.
    poster_url = Column(String, nullable=True)
    year = Column(Integer, nullable=True)
    vote_average = Column(Float, nullable=True)
```

- [ ] **Step 4: Extend the Pydantic schemas**

In `backend/app/models.py`, replace the two watchlist schemas (lines 513-530):

```python
class WatchlistItemCreate(BaseModel):
    content_id: str
    tmdb_id: str
    media_type: str   # "movie" | "tv"
    title: Optional[str] = None
    poster_url: Optional[str] = None
    year: Optional[int] = None
    vote_average: Optional[float] = None


class WatchlistItemResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    user_id: str
    content_id: str
    tmdb_id: str
    media_type: str
    title: Optional[str] = None
    poster_url: Optional[str] = None
    year: Optional[int] = None
    vote_average: Optional[float] = None
    added_at: datetime
    created_at: datetime
```

- [ ] **Step 5: Persist the new fields on add**

In `backend/app/api/watchlist.py`, extend the `UserWatchlist(...)` constructor (lines 34-40):

```python
        entry = UserWatchlist(
            user_id=user_id,
            content_id=item.content_id,
            tmdb_id=item.tmdb_id,
            media_type=item.media_type,
            title=item.title,
            poster_url=item.poster_url,
            year=item.year,
            vote_average=item.vote_average,
        )
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest tests/test_watchlist.py -v`
Expected: PASS (all watchlist tests, including the two new ones).

- [ ] **Step 7: Commit**

```bash
git add backend/app/database/models/watchlist.py backend/app/models.py backend/app/api/watchlist.py backend/tests/test_watchlist.py
git commit -m "feat(watchlist): persist poster/year/rating on saved items"
```

---

### Task 2: Backend — PATCH endpoint to update saved metadata

**Files:**
- Modify: `backend/app/models.py` (add `WatchlistItemUpdate`)
- Modify: `backend/app/api/watchlist.py` (import + PATCH route)
- Test: `backend/tests/test_watchlist.py`

**Interfaces:**
- Produces: `PATCH /api/v1/watchlist/{user_id}/{content_id}` accepting `{title?, poster_url?, year?, vote_average?}`, returning `WatchlistItemResponse`; `WatchlistItemUpdate` schema.
- Consumes: `UserWatchlist.find` (existing), the columns from Task 1.

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_watchlist.py`:

```python
def test_patch_updates_metadata(client, test_user):
    client.post(
        f"/api/v1/watchlist/{test_user.id}/add",
        json={"content_id": "movie:680", "tmdb_id": "680",
              "media_type": "movie", "title": "Pulp Fiction"},
    )
    resp = client.patch(
        f"/api/v1/watchlist/{test_user.id}/movie:680",
        json={"poster_url": "https://image.tmdb.org/t/p/w500/pf.jpg",
              "year": 1994, "vote_average": 8.5},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["poster_url"] == "https://image.tmdb.org/t/p/w500/pf.jpg"
    assert data["year"] == 1994
    assert data["vote_average"] == 8.5


def test_patch_unknown_returns_404(client, test_user):
    resp = client.patch(
        f"/api/v1/watchlist/{test_user.id}/movie:000000",
        json={"poster_url": "x"},
    )
    assert resp.status_code == 404
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest tests/test_watchlist.py::test_patch_updates_metadata tests/test_watchlist.py::test_patch_unknown_returns_404 -v`
Expected: FAIL — PATCH route returns 405 (method not allowed).

- [ ] **Step 3: Add the update schema**

In `backend/app/models.py`, immediately after `WatchlistItemResponse`:

```python
class WatchlistItemUpdate(BaseModel):
    title: Optional[str] = None
    poster_url: Optional[str] = None
    year: Optional[int] = None
    vote_average: Optional[float] = None
```

- [ ] **Step 4: Add the PATCH endpoint**

In `backend/app/api/watchlist.py`, widen the import on line 10 and add the route (place it after the DELETE route, before the GET list route):

```python
from app.models import WatchlistItemCreate, WatchlistItemResponse, WatchlistItemUpdate
```

```python
@router.patch("/{user_id}/{content_id}", response_model=WatchlistItemResponse)
async def update_watchlist_item(
    user_id: str,
    content_id: str,
    patch: WatchlistItemUpdate,
    db: Annotated[Session, Depends(get_db)],
):
    """Patch display metadata (poster/year/rating/title) on a saved item."""
    with db as session:
        entry = UserWatchlist.find(session, user_id, content_id)
        if not entry:
            raise HTTPException(status_code=404, detail="Item not in watchlist")

        updates = patch.model_dump(exclude_unset=True)
        for field, value in updates.items():
            setattr(entry, field, value)
        session.commit()
        session.refresh(entry)
        return WatchlistItemResponse.model_validate(entry)
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest tests/test_watchlist.py -v`
Expected: PASS (whole file).

- [ ] **Step 6: Commit**

```bash
git add backend/app/models.py backend/app/api/watchlist.py backend/tests/test_watchlist.py
git commit -m "feat(watchlist): add PATCH endpoint to update saved metadata"
```

---

### Task 3: Frontend — watchlist service types + `update()`

**Files:**
- Modify: `frontend/src/services/watchlist.ts`
- Test: `frontend/src/services/watchlist.test.ts` (create)

**Interfaces:**
- Produces: `WatchlistItemCreate`/`WatchlistItem` gain `poster_url?`, `year?`, `vote_average?`; new `WatchlistItemUpdate`; `watchlistService.update(userId, contentId, patch) => Promise<WatchlistItem>`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/services/watchlist.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockPatch = vi.fn();
vi.mock('./api-client', () => ({
  default: { patch: (...a: unknown[]) => mockPatch(...a) },
}));

import { watchlistService } from './watchlist';

describe('watchlistService.update', () => {
  beforeEach(() => vi.clearAllMocks());

  it('PATCHes the URL-encoded content_id with the metadata patch', async () => {
    mockPatch.mockResolvedValue({ data: { id: 'w1', content_id: 'movie:550' } });
    await watchlistService.update('user-1', 'movie:550', { year: 1999, vote_average: 8.4 });
    expect(mockPatch).toHaveBeenCalledWith(
      '/watchlist/user-1/movie%3A550',
      { year: 1999, vote_average: 8.4 },
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest run src/services/watchlist.test.ts`
Expected: FAIL — `watchlistService.update is not a function`.

- [ ] **Step 3: Extend the types and add `update`**

In `frontend/src/services/watchlist.ts`, replace the two interfaces and add a third, then add the `update` method inside `watchlistService` (after `list`):

```ts
export interface WatchlistItemCreate {
  content_id: string;
  tmdb_id: string;
  media_type: 'movie' | 'tv';
  title?: string;
  poster_url?: string | null;
  year?: number | null;
  vote_average?: number | null;
}

export interface WatchlistItem {
  id: string;
  user_id: string;
  content_id: string;
  tmdb_id: string;
  media_type: string;
  title?: string | null;
  poster_url?: string | null;
  year?: number | null;
  vote_average?: number | null;
  added_at: string;
  created_at: string;
}

export interface WatchlistItemUpdate {
  title?: string | null;
  poster_url?: string | null;
  year?: number | null;
  vote_average?: number | null;
}
```

```ts
  /**
   * Patch display metadata (poster/year/rating/title) on a saved item.
   */
  update: async (
    userId: string,
    contentId: string,
    patch: WatchlistItemUpdate,
  ): Promise<WatchlistItem> => {
    const response = await apiClient.patch(
      `/watchlist/${userId}/${encodeURIComponent(contentId)}`,
      patch,
    );
    return response.data;
  },
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd frontend && npx vitest run src/services/watchlist.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/services/watchlist.ts frontend/src/services/watchlist.test.ts
git commit -m "feat(watchlist): add metadata fields + update() to the service client"
```

---

### Task 4: Frontend — shared watchlist adapters

**Files:**
- Create: `frontend/src/lib/watchlist/toCatalogItem.ts`
- Create: `frontend/src/lib/watchlist/toWatchlistCreate.ts`
- Test: `frontend/src/lib/watchlist/toCatalogItem.test.ts`, `frontend/src/lib/watchlist/toWatchlistCreate.test.ts`

**Interfaces:**
- Consumes: `WatchlistItem`, `WatchlistItemCreate` (Task 3); `buildContentId` (`@/lib/contentId`); `CatalogItem` (`@/types`).
- Produces: `watchlistItemToCatalogItem(item: WatchlistItem): CatalogItem`; `toWatchlistCreate(src: WatchlistSource): WatchlistItemCreate` where `WatchlistSource = { tmdb_id: number; media_type: 'movie'|'tv'; title: string; year: number|null; poster_url: string|null; vote_average: number }`.

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/lib/watchlist/toCatalogItem.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { watchlistItemToCatalogItem } from './toCatalogItem';
import type { WatchlistItem } from '@/services/watchlist';

const base: WatchlistItem = {
  id: 'w1', user_id: 'u1', content_id: 'movie:550', tmdb_id: '550',
  media_type: 'movie', title: 'Fight Club', added_at: '', created_at: '',
};

describe('watchlistItemToCatalogItem', () => {
  it('maps stored poster_url / year / vote_average onto the CatalogItem', () => {
    const c = watchlistItemToCatalogItem({ ...base, poster_url: 'p.jpg', year: 1999, vote_average: 8.4 });
    expect(c.poster_url).toBe('p.jpg');
    expect(c.year).toBe(1999);
    expect(c.vote_average).toBe(8.4);
    expect(c.tmdb_id).toBe(550);
    expect(c.media_type).toBe('movie');
    expect(c.title).toBe('Fight Club');
  });

  it('falls back to null/0 when metadata is absent (legacy rows)', () => {
    const c = watchlistItemToCatalogItem(base);
    expect(c.poster_url).toBeNull();
    expect(c.year).toBeNull();
    expect(c.vote_average).toBe(0);
  });
});
```

Create `frontend/src/lib/watchlist/toWatchlistCreate.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { toWatchlistCreate } from './toWatchlistCreate';

describe('toWatchlistCreate', () => {
  it('builds a movie payload with content_id + metadata', () => {
    const p = toWatchlistCreate({
      tmdb_id: 550, media_type: 'movie', title: 'Fight Club',
      year: 1999, poster_url: 'p.jpg', vote_average: 8.4,
    });
    expect(p).toEqual({
      content_id: 'movie:550', tmdb_id: '550', media_type: 'movie',
      title: 'Fight Club', poster_url: 'p.jpg', year: 1999, vote_average: 8.4,
    });
  });

  it('builds a tv content_id for tv sources', () => {
    const p = toWatchlistCreate({
      tmdb_id: 1399, media_type: 'tv', title: 'Game of Thrones',
      year: 2011, poster_url: null, vote_average: 8.4,
    });
    expect(p.content_id).toBe('tv:1399');
    expect(p.media_type).toBe('tv');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run src/lib/watchlist/`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement the read adapter**

Create `frontend/src/lib/watchlist/toCatalogItem.ts`:

```ts
import type { CatalogItem } from '@/types';
import type { WatchlistItem } from '@/services/watchlist';

/**
 * Convert a stored WatchlistItem into the CatalogItem shape PosterCard needs.
 * Reads the denormalised poster_url / year / vote_average persisted on the row
 * (older rows without these are healed lazily by WatchlistContext).
 */
export function watchlistItemToCatalogItem(item: WatchlistItem): CatalogItem {
  return {
    tmdb_id: Number(item.tmdb_id),
    media_type: (item.media_type as 'movie' | 'tv') ?? 'movie',
    title: item.title ?? '—',
    year: item.year ?? null,
    overview: null,
    poster_url: item.poster_url ?? null,
    backdrop_url: null,
    genre_ids: [],
    genres: [],
    vote_average: item.vote_average ?? 0,
    vote_count: 0,
    popularity: 0,
    original_language: null,
  };
}
```

- [ ] **Step 4: Implement the save helper**

Create `frontend/src/lib/watchlist/toWatchlistCreate.ts`:

```ts
import type { WatchlistItemCreate } from '@/services/watchlist';
import { buildContentId } from '@/lib/contentId';

/**
 * Minimal structural shape shared by CatalogItem / MovieDetail (and ShowDetail
 * once its `name` is mapped to `title`).
 */
export interface WatchlistSource {
  tmdb_id: number;
  media_type: 'movie' | 'tv';
  title: string;
  year: number | null;
  poster_url: string | null;
  vote_average: number;
}

/**
 * Build the create payload sent to the watchlist API, carrying display
 * metadata (poster/year/rating) so saved items retain it.
 */
export function toWatchlistCreate(src: WatchlistSource): WatchlistItemCreate {
  return {
    content_id: buildContentId({ kind: src.media_type, tmdbId: src.tmdb_id }),
    tmdb_id: String(src.tmdb_id),
    media_type: src.media_type,
    title: src.title,
    poster_url: src.poster_url,
    year: src.year,
    vote_average: src.vote_average,
  };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/lib/watchlist/`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/watchlist/
git commit -m "feat(watchlist): shared toCatalogItem + toWatchlistCreate adapters"
```

---

### Task 5: Frontend — send metadata from all four save call sites

**Files:**
- Modify: `frontend/src/components/movies/MovieDetailView.tsx:181-188`
- Modify: `frontend/src/components/tv/ShowDetailView.tsx:154-161`
- Modify: `frontend/src/components/browse/PosterCard.tsx:125-135`
- Modify: `frontend/src/components/browse/Hero.tsx:127-134`
- Test: `frontend/src/components/browse/PosterCard.test.tsx`, `frontend/src/components/browse/Hero.test.tsx`

**Interfaces:**
- Consumes: `toWatchlistCreate` (Task 4). Each call site passes the object it already holds (`movie`/`show`/`item`).

- [ ] **Step 1: Update the PosterCard + Hero tests to assert metadata flows through**

In `frontend/src/components/browse/PosterCard.test.tsx`, replace the body of the test `'calls toggle with correct content_id for a movie'` assertion:

```ts
      expect(mockToggle).toHaveBeenCalledWith(
        expect.objectContaining({
          content_id: 'movie:693134',
          media_type: 'movie',
          poster_url: 'https://image.tmdb.org/t/p/w500/test-poster.jpg',
          year: 2024,
          vote_average: 8.4,
        }),
      );
```

In `frontend/src/components/browse/Hero.test.tsx`, replace the assertion in `'calls toggle with correct content_id for a movie'`:

```ts
      expect(mockToggle).toHaveBeenCalledWith(
        expect.objectContaining({
          content_id: 'movie:693134',
          media_type: 'movie',
          poster_url: 'https://image.tmdb.org/t/p/w500/poster.jpg',
          year: 2024,
          vote_average: 8.4,
        }),
      );
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run src/components/browse/PosterCard.test.tsx src/components/browse/Hero.test.tsx`
Expected: FAIL — toggle currently receives only `{content_id, tmdb_id, media_type, title}`.

- [ ] **Step 3: Wire PosterCard**

In `frontend/src/components/browse/PosterCard.tsx`, add the import (next to the existing `buildContentId` import) and replace the `toggle({...})` call inside `handleMyList`:

```ts
import { toWatchlistCreate } from '@/lib/watchlist/toWatchlistCreate';
```

```ts
  function handleMyList(e: React.MouseEvent) {
    // Prevent the card link from firing when the button is clicked
    e.preventDefault();
    e.stopPropagation();
    toggle(toWatchlistCreate(item));
  }
```

- [ ] **Step 4: Wire Hero**

In `frontend/src/components/browse/Hero.tsx`, add the import and replace `handleMyList`:

```ts
import { toWatchlistCreate } from '@/lib/watchlist/toWatchlistCreate';
```

```ts
  function handleMyList() {
    toggle(toWatchlistCreate(item));
  }
```

- [ ] **Step 5: Wire MovieDetailView**

In `frontend/src/components/movies/MovieDetailView.tsx`, add the import and replace `handleMyList`:

```ts
import { toWatchlistCreate } from '@/lib/watchlist/toWatchlistCreate';
```

```ts
  function handleMyList() {
    toggle(toWatchlistCreate(movie));
  }
```

- [ ] **Step 6: Wire ShowDetailView**

In `frontend/src/components/tv/ShowDetailView.tsx`, add the import and replace `handleMyList`. `ShowDetail` exposes `name` (not `title`), so map it:

```ts
import { toWatchlistCreate } from '@/lib/watchlist/toWatchlistCreate';
```

```ts
  function handleMyList() {
    toggle(toWatchlistCreate({ ...show, title: show.name }));
  }
```

- [ ] **Step 7: Run the affected tests to verify they pass**

Run: `cd frontend && npx vitest run src/components/browse/PosterCard.test.tsx src/components/browse/Hero.test.tsx src/components/movies/MovieDetailView.test.tsx src/components/tv/ShowDetailView.test.tsx`
Expected: PASS (the detail-view tests mock `toggle` and don't assert its payload, so they remain green).

- [ ] **Step 8: Commit**

```bash
git add frontend/src/components/movies/MovieDetailView.tsx frontend/src/components/tv/ShowDetailView.tsx frontend/src/components/browse/PosterCard.tsx frontend/src/components/browse/Hero.tsx frontend/src/components/browse/PosterCard.test.tsx frontend/src/components/browse/Hero.test.tsx
git commit -m "feat(watchlist): send poster/year/rating from all save call sites"
```

---

### Task 6: Frontend — My List page reads stored metadata via the shared adapter

**Files:**
- Modify: `frontend/src/components/my-movies/MyListView.tsx:15-48,183-188`
- Test: `frontend/src/components/my-movies/MyListView.test.tsx`

**Interfaces:**
- Consumes: `watchlistItemToCatalogItem` (Task 4). Removes the local copy that hardcoded `null`/`0`.

- [ ] **Step 1: Write the failing test**

Add to `frontend/src/components/my-movies/MyListView.test.tsx` (inside `describe('MyListView', …)`):

```ts
  it('renders the stored poster year and rating for a saved item', () => {
    mockItems.push(
      makeItem({ content_id: 'movie:550', tmdb_id: '550', title: 'Fight Club', year: 1999, vote_average: 8.4 }),
    );
    render(<MyListView />);
    expect(screen.getAllByText('1999').length).toBeGreaterThan(0);
    expect(screen.getAllByText('8.4').length).toBeGreaterThan(0);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest run src/components/my-movies/MyListView.test.tsx`
Expected: FAIL — the local adapter discards `year`/`vote_average`, so neither `1999` nor `8.4` renders.

- [ ] **Step 3: Swap to the shared adapter**

In `frontend/src/components/my-movies/MyListView.tsx`:
1. Add the import alongside the others near the top:

```ts
import { watchlistItemToCatalogItem } from '@/lib/watchlist/toCatalogItem';
```

2. Delete the local helper block (the doc comment + `function watchlistItemToCatalogItem(...) { ... }`, lines 27-48). The call at the bottom (`watchlistItemToCatalogItem(item)`) now resolves to the imported function. Also remove the now-unused `import type { CatalogItem } from '@/types';` line if it is no longer referenced anywhere else in the file.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd frontend && npx vitest run src/components/my-movies/MyListView.test.tsx`
Expected: PASS (all MyListView tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/my-movies/MyListView.tsx frontend/src/components/my-movies/MyListView.test.tsx
git commit -m "fix(my-list): render stored poster/year/rating instead of placeholders"
```

---

### Task 7: Frontend — WatchlistContext optimistic metadata + auto-heal

**Files:**
- Modify: `frontend/src/context/WatchlistContext.tsx`
- Test: `frontend/src/context/WatchlistContext.test.tsx`

**Interfaces:**
- Consumes: `watchlistService.update` (Task 3); `moviesService.getDetail`, `tvService.getShow` (existing); `WatchlistItemUpdate`.
- Behaviour: optimistic add carries `poster_url`/`year`/`vote_average`; on load, every non-optimistic item missing `poster_url` is hydrated from the catalog API once (`healedRef`), patched in memory, and persisted via `update`.

- [ ] **Step 1: Write the failing tests**

In `frontend/src/context/WatchlistContext.test.tsx`, extend the watchlist service mock and add catalog mocks. Replace the existing `vi.mock('@/services/watchlist', …)` block and add the two service mocks beneath it:

```ts
const mockAdd = vi.fn();
const mockRemove = vi.fn();
const mockList = vi.fn();
const mockUpdate = vi.fn();

vi.mock('@/services/watchlist', () => ({
  watchlistService: {
    add: (...args: unknown[]) => mockAdd(...args),
    remove: (...args: unknown[]) => mockRemove(...args),
    list: (...args: unknown[]) => mockList(...args),
    update: (...args: unknown[]) => mockUpdate(...args),
  },
}));

const mockGetDetail = vi.fn();
const mockGetShow = vi.fn();
vi.mock('@/services/movies', () => ({
  moviesService: { getDetail: (...a: unknown[]) => mockGetDetail(...a) },
}));
vi.mock('@/services/tv', () => ({
  tvService: { getShow: (...a: unknown[]) => mockGetShow(...a) },
}));
```

Update `beforeEach` to give the heal path safe defaults:

```ts
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetDetail.mockResolvedValue({ poster_url: 'p.jpg', year: 1999, vote_average: 8.4, title: 'X' });
    mockGetShow.mockResolvedValue({ poster_url: 'p.jpg', year: 2011, vote_average: 8.4, name: 'X' });
    mockUpdate.mockResolvedValue({});
  });
```

Add two tests inside `describe('WatchlistContext', …)`:

```ts
  it('hydrates a saved item that is missing poster metadata', async () => {
    mockList.mockResolvedValueOnce([
      { id: 'w1', user_id: 'user-1', content_id: 'movie:550', tmdb_id: '550',
        media_type: 'movie', title: 'Fight Club',
        added_at: new Date().toISOString(), created_at: new Date().toISOString() },
    ]);
    mockGetDetail.mockResolvedValueOnce({ poster_url: 'fc.jpg', year: 1999, vote_average: 8.4, title: 'Fight Club' });

    renderWithProvider('movie:550');
    await waitFor(() => expect(mockGetDetail).toHaveBeenCalledWith(550));
    await waitFor(() =>
      expect(mockUpdate).toHaveBeenCalledWith('user-1', 'movie:550', {
        poster_url: 'fc.jpg', year: 1999, vote_average: 8.4, title: 'Fight Club',
      }),
    );
  });

  it('does not hydrate items that already have a poster_url', async () => {
    mockList.mockResolvedValueOnce([
      { id: 'w2', user_id: 'user-1', content_id: 'movie:551', tmdb_id: '551',
        media_type: 'movie', title: 'X', poster_url: 'already.jpg',
        added_at: new Date().toISOString(), created_at: new Date().toISOString() },
    ]);
    renderWithProvider('movie:551');
    await waitFor(() => expect(screen.getByTestId('loading').textContent).toBe('false'));
    expect(mockGetDetail).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run src/context/WatchlistContext.test.tsx`
Expected: FAIL — `mockGetDetail`/`mockUpdate` never called (no heal logic yet).

- [ ] **Step 3: Add imports + `useRef` in WatchlistContext**

In `frontend/src/context/WatchlistContext.tsx`, update the React import to include `useRef` and add the service imports:

```ts
import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { useUser } from '@/context/UserContext';
import { watchlistService, WatchlistItem, WatchlistItemCreate, WatchlistItemUpdate } from '@/services/watchlist';
import { moviesService } from '@/services/movies';
import { tvService } from '@/services/tv';
```

- [ ] **Step 4: Carry metadata on the optimistic add**

Replace the optimistic record (lines 85-94) so it keeps the new fields:

```ts
        const optimistic: WatchlistItem = {
          id: `optimistic-${item.content_id}`,
          user_id: currentUser.id,
          content_id: item.content_id,
          tmdb_id: item.tmdb_id,
          media_type: item.media_type,
          title: item.title ?? null,
          poster_url: item.poster_url ?? null,
          year: item.year ?? null,
          vote_average: item.vote_average ?? null,
          added_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
        };
```

- [ ] **Step 5: Add the auto-heal effect**

In `frontend/src/context/WatchlistContext.tsx`, insert this block after the `toggle` `useCallback` and before the `return (`:

```ts
  // Lazy backfill: older saved rows (and any save predating metadata retention)
  // have no poster_url. Hydrate them from the catalog API once, patch them in
  // memory for an immediate correct render, and persist the result so future
  // loads — and the Home/Movies/Series carousels — are correct.
  const healedRef = useRef<Set<string>>(new Set());

  async function hydrateItem(userId: string, item: WatchlistItem) {
    try {
      const tmdbId = Number(item.tmdb_id);
      let patch: WatchlistItemUpdate;
      if (item.media_type === 'tv') {
        const show = await tvService.getShow(tmdbId);
        patch = {
          poster_url: show.poster_url,
          year: show.year,
          vote_average: show.vote_average,
          title: item.title ?? show.name,
        };
      } else {
        const movie = await moviesService.getDetail(tmdbId);
        patch = {
          poster_url: movie.poster_url,
          year: movie.year,
          vote_average: movie.vote_average,
          title: item.title ?? movie.title,
        };
      }
      setItems((prev) =>
        prev.map((i) => (i.content_id === item.content_id ? { ...i, ...patch } : i)),
      );
      await watchlistService.update(userId, item.content_id, patch);
    } catch (err) {
      console.error('WatchlistContext: failed to hydrate item', item.content_id, err);
    }
  }

  useEffect(() => {
    if (!currentUser) return;
    const userId = currentUser.id;
    const needsHeal = items.filter(
      (i) =>
        !i.poster_url &&
        !i.id.startsWith('optimistic-') &&
        !healedRef.current.has(i.content_id),
    );
    if (needsHeal.length === 0) return;
    needsHeal.forEach((item) => {
      healedRef.current.add(item.content_id);
      hydrateItem(userId, item);
    });
    // hydrateItem is recreated each render but the effect intentionally depends
    // only on items + currentUser; healedRef prevents duplicate hydration.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, currentUser]);
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/context/WatchlistContext.test.tsx`
Expected: PASS (all WatchlistContext tests, including the two new heal tests).

- [ ] **Step 7: Commit**

```bash
git add frontend/src/context/WatchlistContext.tsx frontend/src/context/WatchlistContext.test.tsx
git commit -m "feat(watchlist): auto-heal saved items missing poster/year/rating"
```

---

### Task 8: Frontend — rename `/my-movies` → `/my-list` with redirect

**Files:**
- Rename: `frontend/src/app/my-movies/` → `frontend/src/app/my-list/` (page content unchanged)
- Modify: `frontend/next.config.ts` (add `redirects()`)
- Modify: `frontend/src/components/shell/ProfileMenu.tsx:9`
- Modify: `frontend/src/components/browse/ContinueWatchingRow.tsx:227`
- Test: `frontend/src/components/shell/ProfileMenu.test.tsx`

- [ ] **Step 1: Update the ProfileMenu test for the new href**

In `frontend/src/components/shell/ProfileMenu.test.tsx`, add an assertion inside the first test (`'toggles the menu and shows the power-tool links + sign out'`), after the existing `menuitem` assertions:

```ts
    expect(screen.getByRole('menuitem', { name: 'My List' })).toHaveAttribute('href', '/my-list');
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest run src/components/shell/ProfileMenu.test.tsx`
Expected: FAIL — the link still points to `/my-movies`.

- [ ] **Step 3: Rename the route folder**

```bash
git mv frontend/src/app/my-movies frontend/src/app/my-list
```

(The file `frontend/src/app/my-list/page.tsx` keeps its existing content — it already imports `MyListView` and is named `MyListPage`.)

- [ ] **Step 4: Add the redirect**

In `frontend/next.config.ts`, add a `redirects()` method immediately before `async rewrites() {`:

```ts
  async redirects() {
    return [
      { source: '/my-movies', destination: '/my-list', permanent: true },
    ];
  },
```

- [ ] **Step 5: Update the two hrefs**

In `frontend/src/components/shell/ProfileMenu.tsx`, line 9:

```ts
  { href: '/my-list', label: 'My List' },
```

In `frontend/src/components/browse/ContinueWatchingRow.tsx`, line 227:

```tsx
            href="/my-list"
```

- [ ] **Step 6: Run the test + typecheck to verify**

Run: `cd frontend && npx vitest run src/components/shell/ProfileMenu.test.tsx && npx tsc --noEmit`
Expected: PASS, no type errors. (Next.js `redirects()` is exercised at build/runtime; verify manually with `npm run dev` that visiting `/my-movies` lands on `/my-list`.)

- [ ] **Step 7: Commit**

```bash
git add frontend/src/app/my-list frontend/next.config.ts frontend/src/components/shell/ProfileMenu.tsx frontend/src/components/shell/ProfileMenu.test.tsx frontend/src/components/browse/ContinueWatchingRow.tsx
git commit -m "refactor(my-list): rename /my-movies route to /my-list with redirect"
```

---

### Task 9: Frontend — All / Movies / Series tabs on My List

**Files:**
- Modify: `frontend/src/components/my-movies/MyListView.tsx`
- Test: `frontend/src/components/my-movies/MyListView.test.tsx`

**Interfaces:**
- Adds a `ListFilter = 'all' | 'movie' | 'tv'` segmented control; the grid + count reflect the active filter. Default `'all'`.

- [ ] **Step 1: Write the failing tests**

In `frontend/src/components/my-movies/MyListView.test.tsx`, add `userEvent` to the testing-library import line:

```ts
import userEvent from '@testing-library/user-event';
```

Add these tests inside `describe('MyListView', …)`:

```ts
  it('renders All / Movies / Series tabs when items exist', () => {
    mockItems.push(makeItem({ content_id: 'movie:1', tmdb_id: '1' }));
    render(<MyListView />);
    expect(screen.getByTestId('my-list-tab-all')).toBeInTheDocument();
    expect(screen.getByTestId('my-list-tab-movie')).toBeInTheDocument();
    expect(screen.getByTestId('my-list-tab-tv')).toBeInTheDocument();
  });

  it('filters to movies when the Movies tab is selected', async () => {
    const user = userEvent.setup();
    mockItems.push(
      makeItem({ content_id: 'movie:1', tmdb_id: '1', title: 'A Movie', media_type: 'movie' }),
      makeItem({ content_id: 'tv:2', id: 'w2', tmdb_id: '2', title: 'A Series', media_type: 'tv' }),
    );
    render(<MyListView />);
    expect(screen.getAllByText('A Movie').length).toBeGreaterThan(0);
    expect(screen.getAllByText('A Series').length).toBeGreaterThan(0);
    await user.click(screen.getByTestId('my-list-tab-movie'));
    expect(screen.getAllByText('A Movie').length).toBeGreaterThan(0);
    expect(screen.queryByText('A Series')).not.toBeInTheDocument();
  });

  it('does not render tabs while loading', () => {
    mockIsLoading = true;
    render(<MyListView />);
    expect(screen.queryByTestId('my-list-tabs')).not.toBeInTheDocument();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run src/components/my-movies/MyListView.test.tsx`
Expected: FAIL — no tab elements rendered.

- [ ] **Step 3: Add filter state + tab list type**

In `frontend/src/components/my-movies/MyListView.tsx`, add `useState` to the React import and define the tab list above the component:

```ts
import React, { useState } from 'react';
```

```ts
type ListFilter = 'all' | 'movie' | 'tv';

const TABS: { id: ListFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'movie', label: 'Movies' },
  { id: 'tv', label: 'Series' },
];
```

- [ ] **Step 4: Compute the filtered list**

Replace the start of the component body (the `const { items, isLoading } = useWatchlist();` line) with:

```ts
  const { items, isLoading } = useWatchlist();
  const [filter, setFilter] = useState<ListFilter>('all');

  const visibleItems =
    filter === 'all' ? items : items.filter((i) => i.media_type === filter);
```

- [ ] **Step 5: Render the tabs and use `visibleItems`**

Change the header count guard to use `visibleItems` (replace the `{!isLoading && items.length > 0 && (…)}` count block):

```tsx
        {!isLoading && visibleItems.length > 0 && (
          <p className="mt-3 text-[13px] text-muted">
            {visibleItems.length} {visibleItems.length === 1 ? 'title' : 'titles'} saved
          </p>
        )}
```

Insert the tab control directly after the closing `</header>` tag:

```tsx
      {/* ── Type filter tabs ── */}
      {!isLoading && items.length > 0 && (
        <div
          role="tablist"
          aria-label="Filter saved titles"
          data-testid="my-list-tabs"
          className="mb-8 inline-flex gap-1 rounded-full border border-hairline bg-surface/60 p-1"
        >
          {TABS.map((tab) => {
            const active = filter === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={active}
                data-testid={`my-list-tab-${tab.id}`}
                onClick={() => setFilter(tab.id)}
                className={cn(
                  'rounded-full px-4 py-1.5 font-ui text-[13px] font-medium tracking-[0.01em]',
                  'transition-[background-color,color] duration-200',
                  'focus:outline-none focus-visible:shadow-[0_0_0_2px_var(--color-ink),0_0_0_4px_var(--color-gold)]',
                  active ? 'bg-gold text-ink' : 'text-muted hover:text-text',
                )}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      )}
```

Update the content branch to filter on `visibleItems` (the whole-empty case keeps `EmptyState`; a filter that matches nothing also falls back to `EmptyState`):

```tsx
      {/* ── Content ── */}
      {isLoading ? (
        <MyListSkeleton />
      ) : items.length === 0 || visibleItems.length === 0 ? (
        <EmptyState />
      ) : (
        <div
          data-testid="my-list-grid"
          className="flex flex-wrap gap-x-5 gap-y-10"
        >
          {visibleItems.map((item) => (
            <PosterCard
              key={item.content_id}
              item={watchlistItemToCatalogItem(item)}
            />
          ))}
        </div>
      )}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/components/my-movies/MyListView.test.tsx`
Expected: PASS (all MyListView tests).

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/my-movies/MyListView.tsx frontend/src/components/my-movies/MyListView.test.tsx
git commit -m "feat(my-list): add All/Movies/Series filter tabs"
```

---

### Task 10: Frontend — watchlist carousel row builder

**Files:**
- Create: `frontend/src/lib/watchlist/watchlistRow.ts`
- Test: `frontend/src/lib/watchlist/watchlistRow.test.ts`

**Interfaces:**
- Consumes: `RowConfig` (type, `@/components/browse/BrowseScreen`); `watchlistItemToCatalogItem` (Task 4).
- Produces: `buildWatchlistRow(items: WatchlistItem[], filter: 'all'|'movie'|'tv'): RowConfig` (key `'watchlist'`, title `'My List'`, `seeAllHref: '/my-list'`); `insertWatchlistRow(rows: RowConfig[], row: RowConfig): RowConfig[]` (inserts after index 0).

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/lib/watchlist/watchlistRow.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildWatchlistRow, insertWatchlistRow } from './watchlistRow';
import type { WatchlistItem } from '@/services/watchlist';
import type { RowConfig } from '@/components/browse/BrowseScreen';

function wl(content_id: string, media_type: 'movie' | 'tv', tmdb_id: string): WatchlistItem {
  return { id: content_id, user_id: 'u1', content_id, tmdb_id, media_type,
    title: 't', added_at: '', created_at: '' };
}

describe('buildWatchlistRow', () => {
  const items = [wl('movie:1', 'movie', '1'), wl('tv:2', 'tv', '2')];

  it('uses key "watchlist", title "My List", and links to /my-list', () => {
    const row = buildWatchlistRow(items, 'all');
    expect(row.key).toBe('watchlist');
    expect(row.title).toBe('My List');
    expect(row.seeAllHref).toBe('/my-list');
    expect(row.items).toHaveLength(2);
  });

  it('filters to movies only', () => {
    const row = buildWatchlistRow(items, 'movie');
    expect(row.items).toHaveLength(1);
    expect(row.items[0].media_type).toBe('movie');
  });

  it('filters to tv only', () => {
    const row = buildWatchlistRow(items, 'tv');
    expect(row.items).toHaveLength(1);
    expect(row.items[0].media_type).toBe('tv');
  });
});

describe('insertWatchlistRow', () => {
  const r = (key: string): RowConfig => ({ key, title: key, items: [] });

  it('inserts after the first row', () => {
    const out = insertWatchlistRow([r('a'), r('b')], r('watchlist'));
    expect(out.map((x) => x.key)).toEqual(['a', 'watchlist', 'b']);
  });

  it('returns just the watchlist row when there are no other rows', () => {
    const out = insertWatchlistRow([], r('watchlist'));
    expect(out.map((x) => x.key)).toEqual(['watchlist']);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run src/lib/watchlist/watchlistRow.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the builder**

Create `frontend/src/lib/watchlist/watchlistRow.ts`:

```ts
import type { RowConfig } from '@/components/browse/BrowseScreen';
import type { WatchlistItem } from '@/services/watchlist';
import { watchlistItemToCatalogItem } from './toCatalogItem';

export type WatchlistRowFilter = 'all' | 'movie' | 'tv';

/**
 * Build the "My List" carousel row from the user's saved items, optionally
 * narrowed to one media type. BrowseScreen drops rows with no items, so callers
 * never need to guard the empty case.
 */
export function buildWatchlistRow(
  items: WatchlistItem[],
  filter: WatchlistRowFilter,
): RowConfig {
  const scoped =
    filter === 'all' ? items : items.filter((i) => i.media_type === filter);
  return {
    key: 'watchlist',
    title: 'My List',
    eyebrow: 'Your Collection',
    seeAllHref: '/my-list',
    variant: 'poster',
    items: scoped.map(watchlistItemToCatalogItem),
  };
}

/**
 * Insert the watchlist row just after the first rail (or as the only row when
 * there are no other rails).
 */
export function insertWatchlistRow(
  rows: RowConfig[],
  watchlistRow: RowConfig,
): RowConfig[] {
  if (rows.length === 0) return [watchlistRow];
  return [rows[0], watchlistRow, ...rows.slice(1)];
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/lib/watchlist/watchlistRow.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/watchlist/watchlistRow.ts frontend/src/lib/watchlist/watchlistRow.test.ts
git commit -m "feat(watchlist): row builder for the My List carousel"
```

---

### Task 11: Frontend — inject My List carousel into Home

**Files:**
- Modify: `frontend/src/components/home/HomeBrowse.tsx`
- Test: `frontend/src/components/home/HomeBrowse.test.tsx`

**Interfaces:**
- Consumes: `useWatchlist().items`; `buildWatchlistRow(items, 'all')`; `insertWatchlistRow`.

- [ ] **Step 1: Update the test setup + add injection tests**

In `frontend/src/components/home/HomeBrowse.test.tsx`:

1. Add a watchlist mock above the existing mocks and a mutable items array:

```ts
const mockWatchlistItems: Array<{
  id: string; user_id: string; content_id: string; tmdb_id: string;
  media_type: 'movie' | 'tv'; title: string; added_at: string; created_at: string;
}> = [];
vi.mock('@/context/WatchlistContext', () => ({
  useWatchlist: () => ({ items: mockWatchlistItems }),
}));
```

2. Replace the mock `BrowseScreen` to expose each row's item count:

```ts
vi.mock('@/components/browse/BrowseScreen', () => ({
  default: ({ hero, rows }: { hero?: { title: string }; rows: Array<{ title: string; items?: unknown[] }> }) => (
    <div data-testid="mock-browse-screen">
      {hero && <h1 data-testid="mock-hero-title">{hero.title}</h1>}
      {rows.map((r) => (
        <h2 key={r.title} data-testid="mock-row-title" data-count={(r.items ?? []).length}>{r.title}</h2>
      ))}
    </div>
  ),
}));
```

3. Reset the watchlist between tests — add to the existing `beforeEach` body:

```ts
  mockWatchlistItems.length = 0;
```

4. Add two tests inside `describe('HomeBrowse', …)`:

```ts
  it('injects a "My List" row after the first rail when the watchlist has items', async () => {
    mockWatchlistItems.push(
      { id: 'w1', user_id: 'u1', content_id: 'movie:1', tmdb_id: '1', media_type: 'movie', title: 'Saved', added_at: '', created_at: '' },
    );
    render(<HomeBrowse />);
    const titles = (await screen.findAllByTestId('mock-row-title')).map((e) => e.textContent);
    expect(titles).toContain('My List');
    expect(titles[1]).toBe('My List');
  });

  it('includes both movies and tv in the Home My List row', async () => {
    mockWatchlistItems.push(
      { id: 'w1', user_id: 'u1', content_id: 'movie:1', tmdb_id: '1', media_type: 'movie', title: 'M', added_at: '', created_at: '' },
      { id: 'w2', user_id: 'u1', content_id: 'tv:2', tmdb_id: '2', media_type: 'tv', title: 'T', added_at: '', created_at: '' },
    );
    render(<HomeBrowse />);
    const myList = (await screen.findAllByTestId('mock-row-title')).find((e) => e.textContent === 'My List')!;
    expect(myList.getAttribute('data-count')).toBe('2');
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run src/components/home/HomeBrowse.test.tsx`
Expected: FAIL — no `My List` row in the output.

- [ ] **Step 3: Inject the row in HomeBrowse**

In `frontend/src/components/home/HomeBrowse.tsx`, add the imports:

```ts
import { useWatchlist } from '@/context/WatchlistContext';
import { buildWatchlistRow, insertWatchlistRow } from '@/lib/watchlist/watchlistRow';
```

Read the watchlist inside the component (after the existing `const { currentUser } = useUser();`):

```ts
  const { items: watchlistItems } = useWatchlist();
```

Replace the render tail (`if (isLoading) …` through the `return`):

```ts
  if (isLoading) return <HomeSkeleton />;

  const displayRows = insertWatchlistRow(rows, buildWatchlistRow(watchlistItems, 'all'));

  return (
    <BrowseScreen hero={hero} featured={featured} rows={displayRows} showContinueWatching />
  );
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/components/home/HomeBrowse.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/home/HomeBrowse.tsx frontend/src/components/home/HomeBrowse.test.tsx
git commit -m "feat(home): surface a My List carousel after the first rail"
```

---

### Task 12: Frontend — inject My List carousel into Movies (movies only)

**Files:**
- Modify: `frontend/src/components/movies/MoviesBrowse.tsx`
- Test: `frontend/src/components/movies/MoviesBrowse.test.tsx`

**Interfaces:**
- Consumes: `useWatchlist().items`; `buildWatchlistRow(items, 'movie')`; `insertWatchlistRow`.

- [ ] **Step 1: Update the test setup + add the filter test**

In `frontend/src/components/movies/MoviesBrowse.test.tsx`, apply the same three setup changes as Task 11 Step 1 (the `mockWatchlistItems` array + `useWatchlist` mock; the `data-count` mock `BrowseScreen`; `mockWatchlistItems.length = 0;` in `beforeEach`), then add:

```ts
  it('injects a "My List" row after the first rail', async () => {
    mockWatchlistItems.push(
      { id: 'w1', user_id: 'u1', content_id: 'movie:1', tmdb_id: '1', media_type: 'movie', title: 'M', added_at: '', created_at: '' },
    );
    render(<MoviesBrowse />);
    const titles = (await screen.findAllByTestId('mock-row-title')).map((e) => e.textContent);
    expect(titles[1]).toBe('My List');
  });

  it('the Movies My List row only includes movies', async () => {
    mockWatchlistItems.push(
      { id: 'w1', user_id: 'u1', content_id: 'movie:1', tmdb_id: '1', media_type: 'movie', title: 'M', added_at: '', created_at: '' },
      { id: 'w2', user_id: 'u1', content_id: 'tv:2', tmdb_id: '2', media_type: 'tv', title: 'T', added_at: '', created_at: '' },
    );
    render(<MoviesBrowse />);
    const myList = (await screen.findAllByTestId('mock-row-title')).find((e) => e.textContent === 'My List')!;
    expect(myList.getAttribute('data-count')).toBe('1');
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run src/components/movies/MoviesBrowse.test.tsx`
Expected: FAIL — no `My List` row.

- [ ] **Step 3: Inject the row in MoviesBrowse**

In `frontend/src/components/movies/MoviesBrowse.tsx`, add the imports:

```ts
import { useWatchlist } from '@/context/WatchlistContext';
import { buildWatchlistRow, insertWatchlistRow } from '@/lib/watchlist/watchlistRow';
```

Read the watchlist after `const { currentUser } = useUser();`:

```ts
  const { items: watchlistItems } = useWatchlist();
```

Replace the render tail:

```ts
  if (isLoading) return <MoviesSkeleton />;

  const displayRows = insertWatchlistRow(rows, buildWatchlistRow(watchlistItems, 'movie'));

  return (
    <BrowseScreen hero={hero} featured={featured} rows={displayRows} showContinueWatching={false} />
  );
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/components/movies/MoviesBrowse.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/movies/MoviesBrowse.tsx frontend/src/components/movies/MoviesBrowse.test.tsx
git commit -m "feat(movies): surface a movies-only My List carousel"
```

---

### Task 13: Frontend — inject My List carousel into Series (tv only)

**Files:**
- Modify: `frontend/src/components/tv/SeriesBrowse.tsx`
- Test: `frontend/src/components/tv/SeriesBrowse.test.tsx`

**Interfaces:**
- Consumes: `useWatchlist().items`; `buildWatchlistRow(items, 'tv')`; `insertWatchlistRow`.

- [ ] **Step 1: Update the test setup + add the filter test**

In `frontend/src/components/tv/SeriesBrowse.test.tsx`, apply the same three setup changes as Task 11 Step 1, then add:

```ts
  it('injects a "My List" row after the first rail', async () => {
    mockWatchlistItems.push(
      { id: 'w2', user_id: 'u1', content_id: 'tv:2', tmdb_id: '2', media_type: 'tv', title: 'T', added_at: '', created_at: '' },
    );
    render(<SeriesBrowse />);
    const titles = (await screen.findAllByTestId('mock-row-title')).map((e) => e.textContent);
    expect(titles[1]).toBe('My List');
  });

  it('the Series My List row only includes tv', async () => {
    mockWatchlistItems.push(
      { id: 'w1', user_id: 'u1', content_id: 'movie:1', tmdb_id: '1', media_type: 'movie', title: 'M', added_at: '', created_at: '' },
      { id: 'w2', user_id: 'u1', content_id: 'tv:2', tmdb_id: '2', media_type: 'tv', title: 'T', added_at: '', created_at: '' },
    );
    render(<SeriesBrowse />);
    const myList = (await screen.findAllByTestId('mock-row-title')).find((e) => e.textContent === 'My List')!;
    expect(myList.getAttribute('data-count')).toBe('1');
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run src/components/tv/SeriesBrowse.test.tsx`
Expected: FAIL — no `My List` row.

- [ ] **Step 3: Inject the row in SeriesBrowse**

In `frontend/src/components/tv/SeriesBrowse.tsx`, add the imports:

```ts
import { useWatchlist } from '@/context/WatchlistContext';
import { buildWatchlistRow, insertWatchlistRow } from '@/lib/watchlist/watchlistRow';
```

Read the watchlist after `const { currentUser } = useUser();`:

```ts
  const { items: watchlistItems } = useWatchlist();
```

Replace the render tail:

```ts
  if (isLoading) return <SeriesSkeleton />;

  const displayRows = insertWatchlistRow(rows, buildWatchlistRow(watchlistItems, 'tv'));

  return (
    <BrowseScreen hero={hero} featured={featured} rows={displayRows} showContinueWatching={false} />
  );
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/components/tv/SeriesBrowse.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/tv/SeriesBrowse.tsx frontend/src/components/tv/SeriesBrowse.test.tsx
git commit -m "feat(series): surface a series-only My List carousel"
```

---

### Task 14: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Typecheck the frontend**

Run: `cd frontend && npx tsc --noEmit`
Expected: no output (no type errors).

- [ ] **Step 2: Run the full frontend suite**

Run: `cd frontend && npm run test`
Expected: all test files pass.

- [ ] **Step 3: Run the full backend suite**

Run: `make test`
Expected: all pass. (If the new/edited `test_watchlist.py` doesn't appear, the image is stale — either `make build` first, or run with the tests dir mounted as in earlier tasks.)

- [ ] **Step 4: Manual smoke (optional but recommended)**

With `make up` running, in the browser at `http://localhost:3001`:
1. Visit `/my-movies` → confirm it redirects to `/my-list`.
2. On a movie/series, click the My List "+" → the card on `/my-list` shows the real poster, year, and rating.
3. An item saved before this change shows a placeholder briefly, then heals to the real poster on reload.
4. On Home/Movies/Series, the "My List" carousel appears after the first rail (Movies → movies only, Series → series only, Home → both); it disappears when the (filtered) list is empty.

- [ ] **Step 5: Final commit (only if anything is uncommitted)**

```bash
git status   # expect clean; per-task commits already cover the work
```

---

## Self-Review

**Spec coverage:**
- Bug fix / retention (spec Part A): Tasks 1–2 (persist + PATCH), 3 (service), 4 (adapters), 5 (save sites), 6 (read adapter), 7 (auto-heal). ✓
- Rename + tabs (spec Part B): Task 8 (rename + redirect + hrefs), 9 (tabs). ✓
- Carousels (spec Part C): Task 10 (builder), 11 (Home, both), 12 (Movies, movie), 13 (Series, tv); placement "after first rail" via `insertWatchlistRow`; empty auto-hide relied on (`BrowseScreen.tsx:81`). ✓
- Testing (spec): backend add/patch/columns; frontend adapters, heal, tabs, per-page filter; Task 14 full run. ✓
- Scope boundaries (spec): no `content_id` change, no theme/registry change, no backfill migration (heal covers it), show-level entries unchanged. ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code; every command has an expected result.

**Type consistency:** `WatchlistItemUpdate` shape is identical across backend (`models.py`), service (`watchlist.ts`), and heal usage. `WatchlistSource` (`toWatchlistCreate`) matches the structural fields of `CatalogItem`/`MovieDetail` and `{...ShowDetail, title}`. `buildWatchlistRow`/`insertWatchlistRow` signatures match their call sites in Tasks 11–13. `watchlistItemToCatalogItem` is defined once (Task 4) and consumed by Tasks 6, 10.
