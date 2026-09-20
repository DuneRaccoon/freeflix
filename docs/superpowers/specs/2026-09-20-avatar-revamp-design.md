# Avatar revamp — design

Replaces the eight hand-drawn cartoon SVGs with a **45-piece house set** of original artwork in the FRÈ
Editorial-Noir language, plus an opt-in **second tier** that turns a still from a title you've actually
watched into a profile avatar. Along the way the avatar value stops being an unvalidated free-text path and
becomes a validated id, and the two divergent pickers collapse into one.

Status: design locked 2026-09-20. Branch `feat/avatar-revamp`.

---

## 1. Locked decisions

| # | Decision |
| --- | --- |
| 1 | **Two tiers.** Tier 1 is an original hand-authored SVG house set — always present, no network, no API key. Tier 2 ("From your library") caches a TMDB still server-side. Tier 1 is the product; tier 2 is an extra. |
| 2 | **Art direction: Plate.** Solid ink silhouette on a saturated collection-accent field with a bone rim-light. Chosen over engraved line-art (too delicate at 36px) and rim-lit forms (mush at 36px) because one asset must serve every size. |
| 3 | **45 pieces.** 9 baseline + 9 themed collections × 4. Picker gains collection tabs. |
| 4 | **Stored value is a scheme-prefixed id**, not a path: `house:frontier-hat`, `cached:8f3a91c2`. Resolved at render time in exactly one place. |
| 5 | **The backend validates shape, not membership.** A regex + length cap closes the "any string reaches `<img src>`" hole without duplicating the catalog server-side. |
| 6 | **Tier 2 clients send a TMDB path fragment, never a URL.** The backend builds the `image.tmdb.org` URL itself, so the asset fetcher can never be aimed at an arbitrary host. |
| 7 | **The old eight files are retired.** Legacy rows are coerced at read time onto house-set equivalents, so no existing profile goes blank. |
| 8 | **One fallback philosophy: the Fraunces monogram.** `default.png` and `DEFAULT_AVATAR_DATA_URI` are deleted. |
| 9 | **One picker, one render component.** `components/users/AvatarSelector.tsx` and `components/users/UserAvatar.tsx` are deleted. |

---

## 2. Non-negotiable constraints discovered in the codebase

These come from reading the repo. Violating any of them silently breaks something.

### 2.1 The same asset is masked two ways at four sizes

| Surface | File:line | Size | Shape |
| --- | --- | --- | --- |
| Profile gate | `components/shell/ProfileGate.tsx:83,89` | `clamp(110px,13vw,150px)` | `rounded-[22px]` |
| Nav trigger | `components/shell/ProfileMenu.tsx:46,52` | 36px | `rounded-full` |
| Invite picker | `components/auth/AvatarPicker.tsx:16` | ~85–90px | `rounded-[18px]` |
| Settings | `components/users/UserAvatar.tsx:23-28` | 32 / 48 / 96 / 128px | `rounded-full` |

Everything renders through a bare `<img>` with `object-cover` — **not** `next/image`, so
`next.config.ts` `images.remotePatterns` gates nothing on this path.

**Rule:** art fills the full square viewBox. It must never draw its own background circle. The current set
does (`<circle cx="100" cy="100" r="100">` in every file), which is exactly why circular art inside the
22px squircle tile looks wrong today.

### 2.2 The gate tile puts a gold disc over the top-right corner

`ProfileGate.tsx:91-93` overlays a 28px lock badge at `right-2 top-2`. On a 150px tile that maps to roughly
**x > 150, y < 50 in viewBox units**. Nothing load-bearing may live there.

### 2.3 Gold is a state signal, not a colour

`docs/.../2026-06-18-fre-frontend-redesign-design.md` §3.1: gold is reserved for active/selected, ratings,
CTAs and focus rings — "never flood a surface with gold". `AvatarPicker.tsx:58` signals selection with
`border-gold`.

**Rule:** no `#C9A86A` in avatar artwork. The house set uses bone; collections use their registry accent.

### 2.4 The surface ramp is 7 RGB points wide

`globals.css:9-11` — ink `#0A0A0B` → surface `#111113` → surface-2 `#16161A`. Any avatar field inside that
band disappears into the tile behind it. Fields must be clearly brighter than `#16161A`.

### 2.5 Dark-only, and tokens do not flip

`globals.css:33` sets `color-scheme: dark`; there is no `prefers-color-scheme: light` block and no
`[data-theme]` selector. `ThemeContext.tsx:22-28` is a stub. Art is authored for a dark surround only.

### 2.6 SSR determinism

`components/browse/FeedMotif.tsx:8-19` hardcodes star coordinates specifically so server and client render
identically. Any generated or randomised avatar geometry would hydrate-mismatch. **No `Math.random`,
no `Date.now`.**

### 2.7 `sync_columns()` only ever adds columns

Per `CLAUDE.md`: no Alembic, `init_db()` runs `create_all()` then an additive `ALTER TABLE ... ADD COLUMN`
pass. `users.avatar` is already `Column(String, nullable=True)` (`database/models/users.py:27`) with no
length limit, and **its type can never be narrowed in place**. The id scheme therefore has to fit the
existing unbounded `VARCHAR`; the length cap lives in Pydantic, not the DDL.

### 2.8 Nothing persists the asset cache

`docker-compose.yml:55-60` mounts only `./downloads`, `resume-data` and `logs`. `AssetManager`'s cache
would live at `/opt/freeflix/assets` and evaporate on every rebuild. `settings.initialize()`
(`config.py:225-229`) does not create that path either.

### 2.9 `backend/app/assets/manager.py` is dead code with sharp edges

304 lines, **zero importers**, no router, no `__init__.py`. Before it can be used:

- `serve_asset()` (`manager.py:276-300`) does `self.cache_path / path` with **no path-traversal guard**
- `download_asset()` (`manager.py:149-193`) has `follow_redirects=True`, no size cap, no content-type check
- the module is not a package, so it cannot be imported as written

### 2.10 Existing rows hold literal paths

Every profile that has ever picked an avatar stores `/avatars/avatarN.svg`. There is no migration
framework and no backfill mechanism, so the resolver must handle these forever (or until a deliberate
one-off script runs).

---

## 3. The value format

### 3.1 Grammar

```
avatar := "" | "house:" slug | "cached:" hex | legacy
slug   := [a-z0-9][a-z0-9-]{0,63}
hex    := [a-f0-9]{8,64}
legacy := "/avatars/avatar" [1-8] ".svg"
```

`legacy` is accepted on **write** only so that a client running stale JS during a deploy cannot 422 its
own profile save. It is never minted by new code, and §3.2 maps it on read.

`NULL` means "leave alone" on update; `""` means "clear". This is existing behaviour and is load-bearing —
`api/users.py:221-223` documents it, and changing it would break the only path that can unset an avatar.

### 3.2 Resolution

`frontend/src/lib/avatars/resolve.ts` is the single place this happens:

| Input | Output |
| --- | --- |
| `house:<slug>` present in catalog | `/avatars/house/<slug>.svg` |
| `house:<slug>` **not** in catalog | `null` → monogram |
| `cached:<hex>` | `/api/v1/assets/avatars/<hex>.jpg` |
| `/avatars/avatar1.svg` … `avatar8.svg` | mapped to a house-set id (table below) |
| anything else, including `null` and `""` | `null` → monogram |

The last row is what closes the XSS hole on the render side: an unrecognised value never reaches
`<img src>`.

### 3.3 Legacy mapping

The eight retired files map onto baseline house pieces by index, so an upgrade silently improves every
existing profile rather than blanking it:

| Legacy | Becomes |
| --- | --- |
| `avatar1.svg` | `house:reel` |
| `avatar2.svg` | `house:clapper` |
| `avatar3.svg` | `house:filmstrip` |
| `avatar4.svg` | `house:projector` |
| `avatar5.svg` | `house:ticket` |
| `avatar6.svg` | `house:boom-mic` |
| `avatar7.svg` | `house:marquee` |
| `avatar8.svg` | `house:directors-chair` |

This is a **read-time coercion only**. Rows are not rewritten; the DB keeps the old string until the
profile is next saved. That keeps the change reversible.

---

## 4. Art direction — Plate

### 4.1 The rule

A filled `#0A0A0B` silhouette on a vertical two-stop gradient of the collection accent, with a bone
rim-light tracing the upper-left edge of the subject.

- **Field:** `linearGradient` top→bottom, top stop = accent lifted ~10%, bottom stop = accent darkened ~55%
- **Subject:** solid `#0A0A0B`
- **Rim light:** a stroke of the accent mixed ~80% toward `#F4F1EA`, `stroke-width` 3–4.5,
  `stroke-linecap="round"`, tracing the upper-left edge only — one light source across the whole set
- **Interior detail:** cut back to the field colour at 50–85% opacity (e.g. a hat band), never a third hue

### 4.2 Canvas

- `viewBox="0 0 200 200"`, no `width`/`height` attributes
- Subject within a centred circle of **r ≤ 88** so the circular mask never clips it
- Nothing meaningful at `x > 150, y < 50` (the lock badge — §2.2)
- Field covers the full 200×200 — no background circle (§2.1)
- No `<style>`, no classes, no `currentColor`: these render through `<img>`, which does not inherit from
  the document

### 4.3 Reference field values

| Collection | Accent (registry) | Top stop | Bottom stop |
| --- | --- | --- | --- |
| The House Set | — (bone) | `#CFC8B8` | `#8A8479` |
| After Dark | `#8E2C2C` | `#A83636` | `#421518` |
| The Future Is Now | `#3FB7C4` | `#4FC9D6` | `#1B5A64` |
| The Frontier | `#BB6B3A` | `#D08046` | `#5E3520` |

Remaining collections follow the same derivation from their `feedThemes/registry.ts` accent.

---

## 5. Catalog and taxonomy

`frontend/src/lib/avatars/catalog.ts` holds the data. Accents are imported from — or kept in step with —
`lib/feedThemes/registry.ts` so an avatar and its rail share a colour-way.

```ts
type AvatarPiece      = { id: string; label: string }
type AvatarCollection = { key: string; title: string; accent: string; pieces: AvatarPiece[] }
```

| Collection | Accent | Pieces |
| --- | --- | --- |
| The House Set | bone | reel, clapper, filmstrip, projector, ticket, boom-mic, marquee, directors-chair, leader-three |
| After Dark | `#8E2C2C` | moth, porcelain mask, streetlamp in fog, raven |
| The Future Is Now | `#3FB7C4` | helmet visor, ringed planet, ray gun, satellite |
| The Frontier | `#BB6B3A` | wide-brim hat, horseshoe, saguaro, spurs |
| Shadows & Smoke | `#9AA7B4` | fedora, venetian blinds, martini, candlestick phone |
| Realms of Wonder | `#8E7BD6` | castle turret, sword, crescent and star, owl |
| Matters of the Heart | `#C77B92` | rose, paired glasses, sealed letter, moon on water |
| The Big Laugh | `#E8B62F` | bowler and cane, comedy mask, seltzer bottle, pie tin |
| The Green World | `#6FA287` | leaf, bird in flight, rain umbrella, paper boat |
| Silent Era | see below | iris shot, upright piano, title card, carbon-arc lamp |

**Count:** 9 baseline + 9 collections × 4 = **45 pieces**, matching decision #3.

**Palette collision.** Silent Era's natural colour-way is a bone/silver nearly identical to the House Set
field, and the obvious alternatives sit on top of Shadows & Smoke (`#9AA7B4`) or The Frontier (`#BB6B3A`).
Resolution: Silent Era **inverts the Plate treatment** — a bone subject on a dark nitrate-silver field
(`#2A2C30` → `#101114`), distinct by treatment rather than by hue. It is the one deliberate inversion in
the set, and it reads as a projected negative, which suits the name. Because it inverts, §4.1's rim-light
rule flips with it: the rim light becomes a `#101114` shadow on the *lower-right* edge, keeping the single
light source consistent across all nine collections.

**Hue coverage check.** red `#8E2C2C` · cyan `#3FB7C4` · orange `#BB6B3A` · slate `#9AA7B4` · violet
`#8E7BD6` · rose `#C77B92` · yellow `#E8B62F` · green `#6FA287` · silver — nine distinguishable fields,
none within `#C9A86A`'s neighbourhood (§2.3).

---

## 6. Component architecture

### 6.1 Deleted

- `components/users/UserAvatar.tsx` — its `initials` branch (line 50) is already dead code, because
  line 20 `user.avatar || '/avatars/default.png'` guarantees `avatarSrc` is never falsy. It also styles
  itself with `from-primary-600` / `to-secondary-600` / `hover:ring-primary-500`, none of which exist in
  the FRÈ `@theme` block.
- `components/users/AvatarSelector.tsx` — clickable `<div>`s with no keyboard access, no `aria-checked`,
  no "clear" option, and `border-primary-500` / `hover:border-primary-400` (also undefined tokens). Both
  files are already flagged for the phase-8 cleanup sweep.
- `utils/avatarHelper.ts` — `AVATAR_OPTIONS`, `DEFAULT_AVATAR_DATA_URI`, `preloadAvatars` and
  `handleAvatarError` all go. `getInitials` moves to `lib/avatars/`.
- `public/avatars/avatar1-8.svg` and `public/avatars/default.png`.

### 6.2 Added

**`lib/avatars/resolve.ts`** — `resolveAvatarSrc(value: string | null): string | null` per §3.2, plus
`getInitials` moved across unchanged.

**`components/users/Avatar.tsx`** — one render component.

```ts
type AvatarProps = {
  value: string | null
  name: string
  size: 'xs' | 'sm' | 'md' | 'lg' | 'xl'   // 32 / 36 / 48 / 96 / 150
  shape?: 'circle' | 'squircle'
  className?: string
}
```

The 128px `xl` of the old component is dropped and `xl` re-points at the 150px gate tile: `UserAvatar`'s
only consumer is `SettingsView.tsx:218` at `lg`, so 128 was never rendered. The gate keeps its
`clamp(110px,13vw,150px)` via `className`, with `xl` setting the ceiling.

When `resolveAvatarSrc` returns `null` it renders the Fraunces monogram — `font-display`, `text-muted`,
over `bg-surface-2` — which is what `ProfileGate.tsx:84,90` and `AvatarPicker.tsx:64` already do. The
imperative `onError` src-swapping in `avatarHelper.ts:36-47` is replaced by a single `onError` that flips
to the monogram, so there is no two-tier chain to loop on.

**`components/users/AvatarPicker.tsx`** — promoted from `components/auth/`, keeping its hidden-radio
construction (`role="radiogroup"` + `peer sr-only` inputs) so arrow-key navigation and screen-reader
semantics stay free from the platform. Adds:

- a collection tab strip above the grid
- a "No avatar" tile, first, that previews the typed initials — already present at line 28
- a "From your library" tab (§7)

Preloading is per-collection, on tab open. `preloadAvatars()` is removed from `UserContext.tsx:143`
entirely — today it fires `new Image()` for every option on **every app boot for every user**, whether or
not a picker is ever opened.

### 6.3 Selection surfaces

Three profile-creation entry points exist and only two offer an avatar. After this change all three do,
and Settings can clear:

| Surface | File | Change |
| --- | --- | --- |
| Invite accept | `app/invite/page.tsx:160` | re-point to new picker |
| First profile | `components/layout/AuthenticatedLayout.tsx:93` | re-point to new picker |
| Create profile modal | `components/shell/ProfileGate.tsx:115-136` | **add** the picker; delete the "You can choose an avatar later in Settings" copy at line 119 |
| Settings | `components/settings/SettingsView.tsx:204,234` | new picker; send `?? ''` instead of `?? undefined` so an avatar can actually be cleared |

---

## 7. Backend

### 7.1 Validation

Four sites in `backend/app/models.py` — `UserCreate:468`, `UserUpdate:472`, `UserResponse:514`,
`InviteAcceptRequest:641` — gain a shared validator:

```python
AVATAR_RE = r"^$|^house:[a-z0-9][a-z0-9-]{0,63}$|^cached:[a-f0-9]{8,64}$|^/avatars/avatar[1-8]\.svg$"
AvatarValue = Annotated[str, StringConstraints(max_length=128, pattern=AVATAR_RE)]
```

Applied to `UserCreate`, `UserUpdate` and `InviteAcceptRequest` as `Optional[AvatarValue]`.
**`UserResponse` keeps a plain `Optional[str]`** — a row holding something older or stranger than the
grammar must still serialise, or `GET /users` 500s for the whole household instead of one profile
falling back to its monogram.

This is the fix for: today any string at all persists, including `javascript:…`, a remote URL, or a
multi-megabyte `data:` URI, and it lands directly in `<img src>` at three call sites.

### 7.2 New router — `backend/app/api/avatars.py`

```
POST /api/v1/avatars/from-tmdb   body { path: "/abc123.jpg" }  →  { id: "cached:<hex>" }
GET  /api/v1/assets/avatars/{name}                             →  the cached bytes
```

`POST` validates `path` against `^/[A-Za-z0-9]{20,40}\.(jpg|png)$`, builds
`https://image.tmdb.org/t/p/w342{path}` **itself**, and hands that to `AssetManager`. The client never
supplies a URL, so there is no host to redirect.

`w342`, not the `w185` that `providers/tmdb.py:24` uses for cast portraits — the gate tile is 150px, which
needs ≥300px at 2× DPR.

Registered in `main.py` alongside the existing ten routers, behind the same session requirement as every
other `/api/v1` route.

### 7.3 `assets/manager.py` hardening

Required before first use (§2.9):

- add `backend/app/assets/__init__.py`
- `serve_asset()`: resolve the candidate path and assert it is inside `cache_path`; 404 otherwise
- `download_asset()`: `follow_redirects=False`, a byte cap (~2 MB), and a content-type allowlist of
  `image/jpeg` + `image/png`
- `settings.initialize()` creates the assets path

### 7.4 Compose

`docker-compose.yml` gains a volume for `/opt/freeflix/assets` in both the dev and prod service
definitions. Without it every cached avatar dies on `make build`.

### 7.5 Library titles

The "From your library" tab lists titles from the profile's watchlist and continue-watching — both already
exist server-side. Cast credits are already fetched for the detail page, so the picker reuses that shape
rather than adding a person-search endpoint.

---

## 8. Testing

Backend avatar coverage is currently **zero** — `grep -rni avatar backend/tests/` returns nothing.

**Breaks and must be updated:**

- `app/invite/page.test.tsx:61` — `getByRole('radio', { name: 'Avatar 2' })`; labels become piece names
- `app/invite/page.test.tsx:65` — asserts the literal `'/avatars/avatar2.svg'`
- `components/settings/SettingsView.test.tsx:52-67` — mocks `AvatarSelector`'s prop contract

**New:**

| Test | Covers |
| --- | --- |
| `lib/avatars/resolve.test.ts` | each row of the §3.2 table, including legacy coercion and that `javascript:` resolves to `null` |
| `components/users/Avatar.test.tsx` | monogram fallback on null, on unknown id, and on image error |
| `components/users/AvatarPicker.test.tsx` | tab switching, keyboard radio navigation, clear-to-none |
| `backend/tests/test_avatar_validation.py` | rejects `javascript:`, over-length and malformed ids; accepts `""`, `None` and both valid schemes |
| `backend/tests/test_avatar_assets.py` | path-traversal attempt on `GET /assets/avatars/{name}` 404s; `POST /from-tmdb` rejects a non-TMDB path |

Backend tests are **baked into the image, not bind-mounted** — new test files need `make build` or an
explicit mount (`CLAUDE.md`).

---

## 9. Out of scope

- Uploading a custom image. Nothing in this design accepts user-supplied bytes; tier 2 only ever fetches
  from `image.tmdb.org`.
- TMDB attribution in the UI. Currently absent app-wide and worth doing, but it is not this change.
- Rewriting existing `/avatars/avatarN.svg` rows in the database. The resolver handles them indefinitely.
- Per-profile accent theming driven by the chosen avatar. Tempting, given the avatar carries a registry
  accent, but it is a separate feature.
- The `/api/palette` rewrite in `next.config.ts:53-86`, which points at a route that does not exist. Noted
  here only so the next person doesn't assume it's load-bearing.
