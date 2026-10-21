import type { CatalogItem, CatalogPage } from '@/types';
import { usableCatalogRow } from './rails';

/**
 * Adding a page of results to the ones already on screen.
 *
 * WHY THIS IS NOT `mergeDedupe`. That one flattens every page and then SORTS the whole
 * thing by popularity, which is right for a search that answers once and wrong for one that
 * keeps answering: re-sorting moves cards the viewer is already looking at. On a remote that
 * is worse than it sounds — the ring is on a card at (row, col), and if page 2 arriving
 * re-orders page 1 then the ring is suddenly on a different film, with no press behind the
 * change. So the rows already shown keep their order and their positions, for ever, and the
 * new ones are sorted among THEMSELVES and appended.
 *
 * That is also what makes the infinite scroll safe for the focus model: the only shape
 * change is cells added at the END of the last row and whole new rows after it, which is
 * exactly the growth the grid tolerates.
 *
 * Deduplicated on `media_type:tmdb_id`, the same key `mergeDedupe` uses — a movie and a show
 * can share a tmdb id, and TMDB's own paging repeats a title across pages often enough to
 * matter. Rows are re-validated with the surface's one row guard, because page 2 comes off
 * the wire exactly like page 1 did.
 */

/** Three 220px posters and their 24px gaps fit the right pane; see `.bs-search__row`. */
export const RESULT_COLUMNS = 3;

const keyOf = (item: CatalogItem): string => `${item.media_type}:${item.tmdb_id}`;

export function appendResults(
  existing: readonly CatalogItem[],
  pages: readonly CatalogPage[],
): CatalogItem[] {
  const seen = new Set(existing.map(keyOf));
  const fresh: CatalogItem[] = [];
  for (const page of pages) {
    for (const item of page.results ?? []) {
      if (!usableCatalogRow(item)) continue;
      const key = keyOf(item);
      if (seen.has(key)) continue;
      seen.add(key);
      fresh.push(item);
    }
  }
  // Sorted among themselves only. `??` rather than a bare read: `popularity` is typed as a
  // number but arrives off the wire, and one undefined would make every comparison NaN.
  fresh.sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0));
  // A new array only when something was actually added, so a page of nothing but repeats
  // cannot re-render the grid (and so cannot move the ring).
  return fresh.length === 0 ? (existing as CatalogItem[]) : [...existing, ...fresh];
}

/**
 * The page to ask for next, and whether there is one.
 *
 * Either half may run out first — a title with 4 pages of films and 1 of shows — so "more"
 * is "either half has more", and the half that is finished simply contributes nothing to the
 * next append. Asking a finished half for page 5 of 4 returns an empty page, which
 * `appendResults` drops; that costs one request and keeps this a single page cursor rather
 * than one per half.
 */
export function morePages(pages: readonly CatalogPage[]): boolean {
  return pages.some((p) => (p.page ?? 0) < (p.total_pages ?? 0));
}
