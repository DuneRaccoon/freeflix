'use client';
import type { FocusProps } from '../_focus/useFocusGrid';

/**
 * The D-pad keyboard: the only way text is entered on this surface.
 *
 * IT OWNS NO FOCUS GRID, AND THAT IS THE WHOLE DESIGN. The profiles keypad
 * (`bigscreen/profiles/page.tsx`) calls `useFocusGrid` itself, which it can because that
 * keypad IS the whole screen. Here the keyboard rows and the search results are rows of the
 * SAME grid: `useFocusGrid` listens on `window` and whichever instance registered first
 * claims an arrow, so two live grids on one screen leave the incoming one inert (and
 * `useBackKey` records the identical rule for Back). So this takes `focusProps` and a
 * `rowOffset` from the screen, and the screen concatenates `KEYBOARD_ROW_COUNTS` with its
 * own rows into one `rowCounts`.
 *
 * `KEYBOARD_ROW_COUNTS` IS DERIVED FROM `KEY_ROWS`, never written by hand. The focus model's
 * contract is that a row's declared count equals the cells rendered, and a hand-kept list
 * beside a layout is exactly how the two drift: one count too high leaves a phantom cell
 * that takes the ring and gives it to no element, which a remote cannot recover from.
 *
 * NO BLANK AND NO DISABLED CELL. Same two rules the TV keypad took from the web's
 * `PasscodePrompt`: a blank cell makes Down from the key above land somewhere surprising,
 * and a disabled key is a focus stop that refuses to act. Every cell here does something.
 *
 * CLEAR IS LOAD-BEARING, not a convenience. `useBackKey` acts once per press even when the
 * key is held (`if (e.repeat) return`, deliberate — Back is an escalation), so without Clear
 * erasing a 20-character query costs 20 discrete presses.
 */

/** What a key does. The screen owns the query, so a press reports an intent, not a result. */
export type KeyAction = { kind: 'char'; char: string } | { kind: 'delete' } | { kind: 'clear' };

export interface KeyDef {
  /** React key; also the label for a character cell. */
  id: string;
  label: string;
  /**
   * How wide the key is drawn: a single glyph, or a word (Space, Delete, Clear) that needs
   * room. It is a field rather than a CSS position (`.bs-kb__row:last-child .bs-kb__key`)
   * because a positional rule silently moves which keys are wide the moment a row is
   * appended — a pattern this stylesheet had already eliminated once.
   */
  variant: 'glyph' | 'word';
  action: KeyAction;
}

/**
 * Alphabetical, not QWERTY: a viewer scanning for a letter with a D-pad reads the alphabet,
 * and QWERTY only pays off for ten fingers. Row widths (7/7/7/5/10/3) all fit the 1728px
 * inside the safe area at the 120px key width in the stylesheet — the widest is the digit
 * row at 10*120 + 9*16 = 1344px.
 */
const LETTER_ROWS = ['ABCDEFG', 'HIJKLMN', 'OPQRSTU', 'VWXYZ'] as const;
const DIGITS = '0123456789';

const charKey = (ch: string): KeyDef => ({
  id: ch,
  label: ch,
  variant: 'glyph',
  action: { kind: 'char', char: ch },
});

export const KEY_ROWS: readonly (readonly KeyDef[])[] = [
  ...LETTER_ROWS.map((row) => [...row].map(charKey)),
  [...DIGITS].map(charKey),
  [
    // A space is just a character; the screen trims the query before it searches.
    { id: 'space', label: 'Space', variant: 'word', action: { kind: 'char', char: ' ' } },
    { id: 'delete', label: 'Delete', variant: 'word', action: { kind: 'delete' } },
    { id: 'clear', label: 'Clear', variant: 'word', action: { kind: 'clear' } },
  ],
];

/** One entry per row, each the number of cells that row renders. Derived; never hand-written. */
export const KEYBOARD_ROW_COUNTS: readonly number[] = KEY_ROWS.map((r) => r.length);

export function Keyboard({
  rowOffset,
  focusProps,
  onPress,
}: {
  /** Grid row of the keyboard's first row; each following row is the next one. */
  rowOffset: number;
  focusProps: (row: number, col: number) => FocusProps;
  onPress: (action: KeyAction) => void;
}) {
  return (
    // One container per row, and the rows do not wrap, so the rows the focus model counts
    // are the rows the viewer sees (the same reason the profile grid chunks its rows).
    <div className="bs-kb" role="group" aria-label="Keyboard">
      {KEY_ROWS.map((row, r) => (
        <div key={r} className="bs-kb__row">
          {row.map((k, c) => (
            <button
              key={k.id}
              type="button"
              className={`bs-kb__key bs-kb__key--${k.variant}`}
              {...focusProps(rowOffset + r, c)}
              onClick={() => onPress(k.action)}
            >
              {k.label}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
