import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { render, screen, fireEvent } from '@testing-library/react';
import type { FocusProps } from '../_focus/useFocusGrid';
import { Keyboard, KEY_ROWS, KEYBOARD_ROW_COUNTS, type KeyAction } from './Keyboard';

const props = (): FocusProps => ({ tabIndex: -1, ref: () => {}, onFocus: () => {} });

const keys = () => screen.getAllByRole('button');

describe('Keyboard', () => {
  it('declares its row counts FROM the layout, so the two cannot drift', () => {
    expect(KEYBOARD_ROW_COUNTS).toEqual(KEY_ROWS.map((r) => r.length));
    // Not a hand-written list: the derivation is the point. Pin the shape too, so a layout
    // change is a deliberate edit rather than a silent reshuffle of the focus grid.
    expect(KEYBOARD_ROW_COUNTS.length).toBe(KEY_ROWS.length);
    expect(KEYBOARD_ROW_COUNTS.every((n) => n > 0)).toBe(true);
  });

  it('renders one container per declared row, with exactly that many cells', () => {
    const { container } = render(<Keyboard rowOffset={0} focusProps={props} onPress={() => {}} />);
    const rows = container.querySelectorAll('.bs-kb__row');
    expect(rows).toHaveLength(KEYBOARD_ROW_COUNTS.length);
    rows.forEach((row, i) => {
      expect(row.querySelectorAll('button'), `row ${i}`).toHaveLength(KEYBOARD_ROW_COUNTS[i]);
    });
    // And nothing else: the total rendered equals the total declared.
    expect(keys()).toHaveLength(KEYBOARD_ROW_COUNTS.reduce((a, b) => a + b, 0));
  });

  it('offers A-Z, 0-9, Space, Delete and Clear — and nothing else', () => {
    render(<Keyboard rowOffset={0} focusProps={props} onPress={() => {}} />);
    const labels = keys().map((k) => k.textContent);
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
    const digits = '0123456789'.split('');
    expect(labels).toEqual([...letters, ...digits, 'Space', 'Delete', 'Clear']);
  });

  it('every cell is a real stop that does something — no blank and no disabled key', () => {
    const onPress = vi.fn();
    render(<Keyboard rowOffset={0} focusProps={props} onPress={onPress} />);
    const all = keys();
    for (const key of all) {
      expect(key.textContent?.trim(), 'a blank cell makes Down land somewhere surprising').not.toBe('');
      expect(key, 'a disabled key is a focus stop that refuses to act').not.toBeDisabled();
      expect(key).toHaveAttribute('type', 'button');
    }
    for (const key of all) fireEvent.click(key);
    expect(onPress).toHaveBeenCalledTimes(all.length);
  });

  it('reports the action behind each cell: a character, a delete, or a clear', () => {
    const onPress = vi.fn();
    render(<Keyboard rowOffset={0} focusProps={props} onPress={onPress} />);
    const press = (name: string) => {
      onPress.mockClear();
      fireEvent.click(screen.getByRole('button', { name }));
      return onPress.mock.calls.map((call) => call[0] as KeyAction);
    };
    expect(press('A')).toEqual([{ kind: 'char', char: 'A' }]);
    expect(press('Z')).toEqual([{ kind: 'char', char: 'Z' }]);
    expect(press('7')).toEqual([{ kind: 'char', char: '7' }]);
    expect(press('Space')).toEqual([{ kind: 'char', char: ' ' }]);
    expect(press('Delete')).toEqual([{ kind: 'delete' }]);
    expect(press('Clear')).toEqual([{ kind: 'clear' }]);
  });

  it('asks for focus props at rowOffset + its own row, one per column', () => {
    const spy = vi.fn(props);
    render(<Keyboard rowOffset={4} focusProps={spy} onPress={() => {}} />);
    const expected = KEYBOARD_ROW_COUNTS.flatMap((count, r) =>
      Array.from({ length: count }, (_, c) => [4 + r, c]),
    );
    expect(spy.mock.calls).toEqual(expected);
  });

  it('puts the focus props on the keys themselves, so the ring lands on a cell', () => {
    const refs: Array<HTMLElement | null> = [];
    render(
      <Keyboard
        rowOffset={0}
        focusProps={(row, col) => ({
          tabIndex: row === 0 && col === 2 ? 0 : -1,
          ref: (el) => {
            if (row === 0) refs[col] = el;
          },
          onFocus: () => {},
        })}
        onPress={() => {}}
      />,
    );
    const all = keys();
    expect(document.querySelectorAll('[tabindex="0"]')).toHaveLength(1);
    expect(all[2]).toHaveAttribute('tabindex', '0');
    expect(refs.slice(0, KEYBOARD_ROW_COUNTS[0])).toEqual(all.slice(0, KEYBOARD_ROW_COUNTS[0]));
  });

  it('owns no focus grid: one screen means one live useFocusGrid', () => {
    // The keyboard rows and the results rows are rows of the SAME grid, so this component
    // must take focus props rather than make them. Two live grids on one screen both answer
    // the arrows and the incoming one is left inert.
    // Checked as CODE, not as text: the doc comment above the component explains the rule
    // and names both hooks, which is the right place for it to say so.
    const src = readFileSync('src/app/(bigscreen)/_components/Keyboard.tsx', 'utf8');
    expect(src, 'must not call useFocusGrid').not.toMatch(/useFocusGrid\s*\(/);
    expect(src, 'must not call useBackKey').not.toMatch(/useBackKey\s*\(/);
    // The only thing it takes from _focus is the FocusProps TYPE, so there is no value
    // binding here that could become a second live grid.
    const froms = [...src.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
    expect(froms).toEqual(['../_focus/useFocusGrid']);
    expect(src).toMatch(/import\s+type\s*\{\s*FocusProps\s*\}\s*from\s*'\.\.\/_focus\/useFocusGrid'/);
  });

  it('draws keys inside the safe inset, at a size a remote can hit from ten feet', () => {
    // jsdom cannot measure, so pin the rules that carry the layout contract (spec §8.5).
    const css = readFileSync('public/bigscreen.css', 'utf8');
    const kb = /\.bs-kb\s*\{([^}]*)\}/.exec(css)![1];
    expect(kb).toMatch(/padding:[^;]*var\(--safe-x\)/);
    const key = /\.bs-kb__key\s*\{([^}]*)\}/.exec(css)![1];
    expect(Number(/min-height:\s*(\d+)px/.exec(key)![1])).toBeGreaterThanOrEqual(60);
    // A key is a token the viewer recognises, not prose: the 20px tier (§8.5 as amended).
    expect(Number(/font-size:\s*(\d+)px/.exec(key)![1])).toBeGreaterThanOrEqual(20);
    // The focus ring is the whole navigation model on a remote.
    expect(css).toMatch(/\.bs-kb__key:focus\s*\{[^}]*outline:/);
  });
});
