# Avatar Revamp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace eight hand-drawn cartoon SVGs with a 45-piece original avatar set in the Editorial-Noir language, collapse two divergent pickers into one, and turn the avatar value from unvalidated free text into a validated id.

**Architecture:** Avatars become scheme-prefixed ids (`house:frontier-hat`, `cached:8f3a…`) resolved to a URL in exactly one frontend module. Tier 1 is 45 static SVGs under `public/avatars/house/`. Tier 2 caches a TMDB still server-side, with the client sending a TMDB *path fragment* so the backend owns the URL it fetches.

**Tech Stack:** Next.js 15 / React 19 / Tailwind v4 / TypeScript / vitest 2.1.9 · FastAPI / Pydantic **v2** (2.10.6) / SQLAlchemy 1.4 / pytest

**Spec:** `docs/superpowers/specs/2026-09-20-avatar-revamp-design.md`

## Global Constraints

Every task's requirements implicitly include this section.

**Artwork (spec §4.2):**
- `viewBox="0 0 200 200"`, **no** `width`/`height` attributes
- A field `<rect width="200" height="200">` covers the full canvas. **Never draw a background circle** — the frame supplies the shape
- Subject inside a centred circle of **r ≤ 88** (the circular mask clips corners)
- Nothing meaningful at **x > 150 with y < 50** — the gate's 28px gold lock badge sits there
- **No `#C9A86A`** anywhere in artwork; gold is the selection signal
- Field colours must be clearly brighter than `#16161A` or they vanish into the tile
- No `<style>`, no CSS classes, no `currentColor` — these render through `<img>` and inherit nothing
- No `Math.random`, no `Date.now` (SSR determinism — `FeedMotif.tsx:8-19` documents the precedent)

**Palette (`globals.css:8-29`):** ink `#0A0A0B` · surface `#111113` · surface-2 `#16161A` · text `#F4F1EA` · muted `#8C8884` · hairline `#26242A` · gold `#C9A86A` · gold-lite `#E7D6AE`

**Commands:**
- One frontend test: `cd frontend && npx vitest run src/path/to/file.test.tsx` (host, not Docker)
- Frontend typecheck: `cd frontend && npx tsc --noEmit` (no npm script exists)
- One backend test: `docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest tests/<file> -v`
  — backend tests are **baked into the image, not bind-mounted**, so a new test file is invisible without this mount or a `make build`

**Conventions:** Conventional Commits (`feat:`, `fix:`, `refactor:`, `test:`, `docs:`). SQLAlchemy **1.4** style. Frontend class merging uses `cn` from `@/lib/cn`, never raw `twMerge`.

---

## File Structure

**Created**

| Path | Responsibility |
| --- | --- |
| `frontend/src/lib/avatars/types.ts` | `AvatarPiece`, `AvatarCollection` |
| `frontend/src/lib/avatars/catalog.ts` | The 10 collections as data + `AVATAR_IDS` lookup |
| `frontend/src/lib/avatars/resolve.ts` | `resolveAvatarSrc`, `getInitials`, legacy map |
| `frontend/src/components/users/Avatar.tsx` | The one render component |
| `frontend/src/components/users/AvatarPicker.tsx` | The one picker |
| `frontend/public/avatars/house/*.svg` | 45 artwork files |
| `backend/app/assets/__init__.py` | Makes `app.assets` importable at all |
| `backend/app/api/avatars.py` | Tier-2 mint + serve routes |

**Deleted**

`frontend/src/utils/avatarHelper.ts` · `frontend/src/components/users/UserAvatar.tsx` · `frontend/src/components/users/AvatarSelector.tsx` · `frontend/src/components/auth/AvatarPicker.tsx` · `frontend/public/avatars/avatar1-8.svg` · `frontend/public/avatars/default.png`

**Modified**

`ProfileGate.tsx` · `ProfileMenu.tsx` · `SettingsView.tsx` · `app/invite/page.tsx` · `AuthenticatedLayout.tsx` · `UserContext.tsx` · `backend/app/models.py` · `backend/app/main.py` · `backend/app/config.py` · `backend/app/assets/manager.py` · `backend/app/providers/tmdb.py` · `docker-compose.yml`

---

### Task 1: Avatar types, catalog and resolver

**Files:**
- Create: `frontend/src/lib/avatars/types.ts`
- Create: `frontend/src/lib/avatars/catalog.ts`
- Create: `frontend/src/lib/avatars/resolve.ts`
- Test: `frontend/src/lib/avatars/resolve.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `AvatarPiece`, `AvatarCollection`, `AVATAR_COLLECTIONS: AvatarCollection[]`, `AVATAR_IDS: ReadonlySet<string>`, `resolveAvatarSrc(value: string | null | undefined): string | null`, `getInitials(name: string): string`

This task ships the House Set entries only. Tasks 3–5 append the themed collections.

- [ ] **Step 1: Write the failing test**

```ts
// frontend/src/lib/avatars/resolve.test.ts
import { describe, it, expect } from 'vitest';
import { resolveAvatarSrc, getInitials } from './resolve';

describe('resolveAvatarSrc', () => {
  it('resolves a known house id to its file', () => {
    expect(resolveAvatarSrc('house:reel')).toBe('/avatars/house/reel.svg');
  });

  it('returns null for a well-formed but unknown house id', () => {
    expect(resolveAvatarSrc('house:not-a-real-piece')).toBeNull();
  });

  it('resolves a cached id to the backend asset route', () => {
    expect(resolveAvatarSrc('cached:8f3a91c2')).toBe('/api/v1/assets/avatars/8f3a91c2.jpg');
  });

  it('coerces every legacy path to a house id', () => {
    expect(resolveAvatarSrc('/avatars/avatar1.svg')).toBe('/avatars/house/reel.svg');
    expect(resolveAvatarSrc('/avatars/avatar8.svg')).toBe('/avatars/house/directors-chair.svg');
  });

  it('refuses anything else', () => {
    expect(resolveAvatarSrc('javascript:alert(1)')).toBeNull();
    expect(resolveAvatarSrc('https://evil.example/x.gif')).toBeNull();
    expect(resolveAvatarSrc('data:image/svg+xml;base64,AAAA')).toBeNull();
    expect(resolveAvatarSrc('house:UPPERCASE')).toBeNull();
    expect(resolveAvatarSrc('cached:nothex')).toBeNull();
    expect(resolveAvatarSrc('')).toBeNull();
    expect(resolveAvatarSrc(null)).toBeNull();
    expect(resolveAvatarSrc(undefined)).toBeNull();
  });
});

describe('getInitials', () => {
  it('takes the first letter of the first two words, uppercased', () => {
    expect(getInitials('Ben Herro')).toBe('BH');
    expect(getInitials('ava')).toBe('A');
  });

  it('returns an empty string for an empty name rather than throwing', () => {
    expect(getInitials('')).toBe('');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/lib/avatars/resolve.test.ts`
Expected: FAIL — `Failed to resolve import "./resolve"`

- [ ] **Step 3: Write the types**

```ts
// frontend/src/lib/avatars/types.ts
export interface AvatarPiece {
  /** Globally unique slug across ALL collections — it is the stored id. */
  id: string;
  /** Accessible name in the picker, e.g. 'Film reel'. */
  label: string;
}

export interface AvatarCollection {
  key: string;
  title: string;
  /** Field colour this collection's artwork is built from. Never gold. */
  accent: string;
  pieces: AvatarPiece[];
}
```

- [ ] **Step 4: Write the catalog**

Slugs are unique across every collection, because the stored id is `house:<slug>` with no collection segment — that way reorganising collections never invalidates a saved avatar.

```ts
// frontend/src/lib/avatars/catalog.ts
import type { AvatarCollection } from './types';

export const HOUSE_SET: AvatarCollection = {
  key: 'house',
  title: 'The House Set',
  accent: '#CFC8B8',
  pieces: [
    { id: 'reel', label: 'Film reel' },
    { id: 'clapper', label: 'Clapperboard' },
    { id: 'filmstrip', label: '35mm strip' },
    { id: 'projector', label: 'Projector head' },
    { id: 'ticket', label: 'Ticket stub' },
    { id: 'boom-mic', label: 'Boom microphone' },
    { id: 'marquee', label: 'Marquee bulb' },
    { id: 'directors-chair', label: "Director's chair" },
    { id: 'leader-three', label: 'Academy leader' },
  ],
};

export const AVATAR_COLLECTIONS: AvatarCollection[] = [HOUSE_SET];

export const AVATAR_IDS: ReadonlySet<string> = new Set(
  AVATAR_COLLECTIONS.flatMap((c) => c.pieces.map((p) => `house:${p.id}`)),
);
```

- [ ] **Step 5: Write the resolver**

```ts
// frontend/src/lib/avatars/resolve.ts
import { AVATAR_IDS } from './catalog';

/**
 * The eight retired files, mapped onto House Set pieces by index. This is a
 * READ-TIME coercion: rows are never rewritten, so the change stays reversible.
 */
const LEGACY_AVATAR_MAP: Record<string, string> = {
  '/avatars/avatar1.svg': 'house:reel',
  '/avatars/avatar2.svg': 'house:clapper',
  '/avatars/avatar3.svg': 'house:filmstrip',
  '/avatars/avatar4.svg': 'house:projector',
  '/avatars/avatar5.svg': 'house:ticket',
  '/avatars/avatar6.svg': 'house:boom-mic',
  '/avatars/avatar7.svg': 'house:marquee',
  '/avatars/avatar8.svg': 'house:directors-chair',
};

const CACHED_RE = /^cached:[a-f0-9]{8,64}$/;

/**
 * The ONLY place an avatar value becomes a URL. Anything unrecognised returns
 * null and the caller renders a monogram — which is what keeps an arbitrary
 * stored string (`javascript:`, a remote URL) out of `<img src>`.
 */
export function resolveAvatarSrc(value: string | null | undefined): string | null {
  if (!value) return null;

  const id = LEGACY_AVATAR_MAP[value] ?? value;

  if (id.startsWith('house:')) {
    return AVATAR_IDS.has(id) ? `/avatars/house/${id.slice('house:'.length)}.svg` : null;
  }
  if (CACHED_RE.test(id)) {
    return `/api/v1/assets/avatars/${id.slice('cached:'.length)}.jpg`;
  }
  return null;
}

/** First letter of up to two words. Moved verbatim from the deleted avatarHelper. */
export function getInitials(name: string): string {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/lib/avatars/resolve.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 7: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors

- [ ] **Step 8: Commit**

```bash
git add frontend/src/lib/avatars/
git commit -m "feat(avatars): id-based avatar catalog and resolver"
```

---

### Task 2: House Set artwork + structural lint

**Files:**
- Create: `frontend/public/avatars/house/{reel,clapper,filmstrip,projector,ticket,boom-mic,marquee,directors-chair,leader-three}.svg`
- Test: `frontend/src/lib/avatars/artwork.test.ts`

**Interfaces:**
- Consumes: `AVATAR_COLLECTIONS` from Task 1
- Produces: 9 SVG files; a lint test every later artwork task reuses unchanged

The lint test is the quality gate: it mechanically enforces every Global Constraint above, so later tasks cannot drift.

- [ ] **Step 1: Write the failing test**

```ts
// frontend/src/lib/avatars/artwork.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { AVATAR_COLLECTIONS } from './catalog';

const DIR = join(process.cwd(), 'public', 'avatars', 'house');
const all = AVATAR_COLLECTIONS.flatMap((c) => c.pieces.map((p) => ({ ...p, collection: c.key })));

describe('avatar artwork', () => {
  it('has a unique slug for every piece across all collections', () => {
    const ids = all.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(all)('$id has a file on disk', ({ id }) => {
    expect(existsSync(join(DIR, `${id}.svg`))).toBe(true);
  });

  it.each(all)('$id obeys the canvas contract', ({ id }) => {
    const svg = readFileSync(join(DIR, `${id}.svg`), 'utf8');

    expect(svg).toContain('viewBox="0 0 200 200"');
    // No fixed size: the tile decides how big this renders.
    expect(/<svg[^>]*\swidth=/.test(svg)).toBe(false);
    expect(/<svg[^>]*\sheight=/.test(svg)).toBe(false);
    // A full-bleed field, never a background circle.
    expect(/<rect[^>]*width="200"[^>]*height="200"/.test(svg)).toBe(true);
    expect(/<circle[^>]*r="100"/.test(svg)).toBe(false);
    // Gold is the selection signal, not a pigment.
    expect(svg.toUpperCase()).not.toContain('#C9A86A');
    // Renders through <img>: inherits nothing from the document.
    expect(svg).not.toContain('currentColor');
    expect(svg).not.toContain('<style');
    expect(svg).not.toContain('class=');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/lib/avatars/artwork.test.ts`
Expected: FAIL — every `has a file on disk` case fails

- [ ] **Step 3: Author the artwork template**

Every piece follows this skeleton. `ACCENT_HI` / `ACCENT_LO` are the collection's two field stops; `RIM` is the accent mixed ~80% toward `#F4F1EA`. The rim light traces the **upper-left** edge — one light source across all 45 pieces.

```svg
<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="f" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="ACCENT_HI"/>
      <stop offset="1" stop-color="ACCENT_LO"/>
    </linearGradient>
  </defs>
  <rect width="200" height="200" fill="url(#f)"/>
  <!-- subject: solid #0A0A0B, inside r<=88 of (100,100) -->
  <!-- interior detail: cut back to the field colour at 50-85% opacity -->
  <!-- rim light: stroke RIM, width 3-4.5, round caps, upper-left edge only -->
</svg>
```

House Set stops: `ACCENT_HI` `#CFC8B8`, `ACCENT_LO` `#8A8479`, `RIM` `#F4F1EA`.

- [ ] **Step 4: Write `reel.svg` as the worked reference**

```svg
<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="f" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#CFC8B8"/>
      <stop offset="1" stop-color="#8A8479"/>
    </linearGradient>
  </defs>
  <rect width="200" height="200" fill="url(#f)"/>
  <path d="M100 36 A64 64 0 1 0 100 164 A64 64 0 1 0 100 36 Z M100 84 A16 16 0 1 1 100 116 A16 16 0 1 1 100 84 Z" fill="#0A0A0B" fill-rule="evenodd"/>
  <g fill="url(#f)">
    <circle cx="100" cy="62" r="12"/>
    <circle cx="133" cy="81" r="12"/>
    <circle cx="133" cy="119" r="12"/>
    <circle cx="100" cy="138" r="12"/>
    <circle cx="67" cy="119" r="12"/>
    <circle cx="67" cy="81" r="12"/>
  </g>
  <path d="M100 36 A64 64 0 0 0 44 68" fill="none" stroke="#F4F1EA" stroke-width="3" stroke-linecap="round" opacity=".8"/>
</svg>
```

Note the subject spans r=64 around (100,100) — well inside the r≤88 safe area — and the rim-light arc runs from 12 o'clock anticlockwise to 8 o'clock, which is the upper-left convention.

- [ ] **Step 5: Author the remaining eight**

Same template, same field stops. Subject briefs:

| File | Subject |
| --- | --- |
| `clapper.svg` | Clapperboard, hinged stick open ~25°, diagonal stripes cut back to field |
| `filmstrip.svg` | Vertical 35mm strip, four sprocket holes each edge, two frames |
| `projector.svg` | Projector head in profile: lamp housing, lens barrel, one feed arm |
| `ticket.svg` | Torn ticket stub, perforation line, rounded notch each side |
| `boom-mic.svg` | Shotgun mic at ~30°, windshield body, short boom arm to lower-left |
| `marquee.svg` | Single marquee bulb, bayonet base, filament cut back to field |
| `directors-chair.svg` | Folding chair, front three-quarter, crossed leg X |
| `leader-three.svg` | Academy leader: numeral **3** counter-struck out of a circle and crosshair |

`leader-three.svg` is the one piece whose subject is a glyph: draw the 3 as a **path**, not `<text>`, because `<img>`-rendered SVG has no access to the Fraunces webfont and would fall back to a system serif.

- [ ] **Step 6: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/lib/avatars/artwork.test.ts`
Expected: PASS — 1 uniqueness + 9 existence + 9 contract cases

- [ ] **Step 7: Eyeball both masks at both sizes**

The lint test proves structure, not beauty. Open `frontend/public/avatars/house/` in a browser and confirm each piece reads at 36px under a circular mask and at 150px under a 22px squircle. A piece that becomes an indistinct blob at 36px needs a heavier silhouette, not more detail.

- [ ] **Step 8: Commit**

```bash
git add frontend/public/avatars/house/ frontend/src/lib/avatars/artwork.test.ts
git commit -m "feat(avatars): house set artwork and structural lint"
```

---

### Task 3: Artwork — After Dark, The Future Is Now, The Frontier

**Files:**
- Create: 12 SVGs in `frontend/public/avatars/house/`
- Modify: `frontend/src/lib/avatars/catalog.ts`
- Test: `frontend/src/lib/avatars/artwork.test.ts` (no edit — it iterates the catalog)

**Interfaces:**
- Consumes: the Task 2 template and lint test
- Produces: `AFTER_DARK`, `FUTURE`, `FRONTIER` collections appended to `AVATAR_COLLECTIONS`

- [ ] **Step 1: Extend the catalog (this makes the lint test fail)**

```ts
// append to frontend/src/lib/avatars/catalog.ts, before AVATAR_COLLECTIONS
export const AFTER_DARK: AvatarCollection = {
  key: 'after-dark',
  title: 'After Dark',
  accent: '#8E2C2C',
  pieces: [
    { id: 'moth', label: 'Moth' },
    { id: 'porcelain-mask', label: 'Porcelain mask' },
    { id: 'streetlamp', label: 'Streetlamp in fog' },
    { id: 'raven', label: 'Raven' },
  ],
};

export const FUTURE: AvatarCollection = {
  key: 'future',
  title: 'The Future Is Now',
  accent: '#3FB7C4',
  pieces: [
    { id: 'visor', label: 'Helmet visor' },
    { id: 'ringed-planet', label: 'Ringed planet' },
    { id: 'ray-gun', label: 'Ray gun' },
    { id: 'satellite', label: 'Satellite' },
  ],
};

export const FRONTIER: AvatarCollection = {
  key: 'frontier',
  title: 'The Frontier',
  accent: '#BB6B3A',
  pieces: [
    { id: 'brim-hat', label: 'Wide-brim hat' },
    { id: 'horseshoe', label: 'Horseshoe' },
    { id: 'saguaro', label: 'Saguaro' },
    { id: 'spurs', label: 'Spurs' },
  ],
};
```

Then update the array:

```ts
export const AVATAR_COLLECTIONS: AvatarCollection[] = [HOUSE_SET, AFTER_DARK, FUTURE, FRONTIER];
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/lib/avatars/artwork.test.ts`
Expected: FAIL — 12 new `has a file on disk` cases fail

- [ ] **Step 3: Author the 12 pieces**

Field stops per collection:

| Collection | `ACCENT_HI` | `ACCENT_LO` | `RIM` |
| --- | --- | --- | --- |
| After Dark | `#A83636` | `#421518` | `#F3D9D4` |
| The Future Is Now | `#4FC9D6` | `#1B5A64` | `#DFF6F9` |
| The Frontier | `#D08046` | `#5E3520` | `#F6E2CE` |

`visor.svg` as the worked reference for this task — a filled helmet with side pods, a recessed visor cut back to a darker field tone, and the rim light on the upper-left dome:

```svg
<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="f" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#4FC9D6"/>
      <stop offset="1" stop-color="#1B5A64"/>
    </linearGradient>
  </defs>
  <rect width="200" height="200" fill="url(#f)"/>
  <rect x="26" y="86" width="14" height="30" rx="6" fill="#0A0A0B"/>
  <rect x="160" y="86" width="14" height="30" rx="6" fill="#0A0A0B"/>
  <path d="M100 30 C136 30 160 56 160 94 L160 116 C160 134 148 146 130 146 L70 146 C52 146 40 134 40 116 L40 94 C40 56 64 30 100 30Z" fill="#0A0A0B"/>
  <path d="M58 150 H142 V164 H58 Z" fill="#0A0A0B"/>
  <path d="M100 54 C127 54 143 73 143 94 C143 113 126 123 100 123 C74 123 57 113 57 94 C57 73 73 54 100 54Z" fill="#17454E"/>
  <path d="M71 78 C78 69 88 65 97 64" fill="none" stroke="#DFF6F9" stroke-width="4.5" stroke-linecap="round"/>
  <path d="M100 30 C74 30 52 48 43 72" fill="none" stroke="#DFF6F9" stroke-width="3" stroke-linecap="round" opacity=".7"/>
</svg>
```

Remaining briefs:

| File | Subject |
| --- | --- |
| `moth.svg` | Wings spread, fat tapered body, feathered antennae; wing veins cut back to field |
| `porcelain-mask.svg` | Smooth oval face, two almond voids, hairline crack from brow to jaw |
| `streetlamp.svg` | Single swan-neck lamp, light cone cut back to field at ~35% opacity |
| `raven.svg` | Perched profile facing left, one visible eye as a field-coloured dot |
| `ringed-planet.svg` | Sphere with ring ellipse crossing in front and behind |
| `ray-gun.svg` | Retro pistol at ~20°, bulb chamber, finned barrel |
| `satellite.svg` | Body with two panel wings, dish angled upper-left |
| `brim-hat.svg` | Wide-brim hat, pinched crown, band cut back to field |
| `horseshoe.svg` | Open end down, seven nail holes cut back to field |
| `saguaro.svg` | Three-arm cactus, ribs as thin field-coloured lines |
| `spurs.svg` | Single spur, heel band and rowel; rowel points radiate |

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/lib/avatars/artwork.test.ts`
Expected: PASS — 21 pieces now covered

- [ ] **Step 5: Commit**

```bash
git add frontend/public/avatars/house/ frontend/src/lib/avatars/catalog.ts
git commit -m "feat(avatars): after dark, future and frontier collections"
```

---

### Task 4: Artwork — Shadows & Smoke, Realms of Wonder, Matters of the Heart

**Files:**
- Create: 12 SVGs in `frontend/public/avatars/house/`
- Modify: `frontend/src/lib/avatars/catalog.ts`

**Interfaces:**
- Consumes: Task 2 template and lint test
- Produces: `SHADOWS`, `WONDER`, `HEART` appended to `AVATAR_COLLECTIONS`

- [ ] **Step 1: Extend the catalog**

```ts
export const SHADOWS: AvatarCollection = {
  key: 'shadows',
  title: 'Shadows & Smoke',
  accent: '#9AA7B4',
  pieces: [
    { id: 'fedora', label: 'Fedora' },
    { id: 'blinds', label: 'Venetian blinds' },
    { id: 'martini', label: 'Martini' },
    { id: 'candlestick-phone', label: 'Candlestick telephone' },
  ],
};

export const WONDER: AvatarCollection = {
  key: 'wonder',
  title: 'Realms of Wonder',
  accent: '#8E7BD6',
  pieces: [
    { id: 'turret', label: 'Castle turret' },
    { id: 'sword', label: 'Sword' },
    { id: 'crescent-star', label: 'Crescent and star' },
    { id: 'owl', label: 'Owl' },
  ],
};

export const HEART: AvatarCollection = {
  key: 'heart',
  title: 'Matters of the Heart',
  accent: '#C77B92',
  pieces: [
    { id: 'rose', label: 'Rose' },
    { id: 'paired-glasses', label: 'Paired glasses' },
    { id: 'sealed-letter', label: 'Sealed letter' },
    { id: 'moon-on-water', label: 'Moon on water' },
  ],
};
```

```ts
export const AVATAR_COLLECTIONS: AvatarCollection[] = [
  HOUSE_SET, AFTER_DARK, FUTURE, FRONTIER, SHADOWS, WONDER, HEART,
];
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/lib/avatars/artwork.test.ts`
Expected: FAIL — 12 new `has a file on disk` cases fail

- [ ] **Step 3: Author the 12 pieces**

| Collection | `ACCENT_HI` | `ACCENT_LO` | `RIM` |
| --- | --- | --- | --- |
| Shadows & Smoke | `#AEBAC6` | `#464F58` | `#EDF1F4` |
| Realms of Wonder | `#A492E4` | `#443A6B` | `#E8E2F8` |
| Matters of the Heart | `#D892A6` | `#633A47` | `#F7E2E8` |

| File | Subject |
| --- | --- |
| `fedora.svg` | Snap-brim fedora, front three-quarter, brim dipped left |
| `blinds.svg` | Five horizontal slats at a slight angle; gaps cut back to field |
| `martini.svg` | Conical glass, stem and foot, single olive on a pick |
| `candlestick-phone.svg` | Upright stem, mouthpiece cup, receiver hooked on the left |
| `turret.svg` | Round tower, conical roof, pennant flying left, one arrow-slit |
| `sword.svg` | Vertical blade point-up, crossguard, pommel; fuller cut back to field |
| `crescent-star.svg` | Crescent open to the right, five-point star in the opening |
| `owl.svg` | Front-facing, ear tufts, two field-coloured eye discs |
| `rose.svg` | Bloom in spiral profile, two leaves, short stem |
| `paired-glasses.svg` | Two coupe glasses tilted into a toast, rims touching |
| `sealed-letter.svg` | Envelope flap down, round wax seal at the join |
| `moon-on-water.svg` | Low crescent above three horizontal water bands |

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/lib/avatars/artwork.test.ts`
Expected: PASS — 33 pieces covered

- [ ] **Step 5: Commit**

```bash
git add frontend/public/avatars/house/ frontend/src/lib/avatars/catalog.ts
git commit -m "feat(avatars): shadows, wonder and heart collections"
```

---

### Task 5: Artwork — The Big Laugh, The Green World, Silent Era

**Files:**
- Create: 12 SVGs in `frontend/public/avatars/house/`
- Modify: `frontend/src/lib/avatars/catalog.ts`

**Interfaces:**
- Consumes: Task 2 template and lint test
- Produces: `LAUGH`, `GREEN`, `SILENT` appended; `AVATAR_COLLECTIONS` reaches its final 10 entries / 45 pieces

- [ ] **Step 1: Extend the catalog**

```ts
export const LAUGH: AvatarCollection = {
  key: 'laugh',
  title: 'The Big Laugh',
  accent: '#E8B62F',
  pieces: [
    { id: 'bowler-cane', label: 'Bowler and cane' },
    { id: 'comedy-mask', label: 'Comedy mask' },
    { id: 'seltzer', label: 'Seltzer bottle' },
    { id: 'pie-tin', label: 'Pie tin' },
  ],
};

export const GREEN: AvatarCollection = {
  key: 'green',
  title: 'The Green World',
  accent: '#6FA287',
  pieces: [
    { id: 'leaf', label: 'Leaf' },
    { id: 'bird-in-flight', label: 'Bird in flight' },
    { id: 'rain-umbrella', label: 'Rain umbrella' },
    { id: 'paper-boat', label: 'Paper boat' },
  ],
};

export const SILENT: AvatarCollection = {
  key: 'silent',
  title: 'Silent Era',
  accent: '#2A2C30',
  pieces: [
    { id: 'iris-shot', label: 'Iris shot' },
    { id: 'upright-piano', label: 'Upright piano' },
    { id: 'title-card', label: 'Title card' },
    { id: 'arc-lamp', label: 'Carbon-arc lamp' },
  ],
};
```

```ts
export const AVATAR_COLLECTIONS: AvatarCollection[] = [
  HOUSE_SET, AFTER_DARK, FUTURE, FRONTIER, SHADOWS, WONDER, HEART, LAUGH, GREEN, SILENT,
];
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/lib/avatars/artwork.test.ts`
Expected: FAIL — 12 new `has a file on disk` cases fail

- [ ] **Step 3: Author The Big Laugh and The Green World (8 pieces, standard treatment)**

| Collection | `ACCENT_HI` | `ACCENT_LO` | `RIM` |
| --- | --- | --- | --- |
| The Big Laugh | `#F2C94C` | `#7A5C11` | `#FBEFC9` |
| The Green World | `#84B89B` | `#32513F` | `#E2EFE8` |

| File | Subject |
| --- | --- |
| `bowler-cane.svg` | Bowler hat with a cane crossing behind at ~40° |
| `comedy-mask.svg` | Grinning mask, arched brows, two almond voids |
| `seltzer.svg` | Siphon bottle, spout to the upper-left, trigger head |
| `pie-tin.svg` | Tin in three-quarter view, crimped rim, filling mounded |
| `leaf.svg` | Single leaf on a diagonal, midrib and four veins cut back to field |
| `bird-in-flight.svg` | Swift in silhouette, wings swept back, banking left |
| `rain-umbrella.svg` | Open umbrella, four panels, crook handle; panel seams cut back |
| `paper-boat.svg` | Folded boat on two water bands, hull fold cut back to field |

- [ ] **Step 4: Author Silent Era (4 pieces, INVERTED treatment)**

Silent Era is the one deliberate inversion in the set (spec §5): its natural bone/silver field would be indistinguishable from the House Set's. The subject is **bone** on a **dark nitrate-silver** field, and — because the treatment inverts — the rim light inverts with it: a `#101114` **shadow** on the **lower-right** edge, which keeps the single light source consistent with the other nine collections.

- Field: `ACCENT_HI` `#2A2C30` → `ACCENT_LO` `#101114`
- Subject: `#E8E6E1`
- Shadow edge: `#101114`, width 3–4.5, round caps, lower-right only

Note this field is darker than `#16161A`, which Global Constraints forbid for normal pieces. It is admissible **only** because the subject is bone and carries the contrast instead. No other collection may do this.

| File | Subject |
| --- | --- |
| `iris-shot.svg` | Off-centre iris circle, vignette closing from the corners |
| `upright-piano.svg` | Piano front-on, fallboard open, keys as field-coloured teeth |
| `title-card.svg` | Ornate card frame with three abstract text rules inside |
| `arc-lamp.svg` | Lamp housing with two carbon rods and a radiating flare |

- [ ] **Step 5: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/lib/avatars/artwork.test.ts`
Expected: PASS — 1 uniqueness + 45 existence + 45 contract cases

- [ ] **Step 6: Confirm the full set side by side**

All 45 in one grid, at 36px and 150px. Check specifically that Silent Era reads as a deliberate inversion rather than a mistake, and that no two collections' fields are confusable.

- [ ] **Step 7: Commit**

```bash
git add frontend/public/avatars/house/ frontend/src/lib/avatars/catalog.ts
git commit -m "feat(avatars): laugh, green world and silent era collections"
```

---

### Task 6: The Avatar render component

**Files:**
- Create: `frontend/src/components/users/Avatar.tsx`
- Test: `frontend/src/components/users/Avatar.test.tsx`

**Interfaces:**
- Consumes: `resolveAvatarSrc`, `getInitials` (Task 1)
- Produces: `<Avatar value name size shape className />`, default export

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/src/components/users/Avatar.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import Avatar from './Avatar';

describe('Avatar', () => {
  it('renders the resolved image for a known id', () => {
    render(<Avatar value="house:reel" name="Ben Herro" size="md" />);
    const img = screen.getByRole('img', { name: 'Ben Herro' });
    expect(img).toHaveAttribute('src', '/avatars/house/reel.svg');
  });

  it('renders a monogram when there is no avatar', () => {
    render(<Avatar value={null} name="Ben Herro" size="md" />);
    expect(screen.getByText('BH')).toBeInTheDocument();
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('renders a monogram for an unresolvable value rather than an img', () => {
    render(<Avatar value="javascript:alert(1)" name="Ben Herro" size="md" />);
    expect(screen.getByText('BH')).toBeInTheDocument();
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('falls back to the monogram when the image fails to load', () => {
    render(<Avatar value="house:reel" name="Ben Herro" size="md" />);
    fireEvent.error(screen.getByRole('img', { name: 'Ben Herro' }));
    expect(screen.getByText('BH')).toBeInTheDocument();
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('applies the squircle shape when asked', () => {
    const { container } = render(
      <Avatar value={null} name="Ben" size="xl" shape="squircle" />,
    );
    expect(container.firstChild).toHaveClass('rounded-[22px]');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/components/users/Avatar.test.tsx`
Expected: FAIL — `Failed to resolve import "./Avatar"`

- [ ] **Step 3: Write the component**

```tsx
// frontend/src/components/users/Avatar.tsx
'use client';
import React, { useState } from 'react';
import { cn } from '@/lib/cn';
import { resolveAvatarSrc, getInitials } from '@/lib/avatars/resolve';

export interface AvatarProps {
  value: string | null | undefined;
  name: string;
  size: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  shape?: 'circle' | 'squircle';
  className?: string;
}

const SIZES: Record<AvatarProps['size'], string> = {
  xs: 'h-8 w-8 text-xs',
  sm: 'h-9 w-9 text-sm',
  md: 'h-12 w-12 text-base',
  lg: 'h-24 w-24 text-2xl',
  xl: 'h-[150px] w-[150px] text-3xl',
};

/**
 * The ONE avatar surface. Anything `resolveAvatarSrc` refuses — an unknown id, a
 * legacy value with no mapping, a hostile string — renders as a monogram, so a
 * stored value can never reach `<img src>` unvalidated.
 */
const Avatar: React.FC<AvatarProps> = ({ value, name, size, shape = 'circle', className }) => {
  const [broken, setBroken] = useState(false);
  const src = resolveAvatarSrc(value);
  const showImage = src !== null && !broken;

  return (
    <span
      className={cn(
        'relative grid place-items-center overflow-hidden border border-hairline bg-surface-2',
        'font-display text-muted',
        SIZES[size],
        shape === 'circle' ? 'rounded-full' : 'rounded-[22px]',
        className,
      )}
    >
      {showImage ? (
        <img
          src={src}
          alt={name}
          className="h-full w-full object-cover"
          onError={() => setBroken(true)}
        />
      ) : (
        <span aria-hidden="true">{getInitials(name)}</span>
      )}
    </span>
  );
};

export default Avatar;
```

The `broken` state replaces the old imperative `target.src = …` chain in `avatarHelper.ts:36-47`. There is exactly one fallback tier now, so no loop guard is needed.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/components/users/Avatar.test.tsx`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/users/Avatar.tsx frontend/src/components/users/Avatar.test.tsx
git commit -m "feat(avatars): single Avatar render component with monogram fallback"
```

---

### Task 7: Swap every render site to Avatar, delete UserAvatar

**Files:**
- Modify: `frontend/src/components/shell/ProfileGate.tsx:82-94`
- Modify: `frontend/src/components/shell/ProfileMenu.tsx:46-54`
- Modify: `frontend/src/components/settings/SettingsView.tsx:218`
- Modify: `frontend/src/components/settings/SettingsView.test.tsx:62-67`
- Delete: `frontend/src/components/users/UserAvatar.tsx`

**Interfaces:**
- Consumes: `<Avatar>` (Task 6)
- Produces: no avatar markup outside `Avatar.tsx`

- [ ] **Step 1: Run the affected suites to capture the green baseline**

Run: `cd frontend && npx vitest run src/components/shell src/components/settings src/components/layout`
Expected: PASS — note the counts so a regression is visible at Step 6

- [ ] **Step 2: Replace the gate tile**

In `ProfileGate.tsx`, the current tile (lines 82–94) hand-rolls the avatar. Replace the `<span className={cn(...)}>…</span>` block with:

```tsx
<span className="relative">
  <Avatar
    value={u.avatar}
    name={u.display_name}
    size="xl"
    shape="squircle"
    className={cn(
      'h-[clamp(110px,13vw,150px)] w-[clamp(110px,13vw,150px)] text-3xl transition-transform duration-300',
      'group-hover:-translate-y-2 group-hover:border-gold group-focus-visible:border-gold',
      'group-focus-visible:shadow-[0_0_0_2px_var(--color-ink),0_0_0_4px_var(--color-gold)]',
    )}
  />
  {locked && (
    <span aria-hidden="true" className="absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-full border border-gold/55 bg-ink/70 text-gold"><LockClosedIcon className="h-4 w-4" /></span>
  )}
</span>
```

The lock badge moves **outside** `Avatar` because `Avatar` sets `overflow-hidden`, which would clip it.

Update the imports at the top of the file: drop `handleAvatarError` and `getInitials` from `@/utils/avatarHelper`, add `import Avatar from '@/components/users/Avatar';`.

- [ ] **Step 3: Replace the nav trigger**

In `ProfileMenu.tsx`, replace the `<span className="grid h-9 w-9 …">` block (lines 46–54) with:

```tsx
<Avatar value={currentUser?.avatar ?? null} name={name} size="sm" />
```

Drop the `handleAvatarError` / `getInitials` imports; add the `Avatar` import.

- [ ] **Step 4: Replace the Settings avatar**

In `SettingsView.tsx:218`, replace `<UserAvatar user={user} size="lg" />` with:

```tsx
<Avatar value={user.avatar} name={user.display_name} size="lg" />
```

Swap the import on line 7 from `UserAvatar` to `Avatar`.

Then update the mock in `SettingsView.test.tsx` lines 62–67 — `vi.mock` on a deleted path fails at collection:

```tsx
vi.mock('@/components/users/Avatar', () => ({
  default: ({ name }: { name: string }) => <img src="/placeholder.png" alt={name} />,
}));
```

- [ ] **Step 5: Delete the old component**

```bash
git rm frontend/src/components/users/UserAvatar.tsx
```

- [ ] **Step 6: Run the suites and typecheck**

Run: `cd frontend && npx vitest run src/components/shell src/components/settings src/components/layout && npx tsc --noEmit`
Expected: PASS at the same counts as Step 1, no type errors

- [ ] **Step 7: Commit**

```bash
git add -A frontend/src
git commit -m "refactor(avatars): render every avatar through the Avatar component"
```

---

### Task 8: Unified picker with collection tabs

**Files:**
- Create: `frontend/src/components/users/AvatarPicker.tsx`
- Test: `frontend/src/components/users/AvatarPicker.test.tsx`
- Modify: `frontend/src/app/invite/page.tsx:160`
- Modify: `frontend/src/components/layout/AuthenticatedLayout.tsx:93`
- Modify: `frontend/src/app/invite/page.test.tsx:61,65`
- Delete: `frontend/src/components/auth/AvatarPicker.tsx`

**Interfaces:**
- Consumes: `AVATAR_COLLECTIONS` (Tasks 1–5), `resolveAvatarSrc` (Task 1), `Pill` from `@/components/ui/fre`
- Produces: `<AvatarPicker value onChange initials disabled name className />` where `onChange: (v: string | null) => void`

There is no Tabs component in `components/ui/fre/`; `Pill` (`aria-pressed`, gold selected state) is the house primitive for this.

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/src/components/users/AvatarPicker.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AvatarPicker from './AvatarPicker';

describe('AvatarPicker', () => {
  it('opens on the house set and exposes each piece as a radio named for the piece', async () => {
    render(<AvatarPicker value={null} onChange={vi.fn()} />);
    expect(screen.getByRole('radio', { name: 'Film reel' })).toBeInTheDocument();
  });

  it('emits the house id when a piece is chosen', async () => {
    const onChange = vi.fn();
    render(<AvatarPicker value={null} onChange={onChange} />);
    await userEvent.click(screen.getByRole('radio', { name: 'Clapperboard' }));
    expect(onChange).toHaveBeenCalledWith('house:clapper');
  });

  it('switches collections and shows that collection instead', async () => {
    render(<AvatarPicker value={null} onChange={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'After Dark' }));
    expect(screen.getByRole('radio', { name: 'Moth' })).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: 'Film reel' })).toBeNull();
  });

  it('always offers a no-avatar tile that emits null', async () => {
    const onChange = vi.fn();
    render(<AvatarPicker value="house:reel" onChange={onChange} initials="BH" />);
    await userEvent.click(screen.getByRole('radio', { name: 'No avatar' }));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('keeps the no-avatar tile reachable from any collection', async () => {
    render(<AvatarPicker value={null} onChange={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'The Frontier' }));
    expect(screen.getByRole('radio', { name: 'No avatar' })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/components/users/AvatarPicker.test.tsx`
Expected: FAIL — `Failed to resolve import "./AvatarPicker"`

- [ ] **Step 3: Write the picker**

```tsx
// frontend/src/components/users/AvatarPicker.tsx
'use client';
import React, { useState } from 'react';
import { cn } from '@/lib/cn';
import { Pill } from '@/components/ui/fre';
import { AVATAR_COLLECTIONS } from '@/lib/avatars/catalog';
import { resolveAvatarSrc } from '@/lib/avatars/resolve';

export interface AvatarPickerProps {
  value: string | null;
  onChange: (avatar: string | null) => void;
  /** Shown on the "no avatar" tile so the choice previews the typed name. */
  initials?: string;
  disabled?: boolean;
  name?: string;
  className?: string;
}

const TILE =
  'relative grid aspect-square place-items-center overflow-hidden rounded-[18px] border transition-colors duration-200';
const RING =
  'peer-focus-visible:shadow-[0_0_0_2px_var(--color-ink),0_0_0_4px_var(--color-gold)]';

/**
 * Built on hidden radio inputs so arrow-key navigation and screen-reader
 * semantics come from the platform rather than hand-rolled key handling —
 * the same trick as the fre RadioGroup.
 */
const AvatarPicker: React.FC<AvatarPickerProps> = ({
  value, onChange, initials = '', disabled = false, name = 'avatar', className,
}) => {
  const [active, setActive] = useState(AVATAR_COLLECTIONS[0].key);
  const collection =
    AVATAR_COLLECTIONS.find((c) => c.key === active) ?? AVATAR_COLLECTIONS[0];

  const options: Array<{ key: string; id: string | null; label: string }> = [
    { key: 'none', id: null, label: 'No avatar' },
    ...collection.pieces.map((p) => ({
      key: p.id,
      id: `house:${p.id}`,
      label: p.label,
    })),
  ];

  return (
    <div className={cn('flex flex-col gap-4', disabled && 'opacity-50', className)}>
      <div className="flex flex-wrap gap-2">
        {AVATAR_COLLECTIONS.map((c) => (
          <Pill
            key={c.key}
            selected={c.key === active}
            disabled={disabled}
            onClick={() => setActive(c.key)}
          >
            {c.title}
          </Pill>
        ))}
      </div>

      <div role="radiogroup" aria-label="Avatar" className="grid grid-cols-3 gap-3 sm:grid-cols-5">
        {options.map((opt) => {
          const selected = opt.id === value;
          const id = `${name}-${opt.key}`;
          const src = opt.id ? resolveAvatarSrc(opt.id) : null;
          return (
            <label key={opt.key} htmlFor={id} className={cn('cursor-pointer', disabled && 'pointer-events-none')}>
              <input
                type="radio"
                id={id}
                name={name}
                value={opt.id ?? ''}
                checked={selected}
                disabled={disabled}
                onChange={() => onChange(opt.id)}
                aria-label={opt.label}
                className="peer sr-only"
              />
              <span
                aria-hidden="true"
                className={cn(
                  TILE, RING,
                  selected ? 'border-gold bg-surface-2' : 'border-hairline bg-surface-2 hover:border-gold/45',
                )}
              >
                {src ? (
                  <img src={src} alt="" className="h-full w-full object-cover" />
                ) : (
                  <span className="font-display text-lg text-muted">{initials || '—'}</span>
                )}
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );
};

export default AvatarPicker;
```

Only the open collection's images mount, so nothing preloads 45 files. `preloadAvatars()` is not reintroduced.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/components/users/AvatarPicker.test.tsx`
Expected: PASS (5 tests)

- [ ] **Step 5: Re-point the two existing consumers**

In `frontend/src/app/invite/page.tsx` and `frontend/src/components/layout/AuthenticatedLayout.tsx`, change the import from `@/components/auth/AvatarPicker` to `@/components/users/AvatarPicker`. The props are unchanged.

```bash
git rm frontend/src/components/auth/AvatarPicker.tsx
```

- [ ] **Step 6: Update the invite test's pinned values**

`invite/page.test.tsx:61` selects `'Avatar 2'` and line 65 asserts the literal `'/avatars/avatar2.svg'`. Both are gone. Replace lines 61 and 64–65 with:

```tsx
    await userEvent.click(screen.getByRole('radio', { name: 'Clapperboard' }));
```

```tsx
    await waitFor(() =>
      expect(inviteAccept).toHaveBeenCalledWith('invite-token', 'Ava', 'house:clapper'));
```

Leave the `'sends no avatar when none is chosen'` case at line 70 alone — nothing is preselected, so it still sends `undefined`.

- [ ] **Step 7: Run the affected suites and typecheck**

Run: `cd frontend && npx vitest run src/app/invite src/components/users src/components/layout && npx tsc --noEmit`
Expected: PASS, no type errors

- [ ] **Step 8: Commit**

```bash
git add -A frontend/src
git commit -m "feat(avatars): one picker with collection tabs"
```

---

### Task 9: Settings uses the picker and can clear

**Files:**
- Modify: `frontend/src/components/settings/SettingsView.tsx:204,234`
- Modify: `frontend/src/components/settings/SettingsView.test.tsx:54-60`
- Delete: `frontend/src/components/users/AvatarSelector.tsx`

**Interfaces:**
- Consumes: `<AvatarPicker>` (Task 8)
- Produces: Settings can set an avatar to `''`, which the backend already treats as "clear" (`api/users.py:221-223`)

- [ ] **Step 1: Write the failing test**

Replace the `AvatarSelector` mock at `SettingsView.test.tsx:54-60` with a picker stub that can emit `null`, then add a clearing test:

```tsx
vi.mock('@/components/users/AvatarPicker', () => ({
  default: ({ onChange }: { onChange: (v: string | null) => void }) => (
    <>
      <button type="button" onClick={() => onChange('house:reel')}>Pick avatar</button>
      <button type="button" onClick={() => onChange(null)}>Clear avatar</button>
    </>
  ),
}));
```

```tsx
  it('clears the avatar by sending an empty string', async () => {
    render(<SettingsView />);
    await userEvent.click(screen.getByRole('button', { name: 'Clear avatar' }));
    await userEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() =>
      expect(mockUpdateUser).toHaveBeenCalledWith('user-1', expect.objectContaining({ avatar: '' })));
  });
```

Match `getByRole('button', { name: /save/i })` to whatever the existing suite already uses for the profile save button — reuse that selector verbatim rather than inventing one.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/components/settings/SettingsView.test.tsx`
Expected: FAIL — the mocked module path does not exist yet in this file, and `avatar` is sent as `undefined`

- [ ] **Step 3: Swap the component and fix the clear path**

At `SettingsView.tsx:234`, replace `<AvatarSelector selectedAvatar={…} onChange={…} />` with:

```tsx
<AvatarPicker
  value={selectedAvatar}
  onChange={setSelectedAvatar}
  initials={getInitials(user.display_name)}
/>
```

`selectedAvatar` is already `string | null` (line 179), so `setSelectedAvatar` matches `onChange` with no widening.

At `SettingsView.tsx:204`, change the payload so a cleared avatar is actually transmitted:

```tsx
avatar: selectedAvatar ?? '',
```

`?? undefined` meant `avatar` was omitted from the PATCH, and the backend reads a missing key as "leave alone" — which is why clearing has never worked from this screen.

Update imports: drop `AvatarSelector`, add `AvatarPicker` from `@/components/users/AvatarPicker` and `getInitials` from `@/lib/avatars/resolve`.

```bash
git rm frontend/src/components/users/AvatarSelector.tsx
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/components/settings/SettingsView.test.tsx && cd frontend && npx tsc --noEmit`
Expected: PASS, no type errors

- [ ] **Step 5: Commit**

```bash
git add -A frontend/src
git commit -m "feat(avatars): settings picker can clear an avatar"
```

---

### Task 10: Avatar in the create-profile modal

**Files:**
- Modify: `frontend/src/components/shell/ProfileGate.tsx:115-136`
- Modify: `frontend/src/components/shell/ProfileGate.test.tsx`

**Interfaces:**
- Consumes: `<AvatarPicker>` (Task 8)
- Produces: `createUser` receives `{ display_name, avatar }` from the gate

Today this is the only one of three profile-creation entry points with no avatar step — line 119 tells the user to go to Settings instead.

- [ ] **Step 1: Write the failing test**

Add to `ProfileGate.test.tsx`. The existing `vi.mock('@/context/UserContext')` at line 32 returns only three keys — leave it as is, since the gate creates profiles through `usersService.createUser` (mocked at line 35), not through context.

```tsx
  it('creates a profile with the chosen avatar', async () => {
    h.createUser.mockResolvedValue({ id: '3' });
    render(<ProfileGate />);

    await userEvent.click(screen.getByRole('button', { name: 'Add profile' }));
    await userEvent.type(screen.getByLabelText('Profile name'), 'Cleo');
    await userEvent.click(screen.getByRole('radio', { name: 'Film reel' }));
    await userEvent.click(screen.getByRole('button', { name: /create profile/i }));

    await waitFor(() =>
      expect(h.createUser).toHaveBeenCalledWith(
        expect.objectContaining({ display_name: 'Cleo', avatar: 'house:reel' })));
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/components/shell/ProfileGate.test.tsx`
Expected: FAIL — `Unable to find role="radio"`

- [ ] **Step 3: Add the picker to the modal**

Add state beside the existing `newName` state:

```tsx
const [newAvatar, setNewAvatar] = useState<string | null>(null);
```

Replace the copy at line 119 — it is no longer true:

```tsx
<p className="font-ui text-sm text-muted">Create a new viewing profile.</p>
```

Insert after the `Field` block (line 130), inside the form:

```tsx
<AvatarPicker
  value={newAvatar}
  onChange={setNewAvatar}
  initials={getInitials(newName)}
  disabled={submitting}
  name="new-profile-avatar"
/>
```

Include `avatar` in the create call inside `submitCreate`, and reset `newAvatar` to `null` wherever `closeCreate` resets `newName`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/components/shell/ProfileGate.test.tsx && cd frontend && npx tsc --noEmit`
Expected: PASS, no type errors

- [ ] **Step 5: Commit**

```bash
git add -A frontend/src
git commit -m "feat(avatars): choose an avatar when creating a profile"
```

---

### Task 11: Delete avatarHelper and the retired assets

**Files:**
- Delete: `frontend/src/utils/avatarHelper.ts`
- Delete: `frontend/public/avatars/avatar1.svg` … `avatar8.svg`, `frontend/public/avatars/default.png`
- Modify: `frontend/src/context/UserContext.tsx:143`

**Interfaces:**
- Consumes: nothing
- Produces: no references to `avatarHelper` anywhere

`default.png` is SVG bytes with a `.png` extension, so Next serves it as `image/png` and browsers refuse to decode it — it has been a dead request on every avatar-less profile.

- [ ] **Step 1: Prove nothing still imports the module**

Run: `cd frontend && grep -rn "avatarHelper\|preloadAvatars\|handleAvatarError\|AVATAR_OPTIONS\|DEFAULT_AVATAR_DATA_URI" src/`
Expected: only the `UserContext.tsx:143` `preloadAvatars()` call and its import

- [ ] **Step 2: Remove the boot-time preload**

Delete the `preloadAvatars()` call at `UserContext.tsx:143` and its import. It fired `new Image()` for every option on **every app boot for every user**, whether or not a picker was ever opened — at 45 pieces that would be 45 unconditional requests per load.

- [ ] **Step 3: Delete the module and the artwork**

```bash
git rm frontend/src/utils/avatarHelper.ts
git rm frontend/public/avatars/avatar1.svg frontend/public/avatars/avatar2.svg \
       frontend/public/avatars/avatar3.svg frontend/public/avatars/avatar4.svg \
       frontend/public/avatars/avatar5.svg frontend/public/avatars/avatar6.svg \
       frontend/public/avatars/avatar7.svg frontend/public/avatars/avatar8.svg \
       frontend/public/avatars/default.png
```

- [ ] **Step 4: Run the whole frontend suite**

Run: `cd frontend && npx vitest run && npx tsc --noEmit`
Expected: PASS — a stale import would fail at collection, which is the point of running everything here

- [ ] **Step 5: Commit**

```bash
git add -A frontend
git commit -m "refactor(avatars): delete avatarHelper and the retired artwork"
```

---

### Task 12: Backend avatar validation

**Files:**
- Modify: `backend/app/models.py` (imports; `UserCreate:468`, `UserUpdate:472`, `InviteAcceptRequest:641`)
- Test: `backend/tests/test_avatar_validation.py`

**Interfaces:**
- Consumes: the grammar from Task 1
- Produces: `AvatarValue` annotated type in `app.models`

Pydantic here is **v2** (2.10.6). Use `AfterValidator` with an explicit `re.fullmatch` rather than `StringConstraints(pattern=…)`: Pydantic's `pattern` is search-semantics and Python's `$` also matches before a trailing newline, so `"house:reel\n"` would slip through an anchored pattern.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_avatar_validation.py
import pytest
from pydantic import ValidationError

from app.models import UserCreate, UserUpdate, InviteAcceptRequest


@pytest.mark.parametrize("value", [
    "house:reel",
    "house:directors-chair",
    "cached:8f3a91c2",
    "/avatars/avatar1.svg",
    "",
    None,
])
def test_accepts_valid_avatars(value):
    assert UserCreate(display_name="Ben", avatar=value).avatar == value


@pytest.mark.parametrize("value", [
    "javascript:alert(1)",
    "https://evil.example/x.gif",
    "data:image/svg+xml;base64,AAAA",
    "house:UPPERCASE",
    "house:trailing\n",
    "cached:nothex",
    "/avatars/avatar9.svg",
    "../../etc/passwd",
    "house:" + "a" * 200,
])
def test_rejects_hostile_or_malformed_avatars(value):
    with pytest.raises(ValidationError):
        UserCreate(display_name="Ben", avatar=value)


def test_update_and_invite_share_the_rule():
    with pytest.raises(ValidationError):
        UserUpdate(avatar="javascript:alert(1)")
    with pytest.raises(ValidationError):
        InviteAcceptRequest(display_name="Ava", avatar="javascript:alert(1)")


def test_response_stays_permissive():
    """A row written before validation existed must still serialise.

    Narrowing UserResponse would turn one odd row into a 500 for GET /users,
    taking down the whole household's profile list instead of degrading that
    one profile to a monogram.
    """
    from app.models import UserResponse
    assert UserResponse.model_fields["avatar"].annotation is not None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest tests/test_avatar_validation.py -v`
Expected: FAIL — `test_rejects_hostile_or_malformed_avatars` passes every hostile value through

- [ ] **Step 3: Add the validator**

At the top of `backend/app/models.py`, extend the imports:

```python
import re
from pydantic import BaseModel, HttpUrl, Field, validator, ConfigDict, AfterValidator
from typing import Optional, List, Tuple, Literal, Dict, Union, Any, Annotated
```

Add above `class UserCreate`:

```python
# Mirrors frontend/src/lib/avatars/resolve.ts. Shape only — membership is not
# checked here, because the catalog is a frontend concern and an unknown but
# well-formed id already degrades to a monogram at render time.
_AVATAR_RE = re.compile(
    r"house:[a-z0-9][a-z0-9-]{0,63}"
    r"|cached:[a-f0-9]{8,64}"
    r"|/avatars/avatar[1-8]\.svg"
)


def _check_avatar(v: str) -> str:
    # "" is a legitimate value: it CLEARS the avatar (see api/users.py:221-223).
    if v == "":
        return v
    if len(v) > 128 or not _AVATAR_RE.fullmatch(v):
        raise ValueError("invalid avatar reference")
    return v


# The legacy /avatars/avatarN.svg spelling is accepted on WRITE so that a client
# running stale JS through a deploy cannot 422 its own profile save. New code
# never mints it; the frontend resolver maps it on read.
AvatarValue = Annotated[str, AfterValidator(_check_avatar)]
```

Change the three request schemas from `avatar: Optional[str] = None` to:

```python
    avatar: Optional[AvatarValue] = None
```

at lines 468 (`UserCreate`), 472 (`UserUpdate`) and 641 (`InviteAcceptRequest`). **Leave line 514 (`UserResponse`) as `Optional[str]`.**

- [ ] **Step 4: Run test to verify it passes**

Run: `docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest tests/test_avatar_validation.py -v`
Expected: PASS (18 parametrised cases + 2)

- [ ] **Step 5: Run the existing suite for regressions**

Run: `make test`
Expected: PASS — `test_schemas.py`, `test_profile_scoping.py` and `test_claim_flow.py` all construct these models

- [ ] **Step 6: Commit**

```bash
git add backend/app/models.py backend/tests/test_avatar_validation.py
git commit -m "feat(avatars): validate the avatar value server-side"
```

---

### Task 13: Harden AssetManager

**Files:**
- Create: `backend/app/assets/__init__.py`
- Modify: `backend/app/assets/manager.py:149-193` (`download_asset`), `:276-300` (`serve_asset`), `:304` (singleton)
- Modify: `backend/app/config.py:225-229` (`initialize`)
- Test: `backend/tests/test_asset_manager.py`

**Interfaces:**
- Consumes: nothing
- Produces: `app.assets.manager.asset_manager` safe to call; `AssetManager.serve_asset` raises `FileNotFoundError` outside the cache root

This module is currently 304 lines of dead code with no importers, no `__init__.py`, no route and no traversal guard.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_asset_manager.py
import pytest

from app.assets.manager import AssetManager


@pytest.fixture
def manager(tmp_path, monkeypatch):
    from app.config import settings
    monkeypatch.setattr(settings, "base_app_path", tmp_path)
    return AssetManager()


@pytest.mark.parametrize("hostile", [
    "../../../etc/passwd",
    "avatars/../../../etc/passwd",
    "/etc/passwd",
])
def test_serve_asset_refuses_to_escape_the_cache_root(manager, hostile):
    with pytest.raises(FileNotFoundError):
        manager.serve_asset(hostile)


def test_serve_asset_reads_a_file_inside_the_cache(manager):
    target = manager.asset_paths["avatar"] / "abc123.jpg"
    target.write_bytes(b"\xff\xd8\xff")
    content, content_type = manager.serve_asset("avatars/abc123.jpg")
    assert content == b"\xff\xd8\xff"
    assert content_type == "image/jpeg"


def test_missing_file_raises_rather_than_leaking_the_path(manager):
    with pytest.raises(FileNotFoundError):
        manager.serve_asset("avatars/nope.jpg")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest tests/test_asset_manager.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.assets'` (there is no `__init__.py`)

- [ ] **Step 3: Make the package importable**

```bash
touch backend/app/assets/__init__.py
```

- [ ] **Step 4: Guard `serve_asset`**

Replace the body of `serve_asset` (`manager.py:276-300`):

```python
    def serve_asset(self, path: str) -> Tuple[bytes, str]:
        """Read a cached asset. `path` is relative to the cache root.

        The resolve-and-compare is load-bearing: without it, `cache_path / path`
        happily escapes the cache directory on any `../` and serves arbitrary
        files off the container filesystem.
        """
        root = self.cache_path.resolve()
        candidate = (root / path).resolve()

        if not candidate.is_relative_to(root) or not candidate.is_file():
            raise FileNotFoundError(path)

        content = candidate.read_bytes()
        return content, self.get_content_type(str(candidate))
```

`Path.is_relative_to` needs Python 3.9+; the backend is on 3.10.

- [ ] **Step 5: Constrain the downloader**

In `download_asset` (`manager.py:180-193`), replace the httpx block:

```python
        MAX_BYTES = 2 * 1024 * 1024
        ALLOWED_TYPES = {"image/jpeg", "image/png"}

        try:
            async with httpx.AsyncClient() as client:
                # follow_redirects=False: callers pass a URL this process built.
                # Following a redirect would hand control of the final host back
                # to the remote server.
                response = await client.get(url, timeout=10.0, follow_redirects=False)
                response.raise_for_status()

                content_type = (response.headers.get("content-type") or "").split(";")[0].strip()
                if content_type not in ALLOWED_TYPES:
                    return False, f"unsupported content-type: {content_type!r}"
                if len(response.content) > MAX_BYTES:
                    return False, "asset too large"

                local_path.write_bytes(response.content)
                logger.info(f"Downloaded asset from {url} to {local_path}")
                return True, str(local_path)
        except Exception as e:
            logger.error(f"Error downloading asset from {url}: {e}")
            return False, str(e)
```

- [ ] **Step 6: Make the singleton lazy**

`manager.py:304` is `asset_manager = AssetManager()` at module scope, and `__init__` calls `_init_directories()`, which `mkdir`s. That is the same import-time-side-effect hazard `CLAUDE.md` documents for `init_db()`. Replace line 304 with:

```python
_asset_manager: Optional[AssetManager] = None


def get_asset_manager() -> AssetManager:
    """Lazy singleton. Constructing AssetManager creates directories, so doing it
    at import time would run before settings.initialize() — the same trap
    ScheduleManager falls into with init_db()."""
    global _asset_manager
    if _asset_manager is None:
        _asset_manager = AssetManager()
    return _asset_manager
```

The Task 13 test constructs `AssetManager()` directly rather than going through the accessor, so it is unaffected. Any *production* caller must use `get_asset_manager()`.

- [ ] **Step 7: Create the directory at startup**

In `backend/app/config.py`, add to `initialize()` (after line 229):

```python
        (self.base_app_path / "assets" / "cache").mkdir(parents=True, exist_ok=True)
```

- [ ] **Step 8: Run test to verify it passes**

Run: `docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest tests/test_asset_manager.py -v`
Expected: PASS (5 cases)

- [ ] **Step 9: Commit**

```bash
git add backend/app/assets/ backend/app/config.py backend/tests/test_asset_manager.py
git commit -m "fix(assets): guard path traversal, cap downloads, defer the singleton"
```

---

### Task 14: The avatars router

**Files:**
- Create: `backend/app/api/avatars.py`
- Modify: `backend/app/main.py:14-17` (import), `:139-146` (registration)
- Modify: `backend/app/providers/tmdb.py:20-27` (add `profile_path` to cast)
- Modify: `backend/app/models.py` (`CastMember`)
- Modify: `docker-compose.yml` (backend volumes + top-level `volumes:`)
- Test: `backend/tests/test_avatar_assets.py`

**Interfaces:**
- Consumes: `get_asset_manager` (Task 13), `image_url` from `app.providers.catalog`
- Produces: `POST /api/v1/avatars/from-tmdb` → `{ "id": "cached:<hex>" }`; `GET /api/v1/assets/avatars/{name}`; `CastMember.profile_path`

`CastMember` currently carries only a finished `w185` URL (`providers/tmdb.py:24`) and discards the raw path. The client must send a **path fragment** so the backend controls the host, so the raw path has to be exposed.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_avatar_assets.py
import pytest
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


@pytest.mark.parametrize("bad", [
    "https://evil.example/x.jpg",
    "//evil.example/x.jpg",
    "/../../etc/passwd",
    "/abc.jpg",                      # too short
    "/abc123def456ghi789jkl.gif",    # disallowed extension
    "",
])
def test_from_tmdb_rejects_anything_that_is_not_a_tmdb_path(bad):
    r = client.post("/api/v1/avatars/from-tmdb", json={"path": bad})
    assert r.status_code == 422, r.text


def test_serving_an_unknown_asset_404s():
    r = client.get("/api/v1/assets/avatars/deadbeefdeadbeef.jpg")
    assert r.status_code == 404


@pytest.mark.parametrize("hostile", ["..%2F..%2Fetc%2Fpasswd", "....//etc/passwd"])
def test_serving_refuses_traversal(hostile):
    r = client.get(f"/api/v1/assets/avatars/{hostile}")
    assert r.status_code in (404, 422)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest tests/test_avatar_assets.py -v`
Expected: FAIL — 404 on every route (no router registered)

- [ ] **Step 3: Expose the raw TMDB path on cast members**

In `backend/app/models.py`, add one field to `CastMember`:

```python
class CastMember(BaseModel):
    name: str
    character: Optional[str] = None
    image: Optional[str] = None
    # The raw TMDB path (e.g. "/abc123.jpg"). The avatar picker sends THIS, not
    # `image`, so the backend builds the URL it fetches and the client never
    # chooses a host.
    profile_path: Optional[str] = None
```

In `backend/app/providers/tmdb.py`, populate it:

```python
    cast = [
        CastMember(
            name=c.get("name", ""),
            character=c.get("character"),
            image=image_url(c.get("profile_path"), "w185"),
            profile_path=c.get("profile_path"),
        )
        for c in credits.get("cast", [])[:_CAST_LIMIT]
    ]
```

Additive and optional, so no existing consumer breaks.

- [ ] **Step 4: Write the router**

```python
# backend/app/api/avatars.py
"""Tier-2 avatars: cache a TMDB still and serve it back.

The client sends a TMDB PATH FRAGMENT, never a URL. This module builds the
image.tmdb.org URL itself, which is what keeps AssetManager's fetcher from
being aimed at an arbitrary host.
"""
import re

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, field_validator

from app.assets.manager import get_asset_manager
from app.providers.catalog import image_url

router = APIRouter()

# TMDB image paths are a 20-40 char base-62 stem plus an extension.
_TMDB_PATH_RE = re.compile(r"/[A-Za-z0-9]{20,40}\.(jpg|png)")
_ASSET_NAME_RE = re.compile(r"[a-zA-Z0-9_]{1,80}\.(jpg|png)")


class FromTmdbRequest(BaseModel):
    path: str

    @field_validator("path")
    @classmethod
    def _tmdb_path_only(cls, v: str) -> str:
        if not _TMDB_PATH_RE.fullmatch(v):
            raise ValueError("not a TMDB image path")
        return v


class FromTmdbResponse(BaseModel):
    id: str


@router.post("/from-tmdb", response_model=FromTmdbResponse)
async def cache_tmdb_still(payload: FromTmdbRequest) -> FromTmdbResponse:
    """Download a TMDB still once and mint the `cached:` id that names it."""
    url = image_url(payload.path, "w342")
    if not url:
        raise HTTPException(status_code=422, detail="Could not build an image URL")

    manager = get_asset_manager()
    ok, result = await manager.download_asset(url, asset_type="avatar")
    if not ok:
        raise HTTPException(status_code=502, detail="Could not fetch that image")

    stem = manager.get_local_path(url, "avatar").stem
    return FromTmdbResponse(id=f"cached:{stem}")
```

`w342`, not the `w185` used for cast portraits at `providers/tmdb.py:24` — the gate tile is 150px, which needs ≥300px at 2× DPR.

Append the serving route to the same module:

```python
assets_router = APIRouter()


@assets_router.get("/avatars/{name}")
async def serve_avatar(name: str) -> Response:
    if not _ASSET_NAME_RE.fullmatch(name):
        raise HTTPException(status_code=404, detail="Not found")
    try:
        content, content_type = get_asset_manager().serve_asset(f"avatars/{name}")
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Not found")
    return Response(content=content, media_type=content_type,
                    headers={"Cache-Control": "public, max-age=31536000, immutable"})
```

The name regex is belt-and-braces over Task 13's traversal guard: a path segment cannot contain `/`, but an encoded `..` would still reach the manager without it.

- [ ] **Step 5: Register both routers**

In `backend/app/main.py`, add `avatars` to the `from app.api import (…)` block at lines 14–17, then add beside the other gated routers (after the `rails` block at line 139):

```python
app.include_router(
    avatars.router,
    prefix=f"{settings.api_v1_str}/avatars",
    tags=["Avatars"],
    dependencies=GATED,
)
app.include_router(
    avatars.assets_router,
    prefix=f"{settings.api_v1_str}/assets",
    tags=["Avatars"],
    dependencies=GATED,
)
```

- [ ] **Step 6: Persist the cache**

In `docker-compose.yml`, add to the backend service's `volumes:` list (beside `logs:/opt/freeflix/logs`):

```yaml
      # Cached tier-2 avatars. Without this they die on every `make build`, and
      # every profile using one silently falls back to a monogram.
      - assets:/opt/freeflix/assets
```

And to the top-level `volumes:` block:

```yaml
volumes:
  postgres-data:
  resume-data:
  logs:
  assets:
```

- [ ] **Step 7: Run test to verify it passes**

Run: `docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest tests/test_avatar_assets.py -v`
Expected: PASS (9 cases)

- [ ] **Step 8: Run the whole backend suite**

Run: `make test`
Expected: PASS — `CastMember` gained a field, so `test_tmdb_normalize.py` is the one to watch

- [ ] **Step 9: Commit**

```bash
git add backend/ docker-compose.yml
git commit -m "feat(avatars): cache and serve TMDB stills as tier-2 avatars"
```

---

### Task 15: The "From your library" tab

**Files:**
- Create: `frontend/src/services/avatars.ts`
- Modify: `frontend/src/components/users/AvatarPicker.tsx`
- Modify: `frontend/src/components/users/AvatarPicker.test.tsx`

**Interfaces:**
- Consumes: `POST /api/v1/avatars/from-tmdb` (Task 14), the existing watchlist service, `MovieDetail.cast[].profile_path`
- Produces: `avatarsService.cacheTmdbStill(path: string): Promise<string>` returning a `cached:` id

`WatchlistItemResponse` already carries `content_id`, `tmdb_id`, `media_type`, `title` and `poster_url`, so the title list needs no new backend work; cast comes from the existing detail endpoint.

- [ ] **Step 1: Write the failing test**

```tsx
// add to frontend/src/components/users/AvatarPicker.test.tsx
const cacheTmdbStill = vi.fn();
vi.mock('@/services/avatars', () => ({
  avatarsService: { cacheTmdbStill: (...a: unknown[]) => cacheTmdbStill(...a) },
}));

  it('mints a cached id when a library still is chosen', async () => {
    cacheTmdbStill.mockResolvedValue('cached:8f3a91c2');
    const onChange = vi.fn();
    render(
      <AvatarPicker
        value={null}
        onChange={onChange}
        libraryStills={[{
          label: 'Ripley',
          profilePath: '/abc123def456ghi789jkl.jpg',
          previewUrl: 'https://image.tmdb.org/t/p/w185/abc123def456ghi789jkl.jpg',
        }]}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'From your library' }));
    await userEvent.click(screen.getByRole('radio', { name: 'Ripley' }));

    await waitFor(() => expect(cacheTmdbStill).toHaveBeenCalledWith('/abc123def456ghi789jkl.jpg'));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('cached:8f3a91c2'));
  });
```

Add `waitFor` to the `@testing-library/react` import at the top of the file.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/components/users/AvatarPicker.test.tsx`
Expected: FAIL — no `From your library` button, `libraryStills` is not a prop

- [ ] **Step 3: Write the service**

```ts
// frontend/src/services/avatars.ts
import apiClient from './api-client';

export interface LibraryStill {
  /** Accessible name for the tile, e.g. the character or actor name. */
  label: string;
  /** Raw TMDB path fragment, sent to the backend to mint a `cached:` id. */
  profilePath: string;
  /** Already-built w185 URL from `CastMember.image`, used only for the thumbnail. */
  previewUrl: string;
}

export const avatarsService = {
  /**
   * Hand the backend a TMDB path fragment; it downloads, caches and returns the
   * `cached:` id. The path is never a URL — the backend picks the host.
   */
  async cacheTmdbStill(path: string): Promise<string> {
    const { data } = await apiClient.post<{ id: string }>('/avatars/from-tmdb', { path });
    return data.id;
  },
};
```

Match the import spelling and base-path convention of a neighbouring service (`services/users.ts`) rather than assuming — `api-client` is the shared axios instance.

- [ ] **Step 4: Add the tab to the picker**

Add to the imports in `AvatarPicker.tsx`:

```tsx
import { avatarsService, type LibraryStill } from '@/services/avatars';
```

Extend `AvatarPickerProps`:

```ts
  /** Cast stills drawn from titles the profile has watched or saved. */
  libraryStills?: LibraryStill[];
```

Add state beside the existing `active`:

```tsx
const [minting, setMinting] = useState<string | null>(null);
const [mintError, setMintError] = useState<string | null>(null);

const chooseStill = async (still: LibraryStill) => {
  setMintError(null);
  setMinting(still.profilePath);
  try {
    onChange(await avatarsService.cacheTmdbStill(still.profilePath));
  } catch {
    setMintError('Could not use that image. Try another.');
  } finally {
    setMinting(null);
  }
};
```

Add the tab pill after the collection pills, inside the same wrapper:

```tsx
{libraryStills && libraryStills.length > 0 && (
  <Pill
    selected={active === LIBRARY_KEY}
    disabled={disabled}
    onClick={() => setActive(LIBRARY_KEY)}
  >
    From your library
  </Pill>
)}
```

with `const LIBRARY_KEY = '__library__';` at module scope, and widen the `collection` lookup so the library tab does not fall back to the house set:

```tsx
const isLibrary = active === LIBRARY_KEY;
const collection =
  AVATAR_COLLECTIONS.find((c) => c.key === active) ?? AVATAR_COLLECTIONS[0];
```

Then render the library grid in place of the collection grid when `isLibrary`:

```tsx
{isLibrary ? (
  <>
    <div role="radiogroup" aria-label="Avatar" className="grid grid-cols-3 gap-3 sm:grid-cols-5">
      {(libraryStills ?? []).map((still) => {
        const id = `${name}-still-${still.profilePath}`;
        const busy = minting === still.profilePath;
        return (
          <label key={still.profilePath} htmlFor={id} className={cn('cursor-pointer', (disabled || busy) && 'pointer-events-none')}>
            <input
              type="radio"
              id={id}
              name={name}
              checked={false}
              disabled={disabled || busy}
              onChange={() => { void chooseStill(still); }}
              aria-label={still.label}
              className="peer sr-only"
            />
            <span
              aria-hidden="true"
              className={cn(TILE, RING, 'border-hairline bg-surface-2 hover:border-gold/45', busy && 'opacity-50')}
            >
              <img src={still.previewUrl} alt="" className="h-full w-full object-cover" />
            </span>
          </label>
        );
      })}
    </div>
    {mintError && <p role="alert" className="font-ui text-sm text-danger">{mintError}</p>}
  </>
) : (
  /* the existing collection grid, unchanged */
)}
```

`checked={false}` is deliberate: a library still's identity is the `cached:` id the backend mints, which does not exist until after the click, so the tile is a trigger rather than a persisted selection.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/components/users/AvatarPicker.test.tsx && cd frontend && npx tsc --noEmit`
Expected: PASS (6 tests), no type errors

- [ ] **Step 6: Run everything**

Run: `cd frontend && npx vitest run` then `make test`
Expected: PASS both

- [ ] **Step 7: Commit**

```bash
git add -A frontend
git commit -m "feat(avatars): pick an avatar from a title in your library"
```

---

## Verification

After Task 15, confirm end-to-end rather than trusting the suites:

- [ ] `make up` and load `http://localhost:3001`
- [ ] Profile gate renders 45-piece artwork, and a locked profile's gold badge does not collide with its avatar
- [ ] Nav trigger at 36px is legible for a piece from every collection
- [ ] Settings can set **and clear** an avatar
- [ ] A profile created from the gate modal keeps its chosen avatar
- [ ] An existing profile whose row still holds `/avatars/avatar3.svg` shows `house:filmstrip`, not a monogram
- [ ] `docker compose down && make up` — a tier-2 avatar chosen before the restart still renders (proves the `assets` volume)
