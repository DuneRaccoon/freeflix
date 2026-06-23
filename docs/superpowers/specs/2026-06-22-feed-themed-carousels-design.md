# Feed-Themed Carousels — Design

- **Date:** 2026-06-22
- **Status:** Approved design, pending implementation plan
- **Surface:** `frontend/` (Next.js 15, React 19, Tailwind v4, TypeScript)

## Goal

Give content carousels a visual identity that matches the **specific data feed**
they represent — a Marvel Studios row should read as "Marvel", a Netflix row as
"Netflix", an X-Men row as "X-Men" — while still feeling like one cohesive
product under the existing **FRÈ — Editorial Noir** design language (dark-only,
gold accent, Fraunces + Inter Tight).

## Locked decisions

| Decision | Choice |
| --- | --- |
| **Intensity** | **Medium / signature** — accent recolour + brand-tinted gradient band behind the row + faint motif/wordmark watermark + per-feed title treatment. Not a full bespoke reskin. |
| **Coverage** | **Curated marquee, neutral rest** — hand-crafted themes for high-value brands/franchises; genres, decades, Trending, Top-Rated and everything unmapped keep today's gold look. |
| **Scope** | Standard content carousels only: `Row` and `RankedRow` on Home / Movies / Series. `ContinueWatchingRow`, `FeaturedRail`, and the search grid stay neutral. |
| **Brand assets** | **Evocative original treatments** — brand *colours*, type feel, and CSS/SVG motifs that *nod* to a brand. No copyrighted raster logos. A real logo SVG can be dropped into a theme later if ever wanted. |

## Existing system (verified)

- Carousels render from `RowConfig[]` in
  `frontend/src/components/browse/BrowseScreen.tsx`. Each row already carries a
  stable identity in `RailSpec.key` / `RowConfig.key`
  (`frontend/src/services/rails.ts`, `BrowseScreen.tsx`).
- The backend builds those keys in `backend/app/services/rails.py` from curated
  pools, e.g. `company-420` (Marvel), `collection-748` (X-Men), `provider-8`
  (Netflix), `genre-28`, `best-2024`, `trending`, `top-rated`, `taste-anime`,
  `rand-…`. **TMDB ids are stable**, so they are the safe lookup key (titles are
  not).
- `RailSpec.params: BrowseParams` carries the structured ids
  (`company` / `collection` / `provider` / `genres`) —
  `frontend/src/types/index.ts`.
- Rows are assembled by `frontend/src/lib/buildRailsScreen.ts`
  (`railsService.getRails()` → `RowConfig[]`, with a hardcoded `defaultRails()`
  fallback of genre/trending rows — all neutral).
- Design tokens live in `frontend/src/app/globals.css` `@theme` block
  (`--color-gold: #C9A86A`, `--color-gold-lite: #E7D6AE`, fonts, `--ease-card`).
  Class composition uses `cn()` (`frontend/src/lib/cn.ts`).
- Today's accent colour (gold) is **hardcoded** in `Row.tsx`, `RankedRow.tsx`,
  and `PosterCard.tsx` (eyebrow, title rule, nav arrows, "See all", rank
  numeral, `group-hover:border-gold/35`, hover shadow). These become the
  refactor surface.

## Architecture

The whole feature reduces to: **resolve a feed's identity → look up a theme
(pure data) → apply it through inherited CSS custom properties + two decorative
layers.** Unmapped rows resolve to `null` and render exactly as today, so the
feature is purely additive and zero-risk to neutral rows.

### 1. Identity resolution (structured, not string-parsed)

To avoid coupling theming to the `key` string format (the codebase already flags
this kind of coupling as fragile for `content_id`), we thread a **structured
feed descriptor** onto each row:

```ts
type FeedIdentity = { type: 'company' | 'collection' | 'provider'; id: string };
```

- `buildRailsScreen.ts` derives `feed` from `RailSpec.params` when assembling
  `RowConfig`:
  - `params.company` → `{ type: 'company', id: String(params.company) }`
  - else `params.collection` → `{ type: 'collection', id }`
  - else `params.provider` → `{ type: 'provider', id }`
  - else `undefined`
- **Fallback:** if a row has only a `key` and no params, parse it by **known
  prefix** (`company-`, `collection-`, `provider-`) — never a generic
  split-on-hyphen (keys like `top-rated` would mis-parse). Other prefixes →
  `undefined` (neutral).
- `RowConfig` gains an optional `feed?: FeedIdentity`. Genres/decades/trending
  leave it `undefined` by design.

Resolution stays at the **render layer** so `RowConfig` carries identity (data)
and never presentation:

```ts
const theme = row.feed ? resolveFeedTheme(row.feed) : null; // null ⇒ neutral
```

### 2. Theme = data

```ts
export type MotifKind =
  | 'none' | 'wordmark' | 'beams' | 'starfield' | 'arcs' | 'halftone';

export interface FeedTheme {
  id: string;            // 'marvel-studios' (registry key, for debugging/tests)
  match: FeedIdentity;   // { type:'company', id:'420' }
  accent: string;        // replaces gold for this row (hex)
  accentSoft: string;    // replaces gold-lite (hex)
  glow: string;          // card hover-glow tint (rgba)
  band: string;          // CSS background for the tinted strip (gradient string)
  title?: {
    font?: 'display' | 'ui';   // Fraunces vs Inter Tight; default unchanged
    className?: string;        // extra Tailwind for weight/tracking/case
  };
  motif?: { kind: MotifKind; opacity?: number; text?: string };
  eyebrowOverride?: string;    // optional, e.g. 'Cinematic Universe'
}
```

A theme is **only data**: colours, an optional title treatment, a motif *kind*
(not a bespoke component), and an optional eyebrow. Adding or tuning a brand is a
one-entry edit — no new components.

### 3. CSS-variable theming (the mechanism)

When a theme resolves, `BrowseScreen` sets four CSS custom properties on the
`Row` / `RankedRow` **section root** (inline style):

| Var | Default | Driven by |
| --- | --- | --- |
| `--rail-accent` | `var(--color-gold)` | `theme.accent` |
| `--rail-accent-soft` | `var(--color-gold-lite)` | `theme.accentSoft` |
| `--rail-glow` | `rgba(201,168,106,.22)` (current gold glow) | `theme.glow` |
| `--rail-band` | `transparent` (no band) | `theme.band` |

These defaults are declared once in `globals.css` so **every row** (themed or
not) reads the same variables. The hardcoded gold in `Row.tsx`,
`RankedRow.tsx`, and `PosterCard.tsx` is refactored to read
`var(--rail-accent, var(--color-gold))` etc. Because CSS custom properties
**inherit**, setting the vars once on the row root cascades to the header, nav
arrows, "See all", the rank numeral, and **every `PosterCard` inside the row** —
no prop-drilling into cards.

**Card refactor specifics** (`PosterCard.tsx`):
- `group-hover:border-gold/35` → border colour
  `color-mix(in srgb, var(--rail-accent) 35%, transparent)`.
- Add a subtle hover outer glow keyed to `var(--rail-glow)` (alongside the
  existing drop shadow).
- Genre chips (currently gold outline) → `var(--rail-accent)` outline (subtle
  identity reinforcement).
- **Unchanged:** the primary "Play" CTA gradient stays `from-white to-gold-lite`
  — it is the app-wide premium-action affordance and should not recolour per row.

Neutral rows set no inline vars → fall through to the gold defaults → pixel-identical to today.

### 4. Decorative layers: band + motif

Two `aria-hidden`, `pointer-events-none` layers render **behind** the row
content (header + track), only when a theme is present:

1. **Band** — an absolutely-positioned layer, `background: var(--rail-band)`,
   masked with vertical *and* horizontal fades (layered gradients / CSS `mask`)
   so it dissolves into `ink` and never creates hard seams between rows or fights
   the posters.
2. **Motif** — `<FeedMotif kind … color … opacity …/>` rendered above the band
   but still behind content, clipped to the band bounds.

A small `RailBackdrop` wrapper composes both and is dropped into `Row` /
`RankedRow` at `z-0` behind the existing content (which moves to `z-10`).

### 5. Motif vocabulary (reusable, parameterised)

Not one SVG per brand — a small vocabulary every theme draws from. Each renders
in CSS/inline-SVG, takes `{ color, opacity }`, is decorative/`aria-hidden`, and
is static or honours `prefers-reduced-motion`:

| Kind | Look | Built from |
| --- | --- | --- |
| `none` | band only | — |
| `wordmark` | giant faint brand token in the theme font, slight emboss | text + `text-shadow`, clipped |
| `beams` | 1–3 soft vertical light beams in accent | layered linear-gradients |
| `starfield` | scattered faint dots, optional perspective lines | inline SVG dots |
| `arcs` | concentric arcs/rings off to one side | inline SVG / radial-gradient |
| `halftone` | repeating dot field, optionally diagonally masked | repeating-radial-gradient + mask |

### 6. Initial marquee registry (~18, extensible)

All entries are data; ids are verified against `backend/app/services/rails.py`
pools.

**Companies** (`company-…`)
- `420` Marvel Studios — deep red `#E62429`→ink band; heavy condensed uppercase title; `wordmark`; red glow.
- `3` Pixar — bright blue `#2B9CD8` + warm; friendly title; `arcs`; soft blue glow.
- `2` Walt Disney — royal blue `#1B3A8C` + silver; elegant; `arcs`; cool glow.
- `10342` Studio Ghibli — moss `#6FA287`/cream; serif (`display`) title; `arcs` (soft); gentle glow.
- `41077` A24 — near-monochrome stone on near-black; minimalist grotesque; centered minimal `wordmark`; faint glow.
- `174` Warner Bros — golden-tan/navy; classic serif-ish; `arcs`; warm glow.
- `3172` Blumhouse — blood crimson/black; horror; `halftone`; red glow.
- `923` Legendary — bronze/amber; epic; `beams`; amber glow.

**Providers** (`provider-…`)
- `8` Netflix — black band + single red `#E50914` vertical beam; clean grotesque; `beams`; red glow.
- `337` Disney+ — deep navy→cyan; `starfield`; cyan glow.
- `1899` HBO Max / Max — violet→blue; bold; `beams`; violet glow.
- `9` Prime Video — Amazon blue `#00A8E1`/navy; `arcs`; blue glow.
- `350` Apple TV+ — graphite/silver monochrome; ultra-clean; `none`/minimal; cool glow.

**Collections** (`collection-…`)
- `748` X-Men — steel blue `#2E4D8E` + gold; sharp title; `halftone` (diagonal); blue glow.
- `86311` The Avengers — heroic red/blue/gold; `arcs`; mixed glow.
- `10` Star Wars — black + gold `#FFE81F`; `starfield` + perspective lines; gold glow.
- `1241` Harry Potter — parchment + burgundy/gold; serif title; `arcs` (faint); warm glow.
- `645` James Bond 007 — black + gunmetal + gold; sleek; `beams`; gold glow.

(Easy follow-ons as data when wanted: `119` LOTR, `328` Jurassic Park, `404609`
John Wick, `263` Dark Knight, `2344` Matrix, `87096` Avatar, `33` Universal,
`521` DreamWorks.)

## Files

**New**
- `frontend/src/lib/feedThemes/types.ts` — `FeedIdentity`, `FeedTheme`, `MotifKind`.
- `frontend/src/lib/feedThemes/registry.ts` — the curated theme array.
- `frontend/src/lib/feedThemes/resolveFeedTheme.ts` — `(FeedIdentity) → FeedTheme | null`.
- `frontend/src/lib/feedThemes/index.ts` — barrel.
- `frontend/src/components/browse/FeedMotif.tsx` — motif renderer.
- `frontend/src/components/browse/RailBackdrop.tsx` — band + motif composition.

**Changed**
- `frontend/src/lib/buildRailsScreen.ts` — derive `feed` onto `RowConfig`.
- `frontend/src/components/browse/BrowseScreen.tsx` — `RowConfig.feed`; resolve theme; set CSS vars; pass theme + render backdrop slot.
- `frontend/src/components/browse/Row.tsx` — accept `theme`, set vars, render `RailBackdrop`, var-ify gold, apply title treatment.
- `frontend/src/components/browse/RankedRow.tsx` — same treatment (numeral stroke var-ified).
- `frontend/src/components/browse/PosterCard.tsx` — var-ify hover border/glow + genre chip outline.
- `frontend/src/app/globals.css` — default rail vars + any motif keyframes + reduced-motion guards.

## Accessibility, performance, reduced motion

- Band + motif are `aria-hidden` and `pointer-events-none`; purely decorative.
- Bands are constrained dark/tinted so title + eyebrow keep **AA contrast**; the
  text colours themselves stay on `--color-text` / `--rail-accent`, not on the
  band.
- Pure CSS + inline SVG — **no images, no network, no layout shift** (backdrop is
  absolutely positioned behind existing content).
- Any motif animation is slow and gated by `@media (prefers-reduced-motion: reduce)`.

## Edge cases

- **Unmapped feed** → `null` → today's gold look (the common case).
- **Row with params but unknown id** → `resolveFeedTheme` returns `null`.
- **`defaultRails()` fallback rows** → no `feed` → neutral (all are genre/trending anyway).
- **Future key-format change** → structured `params` path is unaffected; only the
  prefix-parse fallback would need a tweak (single, isolated function).
- **A row matching multiple params** (shouldn't happen) → resolution order is
  company → collection → provider, first match wins.

## Testing

- `npx tsc --noEmit` must pass (primary automated gate; frontend has no working
  ESLint/test runner per `CLAUDE.md`).
- `resolveFeedTheme` is a pure function — add a lightweight unit test **if** a JS
  test runner is present in `frontend/`; otherwise its behaviour is exercised
  visually.
- Manual visual verification against the running app (frontend at
  `http://localhost:3001`): confirm (a) a themed row (Marvel/Netflix/X-Men) shows
  band + motif + recoloured accents + card hover glow; (b) a neutral row
  (Trending/Action) is pixel-identical to before; (c) reduced-motion disables
  motif animation.

## Out of scope (possible future)

- Dynamic palette extraction (`/api/palette` + `@vibrant`) as a fallback for
  unmapped rows (explicitly deferred by the "curated marquee, neutral rest"
  choice).
- Real trademarked logo SVGs.
- Theming `ContinueWatchingRow` / `FeaturedRail`.
