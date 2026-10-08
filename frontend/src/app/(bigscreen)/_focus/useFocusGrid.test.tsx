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
    // Row 0 remembers column 1 from before we left it, so Up lands there and not on the
    // column (0) we are in now. Row 1 had no memory on the way down, so Down kept column 1.
    expect(document.activeElement).toBe(screen.getByText('0-1'));
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

  it('does not claim a modified arrow, which is a browser shortcut and not a remote press', () => {
    render(<Harness rowCounts={[3]} />);
    const e = new KeyboardEvent('keydown', { key: 'ArrowRight', altKey: true, bubbles: true, cancelable: true });
    act(() => { window.dispatchEvent(e); });
    expect(e.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(screen.getByText('0-0'));
  });

  it('syncs to a cell the pointer focused, without re-scrolling under the pointer', () => {
    render(<Harness rowCounts={[3]} />);
    (Element.prototype.scrollIntoView as ReturnType<typeof vi.fn>).mockClear();
    act(() => { screen.getByText('0-2').focus(); });
    expect(screen.getByText('0-2')).toHaveAttribute('tabindex', '0');
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
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

  it('does not steal focus when the grid changes shape but the focused cell still fits', () => {
    const { rerender } = render(<Harness rowCounts={[3, 3]} />);
    press('ArrowRight');
    rerender(<Harness rowCounts={[3, 3, 3]} />);
    expect(document.activeElement).toBe(screen.getByText('0-1'));
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
