import { describe, it, expect } from 'vitest';
import { movieHref, showAskFrom, showHref, titleExitOf, titleHref } from './titleHref';

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

describe('titleExitOf', () => {
  // The player's one way out, from the watch identity it already derives. The rows are the
  // identity's own shapes, so the `s0` fallback and a show-level key go through the same
  // `titleOfContentId` that Continue Watching uses.
  it('leaves a film to its own screen, labelled with its title', () => {
    expect(titleExitOf({ contentId: 'movie:603', title: 'The Matrix' })).toEqual({
      href: '/bigscreen/movie/603',
      label: 'The Matrix',
    });
  });
  it('leaves an episode to its show, asked for that episode, labelled with the show alone', () => {
    expect(titleExitOf({ contentId: 'tv:1399:s2:e5', title: 'Show 1399 S02E05' })).toEqual({
      href: '/bigscreen/show/1399?s=2&e=5',
      label: 'Show 1399',
    });
  });
  it('leaves a show-level key to the bare show screen', () => {
    expect(titleExitOf({ contentId: 'tv:1399', title: 'Show 1399' })?.href).toBe('/bigscreen/show/1399');
  });
  it('never asks for season 0: the s0 fallback leaves to the bare show screen', () => {
    expect(titleExitOf({ contentId: 'tv:1399:s0:e4', title: 'Show 1399' })?.href).toBe('/bigscreen/show/1399');
  });
  it('is null when nothing names a title, so the caller says Home', () => {
    expect(titleExitOf({ contentId: null, title: 'x' })).toBeNull();
  });
});
