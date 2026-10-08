# TV stage 4 — focus manager, rails, cards, home Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the television surface a D-pad-navigable home screen — a hand-rolled focus manager, rails, cards, a hero, and a profile gate — so the TV is usable from a remote instead of only from the Magic Remote's pointer.

**Architecture:** A pure focus model (rows × columns, no React) under a thin `useFocusGrid` hook that owns one `window` keydown listener, moves real DOM focus, and calls `scrollIntoView`. TV-local components live under `(bigscreen)/_components/` and import nothing above `@/services`. Home fetches progressively — hero and the first rail paint before the remaining rails are requested — and never polls activity.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, vitest + @testing-library/react, hand-authored plain CSS in `frontend/public/bigscreen.css`.

**Spec:** `docs/superpowers/specs/2026-09-22-webos-tv-app-design.md` — stage 4 in §14, rules in §8 (navigation & focus), budget in §9, route tree in §5.1.

## Global Constraints

- **No `@/components` import anywhere under `(bigscreen)`.** `legacy-target.test.ts` bans any specifier starting `@/components`, and any relative specifier containing both `..` and `components/`. TV-local components go in `(bigscreen)/_components/` and are imported `./`-relatively.
- **Never import `@/lib/buildMixedRailsScreen`, `@/lib/buildRailsScreen`, or `@/lib/cn`.** The first two import `RowConfig` from `@/components/browse/BrowseScreen` on line 2, which transitively pulls `PosterCard` and `tailwind-merge` into the TV bundle while keeping the guard green. `@/lib/cn` is `clsx` + `extendTailwindMerge`. Copy the types you need instead.
- **The strings `framer-motion` and `globals.css` may not appear in any non-test file under `(bigscreen)`** — not in code, not in a comment. The guard is a raw substring check with no comment stripping and no opt-out.
- **Banned CSS substrings** (raw `includes`, case-sensitive, checked in every non-test file under `(bigscreen)` *and* in `bigscreen.css`): `backdrop-filter`, `backdrop-blur`, `mix-blend`, `background-blend`, `filter: blur(`, `filter:blur(`, `feTurbulence`, `feGaussianBlur`, `filter: url(`, `filter:url(`, `filter="url(`. In `bigscreen.css` only, CSS comments are stripped before the check; in `.tsx` files they are not.
- **Do not add a second `@allow-legacy-probes` marker.** Test 5 pins the opted-out set to exactly `['bigscreen/diag/page.tsx']`.
- **Do not add a token to `bigscreen.css`'s `:root` that shadows a web token under a different name** without updating `bigscreen-tokens.test.ts`. The ten colours are byte-pinned to `(web)/globals.css`.
- **Layout contract (§8.5):** a 1920×1080 CSS-pixel design space. Safe area is `--safe-x: 96px` / `--safe-y: 54px`; no interactive element or text outside it. Body text ≥24px, titles 40–56px, focus targets ≥60px tall.
- **`html, body { overflow: hidden }`** — nothing scrolls the document. A new scrolling surface provides its own container.
- **Existing tokens, use them, do not redefine:** `--ink #0A0A0B`, `--surface #111113`, `--surface-2 #16161A`, `--text #F4F1EA`, `--muted #8C8884`, `--hairline #26242A`, `--gold #C9A86A`, `--gold-lite #E7D6AE`, `--danger #E5564B`, `--success #7BDCA0`, `--font-display`, `--font-ui`, `--safe-x`, `--safe-y`, `--radius 12px`, `--focus-ring 4px` (a *width*, used as `outline: var(--focus-ring) solid var(--gold)`).
- **Class naming:** `bs-` prefix, BEM-ish `--` modifiers, `:focus` never `:focus-visible`, hard-coded px.
- **Commits:** Conventional Commits. End every commit message with `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.
- **Verification for every task:** from `frontend/`: `npx vitest run`, `npm run test:tv`, `npx tsc --noEmit`. Baselines at branch start: **87 files / 933 tests**, `test:tv` **25/25**, tsc clean.

## Review Focus

1. **A rail that is still loading, or that loaded empty, must not trap focus.** Every browse call in this codebase is `.catch(() => emptyPage)` and the web silently drops zero-item rows, so empty rails are normal, not exceptional. Vertical movement must skip rows with no focusable items, and a down-press on the last populated row must not strand the viewer on a skeleton. Pinned in Task 1.
2. **Nothing may be focused when the grid is empty, and something must be focused the moment it is not.** On a remote there is no way to recover from "no element has focus" — there is no Tab and no pointer. Pinned in Task 1 and Task 5.
3. **The Back key's code is unverified.** Only `461` is recorded in the repo and it is explicitly an assumption; the on-TV key log was never transcribed. Back must be recognised across every plausible spelling, and an unrecognised key must never be swallowed. Pinned in Task 7.
4. **A profile-scoped call before a profile is selected returns 403/404/423, not data.** `/watchlist/{user_id}` and `/streaming/progress/{user_id}` both run `require_profile`; a passcode-locked profile answers **423**. Continue Watching and My List must degrade to absent, never to an error screen or an infinite spinner. Pinned in Task 6.
5. **`progress.movie_id` carries the `content_id`, not `progress.content_id`.** The ORM has both columns but the API response exposes only `movie_id`, so `.content_id` is `undefined` on every row the client sees. A card keyed off the wrong field renders nothing. Pinned in Task 4.

---

## Task 1: The focus model and the `useFocusGrid` hook

**Files:**
- Create: `frontend/src/app/(bigscreen)/_focus/model.ts`
- Create: `frontend/src/app/(bigscreen)/_focus/model.test.ts`
- Create: `frontend/src/app/(bigscreen)/_focus/useFocusGrid.ts`
- Create: `frontend/src/app/(bigscreen)/_focus/useFocusGrid.test.tsx`

**Interfaces:**
- Produces: everything below is consumed by Tasks 3, 5, 6 and 7.

```ts
// model.ts — pure, no React, no DOM
export interface FocusTarget { row: number; col: number }
export type Direction = 'up' | 'down' | 'left' | 'right';

/** rowCounts[i] is the number of focusable items in row i. 0 means "not focusable yet". */
export type RowCounts = readonly number[];

export const NO_TARGET: FocusTarget = { row: -1, col: -1 };

export function isEmptyGrid(rowCounts: RowCounts): boolean;
export function firstTarget(rowCounts: RowCounts): FocusTarget;
export function clampTarget(rowCounts: RowCounts, t: FocusTarget): FocusTarget;
export function move(
  rowCounts: RowCounts,
  from: FocusTarget,
  dir: Direction,
  columnMemory: readonly number[],
): FocusTarget;
```

Semantics, exactly:
- `isEmptyGrid` — true when every entry is `0` (or the array is empty).
- `firstTarget` — the first row with a non-zero count, column 0. `NO_TARGET` for an empty grid.
- `clampTarget` — if the row is out of bounds or has 0 items, returns `firstTarget`. Otherwise clamps `col` into `[0, count-1]`.
- `move` — horizontal moves stay in the row and **do not wrap**; at either end the target is unchanged. Vertical moves **skip every row whose count is 0** and do not wrap; if no populated row exists in that direction the target is unchanged. On a vertical move the landing column is `columnMemory[targetRow]` clamped into the target row, falling back to `0` when there is no memory for it.

- [ ] **Step 1: Write the failing model tests**

```ts
import { describe, it, expect } from 'vitest';
import { move, clampTarget, firstTarget, isEmptyGrid, NO_TARGET } from './model';

describe('focus model', () => {
  it('reports an empty grid and refuses to invent a target', () => {
    expect(isEmptyGrid([])).toBe(true);
    expect(isEmptyGrid([0, 0, 0])).toBe(true);
    expect(isEmptyGrid([0, 2])).toBe(false);
    expect(firstTarget([0, 0])).toEqual(NO_TARGET);
  });

  it('starts on the first row that actually has items', () => {
    // A rail that has not loaded yet has a count of 0. Landing on it would put focus
    // on a skeleton with nothing to focus, which on a remote is unrecoverable.
    expect(firstTarget([0, 0, 5])).toEqual({ row: 2, col: 0 });
  });

  it('does not wrap horizontally', () => {
    expect(move([3], { row: 0, col: 2 }, 'right', [])).toEqual({ row: 0, col: 2 });
    expect(move([3], { row: 0, col: 0 }, 'left', [])).toEqual({ row: 0, col: 0 });
    expect(move([3], { row: 0, col: 1 }, 'right', [])).toEqual({ row: 0, col: 2 });
  });

  it('does not wrap vertically', () => {
    expect(move([2, 2], { row: 1, col: 0 }, 'down', [])).toEqual({ row: 1, col: 0 });
    expect(move([2, 2], { row: 0, col: 0 }, 'up', [])).toEqual({ row: 0, col: 0 });
  });

  it('skips rows that have no focusable items', () => {
    // REVIEW FOCUS 1: an unloaded or empty rail must not trap focus.
    expect(move([2, 0, 0, 3], { row: 0, col: 1 }, 'down', [])).toEqual({ row: 3, col: 1 });
    expect(move([2, 0, 0, 3], { row: 3, col: 0 }, 'up', [])).toEqual({ row: 0, col: 0 });
  });

  it('stays put when every row below is empty', () => {
    expect(move([2, 0, 0], { row: 0, col: 0 }, 'down', [])).toEqual({ row: 0, col: 0 });
  });

  it('restores each row remembered column on a vertical move', () => {
    const memory = [0, 7];
    expect(move([3, 9], { row: 0, col: 1 }, 'down', memory)).toEqual({ row: 1, col: 7 });
  });

  it('clamps a remembered column that no longer fits', () => {
    // A rail can shrink between visits (a watchlist row loses an item).
    const memory = [0, 7];
    expect(move([3, 2], { row: 0, col: 1 }, 'down', memory)).toEqual({ row: 1, col: 1 });
  });

  it('clamps a target that points at a vanished row', () => {
    expect(clampTarget([2], { row: 4, col: 0 })).toEqual({ row: 0, col: 0 });
    expect(clampTarget([2, 0], { row: 1, col: 0 })).toEqual({ row: 0, col: 0 });
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `cd frontend && npx vitest run "src/app/(bigscreen)/_focus/model.test.ts"`
Expected: FAIL — cannot resolve `./model`.

- [ ] **Step 3: Implement `model.ts`**

Pure functions, no imports. Keep each one short and name the reasoning in comments where it is not obvious (the skip-empty-rows rule, the clamp-on-shrink rule).

- [ ] **Step 4: Run them and watch them pass**

Run: `cd frontend && npx vitest run "src/app/(bigscreen)/_focus/model.test.ts"`
Expected: PASS, 9 tests.

- [ ] **Step 5: Write the failing hook tests**

`useFocusGrid.test.tsx`. Render a small harness component that uses the hook over a fixed grid of buttons and assert on `document.activeElement`. Cover exactly these:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { useFocusGrid } from './useFocusGrid';

function Harness({ rowCounts, storageKey }: { rowCounts: number[]; storageKey?: string }) {
  const grid = useFocusGrid({ rowCounts, storageKey });
  return (
    <div>
      {rowCounts.map((count, row) => (
        <div key={row} data-testid={`row-${row}`}>
          {Array.from({ length: count }, (_, col) => (
            <button key={col} {...grid.focusProps(row, col)}>{`${row}-${col}`}</button>
          ))}
        </div>
      ))}
    </div>
  );
}

function press(key: string, keyCode?: number) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, keyCode, bubbles: true, cancelable: true }));
  });
}

describe('useFocusGrid', () => {
  beforeEach(() => {
    sessionStorage.clear();
    // jsdom does not implement scrollIntoView.
    Element.prototype.scrollIntoView = vi.fn();
  });

  it('focuses something on mount', () => {
    // REVIEW FOCUS 2: with no Tab key and no pointer, "nothing is focused" is unrecoverable.
    render(<Harness rowCounts={[3, 3]} />);
    expect(document.activeElement).toBe(screen.getByText('0-0'));
  });

  it('focuses nothing while the grid is empty, then focuses the moment it fills', () => {
    const { rerender } = render(<Harness rowCounts={[0]} />);
    expect(document.activeElement).toBe(document.body);
    rerender(<Harness rowCounts={[2]} />);
    expect(document.activeElement).toBe(screen.getByText('0-0'));
  });

  it('moves with the arrow keys', () => {
    render(<Harness rowCounts={[3, 3]} />);
    press('ArrowRight');
    expect(document.activeElement).toBe(screen.getByText('0-1'));
    press('ArrowDown');
    expect(document.activeElement).toBe(screen.getByText('1-1'));
    press('ArrowLeft');
    expect(document.activeElement).toBe(screen.getByText('1-0'));
    press('ArrowUp');
    expect(document.activeElement).toBe(screen.getByText('0-0'));
  });

  it('moves on the numeric key codes a webOS remote sends', () => {
    // The TV may deliver keyCode without a usable `key`.
    render(<Harness rowCounts={[3]} />);
    press('Unidentified', 39);
    expect(document.activeElement).toBe(screen.getByText('0-1'));
  });

  it('carries exactly one focusable element per cell, roving the tabindex', () => {
    render(<Harness rowCounts={[2]} />);
    expect(screen.getByText('0-0')).toHaveAttribute('tabindex', '0');
    expect(screen.getByText('0-1')).toHaveAttribute('tabindex', '-1');
    press('ArrowRight');
    expect(screen.getByText('0-0')).toHaveAttribute('tabindex', '-1');
    expect(screen.getByText('0-1')).toHaveAttribute('tabindex', '0');
  });

  it('calls scrollIntoView with the TV arguments on every focus change', () => {
    render(<Harness rowCounts={[3]} />);
    (Element.prototype.scrollIntoView as ReturnType<typeof vi.fn>).mockClear();
    press('ArrowRight');
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', inline: 'center' });
  });

  it('does not preventDefault a key it does not handle', () => {
    // REVIEW FOCUS 3: swallowing keys indiscriminately is how Back stops working.
    render(<Harness rowCounts={[2]} />);
    const e = new KeyboardEvent('keydown', { key: 'p', bubbles: true, cancelable: true });
    act(() => { window.dispatchEvent(e); });
    expect(e.defaultPrevented).toBe(false);
  });

  it('restores the remembered position for its storage key', () => {
    const first = render(<Harness rowCounts={[3, 3]} storageKey="home" />);
    press('ArrowRight');
    press('ArrowDown');
    expect(document.activeElement).toBe(screen.getByText('1-1'));
    first.unmount();
    render(<Harness rowCounts={[3, 3]} storageKey="home" />);
    expect(document.activeElement).toBe(screen.getByText('1-1'));
  });

  it('survives a storage key that cannot be read', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    expect(() => render(<Harness rowCounts={[2]} storageKey="home" />)).not.toThrow();
    expect(document.activeElement).toBe(screen.getByText('0-0'));
    spy.mockRestore();
  });
});
```

- [ ] **Step 6: Run them and watch them fail**

Run: `cd frontend && npx vitest run "src/app/(bigscreen)/_focus/useFocusGrid.test.tsx"`
Expected: FAIL — cannot resolve `./useFocusGrid`.

- [ ] **Step 7: Implement `useFocusGrid.ts`**

```ts
'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { type Direction, type FocusTarget, type RowCounts, NO_TARGET, clampTarget, firstTarget, isEmptyGrid, move } from './model';

export interface FocusProps {
  tabIndex: 0 | -1;
  ref: (el: HTMLElement | null) => void;
  onFocus: () => void;
}

export interface FocusGrid {
  focused: FocusTarget;
  isFocused: (row: number, col: number) => boolean;
  focusProps: (row: number, col: number) => FocusProps;
  setFocus: (t: FocusTarget) => void;
}

export function useFocusGrid(opts: { rowCounts: RowCounts; storageKey?: string }): FocusGrid;
```

Requirements:
- One `window` `keydown` listener. Resolve the direction from **both** `event.key` and the legacy numeric `event.keyCode` (`37` left, `38` up, `39` right, `40` down). `preventDefault()` **only** when a direction was resolved, so Task 7's Back handler and anything else still see their keys.
- Hold the element registry in a ref keyed `` `${row}:${col}` ``; the `ref` callback registers and deregisters.
- Column memory is a `useRef<number[]>`; write `memory[row] = col` on every settled focus change.
- After the focused target changes, `el.focus()` then `el.scrollIntoView({ block: 'nearest', inline: 'center' })`. Guard both — jsdom lacks `scrollIntoView` in some environments and a TV can hand back a detached node.
- `onFocus` from a real DOM focus event (the Magic Remote pointer can focus a cell directly) syncs the model to that cell without re-focusing it.
- When `isEmptyGrid(rowCounts)`, the focused target is `NO_TARGET` and nothing is focused. When the grid becomes non-empty, focus the restored target if it still fits, else `firstTarget`.
- `storageKey`, when given, persists `{row, col}` to `sessionStorage` under `` `bs-focus:${storageKey}` ``. Every read and write is wrapped in try/catch — a TV in a private-ish mode can throw on access, and a thrown read must not take the screen down.

- [ ] **Step 8: Run the whole focus suite**

Run: `cd frontend && npx vitest run "src/app/(bigscreen)/_focus"`
Expected: PASS, 19 tests across two files.

- [ ] **Step 9: Run the guards**

Run: `cd frontend && npm run test:tv && npx tsc --noEmit`
Expected: `test:tv` passes with its count raised by the new tests; tsc clean.

- [ ] **Step 10: Commit**

```bash
git add "frontend/src/app/(bigscreen)/_focus"
git commit -m "feat(tv): a roving-tabindex focus model for the D-pad

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: The television component vocabulary in `bigscreen.css`

**Files:**
- Modify: `frontend/public/bigscreen.css` (append only; do not restructure the existing 210 lines)

**Interfaces:**
- Produces: the class names Tasks 3, 5 and 6 use verbatim. Nothing else in this task.

Append one block per group, each preceded by a comment saying what it is for. Every class below is new — the file today has no rail, card, hero, grid, keypad, skeleton or badge class.

**The app shell** (home and every later screen sit in this):
- `.bs-shell` — `height: 100%; display: flex; flex-direction: column; overflow: hidden;`
- `.bs-shell__scroll` — the vertical scroll container: `flex: 1; overflow-y: auto; scroll-behavior: smooth; padding: 0 0 var(--safe-y);`. Note `html, body` are `overflow: hidden`, so this is the only thing that scrolls on these screens.
- `.bs-shell__head` — `padding: var(--safe-y) var(--safe-x) 0; display: flex; align-items: baseline; gap: 24px;`

**The hero** (static — §9 forbids the web's 40s Ken-Burns transform):
- `.bs-hero` — `position: relative; height: 620px; padding: var(--safe-y) var(--safe-x); display: flex; flex-direction: column; justify-content: flex-end;`
- `.bs-hero__art` — `position: absolute; inset: 0; background-size: cover; background-position: center top;`. The image goes in an inline `style={{ backgroundImage }}`.
- `.bs-hero__scrim` — a solid/gradient scrim only, never a blur: `position: absolute; inset: 0; background: linear-gradient(to top, var(--ink) 0%, rgba(10,10,11,0.72) 45%, rgba(10,10,11,0.15) 100%);`
- `.bs-hero__body` — `position: relative; max-width: 1100px;`
- `.bs-hero__title` — `font-family: var(--font-display); font-size: 56px; font-weight: 600; margin: 0 0 12px;`
- `.bs-hero__meta` — `font-size: 24px; color: var(--muted); margin: 0 0 16px; display: flex; gap: 16px;`
- `.bs-hero__overview` — `font-size: 24px; line-height: 1.45; margin: 0 0 24px; max-width: 900px;` plus a 3-line clamp using `display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden;`

**Rails:**
- `.bs-rail` — `margin: 0 0 48px;`
- `.bs-rail__head` — `padding: 0 var(--safe-x); margin: 0 0 16px;`
- `.bs-rail__title` — `font-family: var(--font-display); font-size: 40px; font-weight: 600; margin: 0;`
- `.bs-rail__eyebrow` — `font-size: 20px; letter-spacing: 2px; text-transform: uppercase; color: var(--muted); margin: 0 0 4px;`
- `.bs-rail__track` — `display: flex; gap: 24px; overflow-x: auto; padding: 8px var(--safe-x) 24px; scroll-behavior: smooth;` plus `scrollbar-width: none;` and a `.bs-rail__track::-webkit-scrollbar { display: none; }` rule — a TV shows no scrollbar.
  The horizontal padding equal to the safe inset is what lets the **first** card sit inside the safe area while `scrollIntoView({ inline: 'center' })` can still centre it.
- `.bs-rail--empty` — `display: none;` (a rail that resolved to zero items is removed from the layout entirely, matching the web's behaviour of dropping empty rows)

**Cards** — exactly one focusable element per card, so the focus ring belongs on the card itself:
- `.bs-card` — `flex: 0 0 auto; display: block; border: 0; padding: 0; background: transparent; color: var(--text); font-family: var(--font-ui); text-align: left; text-decoration: none; cursor: pointer; border-radius: var(--radius); transition: transform 180ms cubic-bezier(0.4,0,0.2,1);`
- `.bs-card:focus` — `outline: var(--focus-ring) solid var(--gold); outline-offset: 4px; transform: scale(1.06);` Precede it with a comment repeating the file's existing standing rule: the focus ring is the whole navigation model on a remote, never remove it.
- `.bs-card__art` — `display: block; width: 100%; background: var(--surface-2); border-radius: var(--radius); object-fit: cover;`
- `.bs-card--poster` — `width: 240px;` and `.bs-card--poster .bs-card__art { height: 360px; }` (2:3)
- `.bs-card--wide` — `width: 428px;` and `.bs-card--wide .bs-card__art { height: 241px; }` (16:9)
- `.bs-card__fallback` — the text title-card shown when there is no artwork: `display: flex; align-items: center; justify-content: center; padding: 16px; font-family: var(--font-display); font-size: 28px; text-align: center; color: var(--gold-lite); border: 1px solid var(--hairline);`
- `.bs-card__label` — `margin: 12px 0 0; font-size: 22px; line-height: 1.3;` with the same 2-line clamp pattern as the hero overview
- `.bs-card__sub` — `margin: 4px 0 0; font-size: 20px; color: var(--muted);`
- `.bs-card__bar` — the resume progress bar: `margin: 8px 0 0; height: 6px; background: var(--hairline); border-radius: 3px; overflow: hidden;`
- `.bs-card__bar span` — `display: block; height: 100%; background: var(--gold);` with the percentage in an inline `style={{ width }}`
- `.bs-card__badge` — `display: inline-block; margin: 0 0 0 8px; padding: 2px 10px; font-size: 18px; border-radius: 999px; background: var(--surface-2); color: var(--gold-lite);`

**Skeletons** (a rail that has not loaded yet occupies its final height so the layout does not jump):
- `.bs-skel` — `background: var(--surface-2); border-radius: var(--radius);`
- `.bs-skel--poster` — `flex: 0 0 auto; width: 240px; height: 360px;`
- `.bs-skel--wide` — `flex: 0 0 auto; width: 428px; height: 241px;`
- No shimmer animation. §9 allows transform/opacity only, and a looping animation on a TV costs frames for nothing.

**The profile grid and keypad** (Task 6):
- `.bs-profiles` — `display: flex; flex-wrap: wrap; gap: 48px; padding: 0 var(--safe-x);`
- `.bs-profile` — `flex: 0 0 auto; width: 240px; border: 0; padding: 0; background: transparent; color: var(--text); font-family: var(--font-ui); cursor: pointer; border-radius: var(--radius); transition: transform 180ms cubic-bezier(0.4,0,0.2,1);`
- `.bs-profile:focus` — same ring as `.bs-card:focus`
- `.bs-profile__face` — `width: 240px; height: 240px; border-radius: var(--radius); background: var(--surface-2); display: flex; align-items: center; justify-content: center; font-family: var(--font-display); font-size: 72px; color: var(--gold-lite); overflow: hidden;`
- `.bs-profile__face img` — `width: 100%; height: 100%; object-fit: cover;`
- `.bs-profile__name` — `margin: 16px 0 0; font-size: 28px; text-align: center;`
- `.bs-keypad` — `display: grid; grid-template-columns: repeat(3, 120px); gap: 16px; margin: 32px 0;`
- `.bs-key` — `min-height: 96px; font-size: 40px; font-family: var(--font-ui); color: var(--text); background: var(--surface-2); border: 1px solid var(--hairline); border-radius: var(--radius); cursor: pointer;`
- `.bs-key:focus` — `outline: var(--focus-ring) solid var(--gold); outline-offset: 2px;`
- `.bs-dots` — `display: flex; gap: 16px; margin: 24px 0;`
- `.bs-dot` — `width: 24px; height: 24px; border-radius: 50%; border: 2px solid var(--gold); }` and `.bs-dot--on { background: var(--gold); }`

**A row of status text** used by several screens:
- `.bs-note` — `padding: 0 var(--safe-x); font-size: 24px; color: var(--muted);`

- [ ] **Step 1: Append the CSS**

Append the blocks above to `frontend/public/bigscreen.css`. Do not touch the existing `:root`, element rules or any existing class.

- [ ] **Step 2: Verify the guards still pass**

Run: `cd frontend && npm run test:tv`
Expected: PASS. In particular the GPU-budget test must stay green — note `-webkit-line-clamp` and `-webkit-box` are **not** on the banned list, and the scrim is a gradient, not a blur.

- [ ] **Step 3: Verify no token drifted**

The token test compares ten colours against `(web)/globals.css`. You added no `:root` entry, so it must still pass unchanged.

- [ ] **Step 4: Commit**

```bash
git add frontend/public/bigscreen.css
git commit -m "feat(tv): rail, card, hero, keypad and skeleton styles

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: `Card` and `Rail`

**Files:**
- Create: `frontend/src/app/(bigscreen)/_components/Card.tsx`
- Create: `frontend/src/app/(bigscreen)/_components/Card.test.tsx`
- Create: `frontend/src/app/(bigscreen)/_components/Rail.tsx`
- Create: `frontend/src/app/(bigscreen)/_components/Rail.test.tsx`

**Interfaces:**
- Consumes: `FocusProps` from `../_focus/useFocusGrid`.
- Produces:

```tsx
// Card.tsx
export interface CardItem {
  /** Stable key and focus identity. */
  id: string;
  /** Where OK navigates. A bigscreen route, never a (web) route. */
  href: string;
  title: string;
  /** Second line — a year, an episode label, whatever the rail wants. */
  subtitle?: string | null;
  /** Absolute URL already; the services layer returns absolute image URLs. */
  artUrl?: string | null;
  /** 0-100. Draws the resume bar when > 0. */
  progressPct?: number;
  /** Short pill, e.g. 'Up next'. */
  badge?: string | null;
}

export function Card(props: {
  item: CardItem;
  shape: 'poster' | 'wide';
  focusProps: FocusProps;
}): JSX.Element;

// Rail.tsx
export interface RailModel {
  key: string;
  title: string;
  eyebrow?: string | null;
  shape: 'poster' | 'wide';
  items: CardItem[];
  /** True while the rail's data is in flight; renders skeletons and contributes 0 focusable items. */
  loading?: boolean;
}

export function Rail(props: {
  rail: RailModel;
  row: number;
  focusPropsFor: (row: number, col: number) => FocusProps;
}): JSX.Element | null;
```

Rules the implementation must honour:
- **One focusable element per card.** The card is a single `next/link` `<Link>` rendering one `<a className="bs-card">` that receives `focusProps` (its `tabIndex`, `ref` and `onFocus`). There is no Play button, no My List button and no separate Info link on a TV card — the web's `PosterCard` has four focus stops pointing at three identical hrefs, and that is exactly what makes a 20-item rail ~80 D-pad presses. Play and My List live on the detail screen (stage 6).
- `next/link` is permitted by the guard (`next/*`). Use it so the TV gets prefetch; a television's network is the slow part.
- **No hover-dependent behaviour.** The Magic Remote fires real mouse events, which makes hover UI half-work — a trap. Everything reachable must be reachable by focus.
- **Use `<p>` for `.bs-card__label`, not a heading.** `bigscreen.css` styles `h1`/`h2`/`h3` as
  **global element rules**, so an `<h3 class="bs-card__label">` silently inherits gold-lite
  colour and weight 600. Likewise put `.bs-card__badge` inside `.bs-card__sub`, never inside
  `.bs-card__label`: the label is a `-webkit-box` with vertical orientation, which lays its
  children out as block-level boxes and would drop the badge onto its own line.
- Artwork: an `<img>` with `loading="lazy"` and `onError` swapping to the `.bs-card__fallback` text title-card. The services layer already returns absolute URLs, so there is no URL helper to call.
- `Rail` returns `null` when `items.length === 0 && !loading` — an empty rail is removed, matching the web.
- While `loading`, render three skeletons of the matching shape and **no focusable element**.
- The track element gets the `.bs-rail__track` class and nothing else; horizontal scrolling is driven entirely by `scrollIntoView` from the focus hook, never by a wheel or drag handler.

- [ ] **Step 1: Write the failing Card tests**

Cover: renders exactly one focusable element (assert `container.querySelectorAll('[tabindex]')` has length 1); the href is on that element; the title renders; a `progressPct` of 0 draws no bar while 42 draws one at `width: 42%`; a missing `artUrl` renders the fallback instead of an `<img>`; an `<img>` that fires `onError` swaps to the fallback; a `badge` renders when present and is absent otherwise; `focusProps.tabIndex` reaches the DOM.

- [ ] **Step 2: Run them and watch them fail**
- [ ] **Step 3: Implement `Card.tsx`**
- [ ] **Step 4: Run them and watch them pass**

- [ ] **Step 5: Write the failing Rail tests**

Cover: a loading rail renders skeletons and zero `[tabindex]` elements; a rail with items renders one `[tabindex]` per item; a rail with no items and not loading renders `null`; the title and eyebrow render; `focusPropsFor` is called with the rail's own `row` and each column index (assert the exact call arguments).

- [ ] **Step 6: Run, implement, run**

- [ ] **Step 7: Guards**

Run: `cd frontend && npm run test:tv && npx tsc --noEmit`

- [ ] **Step 8: Commit**

```bash
git add "frontend/src/app/(bigscreen)/_components"
git commit -m "feat(tv): one-focus-stop cards and rails

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: The TV rail lineup and its data layer

**Files:**
- Create: `frontend/src/app/(bigscreen)/_data/rails.ts`
- Create: `frontend/src/app/(bigscreen)/_data/rails.test.ts`
- Create: `frontend/src/app/(bigscreen)/_data/continueWatching.ts`
- Create: `frontend/src/app/(bigscreen)/_data/continueWatching.test.ts`

**Interfaces:**
- Consumes: `BrowseParams` and `CatalogItem` from `@/types`; `moviesService.browse`, `tvService.browse` from `@/services/movies` and `@/services/tv`; `streamingService.getRecentProgress` from `@/services/streaming`; `watchlistService.list` from `@/services/watchlist`; `parseContentId` and `tmdbIdFromContentId` from `@/lib/contentId`; `CardItem` and `RailModel` from `../_components/Card` / `../_components/Rail`.
- Produces:

```ts
// rails.ts
export interface TvRailSpec {
  key: string;
  title: string;
  eyebrow?: string;
  shape: 'poster' | 'wide';
  /** Browse params for the movie half. Omit to skip movies. */
  movieParams?: BrowseParams;
  /** Browse params for the tv half. Omit to skip shows. */
  tvParams?: BrowseParams;
}

/** The lineup, in render order. A copy, deliberately — see the note below. */
export const TV_RAILS: readonly TvRailSpec[];

/** Interleave the two halves into cards and cap the rail. */
export function toRail(spec: TvRailSpec, movies: CatalogItem[], shows: CatalogItem[]): RailModel;

/** One rail's two calls, each already failure-tolerant. */
export function fetchRail(spec: TvRailSpec): Promise<RailModel>;

export function catalogItemToCard(item: CatalogItem, shape: 'poster' | 'wide'): CardItem;
```

`TV_RAILS` is a **copy** of the web's lineup, not an import. `@/lib/buildMixedRailsScreen` imports `RowConfig` from `@/components/browse/BrowseScreen`, which transitively drags `PosterCard` and `tailwind-merge` into the TV bundle while leaving the import guard green. Copy the five fields above and nothing else; in particular drop the web's `feed` field, which drives per-rail `RailBackdrop`/`FeedMotif` theming built from SVG filters and blend modes that §9 bans here.

The lineup, with the exact genre ids — **note the ids differ by media type**, and reusing one id for both halves silently returns the wrong genre:

| key | title | eyebrow | shape | movieParams | tvParams |
| --- | --- | --- | --- | --- | --- |
| `trending` | `Trending This Week` | — | poster | `{ api: 'popular' }` | `{ api: 'popular' }` |
| `top-rated` | `Top Rated` | `Critically acclaimed` | poster | `{ api: 'top_rated' }` | `{ api: 'top_rated' }` |
| `new` | `New Releases` | — | poster | `{ api: 'popular', sort: 'primary_release_date.desc' }` | `{ api: 'popular', sort: 'primary_release_date.desc' }` |
| `genre-action` | `Action & Adventure` | `Genre` | poster | `{ genres: '28' }` | `{ genres: '10759' }` |
| `genre-drama` | `Drama` | `Genre` | poster | `{ genres: '18' }` | `{ genres: '18' }` |
| `genre-comedy` | `Comedy` | `Genre` | poster | `{ genres: '35' }` | `{ genres: '35' }` |
| `genre-scifi` | `Sci-Fi & Fantasy` | `Genre` | poster | `{ genres: '878' }` | `{ genres: '10765' }` |

Only `api` values legal for **both** endpoints may appear in a mixed rail: `popular` and `top_rated` are the safe pair. `now_playing`/`upcoming` are movies-only and `on_the_air`/`airing_today` are tv-only — each endpoint validates `api` with its own regex, so a wrong value is a request error, not a silent empty.

`fetchRail` behaviour:
- Issue the movie and show calls concurrently with `Promise.all`.
- **Each call is individually failure-tolerant**: `.catch(() => ({ page: 1, results: [], total_pages: 0, total_results: 0 }))`. One dead half must still render the other half; the whole rail going empty is then handled by `Rail` returning `null`.
- `toRail` interleaves movie[0], show[0], movie[1], show[1], … and caps the result at **20 cards**. A longer rail is just more D-pad presses to cross.

`catalogItemToCard`:
- `id` = `` `${item.media_type}:${item.tmdb_id}` ``
- `href` = `` `/bigscreen/movie/${item.tmdb_id}` `` for a movie, `` `/bigscreen/show/${item.tmdb_id}` `` for a show. Those routes arrive in stage 6; a card that navigates to a not-yet-existing route is correct now and complete then.
- `title` = `item.title` (`CatalogItem` always has `title`, even for shows — it is `ShowDetail` that uses `name`)
- `subtitle` = `item.year ? String(item.year) : null`
- `artUrl` = `shape === 'wide' ? item.backdrop_url : item.poster_url` — both are absolute URLs already, or `null`

```ts
// continueWatching.ts
export interface ContinueWatchingDeps {
  userId: string;
}
/** Resolves to an empty rail — never throws — when no profile is selected or the call is refused. */
export function fetchContinueWatching(deps: ContinueWatchingDeps): Promise<RailModel>;
export function fetchMyList(deps: ContinueWatchingDeps): Promise<RailModel>;
```

`fetchContinueWatching` rules, each of which the web gets right and which a naive rewrite gets wrong:
- Call `streamingService.getRecentProgress(userId, 24)`.
- **The `content_id` is `progress.movie_id`, not `progress.content_id`.** The ORM table has both columns but the API response model exposes only `movie_id`, so reading `.content_id` yields `undefined` on every row. Parse `movie_id` with `parseContentId`.
- **Drop rows whose `torrent_id` is null** — the FK is `ON DELETE SET NULL`, so a removed torrent leaves a progress row that can never resume.
- **Drop completed movies**; a finished film does not belong in "pick up where you left off".
- **Dedupe shows to one card per show id**, keeping the most recently watched.
- `href` = `` `/bigscreen/watch/${torrent_id}` `` plus `?file={file_index}` when `file_index` is set. Build that path here; do **not** call `resumeUrlFor`, which returns the `(web)` route `/streaming/{id}` and would navigate the TV out of its own root layout.
- `progressPct` = `Math.round(progress.percentage)`.
- Shape is `wide` (16:9) — this is the one rail where the artwork is a backdrop.
- A completed **episode** becomes an "Up next" card for `episode + 1` with the `badge: 'Up next'`. The web does this **without checking that the next episode exists** and leaves `resumeUrl` pointing at the finished episode's file; do not copy that. Here: only emit an Up-next card when the show's season data is already in hand, and otherwise omit the row rather than offer a card that resumes the episode the viewer just finished. Keeping it simple is the right call — a missing card is invisible, a card that replays the last episode is a bug the viewer blames on the app.

`fetchMyList` rules:
- Call `watchlistService.list(userId)`.
- Shape is `poster`; `artUrl` = `item.poster_url` (often present) — do **not** try to build a 16:9 card, because `watchlistItemToCatalogItem` always nulls `backdrop_url` and a wide My List card would be artless without an extra detail fetch per item.
- `tmdb_id` on `WatchlistItem` is a **string**; `Number()` it for the href.
- `href` from `media_type`: `/bigscreen/movie/{id}` or `/bigscreen/show/{id}`.

**Both functions must resolve, never reject, on a refusal.** `/watchlist/{user_id}` and `/streaming/progress/{user_id}` run `require_profile`, which answers **403** for someone else's profile, **404** for an unknown one and **423** for a passcode-locked one. Catch everything and resolve to `{ ...spec, items: [] }` so Home renders without those rails instead of showing an error screen.

- [ ] **Step 1: Write the failing `rails.test.ts`**

Mock `@/services/movies` and `@/services/tv` with `vi.mock`. Cover: `TV_RAILS` has 7 entries and the action and sci-fi rails carry **different** ids for their two halves (assert `movieParams.genres === '28'` and `tvParams.genres === '10759'`); `toRail` interleaves and caps at 20; `catalogItemToCard` picks `poster_url` for a poster shape and `backdrop_url` for a wide one; `fetchRail` resolves with the shows half intact when the movies call rejects; `fetchRail` resolves with `items: []` when both reject.

- [ ] **Step 2: Run, implement, run**

- [ ] **Step 3: Write the failing `continueWatching.test.ts`**

Mock `@/services/streaming` and `@/services/watchlist`. Cover, with one test each:
- it reads the content id from `movie_id` (give a row with `movie_id: 'tv:1399:s1:e1'` and a decoy `content_id: 'movie:999'`, and assert the card is the show)
- it drops a row whose `torrent_id` is null
- it drops a completed movie
- it keeps one card per show
- the href is a `/bigscreen/watch/...` path carrying `?file=` when `file_index` is set, and is **not** a `/streaming/...` path
- `progressPct` is rounded
- a 423 rejection resolves to an empty rail and does not throw (`REVIEW FOCUS 4`)
- `fetchMyList` turns the string `tmdb_id` into a numeric href and resolves empty on a 403

- [ ] **Step 4: Run, implement, run**

- [ ] **Step 5: Guards, then commit**

```bash
git add "frontend/src/app/(bigscreen)/_data"
git commit -m "feat(tv): the television rail lineup and its failure-tolerant data layer

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: The profile gate — "Who's watching?" and the passcode keypad

**Files:**
- Create: `frontend/src/app/(bigscreen)/_data/useTvProfile.ts`
- Create: `frontend/src/app/(bigscreen)/_data/useTvProfile.test.tsx`
- Create: `frontend/src/app/(bigscreen)/bigscreen/profiles/page.tsx`
- Create: `frontend/src/app/(bigscreen)/bigscreen/profiles/page.test.tsx`

**Why this is in stage 4, and why it comes before home.** Home shows Continue Watching and My List, and both of those endpoints are `{user_id}`-path-scoped and guarded by `require_profile`. Without a selected profile they answer 403/404/423, so the home screen cannot show either rail until a profile exists. The web solves this with `UserContext` in `(web)/layout.tsx`, which this surface cannot import from, so the TV needs its own — and home imports it, which is why this task lands first.

**Interfaces:**
- Consumes: `usersService.getUsers`, `usersService.getUserSettings`, `usersService.unlockProfile` from `@/services/users`; `resolveAvatarSrc` and `getInitials` from `@/lib/avatars/resolve`; `useFocusGrid`.
- Produces:

```ts
// useTvProfile.ts
export interface TvProfile {
  id: string;
  display_name: string;
  avatar: string | null;
}

export interface TvProfileState {
  /** null until a profile is chosen and unlocked. */
  profile: TvProfile | null;
  loading: boolean;
  select: (p: TvProfile) => void;
  clear: () => void;
}

export function useTvProfile(): TvProfileState;
```

Rules:
- The chosen profile id persists in `localStorage` under `bs-profile`. **`localStorage`, not `sessionStorage`** — a television app restarts whenever the viewer leaves and comes back, and re-asking "who's watching?" every single time is the wrong default for a device in a living room.
- Every `localStorage` read and write is wrapped in try/catch; a throw must leave `profile: null` and `loading: false`, not take the screen down.
- On mount, if a stored id exists, resolve it against `usersService.getUsers()`. If that id is no longer in the list (the profile was deleted on another device), clear the stored value and fall back to `null`.
- `useTvProfile` does **not** verify the passcode. The unlock is recorded server-side against the session row, so the only honest check is whether a profile-scoped call succeeds. The profiles screen performs the unlock; the hook only remembers the choice.

**The profiles screen** (`/bigscreen/profiles`):
1. `usersService.getUsers()` — already scoped to the signed-in account, so it needs no argument.
2. Render one `.bs-profile` per profile in a `.bs-profiles` grid: the avatar via `resolveAvatarSrc(profile.avatar)` inside `.bs-profile__face`, falling back to `getInitials(display_name)` as a monogram when it returns `null` (which it does for anything that is not a known `house:` id or a `cached:` hash). One focusable element per profile.
3. On OK: fetch `usersService.getUserSettings(profile.id)`. If `has_passcode` is false, `select(profile)` and navigate to `/bigscreen`. If it is true, show the keypad.
4. The keypad is a 3×4 `.bs-keypad` grid of digits 0–9 plus a delete key, modelled on the web's existing 3×3 `PasscodePrompt` (already remote-friendly). Draw `passcode_len` dots in `.bs-dots`, filling them as digits are entered. Submit automatically once the entered length equals `passcode_len` — a remote has no comfortable Enter-after-typing affordance and the length is known.
5. On a complete entry call `usersService.unlockProfile(profile.id, code)`. On success `select(profile)` and navigate. On failure (**423 or 403 both mean a wrong code**) clear the dots and show "That code was not right" — and keep focus on the keypad rather than bouncing back to the grid, because a remote user who mistyped wants to retype, not restart.
6. The keypad and the profile grid each get their own `useFocusGrid`; only one is mounted at a time, so only one `window` listener is ever installed. This is not a style preference: the listener is on `window` and whichever grid registered **first** claims an arrow, so two live grids would leave the *incoming* one inert during an overlapping mount.
7. **Mount this screen in `.bs-shell` + `.bs-shell__scroll`, not in `.bs-page`.** `.bs-profiles`, `.bs-keypad`, `.bs-dots` and `.bs-note` each carry their own `padding: 0 var(--safe-x)`, so nesting them inside `.bs-page` (itself inset) would double the inset to 192px. `html, body` cannot scroll, so the screen needs a scroller around it either way.
8. For the wrong-code message use `.bs-no` (the danger colour), not `.bs-note` (muted).
7. There is no "add a profile" affordance on the TV. Creating a profile needs text entry and the web surface already does it well; the next stage's search keyboard is the first place text entry is worth building.

- [ ] **Step 1: Write the failing `useTvProfile` tests**

Cover: returns `null` with no stored id; restores a stored id that still exists in `getUsers()`; clears a stored id that no longer exists; `select` persists and `clear` removes; a throwing `localStorage` leaves `profile: null` and does not throw; `loading` is true until `getUsers()` settles.

- [ ] **Step 2: Run, implement, run**

- [ ] **Step 3: Write the failing profiles-page tests**

Mock `@/services/users` and `next/navigation`'s `useRouter`. Cover:
- renders one focusable element per profile
- a profile with no passcode selects immediately and navigates to `/bigscreen`
- a profile with a passcode shows the keypad and draws exactly `passcode_len` dots
- entering `passcode_len` digits submits automatically, with the digits in the order pressed
- a rejected unlock (**reject with a 423-shaped error**) clears the dots, shows the retry copy, and does **not** navigate
- a rejected unlock keeps the keypad mounted (assert a key is still in the document)
- the avatar falls back to a monogram when `resolveAvatarSrc` returns null

- [ ] **Step 4: Run, implement, run**

- [ ] **Step 5: Guards, build, commit**

```bash
git add "frontend/src/app/(bigscreen)/_data" "frontend/src/app/(bigscreen)/bigscreen/profiles"
git commit -m "feat(tv): who's watching, with a D-pad passcode keypad

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: The home screen

**Files:**
- Create: `frontend/src/app/(bigscreen)/_components/Hero.tsx`
- Create: `frontend/src/app/(bigscreen)/_components/Hero.test.tsx`
- Modify: `frontend/src/app/(bigscreen)/bigscreen/page.tsx` (today a 16-line "you're signed in" placeholder — replace it wholesale)
- Modify: `frontend/src/app/(bigscreen)/bigscreen/page.test.tsx` (the placeholder's tests go with it)

**Interfaces:**
- Consumes: `useFocusGrid`, `Rail`, `Card`, `Hero`, `TV_RAILS`, `fetchRail`, `fetchContinueWatching`, `fetchMyList`, and the profile hook from Task 5 (`useTvProfile`).
- Produces: nothing other tasks consume.

```tsx
export function Hero(props: {
  item: CatalogItem | null;
  /** Rendered as the hero's single focusable element when present. */
  focusProps?: FocusProps;
  href?: string;
}): JSX.Element | null;

/** Upgrade a TMDB image URL to a larger rendition. Returns the input unchanged
 *  when it is not a recognisable TMDB sized path. */
export function atSize(url: string | null | undefined, size: 'w1920'): string | null;
```

**The hero artwork must be upgraded client-side.** §9 requires `w1920`/`original` for the hero
instead of the `w1280` the catalog returns — a `w1280` backdrop is roughly a 3× upscale on a 4K
panel. **`w1920` only, never `original`**: an original TMDB backdrop can be 3840×2160, roughly
33MB decoded in a television's very finite memory, and the hero is displayed in a 1920-wide box
regardless. The services layer hands back fully-formed absolute URLs, so there is no size parameter to
pass; `atSize` rewrites the `/t/p/{size}/` segment of a TMDB URL with a regex and returns anything
unrecognised untouched. Test it with a real TMDB-shaped URL, with a non-TMDB URL, and with `null`.

**The loading strategy, which is the point of this task.** The web's `buildMixedRailsScreen` fires 16 catalog calls in two sequential waves and `HomeBrowse` renders a skeleton until *both* waves settle — there is no progressive paint to inherit, so this must be restructured rather than called. §9 also requires off-screen rails not to render until near-visible. Do this:

1. On mount, fetch **only** the first rail (`trending`). Paint the hero from `results[0]` and that rail as soon as it resolves. This is the first thing the viewer sees and it costs two requests, not sixteen.
2. Mount every remaining rail as a `loading` placeholder of its final height, in order.
3. Observe the placeholders with a single `IntersectionObserver` (`rootMargin: '600px 0px'`) on the scroll container and fetch a rail the first time it approaches the viewport. Each rail fetches **once**; keep a `Set` of started keys.
4. Fetch Continue Watching and My List **only when a profile is selected**, and splice them in at positions 1 and 2 (after `trending`). Without a profile they are simply absent — the backend would refuse them anyway.
5. **No activity poll.** The web runs a 15s `/activity/count` poll forever; §9 removes it from the TV. Do not add it.
6. `IntersectionObserver` may be missing in a test environment and could plausibly be missing on an old TV browser. Feature-detect it, and when it is absent fetch every rail immediately — degrading to the web's eager behaviour is correct, while crashing is not.

**Focus wiring.** `rowCounts` is derived from the rendered rails: `[heroFocusable ? 1 : 0, ...rails.map(r => r.loading ? 0 : r.items.length)]`. It changes as rails resolve, which is exactly the case Task 1's model handles — a row with 0 items is skipped by vertical movement, and the first populated row takes focus on mount. Pass `storageKey: 'home'` so returning from a detail screen lands where the viewer left.

- [ ] **Step 1: Write the failing Hero tests**

Cover: `atSize` rewrites a TMDB `w1280` URL to `w1920`, leaves a non-TMDB URL alone and maps `null` to `null`; renders `null` for a null item; renders the title, the year and a 3-line-clamped overview; puts the **upgraded** backdrop on an inline `backgroundImage`; renders exactly one focusable element when `focusProps` is given and none when it is not.

- [ ] **Step 2: Run, implement, run**

- [ ] **Step 3: Write the failing home-page tests**

Mock `../_data/rails`, `../_data/continueWatching` and the profile hook. Cover:
- it fetches **only the first rail** on mount (assert `fetchRail` was called exactly once, with the `trending` spec) — this is the progressive-paint guarantee and nothing else pins it
- the hero renders from the first rail's first item
- something is focused once the first rail resolves (`REVIEW FOCUS 2`)
- the remaining rails render as skeletons with no focusable elements until observed
- when `IntersectionObserver` is undefined, every rail is fetched
- with no profile selected, neither `fetchContinueWatching` nor `fetchMyList` is called
- with a profile selected, both are called and their rails are spliced in after `trending`
- no timer polls anything: advance fake timers 60s after load and assert no further service calls (`REVIEW FOCUS` — the TV must not inherit the activity poll)

- [ ] **Step 4: Run, implement, run**

- [ ] **Step 5: Verify the build still lists the route**

Run: `cd frontend && npx tsc --noEmit && npm run build`
Expected: `/bigscreen` still in the route table; every pre-existing route unchanged.

- [ ] **Step 6: Commit**

```bash
git add "frontend/src/app/(bigscreen)/_components" "frontend/src/app/(bigscreen)/bigscreen/page.tsx" "frontend/src/app/(bigscreen)/bigscreen/page.test.tsx"
git commit -m "feat(tv): the home screen, with progressive rails and no activity poll

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Back-key handling, and a guard against transitive web imports

**Files:**
- Create: `frontend/src/app/(bigscreen)/_focus/useBackKey.ts`
- Create: `frontend/src/app/(bigscreen)/_focus/useBackKey.test.tsx`
- Modify: `frontend/src/app/(bigscreen)/bigscreen/page.tsx` (wire Back)
- Modify: `frontend/src/app/(bigscreen)/bigscreen/profiles/page.tsx` (wire Back)
- Modify: `frontend/src/app/(bigscreen)/legacy-target.test.ts` (the new transitive check)

**Interfaces:**
- Produces:

```ts
export const BACK_KEYS: readonly string[];
export const BACK_KEY_CODES: readonly number[];
/** Calls `onBack` for any recognised Back key. Installs one window listener. */
export function useBackKey(onBack: () => void): void;
```

**The Back key's identity is not known.** The repo records only `461`, and records it explicitly as an unverified assumption — the on-TV key log at `/bigscreen/diag` ran, but the values were never transcribed. So recognise every plausible spelling rather than betting on one:

```ts
export const BACK_KEYS = ['Backspace', 'Escape', 'XF86Back', 'BrowserBack', 'GoBack', 'Back'] as const;
export const BACK_KEY_CODES = [461, 8, 27, 166] as const;
```

- `461` is webOS's documented Back; `8` is Backspace, which many TV browsers send instead; `27` is Escape, which the diag page's own key log would show; `166` is `VK_BROWSER_BACK`.
- **Only `preventDefault()` when a Back key was recognised**, and never claim a key outside these lists. Task 1's hook has the same rule for arrows. Between them the surface must never swallow a key it does not act on — that is precisely how a Back button stops working on a device nobody can attach a debugger to.
- `useBackKey` installs exactly one `window` listener and removes it on unmount.

Wiring, per §8.3's escalation (collapse → leave → exit):
- On `/bigscreen` (home), Back is a no-op for now. Home is the root of the surface; stage 10's shell is what turns a Back at the root into an app exit, and inventing a `window.close()` here would do nothing useful in a browser tab.
- On `/bigscreen/profiles`, Back goes from the keypad to the profile grid, and from the grid to `/bigscreen`.

**The transitive-import guard.** The existing import test only inspects specifiers *written inside* `(bigscreen)`, so `@/lib/buildMixedRailsScreen` passes it while transitively pulling `@/components/browse/BrowseScreen` → `PosterCard` → `tailwind-merge` into the TV bundle. That is a live trap: the one import a future author is most likely to reach for is the one the guard cannot see. Add a sixth test that follows `@/`-rooted imports one level deeper:

- [ ] **Step 1: Write the failing guard test**

Add to `legacy-target.test.ts`:

```ts
  it('does not reach the web components through an intermediate module', () => {
    // The import test above only sees specifiers written INSIDE (bigscreen). A TV file
    // may import @/lib/foo, and @/lib/foo may import @/components/... — which lands
    // PosterCard and the Tailwind runtime in the TV bundle with the guard still green.
    // @/lib/buildMixedRailsScreen and @/lib/buildRailsScreen both do exactly this.
    const SRC = join(process.cwd(), 'src');
    const offences: string[] = [];
    for (const { id, src } of tvSourceFiles()) {
      for (const spec of importSpecifiers(src)) {
        if (!spec.startsWith('@/')) continue;
        const rel = spec.slice(2);
        const candidates = ['.ts', '.tsx', '/index.ts', '/index.tsx'].map((ext) => join(SRC, rel + ext));
        const hit = candidates.find((p) => existsSync(p));
        if (!hit) continue;
        for (const nested of importSpecifiers(readFileSync(hit, 'utf8'))) {
          if (nested.startsWith('@/components')) {
            offences.push(`${id} -> ${spec} -> ${nested}`);
          }
        }
      }
    }
    expect(offences, offences.join('; ')).toEqual([]);
  });
```

Add `existsSync` to the `node:fs` import. One level of indirection is the right depth: it catches the trap that actually exists without turning a guard into a module resolver.

- [ ] **Step 2: Run it and confirm it passes on the current tree**

Run: `cd frontend && npm run test:tv`
Expected: PASS. Then prove it *can* fail: temporarily add `import { MIXED_RAILS } from '@/lib/buildMixedRailsScreen';` to a TV file, re-run, confirm the new test fails naming the chain, and remove it. Report that you did this — a guard nobody has seen fail is not known to work.

- [ ] **Step 3: Write the failing `useBackKey` tests**

Cover: calls `onBack` for each of `Backspace`, `Escape` and `XF86Back` by `key`; calls it for each of `461`, `8`, `27` and `166` by `keyCode`; does **not** call it for `ArrowLeft` or `a`; `preventDefault` is called for a recognised key and **not** called for an unrecognised one; the listener is removed on unmount (dispatch after unmount and assert no further calls).

- [ ] **Step 4: Run, implement, run**

- [ ] **Step 5: Wire Back into the two screens, and test the profiles escalation**

Add to the profiles page tests: with the keypad open, a Back press returns to the grid without navigating; from the grid, a Back press navigates to `/bigscreen`.

- [ ] **Step 6: Full verification**

Run from `frontend/`: `npx vitest run`, `npm run test:tv`, `npx tsc --noEmit`, `npm run build`.
Expected: all green; the build lists `/bigscreen`, `/bigscreen/diag`, `/bigscreen/pair` and `/bigscreen/profiles`, with every pre-existing route unchanged.

- [ ] **Step 7: Commit**

```bash
git add "frontend/src/app/(bigscreen)"
git commit -m "feat(tv): Back-key handling, and a guard for transitive web imports

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Notes for whoever runs this

**What this stage deliberately does not do.** Detail screens, the season/episode picker, the search keyboard and My List as its own screen are stage 6. The player is stage 7. Cards here navigate to `/bigscreen/movie/{id}` and `/bigscreen/show/{id}`, which do not exist yet — that is intended, and stage 6 completes the link. The one card that points somewhere real is a Continue Watching card, which points at `/bigscreen/watch/{torrent_id}`, also stage 7.

**The spec says to evaluate `@noriginmedia/norigin-spatial-navigation` first; that was done and the answer is to hand-roll.** Its React 19 compatibility is fine (`react: ">=16.8.0"`), so this is a choice, not a workaround. Three facts decided it: it installs its own `window` keydown listener and calls `preventDefault` on every arrow and Enter, which directly contradicts §8.3's rule that arrows must not be claimed globally; without `shouldFocusDOMNode: true` it never moves DOM focus, so the `:focus` gold ring that `bigscreen.css` calls "the whole navigation model on a remote" silently stops appearing; and it has no concept of a Back key, so webOS 461 needs a hand-written listener either way. A strict rail grid also does not need geometric nearest-neighbour search — explicit row and column indices are more predictable, and they are what make the empty-rail skip rule in Task 1 expressible at all.
