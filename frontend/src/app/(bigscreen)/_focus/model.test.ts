import { describe, it, expect } from 'vitest';
import { move, clampTarget, firstTarget, isEmptyGrid, NO_TARGET } from './model';

describe('focus model', () => {
  it('reports an empty grid and refuses to invent a target', () => {
    expect(isEmptyGrid([])).toBe(true);
    expect(isEmptyGrid([0, 0, 0])).toBe(true);
    expect(isEmptyGrid([0, 2])).toBe(false);
    expect(firstTarget([0, 0])).toEqual(NO_TARGET);
  });

  it('starts on the first row that actually has items', () => {
    // A rail that has not loaded yet has a count of 0. Landing on it would put focus
    // on a skeleton with nothing to focus, which on a remote is unrecoverable.
    expect(firstTarget([0, 0, 5])).toEqual({ row: 2, col: 0 });
  });

  it('does not wrap horizontally', () => {
    expect(move([3], { row: 0, col: 2 }, 'right', [])).toEqual({ row: 0, col: 2 });
    expect(move([3], { row: 0, col: 0 }, 'left', [])).toEqual({ row: 0, col: 0 });
    expect(move([3], { row: 0, col: 1 }, 'right', [])).toEqual({ row: 0, col: 2 });
  });

  it('does not wrap vertically', () => {
    expect(move([2, 2], { row: 1, col: 0 }, 'down', [])).toEqual({ row: 1, col: 0 });
    expect(move([2, 2], { row: 0, col: 0 }, 'up', [])).toEqual({ row: 0, col: 0 });
  });

  it('skips rows that have no focusable items', () => {
    // REVIEW FOCUS 1: an unloaded or empty rail must not trap focus.
    expect(move([2, 0, 0, 3], { row: 0, col: 1 }, 'down', [])).toEqual({ row: 3, col: 1 });
    expect(move([2, 0, 0, 3], { row: 3, col: 0 }, 'up', [])).toEqual({ row: 0, col: 0 });
  });

  it('stays put when every row below is empty', () => {
    expect(move([2, 0, 0], { row: 0, col: 0 }, 'down', [])).toEqual({ row: 0, col: 0 });
  });

  it('restores each row remembered column on a vertical move', () => {
    const memory = [0, 7];
    expect(move([3, 9], { row: 0, col: 1 }, 'down', memory)).toEqual({ row: 1, col: 7 });
  });

  it('clamps a remembered column that no longer fits', () => {
    // A rail can shrink between visits (a watchlist row loses an item).
    const memory = [0, 7];
    expect(move([3, 2], { row: 0, col: 1 }, 'down', memory)).toEqual({ row: 1, col: 1 });
  });

  it('clamps a target that points at a vanished row', () => {
    expect(clampTarget([2], { row: 4, col: 0 })).toEqual({ row: 0, col: 0 });
    expect(clampTarget([2, 0], { row: 1, col: 0 })).toEqual({ row: 0, col: 0 });
  });

  it('stays up and does not wrap when every row above is empty', () => {
    expect(move([0, 0, 2], { row: 2, col: 1 }, 'up', [])).toEqual({ row: 2, col: 1 });
  });

  it('recovers a `from` that sits on a row which has since emptied', () => {
    // Focus can be on a rail that refetched to zero items between two key presses.
    // Moving "from" a row with nothing in it is meaningless, so it clamps onto the grid.
    expect(move([0, 2], { row: 0, col: 0 }, 'right', [])).toEqual({ row: 1, col: 0 });
    expect(move([0, 2], { row: 0, col: 0 }, 'down', [])).toEqual({ row: 1, col: 0 });
    expect(move([2, 0], { row: 1, col: 0 }, 'left', [])).toEqual({ row: 0, col: 0 });
  });

  it('moves from NO_TARGET onto the first populated row, or nowhere on an empty grid', () => {
    expect(move([0, 2, 2], NO_TARGET, 'down', [])).toEqual({ row: 1, col: 0 });
    expect(move([0, 0], NO_TARGET, 'right', [])).toEqual(NO_TARGET);
  });

  it('treats a NaN count as an empty row rather than inventing a NaN column', () => {
    expect(isEmptyGrid([NaN])).toBe(true);
    expect(firstTarget([NaN, 2])).toEqual({ row: 1, col: 0 });
    expect(clampTarget([NaN, 2], { row: 0, col: 0 })).toEqual({ row: 1, col: 0 });
    expect(move([2, NaN, 3], { row: 0, col: 1 }, 'down', [])).toEqual({ row: 2, col: 1 });
    expect(move([NaN, 2], { row: 0, col: 0 }, 'right', [])).toEqual({ row: 1, col: 0 });
  });

  describe('where the content starts (the `from` argument)', () => {
    // A browsing screen declares its top bar as row 0, so every fall-back through
    // `firstTarget` would otherwise put the ring in the menu.
    it('prefers the first populated row at or after it', () => {
      expect(firstTarget([5, 0, 3, 4], 1)).toEqual({ row: 2, col: 0 });
      expect(firstTarget([5, 3, 4], 1)).toEqual({ row: 1, col: 0 });
    });

    it('is a preference, not a floor: it searches from the top rather than answering nothing', () => {
      // "Always something focused" outranks "never the menu" — a remote has no Tab and no
      // pointer, so a screen with no focus stop cannot be recovered from.
      expect(firstTarget([5, 0, 0], 1)).toEqual({ row: 0, col: 0 });
    });

    it('still answers NO_TARGET when the whole grid is empty', () => {
      expect(firstTarget([0, 0], 1)).toEqual(NO_TARGET);
    });

    it('is ignored when it points past the end, or below zero', () => {
      expect(firstTarget([4, 2], 9)).toEqual({ row: 0, col: 0 });
      expect(firstTarget([4, 2], -3)).toEqual({ row: 0, col: 0 });
    });

    it('defaults to the whole grid, so every existing caller is unchanged', () => {
      expect(firstTarget([5, 0, 3])).toEqual({ row: 0, col: 0 });
      expect(clampTarget([5, 0, 3], { row: 1, col: 0 })).toEqual({ row: 0, col: 0 });
    });

    it('carries through clampTarget, which is where screens actually hit it', () => {
      // The row that empties under the ring: home's recovery panel, replaced by the hero.
      expect(clampTarget([5, 0, 3], { row: 1, col: 0 }, 1)).toEqual({ row: 2, col: 0 });
      // ...and a row that merely shrank still clamps in place, bar or no bar.
      expect(clampTarget([5, 2, 3], { row: 1, col: 7 }, 1)).toEqual({ row: 1, col: 1 });
    });
  });

});
