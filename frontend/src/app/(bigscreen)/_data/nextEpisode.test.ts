/**
 * `_data/nextEpisode.ts` — what comes after this episode, and how to get there.
 *
 * `_data/title` IS MOCKED HERE, and `@/services/tv` is not. The split is deliberate: the
 * lookup's rules are about what the CATALOG says, so the catalog is the thing to drive; the
 * prefetch's and the press's rules are about which of `titleStateFor`'s eight answers may
 * start a download and which may be navigated to, so the thing to drive is the ANSWER. Those
 * eight answers have their own suite (`title.test.ts`) and re-deriving them through
 * `torrentsService` here would be testing that file twice and this one not at all.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Episode, SeasonDetail, ShowDetail } from '@/types';
import { tvService } from '@/services/tv';
import { requestTitle, resumeTitle, titleStateFor, type TitleAction } from './title';
import {
  AUTO_NEXT_AT,
  END_PROMPT_S,
  NEXT_CELL_STATES,
  episodeRefOf,
  episodeScaleSeconds,
  episodeTag,
  findNextEpisode,
  nearTheEnd,
  nextCellView,
  pastAutoNextPoint,
  prefetchEpisode,
  whereToWatchEpisode,
  type NextEpisodeAnswer,
} from './nextEpisode';

vi.mock('@/services/tv', () => ({ tvService: { getShow: vi.fn(), getSeason: vi.fn() } }));
vi.mock('./title', () => ({
  titleStateFor: vi.fn(),
  requestTitle: vi.fn(),
  resumeTitle: vi.fn(),
}));

const tv = vi.mocked(tvService);
const title = vi.mocked({ titleStateFor, requestTitle, resumeTitle });

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

const state = (action: TitleAction, locked = false) => ({ action, locked });

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

describe('episodeTag', () => {
  it('pads both numbers, so a season reads the same at 2 and at 12', () => {
    expect(episodeTag({ season: 2, episode: 4 })).toBe('S02 · E04');
    expect(episodeTag({ season: 12, episode: 104 })).toBe('S12 · E104');
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

describe('nextCellView', () => {
  const ready: NextEpisodeAnswer = {
    verdict: { k: 'ready', next: { season: 2, episode: 3, name: 'Three' } },
    runtimeS: null,
  };

  it('says the episode’s own number once it knows one', () => {
    expect(nextCellView(ready, false)).toEqual({ stateId: 'ready', note: 'S02 · E03' });
  });

  it('has a word for every state, and the state is the attribute', () => {
    const seen = new Set<string>();
    const views = [
      nextCellView(null, false),
      nextCellView(ready, false),
      nextCellView(ready, true),
      nextCellView({ verdict: { k: 'none' }, runtimeS: null }, false),
      nextCellView({ verdict: { k: 'unknown' }, runtimeS: null }, false),
    ];
    for (const v of views) {
      expect(v.note.length, v.stateId).toBeGreaterThan(2);
      seen.add(v.stateId);
    }
    // Every declared state is reachable, and nothing reachable is undeclared: the union is
    // derived from NEXT_CELL_STATES, so this is the row that keeps the array honest.
    expect([...seen].sort()).toEqual([...NEXT_CELL_STATES].sort());
  });

  it('lets a press in flight outrank everything, including a lookup that has not answered', () => {
    // A press that appears to do nothing is the defect this surface refuses everywhere, and
    // the press can take tens of seconds (it may run a provider search).
    expect(nextCellView(null, true).stateId).toBe('starting');
    expect(nextCellView(ready, true).stateId).toBe('starting');
    expect(nextCellView({ verdict: { k: 'none' }, runtimeS: null }, true).stateId).toBe('starting');
  });

  it('never says "the series has ended"', () => {
    // TMDB listing nothing after this episode is also what an unannounced next season looks
    // like, so the words have to be about the catalog and not about the programme.
    const note = nextCellView({ verdict: { k: 'none' }, runtimeS: null }, false).note;
    expect(note).not.toMatch(/end|final|last/i);
  });
});

// =====================================================================================
// The scale, and the two thresholds built on it
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
  it('is the asked-for fraction of the episode, in both directions', () => {
    const total = 1000;
    expect(pastAutoNextPoint(total * AUTO_NEXT_AT - 1, total)).toBe(false);
    expect(pastAutoNextPoint(total * AUTO_NEXT_AT, total)).toBe(true);
    expect(pastAutoNextPoint(total, total)).toBe(true);
  });

  it('is a fraction and not a fixed lead time, so it scales with the episode', () => {
    // 80% of a 22-minute comedy is four minutes of download time and of a 70-minute drama
    // fourteen, which is the right way round.
    expect(pastAutoNextPoint(18 * 60, 22 * 60)).toBe(true);
    expect(pastAutoNextPoint(18 * 60, 70 * 60)).toBe(false);
    // And the lead time each one buys, which is the point of the fraction: 4.4 minutes of
    // download on the comedy, 14 on the drama.
    expect(Math.round(22 * (1 - AUTO_NEXT_AT) * 10) / 10).toBe(4.4);
    expect(Math.round(70 * (1 - AUTO_NEXT_AT))).toBe(14);
  });

  it('refuses to answer with no scale, and refuses a playhead of 0', () => {
    expect(pastAutoNextPoint(900, null)).toBe(false);
    expect(pastAutoNextPoint(900, 0)).toBe(false);
    // 0/0 is NaN and `NaN >= 0.8` is false anyway; this pins the intent rather than the
    // arithmetic — a title nobody has started is not 80% watched.
    expect(pastAutoNextPoint(0, 1000)).toBe(false);
    expect(pastAutoNextPoint(Number.NaN, 1000)).toBe(false);
  });
});

describe('nearTheEnd', () => {
  it('is the last END_PROMPT_S seconds, in both directions', () => {
    const total = 1000;
    expect(nearTheEnd(total - END_PROMPT_S - 1, total)).toBe(false);
    expect(nearTheEnd(total - END_PROMPT_S, total)).toBe(true);
    expect(nearTheEnd(total, total)).toBe(true);
  });

  it('says nothing when nothing can say how long the episode is', () => {
    // Which is the honest answer rather than a limitation: with no scale there is no "end"
    // to be near, and a guess would put a 480px band over the picture at the wrong moment.
    expect(nearTheEnd(900, null)).toBe(false);
    expect(nearTheEnd(0, 1000)).toBe(false);
  });

  it('is shorter than the window the prefetch opens, or the prompt would precede the download', () => {
    // Not arithmetic for its own sake: if the prompt could appear before the 80% point, a
    // viewer would be invited to press Next on an episode nothing had started fetching.
    const shortest = 20 * 60;
    expect(shortest * (1 - AUTO_NEXT_AT)).toBeGreaterThan(END_PROMPT_S);
  });
});

// =====================================================================================
// prefetchEpisode — the one function here that can start a download
// =====================================================================================

describe('prefetchEpisode', () => {
  const ARGS = { tmdbId: 7, season: 2, episode: 3, userId: 'p1' };

  it('starts a download only when NOTHING on the box covers the episode', async () => {
    title.titleStateFor.mockResolvedValue(state({ kind: 'play' }));
    title.requestTitle.mockResolvedValue({ ok: true, torrentId: 't9' });
    await expect(prefetchEpisode(ARGS)).resolves.toBe(true);
    expect(title.requestTitle).toHaveBeenCalledWith({ mediaType: 'tv', tmdbId: 7, season: 2, episode: 3 });
  });

  it('starts NOTHING for every other answer, which is the season-pack case', async () => {
    // THE ONE THAT MATTERS. The episode on screen usually came from a season pack, and
    // `covers()` matches that pack for the next episode too — so the answer is `open` or
    // `preparing` and there is nothing to download. `POST /download` mints a fresh uuid with
    // no dedupe, so a second call here is a second multi-gigabyte copy of a season the box
    // already has, on a machine that allows two downloads.
    const others: TitleAction[] = [
      { kind: 'open', href: '/bigscreen/watch/t1?file=3' },
      { kind: 'resume', href: '/bigscreen/watch/t1?file=3', atSeconds: 60 },
      { kind: 'preparing', torrentId: 't1', progress: 10 },
      { kind: 'paused', torrentId: 't1' },
      { kind: 'unresolvedEpisode', href: '/bigscreen/watch/t1' },
      { kind: 'blocked', reason: 'no' },
    ];
    for (const action of others) {
      vi.clearAllMocks();
      title.titleStateFor.mockResolvedValue(state(action));
      await expect(prefetchEpisode(ARGS), action.kind).resolves.toBe(true);
      expect(title.requestTitle, action.kind).not.toHaveBeenCalled();
    }
  });

  it('never downloads for a locked profile', async () => {
    // `titleStateFor` answers `blocked` with `locked: true` and never `play`, so this is the
    // same arm as any other refusal — asserted because "the lock is what stops it" is the
    // kind of claim that is true by accident until somebody adds an arm.
    title.titleStateFor.mockResolvedValue(state({ kind: 'blocked', reason: 'locked' }, true));
    await expect(prefetchEpisode(ARGS)).resolves.toBe(true);
    expect(title.requestTitle).not.toHaveBeenCalled();
  });

  it('reports a refusal, which is the only thing the band says about this', async () => {
    title.titleStateFor.mockResolvedValue(state({ kind: 'play' }));
    title.requestTitle.mockResolvedValue({ ok: false, reason: 'busy', maybeCreated: false });
    await expect(prefetchEpisode(ARGS)).resolves.toBe(false);
  });

  it('is TOTAL: a throw is `false`, not an unhandled rejection in a television', async () => {
    // The caller fires this from an effect with `void`. Both awaits inside are documented as
    // resolving rather than rejecting, so this is unreachable today — the guard is at the
    // source precisely because the call site cannot see it.
    title.titleStateFor.mockRejectedValue(new Error('boom'));
    await expect(prefetchEpisode(ARGS)).resolves.toBe(false);
  });
});

// =====================================================================================
// whereToWatchEpisode — the press
// =====================================================================================

describe('whereToWatchEpisode', () => {
  const ARGS = { tmdbId: 7, season: 2, episode: 3, userId: 'p1' };

  it('goes straight to a torrent that is here', async () => {
    title.titleStateFor.mockResolvedValue(state({ kind: 'open', href: '/bigscreen/watch/t1?file=3' }));
    await expect(whereToWatchEpisode(ARGS)).resolves.toEqual({ ok: true, href: '/bigscreen/watch/t1?file=3' });
  });

  it('resumes where the viewer was, if they had started this episode before', async () => {
    title.titleStateFor.mockResolvedValue(
      state({ kind: 'resume', href: '/bigscreen/watch/t1?file=3', atSeconds: 120 }),
    );
    await expect(whereToWatchEpisode(ARGS)).resolves.toEqual({ ok: true, href: '/bigscreen/watch/t1?file=3' });
  });

  it('goes to an episode that is still downloading, with its file index', async () => {
    title.titleStateFor.mockResolvedValue(state({ kind: 'preparing', torrentId: 't1', progress: 12, fileIndex: 7 }));
    await expect(whereToWatchEpisode(ARGS)).resolves.toEqual({ ok: true, href: '/bigscreen/watch/t1?file=7' });
  });

  it('REFUSES a pack whose file it cannot name, rather than playing the wrong episode', async () => {
    // THE REASON THIS FUNCTION EXISTS INSTEAD OF REUSING THE SHOW SCREEN'S `placeToWatch`.
    // There it is offered behind a disclosure the viewer reads first; there is nowhere on a
    // transport cell to print one, and a bare URL plays the pack's DEFAULT file, i.e.
    // episode 1. Pressing "Next episode" and getting some other episode with no word about
    // it is exactly the defect `unresolvedEpisode` was invented to prevent.
    for (const action of [
      { kind: 'unresolvedEpisode', href: '/bigscreen/watch/t1' } as TitleAction,
      { kind: 'preparing', torrentId: 't1', progress: 12, fileUnknown: true } as TitleAction,
      { kind: 'paused', torrentId: 't1', fileUnknown: true } as TitleAction,
    ]) {
      vi.clearAllMocks();
      title.titleStateFor.mockResolvedValue(state(action));
      const answer = await whereToWatchEpisode(ARGS);
      expect(answer.ok, action.kind).toBe(false);
      expect(answer.ok === false && answer.reason.length, action.kind).toBeGreaterThan(10);
      expect(title.requestTitle, action.kind).not.toHaveBeenCalled();
    }
  });

  it('resumes a paused download rather than leaving the press dead', async () => {
    title.titleStateFor.mockResolvedValue(state({ kind: 'paused', torrentId: 't1', fileIndex: 2 }));
    title.resumeTitle.mockResolvedValue({ ok: true });
    await expect(whereToWatchEpisode(ARGS)).resolves.toEqual({ ok: true, href: '/bigscreen/watch/t1?file=2' });
    expect(title.resumeTitle).toHaveBeenCalledWith('t1');
  });

  it('says why when a paused download cannot be resumed', async () => {
    title.titleStateFor.mockResolvedValue(state({ kind: 'paused', torrentId: 't1', fileIndex: 2 }));
    title.resumeTitle.mockResolvedValue({ ok: false, reason: 'It may have been removed.' });
    await expect(whereToWatchEpisode(ARGS)).resolves.toEqual({ ok: false, reason: 'It may have been removed.' });
  });

  it('starts the download when nothing has, because the prefetch is a setting', async () => {
    title.titleStateFor.mockResolvedValue(state({ kind: 'play' }));
    title.requestTitle.mockResolvedValue({ ok: true, torrentId: 't9', fileIndex: 1 });
    await expect(whereToWatchEpisode(ARGS)).resolves.toEqual({ ok: true, href: '/bigscreen/watch/t9?file=1' });
  });

  it('refuses when the box answers a pack it cannot resolve the file in', async () => {
    title.titleStateFor.mockResolvedValue(state({ kind: 'play' }));
    title.requestTitle.mockResolvedValue({ ok: true, torrentId: 't9', unresolved: true });
    const answer = await whereToWatchEpisode(ARGS);
    expect(answer.ok).toBe(false);
    // ...and it says the download DID start, because it did: a viewer told only "no" would
    // press again and mint a second copy.
    expect(answer.ok === false && answer.reason).toMatch(/started/i);
  });

  it('passes the box’s own refusal through, word for word', async () => {
    title.titleStateFor.mockResolvedValue(state({ kind: 'play' }));
    title.requestTitle.mockResolvedValue({
      ok: false,
      reason: 'The box is busy with other downloads. Try again in a few minutes.',
      maybeCreated: false,
    });
    await expect(whereToWatchEpisode(ARGS)).resolves.toEqual({
      ok: false,
      reason: 'The box is busy with other downloads. Try again in a few minutes.',
    });
  });

  it('passes a blocked title’s reason through', async () => {
    title.titleStateFor.mockResolvedValue(state({ kind: 'blocked', reason: 'Nothing this television can play.' }));
    await expect(whereToWatchEpisode(ARGS)).resolves.toEqual({
      ok: false,
      reason: 'Nothing this television can play.',
    });
  });

  it('answers rather than throwing when the box cannot be reached', async () => {
    // A throw inside the player is a film that stops.
    title.titleStateFor.mockRejectedValue(new Error('offline'));
    const answer = await whereToWatchEpisode(ARGS);
    expect(answer.ok).toBe(false);
    expect(answer.ok === false && answer.reason).toMatch(/reach the box/i);
  });
});
