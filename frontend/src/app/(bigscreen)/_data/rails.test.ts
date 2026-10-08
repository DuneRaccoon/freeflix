import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CatalogItem, CatalogPage } from '@/types';

vi.mock('@/services/movies', () => ({ moviesService: { browse: vi.fn() } }));
vi.mock('@/services/tv', () => ({ tvService: { browse: vi.fn() } }));

import { moviesService } from '@/services/movies';
import { tvService } from '@/services/tv';
import { railCellCount } from '../_components/Rail';
import { TV_RAILS, catalogItemToCard, fetchRail, toRail, type TvRailSpec } from './rails';

const browseMovies = vi.mocked(moviesService.browse);
const browseShows = vi.mocked(tvService.browse);

function item(overrides: Partial<CatalogItem> & Pick<CatalogItem, 'tmdb_id' | 'media_type'>): CatalogItem {
  return {
    title: `Title ${overrides.media_type} ${overrides.tmdb_id}`,
    year: 2021,
    overview: null,
    poster_url: `https://img.test/poster-${overrides.tmdb_id}.jpg`,
    backdrop_url: `https://img.test/backdrop-${overrides.tmdb_id}.jpg`,
    genre_ids: [],
    genres: [],
    vote_average: 7,
    vote_count: 10,
    popularity: 1,
    original_language: 'en',
    ...overrides,
  };
}

const movies = (n: number, from = 1) =>
  Array.from({ length: n }, (_, i) => item({ tmdb_id: from + i, media_type: 'movie' }));
const shows = (n: number, from = 1) =>
  Array.from({ length: n }, (_, i) => item({ tmdb_id: from + i, media_type: 'tv' }));
const page = (results: CatalogItem[]): CatalogPage => ({
  page: 1,
  results,
  total_pages: 1,
  total_results: results.length,
});

const SPEC: TvRailSpec = {
  key: 'trending',
  title: 'Trending This Week',
  eyebrow: 'Now',
  shape: 'poster',
  movieParams: { api: 'popular' },
  tvParams: { api: 'popular' },
};

beforeEach(() => {
  browseMovies.mockReset();
  browseShows.mockReset();
});

describe('TV_RAILS', () => {
  it('is the seven-rail lineup, in render order', () => {
    expect(TV_RAILS.map((r) => r.key)).toEqual([
      'trending',
      'top-rated',
      'new',
      'genre-action',
      'genre-drama',
      'genre-comedy',
      'genre-scifi',
    ]);
    expect(TV_RAILS.every((r) => r.shape === 'poster')).toBe(true);
  });

  it('gives the movie and tv halves of Action and Sci-Fi DIFFERENT genre ids', () => {
    // TMDB numbers movie and tv genres separately. One shared id would return the
    // wrong genre for one half with no error anywhere.
    const byKey = Object.fromEntries(TV_RAILS.map((r) => [r.key, r]));
    expect(byKey['genre-action'].movieParams?.genres).toBe('28');
    expect(byKey['genre-action'].tvParams?.genres).toBe('10759');
    expect(byKey['genre-scifi'].movieParams?.genres).toBe('878');
    expect(byKey['genre-scifi'].tvParams?.genres).toBe('10765');
    // Drama and Comedy are the two that genuinely coincide.
    expect(byKey['genre-drama'].movieParams?.genres).toBe('18');
    expect(byKey['genre-drama'].tvParams?.genres).toBe('18');
    expect(byKey['genre-comedy'].movieParams?.genres).toBe('35');
    expect(byKey['genre-comedy'].tvParams?.genres).toBe('35');
  });

  it('only uses an `api` value that BOTH endpoints accept', () => {
    // now_playing/upcoming are movies-only and on_the_air/airing_today tv-only; each
    // endpoint validates `api` with its own regex, so the wrong one is a request error.
    for (const rail of TV_RAILS) {
      for (const params of [rail.movieParams, rail.tvParams]) {
        if (params?.api !== undefined) expect(['popular', 'top_rated']).toContain(params.api);
      }
    }
  });

  it('carries the lineup copy: the Top Rated eyebrow and the Genre eyebrow', () => {
    const byKey = Object.fromEntries(TV_RAILS.map((r) => [r.key, r]));
    expect(byKey['top-rated'].eyebrow).toBe('Critically acclaimed');
    expect(byKey['trending'].eyebrow).toBeUndefined();
    for (const k of ['genre-action', 'genre-drama', 'genre-comedy', 'genre-scifi']) {
      expect(byKey[k].eyebrow).toBe('Genre');
    }
    expect(byKey['new'].movieParams).toEqual({ api: 'popular', sort: 'primary_release_date.desc' });
  });
});

describe('toRail', () => {
  it('interleaves movie, show, movie, show', () => {
    const rail = toRail(SPEC, movies(3), shows(3));
    expect(rail.items.map((c) => c.id)).toEqual([
      'movie:1',
      'tv:1',
      'movie:2',
      'tv:2',
      'movie:3',
      'tv:3',
    ]);
  });

  it('carries on with the longer half once the shorter one runs out', () => {
    const rail = toRail(SPEC, movies(1), shows(4));
    expect(rail.items.map((c) => c.id)).toEqual(['movie:1', 'tv:1', 'tv:2', 'tv:3', 'tv:4']);
  });

  it('caps the rail at 20 cards', () => {
    const rail = toRail(SPEC, movies(20), shows(20));
    expect(rail.items).toHaveLength(20);
    // The cap keeps the head of the interleave, so the mix survives it.
    expect(rail.items[0].id).toBe('movie:1');
    expect(rail.items[1].id).toBe('tv:1');
    expect(rail.items[19].id).toBe('tv:10');
  });

  it('copies the spec onto the model and is not loading', () => {
    const rail = toRail({ ...SPEC, shape: 'wide' }, movies(1), []);
    expect(rail).toMatchObject({ key: 'trending', title: 'Trending This Week', eyebrow: 'Now', shape: 'wide' });
    expect(rail.loading).toBe(false);
  });

  it('is an empty rail when there is nothing to show', () => {
    expect(toRail(SPEC, [], []).items).toEqual([]);
  });

  it('says loading: false outright, so a merge over a loading placeholder cannot leave it true', () => {
    // `{ ...placeholder, ...rail }` keeps `loading: true` if the key is merely omitted,
    // and railCellCount would then report 0 focusable cells for a full rail.
    const rail = toRail(SPEC, movies(2), shows(2));
    const placeholder = { key: 'trending', title: 'Trending This Week', shape: 'poster' as const, items: [], loading: true };
    expect(rail.loading).toBe(false);
    expect(railCellCount({ ...placeholder, ...rail })).toBe(4);
  });

  it('drops a null element or an item with no usable tmdb id, and keeps the rest', () => {
    const broken = [
      null,
      item({ tmdb_id: 1, media_type: 'movie' }),
      { ...item({ tmdb_id: 2, media_type: 'movie' }), tmdb_id: undefined },
      { ...item({ tmdb_id: 3, media_type: 'movie' }), tmdb_id: NaN },
    ] as unknown as CatalogItem[];
    const rail = toRail(SPEC, broken, shows(1));
    expect(rail.items.map((c) => c.id)).toEqual(['movie:1', 'tv:1']);
  });
});

describe('lead: the catalog row behind the first card', () => {
  // The home hero needs a title's backdrop and overview, which a CardItem does not carry.
  // Without `lead` the screen would have to fetch the title again, and a title-detail call
  // is a torrent search.
  it('is the row items[0] was built from', () => {
    const rail = toRail(SPEC, movies(2), shows(2));
    expect(rail.lead).toMatchObject({ tmdb_id: 1, media_type: 'movie' });
    expect(catalogItemToCard(rail.lead!, 'poster')).toEqual(rail.items[0]);
  });

  it('carries the fields a card drops', () => {
    const first = item({ tmdb_id: 7, media_type: 'movie', overview: 'A heist.', backdrop_url: 'https://img.test/b.jpg' });
    const rail = toRail(SPEC, [first], []);
    expect(rail.lead?.overview).toBe('A heist.');
    expect(rail.lead?.backdrop_url).toBe('https://img.test/b.jpg');
  });

  it('is the first show when there are no movies', () => {
    expect(toRail(SPEC, [], shows(2)).lead).toMatchObject({ tmdb_id: 1, media_type: 'tv' });
  });

  it('skips an unusable first row, exactly as the cards do', () => {
    const broken = [null, ...movies(2)] as unknown as CatalogItem[];
    const rail = toRail(SPEC, broken, []);
    expect(rail.lead).toMatchObject({ tmdb_id: 1, media_type: 'movie' });
    expect(rail.items[0].id).toBe('movie:1');
  });

  it('is null for an empty rail', () => {
    expect(toRail(SPEC, [], []).lead).toBeNull();
  });

  it('arrives with fetchRail, and is null when both halves fail', async () => {
    browseMovies.mockResolvedValue(page(movies(1)));
    browseShows.mockResolvedValue(page(shows(1)));
    expect((await fetchRail(SPEC)).lead).toMatchObject({ tmdb_id: 1, media_type: 'movie' });
    browseMovies.mockRejectedValue(new Error('502'));
    browseShows.mockRejectedValue(new Error('502'));
    expect((await fetchRail(SPEC)).lead).toBeNull();
  });
});

describe('catalogItemToCard', () => {
  const movie = item({ tmdb_id: 603, media_type: 'movie', title: 'The Matrix', year: 1999 });
  const show = item({ tmdb_id: 1399, media_type: 'tv', title: 'Game of Thrones', year: 2011 });

  it('uses the poster for a poster card and the backdrop for a wide one', () => {
    expect(catalogItemToCard(movie, 'poster').artUrl).toBe('https://img.test/poster-603.jpg');
    expect(catalogItemToCard(movie, 'wide').artUrl).toBe('https://img.test/backdrop-603.jpg');
  });

  it('builds an id that keeps a movie and a show with the same tmdb id apart', () => {
    expect(catalogItemToCard(movie, 'poster').id).toBe('movie:603');
    expect(catalogItemToCard(show, 'poster').id).toBe('tv:1399');
    expect(catalogItemToCard({ ...show, tmdb_id: 603 }, 'poster').id).not.toBe(
      catalogItemToCard(movie, 'poster').id,
    );
  });

  it('links to the bigscreen detail routes, never a (web) route', () => {
    expect(catalogItemToCard(movie, 'poster').href).toBe('/bigscreen/movie/603');
    expect(catalogItemToCard(show, 'poster').href).toBe('/bigscreen/show/1399');
  });

  it('takes the title as-is and the year as a string subtitle', () => {
    const card = catalogItemToCard(show, 'poster');
    expect(card.title).toBe('Game of Thrones');
    expect(card.subtitle).toBe('2011');
  });

  it('has no subtitle when the year is unknown', () => {
    expect(catalogItemToCard({ ...movie, year: null }, 'poster').subtitle).toBeNull();
  });

  it('passes a missing image through as null rather than inventing one', () => {
    const bare = { ...movie, poster_url: null, backdrop_url: null };
    expect(catalogItemToCard(bare, 'poster').artUrl).toBeNull();
    expect(catalogItemToCard(bare, 'wide').artUrl).toBeNull();
  });
});

describe('fetchRail', () => {
  it('asks each service for its own half, with its own params', async () => {
    browseMovies.mockResolvedValue(page(movies(1)));
    browseShows.mockResolvedValue(page(shows(1)));
    const spec: TvRailSpec = {
      ...SPEC,
      movieParams: { genres: '28' },
      tvParams: { genres: '10759' },
    };
    await fetchRail(spec);
    expect(browseMovies).toHaveBeenCalledWith({ genres: '28' });
    expect(browseShows).toHaveBeenCalledWith({ genres: '10759' });
  });

  it('issues both calls before either has resolved', async () => {
    browseMovies.mockReturnValue(new Promise(() => {}));
    browseShows.mockReturnValue(new Promise(() => {}));
    void fetchRail(SPEC);
    expect(browseMovies).toHaveBeenCalledTimes(1);
    expect(browseShows).toHaveBeenCalledTimes(1);
  });

  it('resolves with the interleaved rail when both halves answer', async () => {
    browseMovies.mockResolvedValue(page(movies(2)));
    browseShows.mockResolvedValue(page(shows(2)));
    const rail = await fetchRail(SPEC);
    expect(rail.items.map((c) => c.id)).toEqual(['movie:1', 'tv:1', 'movie:2', 'tv:2']);
  });

  it('resolves with the shows half intact when the movies call rejects', async () => {
    browseMovies.mockRejectedValue(new Error('502'));
    browseShows.mockResolvedValue(page(shows(3)));
    const rail = await fetchRail(SPEC);
    expect(rail.items.map((c) => c.id)).toEqual(['tv:1', 'tv:2', 'tv:3']);
  });

  it('resolves with the movies half intact when the shows call rejects', async () => {
    browseMovies.mockResolvedValue(page(movies(2)));
    browseShows.mockRejectedValue(new Error('502'));
    const rail = await fetchRail(SPEC);
    expect(rail.items.map((c) => c.id)).toEqual(['movie:1', 'movie:2']);
  });

  it('resolves with an empty rail, and does not throw, when both reject', async () => {
    browseMovies.mockRejectedValue(new Error('502'));
    browseShows.mockRejectedValue(new Error('502'));
    const rail = await fetchRail(SPEC);
    expect(rail.items).toEqual([]);
    expect(rail).toMatchObject({ key: 'trending', title: 'Trending This Week' });
  });

  it('survives a 200 whose body has no results array', async () => {
    browseMovies.mockResolvedValue({} as CatalogPage);
    browseShows.mockResolvedValue(page(shows(1)));
    const rail = await fetchRail(SPEC);
    expect(rail.items.map((c) => c.id)).toEqual(['tv:1']);
  });

  it('survives a results array with a null in it, costing only that element', async () => {
    browseMovies.mockResolvedValue(page([null, ...movies(2)] as unknown as CatalogItem[]));
    browseShows.mockResolvedValue(page(shows(1)));
    const rail = await fetchRail(SPEC);
    expect(rail.items.map((c) => c.id)).toEqual(['movie:1', 'tv:1', 'movie:2']);
  });

  it('survives a results value that is not an array', async () => {
    browseMovies.mockResolvedValue({ results: { not: 'an array' } } as unknown as CatalogPage);
    browseShows.mockResolvedValue(page(shows(1)));
    const rail = await fetchRail(SPEC);
    expect(rail.items.map((c) => c.id)).toEqual(['tv:1']);
  });

  it('survives a service that throws before it returns a promise', async () => {
    browseMovies.mockImplementation(() => {
      throw new Error('sync boom');
    });
    browseShows.mockResolvedValue(page(shows(2)));
    const rail = await fetchRail(SPEC);
    expect(rail.items.map((c) => c.id)).toEqual(['tv:1', 'tv:2']);
  });

  it('says loading: false outright on every path, including both halves failing', async () => {
    browseMovies.mockResolvedValue(page(movies(1)));
    browseShows.mockResolvedValue(page(shows(1)));
    expect((await fetchRail(SPEC)).loading).toBe(false);
    browseMovies.mockRejectedValue(new Error('502'));
    browseShows.mockRejectedValue(new Error('502'));
    expect((await fetchRail(SPEC)).loading).toBe(false);
  });

  it('does not call a half the spec leaves out', async () => {
    browseShows.mockResolvedValue(page(shows(2)));
    const rail = await fetchRail({ ...SPEC, movieParams: undefined });
    expect(browseMovies).not.toHaveBeenCalled();
    expect(rail.items.map((c) => c.id)).toEqual(['tv:1', 'tv:2']);
  });
});
