# Feed-Themed Carousels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give marquee content carousels (Marvel, Netflix, X-Men, …) a per-feed visual identity — accent recolour, a tinted band, a motif watermark, and a title treatment — while every unmapped row stays pixel-identical to today.

**Architecture:** Each row already carries a stable feed identity (`company`/`collection`/`provider` + TMDB id, derived from `RailSpec.params`). We map that identity → a *theme that is pure data* (colours, title treatment, motif kind). `Row`/`RankedRow` set CSS custom properties (`--rail-accent`, `--rail-accent-soft`, `--rail-card-glow`) on their `<section>`; because CSS variables **inherit**, the header, arrows and every `PosterCard` inside recolour automatically. Two `aria-hidden` layers (a tinted band + a reusable motif) render behind the row. No theme ⇒ no inline vars ⇒ the gold defaults declared in `globals.css` apply, unchanged.

**Tech Stack:** Next.js 15 / React 19 / TypeScript, Tailwind v4 (`@theme` tokens, no config file), `cn()` (clsx + tailwind-merge), Vitest + Testing Library (jsdom).

## Global Constraints

- **Tailwind v4, no config file.** Design tokens live in `frontend/src/app/globals.css` `@theme`. Gold defaults are `--color-gold: #C9A86A`, `--color-gold-lite: #E7D6AE`.
- **Neutral rows MUST stay visually identical.** Every change is additive — defaults reproduce today's gold look exactly. Achieve this by *replacing* gold literals with `var(--rail-*, gold-default)` (never adding a second conflicting class), and by keeping new glow defaults `transparent`.
- **Scope:** only `Row` and `RankedRow`. Do **not** touch `ContinueWatchingRow`, `FeaturedRail`, or the search grid.
- **Identity by stable TMDB id, never title string.**
- **Evocative original motifs only** — colours, type feel, CSS/SVG motifs. **No copyrighted raster logos.**
- **Class composition** uses `cn()` from `@/lib/cn`. Note: tailwind-merge in this repo does **not** de-conflict custom `@theme` font tokens (`font-display`/`font-ui`) — so never rely on merge to pick between them; emit exactly one font-family class.
- **Tests** are colocated `*.test.ts(x)`, run with `npx vitest run <path>`. Path alias `@` → `frontend/src`. All component tests run under jsdom.
- **Typecheck gate:** `npx tsc --noEmit` must pass. All commands below run from `frontend/`.

---

### Task 1: Feed theme core — types, registry, resolver

**Files:**
- Create: `frontend/src/lib/feedThemes/types.ts`
- Create: `frontend/src/lib/feedThemes/registry.ts`
- Create: `frontend/src/lib/feedThemes/resolveFeedTheme.ts`
- Test: `frontend/src/lib/feedThemes/resolveFeedTheme.test.ts`

**Interfaces:**
- Produces:
  - `interface FeedIdentity { type: 'company' | 'collection' | 'provider'; id: string }`
  - `type MotifKind = 'none' | 'wordmark' | 'beams' | 'starfield' | 'arcs' | 'halftone'`
  - `interface MotifConfig { kind: MotifKind; opacity?: number; text?: string }`
  - `interface FeedTitleStyle { font?: 'display' | 'ui'; className?: string }`
  - `interface FeedTheme { id: string; accent: string; accentSoft: string; glow: string; band: string; title?: FeedTitleStyle; motif?: MotifConfig; eyebrowOverride?: string }`
  - `const FEED_THEMES: Record<string, FeedTheme>` (keyed `"company:420"` etc.)
  - `function feedIdentityFromParams(params: BrowseParams | undefined): FeedIdentity | undefined`
  - `function feedIdentityFromKey(key: string | undefined): FeedIdentity | undefined`
  - `function resolveFeedTheme(identity: FeedIdentity | undefined): FeedTheme | null`

- [ ] **Step 1: Write `types.ts`**

```ts
// frontend/src/lib/feedThemes/types.ts
//
// Data model for per-feed carousel theming. A FeedTheme is PURE DATA — colours,
// an optional title treatment, and a motif KIND (not a component). Adding a
// brand is a one-entry edit in registry.ts.

export interface FeedIdentity {
  type: 'company' | 'collection' | 'provider';
  id: string; // stable TMDB id as a string, e.g. '420'
}

export type MotifKind =
  | 'none'
  | 'wordmark'
  | 'beams'
  | 'starfield'
  | 'arcs'
  | 'halftone';

export interface MotifConfig {
  kind: MotifKind;
  /** 0..1, defaults to 0.07 in the renderer. Keep faint. */
  opacity?: number;
  /** Text for the `wordmark` motif, e.g. 'MARVEL'. Ignored by other kinds. */
  text?: string;
}

export interface FeedTitleStyle {
  /** Font family for the row title. Defaults to 'display' (Fraunces). */
  font?: 'display' | 'ui';
  /** Extra Tailwind classes (weight / tracking / transform). */
  className?: string;
}

export interface FeedTheme {
  /** Human slug for debugging/tests, e.g. 'marvel-studios'. */
  id: string;
  /** Replaces gold for this row (drives --rail-accent). */
  accent: string;
  /** Replaces gold-lite for this row (drives --rail-accent-soft). */
  accentSoft: string;
  /** Card hover glow colour (drives --rail-card-glow). */
  glow: string;
  /** CSS `background` value for the tinted band; author it to fade at left/right. */
  band: string;
  title?: FeedTitleStyle;
  motif?: MotifConfig;
  /** Optional eyebrow override (takes precedence over RowConfig.eyebrow). */
  eyebrowOverride?: string;
}
```

- [ ] **Step 2: Write `registry.ts`** (the curated marquee themes)

```ts
// frontend/src/lib/feedThemes/registry.ts
//
// Curated marquee themes, keyed "<type>:<tmdbId>". Ids verified against
// backend/app/services/rails.py pools. Anything not listed here resolves to
// null and renders with the default gold look. Band gradients are authored to
// fade to transparent at the left/right edges so the strip stays contained;
// keep tint alpha <= ~0.16 so posters and text remain legible.

import { FeedTheme } from './types';

export const FEED_THEMES: Record<string, FeedTheme> = {
  // ── Studios / companies ──────────────────────────────────────────────
  'company:420': {
    id: 'marvel-studios',
    accent: '#E62429',
    accentSoft: '#FF6A6E',
    glow: 'rgba(230,36,41,0.30)',
    band: 'linear-gradient(90deg, rgba(230,36,41,0) 0%, rgba(230,36,41,0.16) 24%, rgba(120,12,15,0.10) 62%, rgba(10,10,11,0) 100%)',
    title: { font: 'ui', className: 'uppercase font-extrabold tracking-tight' },
    motif: { kind: 'wordmark', text: 'MARVEL', opacity: 0.05 },
    eyebrowOverride: 'Cinematic Universe',
  },
  'company:3': {
    id: 'pixar',
    accent: '#2B9CD8',
    accentSoft: '#7FD0F2',
    glow: 'rgba(43,156,216,0.28)',
    band: 'linear-gradient(90deg, rgba(43,156,216,0) 0%, rgba(43,156,216,0.14) 26%, rgba(20,80,120,0.08) 64%, rgba(10,10,11,0) 100%)',
    title: { font: 'ui', className: 'font-semibold tracking-tight' },
    motif: { kind: 'arcs', opacity: 0.07 },
    eyebrowOverride: 'Pixar Animation',
  },
  'company:2': {
    id: 'walt-disney',
    accent: '#4B7BD6',
    accentSoft: '#A9C6F2',
    glow: 'rgba(75,123,214,0.26)',
    band: 'linear-gradient(90deg, rgba(75,123,214,0) 0%, rgba(75,123,214,0.14) 26%, rgba(20,40,90,0.08) 64%, rgba(10,10,11,0) 100%)',
    title: { font: 'display', className: 'tracking-tight' },
    motif: { kind: 'arcs', opacity: 0.06 },
    eyebrowOverride: 'Walt Disney',
  },
  'company:10342': {
    id: 'studio-ghibli',
    accent: '#6FA287',
    accentSoft: '#BBD8C6',
    glow: 'rgba(111,162,135,0.26)',
    band: 'linear-gradient(90deg, rgba(111,162,135,0) 0%, rgba(111,162,135,0.14) 26%, rgba(70,110,90,0.08) 64%, rgba(10,10,11,0) 100%)',
    title: { font: 'display', className: 'italic tracking-tight' },
    motif: { kind: 'arcs', opacity: 0.06 },
    eyebrowOverride: 'Studio Ghibli',
  },
  'company:41077': {
    id: 'a24',
    accent: '#E7E2D6',
    accentSoft: '#FFFFFF',
    glow: 'rgba(231,226,214,0.14)',
    band: 'linear-gradient(90deg, rgba(231,226,214,0) 0%, rgba(231,226,214,0.08) 30%, rgba(231,226,214,0.05) 60%, rgba(10,10,11,0) 100%)',
    title: { font: 'ui', className: 'font-semibold tracking-[0.2em]' },
    motif: { kind: 'wordmark', text: 'A24', opacity: 0.05 },
    eyebrowOverride: 'A24',
  },
  'company:174': {
    id: 'warner-bros',
    accent: '#C9A227',
    accentSoft: '#E9D27A',
    glow: 'rgba(201,162,39,0.24)',
    band: 'linear-gradient(90deg, rgba(201,162,39,0) 0%, rgba(201,162,39,0.12) 26%, rgba(20,30,70,0.10) 64%, rgba(10,10,11,0) 100%)',
    title: { font: 'display', className: 'tracking-tight' },
    motif: { kind: 'arcs', opacity: 0.06 },
    eyebrowOverride: 'Warner Bros.',
  },
  'company:3172': {
    id: 'blumhouse',
    accent: '#B11515',
    accentSoft: '#E5564B',
    glow: 'rgba(177,21,21,0.30)',
    band: 'linear-gradient(90deg, rgba(177,21,21,0) 0%, rgba(177,21,21,0.14) 26%, rgba(20,4,4,0.10) 64%, rgba(10,10,11,0) 100%)',
    title: { font: 'ui', className: 'uppercase font-bold tracking-[0.05em]' },
    motif: { kind: 'halftone', opacity: 0.08 },
    eyebrowOverride: 'Blumhouse',
  },
  'company:923': {
    id: 'legendary',
    accent: '#C2873B',
    accentSoft: '#E6B873',
    glow: 'rgba(194,135,59,0.26)',
    band: 'linear-gradient(90deg, rgba(194,135,59,0) 0%, rgba(194,135,59,0.12) 26%, rgba(60,40,20,0.10) 64%, rgba(10,10,11,0) 100%)',
    title: { font: 'display', className: 'tracking-tight' },
    motif: { kind: 'beams', opacity: 0.06 },
    eyebrowOverride: 'Legendary',
  },

  // ── Streaming providers / networks ───────────────────────────────────
  'provider:8': {
    id: 'netflix',
    accent: '#E50914',
    accentSoft: '#FF5A60',
    glow: 'rgba(229,9,20,0.30)',
    band: 'linear-gradient(90deg, rgba(20,4,5,0) 0%, rgba(40,6,8,0.5) 50%, rgba(20,4,5,0) 100%)',
    title: { font: 'ui', className: 'uppercase font-extrabold tracking-tight' },
    motif: { kind: 'beams', opacity: 0.08 },
    eyebrowOverride: 'Netflix',
  },
  'provider:337': {
    id: 'disney-plus',
    accent: '#2AA9E0',
    accentSoft: '#8FD6F2',
    glow: 'rgba(42,169,224,0.26)',
    band: 'linear-gradient(90deg, rgba(8,16,46,0) 0%, rgba(12,30,80,0.42) 50%, rgba(8,16,46,0) 100%)',
    title: { font: 'display', className: 'tracking-tight' },
    motif: { kind: 'starfield', opacity: 0.08 },
    eyebrowOverride: 'Disney+',
  },
  'provider:1899': {
    id: 'max',
    accent: '#7B2FF7',
    accentSoft: '#B388FF',
    glow: 'rgba(123,47,247,0.26)',
    band: 'linear-gradient(90deg, rgba(123,47,247,0) 0%, rgba(80,30,160,0.16) 26%, rgba(40,20,90,0.10) 64%, rgba(10,10,11,0) 100%)',
    title: { font: 'ui', className: 'font-bold tracking-tight' },
    motif: { kind: 'beams', opacity: 0.07 },
    eyebrowOverride: 'Max',
  },
  'provider:9': {
    id: 'prime-video',
    accent: '#00A8E1',
    accentSoft: '#6FD6F5',
    glow: 'rgba(0,168,225,0.26)',
    band: 'linear-gradient(90deg, rgba(0,168,225,0) 0%, rgba(0,168,225,0.12) 26%, rgba(10,40,70,0.10) 64%, rgba(10,10,11,0) 100%)',
    title: { font: 'ui', className: 'font-semibold tracking-tight' },
    motif: { kind: 'arcs', opacity: 0.06 },
    eyebrowOverride: 'Prime Video',
  },
  'provider:350': {
    id: 'apple-tv-plus',
    accent: '#D7D7DB',
    accentSoft: '#FFFFFF',
    glow: 'rgba(215,215,219,0.14)',
    band: 'linear-gradient(90deg, rgba(215,215,219,0) 0%, rgba(215,215,219,0.07) 30%, rgba(215,215,219,0.05) 60%, rgba(10,10,11,0) 100%)',
    title: { font: 'ui', className: 'font-semibold tracking-tight' },
    motif: { kind: 'none' },
    eyebrowOverride: 'Apple TV+',
  },

  // ── Franchises / collections ─────────────────────────────────────────
  'collection:748': {
    id: 'x-men',
    accent: '#3B6BD6',
    accentSoft: '#F2C84B',
    glow: 'rgba(59,107,214,0.28)',
    band: 'linear-gradient(90deg, rgba(59,107,214,0) 0%, rgba(59,107,214,0.15) 26%, rgba(20,30,70,0.10) 64%, rgba(10,10,11,0) 100%)',
    title: { font: 'ui', className: 'uppercase font-extrabold tracking-tight' },
    motif: { kind: 'halftone', opacity: 0.08 },
    eyebrowOverride: 'X-Men',
  },
  'collection:86311': {
    id: 'the-avengers',
    accent: '#3A6AD0',
    accentSoft: '#E8C24B',
    glow: 'rgba(58,106,208,0.28)',
    band: 'linear-gradient(90deg, rgba(58,106,208,0) 0%, rgba(58,106,208,0.15) 26%, rgba(70,20,24,0.08) 64%, rgba(10,10,11,0) 100%)',
    title: { font: 'ui', className: 'uppercase font-extrabold tracking-tight' },
    motif: { kind: 'arcs', opacity: 0.07 },
    eyebrowOverride: 'Avengers Assemble',
  },
  'collection:10': {
    id: 'star-wars',
    accent: '#FFE81F',
    accentSoft: '#FFF59A',
    glow: 'rgba(255,232,31,0.20)',
    band: 'linear-gradient(90deg, rgba(12,12,8,0) 0%, rgba(30,28,10,0.45) 50%, rgba(12,12,8,0) 100%)',
    title: { font: 'ui', className: 'uppercase font-extrabold tracking-[0.04em]' },
    motif: { kind: 'starfield', opacity: 0.1 },
    eyebrowOverride: 'A Galaxy Far, Far Away',
  },
  'collection:1241': {
    id: 'harry-potter',
    accent: '#B89253',
    accentSoft: '#E5C77A',
    glow: 'rgba(184,146,83,0.24)',
    band: 'linear-gradient(90deg, rgba(184,146,83,0) 0%, rgba(184,146,83,0.12) 26%, rgba(60,20,24,0.10) 64%, rgba(10,10,11,0) 100%)',
    title: { font: 'display', className: 'italic tracking-tight' },
    motif: { kind: 'arcs', opacity: 0.05 },
    eyebrowOverride: 'The Wizarding World',
  },
  'collection:645': {
    id: 'james-bond',
    accent: '#C9A227',
    accentSoft: '#E9D27A',
    glow: 'rgba(201,162,39,0.24)',
    band: 'linear-gradient(90deg, rgba(201,162,39,0) 0%, rgba(201,162,39,0.10) 26%, rgba(18,18,20,0.55) 60%, rgba(10,10,11,0) 100%)',
    title: { font: 'display', className: 'tracking-[0.04em]' },
    motif: { kind: 'beams', opacity: 0.06 },
    eyebrowOverride: '007',
  },
};
```

- [ ] **Step 3: Write `resolveFeedTheme.ts`**

```ts
// frontend/src/lib/feedThemes/resolveFeedTheme.ts
import { BrowseParams } from '@/types';
import { FeedIdentity, FeedTheme } from './types';
import { FEED_THEMES } from './registry';

/** Treat 0 / '0' / undefined / null as "not set". */
function present(v: number | string | undefined | null): v is number | string {
  return v != null && v !== 0 && v !== '0';
}

/**
 * Preferred path: derive a feed identity from the structured browse params.
 * Order is company → collection → provider; first match wins.
 */
export function feedIdentityFromParams(
  params: BrowseParams | undefined,
): FeedIdentity | undefined {
  if (!params) return undefined;
  if (present(params.company)) return { type: 'company', id: String(params.company) };
  if (present(params.collection)) return { type: 'collection', id: String(params.collection) };
  if (present(params.provider)) return { type: 'provider', id: String(params.provider) };
  return undefined;
}

const KEY_PREFIX: Record<string, FeedIdentity['type']> = {
  company: 'company',
  collection: 'collection',
  provider: 'provider',
};

/**
 * Fallback path: parse a rail key like "company-420" by KNOWN prefix only.
 * Keys such as "top-rated" / "genre-28" / "trending" → undefined (neutral).
 */
export function feedIdentityFromKey(key: string | undefined): FeedIdentity | undefined {
  if (!key) return undefined;
  const dash = key.indexOf('-');
  if (dash <= 0) return undefined;
  const type = KEY_PREFIX[key.slice(0, dash)];
  const id = key.slice(dash + 1);
  if (!type || !id) return undefined;
  return { type, id };
}

/** Identity → curated theme, or null when unmapped (neutral). */
export function resolveFeedTheme(identity: FeedIdentity | undefined): FeedTheme | null {
  if (!identity) return null;
  return FEED_THEMES[`${identity.type}:${identity.id}`] ?? null;
}
```

- [ ] **Step 4: Write the failing test**

```ts
// frontend/src/lib/feedThemes/resolveFeedTheme.test.ts
import { describe, it, expect } from 'vitest';
import {
  feedIdentityFromParams,
  feedIdentityFromKey,
  resolveFeedTheme,
} from './resolveFeedTheme';

describe('feedIdentityFromParams', () => {
  it('reads company / collection / provider ids as strings', () => {
    expect(feedIdentityFromParams({ company: 420 })).toEqual({ type: 'company', id: '420' });
    expect(feedIdentityFromParams({ collection: '748' })).toEqual({ type: 'collection', id: '748' });
    expect(feedIdentityFromParams({ provider: 8 })).toEqual({ type: 'provider', id: '8' });
  });

  it('prefers company over collection over provider', () => {
    expect(feedIdentityFromParams({ company: 420, collection: 748, provider: 8 }))
      .toEqual({ type: 'company', id: '420' });
  });

  it('treats 0 / "0" / missing as unset', () => {
    expect(feedIdentityFromParams({ company: 0, genres: '28' })).toBeUndefined();
    expect(feedIdentityFromParams({ provider: '0' })).toBeUndefined();
    expect(feedIdentityFromParams({ api: 'popular' })).toBeUndefined();
    expect(feedIdentityFromParams(undefined)).toBeUndefined();
  });
});

describe('feedIdentityFromKey', () => {
  it('parses known prefixes only', () => {
    expect(feedIdentityFromKey('company-420')).toEqual({ type: 'company', id: '420' });
    expect(feedIdentityFromKey('collection-748')).toEqual({ type: 'collection', id: '748' });
    expect(feedIdentityFromKey('provider-8')).toEqual({ type: 'provider', id: '8' });
  });

  it('ignores non-feed keys (no mis-parse of hyphenated words)', () => {
    expect(feedIdentityFromKey('top-rated')).toBeUndefined();
    expect(feedIdentityFromKey('genre-28')).toBeUndefined();
    expect(feedIdentityFromKey('trending')).toBeUndefined();
    expect(feedIdentityFromKey(undefined)).toBeUndefined();
  });
});

describe('resolveFeedTheme', () => {
  it('resolves curated marquee feeds to their theme', () => {
    expect(resolveFeedTheme({ type: 'company', id: '420' })?.id).toBe('marvel-studios');
    expect(resolveFeedTheme({ type: 'provider', id: '8' })?.id).toBe('netflix');
    expect(resolveFeedTheme({ type: 'collection', id: '748' })?.id).toBe('x-men');
  });

  it('returns null for unmapped ids and undefined identity', () => {
    expect(resolveFeedTheme({ type: 'company', id: '99999' })).toBeNull();
    expect(resolveFeedTheme(undefined)).toBeNull();
  });
});
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/lib/feedThemes/resolveFeedTheme.test.ts`
Expected: PASS (3 describe blocks green).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/feedThemes/types.ts frontend/src/lib/feedThemes/registry.ts frontend/src/lib/feedThemes/resolveFeedTheme.ts frontend/src/lib/feedThemes/resolveFeedTheme.test.ts
git commit -m "feat(carousels): feed theme types, registry, and identity resolver"
```

---

### Task 2: CSS-variable layer — `railStyleVars` helper, barrel, global defaults

**Files:**
- Create: `frontend/src/lib/feedThemes/railStyleVars.ts`
- Create: `frontend/src/lib/feedThemes/index.ts`
- Modify: `frontend/src/app/globals.css` (add default rail vars after the existing `:root { color-scheme: dark; }` block, near line 33)
- Test: `frontend/src/lib/feedThemes/railStyleVars.test.ts`

**Interfaces:**
- Consumes: `FeedTheme` (Task 1).
- Produces: `function railStyleVars(theme: FeedTheme | null): React.CSSProperties | undefined`; barrel `@/lib/feedThemes` re-exporting all of Task 1 + `railStyleVars`.

- [ ] **Step 1: Write `railStyleVars.ts`**

```ts
// frontend/src/lib/feedThemes/railStyleVars.ts
import type { CSSProperties } from 'react';
import { FeedTheme } from './types';

/**
 * Inline CSS custom properties for a themed Row/RankedRow <section>. These
 * cascade to the header, arrows, numeral stroke, and every PosterCard inside.
 * Returns undefined for neutral rows so they fall through to the gold defaults
 * declared in globals.css.
 */
export function railStyleVars(theme: FeedTheme | null): CSSProperties | undefined {
  if (!theme) return undefined;
  return {
    '--rail-accent': theme.accent,
    '--rail-accent-soft': theme.accentSoft,
    '--rail-card-glow': theme.glow,
  } as CSSProperties;
}
```

- [ ] **Step 2: Write the barrel `index.ts`**

```ts
// frontend/src/lib/feedThemes/index.ts
export * from './types';
export { FEED_THEMES } from './registry';
export {
  feedIdentityFromParams,
  feedIdentityFromKey,
  resolveFeedTheme,
} from './resolveFeedTheme';
export { railStyleVars } from './railStyleVars';
```

- [ ] **Step 3: Add default rail variables to `globals.css`**

Insert this block immediately after the `:root { color-scheme: dark; }` line (currently line 33), before the `body { … }` rule:

```css
/* Per-feed rail theming hooks. Default to the gold accent so any row that does
   not resolve a feed theme is visually unchanged. A themed Row sets the first
   three inline (see railStyleVars) and they cascade to the header, arrows,
   numeral stroke, and every PosterCard inside the row. --rail-card-glow stays
   transparent by default so neutral cards gain NO extra glow. */
:root {
  --rail-accent: var(--color-gold);
  --rail-accent-soft: var(--color-gold-lite);
  --rail-card-glow: transparent;
}
```

- [ ] **Step 4: Write the failing test**

```ts
// frontend/src/lib/feedThemes/railStyleVars.test.ts
import { describe, it, expect } from 'vitest';
import { railStyleVars } from './railStyleVars';
import { FEED_THEMES } from './registry';

describe('railStyleVars', () => {
  it('returns undefined for a neutral (null) theme', () => {
    expect(railStyleVars(null)).toBeUndefined();
  });

  it('maps a theme to the three inheriting CSS custom properties', () => {
    const marvel = FEED_THEMES['company:420'];
    const vars = railStyleVars(marvel) as Record<string, string>;
    expect(vars['--rail-accent']).toBe(marvel.accent);
    expect(vars['--rail-accent-soft']).toBe(marvel.accentSoft);
    expect(vars['--rail-card-glow']).toBe(marvel.glow);
  });
});
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/lib/feedThemes/railStyleVars.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck and commit**

```bash
npx tsc --noEmit
git add frontend/src/lib/feedThemes/railStyleVars.ts frontend/src/lib/feedThemes/index.ts frontend/src/lib/feedThemes/railStyleVars.test.ts frontend/src/app/globals.css
git commit -m "feat(carousels): rail CSS-variable helper and gold-default vars"
```

---

### Task 3: `FeedMotif` component

**Files:**
- Create: `frontend/src/components/browse/FeedMotif.tsx`
- Test: `frontend/src/components/browse/FeedMotif.test.tsx`

**Interfaces:**
- Consumes: `MotifConfig` (from `@/lib/feedThemes`).
- Produces: `default` React component `FeedMotif` with props `{ motif?: MotifConfig; color: string }`. Renders `null` for `undefined`/`'none'`; otherwise a decorative `aria-hidden` layer.

- [ ] **Step 1: Write `FeedMotif.tsx`**

```tsx
// frontend/src/components/browse/FeedMotif.tsx
import React from 'react';
import { MotifConfig } from '@/lib/feedThemes';

/**
 * Decorative, reusable motif vocabulary for themed rows. All variants are
 * aria-hidden, pointer-events-none, and faint. The renderer is generic — a
 * theme only chooses a `kind` + colour + opacity.
 *
 * Star coordinates are a FIXED list (viewBox 100x40) so server and client
 * render identically (no Math.random, which is also unavailable here).
 */
const STARS: ReadonlyArray<readonly [number, number, number]> = [
  [6, 8, 0.5], [14, 22, 0.35], [21, 12, 0.45], [29, 31, 0.3], [37, 6, 0.4],
  [44, 19, 0.55], [52, 9, 0.3], [58, 27, 0.45], [64, 14, 0.35], [71, 33, 0.5],
  [77, 7, 0.4], [83, 21, 0.3], [88, 12, 0.5], [92, 29, 0.35], [9, 34, 0.4],
  [34, 24, 0.3], [49, 35, 0.45], [67, 4, 0.3], [80, 37, 0.4], [95, 17, 0.35],
];

export interface FeedMotifProps {
  motif?: MotifConfig;
  /** Drawing colour — the theme accent. */
  color: string;
}

const FeedMotif: React.FC<FeedMotifProps> = ({ motif, color }) => {
  if (!motif || motif.kind === 'none') return null;
  const opacity = motif.opacity ?? 0.07;

  switch (motif.kind) {
    case 'wordmark':
      return (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute right-[1%] top-1/2 -translate-y-1/2 select-none whitespace-nowrap font-display font-black uppercase leading-none"
          style={{ color, opacity, fontSize: 'clamp(120px, 17vw, 260px)', letterSpacing: '-0.04em' }}
        >
          {motif.text ?? ''}
        </span>
      );

    case 'beams':
      return (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{
            opacity,
            background: `radial-gradient(60% 120% at 22% 50%, ${color}, transparent 60%), radial-gradient(50% 120% at 74% 50%, ${color}, transparent 62%)`,
          }}
        />
      );

    case 'starfield':
      return (
        <svg
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 h-full w-full"
          viewBox="0 0 100 40"
          preserveAspectRatio="xMidYMid slice"
          style={{ opacity }}
        >
          {STARS.map(([cx, cy, r], i) => (
            <circle key={i} cx={cx} cy={cy} r={r} fill={color} />
          ))}
        </svg>
      );

    case 'arcs':
      return (
        <svg
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 h-full w-full"
          viewBox="0 0 100 40"
          preserveAspectRatio="xMidYMid slice"
          style={{ opacity }}
        >
          <g fill="none" stroke={color} strokeWidth={0.4}>
            <circle cx={90} cy={20} r={10} />
            <circle cx={90} cy={20} r={18} />
            <circle cx={90} cy={20} r={26} />
            <circle cx={90} cy={20} r={34} />
          </g>
        </svg>
      );

    case 'halftone':
      return (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{
            opacity,
            backgroundImage: `radial-gradient(${color} 1px, transparent 1.4px)`,
            backgroundSize: '13px 13px',
            WebkitMaskImage: 'linear-gradient(115deg, #000 0%, transparent 58%)',
            maskImage: 'linear-gradient(115deg, #000 0%, transparent 58%)',
          }}
        />
      );

    default:
      return null;
  }
};

export default FeedMotif;
```

- [ ] **Step 2: Write the failing test**

```tsx
// frontend/src/components/browse/FeedMotif.test.tsx
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import FeedMotif from './FeedMotif';

describe('FeedMotif', () => {
  it('renders nothing for undefined or "none"', () => {
    const a = render(<FeedMotif color="#fff" />);
    expect(a.container.firstChild).toBeNull();
    const b = render(<FeedMotif motif={{ kind: 'none' }} color="#fff" />);
    expect(b.container.firstChild).toBeNull();
  });

  it('renders the wordmark text', () => {
    const { container } = render(
      <FeedMotif motif={{ kind: 'wordmark', text: 'MARVEL' }} color="#E62429" />,
    );
    expect(container.textContent).toContain('MARVEL');
    expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull();
  });

  it('renders an svg for starfield and arcs', () => {
    const stars = render(<FeedMotif motif={{ kind: 'starfield' }} color="#fff" />);
    expect(stars.container.querySelector('svg')).not.toBeNull();
    const arcs = render(<FeedMotif motif={{ kind: 'arcs' }} color="#fff" />);
    expect(arcs.container.querySelector('svg')).not.toBeNull();
  });

  it('applies the configured opacity', () => {
    const { container } = render(
      <FeedMotif motif={{ kind: 'halftone', opacity: 0.08 }} color="#fff" />,
    );
    const el = container.firstChild as HTMLElement;
    expect(el.style.opacity).toBe('0.08');
  });
});
```

- [ ] **Step 3: Run the test to verify it passes**

Run: `npx vitest run src/components/browse/FeedMotif.test.tsx`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/browse/FeedMotif.tsx frontend/src/components/browse/FeedMotif.test.tsx
git commit -m "feat(carousels): FeedMotif decorative motif renderer"
```

---

### Task 4: `RailBackdrop` component (band + motif behind a row)

**Files:**
- Create: `frontend/src/components/browse/RailBackdrop.tsx`
- Test: `frontend/src/components/browse/RailBackdrop.test.tsx`

**Interfaces:**
- Consumes: `FeedTheme` (`@/lib/feedThemes`), `FeedMotif` (Task 3).
- Produces: `default` component `RailBackdrop` with props `{ theme: FeedTheme }`. Renders a single `aria-hidden` layer carrying `data-testid="rail-backdrop"`, a tinted band, and the motif; fades top/bottom via a vertical mask.

- [ ] **Step 1: Write `RailBackdrop.tsx`**

```tsx
// frontend/src/components/browse/RailBackdrop.tsx
import React from 'react';
import { FeedTheme } from '@/lib/feedThemes';
import FeedMotif from './FeedMotif';

/** Vertical fade so adjacent themed rows never hard-seam against each other. */
const V_MASK =
  'linear-gradient(to bottom, transparent 0%, #000 18%, #000 82%, transparent 100%)';

export interface RailBackdropProps {
  theme: FeedTheme;
}

/**
 * Decorative layer behind a themed Row/RankedRow. Sits at -z-10 inside the
 * row's <section> (which establishes a stacking context via `relative z-[2]`),
 * so it paints behind the header and track. The band gradient is authored to
 * fade at the left/right edges; this component adds the top/bottom fade.
 */
const RailBackdrop: React.FC<RailBackdropProps> = ({ theme }) => (
  <div
    data-testid="rail-backdrop"
    aria-hidden="true"
    className="pointer-events-none absolute inset-0 -z-10 overflow-hidden"
    style={{ WebkitMaskImage: V_MASK, maskImage: V_MASK }}
  >
    <div className="absolute inset-0" style={{ background: theme.band }} />
    <FeedMotif motif={theme.motif} color={theme.accent} />
  </div>
);

export default RailBackdrop;
```

- [ ] **Step 2: Write the failing test**

```tsx
// frontend/src/components/browse/RailBackdrop.test.tsx
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import RailBackdrop from './RailBackdrop';
import { FEED_THEMES } from '@/lib/feedThemes';

describe('RailBackdrop', () => {
  it('renders an aria-hidden backdrop with the band background and the motif', () => {
    const marvel = FEED_THEMES['company:420'];
    const { getByTestId } = render(<RailBackdrop theme={marvel} />);
    const backdrop = getByTestId('rail-backdrop');
    expect(backdrop.getAttribute('aria-hidden')).toBe('true');
    // Band layer carries the theme background.
    const band = backdrop.querySelector('div');
    expect(band?.getAttribute('style')).toContain('background');
    // Marvel uses a wordmark motif.
    expect(backdrop.textContent).toContain('MARVEL');
  });
});
```

- [ ] **Step 3: Run the test to verify it passes**

Run: `npx vitest run src/components/browse/RailBackdrop.test.tsx`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/browse/RailBackdrop.tsx frontend/src/components/browse/RailBackdrop.test.tsx
git commit -m "feat(carousels): RailBackdrop band + motif layer"
```

---

### Task 5: `Row` — accept a theme; apply vars, backdrop, accent, title

**Files:**
- Modify: `frontend/src/components/browse/Row.tsx`
- Test: `frontend/src/components/browse/Row.test.tsx`

**Interfaces:**
- Consumes: `FeedTheme`, `railStyleVars` (`@/lib/feedThemes`); `RailBackdrop` (Task 4).
- Produces: `RowProps` gains `theme?: FeedTheme | null`. Behaviour: themed ⇒ inline vars on `<section>` + `<RailBackdrop>` + eyebrow override + title font/treatment + accent-coloured eyebrow/arrows/see-all. Neutral (no theme) ⇒ no backdrop, no inline vars, gold defaults — visually identical to before.

- [ ] **Step 1: Update imports** (top of `Row.tsx`, after the existing `cn` import on line 22)

Add:
```tsx
import { FeedTheme, railStyleVars } from '@/lib/feedThemes';
import RailBackdrop from './RailBackdrop';
```

- [ ] **Step 2: Extend `RowProps`** (lines 24-30)

Replace:
```tsx
export interface RowProps {
  title: string;
  eyebrow?: string;
  seeAllHref?: string;
  children: React.ReactNode;
  className?: string;
}
```
with:
```tsx
export interface RowProps {
  title: string;
  eyebrow?: string;
  seeAllHref?: string;
  children: React.ReactNode;
  className?: string;
  /** Per-feed theme; null/undefined renders the default gold look. */
  theme?: FeedTheme | null;
}
```

- [ ] **Step 3: Destructure `theme` and derive the title font + eyebrow** (component signature, lines 66-72)

Replace:
```tsx
const Row: React.FC<RowProps> = ({
  title,
  eyebrow,
  seeAllHref,
  children,
  className,
}) => {
  const trackRef = useRef<HTMLDivElement>(null);
```
with:
```tsx
const Row: React.FC<RowProps> = ({
  title,
  eyebrow,
  seeAllHref,
  children,
  className,
  theme,
}) => {
  const trackRef = useRef<HTMLDivElement>(null);
  // Exactly one font-family class (tailwind-merge can't de-conflict custom tokens).
  const titleFontClass = theme?.title?.font === 'ui' ? 'font-ui' : 'font-display';
  const eyebrowText = theme?.eyebrowOverride ?? eyebrow;
```

- [ ] **Step 4: Set inline vars on `<section>` and render the backdrop** (lines 86-90)

Replace:
```tsx
    <section
      className={cn('relative z-[2] px-14 max-sm:px-[18px]', className)}
      aria-labelledby={`row-heading-${title.replace(/\s+/g, '-').toLowerCase()}`}
    >
      {/* ── Row header ── */}
```
with:
```tsx
    <section
      className={cn('relative z-[2] px-14 max-sm:px-[18px]', className)}
      style={railStyleVars(theme ?? null)}
      aria-labelledby={`row-heading-${title.replace(/\s+/g, '-').toLowerCase()}`}
    >
      {theme && <RailBackdrop theme={theme} />}

      {/* ── Row header ── */}
```

- [ ] **Step 5: Accent + override the eyebrow** (lines 95-99)

Replace:
```tsx
          {eyebrow && (
            <span className="text-[11px] tracking-[.32em] uppercase text-gold font-semibold">
              {eyebrow}
            </span>
          )}
```
with:
```tsx
          {eyebrowText && (
            <span className="text-[11px] tracking-[.32em] uppercase text-[var(--rail-accent)] font-semibold">
              {eyebrowText}
            </span>
          )}
```

- [ ] **Step 6: Apply the title font + treatment** (lines 100-105)

Replace:
```tsx
          <h2
            id={`row-heading-${title.replace(/\s+/g, '-').toLowerCase()}`}
            className="font-display font-normal text-[30px] leading-none tracking-[-0.02em] text-text m-0 max-sm:text-[25px]"
          >
            {title}
          </h2>
```
with:
```tsx
          <h2
            id={`row-heading-${title.replace(/\s+/g, '-').toLowerCase()}`}
            className={cn(
              'font-normal text-[30px] leading-none tracking-[-0.02em] text-text m-0 max-sm:text-[25px]',
              titleFontClass,
              theme?.title?.className,
            )}
          >
            {title}
          </h2>
```

- [ ] **Step 7: Accent the "See all" hover** (lines 113-120)

In the `<a>` className, replace the single token `hover:text-gold-lite` with `hover:text-[var(--rail-accent-soft)]`. Leave the focus-ring `var(--color-gold)` untouched.

- [ ] **Step 8: Accent the arrow buttons** (both buttons, lines 148-154 and 162-168 — identical className blocks)

In each button's className, replace:
```
'hover:border-gold/55 hover:text-gold-lite hover:bg-surface-2/85',
```
with:
```
'hover:border-[color:color-mix(in_srgb,var(--rail-accent)_55%,transparent)] hover:text-[var(--rail-accent-soft)] hover:bg-surface-2/85',
```

- [ ] **Step 9: Write the failing test**

```tsx
// frontend/src/components/browse/Row.test.tsx
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import Row from './Row';
import { FEED_THEMES } from '@/lib/feedThemes';

describe('Row theming', () => {
  it('is neutral with no theme: no backdrop, no inline accent var', () => {
    const { container, queryByTestId } = render(
      <Row title="Trending"><div>card</div></Row>,
    );
    expect(queryByTestId('rail-backdrop')).toBeNull();
    const section = container.querySelector('section')!;
    expect(section.style.getPropertyValue('--rail-accent')).toBe('');
  });

  it('themed: renders backdrop, sets accent var, applies eyebrow override', () => {
    const marvel = FEED_THEMES['company:420'];
    const { container, getByTestId, getByText } = render(
      <Row title="Marvel" theme={marvel}><div>card</div></Row>,
    );
    expect(getByTestId('rail-backdrop')).not.toBeNull();
    const section = container.querySelector('section')!;
    expect(section.style.getPropertyValue('--rail-accent')).toBe(marvel.accent);
    expect(getByText('Cinematic Universe')).not.toBeNull();
  });
});
```

- [ ] **Step 10: Run the test and typecheck**

Run: `npx vitest run src/components/browse/Row.test.tsx && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 11: Commit**

```bash
git add frontend/src/components/browse/Row.tsx frontend/src/components/browse/Row.test.tsx
git commit -m "feat(carousels): Row consumes feed theme (vars, backdrop, title)"
```

---

### Task 6: `RankedRow` — same theme treatment + accent numeral stroke

**Files:**
- Modify: `frontend/src/components/browse/RankedRow.tsx`
- Test: `frontend/src/components/browse/RankedRow.test.tsx`

**Interfaces:**
- Consumes: same as Task 5.
- Produces: `RankedRowProps` gains `theme?: FeedTheme | null`. Same themed behaviour as `Row`, plus the editorial numeral's `-webkit-text-stroke` recolours to the accent (its gold glow default is preserved so neutral ranked rows are identical).

- [ ] **Step 1: Update imports** (after line 20, the `CatalogItem` import)

Add:
```tsx
import { FeedTheme, railStyleVars } from '@/lib/feedThemes';
import RailBackdrop from './RailBackdrop';
```

- [ ] **Step 2: Extend `RankedRowProps`** (lines 22-27)

Replace:
```tsx
export interface RankedRowProps {
  title: string;
  eyebrow?: string;
  items: CatalogItem[];
  seeAllHref?: string;
}
```
with:
```tsx
export interface RankedRowProps {
  title: string;
  eyebrow?: string;
  items: CatalogItem[];
  seeAllHref?: string;
  /** Per-feed theme; null/undefined renders the default gold look. */
  theme?: FeedTheme | null;
}
```

- [ ] **Step 3: Destructure `theme` and derive font/eyebrow** (line 67)

Replace:
```tsx
const RankedRow: React.FC<RankedRowProps> = ({ title, eyebrow, items, seeAllHref }) => {
  const trackRef = useRef<HTMLDivElement>(null);
```
with:
```tsx
const RankedRow: React.FC<RankedRowProps> = ({ title, eyebrow, items, seeAllHref, theme }) => {
  const trackRef = useRef<HTMLDivElement>(null);
  const titleFontClass = theme?.title?.font === 'ui' ? 'font-ui' : 'font-display';
  const eyebrowText = theme?.eyebrowOverride ?? eyebrow;
```

- [ ] **Step 4: Set inline vars + render backdrop** (lines 86-90)

Replace:
```tsx
    <section
      className="relative z-[2] px-14 max-sm:px-[18px]"
      aria-labelledby={headingId}
    >
      {/* ── Row header ── */}
```
with:
```tsx
    <section
      className="relative z-[2] px-14 max-sm:px-[18px]"
      style={railStyleVars(theme ?? null)}
      aria-labelledby={headingId}
    >
      {theme && <RailBackdrop theme={theme} />}

      {/* ── Row header ── */}
```

- [ ] **Step 5: Accent + override the eyebrow** (lines 95-99)

Replace:
```tsx
          {eyebrow && (
            <span className="text-[11px] tracking-[.32em] uppercase text-gold font-semibold">
              {eyebrow}
            </span>
          )}
```
with:
```tsx
          {eyebrowText && (
            <span className="text-[11px] tracking-[.32em] uppercase text-[var(--rail-accent)] font-semibold">
              {eyebrowText}
            </span>
          )}
```

- [ ] **Step 6: Apply the title font + treatment** (lines 100-106)

Replace:
```tsx
          <h2
            id={headingId}
            className="font-display font-normal text-[30px] leading-none tracking-[-0.02em] text-text m-0 max-sm:text-[25px]"
          >
            {title}
          </h2>
```
with:
```tsx
          <h2
            id={headingId}
            className={cn(
              'font-normal text-[30px] leading-none tracking-[-0.02em] text-text m-0 max-sm:text-[25px]',
              titleFontClass,
              theme?.title?.className,
            )}
          >
            {title}
          </h2>
```

- [ ] **Step 7: Accent "See all" + arrow buttons**

Same three replacements as Task 5: in the See-all `<a>` change `hover:text-gold-lite` → `hover:text-[var(--rail-accent-soft)]`; in both arrow buttons change `'hover:border-gold/55 hover:text-gold-lite hover:bg-surface-2/85',` → `'hover:border-[color:color-mix(in_srgb,var(--rail-accent)_55%,transparent)] hover:text-[var(--rail-accent-soft)] hover:bg-surface-2/85',`.

- [ ] **Step 8: Accent the numeral stroke** (lines 219-227)

Replace:
```tsx
                    '[color:transparent] [-webkit-text-stroke:1.6px_rgba(201,168,106,.72)]',
                    'group-hover:[-webkit-text-stroke-color:var(--color-gold)]',
```
with:
```tsx
                    '[color:transparent] [-webkit-text-stroke:1.6px_color-mix(in_srgb,var(--rail-accent)_72%,transparent)]',
                    'group-hover:[-webkit-text-stroke-color:var(--rail-accent)]',
```

(The two `text-shadow` glow lines just above stay literal gold — that keeps neutral ranked rows pixel-identical.)

- [ ] **Step 9: Accent the poster hover border** (line 239)

Replace `group-hover:border-gold/35` with `group-hover:border-[color:color-mix(in_srgb,var(--rail-accent)_35%,transparent)]` inside the poster art `<div>` className.

- [ ] **Step 10: Write the failing test**

```tsx
// frontend/src/components/browse/RankedRow.test.tsx
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import RankedRow from './RankedRow';
import { FEED_THEMES } from '@/lib/feedThemes';
import type { CatalogItem } from '@/types';

const items: CatalogItem[] = [
  { tmdb_id: 1, media_type: 'movie', title: 'One', year: 2024, overview: '', poster_url: null,
    backdrop_url: null, genre_ids: [], genres: [], vote_average: 8, vote_count: 1, popularity: 1, original_language: 'en' },
];

describe('RankedRow theming', () => {
  it('is neutral with no theme', () => {
    const { container, queryByTestId } = render(<RankedRow title="Top Rated" items={items} />);
    expect(queryByTestId('rail-backdrop')).toBeNull();
    expect(container.querySelector('section')!.style.getPropertyValue('--rail-accent')).toBe('');
  });

  it('themed: backdrop + accent var present', () => {
    const xmen = FEED_THEMES['collection:748'];
    const { container, getByTestId } = render(<RankedRow title="X-Men" items={items} theme={xmen} />);
    expect(getByTestId('rail-backdrop')).not.toBeNull();
    expect(container.querySelector('section')!.style.getPropertyValue('--rail-accent')).toBe(xmen.accent);
  });
});
```

- [ ] **Step 11: Run the test and typecheck**

Run: `npx vitest run src/components/browse/RankedRow.test.tsx && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 12: Commit**

```bash
git add frontend/src/components/browse/RankedRow.tsx frontend/src/components/browse/RankedRow.test.tsx
git commit -m "feat(carousels): RankedRow consumes feed theme + accent numeral"
```

---

### Task 7: `PosterCard` — inherit accent on hover border, glow, and chips

**Files:**
- Modify: `frontend/src/components/browse/PosterCard.tsx`

This task is **CSS-only** (class-string swaps that read inherited `--rail-*` vars). There is no PosterCard unit test today, and asserting hover class strings in jsdom is brittle, so it is verified by `tsc` + the full suite (nothing must break) + the visual checklist in Task 9. Each swap *replaces* a gold literal, so neutral cards are unchanged (the card glow's default var is `transparent`).

- [ ] **Step 1: Accent the card hover glow** (lines 143-150, the card-visual `<div>`)

Replace:
```tsx
          'group-hover:shadow-[0_20px_46px_rgba(0,0,0,.62)] group-focus-within:shadow-[0_20px_46px_rgba(0,0,0,.62)]',
```
with:
```tsx
          'group-hover:shadow-[0_20px_46px_rgba(0,0,0,.62),0_0_34px_var(--rail-card-glow)] group-focus-within:shadow-[0_20px_46px_rgba(0,0,0,.62),0_0_34px_var(--rail-card-glow)]',
```

- [ ] **Step 2: Accent the poster border on hover** (line 158, inside the main `<Link>` className)

Replace:
```tsx
            'group-hover:border-gold/35',
```
with:
```tsx
            'group-hover:border-[color:color-mix(in_srgb,var(--rail-accent)_35%,transparent)]',
```

- [ ] **Step 3: Accent the genre chips** (lines 267-273, the chip `<span>` className)

Replace:
```tsx
                    className="text-[9.5px] tracking-[.08em] uppercase text-gold-lite border border-gold/32 rounded px-1.5 py-0.5"
```
with:
```tsx
                    className="text-[9.5px] tracking-[.08em] uppercase text-[var(--rail-accent-soft)] border border-[color:color-mix(in_srgb,var(--rail-accent)_32%,transparent)] rounded px-1.5 py-0.5"
```

- [ ] **Step 4: Typecheck and run the full suite (regression guard)**

Run: `npx tsc --noEmit && npx vitest run`
Expected: no type errors; entire suite green (PosterCard renders unchanged for neutral rows; existing tests still pass).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/browse/PosterCard.tsx
git commit -m "feat(carousels): PosterCard inherits rail accent on hover/glow/chips"
```

---

### Task 8: Wire it up — `RowConfig.feed`, `buildRailsScreen`, `BrowseScreen`

**Files:**
- Modify: `frontend/src/components/browse/BrowseScreen.tsx`
- Modify: `frontend/src/lib/buildRailsScreen.ts`
- Test: `frontend/src/lib/buildRailsScreen.test.ts` (extend)

**Interfaces:**
- Consumes: `feedIdentityFromParams`, `feedIdentityFromKey`, `resolveFeedTheme`, `FeedIdentity` (`@/lib/feedThemes`).
- Produces: `RowConfig` gains `feed?: FeedIdentity`. `buildRailsScreen` populates it. `BrowseScreen` resolves `theme` and passes it to `Row`/`RankedRow`.

- [ ] **Step 1: Add `feed` to `RowConfig` and import helpers** (`BrowseScreen.tsx`)

After the existing `import PosterCard from './PosterCard';` (line 35) add:
```tsx
import { FeedIdentity, resolveFeedTheme } from '@/lib/feedThemes';
```
Then in `RowConfig` (lines 41-54) add the field before the closing brace:
```tsx
  /** 'poster' = Row + PosterCard grid; 'ranked' = RankedRow with numerals */
  variant?: 'poster' | 'ranked';
  /** Curated-feed identity used to resolve a per-feed theme. */
  feed?: FeedIdentity;
}
```

- [ ] **Step 2: Resolve and pass the theme** (BrowseScreen render, lines 95-121)

Replace:
```tsx
      {visibleRows.map((row) => {
        if (row.variant === 'ranked') {
          return (
            <RankedRow
              key={row.key}
              title={row.title}
              eyebrow={row.eyebrow}
              items={row.items}
              seeAllHref={row.seeAllHref}
            />
          );
        }

        // Default: poster row
        return (
          <Row
            key={row.key}
            title={row.title}
            eyebrow={row.eyebrow}
            seeAllHref={row.seeAllHref}
          >
            {row.items.map((item) => (
              <PosterCard key={item.tmdb_id} item={item} />
            ))}
          </Row>
        );
      })}
```
with:
```tsx
      {visibleRows.map((row) => {
        const theme = resolveFeedTheme(row.feed);

        if (row.variant === 'ranked') {
          return (
            <RankedRow
              key={row.key}
              title={row.title}
              eyebrow={row.eyebrow}
              items={row.items}
              seeAllHref={row.seeAllHref}
              theme={theme}
            />
          );
        }

        // Default: poster row
        return (
          <Row
            key={row.key}
            title={row.title}
            eyebrow={row.eyebrow}
            seeAllHref={row.seeAllHref}
            theme={theme}
          >
            {row.items.map((item) => (
              <PosterCard key={item.tmdb_id} item={item} />
            ))}
          </Row>
        );
      })}
```

- [ ] **Step 3: Populate `feed` in `buildRailsScreen.ts`**

After the existing imports (line 5), add:
```tsx
import { feedIdentityFromParams, feedIdentityFromKey } from '@/lib/feedThemes';
```
Then in the `rows` map (lines 48-55) add the `feed` field:
```tsx
  const rows: RowConfig[] = rails.map((r, i) => ({
    key: r.key,
    title: r.title,
    eyebrow: r.eyebrow,
    variant: r.variant,
    seeAllHref: r.see_all_href,
    items: pages[i].results,
    feed: feedIdentityFromParams(r.params) ?? feedIdentityFromKey(r.key),
  }));
```

- [ ] **Step 4: Extend the failing test** (`buildRailsScreen.test.ts`)

Append this `it` inside the existing `describe('buildRailsScreen', …)` block (before its closing `});`):
```tsx
  it('derives a feed identity for curated marquee rails and leaves others undefined', async () => {
    (railsService.getRails as ReturnType<typeof vi.fn>).mockResolvedValue([
      { key: 'company-420', title: 'Marvel Studios', params: { company: 420, api: 'popular' } },
      { key: 'collection-748', title: 'X-Men', params: { collection: 748 } },
      { key: 'genre-28', title: 'Action', params: { genres: '28' } },
    ]);
    const screen = await buildRailsScreen('movie');
    const byTitle = Object.fromEntries(screen.rows.map((r) => [r.title, r.feed]));
    expect(byTitle['Marvel Studios']).toEqual({ type: 'company', id: '420' });
    expect(byTitle['X-Men']).toEqual({ type: 'collection', id: '748' });
    expect(byTitle['Action']).toBeUndefined();
  });
```

- [ ] **Step 5: Run the test and typecheck**

Run: `npx vitest run src/lib/buildRailsScreen.test.ts && npx tsc --noEmit`
Expected: PASS (including the three pre-existing cases), no type errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/browse/BrowseScreen.tsx frontend/src/lib/buildRailsScreen.ts frontend/src/lib/buildRailsScreen.test.ts
git commit -m "feat(carousels): thread feed identity into rows and resolve per-feed theme"
```

---

### Task 9: Full verification + visual QA

**Files:** none (verification only).

- [ ] **Step 1: Full test suite**

Run: `npx vitest run`
Expected: entire suite green, including the new `feedThemes`, `FeedMotif`, `RailBackdrop`, `Row`, `RankedRow`, and `buildRailsScreen` tests.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Build (catches Tailwind/RSC issues unit tests miss)**

Run: `npm run build`
Expected: successful production build.

- [ ] **Step 4: Visual QA against the running app**

Bring the stack up (`make up` from repo root) and open `http://localhost:3001`. Confirm:
- A **themed** row (e.g. a Marvel Studios / Netflix / X-Men rail on Home or Movies) shows: a tinted band behind the row, a faint motif, an accent-coloured eyebrow + nav arrows, the per-feed title treatment, and an accent glow on card hover.
- A **neutral** row (Trending / Action / Top Rated) looks exactly as before — gold accents, no band, no motif, no extra card glow.
- Toggle OS "Reduce Motion" → no motif/band animation (the global reduced-motion guard already covers transitions; confirm nothing drifts).
- Tab through a themed row → focus rings remain the standard gold (unchanged), contrast of title/eyebrow over the band reads clearly.

- [ ] **Step 5: Final integration commit (if any visual tweaks were needed)**

```bash
git add -A
git commit -m "feat(carousels): finalize feed-themed carousels"
```

---

## Self-Review

**Spec coverage:**
- Identity resolution (structured + key fallback) → Task 1 (`feedIdentityFromParams`/`feedIdentityFromKey`), wired in Task 8.
- Theme-as-data model → Task 1 (`types.ts`, `registry.ts`).
- CSS-variable mechanism + gold defaults → Task 2 (`railStyleVars`, `globals.css`), consumed in Tasks 5–7.
- Band + motif decorative layers → Tasks 3 (`FeedMotif`) & 4 (`RailBackdrop`).
- Motif vocabulary (none/wordmark/beams/starfield/arcs/halftone) → Task 3.
- Marquee registry (~18, verified ids) → Task 1.
- Scope = Row + RankedRow only; ContinueWatching/Featured/search untouched → Tasks 5/6/8 (no other components modified).
- Brand assets = evocative, no raster logos → registry uses colours + CSS/SVG motifs only.
- A11y/perf/reduced-motion → backdrops `aria-hidden`/`pointer-events-none`, no images/network, vertical mask, global reduced-motion guard; verified Task 9.
- Neutral pixel-identity → enforced by replace-not-add swaps + `transparent` glow default; verified Tasks 5/6 tests + Task 9 visual.
- Testing via vitest + `tsc` + visual → every task; Task 9 is the full gate.

**Placeholder scan:** none — all steps carry concrete code/commands.

**Type consistency:** `FeedIdentity`, `FeedTheme`, `MotifConfig`, `MotifKind`, `FeedTitleStyle`, `FEED_THEMES`, `feedIdentityFromParams`, `feedIdentityFromKey`, `resolveFeedTheme`, `railStyleVars`, the `theme?: FeedTheme | null` prop, and `RowConfig.feed?: FeedIdentity` are used identically across Tasks 1–8. CSS vars `--rail-accent` / `--rail-accent-soft` / `--rail-card-glow` match between `railStyleVars` (Task 2), `globals.css` defaults (Task 2), and every consuming class (Tasks 5–7).
