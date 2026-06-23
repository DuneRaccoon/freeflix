import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/services/movies', () => ({ moviesService: { browse: vi.fn() } }));
vi.mock('@/services/tv', () => ({ tvService: { browse: vi.fn() } }));

import { interleave, MIXED_RAILS, buildMixedRailsScreen } from './buildMixedRailsScreen';
import { moviesService } from '@/services/movies';
import { tvService } from '@/services/tv';
import { CatalogItem, CatalogPage, BrowseParams } from '@/types';

function mkItem(id: number, media_type: 'movie' | 'tv', popularity: number): CatalogItem {
  return {
    tmdb_id: id,
    media_type,
    title: `${media_type}-${id}`,
    year: 2024,
    overview: '',
    poster_url: null,
    backdrop_url: null,
    genre_ids: [],
    genres: [],
    vote_average: 7,
    vote_count: 100,
    popularity,
    original_language: 'en',
  };
}

const page = (results: CatalogItem[]): CatalogPage => ({
  page: 1,
  results,
  total_pages: 1,
  total_results: results.length,
});

const isBarePopular = (p: BrowseParams) => p.api === 'popular' && !p.sort;

describe('interleave', () => {
  it('alternates starting with the first list (movies)', () => {
    expect(interleave(['m1', 'm2', 'm3'], ['t1', 't2', 't3']))
      .toEqual(['m1', 't1', 'm2', 't2', 'm3', 't3']);
  });

  it('appends the remainder when lists differ in length', () => {
    expect(interleave(['m1', 'm2', 'm3'], ['t1'])).toEqual(['m1', 't1', 'm2', 'm3']);
    expect(interleave(['m1'], ['t1', 't2', 't3'])).toEqual(['m1', 't1', 't2', 't3']);
  });

  it('degrades to the non-empty list when one side is empty', () => {
    expect(interleave(['m1', 'm2'], [])).toEqual(['m1', 'm2']);
    expect(interleave([], ['t1', 't2'])).toEqual(['t1', 't2']);
    expect(interleave([], [])).toEqual([]);
  });

  it('respects the cap', () => {
    const a = Array.from({ length: 30 }, (_, i) => `m${i}`);
    const b = Array.from({ length: 30 }, (_, i) => `t${i}`);
    expect(interleave(a, b, 5)).toEqual(['m0', 't0', 'm1', 't1', 'm2']);
  });
});

describe('MIXED_RAILS', () => {
  it('maps genre ids per media type (movie vs tv differ)', () => {
    const byKey = Object.fromEntries(MIXED_RAILS.map((r) => [r.key, r]));
    expect(byKey['genre-action'].movieParams.genres).toBe('28');
    expect(byKey['genre-action'].tvParams.genres).toBe('10759');
    expect(byKey['genre-scifi'].movieParams.genres).toBe('878');
    expect(byKey['genre-scifi'].tvParams.genres).toBe('10765');
    expect(byKey['genre-drama'].movieParams.genres).toBe('18');
    expect(byKey['genre-drama'].tvParams.genres).toBe('18');
  });

  it('uses noun-free titles (no "Movies"/"Series")', () => {
    for (const rail of MIXED_RAILS) {
      expect(rail.title).not.toMatch(/movies|series/i);
    }
  });

  it('leads with trending and has a ranked top-rated rail', () => {
    expect(MIXED_RAILS[0].key).toBe('trending');
    expect(MIXED_RAILS.find((r) => r.key === 'top-rated')?.variant).toBe('ranked');
  });
});

describe('buildMixedRailsScreen', () => {
  beforeEach(() => {
    vi.mocked(moviesService.browse).mockReset();
    vi.mocked(tvService.browse).mockReset();
    vi.mocked(moviesService.browse).mockImplementation(async (p: BrowseParams) =>
      isBarePopular(p) ? page([mkItem(1, 'movie', 50), mkItem(2, 'movie', 40)]) : page([mkItem(99, 'movie', 10)]),
    );
    vi.mocked(tvService.browse).mockImplementation(async (p: BrowseParams) =>
      isBarePopular(p) ? page([mkItem(3, 'tv', 90), mkItem(4, 'tv', 30)]) : page([mkItem(98, 'tv', 5)]),
    );
  });

  it('headlines the most popular title across both feeds (a show can take the hero)', async () => {
    const screen = await buildMixedRailsScreen();
    expect(screen.hero?.tmdb_id).toBe(3);          // tv item, popularity 90
    expect(screen.hero?.media_type).toBe('tv');
    expect(screen.featured.length).toBeLessThanOrEqual(6);
  });

  it('interleaves the trending rail starting with a movie', async () => {
    const screen = await buildMixedRailsScreen();
    const trending = screen.rows.find((r) => r.key === 'trending')!;
    expect(trending.items.map((i) => i.media_type)).toEqual(['movie', 'tv', 'movie', 'tv']);
  });

  it('reuses the popular feeds for trending (no duplicate popular fetch)', async () => {
    await buildMixedRailsScreen();
    const barePopularMovieCalls = vi
      .mocked(moviesService.browse)
      .mock.calls.filter(([p]) => isBarePopular(p));
    expect(barePopularMovieCalls).toHaveLength(1);
  });

  it('queries each side with its own genre id', async () => {
    await buildMixedRailsScreen();
    expect(vi.mocked(moviesService.browse)).toHaveBeenCalledWith({ genres: '28' });
    expect(vi.mocked(tvService.browse)).toHaveBeenCalledWith({ genres: '10759' });
  });

  it('builds one row per spec, in order', async () => {
    const screen = await buildMixedRailsScreen();
    expect(screen.rows.map((r) => r.key)).toEqual(MIXED_RAILS.map((r) => r.key));
  });
});
