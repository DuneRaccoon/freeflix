/**
 * `@/lib/nextEpisode` — the catalog half of "what comes after this episode", shared by the
 * television and the web player. It drives `@/services/tv` directly: the rules are about what
 * the CATALOG says.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Episode, SeasonDetail, ShowDetail } from '@/types';
import { tvService } from '@/services/tv';
import {
  episodeRefOf,
  episodeScaleSeconds,
  findNextEpisode,
  pastAutoNextPoint,
} from './nextEpisode';

vi.mock('@/services/tv', () => ({ tvService: { getShow: vi.fn(), getSeason: vi.fn() } }));

const tv = vi.mocked(tvService);

const ep = (n: number, over: Partial<Episode> = {}): Episode => ({
  episode_number: n,
  name: `Episode ${n}`,
  overview: null,
  runtime: null,
  still_url: null,
  air_date: null,
  vote_average: 0,
  ...over,
});

const season = (n: number, episodes: Episode[]): SeasonDetail => ({
  season_number: n,
  name: `Season ${n}`,
  overview: null,
  episodes,
});

const show = (seasons: Array<{ season_number: number; episode_count: number }>): ShowDetail =>
  ({
    tmdb_id: 7,
    media_type: 'tv',
    name: 'Show',
    year: 2020,
    overview: null,
    poster_url: null,
    backdrop_url: null,
    genres: [],
    status: null,
    first_air_date: null,
    last_air_date: null,
    number_of_seasons: seasons.length,
    vote_average: 0,
    vote_count: 0,
    seasons: seasons.map((s) => ({
      season_number: s.season_number,
      name: `Season ${s.season_number}`,
      episode_count: s.episode_count,
      overview: null,
      poster_url: null,
      air_date: null,
    })),
  }) as ShowDetail;

const REF = { tmdbId: 7, season: 2, episode: 2 };


beforeEach(() => {
  vi.clearAllMocks();
});

// =====================================================================================
// episodeRefOf — "is this an episode at all"
// =====================================================================================

describe('episodeRefOf', () => {
  it('reads the show, season and episode out of an episode key', () => {
    expect(episodeRefOf('tv:1399:s2:e7')).toEqual({ tmdbId: 1399, season: 2, episode: 7 });
  });

  it('is null for everything that is not one episode', () => {
    // A movie has no next episode; a SHOW-LEVEL key is what a season pack whose file could
    // not be resolved is stored as, and it has no current episode to count from. Both of
    // those are also the test for "does this title get a Next-episode cell at all".
    for (const id of ['movie:603', 'tv:1399', 'tv:1399:s2', '', null, undefined, 'nonsense']) {
      expect(episodeRefOf(id), String(id)).toBeNull();
    }
  });
});

// =====================================================================================
// findNextEpisode
// =====================================================================================

describe('findNextEpisode', () => {
  it('is the next LISTED episode of this season, not episode + 1', () => {
    // A season's numbering can skip — a double episode is listed once — and the viewer is
    // where they are, not where arithmetic says they are.
    tv.getSeason.mockResolvedValue(season(2, [ep(1), ep(2), ep(4)]));
    return expect(findNextEpisode(REF)).resolves.toEqual({
      verdict: { k: 'ready', next: { season: 2, episode: 4, name: 'Episode 4' } },
      runtimeS: null,
    });
  });

  it('never looks backwards, even when the episode on screen is the last one listed', async () => {
    tv.getSeason.mockResolvedValue(season(2, [ep(1), ep(2)]));
    tv.getShow.mockResolvedValue(show([{ season_number: 2, episode_count: 2 }]));
    const answer = await findNextEpisode(REF);
    expect(answer.verdict).toEqual({ k: 'none' });
  });

  it('carries this episode’s runtime in seconds, because the player has no other scale', async () => {
    tv.getSeason.mockResolvedValue(season(2, [ep(2, { runtime: 47 }), ep(3)]));
    const answer = await findNextEpisode(REF);
    expect(answer.runtimeS).toBe(47 * 60);
  });

  it('calls a missing, zero or nonsense runtime "not listed" rather than a length', async () => {
    for (const runtime of [null, 0, Number.NaN, -5] as Array<number | null>) {
      tv.getSeason.mockResolvedValue(season(2, [ep(2, { runtime }), ep(3)]));
      const answer = await findNextEpisode(REF);
      expect(answer.runtimeS, String(runtime)).toBeNull();
    }
  });

  it('rolls into the first LATER season that actually has episodes', async () => {
    tv.getSeason.mockResolvedValueOnce(season(2, [ep(1), ep(2)]));
    tv.getShow.mockResolvedValue(
      show([
        { season_number: 1, episode_count: 10 },
        { season_number: 2, episode_count: 2 },
        // Announced but not written yet: skipped without being fetched.
        { season_number: 3, episode_count: 0 },
        { season_number: 4, episode_count: 6 },
      ]),
    );
    tv.getSeason.mockResolvedValueOnce(season(4, [ep(1), ep(2)]));
    const answer = await findNextEpisode(REF);
    expect(answer.verdict).toEqual({ k: 'ready', next: { season: 4, episode: 1, name: 'Episode 1' } });
    // ONE extra fetch, not three: `episode_count` is in the summary, so the empty season was
    // ruled out without asking for it, and season 1 was never a candidate at all.
    expect(tv.getSeason).toHaveBeenCalledTimes(2);
    expect(tv.getSeason).toHaveBeenLastCalledWith(7, 4);
  });

  it('ignores season 0, which is the specials bucket and is never "next"', async () => {
    tv.getSeason.mockResolvedValueOnce(season(2, [ep(2)]));
    tv.getShow.mockResolvedValue(
      show([
        { season_number: 0, episode_count: 12 },
        { season_number: 2, episode_count: 1 },
      ]),
    );
    const answer = await findNextEpisode(REF);
    expect(answer.verdict).toEqual({ k: 'none' });
    expect(tv.getSeason).toHaveBeenCalledTimes(1);
  });

  it('is `unknown`, never `none`, when the season read fails', async () => {
    // A failed lookup must not tell a viewer their series has ended, and must not let the
    // prefetch act: `unknown` is a refusal, `none` is a fact.
    tv.getSeason.mockRejectedValue(new Error('offline'));
    const answer = await findNextEpisode(REF);
    expect(answer).toEqual({ verdict: { k: 'unknown' }, runtimeS: null });
    expect(tv.getShow).not.toHaveBeenCalled();
  });

  it('keeps the runtime when only the LATER-season read fails', async () => {
    // The narrower failure: this season answered, so its runtime is in hand and the player's
    // thresholds still work even though what is next is unknown.
    tv.getSeason.mockResolvedValueOnce(season(2, [ep(2, { runtime: 30 })]));
    tv.getShow.mockRejectedValue(new Error('offline'));
    const answer = await findNextEpisode(REF);
    expect(answer).toEqual({ verdict: { k: 'unknown' }, runtimeS: 1800 });
  });

  it('is `unknown` when the catalog disagrees with itself', async () => {
    // The summary promised episodes and the season listed none. A contradiction inside the
    // catalog is not knowledge, so it is not reported as the end of the series.
    tv.getSeason.mockResolvedValueOnce(season(2, [ep(2)]));
    tv.getShow.mockResolvedValue(
      show([
        { season_number: 2, episode_count: 1 },
        { season_number: 3, episode_count: 8 },
      ]),
    );
    tv.getSeason.mockResolvedValueOnce(season(3, []));
    const answer = await findNextEpisode(REF);
    expect(answer.verdict).toEqual({ k: 'unknown' });
  });

  it('survives a season with no `episodes` array at all', async () => {
    tv.getSeason.mockResolvedValue({ season_number: 2, name: 'S2', overview: null } as SeasonDetail);
    tv.getShow.mockResolvedValue(show([{ season_number: 2, episode_count: 1 }]));
    await expect(findNextEpisode(REF)).resolves.toEqual({ verdict: { k: 'none' }, runtimeS: null });
  });
});

// =====================================================================================
// The cell's words
// =====================================================================================

describe('episodeScaleSeconds', () => {
  it('prefers the element’s own duration', () => {
    expect(episodeScaleSeconds({ duration: 1234, storedSeconds: 999, runtimeS: 888 })).toBe(1234);
  });

  it('falls back to the stored duration, then to TMDB’s runtime', () => {
    // On this television `video.duration` is routinely never finite for an in-progress
    // stream, which is why there are three sources at all.
    expect(episodeScaleSeconds({ duration: Number.NaN, storedSeconds: 999, runtimeS: 888 })).toBe(999);
    expect(episodeScaleSeconds({ duration: Number.NaN, storedSeconds: null, runtimeS: 888 })).toBe(888);
    expect(episodeScaleSeconds({ duration: Number.POSITIVE_INFINITY, storedSeconds: null, runtimeS: 888 })).toBe(888);
  });

  it('is null when nothing can say, and never 0', () => {
    expect(episodeScaleSeconds({ duration: Number.NaN, storedSeconds: null, runtimeS: null })).toBeNull();
    expect(episodeScaleSeconds({ duration: 0, storedSeconds: 0, runtimeS: 0 })).toBeNull();
    expect(episodeScaleSeconds({ duration: -5, storedSeconds: -5, runtimeS: -5 })).toBeNull();
  });
});

describe('pastAutoNextPoint', () => {
  it('is the given fraction of the episode, in both directions, at every slider stop it is fed', () => {
    const total = 1000;
    for (const t of [0.5, 0.8, 0.95]) {
      expect.soft(pastAutoNextPoint(total * t - 1, total, t), `${t}: one second before`).toBe(false);
      expect.soft(pastAutoNextPoint(total * t, total, t), `${t}: exactly at`).toBe(true);
    }
    expect.soft(pastAutoNextPoint(total, total, 0.95)).toBe(true);
  });

  it('reads the threshold it is handed, not a constant', () => {
    expect.soft(pastAutoNextPoint(600, 1000, 0.6)).toBe(true);
    expect.soft(pastAutoNextPoint(600, 1000, 0.8)).toBe(false);
  });

  it('is a fraction and not a fixed lead time, so it scales with the episode', () => {
    expect.soft(pastAutoNextPoint(18 * 60, 22 * 60, 0.8)).toBe(true);
    expect.soft(pastAutoNextPoint(18 * 60, 70 * 60, 0.8)).toBe(false);
  });

  it('refuses with no scale, a playhead of 0, or a threshold that is not above 0', () => {
    expect.soft(pastAutoNextPoint(900, null, 0.8)).toBe(false);
    expect.soft(pastAutoNextPoint(900, 0, 0.8)).toBe(false);
    expect.soft(pastAutoNextPoint(0, 1000, 0.8)).toBe(false);
    expect.soft(pastAutoNextPoint(Number.NaN, 1000, 0.8)).toBe(false);
    expect.soft(pastAutoNextPoint(1, 1000, 0), 'a 0 threshold is not "always"').toBe(false);
    expect.soft(pastAutoNextPoint(1, 1000, -1)).toBe(false);
  });
});
