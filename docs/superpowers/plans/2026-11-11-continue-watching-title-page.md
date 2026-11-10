# Continue Watching Opens the Title Page — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On the web and the TV, a Continue Watching card opens the title's page, not the player. The TV player gets a top-left Back control to that page, and the web player's back arrow goes there too.

**Architecture:**
- **Shared title identity:** two pure helpers in `@/lib/contentId.ts` say which title a content id or a download belongs to. Each surface then has its own route builder:
  - `@/lib/titlePageHref.ts` for the web;
  - `(bigscreen)/_data/titleHref.ts` for the TV, a sibling of `watchHref.ts`.

  Each builder is paired with the parser for its own query spelling.
- **Title pages:** they read an "asked episode" from the query and point their one primary control at it.
- **TV player:** it derives its exit from the watch identity on every render. Back, Stop, `LoadStatus` and `Gone` all leave through that one exit.

**Tech Stack:** Next.js 15.2 App Router, React 19, TypeScript, Vitest 2.1.9 + RTL 16 (jsdom), hand-authored `frontend/public/bigscreen.css`.

**Spec:** `docs/superpowers/specs/2026-11-11-continue-watching-title-page-design.md`

## Global Constraints

- **Paths and commands:** all paths are under `frontend/` unless they start with `docs/` or `CLAUDE.md`. Run commands from `frontend/`.
  - One file: `npx vitest run '<path>'`
  - TV suite: `npm run test:tv`
  - Whole suite: `npx vitest run`
  - Typecheck: `npx tsc --noEmit`
- **Web and TV routes never cross:**
  - The TV never navigates to a `(web)` route, and never imports `@/lib/titlePageHref`.
  - The web never links to `/bigscreen/*`.
- **TV imports:** no `(bigscreen)` file imports `@/components`, `framer-motion` or `globals.css`, and that applies to comment text too (`legacy-target.test.ts`). An `@/lib` module a TV file imports must not import those either.
- **`noDeadExports`:** every new export under `(bigscreen)/` must have a non-test production caller once its task lands.
- **Page files:** a Next `page.tsx` exports only `default` and framework names. Parsers live in `_data/` or `@/lib`.
- **TV stylesheet (`public/bigscreen.css`):**
  - No `backdrop-filter`, `blur(`, `mix-blend`, SVG filters, or positional selectors such as `:first-child`/`:nth-*`.
  - New rules are APPENDED at the foot of the file.
  - A `--hidden` modifier is `opacity: 0` only.
- **Focus on the TV surface:** row indexes are named constants, never literals. Each screen has one `useFocusGrid`, one `useBackKey` and one `useRevealOnKey`, owned by the route. Components take `row` + `focusProps`.
- **Leaving the TV player:** it is left only through `leave(href)`, which flushes progress and then calls `router.replace`.
- **Copy, exactly:**

  | Where | Text |
  |---|---|
  | Web show hero | `Resume S01·E03` / `Play S01·E04` (padded via `episodeCode`) |
  | Web movie | `Resume from 42:10` (`@/utils/format` `formatTime`) |
  | TV Back | `‹` (aria-hidden) then the title; `Home` when unknown |
  | Web player back | `Back to {name}`, or `Back to downloads` |

- **Thresholds:** web movie Resume shows iff `!completed && torrent_id && current_time > 30 && percentage < 98`. Web show Resume needs `!completed && torrent_id && percentage > 0`.
- **Season 0 is never an ask.** It is Specials, and also the backend's `s0` fallback. Regular seasons are `season_number > 0` on both surfaces.
- **Test file layout:** new `vi.mock`/`vi.hoisted` blocks and new `describe`s in `ShowDetailView.test.tsx`, `MovieDetailView.test.tsx` and `EpisodeList.test.tsx` are APPENDED at the end of the file. `services/torrents.test.ts:12-16` cites line numbers in all three files, and `vi.mock` is hoisted wherever it sits.
- **Commits:** Conventional Commits. The orchestrator commits each task's files after its wave gate; implementers do not commit.

## Review Focus

1. **A season pack resumes the right file through every hop, file 0 included.** The hops are CW card → title page → Resume → `/streaming/{t}?file=0` (web) or `/bigscreen/watch/{t}?file=0` (TV). *Tests:* Task 2 "file 0", Task 3 pack resume, Task 5 "file 0 survives".
2. **The TV ring never lands on Back without an Up press.** This covers arrival, after a recovery empties the scrub row, and after the subtitle picker closes. An OK there leaves the film. *Tests:* Task 7 rows "arrival", "recovery", "picker close".
3. **Malformed query values fall back to today's behaviour without a 404 or a throw.** Examples: `?season=abc`, `?season=0`, `?s=-1`, `?season=1&season=2`, `?s=99999999999999999999`. *Tests:* Task 1 `episodeAskFrom` table, Task 3 `showAskFrom` table and the "junk values" screen row.
4. **The web show hero can't start a download while the progress that would make it Resume is still loading.** *Test:* Task 5 "while progress loads".
5. **The web player still knows its title while buffering or blocked**, when `streamingInfo` is null. *Tests:* Task 6 "buffering" and "blocked".

## Execution waves

| Wave | Tasks | Why |
|---|---|---|
| A | 1, 2 | Task 1 is a dependency; Task 2 needs nothing |
| B | 3, 4, 5, 6 | All consume Task 1; their file sets are disjoint |
| C | 7 | Consumes Tasks 1 and 3; shares `journeys.test.tsx` and `titleHref.ts` with Task 3 |

---

### Task 1: Shared title identity and the web title-page route

**Files:**
- Modify: `src/lib/contentId.ts` (append after `showNameFromTitle`)
- Create: `src/lib/titlePageHref.ts`
- Test: `src/lib/contentId.test.ts` (append), `src/lib/titlePageHref.test.ts` (new)

**Interfaces:**
- Consumes: the existing `ContentIdInput`, `parseContentId` and `tmdbIdFromContentId` in `contentId.ts`.
- Produces:
  ```ts
  // src/lib/contentId.ts — stays import-free
  export function titleOfContentId(contentId: string | null | undefined): ContentIdInput | null
  export function titleOfStream(
    status: { tmdb_id?: number | null; media_type?: string | null; season?: number | null; episode?: number | null } | null | undefined,
    hint?: { season?: number | null; episode?: number | null } | null,
  ): ContentIdInput | null
  // src/lib/titlePageHref.ts — WEB routes only; imports `type ContentIdInput` from './contentId'
  export function titlePageHref(t: ContentIdInput): string
  export function episodeAskFrom(sp: Record<string, string | string[] | undefined>): { season?: number; episode?: number }
  ```

- [ ] **Step 1: Write the failing tests**

  Append to `contentId.test.ts`, one `it` per row, `toEqual`:

  `titleOfContentId`

  | Input | Expected |
  |---|---|
  | `'movie:603'` | `{ kind: 'movie', tmdbId: 603 }` |
  | `'tv:1399:s2:e5'` | `{ kind: 'tv', tmdbId: 1399, season: 2, episode: 5 }` |
  | `'tv:1399'` | `{ kind: 'tv', tmdbId: 1399 }` |
  | `'tv:1399:s0:e4'` | `{ kind: 'tv', tmdbId: 1399 }` (s0 is never an ask) |
  | `'Interstellar'` | `null` |
  | `'movie:abc'` | `null` |
  | `'movie:0'` | `null` |
  | `null` | `null` |
  | `undefined` | `null` |
  | `''` | `null` |

  `titleOfStream`

  | Status | Hint | Expected |
  |---|---|---|
  | `{ tmdb_id: 1399, media_type: 'tv', season: 2, episode: 3 }` | none | `{ kind: 'tv', tmdbId: 1399, season: 2, episode: 3 }` |
  | `{ tmdb_id: 1399, media_type: 'tv', season: 2, episode: null }` | `{ season: 2, episode: 5 }` | episode 5 |
  | that same pack | none | `{ kind: 'tv', tmdbId: 1399 }` |
  | a pack | `{ season: 0, episode: 4 }` | show-level |
  | `{ tmdb_id: 603, media_type: 'movie' }` | none | `{ kind: 'movie', tmdbId: 603 }` |
  | `{ tmdb_id: 603, media_type: null }` | none | movie |
  | `{ tmdb_id: null, media_type: 'tv' }` | none | `null` |
  | `{ tmdb_id: 0 }` | none | `null` |
  | `null` | none | `null` |

  New `titlePageHref.test.ts`:

  `titlePageHref`

  | Input | Expected |
  |---|---|
  | `{ kind: 'movie', tmdbId: 603 }` | `'/movies/603'` |
  | `{ kind: 'tv', tmdbId: 1399, season: 2, episode: 5 }` | `'/tv/1399?season=2&episode=5'` |
  | `{ kind: 'tv', tmdbId: 1399 }` | `'/tv/1399'` |

  `episodeAskFrom`

  | Input | Expected |
  |---|---|
  | `{}` | `{}` |
  | `{ season: '2', episode: '5' }` | `{ season: 2, episode: 5 }` |
  | `{ season: '2' }` | `{ season: 2 }` |
  | `{ episode: '5' }` | `{}` (an episode only rides with a season) |
  | `{ season: ['3', '4'], episode: '1' }` | `{ season: 3, episode: 1 }` (first value) |
  | `season` of `'0'`, `'-1'`, `'abc'`, `'1.5'`, `'1e3'`, `' '` or `'99999999999999999999'` | `{}` |
  | `{ season: '2', episode: '0' }` | `{ season: 2 }` |

  Round trip: `episodeAskFrom(Object.fromEntries(new URL(titlePageHref({ kind: 'tv', tmdbId: 1399, season: 2, episode: 5 }), 'http://web.test').searchParams))` equals `{ season: 2, episode: 5 }`.

- [ ] **Step 2: Run to verify they fail**

  Run: `npx vitest run src/lib/contentId.test.ts src/lib/titlePageHref.test.ts`
  Expected: FAIL. The functions are not exported, and the module does not exist.

- [ ] **Step 3: Implement**

  - **`titleOfContentId`:** take the tmdb id via `tmdbIdFromContentId`, which must be > 0, and the kind and season/episode via `parseContentId`. A tv id keeps S/E only when both are ≥ 1.
  - **`titleOfStream`:** the tmdb id must be > 0. `media_type !== 'tv'` means a movie. Otherwise `season = status.season ?? hint?.season` and `episode = status.episode ?? hint?.episode`, kept only when both are ≥ 1. Document that this is the same precedence as `(bigscreen)/_data/useWatchProgress.watchIdentity`, and that it never trusts `/info`'s `content_id`, which has an `s0` fallback.
  - **`episodeAskFrom`:** take the first array value, accept `/^\d+$/` only, require `Number.isSafeInteger` and ≥ 1, and keep `episode` only when `season` is kept.
  - **Doc comments:** say that `titlePageHref.ts` is web-only, as `resumeUrlFor` is, and that the TV builds its own routes in `(bigscreen)/_data/titleHref.ts`.

- [ ] **Step 4: Run to verify they pass**

  Run the same command, then `npm run test:tv`. `contentId.ts` must still have zero imports, so the one-hop guard stays green.
  Expected: PASS.

- [ ] **Step 5: Commit**

  ```bash
  git add src/lib/contentId.ts src/lib/contentId.test.ts src/lib/titlePageHref.ts src/lib/titlePageHref.test.ts
  git commit -m "feat(lib): say which title a content id or a download belongs to"
  ```

---

### Task 2: The web movie page offers Resume

**Files:**
- Modify: `src/components/movies/MovieDetailView.tsx` (progress lookup; actions row at ~355-373)
- Test: `src/components/movies/MovieDetailView.test.tsx` (append only)

**Interfaces:**
- Consumes: `useProgress()` from `@/context/ProgressContext` (`getMovieProgress(contentId)`), `resumeUrlFor` from `@/lib/contentId`, and `formatTime` from `@/utils/format`.
- Produces: a `<Button data-testid="movie-resume-button">`, first in the actions row, when resumable.

- [ ] **Step 1: Write the failing tests**

  Append the setup at the end of the file:

  ```ts
  const progress = vi.hoisted(() => ({ data: {} as Record<string, StreamingProgress> }));
  vi.mock('@/context/ProgressContext', () => ({
    useProgress: () => ({ progressData: progress.data, getMovieProgress: (id: string) => progress.data[id] ?? null, isLoading: false }),
  }));
  ```

  Then add a `describe('Resume')` that resets `progress.data = {}` in `beforeEach`, with these cases:

  - **"offers Resume from the saved position"**
    - Given `progress.data['movie:693134'] = { …row, torrent_id: 't-5', file_index: null, current_time: 2530, percentage: 40, completed: false }`.
    - `getByTestId('movie-resume-button')` has text `Resume from 42:10`.
    - A click gives `mockPush('/streaming/t-5')`.
    - `mockHandleCatalogStreamingStart` is not called.
  - **"file 0 rides along"**: with `file_index: 0` the click gives `mockPush('/streaming/t-5?file=0')`.
  - **"keeps Play beside Resume"**: `movie-play-button` is still rendered and still calls `handleCatalogStreamingStart`.
  - **"offers no Resume when…"**: one `it` per case, each expecting `queryByTestId('movie-resume-button')` to be null:
    - `completed: true`;
    - `current_time: 20`;
    - `percentage: 98`;
    - `torrent_id: null`;
    - no row.

- [ ] **Step 2: Run to verify they fail**

  Run: `npx vitest run src/components/movies/MovieDetailView.test.tsx`
  Expected: the new cases FAIL because there is no resume button. The existing cases pass.

- [ ] **Step 3: Implement**

  - Read the row with `getMovieProgress(contentId)`, reusing the existing `contentId`.
  - Compute `resumable` using the Global Constraints rule.
  - When `resumable`, render a primary `Resume from {formatTime(row.current_time)}` button with `leftIcon={<PlayIcon/>}` and the same className as Play. It calls `router.push(resumeUrlFor({ torrent_id, file_index }))`.
  - Play becomes `variant={resumable ? 'glass' : 'primary'}`. Its handler and testid are unchanged.

- [ ] **Step 4: Run to verify they pass**

  Run the same file, then `npx tsc --noEmit`.
  Expected: PASS.

- [ ] **Step 5: Commit**

  ```bash
  git add src/components/movies/MovieDetailView.tsx src/components/movies/MovieDetailView.test.tsx
  git commit -m "feat(web): the movie page offers Resume from where the profile stopped"
  ```

---

### Task 3: TV title routes; Continue Watching opens the title screens; the show screen honours `?s=&e=`

**Files:**
- Create: `src/app/(bigscreen)/_data/titleHref.ts`, `src/app/(bigscreen)/_data/titleHref.test.ts`
- Modify:
  - `src/app/(bigscreen)/_data/continueWatching.ts` (lines 155, 172, 187 and the docblock at ~196-218)
  - `src/app/(bigscreen)/_data/rails.ts:202-205`
  - `src/app/(bigscreen)/bigscreen/show/[id]/page.tsx`
- Test:
  - `_data/continueWatching.test.ts`
  - `bigscreen/show/[id]/page.test.tsx`
  - `bigscreen/show/[id]/page.pack.test.tsx`
  - `bigscreen/movie/[id]/page.test.tsx`
  - `(bigscreen)/journeys.test.tsx`

**Interfaces:**
- Consumes: `titleOfContentId` (Task 1), the existing `ContentIdInput` and `watchHref`.
- Produces (all in `_data/titleHref.ts`; it imports only `@/lib/contentId`):
  ```ts
  export interface EpisodeAsk { season: number; episode: number }
  export const movieHref = (tmdbId: number): string            // '/bigscreen/movie/603'
  export const showHref = (showId: number, at?: EpisodeAsk | null): string  // '/bigscreen/show/1399' | '…?s=2&e=5'
  export function titleHref(t: ContentIdInput): string          // dispatches to the two above
  export function showAskFrom(params: Pick<URLSearchParams, 'get'>): { season: number | null; episode: number | null }
  ```
  The query keys `s` and `e` are private constants that `showHref` and `showAskFrom` both use.

- [ ] **Step 1: Write the failing `titleHref` tests**

  **Builders.** Copy the table style of `watchHref.test.ts`:

  | Call | Expected |
  |---|---|
  | `movieHref(603)` | `'/bigscreen/movie/603'` |
  | `showHref(1399)` | `'/bigscreen/show/1399'` |
  | `showHref(1399, null)` | `'/bigscreen/show/1399'` |
  | `showHref(1399, { season: 2, episode: 5 })` | `'/bigscreen/show/1399?s=2&e=5'` |
  | `titleHref` of a movie | movie screen |
  | `titleHref` of an episode | `?s=2&e=5` |
  | `titleHref` of a show-level title | bare show screen |

  **`showAskFrom`.** Each value is parsed on its own, as a positive safe integer:

  | Query | Expected |
  |---|---|
  | `''` | `{ season: null, episode: null }` |
  | `'s=2&e=5'` | `{ season: 2, episode: 5 }` |
  | `'s=2'` | `{ season: 2, episode: null }` |
  | `'e=5'` | `{ season: null, episode: 5 }` |
  | `s` of `''`, `' '`, `'abc'`, `'0'`, `'-1'`, `'1.5'` or `'1e21'` | `season` is `null` |

  **Round trip.** `showAskFrom(new URL(showHref(1399, { season: 2, episode: 5 }), 'http://tv.test').searchParams)` gives `{ season: 2, episode: 5 }`.

- [ ] **Step 2: Update and add the Continue Watching tests (`continueWatching.test.ts`)**

  - **Update existing expectations:**
    - lines 132-156 and 239-262: the tv resume card's href is `'/bigscreen/show/1399?s=1&e=2'`;
    - lines 282-294: rename the test to "links each card to its title's screen, never the player". Expect `'tv:10'` → `'/bigscreen/show/10?s=1&e=4'` and `'movie:2'` → `'/bigscreen/movie/2'`. Keep the `/streaming/` guard and add `not.toContain('/bigscreen/watch/')`;
    - lines 296-300: move the file-0 pin onto a legacy id. `{ movie_id: 'The Old Title', torrent_id: 'pack', file_index: 0 }` → `'/bigscreen/watch/pack?file=0'`;
    - lines 333-339: add `expect(items[0].href).toBe('/bigscreen/watch/t1')`.
  - **Add:**
    - `'movie:0'` with torrent `t1` → `'/bigscreen/watch/t1'`;
    - a `'tv:1399:s0:e4'` unfinished row → `'/bigscreen/show/1399'`.
  - **Must stay green:** the Up next card (168-197, 403-419) still `toEqual` `href: '/bigscreen/show/1399'`.

- [ ] **Step 3: Write the failing show-screen tests (`show/[id]/page.test.tsx`)**

  **Search-params mock.** Change the `next/navigation` mock to add `useSearchParams: () => search.current`. `search` is `vi.hoisted(() => ({ current: new URLSearchParams() }))` and is reset in `beforeEach`. Make the same change in `page.pack.test.tsx`; without it both files go red together.

  **New `describe('an asked episode (?s=&e=)')`.** Use the existing `show()`, `season()`, `prog()`, `stateOf`, `ringSettled` and `seasonBtn` helpers. Prove which episode was asked with `stateFor.mockImplementation` keyed on `(season, episode)`.

  | Case | Setup | Expect |
  |---|---|---|
  | "opens the asked season over the latest-watched one" | history latest is season 1; `s=2&e=2` | `seasonBtn(2)` is `aria-pressed="true"`; `getSeason` is never called with `(1399, 1)`; the subject matches `/S2 · E2/`; `stateFor` is called with `objectContaining({ season: 2, episode: 2 })` and never with `{ season: 2, episode: 1 }` |
  | "the ring lands on the asked episode's control" | `stateFor` resumes at 90 | after `ringSettled()`, `document.activeElement` is the button named `Resume from 1:30` |
  | "the badge follows the asked episode" | same | exactly one `.bs-ep__badge`, inside episode 2's button |
  | "a finished asked season is not skipped" | season 1 fully watched, season 2 exists; `s=1&e=9` | `seasonBtn(1)` is pressed; `getSeason` is never called with `(1399, 2)`; the note reads `You’ve finished Season 1. Pick another season below.` |
  | "an unknown season falls back to today's pick" | `s=9&e=1` | the latest-watched season opens |
  | "an unlisted episode falls back to the first unwatched" | `s=1&e=9`, E1 watched | the subject matches `/S1 · E2/` |
  | "a watched asked episode falls back to the first unwatched" | `s=1&e=1`, E1 watched | the subject matches `/S1 · E2/` |
  | "junk values change nothing" | `s=abc&e=-1` | identical to the no-query behaviour (latest season, first unwatched) |
  | "the ask survives a trip to another season and back" | `s=2&e=2`, then press season 1, then season 2 | the subject matches `/S2 · E2/` again |

  **Pack suite (`page.pack.test.tsx`).** Use the real `titleStateFor`. With `s=2&e=2`, make `getProgressByMovie` return `{ movie_id: 'tv:1399:s2:e2', torrent_id: 'pk', file_index: 4, percentage: 30, current_time: 90, completed: false, … }` and `getTorrentStatus` → `pack()`. Clicking `Resume from 1:30` gives `router.push('/bigscreen/watch/pk?file=4')`.

  **Movie suite (`movie/[id]/page.test.tsx`).** Add "a resumable film lands the ring on Resume". `mount({ kind: 'resume', href: '/bigscreen/watch/t1', atSeconds: 90 })`, then `ringSettled()`; `activeElement` is the button named `Resume from 1:30`. The existing `primary()` regex does not match "Resume from", so name the button explicitly. This pins behaviour that already exists, so this case passes before any code changes.

- [ ] **Step 4: Update `journeys.test.tsx`**

  - **Search-params mock.** Make `useSearchParams` read a box on `nav` (`nav.search.current`) and reset it beside `nav.params.current = {}`.
  - **Producers (lines 741-790).**
    - Add a CW row `progressRow({ id: 'd', movie_id: 'Legacy Title', torrent_id: 't9', file_index: 7 })`, so `'/bigscreen/watch/t9?file=7'` is still produced (through the fallback).
    - Add `expect(all).toContain('/bigscreen/show/1399?s=2&e=5')` and `toContain('/bigscreen/movie/603')`.
  - **Rewrite lines 995-1013 as the Continue Watching → show screen → player journey.**
    - The resume card's href is `showHref(1399, { season: 2, episode: 2 })`.
    - Mount the show screen with `nav.params.current = { id: '1399' }` and `nav.search.current` set to that href's query.
    - Make `getProgressByMovie` return the row on `'pk'`/file 4, and `getTorrentStatus` → `packRow()`.
    - The subject is S2 · E2. Pressing `Resume from …` pushes exactly `watchHref('pk', 4)`.
    - Keep the file's warning header about not relaxing these pins.

- [ ] **Step 5: Run to verify they fail**

  Run: `npx vitest run 'src/app/(bigscreen)/_data' 'src/app/(bigscreen)/bigscreen/show' 'src/app/(bigscreen)/bigscreen/movie' 'src/app/(bigscreen)/journeys.test.tsx'`
  Expected: the new and updated cases FAIL. The module is missing, the hrefs are still watch URLs, and the query is ignored.

- [ ] **Step 6: Implement `_data/titleHref.ts`**

  Write a doc comment like the one in `watchHref.ts`. It is its own module because the screen suites mock `_data/title`. `showAskFrom`'s private `positive(raw)` treats null or blank as null, then applies `Number`, `Number.isSafeInteger` and ≥ 1. Do not import from `_player/`.

- [ ] **Step 7: Implement the Continue Watching and rails changes**

  - **Resume cards, tv and movie alike.** Compute `const t = titleOfContentId(row.movie_id)`. The href is `t ? titleHref(t) : watchHref(row.torrent_id, row.file_index)`.
  - **Up next.** The href is `showHref(showId)`.
  - **Filters and artwork.** Keep the torrent filters (lines 166, 181) and the art rule.
  - **Rails.** `rails.ts` `catalogItemToCard` uses `showHref`/`movieHref`. The output is unchanged; `rails.test.ts:291-292` pins it.
  - **Docblock rule list.** Rewrite it to say:
    - resume cards open the title's screen, which re-asks `titleStateFor`, which in turn resumes the row's own torrent and file;
    - only an unidentifiable title goes straight to the player.
  - **Web paragraph.** Replace "The web does this differently and wrongly … leaves the link on the file just finished" with: "The web's card still labels `episode + 1` without checking it exists, but links to the show page, which works out what comes next."

- [ ] **Step 8: Implement the show screen**

  - **Split the page.** Rename the default body to `ShowScreen`. It reads `const { season: askSeason, episode: askEpisode } = showAskFrom(useSearchParams())` as primitives and adds both to the load effect's deps. The default export becomes `<Suspense fallback={<LoadStatus noun="show" failed={false} onRetry={() => window.location.reload()} />}><ShowScreen /></Suspense>`, the same pattern as `watch/[id]/page.tsx:321-341`.
  - **`loadShow(id, profileId, asked: { season: number | null; episode: number | null })`.**
    - `askedSeason` is `asked.season` when it is a listed regular season, otherwise null.
    - The open season is `askedSeason ?? <today's latest-or-first expression>`.
    - The finished-season auto-advance runs only when `askedSeason === null`.
    - It returns `ask: askedSeason === null ? null : { season: askedSeason, episode: asked.episode }` on `Opened`.
  - **`Loaded`: one memo decides the subject.** Add `askedEp = useMemo(...)` over `[opened.ask, open, entry, traces]`. It is the asked episode when `open === ask.season`, the episode is listed, and its trace mark is not `'watched'`; otherwise null.
    - `upNext = entry ? (askedEp ?? nextUnwatched(episodes, traces)) : null`, which also feeds the badge.
    - The default-subject effect's `target = askedEp ?? nextUnwatched(…)`, with `askedEp` added to its deps.
    - Never put an inline object literal in those deps.
  - **Unchanged:** focus (`initialRow: ACTION_ROW`), Back (`router.push(HOME)`) and `EpisodeList`.
  - **Docs.** Update the docblock with an "AN ASKED EPISODE" paragraph, and the `HISTORY_LIMIT` comment.

- [ ] **Step 9: Run to verify they pass**

  Run the Step 5 command, then `npm run test:tv` and `npx tsc --noEmit`.
  Expected: PASS. `noDeadExports` is satisfied: `movieHref` by rails, `showHref` by CW and rails, `titleHref` by CW, `showAskFrom` by the show page.

- [ ] **Step 10: Commit**

  ```bash
  git add 'src/app/(bigscreen)/_data/titleHref.ts' 'src/app/(bigscreen)/_data/titleHref.test.ts' 'src/app/(bigscreen)/_data/continueWatching.ts' 'src/app/(bigscreen)/_data/continueWatching.test.ts' 'src/app/(bigscreen)/_data/rails.ts' 'src/app/(bigscreen)/bigscreen/show/[id]/page.tsx' 'src/app/(bigscreen)/bigscreen/show/[id]/page.test.tsx' 'src/app/(bigscreen)/bigscreen/show/[id]/page.pack.test.tsx' 'src/app/(bigscreen)/bigscreen/movie/[id]/page.test.tsx' 'src/app/(bigscreen)/journeys.test.tsx'
  git commit -m "feat(tv): Continue Watching opens the title screen, on the episode the card is about"
  ```

---

### Task 4: Web Continue Watching opens the title page

**Files:**
- Modify:
  - `src/components/browse/ContinueWatchingRow.tsx` (card types 30-48, builders 145-180, anchor and aria-labels 364-375, header 1-15)
  - `src/lib/nextEpisode.ts:8-11` (prose)
  - `CLAUDE.md` (the content_id paragraph)
- Test: `src/components/browse/ContinueWatchingRow.test.tsx`

**Interfaces:**
- Consumes: `titleOfContentId` (Task 1), `titlePageHref` (Task 1), and the existing `resumeUrlFor`.
- Produces: nothing new for other tasks.

- [ ] **Step 1: Write the failing tests**

  Update the existing pins:

  | Lines | Card | Link name | `href` |
  |---|---|---|---|
  | 176-184 | show | `/Open Foundation/` | `'/tv/54321?season=1&episode=3'` |
  | 186-191 | film | `/Open Interstellar/` | `'/movies/12345'` |

  Add:

  | Case | Setup | Expect |
  |---|---|---|
  | "an Up next card opens the show page on the finished episode" | a completed tv row | `href` is `'/tv/54321?season=1&episode=3'` and the text `Up next` is still present |
  | "a title it cannot identify still opens the player" | `{ ...movieProgress, movie_id: 'Interstellar' }` | `href` is `'/streaming/torrent-movie-1'` |
  | "no identified card links to the player" | the default rows | no `link`'s href starts with `/streaming/` |
  | "Remove never navigates" | click Remove inside a card | no navigation, and `deleteProgress` is still called |

  For the last row, follow `PosterCard.test.tsx` for how `next/link` and `next/navigation` are mocked or provided.

  The aria-labels are exactly:

  | Card | Label |
  |---|---|
  | tv resume | `` `Open ${name}, resume S01·E03` `` |
  | Up next | `` `Open ${name}, up next S01·E04` `` |
  | film | `` `Open ${name}, ${pct}% watched` `` |

- [ ] **Step 2: Run to verify they fail**

  Run: `npx vitest run src/components/browse/ContinueWatchingRow.test.tsx`
  Expected: FAIL, because the hrefs are still `/streaming/…`.

- [ ] **Step 3: Implement**

  - Add `href: string` to both card types: `const t = titleOfContentId(item.movie_id); href = t ? titlePageHref(t) : resumeUrlFor(...)`.
  - Replace `<a href>` with `next/link`'s `Link`. Remove still calls `preventDefault` + `stopPropagation`.
  - Keep the `!item.torrent_id` skip and the `episode + 1` label, which are out of scope.
  - Update the header comment.
  - **`lib/nextEpisode.ts:8-11`:** reword so it says the web's card links to the show page, and only its `episode + 1` label is unchecked.
  - **`CLAUDE.md`:** in the content_id paragraph, replace "`ContinueWatchingSection.tsx` re-parses the string to group episodes under one show card" with "`components/browse/ContinueWatchingRow.tsx` (web) and `(bigscreen)/_data/continueWatching.ts` (TV) re-parse it to group episodes under one show card and link each card to its title page".

- [ ] **Step 4: Run to verify they pass**

  Run the same file, then `npx tsc --noEmit`.
  Expected: PASS.

- [ ] **Step 5: Commit**

  ```bash
  git add src/components/browse/ContinueWatchingRow.tsx src/components/browse/ContinueWatchingRow.test.tsx src/lib/nextEpisode.ts ../CLAUDE.md
  git commit -m "feat(web): Continue Watching opens the title page, not the player"
  ```

---

### Task 5: The web show page opens on the asked episode

**Files:**
- Create: `src/lib/showHero.ts`, `src/lib/showHero.test.ts`
- Modify:
  - `src/app/(web)/tv/[id]/page.tsx`
  - `src/components/tv/ShowDetailView.tsx` (props 128-130, season state 137-140, `handlePlay` 226-244, hero 297-314, `EpisodeList` 429-433, header 10-13)
  - `src/components/tv/EpisodeList.tsx` (props 146-152 and 525-529, article 213-223)
- Test: `src/components/tv/ShowDetailView.test.tsx` and `src/components/tv/EpisodeList.test.tsx` (append only)

**Interfaces:**
- Consumes:
  - `episodeAskFrom` (Task 1);
  - `findNextEpisode(ref: { tmdbId; season; episode }): Promise<{ verdict: { k: 'ready'; next: { season; episode; name } } | { k: 'none' } | { k: 'unknown' } }>` from `@/lib/nextEpisode`;
  - `useProgress()` (`progressData`, `isLoading`);
  - `buildContentId` and `resumeUrlFor` from `@/lib/contentId`.
- Produces:
  ```ts
  // src/lib/showHero.ts — imports only @/types and ./contentId
  export interface EpisodeAt { season: number; episode: number }
  export function episodeCode(at: EpisodeAt): string                 // 'S01·E03'
  export type ShowHeroAction =
    | { kind: 'resume'; at: EpisodeAt; href: string }
    | { kind: 'play'; at: EpisodeAt }
    | { kind: 'pending' };
  export function showHeroAction(a: {
    focus: EpisodeAt | null;
    row: StreamingProgress | null;          // the profile's row for `focus`
    next: EpisodeAt | null | undefined;     // undefined = still looking; null = none/unknown
    progressLoading: boolean;
  }): ShowHeroAction
  // ShowDetailView
  export interface ShowDetailViewProps { show: ShowDetail; initialSeason?: number; initialEpisode?: number }
  // EpisodeList
  export interface EpisodeListProps { showId: number; seasonNumber: number; episodes: Episode[]; highlightEpisode?: number }
  ```

- [ ] **Step 1: Write the failing `showHero` tests**

  The decision order, one `it` per row, `toEqual`:

  | Input | Result |
  |---|---|
  | `focus: null` | `{ kind: 'play', at: { season: 1, episode: 1 } }`, even while `progressLoading` |
  | focus set and `progressLoading` | `{ kind: 'pending' }` |
  | row `{ completed: false, torrent_id: 't-9', file_index: 4, percentage: 30 }` | `{ kind: 'resume', at: focus, href: '/streaming/t-9?file=4' }` |
  | same row with `file_index: 0` | `href` is `'/streaming/t-9?file=0'` |
  | row completed, `next: undefined` | `pending` |
  | row completed, `next: { season: 1, episode: 4 }` | `play` at that episode |
  | row completed, `next: null` | `play` at `{ 1, 1 }` |
  | row with `torrent_id: null` | `play` at `focus` |
  | row with `percentage: 0` | `play` at `focus` |
  | `row: null` | `play` at `focus` |

  Also: `episodeCode({ season: 1, episode: 3 })` is `'S01·E03'`, and `episodeCode({ season: 10, episode: 12 })` is `'S10·E12'`.

- [ ] **Step 2: Write the failing view tests**

  **`EpisodeList.test.tsx`** (append):
  - with `highlightEpisode={2}`, `episode-row-2` has `aria-current="true"` and rows 1 and 3 have no `aria-current`;
  - with the prop omitted, no row has `aria-current`.

  **`ShowDetailView.test.tsx`** (append).

  Setup:

  ```ts
  const progress = vi.hoisted(() => ({ data: {} as Record<string, StreamingProgress>, isLoading: false }));
  vi.mock('@/context/ProgressContext', () => ({ useProgress: () => ({ progressData: progress.data, isLoading: progress.isLoading, getMovieProgress: (id: string) => progress.data[id] ?? null }) }));
  const next = vi.hoisted(() => ({ fn: vi.fn() }));
  vi.mock('@/lib/nextEpisode', () => ({ findNextEpisode: (...a: unknown[]) => next.fn(...a) }));
  ```

  Reset both in `beforeEach`, defaulting `next.fn` to resolve `{ verdict: { k: 'unknown' }, runtimeS: null }`. Then the cases:

  | Case | Setup | Expect |
  |---|---|---|
  | "opens the asked season and highlights the asked episode" | `initialSeason={2} initialEpisode={1}` | `season-tab-2` is `aria-pressed="true"`; `mockGetSeason` is called with `(SHOW_ID, 2)`; `episode-row-1` has `aria-current="true"` |
  | "an unknown asked season opens the first" | `initialSeason={7} initialEpisode={1}` | `season-tab-1` is pressed and no row has `aria-current` |
  | "resumes an unfinished asked episode on its own download" | `tv:95396:s1:e2` unfinished, `t-9`/file 4, asked S1E2 | `show-play-button` has text `Resume S01·E02`; a click gives `mockPush('/streaming/t-9?file=4')`; `mockHandleCatalogStreamingStart` is not called |
  | "a finished asked episode plays the next one" | S1E1 completed; `next.fn` → `ready { season: 1, episode: 2 }` | the text becomes `Play S01·E02`; a click calls `handleCatalogStreamingStart` with `{ tmdb_id: SHOW_ID, quality: '1080p', media_type: 'tv', season: 1, episode: 2 }`; `episode-row-2` is highlighted |
  | "the next one can be in a later season" | `ready { 2, 1 }` | `Play S02·E01` |
  | "nothing after a finished episode plays from the start" | `{ k: 'none' }` | `Play S01·E01` |
  | "no usable row plays the asked episode" | `torrent_id: null` | `Play S01·E02`, and the click passes `season: 1, episode: 2` |
  | "while progress loads, the hero cannot start anything" | `progress.isLoading = true`, asked S1E2 | `show-play-button` is disabled |
  | "without a query nothing changes" | no props | label `Play S01·E01`; the click passes `season: 1, episode: 1`; no row has `aria-current` |

  The existing cases at 259-270, 341-380 and 386-432 must stay green.

- [ ] **Step 3: Run to verify they fail**

  Run: `npx vitest run src/lib/showHero.test.ts src/components/tv/ShowDetailView.test.tsx src/components/tv/EpisodeList.test.tsx`
  Expected: the new cases FAIL.

- [ ] **Step 4: Implement**

  - **`showHero.ts`:** follow the order in Step 1.
  - **`(web)/tv/[id]/page.tsx`:** destructure `searchParams` and compute `const ask = episodeAskFrom(await searchParams)` OUTSIDE the `try`, so a bad parameter can never 404. Render `<ShowDetailView key={`${ask.season ?? ''}:${ask.episode ?? ''}`} show={show} initialSeason={ask.season} initialEpisode={ask.episode} />`. The key matters because a search-only navigation does not remount page state in Next 15.
  - **`ShowDetailView`, setup:**
    - Find `askedSeason`: `initialSeason` when it is a regular season, otherwise undefined.
    - Seed the season state with `askedSeason ?? firstSeason`.
    - `focus = askedSeason !== undefined && initialEpisode !== undefined ? { season: askedSeason, episode: initialEpisode } : null`.
    - `row = focus ? progressData[buildContentId({ kind: 'tv', tmdbId: show.tmdb_id, ...focus })] ?? null : null`.
  - **`ShowDetailView`, the next episode:** an effect calls `findNextEpisode` only when `row?.completed`. It stores `ready` → `next`, and anything else → `null`. It ignores late answers once unmounted or once the focus has changed.
  - **`ShowDetailView`, the hero:**
    - `action = showHeroAction({ focus, row, next, progressLoading: isLoading })`.
    - The label is `Resume {code}`, `Play {code}`, or `Play` with `isLoading` for pending.
    - The click is `router.push(action.href)` for resume, or `handlePlay(action.at.season, action.at.episode)` for play.
    - `handlePlay(season, episode)` keeps its body, with `DEFAULT_QUALITY` and `router.push(streamingHref(status))`.
    - Keep `data-testid="show-play-button"`.
  - **`ShowDetailView`, the highlight:** `highlightEpisode` is the action's `at.episode` when `focus` is set and `at.season === selectedSeason`.
  - **`EpisodeList`:** a highlighted `<article>` swaps `border-transparent bg-white/[.012]` for `border-gold/45 bg-gold/[.06]` and gains `aria-current="true"` and `data-highlighted="true"`. Do not scroll it into view: the hero carries the action. Leave the play flow and the `S1·E1` label alone.
  - **Header comments:** rewrite the "load-bearing — do not modify" header in `ShowDetailView` to describe the new flow.

- [ ] **Step 5: Run to verify they pass**

  Run the Step 3 command, then `npx tsc --noEmit`.
  Expected: PASS.

- [ ] **Step 6: Commit**

  ```bash
  git add src/lib/showHero.ts src/lib/showHero.test.ts 'src/app/(web)/tv/[id]/page.tsx' src/components/tv/ShowDetailView.tsx src/components/tv/ShowDetailView.test.tsx src/components/tv/EpisodeList.tsx src/components/tv/EpisodeList.test.tsx
  git commit -m "feat(web): the show page opens on the asked episode and resumes it"
  ```

---

### Task 6: The web player's back arrow returns to the title

**Files:**
- Modify: `src/app/(web)/streaming/[id]/page.tsx` (`handleBackClick` 293-295, blocked 459-479, error 502-509, header 526-532)
- Test: `src/app/(web)/streaming/[id]/page.test.tsx` (append a `describe`)

**Interfaces:**
- Consumes: `titleOfStream` (Task 1), `titlePageHref` (Task 1) and `showNameFromTitle`.
- Produces: nothing for other tasks.

- [ ] **Step 1: Write the failing tests**

  Add `describe('the back arrow returns to the title')`. It reuses `nav`, `status()`, `info()`, `asPack()` and `open()`. Every row asserts `nav.push` with exact arguments AND `nav.replace` not called. New pack rows set `info({ content_id, season, episode })` explicitly, because the existing `info()` sets neither field.

  | Case | Setup | Expect |
  |---|---|---|
  | single episode | `status()`: 'Show S02E02', tv 1399 S2E2 | the button named `Back to Show` gives `'/tv/1399?season=2&episode=2'` |
  | pack | `asPack()` with info S2E1 | `'/tv/1399?season=2&episode=1'` |
  | pack, file switched | rerender with `?file=` → info S2E2 (copy rows 306-320) | `'/tv/1399?season=2&episode=2'` |
  | pack, `s0` fallback | info `content_id: 'tv:1399:s0:e4', season: null, episode: null` | `'/tv/1399'` |
  | film | tmdb 603, `media_type: 'movie'`, `movie_title: 'The Matrix'` | the button named `Back to The Matrix` gives `'/movies/603'` |
  | buffering | `isStreamingReady` → false, so `streamingInfo` is null | still `'/tv/1399?season=2&episode=2'`; `getStreamingInfo` is not called |
  | legacy | `tmdb_id: null, media_type: null` | the button named `Back to downloads` gives `'/downloads'` |
  | blocked | `state: 'blocked'` | `Choose another source` gives `'/tv/1399?season=2&episode=2'` |
  | error | `getTorrentStatus` → null | `Back to Downloads` gives `'/downloads'` |

  The buffering, blocked and error rows cannot use `open()`. Await `findByRole('button', { name: /back to|choose another source/i })` instead.

- [ ] **Step 2: Run to verify they fail**

  Run: `npx vitest run 'src/app/(web)/streaming/[id]/page.test.tsx'`
  Expected: the new rows FAIL, because every back target is `/downloads`.

- [ ] **Step 3: Implement**

  - **Derive the target on every render**, before the early returns. Never latch it at mount: file switches and Up Next replace the URL without remounting.
    ```
    backTitle = titleOfStream(torrentStatus, streamingInfo ?? currentVideoFile)
    backHref  = backTitle ? titlePageHref(backTitle) : '/downloads'
    backName  = backTitle && torrentStatus
                  ? (tv ? showNameFromTitle(torrentStatus.movie_title, backTitle.tmdbId) : torrentStatus.movie_title)
                  : null
    backLabel = backName ? `Back to ${backName}` : 'Back to downloads'
    ```
    `currentVideoFile` is the current entry of `videoFiles`, or null.
  - **Wire the three controls:**
    - `handleBackClick` does `router.push(backHref)`;
    - the header's `aria-label` is `backLabel`;
    - the error button's text is `backName ? backLabel : 'Back to Downloads'`;
    - the blocked button keeps its text and follows `handleBackClick`.
  - **Out of scope:** leave the source-switch parse at 380-392 alone.

- [ ] **Step 4: Run to verify they pass**

  Run the same file, then `npx tsc --noEmit`.
  Expected: PASS.

- [ ] **Step 5: Commit**

  ```bash
  git add 'src/app/(web)/streaming/[id]/page.tsx' 'src/app/(web)/streaming/[id]/page.test.tsx'
  git commit -m "feat(web): the player's back arrow returns to the title page"
  ```

---

### Task 7: The TV player's Back control and title exits

**Files:**
- Create: `src/app/(bigscreen)/_player/BackToTitle.tsx`, `src/app/(bigscreen)/_player/BackToTitle.test.tsx`
- Modify:
  - `src/app/(bigscreen)/_data/titleHref.ts` (+ its test)
  - `src/app/(bigscreen)/_components/LoadStatus.tsx` (+ its test)
  - `src/app/(bigscreen)/bigscreen/watch/[id]/page.tsx`
  - `public/bigscreen.css`
- Test:
  - `bigscreen/watch/[id]/page.test.tsx`
  - `page.subtitles.test.tsx`
  - `page.next.test.tsx`
  - `(bigscreen)/journeys.test.tsx:875-896`
  - `_player/playerCss.test.tsx`

**Interfaces:**
- Consumes: `titleOfContentId` (Task 1), `titleHref` (Task 3), `showNameFromTitle`, and the route's `identity` (`watchIdentity(...)` at `page.tsx:532`).
- Produces:
  ```ts
  // _data/titleHref.ts
  export interface TitleExit { href: string; label: string }
  export function titleExitOf(identity: { contentId: string | null; title: string | null }): TitleExit | null
  // _player/BackToTitle.tsx — presentational; calls no key hook; imports only `type FocusProps`
  export const BACK_TO_TITLE_CELLS = 1;
  export function BackToTitle(p: { row: number; focusProps: (row: number, col: number) => FocusProps; label: string; visible: boolean; onExit: () => void }): JSX.Element
  // _components/LoadStatus.tsx
  //   new optional prop `backHref?: string` (default '/bigscreen') for its Back link
  ```

- [ ] **Step 1: Write the failing unit tests**

  **`titleHref.test.ts`** (append):

  | Identity | `titleExitOf` result |
  |---|---|
  | `{ contentId: 'movie:603', title: 'The Matrix' }` | `{ href: '/bigscreen/movie/603', label: 'The Matrix' }` |
  | `{ contentId: 'tv:1399:s2:e5', title: 'Show 1399 S02E05' }` | `{ href: '/bigscreen/show/1399?s=2&e=5', label: 'Show 1399' }` |
  | `'tv:1399'` | `href` is `'/bigscreen/show/1399'` |
  | `'tv:1399:s0:e4'` | `href` is `'/bigscreen/show/1399'` |
  | `{ contentId: null, title: 'x' }` | `null` |

  **`BackToTitle.test.tsx`.** Copy the `Harness` from `TransportBar.test.tsx`, which wires a real `useFocusGrid`.
  - It renders one button whose accessible name is `The Boys`. The chevron is `aria-hidden`.
  - A click calls `onExit` once.
  - With `visible={false}`, the wrapper has the class `bs-player__back--hidden` and stays in the DOM. The button has no `hidden`, `inert` or `aria-hidden`, and keeps its `tabindex`.

  **`LoadStatus.test.tsx`.**
  - With `backHref="/bigscreen/show/1399?s=2&e=1"`, the Back link's href equals that value.
  - Without it, the href is `'/bigscreen'`.

- [ ] **Step 2: Write the failing route tests**

  **The fixture's exit.** `statusRow()` is tv 1399 S02, and a bare arrival plays file 4 = S02E01. The exit is therefore `/bigscreen/show/1399?s=2&e=1`, labelled `Show 1399`.

  **Update the HOME expectations to the exit:**
  - `page.test.tsx` lines 1075, 1105, 1131 and 1284;
  - `page.subtitles.test.tsx:660`;
  - `journeys.test.tsx:894` (packRow + `videoFile(0, 2, 1)`, so S02E01).

  These stay HOME: `journeys.test.tsx:860-873` (unknown title, so HOME) and `page.test.tsx:604-617` (arrival-gone, so HOME).

  **New `describe('the Back control')` in `page.test.tsx`:**

  | Case | Steps | Expect |
  |---|---|---|
  | "arrival leaves the ring on Play/Pause" | arrive, then `metadata()` | `ring()[0]` matches `/Pause\|Play/` both times |
  | "Up from the transport reaches Back when there is no scrub row" | no `metadata()`: `right()`, `up()`, `down()` | after `up()`, `activeElement` has accessible name `Show 1399`; after `down()`, the ring is back on `Back 10s` (column memory) |
  | "with the scrub row, two Ups reach Back" | `up()`, `up()` | the ring is on Back |
  | "OK on Back flushes, then replaces to the title" | focus Back, press `ok()` | `saveProgress` is called before `nav.replace('/bigscreen/show/1399?s=2&e=1')`; `nav.push` is not called |
  | "Back fades with the band" | hide, then reveal | `.bs-player__back` gains `--hidden` when the band hides and loses it on reveal; exactly one `.bs-player__back` node |
  | "a recovery that removes the scrub row never parks the ring on Back" | drive the `reloading` recovery so duration goes NaN | the ring is on a transport cell, not Back |
  | "the Stop media key leaves to the title" | Stop key | `nav.replace` with the exit |
  | "a film leaves to its movie screen" | status tmdb 603, `media_type: 'movie'`, `movie_title: 'The Matrix'` | Back's name is `The Matrix`; the final Back rung replaces to `/bigscreen/movie/603` |
  | "an unknown title leaves home, labelled Home" | `tmdb_id: null` | Back's name is `Home`; the exit is `'/bigscreen'` |
  | "while preparing, the on-screen Back goes to the title" | a known-identity arrival in the preparing phase | `LoadStatus`'s Back link href is the exit |
  | "a boundary Gone offers the title first" | the arrival succeeds, then the boundary 404s | the first Gone link is `Back to Show 1399` with the exit href |

  **`page.subtitles.test.tsx`:**
  - "Back is absent while the picker is open": while the picker is open there is no `.bs-player__back`.
  - "closing the picker returns the ring to Subtitles, not Back".

  **`page.next.test.tsx`:**
  - "a same-pack next episode moves the exit": after `goNext` to file 0 (S02E02), the final Back replaces to `'/bigscreen/show/1399?s=2&e=2'`.

  **`playerCss.test.tsx`:**
  - lines 640-647: the modifier list becomes `['.bs-player__back--hidden', '.bs-player__bar--hidden', '.bs-player__scrim--hidden']`. Keep the sort the test uses.
  - Add `BackToTitle` to the catch-all `classesOf` render (470-475).
  - Add rows asserting that `.bs-player__back--hidden` is opacity-only, that it is declared after its base, and that `.bs-player__back`'s `transition` equals the band's.

- [ ] **Step 3: Run to verify they fail**

  Run: `npx vitest run 'src/app/(bigscreen)/_player' 'src/app/(bigscreen)/_data/titleHref.test.ts' 'src/app/(bigscreen)/_components/LoadStatus.test.tsx' 'src/app/(bigscreen)/bigscreen/watch' 'src/app/(bigscreen)/journeys.test.tsx'`
  Expected: the new and updated rows FAIL.

- [ ] **Step 4: Implement `titleExitOf`, `BackToTitle` and `LoadStatus`**

  - **`titleExitOf`:** `titleOfContentId(identity.contentId)`, then `{ href: titleHref(t), label: showNameFromTitle(identity.title, t.tmdbId) }`. A missing title returns null.
  - **`BackToTitle`:** render
    ```jsx
    <div className={visible ? 'bs-player__back' : 'bs-player__back bs-player__back--hidden'}>
      <button type="button" className="bs-btn bs-btn--ghost" {...focusProps(row, 0)} onClick={onExit}>
        <span aria-hidden="true">‹</span>{' '}<span className="bs-player__back-name">{label}</span>
      </button>
    </div>
    ```
  - **`LoadStatus`:** add `backHref = HOME` and use it for its Back link.

- [ ] **Step 5: Implement the route (`watch/[id]/page.tsx`)**

  - **Rows.** `const BACK_ROW = 0; const SCRUB_ROW = 1; const TRANSPORT_ROW = 2;`, replacing `TRANSPORT_ROW = 1` and the literal `row={0}` on `ScrubBar`. Update the prose at 248-271, 1305-1307 and 1758-1777, and the comment at `SubtitlePicker.tsx:110-113`.
  - **Grid.** Closed: `rowCounts = [BACK_TO_TITLE_CELLS, scrubRowCount(duration), transportCellCount(…)]`. Open: `pickerRowCounts(…)`, unchanged. Call `useFocusGrid({ rowCounts, initialRow: pickerOpen ? undefined : SCRUB_ROW })`.
  - **The exit.** After line 532: `const exit = titleExitOf(identity); const exitHref = exit?.href ?? HOME; const exitLabel = exit?.label ?? 'Home';`.
  - **Every way out goes through it.**
    - The Back ladder's final rung is `leave(exitHref)`, with `exitHref` added to its deps. Rewrite the "LEVEL 3 IS NOT BUILT" docblock.
    - Rename the `Playing` prop `onStop` to `onExit` and pass `onExit={() => leave(exitHref)}` and `exitLabel`. It serves the Stop cell, the Stop media key and Back.
    - Pass `backHref={exitHref}` to the route's `LoadStatus`.
    - Turn `GONE_WAYS_OUT` into a non-exported `goneWaysOut(exit: TitleExit | null)`. Its first entry is `{ href: exit?.href ?? HOME, label: exit ? `Back to ${exit.label}` : 'Back to home' }`, then My List. `Gone` takes `exit`.
  - **Mount Back.** In `Playing`, render `{!pickerOpen && <BackToTitle row={BACK_ROW} focusProps={grid.focusProps} label={exitLabel} visible={visible} onExit={onExit} />}` AFTER the scrim and BEFORE the band. That DOM order keeps `page.test.tsx:1241`'s last-button assertion true.
  - **Leave alone:** `Waiting`, `leave(PAIR)`, the 423 redirect, and `goNext`.

- [ ] **Step 6: Implement the CSS (`public/bigscreen.css`)**

  - **Edit the first player inventory comment (1236-1245).** Name `_player/BackToTitle` and add the shape line `.bs-player__back[--hidden]  absolute, top-left safe inset; fades WITH the band`.
  - **Edit COMBINING (1287-1301)** to say THREE modifiers on the one `visible` flag.
  - **APPEND at the foot of the file:**
    ```css
    .bs-player__back { position: absolute; top: var(--safe-y); left: var(--safe-x); transition: <the band's exact transition>; }
    .bs-player__back--hidden { opacity: 0; }
    .bs-player__back-name { display: inline-block; max-width: 40vw; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; vertical-align: bottom; }
    ```
    Check that `--safe-y`/`--safe-x` are the stylesheet's real inset tokens, and use whatever it actually defines. Add no `z-index`, no top scrim, and no blur.

- [ ] **Step 7: Run to verify they pass**

  Run the Step 3 command, then `npm run test:tv` and `npx tsc --noEmit`.
  Expected: PASS. `noDeadExports`: `titleExitOf`, `TitleExit`, `BackToTitle` and `BACK_TO_TITLE_CELLS` all have production callers.

- [ ] **Step 8: Commit**

  ```bash
  git add 'src/app/(bigscreen)/_player/BackToTitle.tsx' 'src/app/(bigscreen)/_player/BackToTitle.test.tsx' 'src/app/(bigscreen)/_data/titleHref.ts' 'src/app/(bigscreen)/_data/titleHref.test.ts' 'src/app/(bigscreen)/_components/LoadStatus.tsx' 'src/app/(bigscreen)/_components/LoadStatus.test.tsx' 'src/app/(bigscreen)/bigscreen/watch/[id]/page.tsx' 'src/app/(bigscreen)/bigscreen/watch/[id]/page.test.tsx' 'src/app/(bigscreen)/bigscreen/watch/[id]/page.subtitles.test.tsx' 'src/app/(bigscreen)/bigscreen/watch/[id]/page.next.test.tsx' 'src/app/(bigscreen)/_player/playerCss.test.tsx' 'src/app/(bigscreen)/_player/SubtitlePicker.tsx' 'src/app/(bigscreen)/journeys.test.tsx' public/bigscreen.css
  git commit -m "feat(tv): the player has a Back control to the title, and every exit goes there"
  ```

---

## After the last wave

1. **Whole-branch review.** Check correctness, the seams between tasks, the TV focus model and the guards. Verify each finding adversarially, then fix what survives.
2. **Final gates on the finished tree, from `frontend/`:**
   - loop `npm run test:tv` at least 10 times with no failure. A failure whose duration runs to five figures in ms is starvation, so re-run it;
   - run `npx vitest run` three times;
   - `npx tsc --noEmit`;
   - `npm run build`.
