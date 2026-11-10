import { describe, it, expect } from 'vitest';
import { movieHref, showAskFrom, showHref, titleHref } from './titleHref';

describe('movieHref / showHref', () => {
  it('is the film screen for a tmdb id', () => {
    expect(movieHref(603)).toBe('/bigscreen/movie/603');
  });
  it('is the bare show screen with no episode asked', () => {
    expect(showHref(1399)).toBe('/bigscreen/show/1399');
    expect(showHref(1399, null)).toBe('/bigscreen/show/1399');
  });
  it('carries ?s=&e= when an episode is asked', () => {
    expect(showHref(1399, { season: 2, episode: 5 })).toBe('/bigscreen/show/1399?s=2&e=5');
  });
});

describe('titleHref', () => {
  it('sends a film to the film screen', () => {
    expect(titleHref({ kind: 'movie', tmdbId: 603 })).toBe('/bigscreen/movie/603');
  });
  it('sends an episode to the show screen, asking for that episode', () => {
    expect(titleHref({ kind: 'tv', tmdbId: 1399, season: 2, episode: 5 })).toBe('/bigscreen/show/1399?s=2&e=5');
  });
  it('sends a show-level title to the bare show screen', () => {
    expect(titleHref({ kind: 'tv', tmdbId: 1399 })).toBe('/bigscreen/show/1399');
  });
});

describe('showAskFrom', () => {
  const ask = (query: string) => showAskFrom(new URLSearchParams(query));

  it('asks nothing when the query is empty', () => {
    expect(ask('')).toEqual({ season: null, episode: null });
  });
  it('reads both values', () => {
    expect(ask('s=2&e=5')).toEqual({ season: 2, episode: 5 });
  });
  it('reads each value on its own', () => {
    expect(ask('s=2')).toEqual({ season: 2, episode: null });
    expect(ask('e=5')).toEqual({ season: null, episode: 5 });
  });
  it.each(['', ' ', 'abc', '0', '-1', '1.5', '1e21'])(
    'drops a season of %j: only a positive safe integer is an ask',
    (s) => {
      expect(ask(`s=${encodeURIComponent(s)}&e=5`)).toEqual({ season: null, episode: 5 });
    },
  );
  it('round-trips what showHref writes', () => {
    const href = showHref(1399, { season: 2, episode: 5 });
    expect(showAskFrom(new URL(href, 'http://tv.test').searchParams)).toEqual({ season: 2, episode: 5 });
  });
});
