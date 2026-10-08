'use client';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  type Direction,
  type FocusTarget,
  type RowCounts,
  NO_TARGET,
  clampTarget,
  isEmptyGrid,
  move,
} from './model';

/**
 * D-pad focus for a grid of rails: a roving tabindex that moves REAL DOM focus.
 *
 * Real focus is the point. `bigscreen.css` draws the focus ring with `:focus` ("the
 * focus ring is the whole navigation model on a remote"), so the hook must call
 * `el.focus()`; a `data-focused` attribute or a class-based ring would leave every
 * existing rule dead.
 *
 * The hook claims the four arrow keys and nothing else. A `preventDefault()` on any
 * other key is how Back and Enter stop working.
 */

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

/** `Map`, not an object literal: `KEYS['constructor']` on a literal is truthy. */
const KEYS: ReadonlyMap<string, Direction> = new Map<string, Direction>([
  ['ArrowLeft', 'left'],
  ['ArrowUp', 'up'],
  ['ArrowRight', 'right'],
  ['ArrowDown', 'down'],
]);

/** The legacy numeric codes a webOS remote sends, sometimes with no usable `key`. */
const KEY_CODES: ReadonlyMap<number, Direction> = new Map<number, Direction>([
  [37, 'left'],
  [38, 'up'],
  [39, 'right'],
  [40, 'down'],
]);

function directionOf(e: KeyboardEvent): Direction | undefined {
  // Browser shortcuts (Alt+Left is history back on a desktop) are not remote presses.
  if (e.altKey || e.ctrlKey || e.metaKey) return undefined;
  return KEYS.get(e.key) ?? KEY_CODES.get(e.keyCode);
}

const same = (a: FocusTarget, b: FocusTarget) => a.row === b.row && a.col === b.col;
const cellKey = (row: number, col: number) => `${row}:${col}`;
const storageName = (key: string) => `bs-focus:${key}`;

// sessionStorage can throw on access (a TV in a restricted mode), so a bad read or
// write degrades to "no remembered position" instead of taking the screen down.
function readStored(storageKey: string | undefined): FocusTarget | null {
  if (!storageKey) return null;
  try {
    const raw = sessionStorage.getItem(storageName(storageKey));
    if (!raw) return null;
    const { row, col } = (JSON.parse(raw) ?? {}) as Record<string, unknown>;
    return typeof row === 'number' && Number.isInteger(row) && row >= 0 &&
      typeof col === 'number' && Number.isInteger(col) && col >= 0
      ? { row, col }
      : null;
  } catch {
    return null;
  }
}

function writeStored(storageKey: string | undefined, t: FocusTarget): void {
  if (!storageKey) return;
  try {
    sessionStorage.setItem(storageName(storageKey), JSON.stringify(t));
  } catch {
    /* nothing to do: losing the remembered position is harmless */
  }
}

export function useFocusGrid(opts: { rowCounts: RowCounts; storageKey?: string }): FocusGrid {
  const { rowCounts, storageKey } = opts;

  const [focused, setFocused] = useState<FocusTarget>(NO_TARGET);

  // The key listener is registered once, so everything it reads lives in refs.
  const focusedRef = useRef<FocusTarget>(NO_TARGET);
  const rowCountsRef = useRef<RowCounts>(rowCounts);
  const storageKeyRef = useRef(storageKey);
  const elements = useRef(new Map<string, HTMLElement>());
  // Last column held in each row, so coming back to a rail lands where it was left.
  const columnMemory = useRef<number[]>([]);

  // Layout effect so a key press can never see the previous render's counts.
  useLayoutEffect(() => {
    rowCountsRef.current = rowCounts;
    storageKeyRef.current = storageKey;
  });

  /** Make `next` the focused target; optionally drag real DOM focus (and the scroll) along. */
  const go = useCallback((next: FocusTarget, moveDomFocus: boolean) => {
    const prev = focusedRef.current;
    focusedRef.current = next;
    if (!same(prev, next)) setFocused(next);
    if (next.row < 0) return;

    columnMemory.current[next.row] = next.col;
    writeStored(storageKeyRef.current, next);

    if (!moveDomFocus) return;
    const el = elements.current.get(cellKey(next.row, next.col));
    // A TV can hand back a node that has since been detached, and not every
    // environment has scrollIntoView (jsdom).
    if (!el || !el.isConnected) return;
    el.focus();
    if (typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ block: 'nearest', inline: 'center' });
    }
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const dir = directionOf(e);
      if (!dir) return; // not ours: leave the event alone for Back and friends
      e.preventDefault();

      const counts = rowCountsRef.current;
      if (isEmptyGrid(counts)) return;
      const from = clampTarget(counts, focusedRef.current);
      go(move(counts, from, dir, columnMemory.current), true);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [go]);

  // Reconcile focus with the grid whenever its shape changes. A rail that fills in
  // late, shrinks, or disappears must never leave the remote with nothing focused.
  const shape = rowCounts.join(',');
  useEffect(() => {
    const counts = rowCountsRef.current;
    const current = focusedRef.current;

    if (isEmptyGrid(counts)) {
      if (!same(current, NO_TARGET)) go(NO_TARGET, false);
      return;
    }

    // Nothing focused yet: prefer the remembered position, else the first populated
    // row. Already focused: keep it if it still fits (do not steal focus), else clamp.
    const wanted = same(current, NO_TARGET) ? readStored(storageKeyRef.current) ?? NO_TARGET : current;
    const start = clampTarget(counts, wanted);
    if (!same(start, current)) go(start, true);
  }, [shape, go]);

  const setFocus = useCallback(
    (t: FocusTarget) => {
      const counts = rowCountsRef.current;
      if (isEmptyGrid(counts)) return;
      go(clampTarget(counts, t), true);
    },
    [go],
  );

  return {
    focused,
    isFocused: (row, col) => focused.row === row && focused.col === col,
    focusProps: (row, col) => ({
      tabIndex: focused.row === row && focused.col === col ? 0 : -1,
      ref: (el) => {
        const k = cellKey(row, col);
        if (el) elements.current.set(k, el);
        else elements.current.delete(k);
      },
      // A pointer can focus a cell directly; sync the model to it. Do not re-focus,
      // and do not scroll: the pointer is already on it, and recentring under a
      // moving pointer would chase the pointer across the rail.
      onFocus: () => go({ row, col }, false),
    }),
    setFocus,
  };
}
