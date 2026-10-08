import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { memo } from 'react';
import { render, screen, act } from '@testing-library/react';
import { useFocusGrid, type FocusProps } from './useFocusGrid';

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

function fire(init: KeyboardEventInit): KeyboardEvent {
  const e = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  act(() => { window.dispatchEvent(e); });
  return e;
}

function press(key: string, keyCode?: number) {
  fire({ key, keyCode });
}

const storageName = (key: string) => `bs-focus:${key}`;
const seed = (key: string, row: number, col: number) =>
  sessionStorage.setItem(storageName(key), JSON.stringify({ row, col }));
const stored = (key: string) => JSON.parse(sessionStorage.getItem(storageName(key)) ?? 'null');
const scrollSpy = () => Element.prototype.scrollIntoView as ReturnType<typeof vi.fn>;
const settle = (ms = 300) => act(() => { vi.advanceTimersByTime(ms); });

describe('useFocusGrid', () => {
  beforeEach(() => {
    sessionStorage.clear();
    // jsdom does not implement scrollIntoView.
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    // A failing assertion must not leave a throwing getItem, or fake timers, in the next test.
    vi.restoreAllMocks();
    vi.useRealTimers();
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
    // Row 0 remembers column 1 from before we left it, so Up lands there and not on the
    // column (0) we are in now. Row 1 had no memory on the way down, so Down kept column 1.
    expect(document.activeElement).toBe(screen.getByText('0-1'));
  });

  it('skips an empty rail in the middle, through the hook', () => {
    // The load-bearing rule: a rail that has not loaded must not swallow the remote.
    render(<Harness rowCounts={[2, 0, 2]} />);
    press('ArrowDown');
    expect(document.activeElement).toBe(screen.getByText('2-0'));
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

  it('scrolls the focused cell into view with the TV arguments, on mount and on each move', () => {
    render(<Harness rowCounts={[3]} />);
    expect(scrollSpy()).toHaveBeenCalledWith({ block: 'nearest', inline: 'center' });
    scrollSpy().mockClear();
    press('ArrowRight');
    expect(scrollSpy()).toHaveBeenCalledWith({ block: 'nearest', inline: 'center' });
  });

  it('suppresses the browser scroll-on-focus so only the explicit scroll runs', () => {
    const focus = vi.spyOn(HTMLElement.prototype, 'focus');
    render(<Harness rowCounts={[3]} />);
    press('ArrowRight');
    expect(focus).toHaveBeenCalledTimes(2);
    for (const call of focus.mock.calls) expect(call[0]).toEqual({ preventScroll: true });
  });

  it('does not re-scroll when a press cannot move (the end of a rail)', () => {
    render(<Harness rowCounts={[2]} />);
    press('ArrowRight');
    scrollSpy().mockClear();
    press('ArrowRight');
    expect(document.activeElement).toBe(screen.getByText('0-1'));
    expect(scrollSpy()).not.toHaveBeenCalled();
  });

  it.each([
    ['p', { key: 'p' }],
    ['Escape', { key: 'Escape', keyCode: 27 }],
    ['Enter', { key: 'Enter', keyCode: 13 }],
    ['Backspace', { key: 'Backspace', keyCode: 8 }],
    ['the webOS Back key', { key: 'GoBack', keyCode: 461 }],
  ])('does not preventDefault or move on %s', (_name, init) => {
    // REVIEW FOCUS 3: swallowing keys indiscriminately is how Back stops working.
    render(<Harness rowCounts={[2]} />);
    const e = fire(init);
    expect(e.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(screen.getByText('0-0'));
  });

  it.each(['altKey', 'ctrlKey', 'metaKey'])(
    'does not claim an arrow held with %s, which is a browser shortcut and not a remote press',
    (modifier) => {
      render(<Harness rowCounts={[3]} />);
      const e = fire({ key: 'ArrowRight', [modifier]: true });
      expect(e.defaultPrevented).toBe(false);
      expect(document.activeElement).toBe(screen.getByText('0-0'));
    },
  );

  it('leaves an arrow alone when a closer handler has already claimed it', () => {
    // Registered before the hook mounts, so it runs first, as a nested transport bar would.
    const claim = (e: KeyboardEvent) => e.preventDefault();
    window.addEventListener('keydown', claim);
    try {
      render(<Harness rowCounts={[3]} />);
      fire({ key: 'ArrowRight' });
      expect(document.activeElement).toBe(screen.getByText('0-0'));
    } finally {
      window.removeEventListener('keydown', claim);
    }
  });

  it('syncs to a cell the pointer focused, without re-scrolling under the pointer', () => {
    render(<Harness rowCounts={[3]} />);
    scrollSpy().mockClear();
    act(() => { screen.getByText('0-2').focus(); });
    expect(screen.getByText('0-2')).toHaveAttribute('tabindex', '0');
    expect(scrollSpy()).not.toHaveBeenCalled();
    press('ArrowLeft');
    expect(document.activeElement).toBe(screen.getByText('0-1'));
  });

  it('puts focus back on the grid when the focused rail vanishes or shrinks', () => {
    // The focused node is unmounted with the rail; on a remote nothing else can recover it.
    const { rerender } = render(<Harness rowCounts={[3, 3]} />);
    press('ArrowDown');
    rerender(<Harness rowCounts={[3, 0]} />);
    expect(document.activeElement).toBe(screen.getByText('0-0'));

    rerender(<Harness rowCounts={[3, 3]} />);
    press('ArrowDown');
    press('ArrowRight');
    press('ArrowRight');
    expect(document.activeElement).toBe(screen.getByText('1-2'));
    rerender(<Harness rowCounts={[3, 2]} />);
    expect(document.activeElement).toBe(screen.getByText('1-1'));
  });

  it('does not steal or re-scroll when the grid changes shape but the focused cell still fits', () => {
    const focus = vi.spyOn(HTMLElement.prototype, 'focus');
    const { rerender } = render(<Harness rowCounts={[3, 3]} />);
    press('ArrowRight');
    focus.mockClear();
    scrollSpy().mockClear();
    rerender(<Harness rowCounts={[3, 3, 3]} />);
    expect(document.activeElement).toBe(screen.getByText('0-1'));
    expect(focus).not.toHaveBeenCalled();
    expect(scrollSpy()).not.toHaveBeenCalled();
  });

  it('does not pull focus back from outside the grid when a rail loads', () => {
    // Something else (a dialog button) holds focus; a rail finishing its fetch is not a reason to take it.
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    try {
      const { rerender } = render(<Harness rowCounts={[3, 0]} />);
      act(() => { outside.focus(); });
      rerender(<Harness rowCounts={[3, 3]} />);
      expect(document.activeElement).toBe(outside);
    } finally {
      outside.remove();
    }
  });

  it('does nothing when the parent re-renders with a fresh array of the same shape', () => {
    const focus = vi.spyOn(HTMLElement.prototype, 'focus');
    const { rerender } = render(<Harness rowCounts={[3, 3]} />);
    press('ArrowRight');
    focus.mockClear();
    scrollSpy().mockClear();
    rerender(<Harness rowCounts={[3, 3]} />);
    expect(document.activeElement).toBe(screen.getByText('0-1'));
    expect(focus).not.toHaveBeenCalled();
    expect(scrollSpy()).not.toHaveBeenCalled();
  });

  describe('remembering a position (storageKey)', () => {
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
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
      expect(() => render(<Harness rowCounts={[2]} storageKey="home" />)).not.toThrow();
      expect(document.activeElement).toBe(screen.getByText('0-0'));
    });

    it('survives a storage key that cannot be written', () => {
      vi.useFakeTimers();
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied'); });
      const { unmount } = render(<Harness rowCounts={[2]} storageKey="home" />);
      press('ArrowRight');
      expect(() => settle()).not.toThrow();
      expect(() => unmount()).not.toThrow();
    });

    it('ignores a stored value that is not a position', () => {
      sessionStorage.setItem(storageName('home'), JSON.stringify({ row: 'x', col: -1 }));
      render(<Harness rowCounts={[2]} storageKey="home" />);
      expect(document.activeElement).toBe(screen.getByText('0-0'));
    });

    it('holds a restore until its row fills, and never overwrites it with the fallback', () => {
      // Rails load one at a time: the first rail appears long before row 3 does.
      vi.useFakeTimers();
      seed('home', 3, 2);
      const { rerender } = render(<Harness rowCounts={[0, 0, 0, 0]} storageKey="home" />);
      expect(document.activeElement).toBe(document.body);

      rerender(<Harness rowCounts={[5, 0, 0, 0]} storageKey="home" />);
      expect(document.activeElement).toBe(screen.getByText('0-0'));
      settle(1000);
      expect(stored('home')).toEqual({ row: 3, col: 2 });

      rerender(<Harness rowCounts={[5, 0, 0, 5]} storageKey="home" />);
      expect(document.activeElement).toBe(screen.getByText('3-2'));
      settle();
      expect(stored('home')).toEqual({ row: 3, col: 2 });
    });

    it('clamps the pending restore into its row when the row finally fills, shorter than before', () => {
      seed('home', 3, 9);
      const { rerender } = render(<Harness rowCounts={[2, 0, 0, 0]} storageKey="home" />);
      rerender(<Harness rowCounts={[2, 0, 0, 4]} storageKey="home" />);
      expect(document.activeElement).toBe(screen.getByText('3-3'));
    });

    it('lets the viewer cancel a pending restore by moving, and does not yank focus later', () => {
      vi.useFakeTimers();
      seed('home', 3, 2);
      const { rerender } = render(<Harness rowCounts={[0, 0, 0, 0]} storageKey="home" />);
      rerender(<Harness rowCounts={[5, 0, 0, 0]} storageKey="home" />);
      press('ArrowRight');
      expect(document.activeElement).toBe(screen.getByText('0-1'));

      rerender(<Harness rowCounts={[5, 0, 0, 5]} storageKey="home" />);
      expect(document.activeElement).toBe(screen.getByText('0-1'));

      // Persisting resumes from where the viewer went.
      settle();
      expect(stored('home')).toEqual({ row: 0, col: 1 });
    });

    it('treats a press that cannot move as not having moved, so the restore still lands', () => {
      seed('home', 3, 2);
      const { rerender } = render(<Harness rowCounts={[0, 0, 0, 0]} storageKey="home" />);
      rerender(<Harness rowCounts={[5, 0, 0, 0]} storageKey="home" />);
      press('ArrowUp'); // nothing above row 0: the viewer is still looking at the same cell
      rerender(<Harness rowCounts={[5, 0, 0, 5]} storageKey="home" />);
      expect(document.activeElement).toBe(screen.getByText('3-2'));
    });

    it('with nothing stored, falls back to the first populated row and remembers it', () => {
      const { rerender, unmount } = render(<Harness rowCounts={[0, 0]} storageKey="home" />);
      rerender(<Harness rowCounts={[0, 2]} storageKey="home" />);
      expect(document.activeElement).toBe(screen.getByText('1-0'));
      unmount();
      expect(stored('home')).toEqual({ row: 1, col: 0 });
    });

    it('writes on a trailing timer, not once per key repeat', () => {
      vi.useFakeTimers();
      const setItem = vi.spyOn(Storage.prototype, 'setItem');
      render(<Harness rowCounts={[5]} storageKey="home" />);
      press('ArrowRight');
      press('ArrowRight');
      press('ArrowRight');
      expect(setItem).not.toHaveBeenCalled();
      settle();
      expect(setItem).toHaveBeenCalledTimes(1);
      expect(stored('home')).toEqual({ row: 0, col: 3 });
    });

    it('flushes a queued write on unmount', () => {
      vi.useFakeTimers();
      const { unmount } = render(<Harness rowCounts={[5]} storageKey="home" />);
      press('ArrowRight');
      expect(stored('home')).toBeNull();
      unmount();
      expect(stored('home')).toEqual({ row: 0, col: 1 });
    });

    it('starts afresh when a surviving instance is handed a different key', () => {
      seed('b', 1, 2);
      const { rerender, unmount } = render(<Harness rowCounts={[3, 3]} storageKey="a" />);
      press('ArrowRight');
      rerender(<Harness rowCounts={[3, 3]} storageKey="b" />);
      expect(document.activeElement).toBe(screen.getByText('1-2'));
      expect(stored('a')).toEqual({ row: 0, col: 1 });

      press('ArrowLeft');
      unmount();
      expect(stored('b')).toEqual({ row: 1, col: 1 });
      expect(stored('a')).toEqual({ row: 0, col: 1 });
    });
  });

  describe('cell props', () => {
    it('hands a memoised card the same props object until its own tabIndex flips', () => {
      const renders: Record<string, number> = {};
      const Card = memo(function Card({ label, fp }: { label: string; fp: FocusProps }) {
        renders[label] = (renders[label] ?? 0) + 1;
        return <button {...fp}>{label}</button>;
      });
      function MemoHarness({ rowCounts }: { rowCounts: number[] }) {
        const grid = useFocusGrid({ rowCounts });
        return (
          <div>
            {rowCounts.flatMap((count, row) =>
              Array.from({ length: count }, (_, col) => (
                <Card key={`${row}-${col}`} label={`${row}-${col}`} fp={grid.focusProps(row, col)} />
              )),
            )}
          </div>
        );
      }

      render(<MemoHarness rowCounts={[3, 3]} />);
      const before = { ...renders };
      press('ArrowRight');

      // Only the cell that lost focus and the one that gained it re-render.
      const rerendered = Object.keys(renders).filter((k) => renders[k] !== before[k]).sort();
      expect(rerendered).toEqual(['0-0', '0-1']);
      expect(document.activeElement).toBe(screen.getByText('0-1'));
    });
  });
});
