import { describe, it, expect } from 'vitest';
import { buildWatchlistRow, insertWatchlistRow } from './watchlistRow';
import type { WatchlistItem } from '@/services/watchlist';
import type { RowConfig } from '@/components/browse/BrowseScreen';

function wl(content_id: string, media_type: 'movie' | 'tv', tmdb_id: string): WatchlistItem {
  return { id: content_id, user_id: 'u1', content_id, tmdb_id, media_type,
    title: 't', added_at: '', created_at: '' };
}

describe('buildWatchlistRow', () => {
  const items = [wl('movie:1', 'movie', '1'), wl('tv:2', 'tv', '2')];

  it('uses key "watchlist", title "My List", and links to /my-list', () => {
    const row = buildWatchlistRow(items, 'all');
    expect(row.key).toBe('watchlist');
    expect(row.title).toBe('My List');
    expect(row.seeAllHref).toBe('/my-list');
    expect(row.items).toHaveLength(2);
  });

  it('filters to movies only', () => {
    const row = buildWatchlistRow(items, 'movie');
    expect(row.items).toHaveLength(1);
    expect(row.items[0].media_type).toBe('movie');
  });

  it('filters to tv only', () => {
    const row = buildWatchlistRow(items, 'tv');
    expect(row.items).toHaveLength(1);
    expect(row.items[0].media_type).toBe('tv');
  });
});

describe('insertWatchlistRow', () => {
  const r = (key: string): RowConfig => ({ key, title: key, items: [] });

  it('inserts after the first row', () => {
    const out = insertWatchlistRow([r('a'), r('b')], r('watchlist'));
    expect(out.map((x) => x.key)).toEqual(['a', 'watchlist', 'b']);
  });

  it('returns just the watchlist row when there are no other rows', () => {
    const out = insertWatchlistRow([], r('watchlist'));
    expect(out.map((x) => x.key)).toEqual(['watchlist']);
  });
});
