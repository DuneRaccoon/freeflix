import type { WatchlistItem } from '@/services/watchlist';
import { watchlistItemToCatalogItem } from '@/lib/watchlist/toCatalogItem';
import type { CardItem } from '../_components/Card';
import { catalogItemToCard, usableCardIdentity } from './rails';

/**
 * A watchlist row, as the television draws it and as it removes it.
 *
 * `CardItem.id` is `{media_type}:{tmdb_id}` — the card's identity, NOT the watchlist row's.
 * Removal takes the row's own `content_id` (`DELETE /watchlist/{user}/{content_id}`), which
 * no `CardItem` field carries, so it is kept beside the card rather than re-derived: the two
 * formats agree today and a screen that rebuilt one from the other would delete the wrong
 * row the day they stop agreeing.
 */
export interface WatchlistCard {
  /** The row's `content_id`: the only handle removal has on it. */
  contentId: string;
  card: CardItem;
}

/**
 * A watchlist row that can become a card that goes somewhere, and that can be removed again.
 *
 * The card half of the rule is **not restated here**: it is `usableCardIdentity` in
 * `_data/rails`, the one statement of it on this surface, and that is where the reasoning
 * about `tmdb_id` and `media_type` lives. A watchlist row needs its own entry point for two
 * reasons that are about the row's shape, not about the rule:
 *
 * - **`tmdb_id` is a STRING on a watchlist row**, so the values are converted before the
 *   shared rule sees them. A value that is not a positive whole number makes `Number()`
 *   yield `NaN` (or 0) and the card link to `/bigscreen/movie/NaN`.
 *
 * - **`media_type` is read off the ROW, deliberately, and not through
 *   `watchlistItemToCatalogItem`.** That mapper's
 *   `(item.media_type as 'movie' | 'tv') ?? 'movie'` is a **cast, not a validation**, and its
 *   `??` would turn a missing kind into `'movie'` — so normalising first and checking
 *   afterwards would silently accept exactly the rows this drops. Nothing upstream constrains
 *   the field either: `WatchlistItemCreate.media_type` is a bare `str` on the backend
 *   (`backend/app/models.py`; the `# "movie" | "tv"` comment beside it enforces nothing), so
 *   unlike a catalog row this one has no server-side normalisation behind it. The mapper is
 *   deliberately NOT changed — it is shared with the web surface, and dropping a bad row is a
 *   caller's decision, not the mapper's.
 *
 * And one clause of its own, because only a watchlist row can be removed:
 *
 * - **`content_id` is the only handle removal has.** A row without one would draw a card
 *   whose press in remove mode could only `DELETE .../undefined`; it is dropped rather than
 *   shown as a title that cannot be taken off the list. (`watchlist.content_id` is
 *   `nullable=False` and `WatchlistItemResponse.content_id` is required, so this is defence
 *   against a malformed response, not a live case.)
 *
 * Each bad row costs itself, never the list.
 */
export function usableWatchlistRow(entry: WatchlistItem | null | undefined): entry is WatchlistItem {
  if (!entry) return false;
  if (typeof entry.content_id !== 'string' || !entry.content_id) return false;
  return usableCardIdentity(Number(entry.tmdb_id), entry.media_type);
}

/**
 * The rows the screen can draw, newest first as the backend sends them.
 *
 * POSTER cards: `watchlistItemToCatalogItem` always nulls `backdrop_url`, so a 16:9 card
 * would be artless without a detail fetch per item, while the stored poster is usually
 * present.
 *
 * `cap` counts CARDS, not rows — it is applied after the guard, so a malformed row at the
 * top of the list does not eat one of the cap's places. Home's My List rail passes
 * `RAIL_CAP`; the dedicated screen passes nothing, because the full list is the point of it.
 */
export function watchlistCards(
  rows: readonly (WatchlistItem | null | undefined)[],
  cap?: number,
): WatchlistCard[] {
  const out: WatchlistCard[] = [];
  for (const entry of rows) {
    if (cap !== undefined && out.length >= cap) break;
    if (!usableWatchlistRow(entry)) continue;
    out.push({
      contentId: entry.content_id,
      // Built exactly once, here, so the memoised Card sees stable values.
      card: catalogItemToCard(watchlistItemToCatalogItem(entry), 'poster'),
    });
  }
  return out;
}
