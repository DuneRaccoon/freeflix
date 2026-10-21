import { describe, it, expect } from 'vitest';
import type { Episode, StreamingProgress } from '@/types';
import {
  episodeTraces,
  latestSeasonWatched,
  nextUnwatched,
  seasonFinished,
  watchedCount,
  type EpisodeTrace,
} from './showProgress';

const row = (movie_id: string, over: Partial<StreamingProgress> = {}): StreamingProgress =>
  ({ id: movie_id, user_id: 'p', torrent_id: 't', movie_id, current_time: 0, duration: 100, percentage: 0, completed: false, ...over }) as StreamingProgress;
const ep = (n: number): Episode => ({ episode_number: n, name: `E${n}`, overview: null, runtime: null, still_url: null, air_date: null, vote_average: 0 });

/** A trace map written the short way, for the rows that only care about the mark. */
const marks = (...pairs: Array<[number, EpisodeTrace['mark']]>): Map<number, EpisodeTrace> =>
  new Map(pairs.map(([n, mark]) => [n, { mark, percentage: mark === 'watched' ? 100 : 50, remainingS: null }]));

describe('episodeTraces', () => {
  const rows = [
    row('tv:7:s1:e1', { completed: true, percentage: 100 }),
    row('tv:7:s1:e2', { percentage: 40 }),
    row('tv:7:s1:e3', { percentage: 0 }),
    row('tv:7:s2:e1', { completed: true }),
    row('tv:8:s1:e3', { completed: true }),
    row('movie:7', { completed: true }),
    row('tv:7', { completed: true }),
  ];
  it('marks only this show and this season', () => {
    const m = episodeTraces(rows, 7, 1);
    // tv:8's e3 must not leak in, and neither may the movie or the show-level row.
    expect([...m.keys()]).toEqual([1, 2]);
    expect(m.get(1)?.mark).toBe('watched');
    expect(m.get(2)?.mark).toBe('started');
  });
  it('reads a different season independently', () => {
    expect([...episodeTraces(rows, 7, 2).keys()]).toEqual([1]);
    expect(episodeTraces(rows, 7, 2).get(1)?.mark).toBe('watched');
  });
  it('lets a completed row win over a started duplicate', () => {
    const m = episodeTraces([row('tv:7:s1:e1', { completed: true }), row('tv:7:s1:e1', { percentage: 30 })], 7, 1);
    expect(m.get(1)?.mark).toBe('watched');
  });

  // --- the trace itself: the two numbers the list draws ---------------------------

  it('carries the percentage, clamped and rounded', () => {
    const m = episodeTraces(
      [row('tv:7:s1:e1', { percentage: 40.6 }), row('tv:7:s1:e2', { percentage: 140 }), row('tv:7:s1:e3', { percentage: -5, current_time: 9 })],
      7,
      1,
    );
    expect(m.get(1)?.percentage).toBe(41);
    expect(m.get(2)?.percentage).toBe(100);
    // A negative percentage is not progress: it never becomes a `started` row at all, so
    // there is no bar to clamp.
    expect(m.has(3)).toBe(false);
  });

  it('says 100 for a completed row whatever it stored', () => {
    // `completed` is written at the 95% cut-off (`title.ts`'s FINISHED_PCT), so a bar drawn
    // from the stored number would sit at 95 under the word "Watched" — a readout
    // disagreeing with itself on the same row.
    const m = episodeTraces([row('tv:7:s1:e1', { completed: true, percentage: 95.2 })], 7, 1);
    expect(m.get(1)).toEqual({ mark: 'watched', percentage: 100, remainingS: null });
  });

  it('measures what is left from the row’s own duration', () => {
    const m = episodeTraces([row('tv:7:s1:e1', { percentage: 50, current_time: 600, duration: 1500 })], 7, 1);
    expect(m.get(1)?.remainingS).toBe(900);
  });

  it('answers null — never 0 — when the row stored no usable length', () => {
    // `useWatchProgress` writes `duration: null` for a file whose length the media element
    // never reported, which on this television is the ordinary case for an in-progress
    // stream. 0 would read as "at the end" and the list would say "1 min left" about an
    // episode nobody has a length for.
    const cases: Array<Partial<StreamingProgress>> = [
      { duration: null as unknown as number },
      { duration: 0 },
      { duration: Number.NaN },
      { current_time: -1, duration: 100 },
    ];
    for (const over of cases) {
      const m = episodeTraces([row('tv:7:s1:e1', { percentage: 20, ...over })], 7, 1);
      expect(m.get(1)?.remainingS, JSON.stringify(over)).toBeNull();
    }
  });

  it('never reports a negative remainder', () => {
    const m = episodeTraces([row('tv:7:s1:e1', { percentage: 90, current_time: 200, duration: 100 })], 7, 1);
    expect(m.get(1)?.remainingS).toBe(0);
  });
});

describe('latestSeasonWatched', () => {
  it('is the season of the first (newest) row for the show', () => {
    expect(latestSeasonWatched([row('tv:8:s9:e1'), row('tv:7:s3:e2'), row('tv:7:s1:e1')], 7)).toBe(3);
  });
  it('is null with no history', () => {
    expect(latestSeasonWatched([row('movie:1')], 7)).toBeNull();
  });
});

describe('nextUnwatched / seasonFinished / watchedCount', () => {
  const eps = [ep(1), ep(2), ep(3)];
  it('picks the first episode not marked watched, in order', () => {
    expect(nextUnwatched(eps, marks([1, 'watched'], [2, 'started']))?.episode_number).toBe(2);
  });
  it('skips nothing when a later one is watched but an earlier is not', () => {
    expect(nextUnwatched(eps, marks([3, 'watched']))?.episode_number).toBe(1);
  });
  it('is null when everything is watched, and the season is finished', () => {
    const all = marks([1, 'watched'], [2, 'watched'], [3, 'watched']);
    expect(nextUnwatched(eps, all)).toBeNull();
    expect(seasonFinished(eps, all)).toBe(true);
    expect(watchedCount(eps, all)).toBe(3);
  });
  it('an empty season is not "finished"', () => {
    expect(seasonFinished([], new Map())).toBe(false);
    expect(nextUnwatched([], new Map())).toBeNull();
    expect(watchedCount([], marks([1, 'watched']))).toBe(0);
  });
  it('counts over the episodes that are LISTED, not over the history', () => {
    // History can hold a row for an episode TMDB no longer lists (a renumbered season, a
    // special that moved). Counting the map instead would print "4 of 3 watched".
    expect(watchedCount(eps, marks([1, 'watched'], [2, 'watched'], [9, 'watched']))).toBe(2);
  });
  it('a started episode is not a watched one', () => {
    expect(watchedCount(eps, marks([1, 'started'], [2, 'started'], [3, 'started']))).toBe(0);
  });
});
