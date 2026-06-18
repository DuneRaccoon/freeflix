# FRÈ Phase 7 — Utility Surfaces (Downloads / Schedules / Settings) Implementation Plan

> Spec-level tasks executed implement→test/verify→commit. Steps use `- [ ]`. No mockups — design from the spec §5.7–5.9 + the FRÈ system.

**Goal:** Re-skin the three power-user utility surfaces in FRÈ — **Downloads/Activity** (live torrent status + actions), **Schedules** (automated-download rules), and **Settings** (per-profile + system health) — adding the FRÈ form primitives they need and retiring the dark-only-obsolete theme control.

**Architecture:** Add FRÈ form primitives under `src/components/ui/fre/` (Field/Input/Select/Toggle), then new FRÈ views under each domain folder that reuse them + the existing services unchanged. Pages render the new views.

## Global Constraints
- Stack/alias/gates as prior phases. Dark-only, gold precious, gold focus rings. Conventional Commits. These pages render under the fixed TopNav (`<main>` has `pt-[72px]`); add comfortable top spacing.
- **Reuse services unchanged:** `torrentsService` (`listTorrents`, `getTorrentStatus`, `performTorrentAction(id, 'pause'|'resume'|'stop')`, `deleteTorrent(id, false)`, `prioritizeForStreaming`). `schedulesService` (`listSchedules`, `getSchedule`, `createSchedule(config)`, `updateSchedule(id, config)`, `deleteSchedule`, `runSchedule`). `usersService` (`getUserSettings`, `updateUserSettings(id, Partial<UserSettings>)`, `updateUser`). `baseService` (`root()→SystemInfo {status,service,platform,hardware}`, `healthcheck()→HealthInfo {status,active_torrents,scheduler_enabled}`).
- **Types:** `TorrentStatus {id, movie_title, quality, state: TorrentState, progress, download_rate, upload_rate, total_downloaded, total_uploaded, num_peers, save_path, created_at, updated_at, eta?, error_message?}`. `TorrentState` enum: queued/checking/downloading_metadata/downloading/finished/seeding/allocating/checking_fastresume/paused/error/stopped. `ScheduleResponse {id, name?, config: ScheduleConfig, next_run, last_run?, status}`. `ScheduleConfig {name?, cron_expression, search_params: SearchParams, quality:'720p'|'1080p'|'2160p', max_downloads, enabled}`. `UserSettings {id, user_id, maturity_restriction:'none'|'pg'|'pg13'|'r', require_passcode, passcode?, theme, default_quality:'720p'|'1080p'|'2160p', download_path?}`.
- **Dark-only:** REMOVE the theme `<Select>` from the per-profile settings (the `theme` field stays in the type but is no longer user-editable). Don't write `theme` from the UI.
- **ARM cap:** the backend caps active downloads to 2 on ARM — the Downloads UI shows the active count against that limit ("Active N / 2" — derive the active count client-side by counting torrents in active states).
- Reuse FRÈ: `Button`/`Pill`/`Badge`/`Progress`/`Ring`/`Modal` (`@/components/ui/fre`), `cn`. Build the new form primitives (Task 1) for inputs/selects.
- Entry points already exist (Phase 2): `ProfileMenu` links `/schedules`/`/downloads`/`/settings`; TopNav Activity pill → `/downloads`.

## File Structure
| File | Responsibility |
| --- | --- |
| `src/components/ui/fre/Field.tsx` (+test) | FRÈ `Input`, `Select`, `Toggle`, and a labeled `Field` wrapper |
| `src/components/downloads/DownloadsView.tsx` (+test) | FRÈ downloads/activity list + filters + actions + active-limit |
| `src/components/schedules/ScheduleCard.tsx` + `ScheduleFormFre.tsx` + `SchedulesView.tsx` (+tests) | FRÈ schedules list + create/edit form |
| `src/components/settings/SettingsView.tsx` (+test) | FRÈ per-profile settings (Profile/Preferences/Restrictions, NO theme) + system health |
| `src/app/downloads/page.tsx`, `src/app/schedules/page.tsx`, `src/app/settings/page.tsx`, `src/app/users/[id]/settings/page.tsx` | render the new views |

> Legacy `downloads/TorrentList|TorrentItem`, `schedules/ScheduleList|ScheduleItem|ScheduleForm`, and the legacy settings page bodies left on disk for the final cleanup phase.

---

### Task 1: FRÈ form primitives (`Field`)
**Files:** `src/components/ui/fre/Field.tsx` (+test); export from `src/components/ui/fre/index.ts`.
- `Input` — styled text/number input (dark surface-2, hairline border, gold focus ring), extends `InputHTMLAttributes`.
- `Select` — styled native `<select>` (dark, gold focus), props `{ options: {value,label}[] }` extending `SelectHTMLAttributes`.
- `Toggle` — a switch/checkbox (gold when on), props `{ checked, onChange, label? }`.
- `Field` — a labeled wrapper `{ label, hint?, error?, children }` (label + control + hint/error).
All gold focus rings; dark-only.
**Tests:** Input renders + forwards value/onChange; Select renders options + fires onChange; Toggle reflects checked + toggles; Field renders label + children + error.

### Task 2: `DownloadsView`
**Files:** `src/components/downloads/DownloadsView.tsx` (+test). Render it from `src/app/downloads/page.tsx`.
FRÈ list of active torrents (`listTorrents`, auto-refresh poll ~2s, toggleable). Each item: title (`movie_title`), a state `Badge` (color by `state`), quality `Badge`, a gold `Progress` (value=`progress`), download/upload speed (humanized), peers, ETA (when downloading), error message (when error), and actions: pause/resume/stop (`performTorrentAction`), remove (`deleteTorrent(id,false)` — confirm via `Modal`), and a "Watch" (`prioritizeForStreaming` then route `/streaming/{id}`). Filter `Pill`s (All / Downloading / Completed / Paused / Error). A header showing **"Active N / 2"** (count torrents in active states: queued/downloading/downloading_metadata/checking/allocating). Empty state when no torrents.
**Tests:** mock `torrentsService`; renders an item per torrent with title/state/progress; pause action calls `performTorrentAction(id,'pause')`; remove (confirmed) calls `deleteTorrent`; the active-count header reflects active-state torrents; a filter Pill narrows the list.

### Task 3: Schedules (`SchedulesView` + `ScheduleCard` + `ScheduleFormFre`)
**Files:** `src/components/schedules/ScheduleCard.tsx`, `ScheduleFormFre.tsx`, `SchedulesView.tsx` (+tests). Render `SchedulesView` from `src/app/schedules/page.tsx`.
- `ScheduleCard`: a FRÈ card showing name (or `Schedule {id.slice(0,8)}`), enabled `Badge`, a humanized cron (reuse the existing `formatCronExpression` if present, else a small map), next/last run (date-fns `format`), the search-param summary + quality + max_downloads, and actions Run-now (`runSchedule`)/Edit/Delete (`deleteSchedule`, confirm via `Modal`).
- `ScheduleFormFre`: create/edit form using the Task-1 `Field`/`Input`/`Select`/`Toggle` — name, cron (+ the existing cron presets: Daily-midnight/Daily-noon/Weekly/Monthly/Weekdays/Weekends/Every-6h/Every-12h), search keyword + genre + year + order_by, quality, max_downloads (1–10), enabled toggle. On submit calls `createSchedule`/`updateSchedule(id, config)` with a `ScheduleConfig`.
- `SchedulesView`: lists `ScheduleCard`s (`listSchedules`), a "New schedule" button opening the form (in a `Modal` or inline), edit wiring (`getSchedule` → form), refresh after mutations. Empty state.
**Tests:** mock `schedulesService`; SchedulesView renders a card per schedule; Run-now calls `runSchedule`; the form submit builds a valid `ScheduleConfig` and calls `createSchedule`; a cron preset sets the cron field.

### Task 4: `SettingsView`
**Files:** `src/components/settings/SettingsView.tsx` (+test). Render from `src/app/users/[id]/settings/page.tsx` (per-profile) and surface system health from `src/app/settings/page.tsx`.
FRÈ per-profile settings using Task-1 primitives, three sections:
- **Profile:** avatar (reuse `UserAvatar`/`AvatarSelector` or a simple FRÈ avatar picker), display name (`updateUser`).
- **Preferences:** default quality `Select` (720p/1080p/2160p) → `updateUserSettings`. **NO theme control** (dark-only). Download path `Input`.
- **Restrictions:** maturity `Select` (none/pg/pg13/r), require-passcode `Toggle`, passcode + confirm `Input`s (conditional) → `updateUserSettings`.
Plus a **System** card from `baseService.root()`/`healthcheck()` (service/platform/hardware, API status, active torrents, scheduler enabled). Read `userSettings`/`currentUser` from `useUser()`.
**Tests:** mock `useUser`/`usersService`/`baseService`; renders the three sections WITHOUT a theme select; changing default-quality calls `updateUserSettings({default_quality})`; toggling require-passcode reveals the passcode inputs; the system card shows health info.

### Task 5: Wire the routes
**Files:** `src/app/downloads/page.tsx`, `src/app/schedules/page.tsx`, `src/app/settings/page.tsx`, `src/app/users/[id]/settings/page.tsx`.
Each renders its new FRÈ view (`DownloadsView`/`SchedulesView`/`SettingsView`), removing the legacy component imports. `/settings` (system) can render the SettingsView's system card or redirect/compose; `/users/[id]/settings` renders SettingsView for that profile.
**Verify:** tsc + build.

### Task 6: Phase gate
`npm run test` (green), `npx tsc --noEmit` (clean), `npm run build` (succeeds; `/downloads`,`/schedules`,`/settings`,`/users/[id]/settings` build). Tag `fre-phase7-utility`.

---

## Notes for implementers
- Build with FRÈ primitives + the new `Field` form set; gold-on-ink, gold focus rings.
- Reuse services + types EXACTLY; don't change endpoints or `ScheduleConfig`/`UserSettings` shapes. Never write the `theme` setting from the UI.
- Mock `@/services/*` + `@/context/UserContext` in tests; use `findBy*`/`waitFor`; pristine output.
- The TopNav Activity badge stays a placeholder until the (Phase-8) activity-count endpoint; the Downloads page itself shows the real list + the active/2 count.
