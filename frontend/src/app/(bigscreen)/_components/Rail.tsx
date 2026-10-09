'use client';
import type { FocusProps } from '../_focus/useFocusGrid';
import { Card, type CardItem } from './Card';

export interface RailModel {
  key: string;
  title: string;
  eyebrow?: string | null;
  shape: 'poster' | 'wide';
  items: CardItem[];
  /** True while the rail's data is in flight; renders skeletons and contributes 0 focusable items. */
  loading?: boolean;
}

/**
 * A fixed placeholder count, not a measured fill: three posters span 768px and three
 * wide cards 1332px of the 1728px safe width, so the row is not full until cards arrive.
 */
const SKELETON_COUNT = 3;

/**
 * How many focusable cells this rail renders: the number the screen must report to
 * `useFocusGrid` as this row's count. A loading rail draws skeletons, which are not
 * focusable, so it is 0 even when stale `items` are present. Reporting `items.length`
 * instead would make Down into a skeleton row a dead press with no error anywhere.
 */
export function railCellCount(rail: RailModel): number {
  return rail.loading ? 0 : rail.items.length;
}

/**
 * A titled row of cards: grid row `row`, one cell per card.
 *
 * THE COUNT CONTRACT. The screen tells `useFocusGrid` how many cells each row has, and
 * that number must equal what this renders: build the grid's `rowCounts` with
 * `railCellCount`, never with `items.length`. A loading rail reports 0 and this never
 * calls `focusPropsFor` for it; a rail that reported 5 and drew 3 would let focus land on
 * a cell that does not exist, on a device with no pointer and no Tab key.
 *
 * Cells are keyed by INDEX, not by item id. A refetch that re-keys the focused card
 * while the row count is unchanged would unmount the focused node and drop DOM focus to
 * `<body>` until the grid's shape next changed.
 *
 * The track is scrolled by the focus hook's `scrollIntoView` and by nothing else: no
 * wheel handler, no drag handler.
 */
export function Rail({
  rail,
  row,
  focusPropsFor,
}: {
  rail: RailModel;
  row: number;
  focusPropsFor: (row: number, col: number) => FocusProps;
}) {
  const { title, eyebrow, shape, items, loading } = rail;
  // An empty rail is removed, as on the web. Loading is not empty: it holds its place.
  if (!loading && railCellCount(rail) === 0) return null;

  return (
    <section className="bs-rail" aria-busy={loading || undefined}>
      <header className="bs-rail__head">
        {eyebrow && <p className="bs-rail__eyebrow">{eyebrow}</p>}
        <h2 className="bs-rail__title">{title}</h2>
      </header>
      <div className="bs-rail__track">
        {loading
          ? Array.from({ length: SKELETON_COUNT }, (_, i) => (
              <div key={i} className={`bs-skel bs-skel--${shape}`} aria-hidden="true" />
            ))
          : items.map((item, col) => (
              <Card key={col} item={item} shape={shape} focusProps={focusPropsFor(row, col)} />
            ))}
      </div>
    </section>
  );
}
