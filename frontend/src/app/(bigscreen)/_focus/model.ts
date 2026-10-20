/**
 * The pure half of D-pad navigation: where focus goes next on a grid of rails.
 *
 * No React, no DOM, no imports. The grid is described only by how many focusable
 * items each row currently has, because that is all the TV surface knows: rails
 * load independently, so a row with `0` items is the normal case (still loading,
 * or the catalog call failed and was swallowed), not an edge case.
 */

export interface FocusTarget {
  row: number;
  col: number;
}

export type Direction = 'up' | 'down' | 'left' | 'right';

/** rowCounts[i] is the number of focusable items in row i. 0 means "not focusable yet". */
export type RowCounts = readonly number[];

/** "Nothing is focused." Frozen so a shared reference cannot be mutated by a caller. */
export const NO_TARGET: FocusTarget = Object.freeze({ row: -1, col: -1 });

/** Items in a row; a row that does not exist counts as empty. */
function countOf(rowCounts: RowCounts, row: number): number {
  return rowCounts[row] ?? 0;
}

/**
 * The single definition of "this row can be focused". Written as a positive
 * comparison so a NaN count (which fails every comparison) reads as empty everywhere
 * instead of slipping past a `<= 0` check and producing a NaN column.
 */
function hasItems(n: number | undefined): boolean {
  return (n ?? 0) > 0;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(Math.max(n, min), max);
}

/** True when there is nothing anywhere to focus (also true for no rows at all). */
export function isEmptyGrid(rowCounts: RowCounts): boolean {
  return !rowCounts.some(hasItems);
}

/**
 * The first row that actually has items, column 0.
 *
 * Not simply `{0, 0}`: a rail that has not loaded has a count of 0, and landing on
 * it would leave nothing focused. On a remote there is no Tab and no pointer to
 * recover with, so the screen would be stuck.
 *
 * `from` IS WHERE THE CONTENT STARTS, and it exists because of the top bar. A browsing
 * screen declares that bar as row 0, so without this every fall-back — the first paint, a
 * rail emptying, a panel being replaced by the hero it held the place of — puts the ring in
 * the MENU. On a television the ring belongs on the content; the menu is one Up press away,
 * which is where a viewer reaches for it.
 *
 * IT IS A PREFERENCE, NOT A FLOOR. If nothing at or after `from` has items, the search
 * starts again from the top — so a screen whose content has not arrived yet still has a
 * focus stop (the bar), rather than none at all. "Always something focused" outranks "never
 * the menu".
 */
export function firstTarget(rowCounts: RowCounts, from = 0): FocusTarget {
  for (let r = Math.max(0, from); r < rowCounts.length; r++) {
    if (hasItems(rowCounts[r])) return { row: r, col: 0 };
  }
  const row = rowCounts.findIndex(hasItems);
  return row === -1 ? NO_TARGET : { row, col: 0 };
}

/**
 * Pull a possibly stale target back onto the grid.
 *
 * A rail can shrink or vanish between visits (a watchlist row loses an item, a
 * refetch comes back empty). A row that is gone or empty falls back to
 * `firstTarget`; a row that is merely shorter clamps the column to its last item.
 *
 * `from` is handed straight to `firstTarget`: see there for why a screen with a top bar
 * needs the fall-back to prefer the content under it.
 */
export function clampTarget(rowCounts: RowCounts, t: FocusTarget, from = 0): FocusTarget {
  const n = countOf(rowCounts, t.row);
  if (!hasItems(n)) return firstTarget(rowCounts, from);
  return { row: t.row, col: clamp(t.col, 0, n - 1) };
}

/**
 * One D-pad press.
 *
 * - Left/right stay in the row and never wrap; at either end `from` is returned.
 * - Up/down skip every row with no items (see `firstTarget` for why an empty row
 *   must never be landed on) and never wrap; with no populated row in that
 *   direction `from` is returned.
 * - A vertical move lands on the column that row last held (`columnMemory`), else
 *   keeps the column the user is already in. Either way it is clamped into the
 *   target row, so a remembered column from a rail that has since shrunk is safe.
 *
 * `from` is expected to be on the grid (run it through `clampTarget` first). If it
 * is not, it is clamped here rather than moved from, so a stale target cannot
 * produce an off-grid result.
 */
export function move(
  rowCounts: RowCounts,
  from: FocusTarget,
  dir: Direction,
  columnMemory: readonly number[],
): FocusTarget {
  const here = countOf(rowCounts, from.row);
  if (!hasItems(here)) return clampTarget(rowCounts, from);

  if (dir === 'left' || dir === 'right') {
    const col = clamp(from.col + (dir === 'right' ? 1 : -1), 0, here - 1);
    return col === from.col ? from : { row: from.row, col };
  }

  const step = dir === 'down' ? 1 : -1;
  for (let row = from.row + step; row >= 0 && row < rowCounts.length; row += step) {
    const n = rowCounts[row];
    if (hasItems(n)) return { row, col: clamp(columnMemory[row] ?? from.col, 0, n - 1) };
  }
  return from;
}
