# FRÈ Phase 8 — Finale: Legacy Cleanup + Additive Backend Implementation Plan

> Two parts. **Part A (cleanup)** is delicate deletion — build is the safety net. **Part B (backend)** is additive (no-Alembic). Steps use `- [ ]`.

**Goal:** Finish the redesign — (A) delete the now-dead legacy components + strip the legacy purple CSS, and (B) add the additive backend (My List watchlist + activity-count) and wire the placeholder affordances (the `+ My List` buttons and the TopNav activity badge) so they're real.

**Tech:** Frontend Next 15/React 19/TS + Vitest; Backend FastAPI + SQLAlchemy 1.4 (no Alembic — `init_db()` runs `create_all()` + `sync_columns()`; new tables auto-created). Backend tests via `docker compose run --rm backend python -m pytest` (per CLAUDE.md).

## Global Constraints
- Gates from `frontend/`: `npm run test` + `npx tsc --noEmit` + `npm run build`. Backend gate: `docker compose run --rm backend python -m pytest` (and the app must still start). Conventional Commits. Dark-only. Reuse the existing service/context/`content_id` patterns.
- **Don't break anything:** every deletion (Part A) and addition (Part B) must keep `npm run build` + `tsc` green; the backend must keep importing/starting. Build/tests are the safety net.

---

## PART A — Legacy cleanup

### Task A1: Delete dead legacy components + CSS (build-verified)
**Approach:** delete in dependency order, re-running `npx tsc --noEmit` + `npm run build` after the batch; if anything breaks, restore the offending file and report it (don't force).

**Delete these legacy FEATURE files (confirmed 0-importer now or after their importer is deleted in the same pass):**
- users: `PasscodeModal.tsx`, `UserRouteGuard.tsx`
- home: `HomePageContent.tsx`, `RecentlyWatchedMovies.tsx`, `ContinueWatchingSection.tsx`
- movies: `FeatureCarousel.tsx`, `MovieCarousel.tsx`, `MovieCard.tsx`, `MovieGrid.tsx`, `MovieDetailsContent.tsx`, `MovieDetailsModal.tsx`, `MovieDetailsProgressSection.tsx`
- tv: `TvBrowseContent.tsx`, `ShowGrid.tsx`, `ShowDetailsContent.tsx`
- search: `SearchPageContent.tsx`
- downloads: `TorrentList.tsx`, `TorrentItem.tsx`
- schedules: `ScheduleList.tsx`, `ScheduleItem.tsx`, `ScheduleForm.tsx`
- streaming: `BasicPreStream.tsx`
- legacy nav: `ui/Navigation.tsx`, `ui/ThemeToggle.tsx`, `users/UserDropdown.tsx`
- CSS: `src/styles/swiper-custom.css`, `src/styles/feature-carousel.css`

**KEEP (do NOT delete):**
- All `src/components/ui/fre/*`, `src/components/browse/*`, `src/components/shell/*`, `src/components/detail/*`, `src/components/search/{ResultsGrid,SearchFilters,GenreBrowse,SearchView}.tsx`, `src/components/downloads/DownloadsView.tsx`, `src/components/schedules/{ScheduleCard,ScheduleFormFre,SchedulesView}.tsx`, `src/components/settings/SettingsView.tsx`, `src/components/player/*`, `src/components/streaming/{PreStreamingAnimation,BufferingAnimation,animations}.tsx`, `src/components/fx/*`, `Wordmark`, `lib/*`.
- `src/context/ThemeContext.tsx` (no-op dark provider; `layout.tsx` still imports it — keep).
- `src/components/users/{UserAvatar,AvatarSelector,CreateUserModal}.tsx` IF still imported (SettingsView/ProfileGate may use UserAvatar/AvatarSelector) — verify; keep what's referenced.
- `src/app/my-movies/page.tsx` + `MyMoviesPageContent.tsx` + `UserMovieCard.tsx` — KEEP for now (Part B Task B5 rebuilds /my-movies as the My List page).
- **Legacy UI primitives** (`ui/{Button,Card,Badge,Input,Select,Progress,Motion,SectionHeader,LoadingScreen,WatchProgressBar}.tsx`): after deleting the feature files, GREP each for remaining importers. Delete ONLY those with 0 importers; KEEP any still imported by a kept file (e.g. CreateUserModal/MyMoviesPageContent/loading.tsx may still use some). The build will confirm.

**globals.css edits:** remove the `.light {…}` block and the legacy purple `:root`/`.dark` `--color-*` palette (the FRÈ `@theme` is the source of truth), and the unused legacy utilities `.bg-app-gradient`, `.theater-shadow`, `.cinema-glow`, `.film-grain`, `.movie-screen`. **KEEP** the legacy `@keyframes`/`.animate-*` (still used by `Motion.tsx` if Motion is kept) and ALL `.ff-*` atmosphere classes. If removing a token breaks the build (something still references `var(--color-primary)` etc.), restore that token and note it.

**Fix dangling links:** if `ContinueWatchingRow.tsx` (kept) links "See all" to `/my-movies`, that's fine (route kept). Ensure no kept file imports a deleted file.

- [ ] Delete the feature files + CSS files above; remove the legacy globals.css blocks.
- [ ] Grep legacy UI primitives for importers; delete only 0-importer ones.
- [ ] Run `npx tsc --noEmit` (clean) + `npm run build` (succeeds) + `npm run test` (green). Restore any file whose deletion broke the build and report it.
- [ ] Commit: `chore(cleanup): remove dead legacy components + legacy purple CSS`.

---

## PART B — Additive backend: My List + Activity

### Task B1: `UserWatchlist` backend (model + schema + router + register)
**Files (backend):** create `backend/app/database/models/watchlist.py` (a `UserWatchlist(Model)` with `id`, `user_id` FK→users CASCADE indexed, `content_id` indexed, `tmdb_id`, `media_type`, `title?`, `added_at`); import it in `backend/app/database/models/__init__.py`; add a `watchlist` relationship on `User`; add Pydantic `WatchlistItemCreate`/`WatchlistItemResponse` (`model_config = ConfigDict(from_attributes=True)`) to `backend/app/models.py`; create `backend/app/api/watchlist.py` with `POST /{user_id}/add` (dedupe by `(user_id, content_id)` → 409), `DELETE /{user_id}/{content_id}`, `GET /{user_id}` (list, newest first) using the `with db as session:` pattern; register in `main.py` at `prefix=f"{settings.api_v1_str}/watchlist"`.
- [ ] Implement per the analysis roadmap. Add a pytest `backend/tests/test_watchlist.py` (add/list/dedupe/remove against a test DB). Run `docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest tests/test_watchlist.py -v` (mount tests since they're baked into the image). Confirm `init_db()` creates the table (app starts clean).
- [ ] Commit: `feat(api): per-profile watchlist (My List) endpoints`.

### Task B2: `activity` count endpoint (backend)
**Files:** create `backend/app/api/activity.py` with `GET /count` (or `/{user_id}`) returning `{active_downloads, aggregate_progress}` derived from `torrent_manager` active torrents (states downloading/queued/checking/allocating/downloading_metadata); register in `main.py` at `prefix=f"{settings.api_v1_str}/activity"`.
- [ ] Implement; pytest `test_activity.py` (mock/seed torrent_manager or assert shape). Run via docker compose. Commit: `feat(api): active-downloads activity count endpoint`.

### Task B3: Frontend watchlist service + hook
**Files:** `frontend/src/services/watchlist.ts` (add/remove/list calling the new endpoints) + a `useWatchlist()` context/hook (`frontend/src/context/WatchlistContext.tsx`) loaded per active profile (mirrors ProgressContext): holds the set of saved `content_id`s, `isSaved(contentId)`, `toggle(item)`. Provider mounted in `layout.tsx` (inside UserProvider). Tested.
- [ ] Implement + test. Commit: `feat(watchlist): frontend service + WatchlistContext`.

### Task B4: Wire the `+ My List` buttons
**Files:** `Hero.tsx`, `PosterCard.tsx` (its quick-action `+`), `DetailHero.tsx` (movie/show + My List) — replace the no-op `+ My List` with `useWatchlist().toggle({content_id, tmdb_id, media_type, title})` + a saved/added visual state (filled when `isSaved`). Build `content_id` with the existing `services/content_id`-style helper (`movie:{tmdb}` / for a show use `tv:{tmdb}` at the show level — note shows have no s/e at the hub level; use `tv:{tmdb}` for show-level My List). Tested where feasible.
- [ ] Implement + tests. Commit: `feat(watchlist): wire + My List buttons to the watchlist`.

### Task B5: Rebuild `/my-movies` as the FRÈ "My List" page + nav entry
**Files:** rewrite `frontend/src/app/my-movies/page.tsx` + a `MyListView` to show the watchlist (fetch via `useWatchlist`/service; render FRÈ `PosterCard`s in a grid; empty state). Add a "My List" entry to the `ProfileMenu` (or keep the ContinueWatchingRow "See all" → /my-movies). Delete the legacy `MyMoviesPageContent.tsx`/`UserMovieCard.tsx` once unimported (build-verified). Tested.
- [ ] Implement + test. Commit: `feat(watchlist): FRÈ My List page (/my-movies)`.

### Task B6: Wire TopNav activity badge
**Files:** `TopNav.tsx` — replace the hardcoded `Ring value={64}` + count `1` with live data from the activity endpoint (a small poll or on-mount fetch via the watchlist/activity service); hide the pill when count is 0. Tested where feasible.
- [ ] Implement + test. Commit: `feat(shell): wire TopNav activity badge to live download count`.

### Task B7: Finale gate + final whole-branch review
- [ ] `npm run test` + `npx tsc --noEmit` + `npm run build` green; backend pytest green; app starts. Tag `fre-phase8-finale`.
- [ ] Controller: dispatch the final whole-branch review across the ENTIRE branch (merge-base..HEAD), then proceed to finishing-a-development-branch (present merge/PR options to the user).

---

## Notes
- Part A first (frontend cleanup, safe), then Part B. Don't run two git-writing executions concurrently.
- Backend: additive only — new tables via `create_all`; never drop/alter. Reuse the `Model`/`with db as session:`/router-register patterns the analysis documented.
- Wire buttons to REAL endpoints only after B1–B3 land.
- Keep dark-only; reuse FRÈ primitives + PosterCard for the My List page.
