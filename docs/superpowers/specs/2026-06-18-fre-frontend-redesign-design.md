# FRÈ — Freeflix Frontend Redesign (Design Spec)

**Date:** 2026-06-18
**Status:** Approved design — ready for implementation planning
**Topic:** Ground-up redesign of the Freeflix frontend (UX + branding)

**Goal:** Rebuild the entire Freeflix web frontend as a god-tier, cohesive streaming experience — "FRÈ", an Editorial-Noir identity inspired by Netflix / Disney+ / Apple TV+ — while preserving every existing capability and reusing the current backend.

**Architecture:** Frontend-only redesign. Next.js 15 (App Router, React 19, Tailwind v4, TypeScript) is kept; the FastAPI + libtorrent + Postgres backend is reused as-is. A small set of **additive** backend changes (new read endpoints + nullable columns / new tables) unlock features the new UI surfaces; none are required for the visual redesign to ship.

**Tech Stack:** Next.js 15 · React 19 · Tailwind CSS v4 (`@theme` tokens) · TypeScript · existing axios service layer + React contexts. Fonts: **Fraunces** (display) + **Inter Tight** (UI), via Google Fonts.

---

## 1. Summary

This is a complete visual and UX overhaul, not a reskin. We keep the app's information model (catalog, torrents, streaming, multi-profile progress) and its data/service layer, and replace the entire presentation layer with a single, intentional design system: **FRÈ — Editorial Noir**.

The redesign was validated screen-by-screen as live HTML mockups before writing this spec. The locked surfaces are: the **"Who's watching?" profile gate**, **Home / Movies / Series** (a shared browse system), **Search**, **Movie detail**, **Show (TV) detail**, and the **Player**. Three utility surfaces — **Downloads/Activity**, **Schedules**, **Settings** — are specified here in the established language without separate mockups.

### Non-goals (out of scope)
- No backend rewrite. The catalog/providers/services architecture stays.
- No real authentication. The app remains **multi-profile, no-auth** (profiles are a Netflix-style convenience, optionally passcode-gated).
- **Dark-only.** FRÈ Editorial Noir is an inherently dark identity. A light theme is out of scope for this redesign; the existing `ThemeContext`/`ThemeToggle` is retired (or hard-pinned to dark) — see §9.
- The legacy `scrapers/` path and `yify_url`/`rarbg_url` settings remain untouched and unused.

---

## 2. Brand & Identity

- **Public wordmark:** **FRÈ** (set in Fraunces, with a champagne gold gradient: `#FFFFFF → #E7D6AE → #C9A86A`). Shown in the nav, the profile gate, splash/loading, and document title.
- **Internal/repo name stays `freeflix`** — no backend, package, container, or directory renames. The rename is presentation-only (wordmark, page `<title>`, splash).
- **Aesthetic: Editorial Noir.** Gallery-grade, "expensive", Apple TV+/Max-tier restraint: deep ink, generous negative space, large editorial serif display type over a clean grotesque, hairline rules, and a *precious* use of gold. The product should feel like a private cinema, not a hobby project.
- **Tagline (optional, for splash/empty states):** *"Cinema, kept close."*

---

## 3. Design System — FRÈ

The design system is the foundation that every surface is built from. It is codified once (Tailwind v4 `@theme` + a small set of reusable components and a global "atmosphere" layer) and reused everywhere.

### 3.1 Color tokens

| Token | Hex | Role |
| --- | --- | --- |
| `--ink` (background) | `#0A0A0B` | Page base |
| `--surface` | `#111113` | Cards, raised panels |
| `--surface-2` | `#16161A` | Inputs, secondary panels |
| `--text` | `#F4F1EA` | Primary text (warm off-white) |
| `--muted` | `#8C8884` | Secondary text, inactive |
| `--hairline` | `#26242A` | 1px borders / dividers |
| `--gold` | `#C9A86A` | **Precious** accent |
| `--gold-lite` | `#E7D6AE` | Champagne highlight / gradient stop |
| `--danger` | `#E5564B` | Destructive (remove, errors) |
| `--success` | `#7BDCA0` | Healthy seeds, completed |

**Gold discipline (a hard rule):** gold is reserved for active/selected states, ratings, primary CTAs, the played portion of the scrubber, progress fills, ranked numerals, and focus rings. Never flood a surface with gold. When in doubt, use `--text`/`--muted`.

### 3.2 Typography

- **Display — Fraunces** (variable, optical-size aware): hero titles, section titles, the FRÈ wordmark, and italic taglines. Use large optical sizes, weights 300–600, tight negative letter-spacing on big titles, and occasional *italic* for taglines/flourishes.
- **UI/body — Inter Tight** (400–600): nav, meta, body copy, buttons, labels, keypad numerals, all chrome.
- **The serif/sans tension is the hierarchy** — emotion in the serif, system in the sans. Never set body copy in Fraunces or large titles in Inter Tight.

Type scale (fluid, `clamp()`): hero title `clamp(54px, 8.5vw, 128px)`; section title ~30px; card/episode title ~17–27px; body 15–16px; meta 13–14px; eyebrow 11px uppercase `.32em` tracking.

### 3.3 Layout

- **Full-bleed.** No centered max-width container. Content stretches edge to edge (a streaming service fills the viewport). Internal horizontal padding (`--pad`) is fluid `clamp(28px, 5vw, 56px)`.
- **Hairline rules** (`--hairline`) separate major zones; generous vertical rhythm between rows.
- **Cards & carousels** are horizontal-scroll rows with scroll-snap and visible arrow controls; cards are Disney+-scale (see §3.5).

### 3.4 Cinematic Atmosphere (global layer)

A reusable, theme-wide layer applied to immersive surfaces (Home/Movies/Series/detail/profile gate). It is what gives FRÈ its "movie-night" feel. All of it was validated in the mockups.

- **Theatre vignette** — a viewport-fixed darkening of screen edges/corners (radial + inset shadow). Center stays clear so text contrast is never reduced.
- **House lights** — large, soft, slowly-drifting warm-gold radial pools behind the hero and section headers (projector light in a dark room).
- **Film grain** — a faint fixed SVG `feTurbulence` overlay (≈4–5% opacity, soft-light/overlay blend).
- **Hero premiere** — slow Ken-Burns drift on hero backdrops (scale 1.0→1.08 over ~36s, ease, alternate), deepened scrims, a soft bloom behind the title, a footlight glow at the hero base, and a faint letterbox top edge.
- **Spotlight-on-hover** — hovering a card row dims/desaturates the sibling cards while the focused card warms, lifts, gains a gold halo, and catches a light **sheen** sweep. Applies to every poster/landscape/rank/spotlight row.
- **Premiere shine** — a slow gold sheen across the wordmark and primary CTA; a faint shimmer on ranked numerals.
- **Paused warmth (player only)** — on pause, a warm-gold vignette blooms in and the frame gently dims + blurs; controls/title stay crisp on top (z-index 4: above film, below all controls).

**Motion is a privilege, not a default.** Every animation above (drift, pools, flicker, shimmer, sheen, spotlight transitions, paused blur) is disabled under `@media (prefers-reduced-motion: reduce)`. Performance: animate `transform`/`opacity`; avoid continuously animating heavy filters; keep blur radii sane (the ARM/Raspberry-Pi target matters).

### 3.5 Components

Reusable primitives (rebuild the current `components/ui/*` set in the FRÈ language):

- **Top nav** (`ff-topnav`) — fixed, transparent over the hero, gains a solid blurred bar + hairline border once scrolled past ~60px (`.is-scrolled`, toggled by a scroll listener). Left: FRÈ wordmark. Center-left: links (Home / Movies / Series / Search) with a gold underline on the active route (`aria-current="page"`). Right: slim search field, an **Activity** pill (download ring + count), profile avatar (dropdown → Schedules / Downloads / Settings / Switch Profile). Mobile: collapses to a bottom tab bar; search becomes an icon.
- **Buttons** — primary (champagne fill, dark text, gold sheen), glass/secondary (hairline border + blur), icon button (circular), ghost (text + hairline). Tasteful hover (lift/brightness/gold border). Visible `:focus-visible` gold ring everywhere.
- **Cards** (Disney+-scale, fluid):
  - *Poster card* (2:3) — `width: clamp(184px, 15.5vw, 272px)`; hairline border; caption (title · year · gold rating · genre); hover-reveal overlay (synopsis snippet, genre chips, runtime, quick Play/＋/info).
  - *Continue-watching card* (16:9) — `clamp(312px, 26vw, 432px)`; thin **gold** progress fill; remove (✕) on hover; episode-aware sublabel.
  - *Featured/landscape tile* (16:9) — large `clamp(360px, 30vw, 520px)`; gold "Featured" badge; title overlay; hover play.
  - *Ranked tile* (Top-10) — big outlined editorial numeral + poster.
- **Pills / chips** — quality pills, genre/year/sort chips (with popovers), category pills.
- **Progress** — linear gold fill (watch progress, download progress) and a conic ring (Activity, autoplay countdown).
- **Modal / overlay** — glass card over a dimmed+blurred backdrop (passcode, quick-view, confirmations).
- **Keypad** — numeric 1–9, 0, delete (passcode entry).
- **Row header** — eyebrow + Fraunces section title + "See all ›" + arrow controls.

### 3.6 Accessibility baseline (applies to all components)

- Real semantic elements: `<button>` for actions, `<a>` for navigation; carousels are `role="list"`, focusable, arrow-key scrollable.
- Visible layered focus ring (`0 0 0 2px var(--ink), 0 0 0 4px var(--gold)`) on every interactive element.
- AA contrast for text over imagery (scrims/gradients behind text); hover-only affordances also fire on `:focus-visible`; touch shows them at reduced opacity.
- `prefers-reduced-motion` honored globally.

---

## 4. Navigation & Information Architecture

**Entry gate:** "Who's watching?" profile select (multi-profile, optional passcode).

**Primary nav (top bar):** Home · Movies · Series · Search.

**Utility (profile dropdown / secondary):** Downloads/Activity · Schedules · Settings · Switch Profile. These are self-hosted power tools, intentionally off the primary bar.

**Route map** (App Router; mostly preserved):

| Route | Surface |
| --- | --- |
| `/` | Home |
| `/movies` | Movies hub (new dedicated hub; today only `/movies/[id]` exists) |
| `/movies/[id]` | Movie detail |
| `/tv` (Series) | Series hub |
| `/tv/[id]` | Show detail |
| `/search` | Search |
| `/streaming/[id]` | Player (full-viewport) |
| `/downloads` | Downloads / Activity |
| `/schedules` | Schedules |
| `/settings`, `/users/[id]/settings` | Settings |
| profile gate | Rendered by the app shell when no active profile (replaces `UserSelectScreen`) |

> Note: a **Movies hub** (`/movies`) is added to mirror Series; today the app jumps straight to movie detail. Browse content for Home/Movies/Series shares one layout system, differing only in content.

---

## 5. Surfaces

Each surface reuses the design system + atmosphere. Layouts below are the validated mockups.

### 5.1 Profile gate — "Who's watching?"
Full-viewport, centered. FRÈ wordmark, huge Fraunces "Who's watching?", a row of profile tiles (rounded avatars, desaturated at rest → full color + gold ring on hover/focus) + an "Add Profile" tile, and a "Manage Profiles" button. A passcode-protected profile shows a gold lock badge; selecting it opens a glass **passcode overlay** (avatar, 4 dots, FRÈ keypad, Cancel).
**Data:** `UserContext` profiles; `UserSettings.require_passcode`/`passcode`; avatars via `utils/avatarHelper` (`AVATAR_OPTIONS`, `getInitials`, `handleAvatarError`, …). Replaces `components/users/UserSelectScreen` + `PasscodeModal`.

### 5.2 Home / Movies / Series (shared browse system)
- **Sticky top nav** (transparent → solid on scroll).
- **Cinematic hero billboard** — `clamp(620px, 85vh, 1040px)`, full-bleed backdrop with Ken-Burns + scrims, eyebrow, huge Fraunces title, meta row (year · cert · runtime · genres · gold rating), tagline/logline, actions (Play / More Info / ＋ My List).
- **Featured rail** — a row of large 16:9 Disney+-style tiles, pulled up to **overlap the bottom of the hero**, sitting **above** Continue Watching. A curated/rotating "Featured" slot.
- **Continue Watching** — episode-aware cards; Resume vs Up-next split mirrors `ContinueWatchingSection.tsx` (Up-next only when the latest watched episode is `completed`; otherwise it's a Resume card with a gold progress fill).
- **Showcase rows** (the "different search criteria" the brief asked for): standard poster carousels (Trending, New, Popular, Top Rated, genre rows), a **Top 10 This Week** ranked row, and a wide **FRÈ Spotlight** editorial row. *Movies* and *Series* hubs reuse this exact system with media-type-specific rows.
- **"Because you watched…"** — a client-derived row (from progress genres + catalog), no backend change.

**Data:** catalog popular/latest/top-rated/genre via `services/movies.ts` + `tv.ts`; Continue Watching via `ProgressContext`/`UserStreamingProgress` keyed by `content_id`; Activity from downloads state. (Hero "featured", Spotlight "collections", and Top-10 "this week" are net-new — see §7.)

### 5.3 Search
Search hero (typed query + result count), a filter bar (type toggle All/Movies/Series + Genre/Year/Sort chip popovers), a responsive results grid of Disney+-scale poster cards (spotlight-on-hover, quick actions) with pagination, and an empty-state **"Browse by genre"** strip (artwork tiles + counts).
**Data:** `/movies/search` + `/tv/search` (merge+dedupe by `tmdb_id` for "All"); chips → `genre`/`year`/`order_by`; sort mapping Popular→`popularity.desc`, Top Rated→`vote_average.desc`, Newest→`release_date.desc` (`first_air_date.desc` for TV); filter state reflected in the URL querystring for shareable/back-button-safe results.

### 5.4 Movie detail
Cinematic backdrop hero (poster inset, Fraunces title, meta, tagline+logline). **The signature streaming flow:** a **quality/source picker** — `Auto (best)` · 720p · 1080p · 2160p — each pill showing size + seed health; primary **Play** (champagne, gold sheen), **Download** (glass), ＋ My List, Share, and the caption *"Streams instantly while it downloads."* Below: Overview, Director + Cast (round portraits), a details rail, and a **More Like This** poster row.
**Data:** pills populated from **existing** `GET /movies/{tmdb_id}/torrents` → `services/torrents_select.select_best` (and `available_qualities()`); selecting a pill pins a `TorrentHit` (magnet/hash). **Play** starts/streams the pinned torrent via the libtorrent manager singleton and routes to `/streaming/[id]` keyed by `content_id = movie:{tmdb_id}` (carrying `?file=N` if the torrent is multi-file). **Download** adds the same torrent without opening the player. Only the *picker UI* is new. Rotten-Tomatoes % is feature-flagged off (TMDB is the only live rating source).

### 5.5 Show (TV) detail
Backdrop hero with a **Resume S{n}·E{m}** primary CTA, ＋ My List, **Download Season**. A **season selector** (tabs/dropdown) and an **episode list**: each row = 16:9 still, number + title, runtime/air date, synopsis, a play orb, and a right-hand action rail (play/resume + quality/download). Every real state is shown: *Watched* (full gold bar), *In Progress* (gold bar + "X min left" + Resume), *Up Next* badge, and per-episode download chips (**Downloaded · NN% · In pack**). Cast row + More Like This.
**Data:** per-episode play resolves to the season-pack torrent + **`file_index`** (`?file=N`); episode→file_index is mapped server-side (pack order is not guaranteed to match episode order). Progress keyed by `content_id = tv:{tmdb_id}:s{n}:e{m}`; gold fills, "min left", In-Progress/Up-Next mirror `ContinueWatchingSection`. Chip states map to libtorrent per-file progress: `Downloaded`=`file_progress()==1.0`, `NN%`=partial (still streamable), `In pack`=present but unprioritized (`file_progress()==0`). Hero Resume sub-label and the in-progress episode are bound to the same progress record so they can't drift.

### 5.6 Player (full-viewport, no page scroll)
Fills the viewport (`100vw × 100vh`, video letterboxed via `object-fit: contain`); fullscreen just drops browser chrome on top. Controls pinned to viewport edges:
- **Top overlay:** back, Fraunces title (S·E for episodes), a **"Streaming · NN% downloaded"** chip, settings gear.
- **Center:** large play/pause + 10s skip-back / skip-forward.
- **Scrubber:** distinguishes **downloaded/buffered** (light track) from **played** (gold) with a draggable knob and a hover thumbnail preview.
- **Control bar:** volume, time, and a right cluster — playback speed, audio + subtitles/CC, quality (e.g. 1080p), Picture-in-Picture, fullscreen (active control tints gold).
- **Skip Intro** pill and a **Next Episode** up-next card with an autoplay countdown ring.
- **Paused warmth:** warm vignette + gentle dim/blur on pause (§3.4).

**Data (real):** the downloaded-vs-played scrubber and the download chip map directly to libtorrent file progress. **Aspirational / net-new** (build the UI, gate the feature on backend availability): subtitle/CC tracks, multiple audio tracks, mid-stream quality switching, intro markers ("Skip Intro"), and a sprite/thumbnail track for scrubber previews. See §7.

### 5.7 Downloads / Activity (specified, not mocked)
A full surface for the libtorrent activity that today lives at `/downloads`. FRÈ list/grid of active torrents: title + poster, state, a gold progress bar, speed ↓/↑, peers/seeds, ETA, size, and pause/resume/remove + "prioritize for streaming" + "open player". Show the **streaming-while-downloading** state prominently (an item can be watched at NN%). The nav **Activity pill** is a compact view of this (count + aggregate progress ring). **Data:** existing `services/torrents.ts` (`listTorrents`, status, action, remove, prioritize); auto-refresh poll. (Backend caps active downloads to 2 on ARM — reflect that limit in the UI copy.)

### 5.8 Schedules (specified, not mocked)
Automated-download rules (cron). A FRÈ list of schedule cards (name, criteria summary, cadence, quality, max downloads, next-run, last-run) with run-now/edit/delete, and a create/edit form (search criteria, quality, cron cadence, caps). **Data:** existing `services/schedules.ts` (CRUD + run). Power-user surface; tucked under the utility menu.

### 5.9 Settings (specified, not mocked)
Per-profile + app preferences in the FRÈ language: maturity restriction, require-passcode + passcode, **default quality**, download path, and a **system health** panel (root/healthcheck). Theme toggle is retired (dark-only — §9). **Data:** existing `services/users.ts` settings endpoints + `baseService` health.

---

## 6. Data → Endpoint Map

| UI element | Source (service / endpoint) | Status |
| --- | --- | --- |
| Catalog rows (Trending/Popular/Latest/Top Rated/Genre) | `movies.ts`/`tv.ts` → catalog popular/latest/top-rated/genre | **Existing** |
| Search results + filters | `/movies/search`, `/tv/search`; `genre`/`year`/`order_by` | **Existing** |
| Continue Watching / Resume / Up-Next | `ProgressContext` → `UserStreamingProgress` (`content_id`, `file_index`) | **Existing** |
| "Because you watched…" | client-derived from progress genres + catalog | **Existing (client)** |
| Movie source/quality picker | `GET /movies/{id}/torrents` → `torrents_select.select_best`/`available_qualities` | **Existing data, NEW UI** |
| Play / stream (movie & episode) | libtorrent manager singleton → `/streaming/[id]` by `content_id` (+ `?file=N`) | **Existing** |
| Episode download chip states | libtorrent per-file `file_progress()` | **Existing** |
| Player downloaded-vs-played scrubber + chip | libtorrent file/overall progress | **Existing** |
| Downloads/Activity | `torrents.ts` (list/status/action/remove/prioritize) | **Existing** |
| Schedules | `schedules.ts` (CRUD + run) | **Existing** |
| Profiles / passcode / settings | `UserContext`, `users.ts`, `UserSettings` | **Existing** |
| Hero "Featured" (deliberate editorial pick) | — | **Net-new** (§7) |
| FRÈ Spotlight (collections) | — | **Net-new** (§7) |
| Top 10 "This Week" windowing | — | **Net-new** (§7) |
| ＋ My List / watchlist | — | **Net-new** (§7) |
| Activity pill count + aggregate ring | derivable from `/torrents/list`; cleaner with a dedicated endpoint | **Net-new (optional)** |
| Player subtitles/CC, audio tracks, quality-switch, intro markers, scrubber sprites | — | **Aspirational** (§7) |

---

## 7. Backend Additions (additive only)

None block the visual redesign. All follow the project's **no-Alembic, additive** convention — add a nullable column or a new table to the ORM model and it is auto-created/added on next startup by `init_db()` → `create_all()` + `sync_columns()`. Order by value:

**A. Parity / high-value (small):**
1. **My List / Watchlist** — a per-profile table keyed by `(profile_id, content_id)` + endpoints (add/remove/list). Powers the ＋ My List affordances and a "My List" row/section. *New table.*
2. **Episode → file_index mapping** — ensure the show-detail/episode play path can resolve an episode to its file index within a season pack reliably (pack order ≠ episode order). May be a service-layer mapping rather than schema.
3. **Source-picker** — UI only; uses existing `/torrents` endpoints. No backend change (listed here because it's the signature flow).

**B. Editorial / curation (medium):**
4. **Featured pick** — a small `featured` concept so the hero is a deliberate editorial choice rather than `popular[0]`. Short-term: client picks top trending. Long-term: a backend flag/endpoint.
5. **Collections** — backend "collections" concept behind FRÈ Spotlight + Browse-by-genre tiles. Short-term: client-curated collection slugs querying catalog genre. Long-term: a collections endpoint.
6. **Top 10 "This Week"** — true weekly windowing: either TMDB trending/week, or a local view-count aggregate over `UserStreamingProgress.last_watched_at` (7-day window). Short-term: a labelled slice of top-rated/popular.
7. **Activity count endpoint (optional)** — a lightweight "active downloads count + aggregate progress" over `torrent_manager` state for the nav badge.

**C. Player aspirational (larger, gate the UI):**
8. Subtitle/CC tracks, multiple audio tracks, mid-stream quality switching, intro markers (Skip Intro), sprite/thumbnail track for scrubber previews. Build the controls; **feature-flag** each until the backend can supply the data.

---

## 8. Frontend Architecture & Implementation Notes

- **Keep the stack & wiring.** Next 15 App Router, React 19, Tailwind v4, TS. The browser still never calls the backend directly — `next.config.ts` `rewrites()` proxy `/api/*` → `BACKEND_INTERNAL_URL`; `/api/palette*` stays on Next. Client code stays on `services/api-client.ts` + per-domain modules.
- **Reuse contexts:** `UserContext` (active profile), `ProgressContext`, and the `content_id` helpers are unchanged. The `content_id` format (`movie:{id}` / `tv:{id}:s{n}:e{m}`) and `file_index`/`?file=N` carrying are load-bearing — do not change them.
- **Design tokens** live as Tailwind v4 `@theme` CSS variables in `globals.css` (replacing the current purple/cyan palette). The **atmosphere layer** is a small reusable set (a `<CinematicAtmosphere>` wrapper or shared CSS: grain, glow, vignette; row-level spotlight; hero Ken-Burns; paused warmth).
- **Component inventory** — rebuild `components/ui/*` (Button, Card, Badge, Input, Select, Progress, Navigation, SectionHeader, etc.) in FRÈ; replace feature components (`home/*`, `movies/*`, `tv/*`, `player/*`, `search/*`, `users/*`, `downloads/*`, `schedules/*`). The new top nav, card variants, carousels, and the player controls are the highest-leverage primitives.
- **Player:** keep `VideoPlayer.tsx` + `PatchedVideoPlayer.tsx`'s save/resume logic and `effectiveMovieId = contentId ?? movieId`; reskin the controls and add the new states (paused warmth, up-next, skip-intro, scrubber preview, quality/audio/subtitle menus gated by availability).
- **Data fetching** stays imperative via the existing services. (Optional, non-blocking: introduce a small caching layer / SWR later; not required by this spec.)
- **Imagery** comes from TMDB (`backdrop_path`/`poster_path`/`profile_path`) — `next.config.ts` already whitelists `image.tmdb.org`. Mockup picsum seeds are placeholders only.

---

## 9. Theming decision (dark-only)

FRÈ Editorial Noir is a dark identity; a light variant would dilute it and double the design/QA surface. **Decision:** ship **dark-only**. Retire `ThemeContext`/`ThemeToggle` (or hard-pin to dark and hide the toggle), and remove the per-profile `theme` setting from the Settings UI. Revisit a light theme as a future, separate effort if desired.

---

## 10. Scope & Phased Decomposition

This is large; it decomposes into sub-projects, each producing working, testable software. Suggested order (each becomes its own implementation plan):

1. **Design-system foundation** — tokens (`@theme`), Fraunces+Inter Tight, the reusable atmosphere layer, and the core `ui/*` primitives (buttons, cards, nav shell, pills, progress, modal). *No surface yet; everything downstream depends on this.*
2. **App shell + nav + profile gate** — sticky top nav, mobile tab bar, profile select + passcode, route wiring, dark-only cleanup.
3. **Browse system (Home + Movies + Series)** — hero billboard, Featured rail, Continue Watching, the showcase rows + carousels, spotlight-on-hover.
4. **Search** — hero, filter bar + popovers, results grid + pagination, browse-by-genre empty state, URL state.
5. **Detail pages** — Movie detail (source/quality picker + play/download flow) and Show detail (season selector + episode list + states).
6. **Player** — full-viewport watch page, new control bar + scrubber, paused warmth, up-next/skip-intro, and the availability-gated menus.
7. **Utility surfaces** — Downloads/Activity, Schedules, Settings.
8. **Backend additions** — My List, then editorial/curation (featured/collections/Top-10 windowing), then optional activity endpoint; player aspirational items as separate follow-ups.

---

## 11. Testing & Verification

- **Typecheck:** `npx tsc --noEmit` (frontend) on every plan.
- **Build:** `npm run build` must pass.
- **Visual review:** each surface reviewed against the approved FRÈ mockups (the brainstorm companion screens are the reference).
- **Accessibility:** keyboard traversal, focus rings, `prefers-reduced-motion`, AA contrast spot-checks per surface.
- **Backend additions:** covered by the existing pytest suite; additive schema changes verified via `sync_columns` (see `tests/test_migrations.py`). New endpoints get unit tests.
- **Key flows to manually verify:** profile select + passcode → browse → detail → pick source/quality → play (stream while downloading) → progress saves → Continue Watching resume (movie and episode) → search.
- There is no e2e framework today; this redesign does not add one (out of scope).

---

## 12. Open Questions / Assumptions

- **Avatars:** assumed photo/portrait avatars via `avatarHelper`; an elegant monogram fallback (`getInitials`) covers missing images.
- **"Featured"/Spotlight content** is client-curated until the backend `featured`/collections concepts exist; the spec treats those as enhancements, not blockers.
- **My List** is assumed in-scope as the first backend addition (small new table); if it should be deferred, the ＋ My List affordances ship disabled.
- **Light theme** is assumed out of scope (dark-only). Flag if a light variant is required.
