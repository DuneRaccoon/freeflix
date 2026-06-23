import type { WatchlistItemCreate } from '@/services/watchlist';
import { buildContentId } from '@/lib/contentId';

/**
 * Minimal structural shape shared by CatalogItem / MovieDetail (and ShowDetail
 * once its `name` is mapped to `title`).
 */
export interface WatchlistSource {
  tmdb_id: number;
  media_type: 'movie' | 'tv';
  title: string;
  year: number | null;
  poster_url: string | null;
  vote_average: number;
}

/**
 * Build the create payload sent to the watchlist API, carrying display
 * metadata (poster/year/rating) so saved items retain it.
 */
export function toWatchlistCreate(src: WatchlistSource): WatchlistItemCreate {
  return {
    content_id: buildContentId({ kind: src.media_type, tmdbId: src.tmdb_id }),
    tmdb_id: String(src.tmdb_id),
    media_type: src.media_type,
    title: src.title,
    poster_url: src.poster_url,
    year: src.year,
    vote_average: src.vote_average,
  };
}
