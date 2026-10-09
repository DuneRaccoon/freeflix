# TV stage 6 — detail screens, season/episode picker, search, My List Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete "watch + request" on the television — a viewer can reach a title from home, read it, start it, pick an episode out of a season, search for something by name, and manage their list, all from a D-pad.

**Architecture:** New static route segments under `(bigscreen)/bigscreen/` in front of the existing `[...rest]` catch-all, built on stage 4's primitives (`_focus/`, `_components/`, `_data/`). One new backend change: four identity fields added to the `TorrentStatus` response model over columns the database already indexes, so the TV can tell "already downloading" from "never requested" instead of minting a duplicate torrent on every press of Play.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, vitest + @testing-library/react, hand-authored plain CSS in `frontend/public/bigscreen.css`; FastAPI + Pydantic (SQLAlchemy **1.4**) for the one backend task.

**Spec:** `docs/superpowers/specs/2026-09-22-webos-tv-app-design.md` — stage 6 in §14, routes in §5.1, focus rules in §8, text entry in §8.4, layout in §8.5, budget in §9, quality policy in §7.3.

## Global Constraints

- **No `@/components` import anywhere under `(bigscreen)`, direct or one hop deep.** `legacy-target.test.ts` enforces both. `@/services/*`, `@/lib/*`, `@/types`, `react` and `next/*` are allowed. Relative imports inside the route group are the convention (`../_components/Rail`).
- **The strings `framer-motion` and `globals.css` may not appear in any non-test file under `(bigscreen)`** — the import rules are checked against raw source, deliberately.
- **Banned CSS substrings** (checked in every non-test TV file with comments stripped, and in every `public/*.css`): `backdrop-filter`, `backdropFilter`, `WebkitBackdropFilter`, `backdrop-blur`, `mix-blend`, `mixBlendMode`, `background-blend`, `backgroundBlendMode`, `blur(`, `feTurbulence`, `feGaussianBlur`, `filter: url(`, `filter:url(`, `filter="url(`. These are about the television's frame budget, not its browser engine.
- **Do not add a second `@allow-legacy-probes` marker.** The opted-out set is pinned to `bigscreen/diag/page.tsx`.
- **`(bigscreen)/layout.tsx` must keep linking exactly one stylesheet, `/bigscreen.css`.** A test asserts it.
- **No screen may render with nothing focusable, in any reachable state** — including first paint, loading, empty, failed, and any in-flight state. There is no Tab key and no pointer; a ringless screen is unrecoverable. Every state gets a focus target, and a control whose press would be refused must *say so* rather than offering an action it will ignore.
- **One `useFocusGrid` live per screen.** The listener is on `window` and whichever registered first claims an arrow, so two live grids leave the *incoming* one inert. The established pattern is a child component per mutually-exclusive state, each owning its own grid — see `bigscreen/profiles/page.tsx` (`LoadingWithWayOut`, `ProfileGrid`, `Keypad`).
- **A focus row's declared count must equal the cells rendered.** Use `railCellCount(rail)` for rails, never `items.length`. Key cells by index, never by item id — a refetch that re-keys the focused cell drops DOM focus to `<body>`.
- **`CardItem` identities must be stable.** `Card` is memoised with a by-value comparator and a `Record<keyof CardItem, true>` guard, so adding a field to `CardItem` is a type error until the comparator knows about it.
- **Layout (§8.5):** a 1920×1080 CSS-pixel design space, safe area `--safe-x: 96px` / `--safe-y: 54px`, nothing interactive or textual outside it, focus targets ≥60px tall. Text tiers (§8.5 as amended): prose a viewer **reads** takes ≥24px; a short token they **recognise** (a year, a pill) may take 20px; decoration may take 20px.
- **`html, body` are `overflow: hidden`.** A scrolling screen provides its own container (`.bs-shell__scroll`).
- **Quality (§7.3):** the TV requests **1080p**. The per-title 4K opt-in is stage 8 — do not build a quality picker.
- **Commits:** Conventional Commits. Use your own harness-supplied `Co-Authored-By` trailer.
- **Verification for every task**, from `frontend/`: `npx vitest run`, `npm run test:tv`, `npx tsc --noEmit`. Baselines at branch start: **102 files / 1462 tests**, `test:tv` **18 files / 551**. Backend baseline **534 passed**, run with `docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest -q` (tests are baked into the image, not bind-mounted).

## Review Focus

1. **Pressing Play twice must not start two downloads of the same thing.** `POST /torrents/download` mints a fresh uuid4 with no magnet or infohash dedupe, so the web's Play button creates a new torrent on every click. On a remote that is one OK press, feedback is slower, and the ARM build caps concurrent downloads at **2** — so two impatient presses can exhaust the whole box with one title. Pinned in Tasks 3 and 4.
2. **A failed Play must be visible.** The web's `handleCatalogStreamingStart` swallows its error, raises a `react-hot-toast`, and returns `null`; `(bigscreen)/layout.tsx` mounts no `<Toaster>`, so reusing it would make a failure **completely silent** on the television. Every request this stage makes reports its own outcome on screen. Pinned in Task 4.
3. **An episode pressed inside a season pack must play that episode.** The spec carries `file_index` through the streaming URL, the progress row and the resume link. `GET /streaming/{id}/files` already returns files labelled with season/episode and sorted, so the resolution exists — but the web never uses it (its show screen hard-codes `season: 1, episode: 1` and shows a static "Season pack" label with no selection). Pinned in Tasks 3 and 5.
4. **A profile-scoped call can answer 423.** Watchlist and progress run `require_profile`, which means **passcode-locked**, not "empty". A 423 must clear the stored profile and send the viewer to the picker, never render as "you have no list". Pinned in Tasks 3 and 7.
5. **Backspace is a Back key on this surface.** `useBackKey` claims `Backspace` (and `Escape`) unconditionally, with no text-field exemption. The search keyboard is the first text entry on the TV, so delete-a-character and leave-the-screen collide here. Pinned in Task 6.

---

## Task 1: Expose media identity on the torrent status response

**Files:**
- Modify: `backend/app/models.py` (the `TorrentStatus` response model, around line 337)
- Modify: `frontend/src/types/index.ts` (the `TorrentStatus` interface, around line 94)
- Test: `backend/tests/test_torrent_identity_fields.py` (create)

**Interfaces:**
- Produces: four optional fields on `TorrentStatus`, consumed by Task 3.

**Why this is first, and why it is a backend change in a frontend stage.** The TV needs to answer "is this title already downloading, or already downloaded?" before offering Play. The database already knows: `backend/app/database/models/torrents.py` stores `tmdb_id` (indexed), `media_type`, `season` and `episode`, written at `torrent/manager.py:725`. The response model exposes **none of them**, so a client can only match on `movie_title`, a free-text string. Adding them is additive to a Pydantic model over existing columns — no migration, no DDL, and `sync_columns` is not involved.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_torrent_identity_fields.py`. Cover:
- `TorrentStatus.model_validate(row)` on a torrent row with `tmdb_id`, `media_type='tv'`, `season=1`, `episode=3` carries all four through (the model is `from_attributes=True`, so validate an object with those attributes).
- A row with all four as `None` validates and serialises them as `None` — they are optional, and old rows predate the columns.
- `GET /torrents/status/{id}` includes the four keys. Use the existing API-test fixtures in `backend/tests/`; find how other torrent endpoints are tested and follow it.
- A movie row carries `media_type='movie'` with `season`/`episode` `None`.

- [ ] **Step 2: Run it and watch it fail**

Run: `docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest tests/test_torrent_identity_fields.py -q`
Expected: FAIL — the fields are not on the model.

- [ ] **Step 3: Add the fields**

In `backend/app/models.py`, on `TorrentStatus`:

```python
    # Media identity, straight off the indexed columns the torrent row already carries
    # (database/models/torrents.py). Exposed so a client can tell "already downloading"
    # from "never requested" instead of minting a duplicate: POST /torrents/download
    # mints a fresh uuid4 and add_torrent does no magnet or infohash dedupe, so every
    # press of Play creates another torrent. All four are Optional because rows written
    # before these columns existed have them NULL.
    tmdb_id: Optional[int] = None
    media_type: Optional[str] = None
    season: Optional[int] = None
    episode: Optional[int] = None
```

Mirror them on the frontend `TorrentStatus` interface as `tmdb_id?: number | null` etc., with a comment pointing at the same reason.

- [ ] **Step 4: Run it and watch it pass**

- [ ] **Step 5: Run the whole backend suite**

Run: `docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest -q`
Expected: **534 + your new tests**, nothing broken. These are additive optional fields, so no existing assertion should move; if one does, read it before changing it.

- [ ] **Step 6: Commit**

```bash
git add backend/app/models.py backend/tests/test_torrent_identity_fields.py frontend/src/types/index.ts
git commit -m "feat(torrents): expose media identity on the status response"
```

---

## Task 2: A nav row, so search and My List are reachable at all

**Files:**
- Create: `frontend/src/app/(bigscreen)/_components/NavRow.tsx`
- Create: `frontend/src/app/(bigscreen)/_components/NavRow.test.tsx`
- Modify: `frontend/src/app/(bigscreen)/bigscreen/page.tsx` and its test
- Modify: `frontend/public/bigscreen.css`

**Interfaces:**
- Produces:

```tsx
export interface NavTarget { href: string; label: string }
/** The row is one focus row; its count is NAV_TARGETS.length. */
export const NAV_TARGETS: readonly NavTarget[];
export function NavRow(props: {
  row: number;
  focusPropsFor: (row: number, col: number) => FocusProps;
}): JSX.Element;
```

`NAV_TARGETS` is, in order: `Search` → `/bigscreen/search`, `My List` → `/bigscreen/list`, `Who's watching?` → `/bigscreen/profiles`, `Diagnostics` → `/bigscreen/diag`.

**Why this task exists.** Three findings from stage 4 land here, and without it two screens this stage builds are unreachable:
- A healthy home screen offers **no way to switch profile** — the only link to the picker lives in the recovery panel, which only renders when something is wrong. So a viewer who picks the wrong profile has no route back short of clearing site data on a television.
- `/bigscreen/diag` lost its only in-app route when home's placeholder was replaced, and it is the field instrument the whole on-TV verification depends on.
- Nothing links to search or My List.

**The row-index hazard, which is the real work here.** Home's focus grid is `[recoveryCount, heroItem ? 1 : 0, ...rails.map(railCellCount)]`, and `savedCatalogSpec()` maps a saved row index back to a rail by subtracting `FIRST_RAIL_ROW`. Inserting a row shifts every rail index, so a position saved by the previous build points one rail too high. Read `bigscreen/page.tsx` and handle it deliberately: either put nav **after** the rails in row order (cheapest — no index shifts), or bump the storage key so old positions are discarded rather than misread. Say which you chose and why. Do **not** leave it so a stale saved position silently lands on the wrong rail.

Place the row where a viewer will find it and where it does not fight the hero: nav at the very top means it takes focus on mount instead of the hero, which is wrong — home should open on the hero. Decide and justify.

- [ ] **Step 1: Write the failing NavRow tests**

Cover: renders one focusable element per `NAV_TARGETS` entry, each with the right `href`; `focusPropsFor` is called with the row it was given and each column index; the labels render; no element outside the safe inset (assert the container class carries the inset, since jsdom cannot measure).

- [ ] **Step 2: Run, implement, run**

- [ ] **Step 3: Add the CSS**

Add `.bs-nav` (a flex row, `gap: 24px`, `padding: 0 var(--safe-x)`) and `.bs-nav__item` (min-height ≥60px per §8.5, the `bs-btn--ghost` look, `:focus` ring matching the surface). Reuse existing tokens; add no `:root` entry.

- [ ] **Step 4: Wire it into home, with the row-index decision**

- [ ] **Step 5: Extend home's tests**

Cover: the nav row's cells are counted in `rowCounts` and reachable by arrow from the rails or hero (whichever adjacency you chose); the hero still takes focus on mount; a saved position from the previous row layout does not land on the wrong rail (write the old-shaped value into `sessionStorage` directly and assert what happens).

- [ ] **Step 6: Verify and commit**

Run the three frontend verifications plus `npm run build` — the route table must be unchanged (nav only links; the screens come later).

---

## Task 3: The title-state data layer

**Files:**
- Create: `frontend/src/app/(bigscreen)/_data/title.ts`
- Create: `frontend/src/app/(bigscreen)/_data/title.test.ts`

**Interfaces:**
- Consumes: `moviesService.getDetail`, `tvService.getShow`, `tvService.getSeason` from `@/services/movies` / `@/services/tv`; `torrentsService.listTorrents`, `downloadCatalogMovie` from `@/services/torrents`; `streamingService.getProgressByMovie`, `getFiles` from `@/services/streaming`; `buildContentId` from `@/lib/contentId`; the new identity fields from Task 1.
- Produces:

```ts
/** What the primary control on a detail screen should do, and say. */
export type TitleAction =
  | { kind: 'play' }                                        // nothing exists yet
  | { kind: 'resume'; href: string; atSeconds: number }     // progress exists and is resumable
  | { kind: 'open'; href: string }                          // downloaded, no progress
  | { kind: 'preparing'; torrentId: string; progress: number } // already downloading
  | { kind: 'blocked'; reason: string };                    // the box refused it

export interface TitleState {
  action: TitleAction;
  /** True when a profile-scoped call answered 423: the caller must send the viewer to the picker. */
  locked: boolean;
}

export function titleStateFor(args: {
  mediaType: 'movie' | 'tv';
  tmdbId: number;
  season?: number;
  episode?: number;
  userId: string | null;
}): Promise<TitleState>;

/** Start a download. Resolves with the new torrent id, or a reason it did not start. */
export function requestTitle(args: {
  mediaType: 'movie' | 'tv';
  tmdbId: number;
  season?: number;
  episode?: number;
}): Promise<{ ok: true; torrentId: string } | { ok: false; reason: string }>;

/** The file index inside `torrentId` that holds this episode, or null if it is not there. */
export function fileIndexForEpisode(
  torrentId: string,
  season: number,
  episode: number,
): Promise<number | null>;
```

**`titleStateFor` rules, in order:**
1. If `userId` is set, ask `streamingService.getProgressByMovie(userId, buildContentId(...))`. A **423** means passcode-locked: resolve `{ locked: true }` immediately and let the screen redirect. A row with a null `torrent_id` can never resume (the FK is `ON DELETE SET NULL`) — ignore it. A row past ~95% is finished, not resumable.
2. Ask `torrentsService.listTorrents()` and look for a row matching this title on the **new identity fields** — `tmdb_id` plus `media_type`, and for tv also `season`/`episode` where the row carries them. Do **not** match on `movie_title`: it is free text, and a season pack's title does not name an episode.
   Three contract notes, each from the Task 1 review and each able to produce a wrong answer:
   - **A season pack is `season: N, episode: null`.** Read that as "this season is covered", *not* "episode unknown". An episode press inside that season should match the pack and then resolve a `file_index` (below), rather than concluding nothing exists and minting a second torrent for one episode.
   - **A NULL `season`/`episode` is not proof of a movie.** Always pair the check with `media_type`.
   - **`media_type` can lie on a legacy row.** `torrent/manager.py:726` writes `getattr(movie, "media_type", "movie")`, so a caller that omitted it stored a TV torrent as `"movie"`. `POST /torrents/download` always sets it, so this is latent rather than live — but prefer a match that requires `tmdb_id` AND `media_type` to agree, and treat a disagreement as "no match" rather than guessing.
   - **Do not read `chosen_quality` from `/list` or `/status`.** `to_status()` omits it, so it is set only on the `POST /download` response and is `None` on every later poll. Use `quality`, which is the stored (post-downgrade) value.
3. Map state → action: `downloading`/`downloading_metadata`/`queued` → `preparing`; `finished`/`seeding` → `open` (or `resume` if step 1 found progress); `blocked` → `blocked` with the row's `block_reason`; otherwise → `play`.
4. Every call is individually failure-tolerant and the function **resolves, never rejects**. A dead `listTorrents` must degrade to `play`, not to a broken screen.

**`requestTitle` rules:** POST once via `downloadCatalogMovie` with `quality: '1080p'` (§7.3) and the media identity. Translate a failure into a `reason` a viewer can read — distinguish at least "no sources found", "the box is already busy" (the ARM 2-download cap) and a generic failure. **Do not import `@/utils/streaming`'s `handleCatalogStreamingStart`**: it swallows its error, raises a toast, and returns `null`, and this surface mounts no toaster, so a failure would be silent.

**`fileIndexForEpisode` rules:** `streamingService.getFiles(torrentId)` already returns `VideoFile[]` with `season` and `episode` parsed and sorted. Match on both. Return `null` when absent rather than guessing an index — guessing plays the wrong episode, which is worse than reporting that it is not there.

- [ ] **Step 1: Write the failing tests**

Mock `@/services/*`. Cover each numbered rule above with one test, and specifically:
- a 423 from progress resolves `{ locked: true }` and makes no further calls
- a progress row with `torrent_id: null` does not become `resume`
- a torrent matched by `tmdb_id` + `media_type` is found even when its `movie_title` is unrelated
- an episode is NOT matched to a movie row with the same `tmdb_id`
- `listTorrents` rejecting still yields `{ kind: 'play' }`
- `requestTitle` surfaces a readable reason for each failure class
- `fileIndexForEpisode` returns the index for S1E3 out of a pack and `null` for S9E9

- [ ] **Step 2: Run, implement, run. Then commit.**

---

## Task 4: The movie detail screen

**Files:**
- Create: `frontend/src/app/(bigscreen)/bigscreen/movie/[id]/page.tsx` + `page.test.tsx`
- Create: `frontend/src/app/(bigscreen)/_components/TitleScreen.tsx` + test (the shared frame both detail screens use)
- Modify: `frontend/public/bigscreen.css`

**Interfaces:**
- Consumes: `titleStateFor`, `requestTitle` (Task 3); `useTvProfile`; `useFocusGrid`; `useBackKey`; `atSize` from `../_components/Hero`.
- Produces: `TitleScreen`, used again by Task 5.

```tsx
export function TitleScreen(props: {
  art: string | null;          // a backdrop, already at w1920
  eyebrow?: string | null;     // "2021 · 2h 35m", or a season label
  title: string;
  overview: string | null;
  /** Row 0: the actions. Each must be focusable and must never unmount while focused. */
  actions: React.ReactNode;
  /** Rows 1+: episode list, or nothing on a movie. */
  below?: React.ReactNode;
}): JSX.Element;
```

**Behaviour:**
- Fetch the detail with `moviesService.getDetail(id, { withQualities: false })` — the cheap form stage 4 added. One page load of the web's screen runs **three** identical server-side torrent searches (`getDetail` with qualities, `getTorrents`, `getSources`), each up to ~35s cold; the TV needs none of them, because it requests 1080p and builds no picker. Note the consequence: `available_qualities` will be `[]`, so do not read it.
- Ask `titleStateFor` for the primary action and render the control from it: **Play** / **Resume** / **Open** / **Preparing…** / a readable refusal. A `locked: true` result clears the profile and replaces to `/bigscreen/profiles`.
- A second control toggles My List, calling `watchlistService` directly with `useTvProfile().profile.id`. Treat **409 as already-saved** (a success, not an error) and reflect the new state. Be optimistic, and revert the label if the call fails — silently doing nothing is the failure mode to avoid.
- Pressing Play: guard against a second press while one is in flight, relabel the control to say so, and on success navigate to `/bigscreen/watch/{torrentId}`. On failure show the reason **on screen**, next to the control, and leave the control usable.
- `useBackKey` → `/bigscreen`.
- Every state keeps a focus target: loading, loaded, failed-to-load (with a focusable retry and the 10s patience fall-through home uses), and in-flight.

- [ ] **Step 1: Write the failing `TitleScreen` tests**, then implement. Cover: renders null-safe with a missing overview and missing art; the art goes on an inline `backgroundImage` at `w1920`; `actions` and `below` render in that document order; exactly the focusable elements its children provide and no more.

- [ ] **Step 2: Write the failing movie-screen tests**

Mock `../../../_data/title`, `@/services/movies`, `@/services/watchlist` and `next/navigation`. Cover, one test each:
- the detail fetch asks for the cheap form (assert the second argument)
- each of the five `TitleAction` kinds renders its own control and label
- Play calls `requestTitle` once, then navigates to `/bigscreen/watch/{id}`
- **a second press while in flight does not call `requestTitle` again** (Review Focus 1)
- a failed Play shows its reason on screen and the control stays usable (Review Focus 2)
- a `locked: true` state clears the profile and replaces to the picker (Review Focus 4)
- My List toggles optimistically; a 409 counts as saved; a failure reverts the label
- something is focused in every state, including while loading and after a failure

- [ ] **Step 3: Run, implement, run. Add the CSS. Verify with `npm run build` listing `/bigscreen/movie/[id]`. Commit.**

---

## Task 5: The show detail screen, with the season picker and episode list

**Files:**
- Create: `frontend/src/app/(bigscreen)/bigscreen/show/[id]/page.tsx` + `page.test.tsx`
- Create: `frontend/src/app/(bigscreen)/_components/EpisodeList.tsx` + test
- Modify: `frontend/public/bigscreen.css`

**The data asymmetry, which the plan must respect rather than paper over.** `ShowDetail` does **not** extend `CatalogItem`. It uses **`name`, not `title`**, and has no `runtime`, `tagline`, `cast`, `available_qualities`, `genre_ids`, `popularity` or `original_language`. Adding any of them is a backend `normalize_show` change (`backend/app/models.py`, `providers/catalog.py`) and is **out of scope** — build the screen from what exists: `name`, `overview`, `poster_url`, `backdrop_url`, `first_air_date`/year, and `seasons: SeasonSummary[]`.

**Behaviour:**
- `tvService.getShow(tmdbId)` for the show; `tvService.getSeason(tmdbId, season)` **lazily, once per season opened**, cached in a ref so reopening costs nothing. The web does exactly this; copy the caching, not the markup.
- Row 0 is the actions (`TitleScreen`'s `actions`). Row 1 is the **season picker** — one focusable cell per `SeasonSummary`. Rows 2+ are the episodes of the open season.
- Opening a season changes `rowCounts`. That is the case stage 4's focus model was built for, but verify: the episode rows must count what they render, and focus must not be left on a row that shrank.
- Pressing an episode goes through `titleStateFor` with `{ season, episode }` and acts on the result — including `fileIndexForEpisode` when the matched torrent is a **season pack** (a row whose own `episode` is null but which contains the file). Navigate to `/bigscreen/watch/{torrentId}` plus `?file={index}` when an index was resolved. If the pack does not contain that episode, say so; do not navigate to a guessed index.
- **"Nothing left to watch."** A stage-4 carry: Continue Watching emits an "Up next" card for a finished episode pointing here, and the card cannot know whether a next episode exists. This screen is where that is answered — a season whose episodes are all watched, or a show whose last episode is finished, must read as finished rather than offering a dead Play.
- A season with no episodes, and a show with no seasons, each render a readable state with a focus target.
- `useBackKey` → `/bigscreen`.

- [ ] **Step 1: Write the failing `EpisodeList` tests**, then implement. One focusable cell per episode; an episode number, title and (if present) runtime; a watched or in-progress marker driven by data passed in, not fetched here; zero focusable cells while loading.

- [ ] **Step 2: Write the failing show-screen tests**

Cover, one test each: `name` is rendered (a test fixture whose `title` is absent must still show the show's name); seasons render as one row; opening a season fetches it **once** and reopening does not refetch; opening a season grows `rowCounts` and the episode cells match the count; pressing an episode in a season pack resolves a `file_index` and navigates with `?file=`; a pack missing that episode reports it and does not navigate; a fully-watched season reads as finished; a show with no seasons keeps a focus target; Back returns home.

- [ ] **Step 3: Run, implement, run. Add the CSS. Verify the build lists `/bigscreen/show/[id]`. Commit.**

---

## Task 6: Search, with a D-pad keyboard

**Files:**
- Create: `frontend/src/app/(bigscreen)/bigscreen/search/page.tsx` + `page.test.tsx`
- Create: `frontend/src/app/(bigscreen)/_components/Keyboard.tsx` + test
- Modify: `frontend/public/bigscreen.css`

**Model the keyboard on the one this surface already has, not the web's.** `(bigscreen)/bigscreen/profiles/page.tsx` contains a D-pad keypad built for this device, with a `KEY_ROWS` / `KEY_ROW_COUNTS` shape that satisfies the focus model's count contract. Follow it. The web's `shell/PasscodePrompt.tsx` has a blank cell and `disabled` keys — both of which the TV version deliberately removed, because a blank cell makes Down from the key above land somewhere surprising and a disabled key is a focus stop that refuses to act.

**Behaviour:**
- Layout: letters A–Z, digits 0–9, plus **Space**, **Delete** and **Clear**. Every cell is a real focus stop that does something.
- **Backspace must delete a character here, not leave the screen.** `useBackKey` claims `Backspace` and `Escape` unconditionally with no text-field exemption (Review Focus 5). Resolve it deliberately: this screen's Back handler must distinguish "there is text, so delete" from "the field is empty, so leave" — or scope the keys it claims. Say which you chose. A viewer who types `BATMAM`, presses Backspace to fix it, and lands on the home screen has lost their query.
- There is no combined search endpoint. Call `moviesService.search(q, 1)` and `tvService.search(q, 1)` concurrently and merge client-side the way the web does: dedupe on `` `${media_type}:${tmdb_id}` ``, sort by `popularity` descending. One dead half still shows the other.
- Results render as a rail-shaped grid of `Card`s linking to the detail screens. Searching again replaces them; the focus count must follow.
- Submit on an explicit **Search** key press, not per keystroke — a TV's network is the slow part and a per-letter search would queue nine requests for a nine-letter title.
- Empty query, no results, and a failed search each keep a focus target.

- [ ] **Step 1: Write the failing `Keyboard` tests**, then implement. Every cell focusable and actionable; `KEY_ROW_COUNTS` matches the rendered rows exactly; pressing a letter appends, Delete removes one, Clear empties; no blank or disabled cell exists.

- [ ] **Step 2: Write the failing search-screen tests**

Cover: typing builds a query and shows it; Backspace with text deletes and does **not** navigate; Backspace with an empty field leaves (or whatever you chose — assert your decision); Search calls both services once each and merges deduped and popularity-sorted; one rejected half still renders the other; no results reads as no results with a focus target; results are focusable and link to `/bigscreen/movie/{id}` and `/bigscreen/show/{id}`.

- [ ] **Step 3: Run, implement, run. Add the CSS. Verify the build lists `/bigscreen/search`. Commit.**

---

## Task 7: The My List screen

**Files:**
- Create: `frontend/src/app/(bigscreen)/bigscreen/list/page.tsx` + `page.test.tsx`

**Behaviour:**
- `watchlistService.list(userId)` with `useTvProfile().profile.id`. The endpoint returns at most 200 rows, newest first, with no paging — so render them all as a focusable grid rather than the 20-card cap home's rail uses.
- **Removal, which home's rail cannot offer.** Pressing an item opens its detail screen; a separate, clearly-labelled control removes it. Removal is optimistic and reverts on failure. The control must not unmount while focused — an unmounting focused element drops DOM focus to `<body>`.
- A **423** means passcode-locked: clear the profile and replace to the picker. It must never read as "your list is empty" (Review Focus 4).
- No profile selected, an empty list, and a failed load each keep a focus target.
- `useBackKey` → `/bigscreen`.

- [ ] **Step 1: Write the failing tests**, covering each bullet, then implement. Include: a 423 redirects rather than rendering empty; removal is optimistic and reverts on failure; the grid's declared count matches the items rendered after a removal.

- [ ] **Step 2: Run, implement, run. Verify the build lists `/bigscreen/list`. Commit.**

---

## Task 8: One test that crosses a screen boundary

**Files:**
- Create: `frontend/src/app/(bigscreen)/journeys.test.tsx`

**Why.** A parked finding from stage 4: **every frontend test mounts a single page**, and that blind spot is why a whole-branch review found a Critical and three Importants that seven per-screen reviews could not — a card press landing on a bare 404, a retry blanking its own focus, an error boundary whose only reachable control looped. The per-screen tests are not the problem; the absence of any test that *moves* is.

Write a small number of journey tests that mount one screen, act, and assert on what the next screen receives. You cannot exercise the App Router's real navigation in jsdom, so assert the **contract between screens** instead: the href a card produces is a route this stage builds; the `?file=` an episode press produces is what the watch route will read; a 423 anywhere sends the viewer to the picker; `useBackKey` is installed on every screen that has one.

- [ ] **Step 1: Write the tests**

At minimum:
- **Every href the TV can produce resolves to a route that exists.** Collect them from `TV_RAILS`/`catalogItemToCard`, `fetchContinueWatching`, `fetchMyList`, `NAV_TARGETS` and the search results, then assert each matches a real file under `(bigscreen)/bigscreen/` (or is deliberately the catch-all). This is the test that would have caught the stage-4 Critical.
- **Every screen that should claim Back does.** Walk the page files and assert `useBackKey` is imported and called in each, with a documented allowlist for any that deliberately does not.
- **No screen renders with zero focus stops in its initial state.** Mount each page with its services stubbed to a pending promise and assert something is focusable.
- An episode press produces a `?file=` only when an index resolved.

- [ ] **Step 2: Run, implement, run. Commit.**

---

## Notes for whoever runs this

**What this stage deliberately does not do.** `/bigscreen/watch/{id}` is **stage 7** — Play and Resume navigate there, and until it exists those presses land on the `[...rest]` catch-all, which says so honestly and keeps a focus target. The 4K opt-in is **stage 8** (§7.3): the TV requests 1080p here and builds no quality picker. Subtitles are **stage 9**. The webOS shell and its real Back-at-the-root exit are **stage 10** — home and pair both claim Back and do nothing with it on purpose, and both say so in a comment.

**Two defects in the web's equivalent screens that this stage must not copy.** Its show screen hard-codes `season: 1, episode: 1` in the hero's Play and shows a static "Season pack · streams the selected episode" label with **no selection behind it**; and its Play button always mints a new torrent, so pressing it twice downloads the same film twice. The first is why Task 5 resolves a real `file_index`; the second is why Task 3 asks what already exists before offering Play.
