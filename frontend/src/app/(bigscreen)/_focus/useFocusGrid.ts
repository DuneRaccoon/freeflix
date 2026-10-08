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
 * other key is how Back and Enter stop working. An arrow that something else has
 * already claimed (`defaultPrevented`, e.g. a nested transport bar) is left alone.
 *
 * OWNERSHIP: only one `useFocusGrid` may be live per screen. The listener is on
 * `window` and checks no scope. Two instances do not both move — whichever registered
 * first claims the arrow and the `defaultPrevented` check above makes the second inert —
 * which is worse than it sounds: during an overlapping mount the INCOMING screen is the
 * dead one until the outgoing screen unmounts. So a screen with two focusable regions
 * mounts one at a time (the profiles screen mounts the grid or the keypad, never both).
 *
 * RESTORING A POSITION (`storageKey`). Rails load one at a time, so the row a saved
 * position points at is usually still empty when the first rail appears. The saved
 * target is therefore held as a pending restore, not resolved on the first shape:
 * focus falls back to the first populated row, nothing is written to storage while
 * the restore is pending (the fallback must never overwrite the saved position), and
 * the target is adopted the moment its row fills. Any press the viewer makes cancels
 * it — including one that cannot move — and persisting resumes from there.
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

/**
 * A held arrow repeats many times a second. Writing sessionStorage per repeat is
 * synchronous work on a surface with a frame budget, so the position is written
 * once the key has been quiet this long (and on unmount).
 */
const PERSIST_DELAY_MS = 200;

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

function writeStored(storageKey: string, t: FocusTarget): void {
  try {
    sessionStorage.setItem(storageName(storageKey), JSON.stringify(t));
  } catch {
    /* nothing to do: losing the remembered position is harmless */
  }
}

/** What `go` is allowed to do besides record the new target. */
interface Move {
  /** Drag real DOM focus (and the scroll) to the new cell. */
  focusDom: boolean;
  /** The viewer chose this (key, pointer, setFocus), as opposed to reconciliation. */
  user: boolean;
}

interface CellEntry {
  ref: FocusProps['ref'];
  onFocus: FocusProps['onFocus'];
  props: FocusProps;
}

export function useFocusGrid(opts: { rowCounts: RowCounts; storageKey?: string }): FocusGrid {
  const { rowCounts, storageKey } = opts;
  // A cheap identity for the grid's shape: a parent that passes a fresh array of the
  // same counts every render must not look like a change.
  const shape = rowCounts.join(',');

  const [focused, setFocused] = useState<FocusTarget>(NO_TARGET);

  // The key listener is registered once, so everything it reads lives in refs.
  const focusedRef = useRef<FocusTarget>(NO_TARGET);
  const rowCountsRef = useRef<RowCounts>(rowCounts);
  const storageKeyRef = useRef(storageKey);
  const elements = useRef(new Map<string, HTMLElement>());
  // Last column held in each row, so coming back to a rail lands where it was left.
  const columnMemory = useRef<number[]>([]);

  // The saved position waiting for its row to fill, and which key it was read for.
  const pendingRestore = useRef<FocusTarget | null>(null);
  const restoredFor = useRef<{ key: string | undefined } | null>(null);

  // Trailing persistence: the latest position and the timer that will write it.
  const queuedWrite = useRef<{ key: string; target: FocusTarget } | null>(null);
  const writeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Per-cell props, so a memoised card re-renders only when its own tabIndex flips.
  const cells = useRef<{ shape: string; byKey: Map<string, CellEntry> }>({ shape, byKey: new Map() });

  // Layout effect so a key press can never see the previous render's counts.
  useLayoutEffect(() => {
    rowCountsRef.current = rowCounts;
    storageKeyRef.current = storageKey;
  });

  const flushPersist = useCallback(() => {
    if (writeTimer.current !== null) clearTimeout(writeTimer.current);
    writeTimer.current = null;
    const queued = queuedWrite.current;
    queuedWrite.current = null;
    if (queued) writeStored(queued.key, queued.target);
  }, []);

  const schedulePersist = useCallback(
    (target: FocusTarget) => {
      const key = storageKeyRef.current;
      if (!key) return;
      queuedWrite.current = { key, target };
      if (writeTimer.current !== null) clearTimeout(writeTimer.current);
      writeTimer.current = setTimeout(flushPersist, PERSIST_DELAY_MS);
    },
    [flushPersist],
  );

  // A screen that unmounts inside the delay must not lose its last position. `pagehide`
  // covers the other exit: a reload or a full-page navigation within the delay, which no
  // unmount cleanup would see. (An abruptly killed app is not recoverable either way —
  // sessionStorage dies with the browsing context.)
  useEffect(() => {
    const onHide = () => flushPersist();
    window.addEventListener('pagehide', onHide);
    return () => {
      window.removeEventListener('pagehide', onHide);
      flushPersist();
    };
  }, [flushPersist]);

  /** True when DOM focus is on the body or on one of our own cells. */
  const focusIsOurs = useCallback(() => {
    const active = document.activeElement;
    if (!active || active === document.body) return true;
    for (const el of elements.current.values()) if (el === active) return true;
    return false;
  }, []);

  /** Make `next` the focused target. */
  const go = useCallback(
    (next: FocusTarget, how: Move) => {
      const prev = focusedRef.current;
      const changed = !same(prev, next);
      focusedRef.current = next;
      if (changed) setFocused(next);
      if (next.row < 0) return;

      // The viewer taking control ends any pending restore, which then never yanks
      // focus away from where they went. Deliberately NOT gated on `changed`: a press
      // that cannot move (Up at the top of the screen) is still the viewer driving, and
      // a restore that teleported focus a second later would read as the screen
      // shifting under them.
      const cancelled = how.user && pendingRestore.current !== null;
      if (how.user) pendingRestore.current = null;
      columnMemory.current[next.row] = next.col;
      // While a restore is pending the target is only a stand-in; writing it would
      // destroy the position we are waiting to restore. `cancelled` covers the press
      // that goes nowhere: it ends the restore, so the stand-in it leaves focus on is
      // now the real position and has to be written, or the next visit would restore
      // the position the viewer just declined.
      if ((changed || cancelled) && pendingRestore.current === null) schedulePersist(next);

      if (!how.focusDom) return;
      const el = elements.current.get(cellKey(next.row, next.col));
      // A TV can hand back a node that has since been detached.
      if (!el || !el.isConnected) return;
      // Already there (a press at the end of a rail): no work, no re-scroll.
      if (!changed && document.activeElement === el) return;
      // Chromium would otherwise run its own scroll on focus (centre-if-needed on both
      // axes) and then ours: two scrolls per press, the first one wrong.
      el.focus({ preventScroll: true });
      // Not every environment has scrollIntoView (jsdom).
      if (typeof el.scrollIntoView === 'function') {
        el.scrollIntoView({ block: 'nearest', inline: 'center' });
      }
    },
    [schedulePersist],
  );

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Something closer to the target already took this key (a nested handler such
      // as a transport bar); do not fight it for the arrow.
      if (e.defaultPrevented) return;
      const dir = directionOf(e);
      if (!dir) return; // not ours: leave the event alone for Back and friends
      e.preventDefault();

      const counts = rowCountsRef.current;
      if (isEmptyGrid(counts)) return;
      const from = clampTarget(counts, focusedRef.current);
      go(move(counts, from, dir, columnMemory.current), { focusDom: true, user: true });
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [go]);

  // Reconcile focus with the grid whenever its shape (or storage key) changes. A rail
  // that fills in late, shrinks, or disappears must never leave the remote with
  // nothing focused.
  useEffect(() => {
    const counts = rowCountsRef.current;
    let base = focusedRef.current;

    // First run, or a surviving instance handed a different key: start this screen
    // afresh. Whatever was queued belongs to the old key, so write it out first.
    if (restoredFor.current === null || restoredFor.current.key !== storageKey) {
      flushPersist();
      restoredFor.current = { key: storageKey };
      pendingRestore.current = readStored(storageKey);
      columnMemory.current = [];
      base = NO_TARGET;
    }

    if (isEmptyGrid(counts)) {
      if (!same(focusedRef.current, NO_TARGET)) go(NO_TARGET, { focusDom: false, user: false });
      return;
    }

    // Adopt the pending target as soon as its row has items (clampTarget only keeps
    // the row when it is populated); until then fall back to the first populated row.
    // Already focused and still fitting: stay put, do not steal focus.
    const pending = pendingRestore.current;
    const adopted = pending ? clampTarget(counts, pending) : null;
    let start: FocusTarget;
    if (pending && adopted && adopted.row === pending.row) {
      pendingRestore.current = null;
      start = adopted;
    } else {
      start = clampTarget(counts, base);
    }
    // Adoption must not yank DOM focus out of something this grid does not own — an
    // overlay or a dialog opened from a card, which later stages add. The model still
    // moves, so the next arrow press focuses the adopted cell.
    const ours = focusIsOurs();
    if (!same(start, focusedRef.current)) go(start, { focusDom: ours, user: false });
  }, [shape, storageKey, go, flushPersist, focusIsOurs]);

  const setFocus = useCallback(
    (t: FocusTarget) => {
      const counts = rowCountsRef.current;
      if (isEmptyGrid(counts)) return;
      go(clampTarget(counts, t), { focusDom: true, user: true });
    },
    [go],
  );

  const focusProps = (row: number, col: number): FocusProps => {
    if (cells.current.shape !== shape) cells.current = { shape, byKey: new Map() };
    const key = cellKey(row, col);
    const tabIndex = focused.row === row && focused.col === col ? 0 : -1;

    let entry = cells.current.byKey.get(key);
    if (!entry) {
      const ref: FocusProps['ref'] = (el) => {
        if (el) elements.current.set(key, el);
        else elements.current.delete(key);
      };
      // A pointer can focus a cell directly; sync the model to it. Our own el.focus()
      // arrives here too, but by then the model already points at the cell. Do not
      // re-focus, and do not scroll: the pointer is already on it, and recentring under
      // a moving pointer would chase the pointer across the rail.
      const onFocus: FocusProps['onFocus'] = () => {
        if (row === focusedRef.current.row && col === focusedRef.current.col) return;
        go({ row, col }, { focusDom: false, user: true });
      };
      entry = { ref, onFocus, props: { tabIndex, ref, onFocus } };
      cells.current.byKey.set(key, entry);
    } else if (entry.props.tabIndex !== tabIndex) {
      entry.props = { tabIndex, ref: entry.ref, onFocus: entry.onFocus };
    }
    return entry.props;
  };

  return {
    focused,
    isFocused: (row, col) => focused.row === row && focused.col === col,
    focusProps,
    setFocus,
  };
}
