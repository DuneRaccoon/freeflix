import type { RowConfig } from '@/components/browse/BrowseScreen';
import type { WatchlistItem } from '@/services/watchlist';
import { watchlistItemToCatalogItem } from './toCatalogItem';

export type WatchlistRowFilter = 'all' | 'movie' | 'tv';

/**
 * Build the "My List" carousel row from the user's saved items, optionally
 * narrowed to one media type. BrowseScreen drops rows with no items, so callers
 * never need to guard the empty case.
 */
export function buildWatchlistRow(
  items: WatchlistItem[],
  filter: WatchlistRowFilter,
): RowConfig {
  const scoped =
    filter === 'all' ? items : items.filter((i) => i.media_type === filter);
  return {
    key: 'watchlist',
    title: 'My List',
    eyebrow: 'Your Collection',
    seeAllHref: '/my-list',
    variant: 'poster',
    items: scoped.map(watchlistItemToCatalogItem),
  };
}

/**
 * Insert the watchlist row just after the first rail (or as the only row when
 * there are no other rails).
 */
export function insertWatchlistRow(
  rows: RowConfig[],
  watchlistRow: RowConfig,
): RowConfig[] {
  if (rows.length === 0) return [watchlistRow];
  return [rows[0], watchlistRow, ...rows.slice(1)];
}
