import { describe, it, expect } from 'vitest';
import { episodeAskFrom, titlePageHref } from './titlePageHref';

// toStrictEqual throughout: toEqual reads `{ episode: undefined }` as equal to a missing key,
// so an ask that kept a rejected value as undefined would pass.

// ---------------------------------------------------------------------------
// titlePageHref
// ---------------------------------------------------------------------------
describe('titlePageHref', () => {
  it('links a film to its movie page', () => {
    expect(titlePageHref({ kind: 'movie', tmdbId: 603 })).toBe('/movies/603');
  });

  it('links an episode to its show page, asking for that episode', () => {
    expect(titlePageHref({ kind: 'tv', tmdbId: 1399, season: 2, episode: 5 })).toBe(
      '/tv/1399?season=2&episode=5',
    );
  });

  it('links a show-level title to the bare show page', () => {
    expect(titlePageHref({ kind: 'tv', tmdbId: 1399 })).toBe('/tv/1399');
  });

  it('asks for a season alone when no episode rides with it', () => {
    expect(titlePageHref({ kind: 'tv', tmdbId: 1399, season: 2 })).toBe('/tv/1399?season=2');
  });

  it('never asks for season 0, and drops the episode that rode with it', () => {
    expect(titlePageHref({ kind: 'tv', tmdbId: 1399, season: 0, episode: 4 })).toBe('/tv/1399');
  });

  it('ignores an episode without a season', () => {
    expect(titlePageHref({ kind: 'tv', tmdbId: 1399, episode: 4 })).toBe('/tv/1399');
  });
});

// ---------------------------------------------------------------------------
// episodeAskFrom
// ---------------------------------------------------------------------------
describe('episodeAskFrom', () => {
  it('asks for nothing without a query', () => {
    expect(episodeAskFrom({})).toStrictEqual({});
  });

  it('reads a season and an episode', () => {
    expect(episodeAskFrom({ season: '2', episode: '5' })).toStrictEqual({ season: 2, episode: 5 });
  });

  it('reads a season alone', () => {
    expect(episodeAskFrom({ season: '2' })).toStrictEqual({ season: 2 });
  });

  it('drops an episode that has no season to ride with', () => {
    expect(episodeAskFrom({ episode: '5' })).toStrictEqual({});
  });

  it('takes the first value of a repeated parameter', () => {
    expect(episodeAskFrom({ season: ['3', '4'], episode: '1' })).toStrictEqual({
      season: 3,
      episode: 1,
    });
  });

  it.each(['0', '-1', 'abc', '1.5', '1e3', ' ', '99999999999999999999'])(
    'asks for nothing when season is %j',
    (season) => {
      expect(episodeAskFrom({ season, episode: '5' })).toStrictEqual({});
    },
  );

  it('keeps the season when the episode is 0', () => {
    expect(episodeAskFrom({ season: '2', episode: '0' })).toStrictEqual({ season: 2 });
  });

  it('reads back exactly what titlePageHref writes', () => {
    const href = titlePageHref({ kind: 'tv', tmdbId: 1399, season: 2, episode: 5 });
    const sp = Object.fromEntries(new URL(href, 'http://web.test').searchParams);
    expect(episodeAskFrom(sp)).toStrictEqual({ season: 2, episode: 5 });
  });
});
