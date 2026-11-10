import { describe, it, expect } from 'vitest';
import type { StreamingProgress } from '@/types';
import { episodeCode, showHeroAction, type EpisodeAt } from './showHero';

// toStrictEqual throughout: toEqual reads `{ kind: 'play', at, href: undefined }` as equal to a
// play action, so a play that leaked a resume link would pass.

// ---------------------------------------------------------------------------
// episodeCode
// ---------------------------------------------------------------------------
describe('episodeCode', () => {
  it('pads a single-digit season and episode', () => {
    expect(episodeCode({ season: 1, episode: 3 })).toBe('S01·E03');
  });

  it('leaves two-digit numbers as they are', () => {
    expect(episodeCode({ season: 10, episode: 12 })).toBe('S10·E12');
  });
});

// ---------------------------------------------------------------------------
// showHeroAction
// ---------------------------------------------------------------------------

/** The episode the page was asked to open on. */
const FOCUS: EpisodeAt = { season: 1, episode: 3 };

/**
 * The profile's unfinished row for FOCUS, on a season pack (`file_index: 4`). Every case below
 * differs from it by exactly one field, so each pins one clause of the rule and nothing else.
 */
const unfinished: StreamingProgress = {
  id: 'progress-1',
  user_id: 'profile-1',
  torrent_id: 't-9',
  movie_id: 'tv:95396:s1:e3',
  current_time: 840,
  duration: 2800,
  percentage: 30,
  completed: false,
  last_watched_at: '2026-11-10T20:00:00Z',
  created_at: '2026-11-10T19:00:00Z',
  updated_at: '2026-11-10T20:00:00Z',
  file_index: 4,
  title: 'Severance S01E03',
};

type HeroInput = Parameters<typeof showHeroAction>[0];

/** FOCUS asked for, no row, the next episode not looked up, progress loaded — then `change`. */
const act = (change: Partial<HeroInput>) =>
  showHeroAction({ focus: FOCUS, row: null, next: undefined, progressLoading: false, ...change });

describe('showHeroAction', () => {
  it('plays S1·E1 without an asked episode, even while progress loads', () => {
    expect(act({ focus: null, progressLoading: true })).toStrictEqual({
      kind: 'play',
      at: { season: 1, episode: 1 },
    });
    expect(act({ focus: null })).toStrictEqual({ kind: 'play', at: { season: 1, episode: 1 } });
  });

  it('is pending while progress loads, even over a row it could resume', () => {
    expect(act({ row: unfinished, progressLoading: true })).toStrictEqual({ kind: 'pending' });
  });

  it('resumes an unfinished row on its own torrent and file', () => {
    expect(act({ row: unfinished })).toStrictEqual({
      kind: 'resume',
      at: FOCUS,
      href: '/streaming/t-9?file=4',
    });
  });

  it('carries file 0', () => {
    expect(act({ row: { ...unfinished, file_index: 0 } })).toStrictEqual({
      kind: 'resume',
      at: FOCUS,
      href: '/streaming/t-9?file=0',
    });
  });

  it('is pending on a finished row while its next episode is still being looked up', () => {
    expect(act({ row: { ...unfinished, completed: true }, next: undefined })).toStrictEqual({
      kind: 'pending',
    });
  });

  it('plays the next episode after a finished row', () => {
    expect(
      act({ row: { ...unfinished, completed: true }, next: { season: 1, episode: 4 } }),
    ).toStrictEqual({ kind: 'play', at: { season: 1, episode: 4 } });
  });

  it('plays S1·E1 after a finished row with no next episode', () => {
    expect(act({ row: { ...unfinished, completed: true }, next: null })).toStrictEqual({
      kind: 'play',
      at: { season: 1, episode: 1 },
    });
  });

  it('plays the asked episode when its row has no torrent', () => {
    expect(act({ row: { ...unfinished, torrent_id: null } })).toStrictEqual({
      kind: 'play',
      at: FOCUS,
    });
  });

  it('plays the asked episode when its row is at 0%', () => {
    expect(act({ row: { ...unfinished, percentage: 0 } })).toStrictEqual({
      kind: 'play',
      at: FOCUS,
    });
  });

  it('plays the asked episode without a row', () => {
    expect(act({ row: null })).toStrictEqual({ kind: 'play', at: FOCUS });
  });
});
