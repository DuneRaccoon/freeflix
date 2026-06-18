import type { CatalogItem, CatalogPage } from '@/types';

/**
 * Flatten multiple CatalogPages into a single sorted, de-duped array.
 *
 * De-duplication key: `${media_type}:${tmdb_id}`  — so a movie and a TV show
 * that share the same tmdb_id are kept as separate entries, while an exact
 * duplicate (same media_type + same tmdb_id) is collapsed to the first
 * occurrence.
 *
 * Results are sorted by `popularity` descending (stable sort).
 */
export function mergeDedupe(pages: CatalogPage[]): CatalogItem[] {
  const seen = new Set<string>();
  const merged: CatalogItem[] = [];

  for (const page of pages) {
    for (const item of page.results) {
      const key = `${item.media_type}:${item.tmdb_id}`;
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(item);
      }
    }
  }

  // Stable sort: Array.prototype.sort is stable in V8 / modern JS engines.
  merged.sort((a, b) => b.popularity - a.popularity);

  return merged;
}

/**
 * Returns true when at least one page still has more pages to load
 * (i.e. `page < total_pages`).
 */
export function hasMoreResults(pages: CatalogPage[]): boolean {
  return pages.some((p) => p.page < p.total_pages);
}
