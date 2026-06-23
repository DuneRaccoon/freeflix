import { describe, it, expect } from 'vitest';
import { watchlistItemToCatalogItem } from './toCatalogItem';
import type { WatchlistItem } from '@/services/watchlist';

const base: WatchlistItem = {
  id: 'w1', user_id: 'u1', content_id: 'movie:550', tmdb_id: '550',
  media_type: 'movie', title: 'Fight Club', added_at: '', created_at: '',
};

describe('watchlistItemToCatalogItem', () => {
  it('maps stored poster_url / year / vote_average onto the CatalogItem', () => {
    const c = watchlistItemToCatalogItem({ ...base, poster_url: 'p.jpg', year: 1999, vote_average: 8.4 });
    expect(c.poster_url).toBe('p.jpg');
    expect(c.year).toBe(1999);
    expect(c.vote_average).toBe(8.4);
    expect(c.tmdb_id).toBe(550);
    expect(c.media_type).toBe('movie');
    expect(c.title).toBe('Fight Club');
  });

  it('falls back to null/0 when metadata is absent (legacy rows)', () => {
    const c = watchlistItemToCatalogItem(base);
    expect(c.poster_url).toBeNull();
    expect(c.year).toBeNull();
    expect(c.vote_average).toBe(0);
  });
});
