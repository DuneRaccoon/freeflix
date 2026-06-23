import { describe, it, expect } from 'vitest';
import { toWatchlistCreate } from './toWatchlistCreate';

describe('toWatchlistCreate', () => {
  it('builds a movie payload with content_id + metadata', () => {
    const p = toWatchlistCreate({
      tmdb_id: 550, media_type: 'movie', title: 'Fight Club',
      year: 1999, poster_url: 'p.jpg', vote_average: 8.4,
    });
    expect(p).toEqual({
      content_id: 'movie:550', tmdb_id: '550', media_type: 'movie',
      title: 'Fight Club', poster_url: 'p.jpg', year: 1999, vote_average: 8.4,
    });
  });

  it('builds a tv content_id for tv sources', () => {
    const p = toWatchlistCreate({
      tmdb_id: 1399, media_type: 'tv', title: 'Game of Thrones',
      year: 2011, poster_url: null, vote_average: 8.4,
    });
    expect(p.content_id).toBe('tv:1399');
    expect(p.media_type).toBe('tv');
  });
});
