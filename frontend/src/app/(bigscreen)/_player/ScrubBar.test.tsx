import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { useFocusGrid, type FocusProps } from '../_focus/useFocusGrid';
import { ScrubBar, scrubRowCount, hasFiniteDuration } from './ScrubBar';
import { SCRUB_STEP_S } from './describeScrub';
import type { ContiguousRun } from './seekBoundary';

const DURATION = 1000;
/** A measured run, with the fields `/info` actually sends (the `seekBoundary` fixture). */
const run = (run_end: number, file_size = 1000, run_start = 0): ContiguousRun => ({
  file_index: 0,
  file_size,
  piece_length: 100,
  run_start,
  run_end,
  complete: run_end >= file_size,
  measured_against: 'metadata',
});

/** The run ends 20 bytes in; with the playhead at 100s the ceiling is BEHIND the viewer. */
const AT_FRONTIER = { position: 100, duration: DURATION, contiguous: run(20) };

const fp = (): ((row: number, col: number) => FocusProps) => () => ({
  tabIndex: -1,
  ref: () => {},
  onFocus: () => {},
});

/**
 * The scrub cell in a real grid, in task 8's real shape: ALONE in its row, with an ordinary
 * transport row below it. `siblings` adds cells to the scrub's own row — not the shipping
 * layout, and the only shape in which the grid acting on a claimed arrow is observable
 * (`nestedArrowClaim.test.tsx` measured that a one-cell row cannot see the hatch at all).
 */
function Harness({
  position = 10,
  duration = DURATION,
  contiguous = null as ContiguousRun | null,
  onSeek = () => {},
  siblings = 0,
}: {
  position?: number;
  duration?: number;
  contiguous?: ContiguousRun | null;
  onSeek?: (s: number) => void;
  siblings?: number;
}) {
  const grid = useFocusGrid({ rowCounts: [scrubRowCount(duration) + siblings, 1] });
  return (
    <div>
      <ScrubBar
        row={0}
        focusProps={grid.focusProps}
        position={position}
        duration={duration}
        contiguous={contiguous}
        onSeek={onSeek}
      />
      {Array.from({ length: siblings }, (_, i) => (
        <button key={i} type="button" {...grid.focusProps(0, 1 + i)}>{`sibling-${i}`}</button>
      ))}
      <button type="button" {...grid.focusProps(1, 0)}>
        play
      </button>
    </div>
  );
}

/** The device's shape: a keydown at the focused element, bubbling up to `window`. */
function fireAtFocus(init: KeyboardEventInit): KeyboardEvent {
  const target = document.activeElement ?? document.body;
  const e = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  act(() => {
    target.dispatchEvent(e);
  });
  return e;
}

const right = (over: KeyboardEventInit = {}) => fireAtFocus({ key: 'ArrowRight', keyCode: 0, ...over });
const left = (over: KeyboardEventInit = {}) => fireAtFocus({ key: 'ArrowLeft', keyCode: 0, ...over });
const down = () => fireAtFocus({ key: 'Unidentified', keyCode: 40 });
const up = () => fireAtFocus({ key: 'Unidentified', keyCode: 38 });

const hint = (): string => document.querySelector('.bs-player__hint')?.textContent ?? '';
const bar = (): HTMLElement => screen.getByRole('button', { name: /of/ });

describe('ScrubBar', () => {
  beforeEach(() => {
    // jsdom does not implement scrollIntoView, which the grid calls on every move.
    Element.prototype.scrollIntoView = vi.fn();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('counts from the same condition that renders it', () => {
    // A count that disagrees with the cells parks the ring on a cell no element claims, and
    // there is no Tab key to escape with. The row exists only once `<video>` reports a
    // finite duration — which has never been observed for an in-progress stream on this
    // set, so the no-duration case is the one that must stay harmless.
    for (const duration of [Number.NaN, 0, -5, Number.POSITIVE_INFINITY, 1000]) {
      const { container, unmount } = render(
        <ScrubBar row={0} focusProps={fp()} position={10} duration={duration} contiguous={null} onSeek={() => {}} />,
      );
      expect
        .soft(container.querySelectorAll('button'), `duration=${duration}`)
        .toHaveLength(scrubRowCount(duration));
      unmount();
    }
    expect.soft(hasFiniteDuration(Number.NaN)).toBe(false);
    expect.soft(scrubRowCount(1000)).toBe(1);
  });

  it('is one real <button>, in column 0 of the row it is given', () => {
    // OK is a native click (neither hook claims Enter), so the web's `div role="slider"`
    // would be a dead cell on a remote.
    const calls: Array<[number, number]> = [];
    const { container } = render(
      <ScrubBar
        row={3}
        focusProps={(row, col) => {
          calls.push([row, col]);
          return { tabIndex: -1, ref: () => {}, onFocus: () => {} };
        }}
        position={10}
        duration={DURATION}
        contiguous={null}
        onSeek={() => {}}
      />,
    );
    expect.soft(calls).toEqual([[3, 0]]);
    const cells = [...container.querySelectorAll('.bs-player__row > *')];
    expect.soft(cells).toHaveLength(1);
    expect.soft(cells[0].tagName).toBe('BUTTON');
    expect.soft(cells[0].getAttribute('type')).toBe('button');
    expect.soft(cells[0].getAttribute('role')).toBeNull();
  });

  it('moves the pending position by ±10s a press, and seeks nothing', () => {
    // Pending-position ARITHMETIC: no network and no `currentTime` write per press. The
    // grid has no `e.repeat` guard, so a held arrow repeats many times a second, and a seek
    // per press is a storm of Range requests each re-anchoring the backend's deadline
    // window at a fresh offset.
    const onSeek = vi.fn();
    render(<Harness position={100} onSeek={onSeek} />);
    expect(document.activeElement).toBe(bar());
    right();
    expect.soft(bar().textContent).toContain('1:50');
    right();
    expect.soft(bar().textContent).toContain('2:00');
    left();
    expect.soft(bar().textContent).toContain('1:50');
    expect.soft(onSeek, 'nothing was seeked').not.toHaveBeenCalled();
    expect.soft(SCRUB_STEP_S).toBe(10);
  });

  it('acts on a press that arrives with no usable `key`, as this remote’s might', () => {
    // The only key number this project has ever read off the television arrived with no
    // usable `e.key`, so this is the half most likely to be the live path.
    render(<Harness position={100} />);
    fireAtFocus({ key: 'Unidentified', keyCode: 39 });
    expect.soft(bar().textContent).toContain('1:50');
    fireAtFocus({ key: 'Unidentified', keyCode: 37 });
    expect.soft(bar().textContent).toContain('1:40');
  });

  it('is handed a translated `key` by React, which is WHY the row above passes', () => {
    // MEASURED, and the reason the cell's `e.keyCode === 39` branch is NOT what makes the
    // row above green: deleting that branch leaves this whole suite passing. React's
    // `getEventKey` rewrites a synthetic event's `key` from `keyCode` before any handler
    // sees it — 'Unidentified' and '' both become 'ArrowRight' for 39 — and it maps the
    // legacy 'Right' spelling too. So on the React-synthetic path the numeric match is
    // defence in depth (against this handler ever becoming a native listener, where
    // `useFocusGrid` and `useMediaKeys` both genuinely need their numeric maps), and no
    // fixture can make its absence fail. Asserted here rather than argued, so that if React
    // ever stops translating, this row goes red and the numeric branch becomes the live one.
    const seen: Array<string> = [];
    render(<button onKeyDown={(e) => seen.push(e.key)}>probe</button>);
    const probe = screen.getByText('probe');
    act(() => {
      probe.focus();
    });
    for (const init of [
      { key: 'Unidentified', keyCode: 39 },
      { key: '', keyCode: 37 },
      { key: 'Right', keyCode: 0 },
      { key: 'Unidentified', keyCode: 461 },
    ]) {
      act(() => {
        probe.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
      });
    }
    expect(seen).toEqual(['ArrowRight', 'ArrowLeft', 'ArrowRight', 'Unidentified']);
  });

  it('CLAIMS Left/Right unconditionally, so the refusal reaches the viewer', () => {
    // THE MOST IMPORTANT MUTATION IN THIS TASK: make the `preventDefault()` conditional on
    // a seek being possible — the diag page's `if (target)` shape, already in this repo —
    // and this test must fail.
    //
    // It asserts the REFUSAL REACHED THE READOUT, not that the ring moved. Task 7 measured
    // that on a one-cell row a horizontal press moves nothing whether it is claimed or not:
    // `move` never wraps left/right between rows (`model.ts:95-97`) and `go` returns at
    // `useFocusGrid.ts:232` before `focus()`. Written the other way this mutation produces
    // a test that cannot fail. What the conditional claim really costs is §7.4's refusal
    // itself: at the ceiling the cell decides nothing, says nothing, and hands the press to
    // the navigation model.
    //
    // NOTE WHICH LINE DOES THE WORK. `e.defaultPrevented` below CANNOT discriminate this
    // mutation and is kept only as a statement of the contract: when the cell declines the
    // press it falls through to the grid, which claims every arrow itself — so the flag is
    // true either way. Measured. The hint assertions are the ones that go red.
    render(<Harness {...AT_FRONTIER} />);
    expect(hint(), 'nothing pending yet').toBe('');
    const e = right();
    expect.soft(e.defaultPrevented, 'the press was claimed at the ceiling').toBe(true);
    expect.soft(hint(), 'the refusal is on screen').toMatch(/hasn’t reached past here/i);
    expect.soft(hint()).toMatch(/up or down cancels/i);
    // The readout did not move, because the press was refused — and says what OK does now.
    expect.soft(bar().textContent).toContain('1:40');
    expect.soft(hint()).not.toMatch(/jumps/i);
  });

  it('keeps the ring on the bar at the ceiling, with a sibling in its row to prove it', () => {
    // The two-cell fixture: the smallest shape that can observe `useFocusGrid.ts:248`'s
    // `if (e.defaultPrevented) return`. Not the shipping layout — the scrub cell ships alone
    // in its row — but it is what pins the claim itself, and it is the reason the claim is
    // unconditional rather than merely tidy: a future sibling here must be unreachable, not
    // double-acting (the web player's ±20s double-seek is one window handler and one nested
    // handler both acting on one press).
    render(<Harness {...AT_FRONTIER} siblings={1} />);
    const start = bar();
    expect(document.activeElement).toBe(start);
    const e = right();
    expect.soft(e.defaultPrevented).toBe(true);
    expect.soft(document.activeElement, 'the grid never saw the arrow').toBe(start);
    expect.soft(screen.getByText('sibling-0')).not.toBe(document.activeElement);
    expect.soft(hint()).toMatch(/hasn’t reached past here/i);
  });

  it('claims every repeat of a held arrow without seeking once', () => {
    const onSeek = vi.fn();
    render(<Harness position={0} onSeek={onSeek} />);
    for (let i = 0; i < 20; i++) {
      const e = right({ repeat: i > 0 });
      expect.soft(e.defaultPrevented, `repeat ${i}`).toBe(true);
    }
    // 20 presses of 10s from 0, with nothing measured, so nothing is clamped.
    expect.soft(bar().textContent).toContain('3:20');
    expect.soft(onSeek).not.toHaveBeenCalled();
  });

  it('commits on OK, once, and then has nothing pending', () => {
    const onSeek = vi.fn();
    render(<Harness position={100} onSeek={onSeek} />);
    right();
    right();
    fireEvent.click(bar());
    expect.soft(onSeek).toHaveBeenCalledTimes(1);
    expect.soft(onSeek).toHaveBeenCalledWith(120);
    expect.soft(hint(), 'the edit is spent').toBe('');
    expect.soft(bar().textContent).toContain('1:40');
  });

  it('refuses nothing silently: OK with no edit open seeks nothing and says what to press', () => {
    const onSeek = vi.fn();
    render(<Harness position={100} onSeek={onSeek} />);
    fireEvent.click(bar());
    expect.soft(onSeek).not.toHaveBeenCalled();
    expect.soft(bar().textContent).toMatch(/left or right/i);
  });

  it('leaves Up and Down to the grid, and moving off cancels the edit', () => {
    // The claim is scoped to one axis on purpose: a cell that claimed Down would be a trap
    // with no Tab key to escape it. The cost is that leaving the row discards the edit,
    // which is why `describeScrub` says so while one is open.
    const onSeek = vi.fn();
    render(<Harness position={100} onSeek={onSeek} />);
    right();
    expect(hint()).toMatch(/up or down cancels/i);
    down();
    expect.soft(document.activeElement, 'Down still works').toBe(screen.getByText('play'));
    up();
    expect.soft(document.activeElement).toBe(bar());
    expect.soft(hint(), 'the edit was cancelled, not committed').toBe('');
    expect.soft(bar().textContent).toContain('1:40');
    expect.soft(onSeek).not.toHaveBeenCalled();
  });

  it('drops a pending edit when the metadata goes away under it', () => {
    // A real path on this surface, not an edge: the recovery ladder calls `v.load()`, which
    // resets `duration` to NaN until `loadedmetadata` lands again — so the row disappears
    // mid-edit and comes back. An edit made against the old reading must not come back with
    // it, because OK would then commit a position nobody chose during the stall.
    const onSeek = vi.fn();
    const { rerender } = render(<Harness position={100} onSeek={onSeek} />);
    right();
    expect(hint()).toMatch(/up or down cancels/i);
    rerender(<Harness position={100} duration={Number.NaN} onSeek={onSeek} />);
    expect.soft(document.querySelector('.bs-player__scrub'), 'the row is gone').toBeNull();
    rerender(<Harness position={100} onSeek={onSeek} />);
    expect.soft(hint(), 'and the edit did not come back with it').toBe('');
    expect.soft(bar().textContent).toContain('1:40');
    expect.soft(onSeek).not.toHaveBeenCalled();
  });

  it('draws three stacked track layers, with the widths as inline styles', () => {
    // The played layer and the measured run are inline widths over a static track, in the
    // `.bs-card__bar` language. The run is drawn from `run_start`, not from 0: on a pack
    // episode the contiguous region legitimately begins well into the file.
    const { container } = render(
      <Harness position={250} contiguous={run(600, 1000, 100)} />,
    );
    const track = container.querySelector('.bs-player__track');
    const ready = container.querySelector<HTMLElement>('.bs-player__ready');
    const played = container.querySelector<HTMLElement>('.bs-player__played');
    expect.soft(track).not.toBeNull();
    expect.soft(ready?.style.left).toBe('10%');
    expect.soft(ready?.style.width).toBe('50%');
    expect.soft(played?.style.width).toBe('25%');
    // The pending edit is what the bar points at while one is open.
    right();
    expect.soft(container.querySelector<HTMLElement>('.bs-player__played')?.style.width).toBe('26%');
  });

  it('draws no measured run at all when nothing was measured', () => {
    // `contiguous: null` means UNKNOWN, and unknown is not zero — but it is also not a
    // length this may draw. The hint says so in words instead.
    const { container } = render(<Harness position={250} contiguous={null} />);
    expect.soft(container.querySelector<HTMLElement>('.bs-player__ready')?.style.width).toBe('0%');
    expect.soft(container.querySelectorAll('.bs-player__track > *')).toHaveLength(2);
  });

  it('keeps every drawn width inside the track, whatever the arithmetic says', () => {
    // The bytes-to-seconds conversion on this surface is CBR arithmetic over a VBR file, so
    // a position past its own duration is legitimate, not a bug to crash on.
    const { container } = render(<Harness position={2000} contiguous={run(4000, 1000, -50)} />);
    for (const el of container.querySelectorAll<HTMLElement>('.bs-player__track > *')) {
      const n = Number.parseFloat(el.style.width);
      expect.soft(n, el.className).toBeGreaterThanOrEqual(0);
      expect.soft(n, el.className).toBeLessThanOrEqual(100);
      expect.soft(Number.parseFloat(el.style.left || '0'), el.className).toBeGreaterThanOrEqual(0);
    }
  });

  it('owns no focus grid, writes no currentTime and reaches no network', () => {
    const src = readFileSync(join(process.cwd(), 'src/app/(bigscreen)/_player/ScrubBar.tsx'), 'utf8');
    expect.soft(src, 'a child grid would silently claim the arrows').not.toMatch(/useFocusGrid\s*\(/);
    expect.soft(src, 'the listener must be React-synthetic, not a window one').not.toMatch(/addEventListener/);
    expect.soft(src, 'no per-press seek').not.toMatch(/currentTime\s*=/);
    expect.soft(src, 'no network from a control surface').not.toMatch(/fetch\s*\(|axios|apiClient/);
    const added: string[] = [];
    const spy = vi.spyOn(window, 'addEventListener').mockImplementation(((type: string) => {
      added.push(type);
    }) as typeof window.addEventListener);
    render(
      <ScrubBar row={0} focusProps={fp()} position={10} duration={DURATION} contiguous={null} onSeek={() => {}} />,
    );
    spy.mockRestore();
    expect.soft(added).toEqual([]);
  });

  it('leaves a key it does not act on completely alone', () => {
    // `preventDefault()` on a key this does not act on is how Back stops working on a device
    // nobody can attach a debugger to (`useBackKey.ts:35`).
    render(<Harness position={100} />);
    for (const init of [
      { key: 'Unidentified', keyCode: 461 },
      { key: 'Enter', keyCode: 13 },
      { key: 'Unidentified', keyCode: 38 },
      { key: 'a', keyCode: 65 },
    ]) {
      const e = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
      // Read on `document`, in the BUBBLE phase: React's own listener sits on the root
      // container inside <body>, so by here the cell has had the press and decided — while
      // `window`, where the grid listens, has not seen it yet. Stopping it there is what
      // isolates the CELL's decision from the grid's (Up and Down are the grid's to claim,
      // and would otherwise read as this cell claiming them).
      const claimed = { value: true };
      const stop = (ev: Event) => {
        claimed.value = ev.defaultPrevented;
        ev.stopPropagation();
      };
      document.addEventListener('keydown', stop);
      act(() => {
        (document.activeElement ?? document.body).dispatchEvent(e);
      });
      document.removeEventListener('keydown', stop);
      expect.soft(claimed.value, `${init.key}/${init.keyCode}`).toBe(false);
    }
  });
});
