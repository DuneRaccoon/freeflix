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

  it('marks a word key as a word key, so no CSS rule has to count rows', () => {
    // The variant replaces a `.bs-kb__row:last-child .bs-kb__key` positional selector. A
    // positional rule means appending a row silently moves which keys are wide — and this
    // stylesheet had already eliminated that pattern once. Derived from the label, so a new
    // key cannot be added with the wrong variant.
    for (const row of KEY_ROWS) {
      for (const k of row) {
        expect(k.variant, k.id).toBe(k.label.length === 1 ? 'glyph' : 'word');
      }
    }
    expect(KEY_ROWS.flat().filter((k) => k.variant === 'word').map((k) => k.label)).toEqual([
      'Space',
      'Delete',
      'Clear',
    ]);
  });

  it('puts each key’s variant on the key as a modifier class', () => {
    render(<Keyboard rowOffset={0} focusProps={props} onPress={() => {}} />);
    const defs = KEY_ROWS.flat();
    keys().forEach((el, i) => {
      expect(el, defs[i].id).toHaveClass('bs-kb__key');
      expect(el, defs[i].id).toHaveClass(`bs-kb__key--${defs[i].variant}`);
    });
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
    // Everything it takes from `_focus` is type-only, so no value binding here could become
    // a second live grid. Asserted as "every _focus import is type-only" rather than by
    // freezing the whole import list: this file is free to import anything else (`memo`
    // from react, say) without that being a focus-ownership question.
    // `[^;]*?` and a line-anchored `import`, so one statement's clause cannot run into the
    // next one's path (`import { memo } from 'react';` followed by the type import below
    // read as a single non-type import otherwise — the first version of this did).
    const focusImports = [...src.matchAll(/^import\s+([^;]*?)from\s+'(\.\.\/_focus\/[^']*)'/gm)];
    expect(focusImports.length, 'imports something from _focus').toBeGreaterThan(0);
    /** `import type { X } from` and `import { type X } from` are both type-only. */
    const isTypeOnly = (clause: string): boolean => {
      const c = clause.trim();
      if (c.startsWith('type')) return true;
      const named = /^\{([^}]*)\}$/.exec(c);
      return (
        !!named &&
        named[1]
          .split(',')
          .filter((s) => s.trim())
          .every((s) => /^type\s/.test(s.trim()))
      );
    };
    for (const [, clause, spec] of focusImports) {
      expect(isTypeOnly(clause), `${spec} must be a type-only import, not \`${clause.trim()}\``).toBe(true);
    }
    // And the one thing it needs from there is the props type. Asserted on the specifier
    // list, not on one spelling of the statement: `import type { X }` and
    // `import { type X }` are both fine, and the loop above is what rules out a value.
    expect(focusImports.map(([, , spec]) => spec)).toEqual(['../_focus/useFocusGrid']);
    expect(src).toMatch(/FocusProps/);
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
    // The word keys get their own block (a modifier class, not a positional selector), and
    // it may not drop below the same floor. Its own rule, so the regex above cannot read it
    // by accident.
    const word = /\.bs-kb__key--word\s*\{([^}]*)\}/.exec(css)![1];
    expect(Number(/font-size:\s*(\d+)px/.exec(word)![1])).toBeGreaterThanOrEqual(20);
    expect(word, 'a word key sets no min-height of its own').not.toMatch(/min-height:/);
    // No positional rule may decide which keys are wide. Comments stripped first: the
    // stylesheet's own comment explains why such a rule is banned, and naming it there is
    // the point.
    const code = css.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(code).not.toMatch(/\.bs-kb__row:(last|first|nth)[^{]*\{/);
    // The focus ring is the whole navigation model on a remote.
    expect(css).toMatch(/\.bs-kb__key:focus\s*\{[^}]*outline:/);
  });
});
