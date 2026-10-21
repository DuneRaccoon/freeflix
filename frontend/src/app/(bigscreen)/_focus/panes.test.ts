import { describe, it, expect } from 'vitest';
import { type FocusTarget } from './model';
import { type PaneLayout, type PaneMemory, paneMove, paneOf } from './panes';

/**
 * The search screen's shape, which is what this file is written against:
 *
 *   row 0        the top bar (outside both panes)
 *   rows 1-7     LEFT: six keyboard lines, then the action row
 *   rows 8-11    RIGHT: four result rows
 */
const LAYOUT: PaneLayout = { left: [1, 7], right: [8, 11] };
const BAR = 5;
const KEYS = 10;
/** Bar, six keyboard rows, an action row, four result rows of four. */
const COUNTS = [BAR, KEYS, KEYS, KEYS, KEYS, KEYS, KEYS, 2, 4, 4, 4, 4];
const NO_MEMORY = (): PaneMemory => ({ left: null, right: null });
const at = (row: number, col: number): FocusTarget => ({ row, col });

const press = (
  from: FocusTarget,
  dir: Parameters<typeof paneMove>[4],
  opts: { counts?: readonly number[]; memory?: PaneMemory; colMemory?: readonly number[] } = {},
) =>
  paneMove(
    LAYOUT,
    opts.memory ?? NO_MEMORY(),
    opts.counts ?? COUNTS,
    from,
    dir,
    opts.colMemory ?? [],
  );

describe('paneOf', () => {
  it('names the pane a row belongs to, and nothing for the bar', () => {
    expect(paneOf(LAYOUT, 0)).toBeNull();
    expect(paneOf(LAYOUT, 1)).toBe('left');
    expect(paneOf(LAYOUT, 7)).toBe('left');
    expect(paneOf(LAYOUT, 8)).toBe('right');
    expect(paneOf(LAYOUT, 11)).toBe('right');
    expect(paneOf(LAYOUT, 12)).toBeNull();
  });
});

describe('vertical containment', () => {
  it('keeps Down inside the left pane', () => {
    expect(press(at(1, 3), 'down')).toEqual(at(2, 3));
  });

  it('REFUSES Down off the bottom of the left pane instead of landing in the results', () => {
    // THE DEFECT THIS FILE EXISTS FOR. Plain `move` goes to the next populated row, which
    // is the first result row — beside the keyboard rather than below it. The ring would
    // jump across the screen for a press that means "further down this keyboard".
    expect(press(at(7, 0), 'down')).toEqual(at(7, 0));
  });

  it('keeps Down inside the right pane and refuses off its bottom', () => {
    expect(press(at(8, 2), 'down')).toEqual(at(9, 2));
    expect(press(at(11, 2), 'down')).toEqual(at(11, 2));
  });

  it('takes Up off the top of EITHER pane to the bar, which is above both', () => {
    // The one vertical move that leaves a pane: the bar is how a viewer gets out of either,
    // and Up is where they reach for it.
    expect(press(at(1, 0), 'up')).toEqual(at(0, 0));
    expect(press(at(8, 0), 'up')).toEqual(at(0, 0));
  });

  it('does not take Up from the right pane to the keyboard row beside it', () => {
    // Row 7 is the action row and is `8 - 1`, so plain `move` would land there from the
    // first result row — a row that is to the LEFT, not above.
    expect(press(at(8, 1), 'up').row).not.toBe(7);
  });

  it('skips an empty row inside a pane rather than landing on it', () => {
    // A ring on a row with no cells is a ring on nothing, and a remote has no Tab.
    const counts = [BAR, KEYS, 0, KEYS, KEYS, KEYS, KEYS, 2, 4, 4, 4, 4];
    expect(press(at(1, 0), 'down', { counts })).toEqual(at(3, 0));
  });

  it('refuses when every row further on in the pane is empty', () => {
    const counts = [BAR, KEYS, 0, 0, 0, 0, 0, 0, 4, 4, 4, 4];
    expect(press(at(1, 0), 'down', { counts })).toEqual(at(1, 0));
  });

  it('clamps the column into the row it lands on', () => {
    // The action row has 2 cells; a keyboard column of 9 would be off the end of it.
    expect(press(at(6, 9), 'down')).toEqual(at(7, 1));
  });

  it('honours the per-row column memory', () => {
    const colMemory: number[] = [];
    colMemory[9] = 3;
    expect(press(at(8, 0), 'down', { colMemory })).toEqual(at(9, 3));
  });
});

describe('horizontal movement inside a row', () => {
  it('moves along the row and does not wrap', () => {
    expect(press(at(1, 0), 'right')).toEqual(at(1, 1));
    expect(press(at(1, 5), 'left')).toEqual(at(1, 4));
    expect(press(at(1, 0), 'left')).toEqual(at(1, 0));
  });

  it('refuses Left at the start of a LEFT row, because there is nothing to its left', () => {
    expect(press(at(3, 0), 'left')).toEqual(at(3, 0));
  });

  it('refuses Right at the end of a RIGHT row', () => {
    expect(press(at(9, 3), 'right')).toEqual(at(9, 3));
  });
});

describe('crossing between panes', () => {
  it('Right from the end of a keyboard row enters the results', () => {
    // The ask, in one assertion: "Right from the last key enters the results".
    expect(press(at(1, KEYS - 1), 'right')).toEqual(at(8, 0));
  });

  it('Left from the first result of a row returns to the keyboard', () => {
    // ...and lands on the LAST cell, so the ring keeps travelling the way it was pushed.
    expect(press(at(8, 0), 'left')).toEqual(at(1, KEYS - 1));
  });

  it('returns to the row each pane was last on', () => {
    const memory: PaneMemory = { left: 4, right: 10 };
    expect(press(at(4, KEYS - 1), 'right', { memory })).toEqual(at(10, 0));
    expect(press(at(10, 0), 'left', { memory })).toEqual(at(4, KEYS - 1));
  });

  it('ignores a remembered row that has since emptied', () => {
    // A results grid shrinks on every new search, so the row the viewer was on may not
    // exist by the time they cross back to it.
    const counts = [BAR, KEYS, KEYS, KEYS, KEYS, KEYS, KEYS, 2, 4, 0, 0, 0];
    const memory: PaneMemory = { left: 1, right: 10 };
    expect(press(at(1, KEYS - 1), 'right', { counts, memory })).toEqual(at(8, 0));
  });

  it('ignores a remembered row that belongs to the other pane', () => {
    const memory: PaneMemory = { left: 9, right: 2 };
    expect(press(at(1, KEYS - 1), 'right', { memory })).toEqual(at(8, 0));
    expect(press(at(8, 0), 'left', { memory })).toEqual(at(1, KEYS - 1));
  });

  it('refuses to cross into a pane with nothing in it', () => {
    // No results yet: Right from the keyboard has nowhere to go, and saying so is better
    // than putting the ring on an empty grid.
    const counts = [BAR, KEYS, KEYS, KEYS, KEYS, KEYS, KEYS, 2, 0, 0, 0, 0];
    expect(press(at(1, KEYS - 1), 'right', { counts })).toEqual(at(1, KEYS - 1));
  });

  it('crosses only from the EDGE of a row, never from inside it', () => {
    // Right in the middle of the keyboard is a keyboard press, not a pane change.
    expect(press(at(1, 2), 'right')).toEqual(at(1, 3));
  });

  it('crosses from a one-cell row, where the edge is also the start', () => {
    const counts = [BAR, 1, KEYS, KEYS, KEYS, KEYS, KEYS, 2, 4, 4, 4, 4];
    expect(press(at(1, 0), 'right', { counts })).toEqual(at(8, 0));
    // ...and Left from that same cell still refuses, because there is no pane to its left.
    expect(press(at(1, 0), 'left', { counts })).toEqual(at(1, 0));
  });
});

describe('the top bar, which is in neither pane', () => {
  it('moves along itself exactly as any other screen does', () => {
    expect(press(at(0, 0), 'right')).toEqual(at(0, 1));
    expect(press(at(0, BAR - 1), 'right')).toEqual(at(0, BAR - 1));
    expect(press(at(0, 0), 'left')).toEqual(at(0, 0));
    expect(press(at(0, 0), 'up')).toEqual(at(0, 0));
  });

  it('comes Down into the left pane, which is where the typing is', () => {
    expect(press(at(0, 0), 'down')).toEqual(at(1, 0));
  });

  it('comes Down into the pane the viewer was last in', () => {
    const memory: PaneMemory = { left: null, right: 9 };
    expect(press(at(0, 2), 'down', { memory })).toEqual(at(9, 0));
  });

  it('prefers the LEFT pane whenever the viewer has been in it', () => {
    const memory: PaneMemory = { left: 3, right: 9 };
    expect(press(at(0, 2), 'down', { memory })).toEqual(at(3, 0));
  });

  it('falls through to a plain move when neither pane has anything', () => {
    const counts = [BAR, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    expect(press(at(0, 1), 'down', { counts })).toEqual(at(0, 1));
  });
});

describe('a row outside the layout entirely', () => {
  it('is handed to the plain model rather than guessed at', () => {
    // 12 is past both ranges. The screen should never produce one, and if it does the
    // answer is the ordinary one rather than an exception.
    const counts = [...COUNTS, 3];
    expect(press(at(12, 0), 'right', { counts })).toEqual(at(12, 1));
  });
});
