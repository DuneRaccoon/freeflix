/**
 * Split a list into fixed-size rows.
 *
 * Shared because the focus model's rows ARE these rows: every grid on this surface that
 * wraps a flat list declares one row count per chunk and renders one container per chunk,
 * so the two must come from the same call. The profile picker and the search results each
 * had their own copy of this before the My List screen would have been the third.
 *
 * The last row is short rather than padded: a padded row would declare a cell the render
 * does not produce, which is the phantom-cell failure — the ring lands on a (row, col) no
 * element claims and a remote has no way to recover.
 */
export const chunk = <T,>(items: readonly T[], size: number): T[][] =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, (i + 1) * size));
