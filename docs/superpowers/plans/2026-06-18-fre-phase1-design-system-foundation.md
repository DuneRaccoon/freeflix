# FRÈ Phase 1 — Design-System Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish the FRÈ "Editorial Noir" design-system foundation — color/type tokens, fonts, a reusable cinematic-atmosphere layer, and the core reusable UI primitives — that every later phase is built from.

**Architecture:** Tailwind v4 CSS-first `@theme` tokens in `globals.css` (added alongside the legacy palette, which is removed in the final cleanup phase once all surfaces are migrated). Fonts via `next/font/google`. Primitives are small, focused React components under `src/components/ui/` that expose `data-*`/ARIA attributes for robust testing. A component test harness (Vitest + React Testing Library) is introduced so primitives are built test-first.

**Tech Stack:** Next.js 15.2 (App Router) · React 19 · Tailwind CSS v4 (`@tailwindcss/postcss`, CSS-first) · TypeScript 5.9 · `clsx` + `tailwind-merge` · Vitest + @testing-library/react (new).

## Global Constraints

These apply to **every** task (copied verbatim from the spec):

- **Stack is fixed:** Next.js 15 App Router, React 19, Tailwind v4 (CSS-first `@theme`, no `tailwind.config`), TypeScript. Path alias `@/* → ./src/*`.
- **Dark-only.** FRÈ is a dark identity; do not add light-theme variants. (The `ThemeContext`/`ThemeToggle` are retired in Phase 2, not here — leave them working for now.)
- **Brand:** public wordmark is **FRÈ** (Fraunces, champagne gradient `#FFFFFF → #E7D6AE → #C9A86A`); the repo/package/container/dir name stays `freeflix` — no backend renames.
- **Color tokens (exact hex):** `--color-ink #0A0A0B`, `--color-surface #111113`, `--color-surface-2 #16161A`, `--color-text #F4F1EA`, `--color-muted #8C8884`, `--color-hairline #26242A`, `--color-gold #C9A86A`, `--color-gold-lite #E7D6AE`, `--color-danger #E5564B`, `--color-success #7BDCA0`.
- **Gold is precious:** reserve gold for active/selected states, ratings, primary CTAs, played scrubber, progress fills, ranked numerals, and focus rings. Never flood gold.
- **Typography:** Fraunces (display/titles/wordmark) + Inter Tight (UI/body). Never body in Fraunces or large titles in Inter Tight.
- **Motion is gated:** every animation must be disabled under `@media (prefers-reduced-motion: reduce)`.
- **Accessibility:** real semantic elements (`<button>` for actions, `<a>` for nav); a visible layered focus ring (`0 0 0 2px var(--color-ink), 0 0 0 4px var(--color-gold)`) on every interactive element; AA text contrast.
- **Non-destructive migration:** the app is migrated phase-by-phase. Do NOT delete the legacy palette/classes in this phase — add FRÈ tokens alongside them.
- **Verification gates for every task:** `npx tsc --noEmit` passes, `npm run test` passes, and (for tasks that touch rendered CSS) `npm run build` passes. Run all commands from `frontend/`.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `frontend/vitest.config.ts` | Vitest config (jsdom, React plugin, `@` alias) — **new** |
| `frontend/vitest.setup.ts` | jest-dom matchers — **new** |
| `frontend/package.json` | add dev deps + `test` scripts — **modify** |
| `frontend/src/app/globals.css` | FRÈ `@theme` tokens, base, reduced-motion, atmosphere CSS — **modify** |
| `frontend/src/app/layout.tsx` | Fraunces + Inter Tight fonts, `FRÈ` title, font CSS vars — **modify** |
| `frontend/src/lib/cn.ts` | `cn()` class-merge helper — **new** |
| `frontend/src/components/ui/Wordmark.tsx` | FRÈ champagne wordmark — **new** |
| `frontend/src/components/fx/CinematicAtmosphere.tsx` | grain + glow + vignette fixed overlays — **new** |
| `frontend/src/components/ui/fre/Button.tsx` | FRÈ button (primary/glass/ghost/icon/danger) — **new** |
| `frontend/src/components/ui/fre/Badge.tsx` | small status/label badge — **new** |
| `frontend/src/components/ui/fre/Pill.tsx` | selectable pill/chip (quality, genre, sort) — **new** |
| `frontend/src/components/ui/fre/Progress.tsx` | linear gold progress + conic Ring — **new** |
| `frontend/src/components/ui/fre/Modal.tsx` | glass overlay/dialog primitive — **new** |
| `frontend/src/components/ui/fre/index.ts` | barrel export — **new** |
| `frontend/src/components/ui/fre/*.test.tsx` | component tests — **new** |

> New FRÈ primitives live under `src/components/ui/fre/` so they coexist with the legacy `src/components/ui/*` during migration. Later phases import from `@/components/ui/fre`; the legacy folder is deleted in the final cleanup phase.

---

### Task 1: Component test harness (Vitest + RTL)

Introduces test-first capability for all later tasks. (Extends the spec's testing approach with component-level tests; still no e2e.)

**Files:**
- Create: `frontend/vitest.config.ts`
- Create: `frontend/vitest.setup.ts`
- Create: `frontend/src/lib/__smoke__.test.ts`
- Modify: `frontend/package.json`

**Interfaces:**
- Produces: `npm run test` (runs `vitest run`); jsdom env; `@/*` alias resolves in tests; `@testing-library/jest-dom` matchers globally available.

- [ ] **Step 1: Add dev dependencies**

Run (from `frontend/`):
```bash
npm install -D vitest@^2 @vitejs/plugin-react@^4 jsdom@^25 @testing-library/react@^16 @testing-library/jest-dom@^6 @testing-library/user-event@^14
```

- [ ] **Step 2: Add test scripts to `package.json`**

In `frontend/package.json`, change the `"scripts"` block to:
```json
  "scripts": {
    "dev": "next dev --turbopack",
    "build": "next build",
    "start": "next start",
    "lint": "next lint",
    "test": "vitest run",
    "test:watch": "vitest"
  },
```

- [ ] **Step 3: Create `frontend/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    css: false,
    include: ['src/**/*.test.{ts,tsx}'],
  },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
});
```

- [ ] **Step 4: Create `frontend/vitest.setup.ts`**

```ts
import '@testing-library/jest-dom/vitest';
```

- [ ] **Step 5: Write a smoke test that fails first**

Create `frontend/src/lib/__smoke__.test.ts`:
```ts
import { describe, it, expect } from 'vitest';

describe('test harness', () => {
  it('runs and resolves toBe', () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 6: Run the suite — expect PASS**

Run: `npm run test`
Expected: `1 passed` (the smoke test). If the harness were misconfigured this command would error instead.

- [ ] **Step 7: Commit**

```bash
git add frontend/package.json frontend/package-lock.json frontend/vitest.config.ts frontend/vitest.setup.ts frontend/src/lib/__smoke__.test.ts
git commit -m "test: add Vitest + React Testing Library harness"
```

---

### Task 2: FRÈ design tokens (`@theme`)

Add the FRÈ palette + font + radius tokens as Tailwind v4 utilities, set the base background/text to ink, add the global reduced-motion guard. Legacy palette stays (removed in the final phase).

**Files:**
- Modify: `frontend/src/app/globals.css`

**Interfaces:**
- Produces: Tailwind utilities `bg-ink`, `bg-surface`, `bg-surface-2`, `text-text`, `text-muted`, `border-hairline`, `text-gold`/`bg-gold`, `text-gold-lite`, `text-danger`, `text-success`, `font-display`, `font-ui`, `rounded-card`. CSS vars `--color-ink … --color-gold-lite`, `--font-display`, `--font-ui` available globally.

- [ ] **Step 1: Add the `@theme` block at the top of `globals.css`**

Immediately after the existing first line `@import "tailwindcss";`, insert:
```css

/* ============================================================
   FRÈ — Editorial Noir design tokens (Tailwind v4 @theme)
   Gold is precious. Dark-only. Legacy palette below is removed
   in the final cleanup phase once all surfaces are migrated.
   ============================================================ */
@theme {
  --color-ink: #0A0A0B;
  --color-surface: #111113;
  --color-surface-2: #16161A;
  --color-text: #F4F1EA;
  --color-muted: #8C8884;
  --color-hairline: #26242A;
  --color-gold: #C9A86A;
  --color-gold-lite: #E7D6AE;
  --color-danger: #E5564B;
  --color-success: #7BDCA0;

  --font-display: var(--font-fraunces), Georgia, "Times New Roman", serif;
  --font-ui: var(--font-inter-tight), system-ui, -apple-system, sans-serif;

  --radius-card: 12px;
}

/* FRÈ base: dark canvas + UI font (the legacy `body` rule below still
   runs; this wins by source order for bg/color and adds color-scheme). */
:root { color-scheme: dark; }
body {
  background-color: var(--color-ink);
  color: var(--color-text);
  font-family: var(--font-ui);
}

/* Global reduced-motion guard (applies app-wide). */
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.001ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.001ms !important;
    scroll-behavior: auto !important;
  }
}
```

> Note: `--font-fraunces` / `--font-inter-tight` are defined by `next/font` in Task 3. Until then `--font-display`/`--font-ui` fall back to the serif/sans stacks — harmless.

- [ ] **Step 2: Verify the build compiles the tokens**

Run: `npm run build`
Expected: build completes with no CSS/PostCSS errors. (Tailwind v4 generates the `bg-ink`, `text-gold`, … utilities from `@theme`.)

- [ ] **Step 3: Write a test proving a consumer can use the tokens**

Create `frontend/src/components/ui/fre/__tokens__.test.tsx`:
```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

describe('FRÈ token utilities', () => {
  it('a consumer can apply token utility classes', () => {
    render(<div data-testid="swatch" className="bg-ink text-gold font-display rounded-card" />);
    const el = screen.getByTestId('swatch');
    expect(el.className).toContain('bg-ink');
    expect(el.className).toContain('text-gold');
    expect(el.className).toContain('font-display');
    expect(el.className).toContain('rounded-card');
  });
});
```

- [ ] **Step 4: Run tests — expect PASS**

Run: `npm run test`
Expected: all tests pass (this asserts the class strings are wired through; the build step proved they compile).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/globals.css frontend/src/components/ui/fre/__tokens__.test.tsx
git commit -m "feat(design-system): add FRÈ Editorial Noir @theme tokens + reduced-motion guard"
```

---

### Task 3: Fonts (Fraunces + Inter Tight) + `FRÈ` title

Load the two FRÈ typefaces via `next/font/google`, expose them as the CSS vars the `@theme` references, and set the document title to FRÈ.

**Files:**
- Modify: `frontend/src/app/layout.tsx`

**Interfaces:**
- Consumes: `--font-display`/`--font-ui` tokens (Task 2).
- Produces: CSS vars `--font-fraunces`, `--font-inter-tight` set on `<html>`; document title `FRÈ`.

- [ ] **Step 1: Replace the font import + metadata in `layout.tsx`**

Change the top of `frontend/src/app/layout.tsx`:
```tsx
import type { Metadata } from 'next';
import { Fraunces, Inter_Tight } from 'next/font/google';
import { Toaster } from 'react-hot-toast';
import { UserProvider } from '@/context/UserContext';
import { ThemeProvider } from '@/context/ThemeContext';
import { ProgressProvider } from '@/context/ProgressContext';
import AuthenticatedLayout from '@/components/layout/AuthenticatedLayout';

import './globals.css';

const fraunces = Fraunces({
  subsets: ['latin'],
  variable: '--font-fraunces',
  display: 'swap',
});
const interTight = Inter_Tight({
  subsets: ['latin'],
  variable: '--font-inter-tight',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'FRÈ',
  description: 'FRÈ — your cinema, kept close.',
};
```

- [ ] **Step 2: Apply the font variables to `<html>`**

Change the `<html>`/`<body>` opening tags in the same file to:
```tsx
    <html lang="en" className={`dark ${fraunces.variable} ${interTight.variable}`}>
      <body className="min-h-screen font-ui">
```
(Remove the old `${inter.className}` usage; everything else in the file stays.)

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors (the old `inter` const is gone, no dangling references).

- [ ] **Step 4: Verify the fonts build**

Run: `npm run build`
Expected: build succeeds and `next/font` fetches Fraunces + Inter Tight (no network errors in CI; in local dev they're cached).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/layout.tsx
git commit -m "feat(design-system): load Fraunces + Inter Tight fonts; FRÈ document title"
```

---

### Task 4: `cn()` class-merge helper

A single conflict-aware class merger used by every primitive.

**Files:**
- Create: `frontend/src/lib/cn.ts`
- Create: `frontend/src/lib/cn.test.ts`

**Interfaces:**
- Produces: `cn(...inputs: ClassValue[]): string` — merges with `clsx` then de-conflicts with `tailwind-merge`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/lib/cn.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { cn } from './cn';

describe('cn', () => {
  it('joins truthy classes and drops falsy ones', () => {
    expect(cn('a', false && 'b', 'c')).toBe('a c');
  });
  it('lets later tailwind classes win conflicts', () => {
    expect(cn('px-2 text-text', 'px-4')).toBe('text-text px-4');
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `npm run test -- cn`
Expected: FAIL with "Failed to resolve import './cn'".

- [ ] **Step 3: Implement `frontend/src/lib/cn.ts`**

```ts
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Merge class names, de-conflicting Tailwind utilities (last one wins). */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
```

- [ ] **Step 4: Run test — expect PASS**

Run: `npm run test -- cn`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/cn.ts frontend/src/lib/cn.test.ts
git commit -m "feat(design-system): add cn() class-merge helper"
```

---

### Task 5: FRÈ `Button`

Primary (champagne fill, ink text), glass (hairline + blur), ghost, icon, danger; loading state; gold focus ring. Exposes `data-variant`/`data-size` for testing.

**Files:**
- Create: `frontend/src/components/ui/fre/Button.tsx`
- Create: `frontend/src/components/ui/fre/Button.test.tsx`

**Interfaces:**
- Consumes: `cn` (Task 4).
- Produces: `Button` (default export) with props `{ variant?: 'primary'|'glass'|'ghost'|'icon'|'danger'; size?: 'sm'|'md'|'lg'; isLoading?: boolean; leftIcon?: ReactNode; rightIcon?: ReactNode }` extending `ButtonHTMLAttributes<HTMLButtonElement>`. Renders a `<button>` with `data-variant`, `data-size`, and `aria-busy` when loading.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/ui/fre/Button.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Button from './Button';

describe('Button', () => {
  it('renders children with default primary/md variant', () => {
    render(<Button>Play</Button>);
    const btn = screen.getByRole('button', { name: 'Play' });
    expect(btn.dataset.variant).toBe('primary');
    expect(btn.dataset.size).toBe('md');
  });

  it('honors variant and size props', () => {
    render(<Button variant="glass" size="lg">More Info</Button>);
    const btn = screen.getByRole('button', { name: 'More Info' });
    expect(btn.dataset.variant).toBe('glass');
    expect(btn.dataset.size).toBe('lg');
  });

  it('is disabled and aria-busy while loading, and does not fire onClick', async () => {
    const onClick = vi.fn();
    render(<Button isLoading onClick={onClick}>Save</Button>);
    const btn = screen.getByRole('button');
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('aria-busy', 'true');
    await userEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `npm run test -- Button`
Expected: FAIL with "Failed to resolve import './Button'".

- [ ] **Step 3: Implement `frontend/src/components/ui/fre/Button.tsx`**

```tsx
import React from 'react';
import { cn } from '@/lib/cn';

export type ButtonVariant = 'primary' | 'glass' | 'ghost' | 'icon' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  isLoading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

const base =
  'relative inline-flex items-center justify-center gap-2 font-ui font-medium ' +
  'rounded-full select-none transition-[transform,background-color,border-color,color,box-shadow] ' +
  'duration-200 focus:outline-none focus-visible:outline-none ' +
  'focus-visible:shadow-[0_0_0_2px_var(--color-ink),0_0_0_4px_var(--color-gold)] ' +
  'disabled:opacity-50 disabled:pointer-events-none';

const variants: Record<ButtonVariant, string> = {
  // champagne fill, ink text — the precious primary CTA
  primary: 'bg-gradient-to-r from-gold-lite to-gold text-ink hover:brightness-105',
  // hairline glass
  glass: 'border border-hairline bg-surface-2/60 text-text backdrop-blur hover:border-gold/50',
  ghost: 'bg-transparent text-muted hover:text-text',
  icon: 'border border-hairline bg-surface-2/60 text-text hover:border-gold/50 aspect-square !p-0',
  danger: 'bg-transparent text-danger border border-danger/50 hover:bg-danger/10',
};

const sizes: Record<ButtonSize, string> = {
  sm: 'h-9 px-4 text-sm',
  md: 'h-11 px-6 text-[15px]',
  lg: 'h-12 px-8 text-base',
};

const Button: React.FC<ButtonProps> = ({
  children, className, variant = 'primary', size = 'md',
  isLoading = false, leftIcon, rightIcon, disabled, ...props
}) => (
  <button
    data-variant={variant}
    data-size={size}
    aria-busy={isLoading || undefined}
    disabled={disabled || isLoading}
    className={cn(base, variants[variant], sizes[size], className)}
    {...props}
  >
    {isLoading && (
      <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
    )}
    {!isLoading && leftIcon}
    {children}
    {!isLoading && rightIcon}
  </button>
);

export default Button;
```

- [ ] **Step 4: Run test — expect PASS**

Run: `npm run test -- Button`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/ui/fre/Button.tsx frontend/src/components/ui/fre/Button.test.tsx
git commit -m "feat(design-system): FRÈ Button primitive"
```

---

### Task 6: `Badge` + `Pill`

`Badge` = a small non-interactive label (tones: default/gold/success/danger). `Pill` = a selectable chip (`<button>`) for quality/genre/sort, with a gold selected state and `aria-pressed`.

**Files:**
- Create: `frontend/src/components/ui/fre/Badge.tsx`
- Create: `frontend/src/components/ui/fre/Pill.tsx`
- Create: `frontend/src/components/ui/fre/Badge.test.tsx`
- Create: `frontend/src/components/ui/fre/Pill.test.tsx`

**Interfaces:**
- Consumes: `cn` (Task 4).
- Produces:
  - `Badge` (default export) props `{ tone?: 'default'|'gold'|'success'|'danger' }` extending `HTMLAttributes<HTMLSpanElement>`; renders `<span data-tone={tone}>`.
  - `Pill` (default export) props `{ selected?: boolean }` extending `ButtonHTMLAttributes<HTMLButtonElement>`; renders `<button aria-pressed={selected} data-selected={selected}>`.

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/components/ui/fre/Badge.test.tsx`:
```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import Badge from './Badge';

describe('Badge', () => {
  it('defaults to the default tone', () => {
    render(<Badge>4K</Badge>);
    expect(screen.getByText('4K').dataset.tone).toBe('default');
  });
  it('honors the tone prop', () => {
    render(<Badge tone="gold">Featured</Badge>);
    expect(screen.getByText('Featured').dataset.tone).toBe('gold');
  });
});
```

Create `frontend/src/components/ui/fre/Pill.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Pill from './Pill';

describe('Pill', () => {
  it('reflects unselected state via aria-pressed', () => {
    render(<Pill>1080p</Pill>);
    expect(screen.getByRole('button', { name: '1080p' })).toHaveAttribute('aria-pressed', 'false');
  });
  it('reflects selected state and fires onClick', async () => {
    const onClick = vi.fn();
    render(<Pill selected onClick={onClick}>Auto</Pill>);
    const pill = screen.getByRole('button', { name: 'Auto' });
    expect(pill).toHaveAttribute('aria-pressed', 'true');
    expect(pill.dataset.selected).toBe('true');
    await userEvent.click(pill);
    expect(onClick).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

Run: `npm run test -- Badge Pill`
Expected: FAIL with unresolved imports `./Badge`, `./Pill`.

- [ ] **Step 3: Implement `frontend/src/components/ui/fre/Badge.tsx`**

```tsx
import React from 'react';
import { cn } from '@/lib/cn';

export type BadgeTone = 'default' | 'gold' | 'success' | 'danger';

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
}

const tones: Record<BadgeTone, string> = {
  default: 'border-hairline bg-surface-2 text-muted',
  gold: 'border-gold/40 bg-gold/10 text-gold-lite',
  success: 'border-success/40 bg-success/10 text-success',
  danger: 'border-danger/40 bg-danger/10 text-danger',
};

const Badge: React.FC<BadgeProps> = ({ tone = 'default', className, children, ...props }) => (
  <span
    data-tone={tone}
    className={cn(
      'inline-flex items-center rounded-full border px-2.5 py-0.5 font-ui text-xs font-medium tracking-wide',
      tones[tone],
      className,
    )}
    {...props}
  >
    {children}
  </span>
);

export default Badge;
```

- [ ] **Step 4: Implement `frontend/src/components/ui/fre/Pill.tsx`**

```tsx
import React from 'react';
import { cn } from '@/lib/cn';

export interface PillProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  selected?: boolean;
}

const Pill: React.FC<PillProps> = ({ selected = false, className, children, ...props }) => (
  <button
    type="button"
    aria-pressed={selected}
    data-selected={selected}
    className={cn(
      'inline-flex items-center gap-2 rounded-full border px-4 h-9 font-ui text-sm transition-colors',
      'focus:outline-none focus-visible:shadow-[0_0_0_2px_var(--color-ink),0_0_0_4px_var(--color-gold)]',
      selected
        ? 'border-gold/60 bg-gold/15 text-gold-lite'
        : 'border-hairline bg-surface-2/60 text-muted hover:text-text hover:border-gold/40',
      className,
    )}
    {...props}
  >
    {children}
  </button>
);

export default Pill;
```

- [ ] **Step 5: Run tests — expect PASS**

Run: `npm run test -- Badge Pill`
Expected: PASS (4 tests total).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/ui/fre/Badge.tsx frontend/src/components/ui/fre/Pill.tsx frontend/src/components/ui/fre/Badge.test.tsx frontend/src/components/ui/fre/Pill.test.tsx
git commit -m "feat(design-system): FRÈ Badge + selectable Pill primitives"
```

---

### Task 7: `Progress` (linear gold) + `Ring` (conic)

Linear gold fill (watch/download progress) as a `role="progressbar"`; a conic `Ring` for the Activity badge / autoplay countdown.

**Files:**
- Create: `frontend/src/components/ui/fre/Progress.tsx`
- Create: `frontend/src/components/ui/fre/Progress.test.tsx`

**Interfaces:**
- Consumes: `cn` (Task 4).
- Produces:
  - `Progress` (named export) props `{ value: number /* 0–100 */; label?: string }` extending `HTMLAttributes<HTMLDivElement>`; renders `<div role="progressbar" aria-valuenow aria-valuemin=0 aria-valuemax=100>` with a clamped gold fill.
  - `Ring` (named export) props `{ value: number /* 0–100 */; size?: number /* px, default 18 */ }`; renders a conic-gradient ring with a `data-value` attribute.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/ui/fre/Progress.test.tsx`:
```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Progress, Ring } from './Progress';

describe('Progress', () => {
  it('exposes the clamped value via the progressbar role', () => {
    render(<Progress value={150} label="Watched" />);
    const bar = screen.getByRole('progressbar', { name: 'Watched' });
    expect(bar).toHaveAttribute('aria-valuenow', '100');
    expect(bar).toHaveAttribute('aria-valuemin', '0');
    expect(bar).toHaveAttribute('aria-valuemax', '100');
  });
  it('clamps negative values to 0', () => {
    render(<Progress value={-10} label="Download" />);
    expect(screen.getByRole('progressbar', { name: 'Download' })).toHaveAttribute('aria-valuenow', '0');
  });
});

describe('Ring', () => {
  it('records the value on a data attribute', () => {
    render(<Ring value={64} />);
    expect(screen.getByTestId('fre-ring').dataset.value).toBe('64');
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `npm run test -- Progress`
Expected: FAIL with unresolved import `./Progress`.

- [ ] **Step 3: Implement `frontend/src/components/ui/fre/Progress.tsx`**

```tsx
import React from 'react';
import { cn } from '@/lib/cn';

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

export interface ProgressProps extends React.HTMLAttributes<HTMLDivElement> {
  value: number; // 0–100
  label?: string;
}

export const Progress: React.FC<ProgressProps> = ({ value, label, className, ...props }) => {
  const v = clamp(value);
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuenow={v}
      aria-valuemin={0}
      aria-valuemax={100}
      className={cn('h-1 w-full overflow-hidden rounded-full bg-text/15', className)}
      {...props}
    >
      <div className="h-full rounded-full bg-gold" style={{ width: `${v}%` }} />
    </div>
  );
};

export interface RingProps {
  value: number; // 0–100
  size?: number; // px
  className?: string;
}

export const Ring: React.FC<RingProps> = ({ value, size = 18, className }) => {
  const v = clamp(value);
  const deg = Math.round((v / 100) * 360);
  return (
    <span
      data-testid="fre-ring"
      data-value={v}
      className={cn('inline-block rounded-full', className)}
      style={{
        width: size,
        height: size,
        background: `conic-gradient(var(--color-gold) ${deg}deg, color-mix(in oklab, var(--color-text) 14%, transparent) ${deg}deg)`,
        WebkitMask: 'radial-gradient(circle calc(50% - 3px) at center, transparent 98%, #000 100%)',
        mask: 'radial-gradient(circle calc(50% - 3px) at center, transparent 98%, #000 100%)',
      }}
    />
  );
};
```

- [ ] **Step 4: Run test — expect PASS**

Run: `npm run test -- Progress`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/ui/fre/Progress.tsx frontend/src/components/ui/fre/Progress.test.tsx
git commit -m "feat(design-system): FRÈ Progress bar + conic Ring"
```

---

### Task 8: `Modal` (glass overlay/dialog primitive)

A controlled dialog: a dimmed+blurred backdrop and a glass card. Closes on backdrop click and Escape. Used by passcode, quick-view, confirmations.

**Files:**
- Create: `frontend/src/components/ui/fre/Modal.tsx`
- Create: `frontend/src/components/ui/fre/Modal.test.tsx`

**Interfaces:**
- Consumes: `cn` (Task 4).
- Produces: `Modal` (default export) props `{ open: boolean; onClose: () => void; label: string; children: ReactNode; className?: string }`. Renders nothing when `!open`. When open: a `<div role="dialog" aria-modal="true" aria-label={label}>` containing a backdrop button (`aria-label="Close"`) and the glass card. Escape and backdrop click call `onClose`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/ui/fre/Modal.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Modal from './Modal';

describe('Modal', () => {
  it('renders nothing when closed', () => {
    render(<Modal open={false} onClose={() => {}} label="Passcode">hi</Modal>);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('renders the dialog with children when open', () => {
    render(<Modal open onClose={() => {}} label="Passcode"><p>Enter passcode</p></Modal>);
    expect(screen.getByRole('dialog', { name: 'Passcode' })).toBeInTheDocument();
    expect(screen.getByText('Enter passcode')).toBeInTheDocument();
  });

  it('calls onClose on backdrop click and Escape', async () => {
    const onClose = vi.fn();
    render(<Modal open onClose={onClose} label="Passcode">x</Modal>);
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `npm run test -- Modal`
Expected: FAIL with unresolved import `./Modal`.

- [ ] **Step 3: Implement `frontend/src/components/ui/fre/Modal.tsx`**

```tsx
'use client';
import React from 'react';
import { cn } from '@/lib/cn';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  label: string;
  children: React.ReactNode;
  className?: string;
}

const Modal: React.FC<ModalProps> = ({ open, onClose, label, children, className }) => {
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div role="dialog" aria-modal="true" aria-label={label}
      className="fixed inset-0 z-[1000] flex items-center justify-center p-6">
      <button aria-label="Close" onClick={onClose}
        className="absolute inset-0 bg-ink/70 backdrop-blur-sm" />
      <div className={cn(
        'relative z-[1] w-full max-w-md rounded-2xl border border-hairline',
        'bg-surface/95 p-7 shadow-[0_30px_80px_rgba(0,0,0,0.6)]',
        className,
      )}>
        {children}
      </div>
    </div>
  );
};

export default Modal;
```

- [ ] **Step 4: Run test — expect PASS**

Run: `npm run test -- Modal`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/ui/fre/Modal.tsx frontend/src/components/ui/fre/Modal.test.tsx
git commit -m "feat(design-system): FRÈ Modal/overlay primitive"
```

---

### Task 9: `Wordmark` + barrel export

The champagne FRÈ wordmark and a barrel so later phases import from one place.

**Files:**
- Create: `frontend/src/components/ui/Wordmark.tsx`
- Create: `frontend/src/components/ui/Wordmark.test.tsx`
- Create: `frontend/src/components/ui/fre/index.ts`

**Interfaces:**
- Consumes: `cn` (Task 4).
- Produces:
  - `Wordmark` (named export) props `{ as?: 'span'|'a'; href?: string; className?: string }`; renders the text `FRÈ` in the display font with the champagne gradient.
  - `@/components/ui/fre` barrel re-exporting `Button` (+ types), `Badge`, `Pill`, `Progress`, `Ring`, `Modal`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/ui/Wordmark.test.tsx`:
```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Wordmark } from './Wordmark';

describe('Wordmark', () => {
  it('renders the FRÈ wordmark as a span by default', () => {
    render(<Wordmark />);
    const el = screen.getByText('FRÈ');
    expect(el.tagName).toBe('SPAN');
    expect(el.className).toContain('font-display');
  });
  it('renders as a link when given href', () => {
    render(<Wordmark as="a" href="/" />);
    const link = screen.getByRole('link', { name: 'FRÈ' });
    expect(link).toHaveAttribute('href', '/');
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `npm run test -- Wordmark`
Expected: FAIL with unresolved import `./Wordmark`.

- [ ] **Step 3: Implement `frontend/src/components/ui/Wordmark.tsx`**

```tsx
import React from 'react';
import { cn } from '@/lib/cn';

export interface WordmarkProps {
  as?: 'span' | 'a';
  href?: string;
  className?: string;
}

export const Wordmark: React.FC<WordmarkProps> = ({ as = 'span', href, className }) => {
  const cls = cn(
    'inline-block font-display font-semibold tracking-[0.12em] leading-none',
    'bg-gradient-to-r from-white via-gold-lite to-gold bg-clip-text text-transparent',
    className,
  );
  if (as === 'a') {
    return <a href={href} className={cls}>FRÈ</a>;
  }
  return <span className={cls}>FRÈ</span>;
};
```

- [ ] **Step 4: Create the barrel `frontend/src/components/ui/fre/index.ts`**

```ts
export { default as Button } from './Button';
export type { ButtonProps, ButtonVariant, ButtonSize } from './Button';
export { default as Badge } from './Badge';
export type { BadgeProps, BadgeTone } from './Badge';
export { default as Pill } from './Pill';
export type { PillProps } from './Pill';
export { Progress, Ring } from './Progress';
export type { ProgressProps, RingProps } from './Progress';
export { default as Modal } from './Modal';
export type { ModalProps } from './Modal';
```

- [ ] **Step 5: Run test + typecheck — expect PASS**

Run: `npm run test -- Wordmark` then `npx tsc --noEmit`
Expected: tests PASS (2); typecheck clean (barrel exports resolve).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/ui/Wordmark.tsx frontend/src/components/ui/Wordmark.test.tsx frontend/src/components/ui/fre/index.ts
git commit -m "feat(design-system): FRÈ Wordmark + ui/fre barrel"
```

---

### Task 10: Cinematic Atmosphere layer

The reusable grain + house-light glow + theatre vignette overlay, plus the shared keyframes/utilities (Ken-Burns, spotlight-on-hover, premiere shine) — all reduced-motion-gated. A `<CinematicAtmosphere>` component renders the three fixed overlays; surfaces opt in by mounting it.

**Files:**
- Modify: `frontend/src/app/globals.css` (append the FRÈ atmosphere section)
- Create: `frontend/src/components/fx/CinematicAtmosphere.tsx`
- Create: `frontend/src/components/fx/CinematicAtmosphere.test.tsx`

**Interfaces:**
- Produces:
  - CSS classes: `.ff-grain`, `.ff-glow`, `.ff-vignette` (fixed, `pointer-events:none`); utility classes `.ff-kenburns` (hero backdrop), `.ff-spotlight-row` (apply to a card row: dims non-hovered children, warms the hovered one), `.ff-shine` (gold sheen on wordmark/CTA). Keyframes namespaced `ff-*`. All disabled under reduced-motion.
  - `CinematicAtmosphere` (default export) props `{ className?: string }`; renders a `<div aria-hidden="true">` containing the three overlay layers.

- [ ] **Step 1: Append the atmosphere CSS to `globals.css`**

Append at the end of `frontend/src/app/globals.css`:
```css

/* ============================================================
   FRÈ — Cinematic Atmosphere (opt-in via <CinematicAtmosphere/>)
   All motion below is disabled by the global reduced-motion guard
   added with the @theme tokens. Keep gold faint and precious.
   ============================================================ */
.ff-atmosphere { position: fixed; inset: 0; z-index: 40; pointer-events: none; }

.ff-glow {
  position: fixed; top: -12%; right: -8%; width: 60vw; height: 60vw;
  pointer-events: none;
  background: radial-gradient(circle, rgba(201,168,106,.16), rgba(201,168,106,0) 60%);
  filter: blur(20px);
  animation: ff-drift 42s ease-in-out infinite alternate;
}
.ff-vignette {
  position: fixed; inset: 0; pointer-events: none;
  box-shadow: inset 0 0 220px 60px rgba(0,0,0,.7), inset 0 0 80px rgba(0,0,0,.4);
}
.ff-grain {
  position: fixed; inset: 0; pointer-events: none; opacity: .05; mix-blend-mode: overlay;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
}

/* slow Ken-Burns for hero backdrops */
.ff-kenburns { animation: ff-kenburns 40s ease-in-out infinite alternate; will-change: transform; }

/* spotlight-on-hover: dim siblings, warm the hovered/focused child */
.ff-spotlight-row:hover > *,
.ff-spotlight-row:focus-within > * { transition: opacity .35s ease, filter .35s ease; }
.ff-spotlight-row:hover > *:not(:hover):not(:focus-within),
.ff-spotlight-row:focus-within > *:not(:hover):not(:focus-within) {
  opacity: .55; filter: saturate(.8) brightness(.9);
}

/* premiere shine for wordmark / primary CTA */
.ff-shine { background-size: 240% 100%; animation: ff-shine 9s linear infinite; }

@keyframes ff-drift { from { transform: translate3d(0,0,0) scale(1); } to { transform: translate3d(-26px,22px,0) scale(1.06); } }
@keyframes ff-kenburns { from { transform: scale(1) translate3d(0,0,0); } to { transform: scale(1.08) translate3d(-1.6%,-1.2%,0); } }
@keyframes ff-shine { from { background-position: 0 0; } to { background-position: -240% 0; } }
```

- [ ] **Step 2: Write the failing test for the component**

Create `frontend/src/components/fx/CinematicAtmosphere.test.tsx`:
```tsx
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import CinematicAtmosphere from './CinematicAtmosphere';

describe('CinematicAtmosphere', () => {
  it('renders the three decorative overlays, hidden from a11y tree', () => {
    const { container } = render(<CinematicAtmosphere />);
    const root = container.querySelector('.ff-atmosphere')!;
    expect(root).not.toBeNull();
    expect(root).toHaveAttribute('aria-hidden', 'true');
    expect(container.querySelector('.ff-glow')).not.toBeNull();
    expect(container.querySelector('.ff-vignette')).not.toBeNull();
    expect(container.querySelector('.ff-grain')).not.toBeNull();
  });
});
```

- [ ] **Step 3: Run test — expect FAIL**

Run: `npm run test -- CinematicAtmosphere`
Expected: FAIL with unresolved import `./CinematicAtmosphere`.

- [ ] **Step 4: Implement `frontend/src/components/fx/CinematicAtmosphere.tsx`**

```tsx
import React from 'react';
import { cn } from '@/lib/cn';

/** Decorative cinematic overlays (grain + house-light glow + vignette).
 *  Mount once per immersive surface. Purely visual; aria-hidden. */
const CinematicAtmosphere: React.FC<{ className?: string }> = ({ className }) => (
  <div aria-hidden="true" className={cn('ff-atmosphere', className)}>
    <span className="ff-glow" />
    <span className="ff-vignette" />
    <span className="ff-grain" />
  </div>
);

export default CinematicAtmosphere;
```

- [ ] **Step 5: Run test + build — expect PASS**

Run: `npm run test -- CinematicAtmosphere` then `npm run build`
Expected: test PASS (1); build succeeds (CSS valid).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/app/globals.css frontend/src/components/fx/CinematicAtmosphere.tsx frontend/src/components/fx/CinematicAtmosphere.test.tsx
git commit -m "feat(design-system): cinematic atmosphere layer (grain/glow/vignette + shared keyframes)"
```

---

### Task 11: Foundation gate — full verification

A no-code gate that proves the foundation is healthy as a whole before Phase 2 builds on it.

**Files:** none (verification only).

- [ ] **Step 1: Run the full test suite**

Run: `npm run test`
Expected: all tests pass (smoke, tokens, cn, Button, Badge, Pill, Progress, Modal, Wordmark, CinematicAtmosphere).

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Production build**

Run: `npm run build`
Expected: build succeeds (tokens + fonts + atmosphere compile; existing legacy pages still build because the legacy palette/classes were left intact).

- [ ] **Step 4: Tag the foundation**

```bash
git tag fre-phase1-foundation
```

---

## Self-Review

**1. Spec coverage (against spec §10.1 "Design-system foundation: tokens (`@theme`), Fraunces+Inter Tight, the reusable atmosphere layer, and the core `ui/*` primitives"):**
- Tokens → Task 2 ✓ · Fonts → Task 3 ✓ · Atmosphere layer → Task 10 ✓ · Primitives: Button → 5, Badge/Pill → 6, Progress/Ring → 7, Modal → 8, Wordmark → 9 ✓. Test harness enabling TDD → Task 1 ✓. `cn` helper → Task 4 ✓.
- Deliberately deferred (documented): the **TopNav** shell (app logic: routing/scroll/activity/profile) → Phase 2; content-specific cards (poster/featured/episode, which need real data shapes) → their surface phases (3/5). Foundation ships the generic primitives those are composed from. The spec's mention of "nav shell" under foundation is interpreted as these primitives, not the wired nav.
- Gold-precious, dark-only, reduced-motion, focus-ring, full-bleed constraints → encoded in Global Constraints and each component.

**2. Placeholder scan:** No "TBD"/"handle edge cases"/"similar to Task N". Every code step shows complete code; every run step shows the exact command + expected result.

**3. Type consistency:** `cn(...inputs: ClassValue[])` used identically in Tasks 5–10. `Button` variant set `primary|glass|ghost|icon|danger` and size `sm|md|lg` are consistent between its impl and test. `Pill.selected`/`aria-pressed`, `Badge.tone`, `Progress.value (0–100, clamped)`, `Ring.value`, `Modal.{open,onClose,label}` match between interface blocks, impls, and tests. Barrel (Task 9) re-exports exactly the names/types defined in Tasks 5–8.

> Note for the implementer: dev-dependency version floors in Task 1 are minimums known compatible with React 19 / Next 15; if `npm install` resolves newer compatible majors, that's fine as long as `npm run test` passes.

---

## Execution Handoff

This is **Phase 1 of 8**. The remaining phases (App shell + nav + profile gate; Browse system; Search; Detail pages; Player; Utility surfaces; Backend additions) each get their own plan, written when we reach them, per the spec's decomposition (§10).
