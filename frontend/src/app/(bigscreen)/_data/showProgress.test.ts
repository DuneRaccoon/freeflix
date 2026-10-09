import { describe, it, expect } from 'vitest';
import type { Episode, StreamingProgress } from '@/types';
import { episodeMarks, latestSeasonWatched, nextUnwatched, seasonFinished } from './showProgress';

const row = (movie_id: string, over: Partial<StreamingProgress> = {}): StreamingProgress =>
  ({ id: movie_id, user_id: 'p', torrent_id: 't', movie_id, current_time: 0, duration: 100, percentage: 0, completed: false, ...over }) as StreamingProgress;
const ep = (n: number): Episode => ({ episode_number: n, name: `E${n}`, overview: null, runtime: null, still_url: null, air_date: null, vote_average: 0 });

describe('episodeMarks', () => {
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
    const m = episodeMarks(rows, 7, 1);
    expect([...m.entries()]).toEqual([[1, 'watched'], [2, 'started']]); // tv:8's e3 must not leak in
  });
  it('reads a different season independently', () => {
    expect([...episodeMarks(rows, 7, 2).entries()]).toEqual([[1, 'watched']]);
  });
  it('lets a completed row win over a started duplicate', () => {
    const m = episodeMarks([row('tv:7:s1:e1', { completed: true }), row('tv:7:s1:e1', { percentage: 30 })], 7, 1);
    expect(m.get(1)).toBe('watched');
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

describe('nextUnwatched / seasonFinished', () => {
  const eps = [ep(1), ep(2), ep(3)];
  it('picks the first episode not marked watched, in order', () => {
    expect(nextUnwatched(eps, new Map([[1, 'watched'], [2, 'started']]))?.episode_number).toBe(2);
  });
  it('skips nothing when a later one is watched but an earlier is not', () => {
    expect(nextUnwatched(eps, new Map([[3, 'watched']]))?.episode_number).toBe(1);
  });
  it('is null when everything is watched, and the season is finished', () => {
    const all = new Map<number, 'watched'>([[1, 'watched'], [2, 'watched'], [3, 'watched']]);
    expect(nextUnwatched(eps, all)).toBeNull();
    expect(seasonFinished(eps, all)).toBe(true);
  });
  it('an empty season is not "finished"', () => {
    expect(seasonFinished([], new Map())).toBe(false);
    expect(nextUnwatched([], new Map())).toBeNull();
  });
});
