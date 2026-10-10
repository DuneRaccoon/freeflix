/**
 * The hatch the whole "arrows seek only on the transport bar" design rests on.
 *
 * `useFocusGrid` claims the four arrows on a `window` listener and moves real DOM focus.
 * Task 8's scrub cell has to take Left/Right for itself *while it holds focus* and leave
 * them to the grid everywhere else. The only mechanism for that is the grid's
 * `if (e.defaultPrevented) return` (`useFocusGrid.ts:248`) combined with React's synthetic
 * handlers running at the root container, which the native event reaches on its way up to
 * `window`. Nothing in the repo proved that path before this file:
 *
 * - `useFocusGrid.test.tsx:152` proves REGISTRATION ORDER — a plain `window` listener added
 *   before the hook mounts.
 * - `useBackKey.test.tsx:86` proves PROPAGATION ORDER on `document` — a `document` listener
 *   and an event dispatched from a descendant.
 *
 * Neither is React's synthetic path, and the synthetic path is what a component's
 * `onKeyDown` prop actually is.
 *
 * HOW THE PRESS IS FIRED, AND WHY IT MATTERS (hazard 11). Every press here is dispatched at
 * `document.activeElement`. The house helper — `const arrow = (k) => fireEvent.keyDown(window, ...)`,
 * in five suites on this surface — dispatches at `window`, which is ABOVE the React root
 * container in the tree, so no React `onKeyDown` ever sees it. A nested-claim test written
 * with the house helper passes while asserting the opposite of the design: the grid moves and
 * the nested handler was never consulted. The last two tests here pin that asymmetry so the
 * next author cannot discover it the expensive way.
 *
 * WHY THE CLAIMING ROW HAS TWO CELLS, WHICH TASK 8's SCRUB ROW WILL NOT. Measured, not
 * assumed: with a ONE-cell claiming row, deleting `useFocusGrid.ts:248` outright leaves this
 * whole file green. `move` never wraps left/right between rows (`model.ts:95-97`), so on a
 * single-cell row an unclaimed arrow moves nothing, `go` returns early, and the hatch has no
 * observable effect — a test built on that layout proves a coincidence. Two cells is the
 * smallest shape in which the grid acting on a claimed arrow is visible, and it is also the
 * live defect class: it is the web player's ±20s double-seek (`VideoPlayer.tsx:728`/`:1619`),
 * where a window arrow handler and a nested one both act on one press. The last test keeps
 * the single-cell shape as what it is — a second, independent defence, not the first one.
 *
 * The fixture is the house real-remote one, `{ key: 'Unidentified', keyCode: N }`: five
 * existing suites use it, and it is the half of the recognition most likely to be the live
 * path on this set, since the only key number ever observed here arrived without a name.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { useFocusGrid } from './useFocusGrid';

/** Left/Right by both spellings, as the scrub cell will have to match them. */
const HORIZONTAL_KEYS = ['ArrowLeft', 'ArrowRight'];
const HORIZONTAL_CODES = [37, 39];

/**
 * Row 0 is wrapped in a nested `onKeyDown` that claims Left/Right UNCONDITIONALLY while the
 * row holds focus — the shape task 8's scrub cell must have. Row 1 is two ordinary cells, so
 * the same press in the same dispatch shape can be shown to reach the grid.
 */
function Harness({
  onClaimed,
  scrubCells = 2,
}: {
  onClaimed?: (label: string) => void;
  scrubCells?: number;
}) {
  const grid = useFocusGrid({ rowCounts: [scrubCells, 2] });
  const nested = (e: React.KeyboardEvent) => {
    if (!HORIZONTAL_KEYS.includes(e.key) && !HORIZONTAL_CODES.includes(e.keyCode)) return;
    // Unconditional, deliberately: a claim made only when a seek is possible lets the press
    // AT the seekable boundary fall through to the grid, which is §7.4's refusal handed to
    // the navigation model instead of to the viewer.
    e.preventDefault();
    onClaimed?.(`${e.key}/${e.keyCode}`);
  };
  return (
    <div>
      <div onKeyDown={nested}>
        {Array.from({ length: scrubCells }, (_, col) => (
          <button key={col} {...grid.focusProps(0, col)}>{`scrub-${col}`}</button>
        ))}
      </div>
      <div>
        {['play', 'back10'].map((label, col) => (
          <button key={label} {...grid.focusProps(1, col)}>{label}</button>
        ))}
      </div>
    </div>
  );
}

/** The device's shape: a keydown at the focused element, bubbling up to `window`. */
function fireAtFocus(init: KeyboardEventInit): KeyboardEvent {
  const target = document.activeElement ?? document.body;
  const e = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  act(() => { target.dispatchEvent(e); });
  return e;
}

/** The house helper's shape, kept here only to pin that it is the wrong one. */
function fireAtWindow(init: KeyboardEventInit): KeyboardEvent {
  const e = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  act(() => { window.dispatchEvent(e); });
  return e;
}

/** Focus a cell the way a pointer would; the grid syncs its model to it. */
function startOn(label: string): HTMLElement {
  const el = screen.getByText(label);
  act(() => { el.focus(); });
  expect(el).toHaveAttribute('tabindex', '0');
  return el;
}

const down = () => fireAtFocus({ key: 'Unidentified', keyCode: 40 });

describe('a nested onKeyDown claiming an arrow, through React', () => {
  beforeEach(() => {
    // jsdom does not implement scrollIntoView, which the grid calls on every move.
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('starts on the claiming row, which is where the grid puts the ring', () => {
    render(<Harness />);
    expect(document.activeElement).toBe(screen.getByText('scrub-0'));
  });

  it.each([
    ['rightwards, by name', 'scrub-0', { key: 'ArrowRight', keyCode: 0 }],
    ['leftwards, by name', 'scrub-1', { key: 'ArrowLeft', keyCode: 0 }],
    // The real-remote half: no usable `key`, only the legacy code.
    ['rightwards, by code only', 'scrub-0', { key: 'Unidentified', keyCode: 39 }],
    ['leftwards, by code only', 'scrub-1', { key: 'Unidentified', keyCode: 37 }],
  ])('the nested handler takes the press and the grid does not move: %s', (_name, from, init) => {
    // MUTATE AWAY `useFocusGrid.ts:248`'s `if (e.defaultPrevented) return` AND THIS FAILS.
    // Without it the grid acts on a key the cell already consumed, so one press both seeks
    // and moves the ring — the web player's live ±20s double-seek, on the TV.
    const onClaimed = vi.fn();
    render(<Harness onClaimed={onClaimed} />);
    const start = startOn(from);
    const e = fireAtFocus(init);
    expect(onClaimed).toHaveBeenCalledTimes(1);
    expect(e.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(start);
  });

  it('the same dispatch shape does move the grid from a row with no nested claim', () => {
    // NON-VACUITY. Without this row the tests above would also pass if the grid simply never
    // heard a press dispatched at the focused element — which is precisely the failure mode
    // hazard 11 describes, with the window/synthetic asymmetry the other way round.
    const onClaimed = vi.fn();
    render(<Harness onClaimed={onClaimed} />);
    down();
    expect(document.activeElement).toBe(screen.getByText('play'));
    const e = fireAtFocus({ key: 'Unidentified', keyCode: 39 });
    expect(e.defaultPrevented).toBe(true); // claimed by the grid this time, not by the cell
    expect(onClaimed).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(screen.getByText('back10'));
  });

  it('leaves the grid the arrows the nested cell does not claim', () => {
    // The claim is scoped to one axis: Down off the scrub row must still work, or the cell
    // is a trap with no Tab key to escape it.
    const onClaimed = vi.fn();
    render(<Harness onClaimed={onClaimed} />);
    down();
    expect(document.activeElement).toBe(screen.getByText('play'));
    expect(onClaimed).not.toHaveBeenCalled();
    fireAtFocus({ key: 'Unidentified', keyCode: 38 });
    expect(document.activeElement).toBe(screen.getByText('scrub-0'));
  });

  it('claims every repeat of a held arrow, since the grid has no repeat guard', () => {
    const onClaimed = vi.fn();
    render(<Harness onClaimed={onClaimed} />);
    for (let i = 0; i < 4; i++) {
      const e = fireAtFocus({ key: 'Unidentified', keyCode: 39, repeat: i > 0 });
      expect(e.defaultPrevented).toBe(true);
    }
    expect(onClaimed).toHaveBeenCalledTimes(4);
    expect(document.activeElement).toBe(screen.getByText('scrub-0'));
  });

  it('is invisible to a press dispatched at window — the trap this file exists to pin', () => {
    // HAZARD 11, as an assertion, with both shapes side by side. If this ever starts failing
    // because React began hearing window-dispatched events, the warning in this file's header
    // can go; until then, a player key test written with the house `arrow()` helper asserts
    // the opposite of the design and passes.
    const onClaimed = vi.fn();
    render(<Harness onClaimed={onClaimed} />);

    const atWindow = fireAtWindow({ key: 'Unidentified', keyCode: 39 });
    expect(onClaimed).not.toHaveBeenCalled();
    // Heard and claimed all the same — by the GRID, the only arrow consumer above the React
    // root container, which moved the ring off the cell that was supposed to keep it.
    expect(atWindow.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(screen.getByText('scrub-1'));

    const atFocus = fireAtFocus({ key: 'Unidentified', keyCode: 37 });
    expect(onClaimed).toHaveBeenCalledTimes(1);
    expect(atFocus.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(screen.getByText('scrub-1'));
  });

  it('reaches the grid in the window shape too, so the asymmetry is React-side only', () => {
    const onClaimed = vi.fn();
    render(<Harness onClaimed={onClaimed} />);
    fireAtWindow({ key: 'Unidentified', keyCode: 40 });
    expect(document.activeElement).toBe(screen.getByText('play'));
    expect(onClaimed).not.toHaveBeenCalled();
  });

  it('a one-cell claiming row is a SECOND defence, and cannot see the hatch at all', () => {
    // Task 8's real shape: the scrub cell alone in its row. The claim still happens, but the
    // ring could not have moved anyway — `move` never wraps left/right between rows
    // (`model.ts:95-97`), so this assertion stays green even with `useFocusGrid.ts:248`
    // deleted. Recorded so nobody mistakes it for the proof; the two-cell rows above are.
    const onClaimed = vi.fn();
    render(<Harness onClaimed={onClaimed} scrubCells={1} />);
    const start = screen.getByText('scrub-0');
    expect(document.activeElement).toBe(start);
    const e = fireAtFocus({ key: 'Unidentified', keyCode: 39 });
    expect(onClaimed).toHaveBeenCalledTimes(1);
    expect(e.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(start);
  });
});
