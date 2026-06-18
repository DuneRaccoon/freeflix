# FRÈ Phase 2 — App Shell + Nav + Profile Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the FRÈ app shell — a sticky cinematic top nav (+ mobile tab bar), the "Who's watching?" profile gate with passcode entry, and the dark-only retirement — wiring them into `AuthenticatedLayout` so every surface inherits the new chrome.

**Architecture:** New shell components under `src/components/shell/` compose the Phase-1 FRÈ primitives (`@/components/ui/fre`, `Wordmark`, `CinematicAtmosphere`, `cn`). They reuse the **existing** `UserContext` (`useUser`) and `usersService` unchanged. `AuthenticatedLayout` is rewritten to render `ProfileGate` when no profile is active and `TopNav`+`BottomTabBar`+`CinematicAtmosphere` otherwise (streaming routes stay full-bleed with no nav). The dark-only retirement pins `ThemeContext` to `'dark'` while keeping the `useTheme()` API so legacy consumers don't break.

**Tech Stack:** Next 15 App Router · React 19 · Tailwind v4 · the Phase-1 FRÈ design system · `@heroicons/react` (already a dependency) · Vitest + RTL.

## Global Constraints

(Phase-1 constraints still apply; the binding ones for this phase:)
- **Stack fixed:** Next 15 App Router, React 19, Tailwind v4 CSS-first, TS. Alias `@/* → ./src/*`. Verification from `frontend/`: `npm run test`, `npx tsc --noEmit`, `npm run build`.
- **Dark-only:** the app is always dark. `ThemeContext` returns `theme: 'dark'`; `setTheme`/`toggleTheme` are no-ops; no `localStorage` theme reads/writes. The new nav has NO theme toggle. Keep the `useTheme()` API shape so existing consumers compile. Do NOT delete the `.light` CSS block in this phase (that's the final cleanup phase) — just stop applying it.
- **Brand & nav:** wordmark `FRÈ` (champagne). Primary nav links, in order: **Home `/` · Movies `/movies` · Series `/tv` · Search `/search`**. Power tools (Schedules `/schedules`, Downloads `/downloads`, Settings `/settings`) live in the profile menu, NOT the primary bar. Active link gets a gold underline.
- **Nav behavior:** the top nav is `position: fixed`, transparent over content, and gains a solid blurred bar + hairline bottom border once `window.scrollY > 60` (`.is-scrolled` via the `useScrolled` hook). Full-bleed (no max-width). On mobile it collapses to a bottom tab bar.
- **Reuse, don't fork, the data layer:** `useUser()` exposes `currentUser`, `userSettings`, `users`, `isLoading`, `selectUser(userId) => Promise<boolean>`, `validatePasscode(passcode) => boolean`, `updateUserSettings`, `logout`, `loadUsers`. The active profile persists under `localStorage['currentUserId']`. `usersService.getUserSettings(userId)` returns `UserSettings` (incl. `require_passcode` and `passcode`). Avatars via `@/utils/avatarHelper` (`AVATAR_OPTIONS`, `getInitials`, `handleAvatarError`).
- **content_id / file_index contracts are unchanged** (not touched in this phase).
- **Accessibility:** real `<a>`/`<button>`; gold focus rings (reuse the primitives' rings); reduced-motion already globally gated; AA contrast.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `src/context/ThemeContext.tsx` | **Rewrite** — always-dark, no persistence, same `useTheme()` API |
| `src/lib/useScrolled.ts` | **New** — `useScrolled(threshold)` boolean hook |
| `src/components/shell/navLinks.ts` | **New** — primary nav link config + `isActive` helper |
| `src/components/shell/TopNav.tsx` | **New** — fixed cinematic top nav (wordmark, links, search, Activity, profile menu) |
| `src/components/shell/ProfileMenu.tsx` | **New** — avatar dropdown (Switch profile / Schedules / Downloads / Settings / Sign out) |
| `src/components/shell/BottomTabBar.tsx` | **New** — mobile bottom tab bar |
| `src/components/shell/ProfileGate.tsx` | **New** — "Who's watching?" gate (replaces `UserSelectScreen`) |
| `src/components/shell/PasscodePrompt.tsx` | **New** — FRÈ passcode keypad modal (replaces `PasscodeModal`) |
| `src/components/layout/AuthenticatedLayout.tsx` | **Rewrite** — wire ProfileGate + TopNav + BottomTabBar + atmosphere; keep streaming full-bleed |
| `src/app/movies/page.tsx` | **New** — minimal `/movies` hub stub so the Movies link resolves (Phase 3 replaces it) |
| `src/components/shell/*.test.tsx`, `src/lib/useScrolled.test.ts`, `src/context/ThemeContext.test.tsx` | **New** — tests |

> The legacy `src/components/ui/Navigation.tsx`, `ThemeToggle.tsx`, and `users/UserSelectScreen.tsx` / `PasscodeModal.tsx` are left on disk (no longer imported after this phase) and deleted in the final cleanup phase, to keep this phase's diff additive + reversible.

---

### Task 1: Dark-only `ThemeContext`

**Files:**
- Rewrite: `frontend/src/context/ThemeContext.tsx`
- Test: `frontend/src/context/ThemeContext.test.tsx`

**Interfaces:**
- Produces: `ThemeProvider` (component) and `useTheme(): { theme: 'dark'; setTheme: (t: 'dark') => Promise<void>; toggleTheme: () => Promise<void>; isThemeLoading: boolean }`. `theme` is always `'dark'`; `setTheme`/`toggleTheme` are no-ops; no localStorage.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/context/ThemeContext.test.tsx`:
```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ThemeProvider, useTheme } from './ThemeContext';

function Probe() {
  const { theme, isThemeLoading } = useTheme();
  return <span data-testid="t">{theme}:{String(isThemeLoading)}</span>;
}

describe('ThemeContext (dark-only)', () => {
  it('always reports dark and not loading', () => {
    render(<ThemeProvider><Probe /></ThemeProvider>);
    expect(screen.getByTestId('t')).toHaveTextContent('dark:false');
  });
  it('setTheme/toggleTheme are callable no-ops that keep dark', async () => {
    let captured = '';
    function Mutate() {
      const { theme, setTheme, toggleTheme } = useTheme();
      captured = theme;
      // calling them must not throw and must not change the reported theme
      void setTheme('dark');
      void toggleTheme();
      return <span data-testid="m">{theme}</span>;
    }
    render(<ThemeProvider><Mutate /></ThemeProvider>);
    expect(screen.getByTestId('m')).toHaveTextContent('dark');
    expect(captured).toBe('dark');
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `npm run test -- ThemeContext`
Expected: FAIL — the current `ThemeContext` exposes a mutable `'dark' | 'light'` theme; the no-op assertion and/or type won't hold. (If it imports cleanly but assertions differ, that's still RED.)

- [ ] **Step 3: Rewrite `frontend/src/context/ThemeContext.tsx`**

```tsx
'use client';
import React, { createContext, useContext } from 'react';

type Theme = 'dark';

interface ThemeContextType {
  theme: Theme;
  setTheme: (theme: Theme) => Promise<void>;
  toggleTheme: () => Promise<void>;
  isThemeLoading: boolean;
}

const noop = async (): Promise<void> => {};

const ThemeContext = createContext<ThemeContextType>({
  theme: 'dark',
  setTheme: noop,
  toggleTheme: noop,
  isThemeLoading: false,
});

/** Dark-only. FRÈ is an inherently dark identity; the toggle/persistence were
 *  retired. The `useTheme()` API is kept so existing consumers still compile. */
export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <ThemeContext.Provider value={{ theme: 'dark', setTheme: noop, toggleTheme: noop, isThemeLoading: false }}>
    {children}
  </ThemeContext.Provider>
);

export const useTheme = (): ThemeContextType => useContext(ThemeContext);
```

- [ ] **Step 4: Run test + typecheck — expect PASS**

Run: `npm run test -- ThemeContext` then `npx tsc --noEmit`
Expected: tests PASS; tsc clean. (Legacy `ThemeToggle`/settings-page `setTheme('light')` calls now type-error against the `'dark'` param. If tsc reports those, fix them in this step by changing those call sites to `setTheme('dark')` or removing the toggle usage — list any files you touch in the report.)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/context/ThemeContext.tsx frontend/src/context/ThemeContext.test.tsx
git commit -m "refactor(shell): pin ThemeContext to dark-only (retire light theme)"
```

---

### Task 2: `useScrolled` hook

**Files:**
- Create: `frontend/src/lib/useScrolled.ts`
- Test: `frontend/src/lib/useScrolled.test.ts`

**Interfaces:**
- Produces: `useScrolled(threshold = 60): boolean` — `true` once `window.scrollY > threshold`. SSR-safe (initial `false`).

- [ ] **Step 1: Write the failing test**

Create `frontend/src/lib/useScrolled.test.ts`:
```ts
import { describe, it, expect, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useScrolled } from './useScrolled';

afterEach(() => { window.scrollY = 0; });

describe('useScrolled', () => {
  it('starts false and flips true past the threshold on scroll', () => {
    const { result } = renderHook(() => useScrolled(60));
    expect(result.current).toBe(false);
    act(() => {
      Object.defineProperty(window, 'scrollY', { value: 100, configurable: true });
      window.dispatchEvent(new Event('scroll'));
    });
    expect(result.current).toBe(true);
  });

  it('stays false at or below the threshold', () => {
    const { result } = renderHook(() => useScrolled(60));
    act(() => {
      Object.defineProperty(window, 'scrollY', { value: 60, configurable: true });
      window.dispatchEvent(new Event('scroll'));
    });
    expect(result.current).toBe(false);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `npm run test -- useScrolled`
Expected: FAIL with "Failed to resolve import './useScrolled'".

- [ ] **Step 3: Implement `frontend/src/lib/useScrolled.ts`**

```ts
'use client';
import { useEffect, useState } from 'react';

/** True once the window has scrolled past `threshold` px. SSR-safe. */
export function useScrolled(threshold = 60): boolean {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > threshold);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [threshold]);
  return scrolled;
}
```

- [ ] **Step 4: Run test — expect PASS**

Run: `npm run test -- useScrolled`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/useScrolled.ts frontend/src/lib/useScrolled.test.ts
git commit -m "feat(shell): add useScrolled hook"
```

---

### Task 3: Nav link config

**Files:**
- Create: `frontend/src/components/shell/navLinks.ts`
- Test: `frontend/src/components/shell/navLinks.test.ts`

**Interfaces:**
- Produces: `NAV_LINKS: ReadonlyArray<{ href: string; label: string }>` (Home `/`, Movies `/movies`, Series `/tv`, Search `/search`); `isNavActive(href: string, pathname: string | null): boolean` — exact match for `/`, prefix match otherwise.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/shell/navLinks.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { NAV_LINKS, isNavActive } from './navLinks';

describe('navLinks', () => {
  it('lists the four primary links in order', () => {
    expect(NAV_LINKS.map(l => l.label)).toEqual(['Home', 'Movies', 'Series', 'Search']);
    expect(NAV_LINKS.map(l => l.href)).toEqual(['/', '/movies', '/tv', '/search']);
  });
  it('matches Home only exactly', () => {
    expect(isNavActive('/', '/')).toBe(true);
    expect(isNavActive('/', '/movies')).toBe(false);
  });
  it('matches non-home links by prefix (incl. detail routes)', () => {
    expect(isNavActive('/tv', '/tv')).toBe(true);
    expect(isNavActive('/tv', '/tv/123')).toBe(true);
    expect(isNavActive('/movies', '/movies/42')).toBe(true);
    expect(isNavActive('/search', '/tv')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `npm run test -- navLinks`
Expected: FAIL with unresolved import `./navLinks`.

- [ ] **Step 3: Implement `frontend/src/components/shell/navLinks.ts`**

```ts
export interface NavLink {
  href: string;
  label: string;
}

export const NAV_LINKS: ReadonlyArray<NavLink> = [
  { href: '/', label: 'Home' },
  { href: '/movies', label: 'Movies' },
  { href: '/tv', label: 'Series' },
  { href: '/search', label: 'Search' },
];

/** Active when pathname equals the link (Home) or is under it (everything else). */
export function isNavActive(href: string, pathname: string | null): boolean {
  if (!pathname) return false;
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(href + '/');
}
```

- [ ] **Step 4: Run test — expect PASS**

Run: `npm run test -- navLinks`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/shell/navLinks.ts frontend/src/components/shell/navLinks.test.ts
git commit -m "feat(shell): primary nav link config + isNavActive"
```

---

### Task 4: `ProfileMenu` (avatar dropdown)

**Files:**
- Create: `frontend/src/components/shell/ProfileMenu.tsx`
- Test: `frontend/src/components/shell/ProfileMenu.test.tsx`

**Interfaces:**
- Consumes: `useUser()` (`currentUser`, `logout`), `getInitials`/`handleAvatarError` from `@/utils/avatarHelper`, `cn`.
- Produces: `ProfileMenu` (default export, `'use client'`). Renders a `<button>` (the avatar trigger, `aria-haspopup="menu"`, `aria-expanded`) that toggles a `role="menu"` panel with links: Switch profile (`/`→ handled by logout), Schedules `/schedules`, Downloads `/downloads`, Settings `/settings`, and a "Sign out" `<button>` that calls `logout()`. Closes on outside click + Escape.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/shell/ProfileMenu.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const logout = vi.fn();
vi.mock('@/context/UserContext', () => ({
  useUser: () => ({ currentUser: { id: '1', username: 'ben', display_name: 'Ben', avatar: null, created_at: '' }, logout }),
}));

import ProfileMenu from './ProfileMenu';

describe('ProfileMenu', () => {
  it('toggles the menu and shows the power-tool links + sign out', async () => {
    render(<ProfileMenu />);
    const trigger = screen.getByRole('button', { name: /ben/i });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Schedules' })).toHaveAttribute('href', '/schedules');
    expect(screen.getByRole('menuitem', { name: 'Downloads' })).toHaveAttribute('href', '/downloads');
    expect(screen.getByRole('menuitem', { name: 'Settings' })).toHaveAttribute('href', '/settings');
  });
  it('calls logout on Sign out', async () => {
    render(<ProfileMenu />);
    await userEvent.click(screen.getByRole('button', { name: /ben/i }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Sign out' }));
    expect(logout).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `npm run test -- ProfileMenu`
Expected: FAIL with unresolved import `./ProfileMenu`.

- [ ] **Step 3: Implement `frontend/src/components/shell/ProfileMenu.tsx`**

```tsx
'use client';
import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useUser } from '@/context/UserContext';
import { getInitials, handleAvatarError } from '@/utils/avatarHelper';
import { cn } from '@/lib/cn';

const ITEMS = [
  { href: '/schedules', label: 'Schedules' },
  { href: '/downloads', label: 'Downloads' },
  { href: '/settings', label: 'Settings' },
];

const ProfileMenu: React.FC = () => {
  const { currentUser, logout } = useUser();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const name = currentUser?.display_name ?? 'Profile';

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(v => !v)}
        className={cn(
          'grid h-9 w-9 place-items-center rounded-full border border-hairline bg-surface-2',
          'font-ui text-sm font-semibold text-text overflow-hidden',
          'focus:outline-none focus-visible:shadow-[0_0_0_2px_var(--color-ink),0_0_0_4px_var(--color-gold)]',
        )}
      >
        {currentUser?.avatar
          ? <img src={currentUser.avatar} alt={name} onError={handleAvatarError} className="h-full w-full object-cover" />
          : <span aria-hidden="true">{getInitials(name)}</span>}
        <span className="sr-only">{name}</span>
      </button>

      {open && (
        <div role="menu" className="absolute right-0 mt-2 w-52 rounded-xl border border-hairline bg-surface/95 p-1.5 shadow-[0_20px_60px_rgba(0,0,0,0.6)] backdrop-blur">
          <p className="px-3 pt-1.5 pb-2 font-ui text-xs uppercase tracking-[0.22em] text-muted">{name}</p>
          {ITEMS.map(item => (
            <Link key={item.href} role="menuitem" href={item.href} onClick={() => setOpen(false)}
              className="block rounded-lg px-3 py-2 font-ui text-sm text-text hover:bg-surface-2 focus:outline-none focus-visible:bg-surface-2">
              {item.label}
            </Link>
          ))}
          <button role="menuitem" type="button" onClick={() => { setOpen(false); logout(); }}
            className="mt-1 block w-full rounded-lg px-3 py-2 text-left font-ui text-sm text-danger hover:bg-danger/10 focus:outline-none focus-visible:bg-danger/10">
            Sign out
          </button>
        </div>
      )}
    </div>
  );
};

export default ProfileMenu;
```

- [ ] **Step 4: Run test — expect PASS**

Run: `npm run test -- ProfileMenu`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/shell/ProfileMenu.tsx frontend/src/components/shell/ProfileMenu.test.tsx
git commit -m "feat(shell): ProfileMenu avatar dropdown (power tools + sign out)"
```

---

### Task 5: `TopNav`

**Files:**
- Create: `frontend/src/components/shell/TopNav.tsx`
- Test: `frontend/src/components/shell/TopNav.test.tsx`

**Interfaces:**
- Consumes: `Wordmark`, `NAV_LINKS`/`isNavActive`, `useScrolled`, `ProfileMenu`, `Ring` (from `@/components/ui/fre`), `usePathname` (next/navigation), `cn`.
- Produces: `TopNav` (default export, `'use client'`). Renders `<header class="ff-topnav">` (fixed, full-bleed) with the wordmark (link to `/`), the four primary links (active one marked `aria-current="page"`), a search link (`/search`), an Activity indicator (a `Ring` + count, link to `/downloads`), and `<ProfileMenu />`. Applies `is-scrolled` styling when `useScrolled()` is true.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/shell/TopNav.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('next/navigation', () => ({ usePathname: () => '/tv' }));
vi.mock('@/lib/useScrolled', () => ({ useScrolled: () => false }));
vi.mock('@/context/UserContext', () => ({
  useUser: () => ({ currentUser: { id: '1', display_name: 'Ben', avatar: null }, logout: vi.fn() }),
}));

import TopNav from './TopNav';

describe('TopNav', () => {
  it('renders the four primary links and marks the active one', () => {
    render(<TopNav />);
    for (const label of ['Home', 'Movies', 'Series', 'Search']) {
      expect(screen.getByRole('link', { name: label })).toBeInTheDocument();
    }
    // pathname is /tv → Series is active
    expect(screen.getByRole('link', { name: 'Series' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Home' })).not.toHaveAttribute('aria-current');
  });
  it('renders the FRÈ wordmark and a profile trigger', () => {
    render(<TopNav />);
    expect(screen.getByText('FRÈ')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /ben/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `npm run test -- TopNav`
Expected: FAIL with unresolved import `./TopNav`.

- [ ] **Step 3: Implement `frontend/src/components/shell/TopNav.tsx`**

```tsx
'use client';
import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Wordmark } from '@/components/ui/Wordmark';
import { Ring } from '@/components/ui/fre';
import { useScrolled } from '@/lib/useScrolled';
import { NAV_LINKS, isNavActive } from './navLinks';
import ProfileMenu from './ProfileMenu';
import { cn } from '@/lib/cn';

const TopNav: React.FC = () => {
  const pathname = usePathname();
  const scrolled = useScrolled(60);

  return (
    <header
      className={cn(
        'ff-topnav fixed inset-x-0 top-0 z-50 flex items-center gap-8 px-[clamp(20px,4vw,56px)] h-[72px]',
        'transition-[background-color,backdrop-filter,border-color] duration-300 border-b',
        scrolled
          ? 'bg-ink/95 backdrop-blur-md saturate-150 border-hairline'
          : 'bg-gradient-to-b from-ink/70 to-transparent border-transparent backdrop-blur-sm',
      )}
    >
      <Link href="/" aria-label="FRÈ home" className="shrink-0">
        <Wordmark className="text-2xl ff-shine" />
      </Link>

      <nav className="ml-2 hidden items-center gap-7 md:flex">
        {NAV_LINKS.map(link => {
          const active = isNavActive(link.href, pathname);
          return (
            <Link
              key={link.href}
              href={link.href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'relative font-ui text-sm font-medium transition-colors py-1.5',
                'focus:outline-none focus-visible:shadow-[0_0_0_2px_var(--color-ink),0_0_0_4px_var(--color-gold)]',
                active ? 'text-text' : 'text-muted hover:text-text',
                active && 'after:absolute after:inset-x-0 after:-bottom-0.5 after:h-0.5 after:rounded-full after:bg-gradient-to-r after:from-gold after:to-gold-lite',
              )}
            >
              {link.label}
            </Link>
          );
        })}
      </nav>

      <div className="ml-auto flex items-center gap-3">
        <Link
          href="/downloads"
          aria-label="Activity"
          className="hidden items-center gap-2 rounded-full border border-hairline bg-surface-2/60 px-3 h-9 font-ui text-xs text-text sm:flex focus:outline-none focus-visible:shadow-[0_0_0_2px_var(--color-ink),0_0_0_4px_var(--color-gold)]"
        >
          <Ring value={64} />
          <span className="font-semibold text-gold-lite">1</span>
        </Link>
        <ProfileMenu />
      </div>
    </header>
  );
};

export default TopNav;
```

- [ ] **Step 4: Run test — expect PASS**

Run: `npm run test -- TopNav`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/shell/TopNav.tsx frontend/src/components/shell/TopNav.test.tsx
git commit -m "feat(shell): FRÈ sticky TopNav"
```

---

### Task 6: `BottomTabBar` (mobile)

**Files:**
- Create: `frontend/src/components/shell/BottomTabBar.tsx`
- Test: `frontend/src/components/shell/BottomTabBar.test.tsx`

**Interfaces:**
- Consumes: `NAV_LINKS`/`isNavActive`, `usePathname`, `cn`.
- Produces: `BottomTabBar` (default export, `'use client'`). A `<nav aria-label="Primary">` fixed to the bottom, visible only `md:hidden`, with the four primary links (icon + label), the active one marked `aria-current="page"`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/shell/BottomTabBar.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('next/navigation', () => ({ usePathname: () => '/' }));
import BottomTabBar from './BottomTabBar';

describe('BottomTabBar', () => {
  it('renders the four primary links with Home active', () => {
    render(<BottomTabBar />);
    for (const label of ['Home', 'Movies', 'Series', 'Search']) {
      expect(screen.getByRole('link', { name: new RegExp(label, 'i') })).toBeInTheDocument();
    }
    expect(screen.getByRole('link', { name: /home/i })).toHaveAttribute('aria-current', 'page');
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `npm run test -- BottomTabBar`
Expected: FAIL with unresolved import `./BottomTabBar`.

- [ ] **Step 3: Implement `frontend/src/components/shell/BottomTabBar.tsx`**

```tsx
'use client';
import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { HomeIcon, FilmIcon, TvIcon, MagnifyingGlassIcon } from '@heroicons/react/24/outline';
import { NAV_LINKS, isNavActive } from './navLinks';
import { cn } from '@/lib/cn';

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  '/': HomeIcon,
  '/movies': FilmIcon,
  '/tv': TvIcon,
  '/search': MagnifyingGlassIcon,
};

const BottomTabBar: React.FC = () => {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-50 flex h-16 items-stretch border-t border-hairline bg-ink/95 backdrop-blur-md md:hidden"
    >
      {NAV_LINKS.map(link => {
        const Icon = ICONS[link.href] ?? HomeIcon;
        const active = isNavActive(link.href, pathname);
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex flex-1 flex-col items-center justify-center gap-1 font-ui text-[11px]',
              'focus:outline-none focus-visible:bg-surface-2',
              active ? 'text-gold-lite' : 'text-muted',
            )}
          >
            <Icon className="h-5 w-5" />
            <span>{link.label}</span>
          </Link>
        );
      })}
    </nav>
  );
};

export default BottomTabBar;
```

- [ ] **Step 4: Run test — expect PASS**

Run: `npm run test -- BottomTabBar`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/shell/BottomTabBar.tsx frontend/src/components/shell/BottomTabBar.test.tsx
git commit -m "feat(shell): mobile BottomTabBar"
```

---

### Task 7: `PasscodePrompt`

**Files:**
- Create: `frontend/src/components/shell/PasscodePrompt.tsx`
- Test: `frontend/src/components/shell/PasscodePrompt.test.tsx`

**Interfaces:**
- Consumes: `Modal` from `@/components/ui/fre`, `cn`.
- Produces: `PasscodePrompt` (default export, `'use client'`) with props `{ open: boolean; profileName: string; expected: string; onClose: () => void; onSuccess: () => void }`. Renders the FRÈ `Modal` containing the profile name, 4 passcode dots reflecting entered length, a numeric keypad (1–9, 0, delete). When the entered code reaches `expected.length` and equals `expected`, calls `onSuccess`; if it reaches that length and is wrong, shows an error and resets the digits.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/shell/PasscodePrompt.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PasscodePrompt from './PasscodePrompt';

describe('PasscodePrompt', () => {
  it('calls onSuccess when the correct passcode is entered', async () => {
    const onSuccess = vi.fn();
    render(<PasscodePrompt open profileName="Ben" expected="1234" onClose={() => {}} onSuccess={onSuccess} />);
    for (const d of ['1', '2', '3', '4']) {
      await userEvent.click(screen.getByRole('button', { name: d }));
    }
    expect(onSuccess).toHaveBeenCalledOnce();
  });

  it('shows an error and does not succeed on a wrong passcode', async () => {
    const onSuccess = vi.fn();
    render(<PasscodePrompt open profileName="Ben" expected="1234" onClose={() => {}} onSuccess={onSuccess} />);
    for (const d of ['9', '9', '9', '9']) {
      await userEvent.click(screen.getByRole('button', { name: d }));
    }
    expect(onSuccess).not.toHaveBeenCalled();
    expect(screen.getByText(/incorrect/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `npm run test -- PasscodePrompt`
Expected: FAIL with unresolved import `./PasscodePrompt`.

- [ ] **Step 3: Implement `frontend/src/components/shell/PasscodePrompt.tsx`**

```tsx
'use client';
import React, { useState } from 'react';
import Modal from '@/components/ui/fre/Modal';
import { cn } from '@/lib/cn';

interface PasscodePromptProps {
  open: boolean;
  profileName: string;
  expected: string;
  onClose: () => void;
  onSuccess: () => void;
}

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'];

const PasscodePrompt: React.FC<PasscodePromptProps> = ({ open, profileName, expected, onClose, onSuccess }) => {
  const [entry, setEntry] = useState('');
  const [error, setError] = useState(false);
  const len = expected.length || 4;

  const reset = () => { setEntry(''); };

  const press = (k: string) => {
    if (k === '' ) return;
    if (k === 'del') { setError(false); setEntry(e => e.slice(0, -1)); return; }
    if (entry.length >= len) return;
    const next = entry + k;
    setError(false);
    setEntry(next);
    if (next.length === len) {
      if (next === expected) { onSuccess(); reset(); }
      else { setError(true); setEntry(''); }
    }
  };

  return (
    <Modal open={open} onClose={() => { reset(); setError(false); onClose(); }} label={`Enter passcode for ${profileName}`}>
      <div className="text-center">
        <h2 className="font-display text-2xl text-text">{profileName}</h2>
        <p className="mt-1 font-ui text-sm text-muted">Enter your passcode</p>

        <div className="mt-5 flex justify-center gap-3" aria-hidden="true">
          {Array.from({ length: len }).map((_, i) => (
            <span key={i} className={cn('h-3 w-3 rounded-full border', i < entry.length ? 'border-gold bg-gold' : 'border-hairline bg-transparent')} />
          ))}
        </div>

        {error && <p className="mt-3 font-ui text-sm text-danger">Incorrect passcode</p>}

        <div className="mx-auto mt-6 grid max-w-[240px] grid-cols-3 gap-3">
          {KEYS.map((k, i) =>
            k === '' ? <span key={i} /> : (
              <button
                key={i}
                type="button"
                aria-label={k === 'del' ? 'Delete' : k}
                onClick={() => press(k)}
                className={cn(
                  'grid h-14 place-items-center rounded-full border border-hairline bg-surface-2 font-ui text-lg text-text',
                  'transition-colors hover:border-gold/50 active:bg-gold/10',
                  'focus:outline-none focus-visible:shadow-[0_0_0_2px_var(--color-ink),0_0_0_4px_var(--color-gold)]',
                )}
              >
                {k === 'del' ? '⌫' : k}
              </button>
            ),
          )}
        </div>
      </div>
    </Modal>
  );
};

export default PasscodePrompt;
```

- [ ] **Step 4: Run test — expect PASS**

Run: `npm run test -- PasscodePrompt`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/shell/PasscodePrompt.tsx frontend/src/components/shell/PasscodePrompt.test.tsx
git commit -m "feat(shell): FRÈ PasscodePrompt keypad modal"
```

---

### Task 8: `ProfileGate` ("Who's watching?")

**Files:**
- Create: `frontend/src/components/shell/ProfileGate.tsx`
- Test: `frontend/src/components/shell/ProfileGate.test.tsx`

**Interfaces:**
- Consumes: `useUser()` (`users`, `selectUser`), `usersService.getUserSettings`, `PasscodePrompt`, `Wordmark`, `CinematicAtmosphere`, `getInitials`/`handleAvatarError`, `cn`.
- Produces: `ProfileGate` (default export, `'use client'`). Full-viewport "Who's watching?" with the FRÈ wordmark, atmosphere, and a tile per `users` entry (avatar + name) plus an "Add Profile" tile (links to `/users/[id]/settings`? — for this phase the Add tile renders but its action is a no-op placeholder marked TODO-Phase). On mount it fetches each user's settings to learn `require_passcode`/`passcode`; a passcode-protected tile shows a gold lock badge, and clicking it opens `PasscodePrompt` (success → `selectUser`); an unprotected tile calls `selectUser` directly.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/shell/ProfileGate.test.tsx`:
```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const selectUser = vi.fn().mockResolvedValue(true);
vi.mock('@/context/UserContext', () => ({
  useUser: () => ({
    users: [
      { id: '1', username: 'ben', display_name: 'Ben', avatar: null, created_at: '' },
      { id: '2', username: 'ava', display_name: 'Ava', avatar: null, created_at: '' },
    ],
    selectUser,
  }),
}));
vi.mock('@/services/users', () => ({
  usersService: {
    getUserSettings: vi.fn(async (id: string) =>
      id === '1'
        ? { require_passcode: true, passcode: '1234' }
        : { require_passcode: false }),
  },
}));

import ProfileGate from './ProfileGate';

beforeEach(() => selectUser.mockClear());

describe('ProfileGate', () => {
  it('selects an unprotected profile directly', async () => {
    render(<ProfileGate />);
    const ava = await screen.findByRole('button', { name: /ava/i });
    await userEvent.click(ava);
    await waitFor(() => expect(selectUser).toHaveBeenCalledWith('2'));
  });

  it('requires the passcode for a protected profile before selecting', async () => {
    render(<ProfileGate />);
    const ben = await screen.findByRole('button', { name: /ben/i });
    await userEvent.click(ben);
    // passcode prompt appears; selectUser not yet called
    expect(selectUser).not.toHaveBeenCalled();
    for (const d of ['1', '2', '3', '4']) {
      await userEvent.click(await screen.findByRole('button', { name: d }));
    }
    await waitFor(() => expect(selectUser).toHaveBeenCalledWith('1'));
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `npm run test -- ProfileGate`
Expected: FAIL with unresolved import `./ProfileGate`.

- [ ] **Step 3: Implement `frontend/src/components/shell/ProfileGate.tsx`**

```tsx
'use client';
import React, { useEffect, useState } from 'react';
import { useUser } from '@/context/UserContext';
import { usersService } from '@/services/users';
import { Wordmark } from '@/components/ui/Wordmark';
import CinematicAtmosphere from '@/components/fx/CinematicAtmosphere';
import PasscodePrompt from './PasscodePrompt';
import { getInitials, handleAvatarError } from '@/utils/avatarHelper';
import { cn } from '@/lib/cn';

interface Gate { required: boolean; code?: string; }

const ProfileGate: React.FC = () => {
  const { users, selectUser } = useUser();
  const [gates, setGates] = useState<Record<string, Gate>>({});
  const [prompt, setPrompt] = useState<{ id: string; name: string; code: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all(users.map(async u => {
      try {
        const s = await usersService.getUserSettings(u.id);
        return [u.id, { required: !!s.require_passcode, code: s.passcode }] as const;
      } catch {
        return [u.id, { required: false }] as const;
      }
    })).then(entries => { if (!cancelled) setGates(Object.fromEntries(entries)); });
    return () => { cancelled = true; };
  }, [users]);

  const enter = (id: string, name: string) => {
    const gate = gates[id];
    if (gate?.required && gate.code) { setPrompt({ id, name, code: gate.code }); return; }
    void selectUser(id);
  };

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center gap-12 bg-ink px-6 py-16 text-text">
      <CinematicAtmosphere />
      <div className="relative z-[2] flex flex-col items-center gap-8">
        <Wordmark className="text-3xl" />
        <h1 className="text-center font-display text-[clamp(2.5rem,7vw,5rem)] leading-[0.98] tracking-tight">
          Who&rsquo;s <em className="italic text-gold-lite">watching?</em>
        </h1>

        <div className="flex flex-wrap items-start justify-center gap-8">
          {users.map(u => (
            <button
              key={u.id}
              type="button"
              onClick={() => enter(u.id, u.display_name)}
              className="group flex flex-col items-center gap-3 focus:outline-none"
            >
              <span className={cn(
                'relative grid h-[clamp(110px,13vw,150px)] w-[clamp(110px,13vw,150px)] place-items-center overflow-hidden rounded-[22px]',
                'border border-hairline bg-surface-2 font-display text-3xl text-muted transition-transform duration-300',
                'group-hover:-translate-y-2 group-hover:border-gold group-focus-visible:border-gold',
                'group-focus-visible:shadow-[0_0_0_2px_var(--color-ink),0_0_0_4px_var(--color-gold)]',
              )}>
                {u.avatar
                  ? <img src={u.avatar} alt="" onError={handleAvatarError} className="h-full w-full object-cover" />
                  : <span aria-hidden="true">{getInitials(u.display_name)}</span>}
                {gates[u.id]?.required && (
                  <span aria-hidden="true" className="absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-full border border-gold/55 bg-ink/70 text-gold">🔒</span>
                )}
              </span>
              <span className="font-ui text-sm tracking-wide text-muted transition-colors group-hover:text-text">{u.display_name}</span>
            </button>
          ))}
        </div>
      </div>

      {prompt && (
        <PasscodePrompt
          open
          profileName={prompt.name}
          expected={prompt.code}
          onClose={() => setPrompt(null)}
          onSuccess={() => { const id = prompt.id; setPrompt(null); void selectUser(id); }}
        />
      )}
    </div>
  );
};

export default ProfileGate;
```

- [ ] **Step 4: Run test — expect PASS**

Run: `npm run test -- ProfileGate`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/shell/ProfileGate.tsx frontend/src/components/shell/ProfileGate.test.tsx
git commit -m "feat(shell): FRÈ ProfileGate (Who's watching) with passcode gating"
```

---

### Task 9: Wire `AuthenticatedLayout` + `/movies` stub

**Files:**
- Rewrite: `frontend/src/components/layout/AuthenticatedLayout.tsx`
- Create: `frontend/src/app/movies/page.tsx`
- Test: `frontend/src/components/layout/AuthenticatedLayout.test.tsx`

**Interfaces:**
- Consumes: `useUser()` (`currentUser`, `isLoading`), `usePathname`, `ProfileGate`, `TopNav`, `BottomTabBar`, `CinematicAtmosphere`.
- Produces: `AuthenticatedLayout` (default export). Renders: loading spinner while `isLoading`; `<ProfileGate />` when `!currentUser`; for `/streaming/*` a full-bleed `<main>` with NO nav/atmosphere; otherwise `<TopNav />` + `<CinematicAtmosphere />` + `<main className="min-h-screen">{children}</main>` + `<BottomTabBar />`. The `/movies` page renders a minimal hub placeholder (Phase 3 replaces it).

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/layout/AuthenticatedLayout.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('next/navigation', () => ({ usePathname: () => '/' }));
vi.mock('@/components/shell/TopNav', () => ({ default: () => <header data-testid="topnav" /> }));
vi.mock('@/components/shell/BottomTabBar', () => ({ default: () => <nav data-testid="tabbar" /> }));
vi.mock('@/components/shell/ProfileGate', () => ({ default: () => <div data-testid="gate" /> }));
vi.mock('@/components/fx/CinematicAtmosphere', () => ({ default: () => <div data-testid="atmo" /> }));

const useUserMock = vi.fn();
vi.mock('@/context/UserContext', () => ({ useUser: () => useUserMock() }));

import AuthenticatedLayout from './AuthenticatedLayout';

describe('AuthenticatedLayout', () => {
  it('shows the ProfileGate when no profile is active', () => {
    useUserMock.mockReturnValue({ currentUser: null, isLoading: false });
    render(<AuthenticatedLayout><p>child</p></AuthenticatedLayout>);
    expect(screen.getByTestId('gate')).toBeInTheDocument();
    expect(screen.queryByTestId('topnav')).toBeNull();
  });

  it('shows TopNav + children + tab bar when a profile is active', () => {
    useUserMock.mockReturnValue({ currentUser: { id: '1', display_name: 'Ben' }, isLoading: false });
    render(<AuthenticatedLayout><p>child</p></AuthenticatedLayout>);
    expect(screen.getByTestId('topnav')).toBeInTheDocument();
    expect(screen.getByTestId('tabbar')).toBeInTheDocument();
    expect(screen.getByText('child')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `npm run test -- AuthenticatedLayout`
Expected: FAIL (the current layout renders `UserSelectScreen`/`Navigation`, not the mocked shell components — the `gate`/`topnav` testids won't be found).

- [ ] **Step 3: Rewrite `frontend/src/components/layout/AuthenticatedLayout.tsx`**

```tsx
'use client';
import React from 'react';
import { usePathname } from 'next/navigation';
import { useUser } from '@/context/UserContext';
import TopNav from '@/components/shell/TopNav';
import BottomTabBar from '@/components/shell/BottomTabBar';
import ProfileGate from '@/components/shell/ProfileGate';
import CinematicAtmosphere from '@/components/fx/CinematicAtmosphere';

interface AuthenticatedLayoutProps { children: React.ReactNode; }

const AuthenticatedLayout: React.FC<AuthenticatedLayoutProps> = ({ children }) => {
  const { currentUser, isLoading } = useUser();
  const pathname = usePathname();
  const isStreaming = pathname?.startsWith('/streaming');

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-ink">
        <div className="h-12 w-12 animate-spin rounded-full border-4 border-hairline border-t-gold" />
      </div>
    );
  }

  if (!currentUser) return <ProfileGate />;

  // Player route: full-bleed, no chrome.
  if (isStreaming) {
    return <main className="h-screen w-screen bg-ink">{children}</main>;
  }

  return (
    <>
      <CinematicAtmosphere />
      <TopNav />
      <main className="relative z-[2] min-h-screen pb-16 md:pb-0">{children}</main>
      <BottomTabBar />
    </>
  );
};

export default AuthenticatedLayout;
```

- [ ] **Step 4: Create the `/movies` hub stub `frontend/src/app/movies/page.tsx`**

```tsx
export default function MoviesHubPage() {
  return (
    <div className="px-[clamp(20px,4vw,56px)] pt-28">
      <h1 className="font-display text-4xl text-text">Movies</h1>
      <p className="mt-3 font-ui text-muted">The Movies hub arrives in the next phase.</p>
    </div>
  );
}
```

- [ ] **Step 5: Run test — expect PASS**

Run: `npm run test -- AuthenticatedLayout`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/layout/AuthenticatedLayout.tsx frontend/src/components/layout/AuthenticatedLayout.test.tsx frontend/src/app/movies/page.tsx
git commit -m "feat(shell): wire ProfileGate + TopNav + BottomTabBar into AuthenticatedLayout; /movies hub stub"
```

---

### Task 10: Phase 2 gate — full verification

**Files:** none (verification only).

- [ ] **Step 1: Full suite** — Run: `npm run test` · Expected: all tests pass (Phase 1 + the new shell tests).
- [ ] **Step 2: Typecheck** — Run: `npx tsc --noEmit` · Expected: no errors. (If a legacy file that imported the old `Navigation`/`ThemeToggle`/`UserSelectScreen` now type-errors because those still exist but reference the changed ThemeContext, resolve it minimally — those components are unused after Task 9 but must still compile; if a legacy component calls `setTheme('light')`, change it to `setTheme('dark')`.)
- [ ] **Step 3: Build** — Run: `npm run build` · Expected: build succeeds; `/movies` now builds as a static route; `/`, `/tv`, `/search`, `/streaming/[id]` still build.
- [ ] **Step 4: Tag** — `git tag fre-phase2-shell`

---

## Self-Review

**1. Spec coverage (spec §10.2 "App shell + nav + profile gate — sticky top nav, mobile tab bar, profile select + passcode, route wiring, dark-only cleanup"):**
- Sticky top nav → Task 5 (+ `useScrolled` Task 2, links Task 3) ✓ · Mobile tab bar → Task 6 ✓ · Profile select → Task 8 ✓ · Passcode → Task 7 ✓ · Route wiring → Task 9 (AuthenticatedLayout + `/movies` stub) ✓ · Dark-only cleanup → Task 1 ✓ · Profile menu holding Schedules/Downloads/Settings → Task 4 ✓.
- Deferred (documented): deleting legacy `Navigation`/`ThemeToggle`/`UserSelectScreen`/`PasscodeModal` and the `.light` CSS block → final cleanup phase (kept compiling, just unused). The settings-page theme `<Select>` removal → Phase 7 (Settings); pinned ThemeContext makes it a harmless no-op meanwhile. "Add Profile" full flow + per-profile management → later (the tile renders; wiring its create-flow is out of this phase's scope and noted as a placeholder).

**2. Placeholder scan:** Every code step contains complete code; every run step names the command + expected result. The only intentional placeholder is the `/movies` hub stub and the Add-Profile tile, both explicitly scoped to later phases (not vague "TODO" work inside a task).

**3. Type consistency:** `useUser()` fields used (`currentUser`, `users`, `isLoading`, `selectUser`, `logout`) match the mapped `UserContext` API. `usersService.getUserSettings(id) → UserSettings` (with `require_passcode`/`passcode`) matches the service. `NAV_LINKS`/`isNavActive` signatures match between Task 3 and their consumers (Tasks 5, 6). `PasscodePrompt` props (`open`/`profileName`/`expected`/`onClose`/`onSuccess`) match between Task 7 and its consumer (Task 8). `Modal` (`open`/`onClose`/`label`), `Ring` (`value`), `Wordmark` (`className`), `CinematicAtmosphere` are used exactly as exported in Phase 1.

> Implementer note: a few tests mock `@/context/UserContext`, `next/navigation`, `@/services/users`, and the shell children — these mocks define the contract; if a real signature differs from a mock, fix the component to the REAL signature and update the mock to match.

---

## Execution Handoff

This is **Phase 2 of 8**, on branch `feat/fre-frontend-redesign`. Execute with **superpowers:subagent-driven-development** (the choice carried over from Phase 1). Remaining phases (Browse system; Search; Detail pages; Player; Utility surfaces; Backend additions) get their own plans next.
