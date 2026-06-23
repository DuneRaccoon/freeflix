import type { CatalogItem } from '@/types';
import type { WatchlistItem } from '@/services/watchlist';

/**
 * Convert a stored WatchlistItem into the CatalogItem shape PosterCard needs.
 * Reads the denormalised poster_url / year / vote_average persisted on the row
 * (older rows without these are healed lazily by WatchlistContext).
 */
export function watchlistItemToCatalogItem(item: WatchlistItem): CatalogItem {
  return {
    tmdb_id: Number(item.tmdb_id),
    media_type: (item.media_type as 'movie' | 'tv') ?? 'movie',
    title: item.title ?? '—',
    year: item.year ?? null,
    overview: null,
    poster_url: item.poster_url ?? null,
    backdrop_url: null,
    genre_ids: [],
    genres: [],
    vote_average: item.vote_average ?? 0,
    vote_count: 0,
    popularity: 0,
    original_language: null,
  };
}
