import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { useFocusGrid } from '../_focus/useFocusGrid';
import { MEDIA_KEYS, MEDIA_KEY_CODES, type MediaKeyAction } from '../_focus/useMediaKeys';
import type { FocusProps } from '../_focus/useFocusGrid';
import {
  TransportBar,
  TRANSPORT_CELLS,
  RETRY_CELL,
  MEDIA_TWINS,
  TWIN_CELL,
  transportCells,
  transportCellCount,
  labelFor,
  type TransportAction,
} from './TransportBar';

const fp = (): ((row: number, col: number) => FocusProps) => () => ({
  tabIndex: -1,
  ref: () => {},
  onFocus: () => {},
});

/** The transport row inside a real grid, which is the only way the ring can be observed. */
function Harness({
  playing = true,
  retry = false,
  onAction = () => {},
}: {
  playing?: boolean;
  retry?: boolean;
  onAction?: (a: TransportAction) => void;
}) {
  const grid = useFocusGrid({ rowCounts: [transportCellCount({ retry })] });
  return <TransportBar row={0} focusProps={grid.focusProps} playing={playing} retry={retry} onAction={onAction} />;
}

describe('TransportBar', () => {
  beforeEach(() => {
    // jsdom does not implement scrollIntoView, which the grid calls on every move.
    Element.prototype.scrollIntoView = vi.fn();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders exactly the cells it declares, and declares exactly what it renders', () => {
    // The focus model's contract: a row's declared count IS the cells it renders. One too
    // many parks the ring on a cell no element claims, and a remote has no Tab to escape.
    for (const retry of [false, true]) {
      const { container, unmount } = render(
        <TransportBar row={0} focusProps={fp()} playing retry={retry} onAction={() => {}} />,
      );
      expect.soft(container.querySelectorAll('button'), `retry=${retry}`).toHaveLength(
        transportCellCount({ retry }),
      );
      unmount();
    }
  });

  it('is a row of real <button>s, because OK is a native click', () => {
    // Neither `useFocusGrid` nor `useMediaKeys` claims Enter (`useFocusGrid.test.tsx:128`
    // pins that), so activation is the browser turning OK into a click. The web player's
    // `div role="slider"` would be a dead cell on a remote.
    const { container } = render(
      <TransportBar row={0} focusProps={fp()} playing retry onAction={() => {}} />,
    );
    const cells = [...container.querySelectorAll('.bs-player__row > *')];
    expect(cells.length).toBe(transportCellCount({ retry: true }));
    for (const cell of cells) {
      expect.soft(cell.tagName, cell.textContent ?? '').toBe('BUTTON');
      expect.soft(cell.getAttribute('type'), cell.textContent ?? '').toBe('button');
    }
  });

  it('gives each cell its own column, starting at the row it is given', () => {
    const calls: Array<[number, number]> = [];
    render(
      <TransportBar
        row={4}
        focusProps={(row, col) => {
          calls.push([row, col]);
          return { tabIndex: -1, ref: () => {}, onFocus: () => {} };
        }}
        playing
        onAction={() => {}}
      />,
    );
    expect(calls).toEqual(TRANSPORT_CELLS.map((_c, col) => [4, col]));
  });

  it('reports the cell that was pressed, and nothing else', () => {
    const onAction = vi.fn();
    render(<Harness retry onAction={onAction} />);
    for (const cell of transportCells({ retry: true })) {
      fireEvent.click(screen.getByRole('button', { name: labelFor(cell, { playing: true }) }));
      expect.soft(onAction).toHaveBeenLastCalledWith(cell.id);
    }
    expect(onAction).toHaveBeenCalledTimes(transportCellCount({ retry: true }));
  });

  it('RELABELS Play/Pause and never swaps the element', () => {
    // Swapping the element type (or the React key) unmounts the control the ring is on and
    // drops DOM focus to <body>, where the grid's reconcile effect — unchanged counts —
    // never re-runs to recover it.
    const { rerender } = render(<Harness playing={false} />);
    const before = screen.getByRole('button', { name: 'Play' });
    expect(document.activeElement).toBe(before);
    rerender(<Harness playing />);
    const after = screen.getByRole('button', { name: 'Pause' });
    expect.soft(after, 'the same element, relabelled').toBe(before);
    expect.soft(document.activeElement, 'focus never left it').toBe(after);
    expect.soft(screen.queryByRole('button', { name: 'Play' })).toBeNull();
  });

  it('gives every media-key action a focusable on-screen twin', () => {
    // Task 7 deliberately made no key code a dependency: nothing on this set has ever been
    // logged, `415/19/413/412/417` are recalled documentation and that `e.key` is populated
    // at all is a guess. This test is what makes an unrecognised key a missing SHORTCUT
    // rather than a missing feature — so the actions are read off the hook's own exported
    // tables, not from a list written here that could drift from them.
    const actions = new Set<MediaKeyAction>([
      ...MEDIA_KEYS.map(([, a]) => a),
      ...MEDIA_KEY_CODES.map(([, a]) => a),
    ]);
    expect(actions.size).toBeGreaterThan(0);
    render(<Harness retry />);
    const rendered = transportCells({ retry: true });
    for (const action of actions) {
      // Through BOTH tables: `MEDIA_TWINS` says what the key means, `TWIN_CELL` says which
      // control embodies it. ▶, ⏸ and the toggle mean three different things and share one
      // cell, so a test that went straight from the key to a cell id could not tell the
      // difference — which is how ▶ came to pause a playing title.
      const twin = TWIN_CELL[MEDIA_TWINS[action]];
      const cell = rendered.find((c) => c.id === twin);
      expect.soft(cell, `${action} -> ${twin} is a cell that exists`).toBeDefined();
      if (!cell) continue;
      const el = screen.getByRole('button', { name: labelFor(cell, { playing: true }) });
      // Focusable: a roving-tabindex cell is tabIndex 0 or -1, never absent, and never
      // disabled — a disabled focus stop is a control that refuses to act.
      expect.soft(el.getAttribute('tabindex'), `${action} twin is a focus stop`).not.toBeNull();
      expect.soft(el).not.toBeDisabled();
    }
  });

  it('keeps ▶ and ⏸ as separate intents on the one shared control', () => {
    // The remote's two keys are not a toggle. Measured before this split: with the title
    // playing, a Play press called `pause()` once and `play()` not at all.
    expect.soft(MEDIA_TWINS.play).toBe('play');
    expect.soft(MEDIA_TWINS.pause).toBe('pause');
    expect.soft(MEDIA_TWINS.playPause).toBe('playPause');
    // ...and all three still land on the one focusable cell, so the twin contract holds.
    expect.soft(TWIN_CELL.play).toBe('playPause');
    expect.soft(TWIN_CELL.pause).toBe('playPause');
    expect.soft(TWIN_CELL.playPause).toBe('playPause');
    // Every action has a cell, and every cell is a cell that exists.
    const ids = new Set(transportCells({ retry: true }).map((c) => c.id));
    for (const [action, cellId] of Object.entries(TWIN_CELL)) {
      expect.soft(ids.has(cellId), `${action} -> ${cellId}`).toBe(true);
    }
  });

  it('appends Retry last, so growing the row never moves the ring', () => {
    // The grid calls `go` only when the CLAMPED TARGET CHANGES, so growth never refocuses.
    // A cell inserted at or before the focused column therefore leaves DOM focus on the
    // element that just became column 1 while the model still points at column 0 — and the
    // next press appears to do nothing. (`LoadStatus` gives its PREPENDED retry `autoFocus`
    // for exactly this reason; this row cannot, because it must not steal focus mid-film.)
    // Soft, all of it: a hard assertion here ends the test at the ordering and the ring
    // assertions below — the ones that describe what the viewer experiences — would be
    // asserted by lines that never ran.
    expect.soft(transportCells({ retry: true }).at(-1)?.id).toBe(RETRY_CELL.id);
    const { rerender } = render(<Harness />);
    const first = screen.getByRole('button', { name: 'Pause' });
    expect(document.activeElement).toBe(first);
    rerender(<Harness retry />);
    expect.soft(document.activeElement, 'DOM focus stayed put').toBe(first);
    // ...and the model agrees with the DOM: the roving tabindex is the model's own answer.
    expect.soft(first.getAttribute('tabindex'), 'the model still points here').toBe('0');
    expect.soft(screen.getByRole('button', { name: RETRY_CELL.label }).getAttribute('tabindex')).toBe('-1');
  });

  it('owns no focus grid and claims no key', () => {
    // A `useFocusGrid` inside this component is a defect: the listener is on `window` and
    // checks no scope, and effects register CHILD BEFORE PARENT, so a child's grid would
    // silently win and the screen's grid would be inert.
    const src = readFileSync(join(process.cwd(), 'src/app/(bigscreen)/_player/TransportBar.tsx'), 'utf8');
    expect.soft(src).not.toMatch(/useFocusGrid\s*\(/);
    expect.soft(src).not.toMatch(/addEventListener/);
    const added: string[] = [];
    const spy = vi.spyOn(window, 'addEventListener').mockImplementation(((type: string) => {
      added.push(type);
    }) as typeof window.addEventListener);
    render(<TransportBar row={0} focusProps={fp()} playing retry onAction={() => {}} />);
    spy.mockRestore();
    expect.soft(added).toEqual([]);
    // And an arrow press is nobody's business here: no handler, nothing claimed.
    const e = new KeyboardEvent('keydown', { key: 'ArrowRight', keyCode: 39, bubbles: true, cancelable: true });
    act(() => {
      (document.activeElement ?? document.body).dispatchEvent(e);
    });
    expect.soft(e.defaultPrevented).toBe(false);
  });

  it('labels every cell with words a viewer can read from ten feet', () => {
    for (const cell of transportCells({ retry: true })) {
      const label = labelFor(cell, { playing: false });
      expect.soft(label.length, cell.id).toBeGreaterThan(2);
      expect.soft(label, cell.id).toMatch(/[A-Za-z]/);
    }
    // The ±60s twins say which direction and how far, since they are also how a viewer
    // repeats a jump the remote's own buttons do once per press.
    expect.soft(labelFor(RETRY_CELL, { playing: false })).toBe(RETRY_CELL.label);
    const ids = transportCells({ retry: true }).map((c) => c.id);
    expect.soft(ids).toContain('back60');
    expect.soft(ids).toContain('forward60');
    expect.soft(ids).toContain('back10');
    expect.soft(ids).toContain('stop');
  });
});
