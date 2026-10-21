/**
 * Two side-by-side regions on one row-indexed grid.
 *
 * WHY THIS EXISTS AT ALL. The search screen is now a split: a keyboard on the left and a
 * grid of results on the right, and "Right from the last key enters the results" is the
 * whole point of that layout. The focus model is row-indexed — one focus row is one visual
 * line — which a keyboard line and a poster line are not, so the two regions cannot be rows
 * of one sequence. A previous round of this work wrote the split off for exactly that reason
 * ("it needs spatial focus navigation; this grid is row-indexed") and shipped a jump button
 * instead. This is the spatial half, kept as small as it can be.
 *
 * HOW SMALL. `move` in `model.ts` is untouched and is still what resolves every press that
 * stays inside a region. This file adds only the two things a pane boundary needs:
 *
 *   1. VERTICAL CONTAINMENT. Up and Down stay in the region they started in. Without it,
 *      Down from the bottom of the keyboard would land in the results — the next populated
 *      row — and Up from the top result would land on the keyboard's last line, which is
 *      beside it rather than above it.
 *   2. HORIZONTAL CROSSING. A Left or Right that `move` refuses because the row has ended
 *      is the press that crosses, and it lands on the row the other pane last had.
 *
 * Both are policy, not mechanism, so they live here as a pure function and the hook takes
 * it as an option. Anything the layout does not describe — the top bar, which is a row of
 * its own above both panes — is handed straight to `move` and behaves exactly as it does on
 * every other screen.
 */
import { type Direction, type FocusTarget, type RowCounts, move } from './model';

/** A half-open row range: `[first, last]`, both inclusive. */
export type RowRange = readonly [number, number];

export interface PaneLayout {
  readonly left: RowRange;
  readonly right: RowRange;
}

/**
 * The row each pane was last on, so crossing returns to where the viewer was rather than to
 * the top. Owned by the screen (a ref), read at call time, and passed in so this stays pure.
 */
export interface PaneMemory {
  left: number | null;
  right: number | null;
}

export type PaneName = 'left' | 'right';

const within = (range: RowRange, row: number): boolean => row >= range[0] && row <= range[1];

/** Which pane a row belongs to, or null for a row outside both (the top bar). */
export function paneOf(layout: PaneLayout, row: number): PaneName | null {
  if (within(layout.left, row)) return 'left';
  if (within(layout.right, row)) return 'right';
  return null;
}

const countOf = (counts: RowCounts, row: number): number => counts[row] ?? 0;
const hasItems = (counts: RowCounts, row: number): boolean => countOf(counts, row) > 0;

/** The first populated row of a range, scanning from `first`; null when it is all empty. */
function firstPopulated(counts: RowCounts, range: RowRange): number | null {
  for (let r = range[0]; r <= range[1]; r++) if (hasItems(counts, r)) return r;
  return null;
}

/**
 * The row to land on when entering a pane: the one it was last on, if that row still has
 * cells, else its first populated row.
 *
 * The staleness check is the point of the `hasItems` test rather than a bare memory read: a
 * results grid shrinks on every new search, so the row the viewer was on may not exist by
 * the time they come back to it — and landing on an empty row is a ring on nothing, which a
 * remote cannot recover from.
 */
function entryRow(counts: RowCounts, range: RowRange, remembered: number | null): number | null {
  if (remembered !== null && within(range, remembered) && hasItems(counts, remembered)) {
    return remembered;
  }
  return firstPopulated(counts, range);
}

/**
 * One D-pad press on a two-pane grid.
 *
 * Returns `from` unchanged for a press with nowhere to go, exactly as `move` does — the hook
 * reads "same target" as "nothing happened" and leaves DOM focus alone.
 */
export function paneMove(
  layout: PaneLayout,
  memory: PaneMemory,
  counts: RowCounts,
  from: FocusTarget,
  dir: Direction,
  columnMemory: readonly number[],
): FocusTarget {
  const pane = paneOf(layout, from.row);

  // Outside both panes — the top bar. Left and right are its own row's business; Down
  // enters the pane the viewer was last in, because coming back from the bar to the far
  // side of the screen is not a move anybody asked for.
  if (pane === null) {
    if (dir !== 'down') return move(counts, from, dir, columnMemory);
    // The left pane unless the viewer has only ever been in the right one: the left is
    // where the typing is, and it is where the ring starts.
    const prefer: PaneName = memory.left === null && memory.right !== null ? 'right' : 'left';
    const range = prefer === 'left' ? layout.left : layout.right;
    const row = entryRow(counts, range, memory[prefer]);
    if (row !== null) return { row, col: Math.min(columnMemory[row] ?? 0, countOf(counts, row) - 1) };
    return move(counts, from, dir, columnMemory);
  }

  const range = pane === 'left' ? layout.left : layout.right;

  if (dir === 'up' || dir === 'down') {
    const step = dir === 'down' ? 1 : -1;
    for (let row = from.row + step; within(range, row); row += step) {
      if (!hasItems(counts, row)) continue;
      const col = Math.min(columnMemory[row] ?? from.col, countOf(counts, row) - 1);
      return { row, col: Math.max(0, col) };
    }
    // Off the top of a pane is the one vertical move that leaves it: the bar above both
    // panes is how a viewer gets out of either, and Up is where they reach for it.
    if (dir === 'up') {
      for (let row = Math.min(layout.left[0], layout.right[0]) - 1; row >= 0; row--) {
        if (hasItems(counts, row)) {
          const col = Math.min(columnMemory[row] ?? from.col, countOf(counts, row) - 1);
          return { row, col: Math.max(0, col) };
        }
      }
    }
    return from;
  }

  // Horizontal: inside the row first, and only a REFUSED press crosses.
  const stepped = move(counts, from, dir, columnMemory);
  if (stepped.row !== from.row || stepped.col !== from.col) return stepped;

  const target: PaneName | null =
    dir === 'right' && pane === 'left' ? 'right' : dir === 'left' && pane === 'right' ? 'left' : null;
  if (target === null) return from;

  const other = target === 'left' ? layout.left : layout.right;
  const row = entryRow(counts, other, memory[target]);
  if (row === null) return from;
  // Entering from the left lands on the first cell; entering from the right lands on the
  // last, so the ring keeps travelling in the direction the viewer pushed it.
  const col = target === 'right' ? 0 : countOf(counts, row) - 1;
  return { row, col: Math.max(0, col) };
}
